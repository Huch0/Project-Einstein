"""Bridge from Python to Node.js Matter worker.

Spawns the worker process, sends Scene JSON on stdin, collects result JSON.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any, Dict

from app.models.settings import settings


def _default_worker_path() -> str:
  base = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))  # backend/
  return os.path.join(base, "sim_worker", "matter_worker.js")


def simulate_scene(scene: Dict[str, Any]) -> Dict[str, Any]:
  """Simulate a Scene via the Node Matter.js worker.

  Returns result dict with keys: frames, energy. Raises RuntimeError on failure.
  """
  worker = settings.MATTER_WORKER_PATH or _default_worker_path()
  if not os.path.exists(worker):
    raise RuntimeError(f"Matter worker not found at: {worker}")

  # Use `node` from PATH
  cmd = ["node", worker]
  try:
    proc = subprocess.run(
      cmd,
      input=json.dumps(scene).encode("utf-8"),
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
