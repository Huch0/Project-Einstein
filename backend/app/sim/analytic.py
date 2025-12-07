"""Backward-compat import shim for analytic solvers.

This module re-exports analytic simulation helpers from app.sim.physics.analytic
so legacy imports like `from app.sim.analytic import simulate_ramp_scene` keep working.
"""
from app.sim.physics.analytic import simulate_pulley_scene, simulate_ramp_scene

__all__ = [
    "simulate_pulley_scene",
    "simulate_ramp_scene",
]
