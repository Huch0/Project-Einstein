import os
import shutil
import json
import pytest

from app.sim.schema import example_pulley_scene
from app.tools.rapier_bridge import simulate_scene


def has_node() -> bool:
  return shutil.which("node") is not None


def has_rapier_worker_ready() -> bool:
  if not has_node():
    return False
  base = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, "sim_worker"))
  # If this pathing fails, attempt relative to project root
  if not os.path.exists(base):
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir, os.pardir, "sim_worker"))
  mod_path = os.path.join(base, "node_modules", "@dimforge", "rapier2d-node")
  return os.path.exists(mod_path)


@pytest.mark.skipif(not has_rapier_worker_ready(), reason="Rapier worker not installed (npm install) or Node unavailable")
def test_simulate_scene_basic():
  scene = example_pulley_scene().model_dump()
  data = simulate_scene(scene)
  assert "frames" in data and isinstance(data["frames"], list)
  assert len(data["frames"]) > 1
  assert "energy" in data
