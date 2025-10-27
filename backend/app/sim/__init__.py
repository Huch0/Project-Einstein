"""Physics simulation module.

This module provides:
- Scene schema and validation (schema.py)
- Scene builders (builder.py, registry.py, builders/)
- Physics engines (physics/):
  - Matter.js bridge for 2D rigid body simulation
  - Analytic solvers for pulley and ramp scenarios
"""

from app.sim.schema import Scene, Body, PulleyConstraint, WorldSettings
from app.sim.builder import build_scene
from app.sim.registry import build_scene_v2
from app.sim.physics import simulate_scene, simulate_pulley_scene, simulate_ramp_scene

__all__ = [
    # Schema
    "Scene",
    "Body",
    "PulleyConstraint",
    "WorldSettings",
    # Builders
    "build_scene",
    "build_scene_v2",
    # Physics engines
    "simulate_scene",
    "simulate_pulley_scene",
    "simulate_ramp_scene",
]
