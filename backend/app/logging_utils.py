"""Shared logging helpers for backend components."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Final

_LOG_FORMAT: Final[str] = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
_CONFIGURED_ATTR: Final[str] = "_einstein_logger_configured"


def _parse_level(level_str: str | None, default: int) -> int:
    if not level_str:
        return default
    level_str = level_str.strip().upper()
    mapping = {
        "CRITICAL": logging.CRITICAL,
        "ERROR": logging.ERROR,
        "WARNING": logging.WARNING,
        "WARN": logging.WARNING,
        "INFO": logging.INFO,
        "DEBUG": logging.DEBUG,
        "NOTSET": logging.NOTSET,
    }
    return mapping.get(level_str, default)


def get_logger(name: str, level: int | None = None) -> logging.Logger:
    """Return a configured logger that emits to stderr.

    Behavior:
    - If `level` is provided it takes precedence.
    - Otherwise the `LOG_LEVEL` environment variable is consulted (e.g. DEBUG, INFO).
    - Falls back to INFO when unspecified.
    """
    env_level = os.environ.get("LOG_LEVEL")
    default_level = logging.INFO
    chosen_level = level if level is not None else _parse_level(env_level, default_level)

    logger = logging.getLogger(name)

    # If already configured, just ensure level matches and reuse existing handlers
    if getattr(logger, _CONFIGURED_ATTR, False):
        logger.setLevel(chosen_level)
        for handler in logger.handlers:
            handler.setLevel(chosen_level)
        return logger

    # Fresh configuration
    for handler in list(logger.handlers):
        logger.removeHandler(handler)

    handler = logging.StreamHandler()
    handler.setLevel(chosen_level)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    logger.addHandler(handler)
    logger.setLevel(chosen_level)
    logger.propagate = False
    setattr(logger, _CONFIGURED_ATTR, True)
    return logger


def ensure_scene_log_dir(timestamp: str | None = None) -> tuple[Path, str]:
    """Return the directory for scene visualizations, creating it if needed."""
    backend_root = Path(__file__).resolve().parents[1]
    if timestamp is None:
        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    output_dir = backend_root / "logs" / "scenes" / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir, timestamp


def summarize_for_log(value: Any, *, depth: int = 2, max_items: int = 6) -> Any:
    """Return a compact summary for nested payloads to keep logs readable."""
    if depth < 0:
        return "..."

    if isinstance(value, dict):
        summary: dict[str, Any] = {}
        for idx, (key, item) in enumerate(value.items()):
            if idx >= max_items:
                summary["..."] = f"+{len(value) - idx} more"
                break
            summary[key] = summarize_for_log(item, depth=depth - 1, max_items=max_items)
        return summary

    if isinstance(value, list):
        if not value:
            return []
        summarized = [summarize_for_log(item, depth=depth - 1, max_items=max_items) for item in value[:max_items]]
        if len(value) > max_items:
            summarized.append(f"... (+{len(value) - max_items} more)")
        return summarized

    if isinstance(value, tuple):
        return tuple(summarize_for_log(item, depth=depth - 1, max_items=max_items) for item in value[:max_items])

    if isinstance(value, set):
        items = list(value)
        return {
            "type": "set",
            "size": len(value),
            "sample": [summarize_for_log(item, depth=depth - 1, max_items=max_items) for item in items[:max_items]],
        }

    if isinstance(value, bytes):
        text = value.decode("utf-8", errors="ignore")
        return text[:117] + "..." if len(text) > 120 else text

    if isinstance(value, str):
        return value[:117] + "..." if len(value) > 120 else value

    if isinstance(value, (int, float, bool)) or value is None:
        return value

    return str(value)


def format_for_log(value: Any, *, max_chars: int = 600) -> str:
    """Serialize summarized payload as a single-line string for log output."""
    summary = summarize_for_log(value)
    try:
        text = json.dumps(summary, ensure_ascii=True)
    except Exception:
        text = str(summary)
    return text[:max_chars] + "..." if len(text) > max_chars else text
