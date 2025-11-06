"""Shared logging helpers for backend components."""

from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Final

_LOG_FORMAT: Final[str] = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"


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
    # Re-create handlers to ensure consistent formatting and level
    if logger.handlers:
        for handler in list(logger.handlers):
            logger.removeHandler(handler)

    handler = logging.StreamHandler()
    handler.setLevel(chosen_level)
    handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    logger.addHandler(handler)
    logger.setLevel(chosen_level)
    logger.propagate = False
    return logger


def ensure_scene_log_dir(timestamp: str | None = None) -> tuple[Path, str]:
    """Return the directory for scene visualizations, creating it if needed."""
    backend_root = Path(__file__).resolve().parents[1]
    if timestamp is None:
        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    output_dir = backend_root / "logs" / "scenes" / timestamp
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir, timestamp
