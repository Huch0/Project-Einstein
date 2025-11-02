"""
Tool 5: simulate_physics - Matter.js Physics Simulation

Runs physics simulation using Matter.js engine only (v0.4).
Analytic solver removed - all simulations use realistic 2D rigid body dynamics.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.sim.physics import simulate_scene
from app.sim.schema import Scene


class SimulatePhysicsInput(BaseModel):
    """Input schema for simulate_physics tool."""
    
    scene: dict[str, Any] = Field(
        description="Scene JSON from build_physics_scene tool"
    )
    duration_s: float = Field(
        default=5.0,
        description="Simulation duration in seconds"
    )
    frame_rate: int = Field(
        default=60,
        description="Frames per second"
    )


class SimulationFrame(BaseModel):
    """Single simulation frame."""
    
    t: float = Field(description="Time in seconds")
    positions: dict[str, tuple[float, float]] = Field(
        description="Body positions {body_id: [x_m, y_m]}"
    )
    velocities: dict[str, tuple[float, float]] = Field(
        default_factory=dict,
        description="Body velocities {body_id: [vx, vy]}"
    )
    forces: dict[str, tuple[float, float]] = Field(
        default_factory=dict,
        description="Body forces {body_id: [fx, fy]}"
    )


class SimulatePhysicsOutput(BaseModel):
    """Output schema for simulate_physics tool."""
    
    frames: list[SimulationFrame] = Field(
        default_factory=list,
        description="Simulation frames"
    )
    meta: dict[str, Any] = Field(
        default_factory=dict,
        description="Execution metadata (engine, frames_count, etc.)"
    )


async def simulate_physics(
    input_data: SimulatePhysicsInput
) -> SimulatePhysicsOutput:
    """
    Run Matter.js physics simulation on Scene JSON.
    
    Args:
        input_data: Scene and simulation configuration
        
    Returns:
        Simulation frames with positions, velocities, forces
        
    Example:
        >>> result = await simulate_physics(SimulatePhysicsInput(
        ...     scene={"world": {...}, "bodies": [...], "constraints": [...]},
        ...     duration_s=5.0,
        ...     frame_rate=60
        ... ))
        >>> print(f"Generated {len(result.frames)} frames")
    """
    # Parse scene dict to Scene object
    scene = Scene(**input_data.scene)
    
    # Run Matter.js simulation
    try:
        matter_frames = simulate_scene(scene)
        
        if not matter_frames or len(matter_frames) == 0:
            raise ValueError("Matter.js returned empty frames")
        
        # Convert Matter.js frames to output format
        frames_list = []
        for frame in matter_frames:
            frames_list.append(SimulationFrame(
                t=frame.get("t", 0.0),
                positions=frame.get("positions", {}),
                velocities=frame.get("velocities", {}),
                forces=frame.get("forces", {})
            ))
        
        return SimulatePhysicsOutput(
            frames=frames_list,
            meta={
                "engine": "matter-js v0.19",
                "frames_count": len(frames_list),
                "simulation_time_s": frames_list[-1].t if frames_list else 0.0
            }
        )
    
    except Exception as e:
        # v0.4: No fallback to analytic solver
        # Return empty frames with error in meta
        return SimulatePhysicsOutput(
            frames=[],
            meta={
                "engine": "matter-js",
                "error": str(e),
                "frames_count": 0
            }
        )


async def simulate_physics(
    input_data: SimulatePhysicsInput
) -> SimulatePhysicsOutput:
    """
    Run Matter.js physics simulation on Scene JSON.
    
    Args:
        input_data: Scene and simulation configuration
        
    Returns:
        Simulation frames with positions, velocities, forces
        
    Example:
        >>> result = await simulate_physics(SimulatePhysicsInput(
        ...     scene={"world": {...}, "bodies": [...], "constraints": [...]},
        ...     duration_s=5.0,
        ...     frame_rate=60
        ... ))
        >>> print(f"Generated {len(result.frames)} frames")
    """
    # Parse scene dict to Scene object
    scene = Scene(**input_data.scene)
    
    # Run Matter.js simulation
    try:
        matter_frames = simulate_scene(scene)
        
        if not matter_frames or len(matter_frames) == 0:
            raise ValueError("Matter.js returned empty frames")
        
        # Convert Matter.js frames to output format
        frames_list = []
        for frame in matter_frames:
            frames_list.append(SimulationFrame(
                t=frame.get("t", 0.0),
                positions=frame.get("positions", {}),
                velocities=frame.get("velocities", {}),
                forces=frame.get("forces", {})
            ))
        
        return SimulatePhysicsOutput(
            frames=frames_list,
            meta={
                "engine": "matter-js v0.19",
                "frames_count": len(frames_list),
                "simulation_time_s": frames_list[-1].t if frames_list else 0.0
            }
        )
    
    except Exception as e:
        # v0.4: No fallback to analytic solver
        # Return empty frames with error in meta
        return SimulatePhysicsOutput(
            frames=[],
            meta={
                "engine": "matter-js",
                "error": str(e),
                "frames_count": 0
            }
        )

