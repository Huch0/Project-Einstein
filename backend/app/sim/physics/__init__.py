"""Physics simulation engines and solvers."""

from app.sim.physics.analytic import simulate_pulley_scene, simulate_ramp_scene
from app.sim.physics.matter_bridge import simulate_scene

__all__ = [
    "simulate_scene",  # Matter.js physics engine
    "simulate_pulley_scene",  # Analytic pulley solver
    "simulate_ramp_scene",  # Analytic ramp solver
]


def simulate_analytic(scene):
    """
    Simulate scene using analytic solver.
    
    Routes to appropriate solver based on scene.kind.
    """
    kind = scene.kind if hasattr(scene, "kind") else scene.get("kind")
    
    if "pulley" in kind:
        return simulate_pulley_scene(scene)
    elif "ramp" in kind:
        return simulate_ramp_scene(scene)
    else:
        # Fallback: empty frames
        return []
