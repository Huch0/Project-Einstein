"""Bridge from Python to Node.js Matter worker.

Spawns the worker process, sends Scene JSON on stdin, collects result JSON.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

from app.models.settings import settings
from app.sim.schema import Scene


_REPO_ROOT = Path(__file__).resolve().parents[4]
_BACKEND_DIR = _REPO_ROOT / "backend"


def _default_worker_path() -> Path:
  return _BACKEND_DIR / "sim_worker" / "matter_worker.js"


def _resolve_worker_path(raw_path: str | None) -> Path:
  if not raw_path:
    return _default_worker_path()

  path = Path(raw_path).expanduser()
  if path.is_absolute():
    return path
  return (_REPO_ROOT / path).resolve()


def _to_payload(scene: Any) -> Dict[str, Any]:
  if isinstance(scene, Scene):
    return scene.model_dump(mode="json")
  if isinstance(scene, dict):
    return scene
  raise TypeError(f"Unsupported scene payload type: {type(scene)!r}")


def simulate_scene(scene: Dict[str, Any] | Scene) -> Dict[str, Any]:
  """Simulate a Scene via the Node Matter.js worker.

  Returns result dict with keys: frames, energy. Raises RuntimeError on failure.
  """
  worker_path = _resolve_worker_path(settings.MATTER_WORKER_PATH)
  if not worker_path.exists():
    raise RuntimeError(f"Matter worker not found at: {worker_path}")

  payload = _to_payload(scene)

  # Use `node` from PATH
  cmd = ["node", str(worker_path)]
  try:
    proc = subprocess.run(
      cmd,
      input=json.dumps(payload).encode("utf-8"),
      stdout=subprocess.PIPE,
      stderr=subprocess.PIPE,
      timeout=float(settings.MATTER_WORKER_TIMEOUT_S),
      check=False,
    )
  except FileNotFoundError as e:
    raise RuntimeError("Node.js runtime not found. Please install Node and ensure 'node' is on PATH.") from e
  except subprocess.TimeoutExpired as e:
    raise RuntimeError(f"Matter worker timed out after {settings.MATTER_WORKER_TIMEOUT_S}s") from e

  out = proc.stdout.decode("utf-8", errors="replace").strip()
  err = proc.stderr.decode("utf-8", errors="replace").strip()
  if err:
    # Include stderr for diagnostics (Matter worker uses console.error for logs)
    sys.stderr.write(f"[matter-worker] {err}\n")

  if not out:
    raise RuntimeError("Matter worker produced no output")
  try:
    data = json.loads(out)
  except json.JSONDecodeError as e:
    raise RuntimeError(f"Invalid JSON from Matter worker: {out[:200]}...") from e

  if "error" in data:
    raise RuntimeError(f"Matter worker error: {data['error']}")
  return data


__all__ = ["simulate_scene"]
