"""Physics simulation module (v0.4).

This module provides:
- Scene schema and validation (schema.py)
- Universal Physics Builder (universal_builder.py)
- Physics engines (physics/):
  - Matter.js bridge for 2D rigid body simulation
"""

from app.sim.schema import Scene, Body, PulleyConstraint, WorldSettings
from app.sim.universal_builder import build_scene_universal
from app.sim.physics import simulate_scene

__all__ = [
    # Schema
    "Scene",
    "Body",
    "PulleyConstraint",
    "WorldSettings",
    # Universal Builder
    "build_scene_universal",
    # Physics engine
    "simulate_scene",
]
