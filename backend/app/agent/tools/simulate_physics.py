"""
Tool 5: simulate_physics - Physics Engine Execution

Runs physics simulation using Matter.js or analytic solvers.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.sim.physics import simulate_scene, simulate_analytic
from app.sim.schema import Scene


class SimulatePhysicsInput(BaseModel):
    """Input schema for simulate_physics tool."""
    
    scene: dict[str, Any] = Field(
        description="Scene JSON from build_physics_scene tool"
    )
    engine: Literal["matter-js", "analytic"] = Field(
        default="matter-js",
        description="Physics engine to use"
    )
    duration_s: float = Field(
        default=5.0,
        description="Simulation duration in seconds"
    )
    output_format: Literal["frames", "summary", "energy_only"] = Field(
        default="frames",
        description="Output detail level"
    )


class SimulationFrame(BaseModel):
    """Single simulation frame."""
    
    t: float = Field(description="Time in seconds")
    positions: dict[str, tuple[float, float]] = Field(
        description="Body positions {body_id: [x_m, y_m]}"
    )


class SimulatePhysicsOutput(BaseModel):
    """Output schema for simulate_physics tool."""
    
    engine: str = Field(
        description="Engine used (matter-js, analytic, or fallback)"
    )
    frames: list[SimulationFrame] = Field(
        default_factory=list,
        description="Simulation frames (if output_format includes frames)"
    )
    energy: dict[str, list[float]] = Field(
        default_factory=dict,
        description="Energy time series (kinetic_j, potential_j, total_j)"
    )
    summary: dict[str, Any] = Field(
        default_factory=dict,
        description="Simulation summary (max_speed, final_positions, etc.)"
    )
    meta: dict[str, Any] = Field(
        default_factory=dict,
        description="Execution metadata (frames_count, solver, etc.)"
    )


async def simulate_physics(
    input_data: SimulatePhysicsInput
) -> SimulatePhysicsOutput:
    """
    Run physics simulation on Scene JSON.
    
    Uses Matter.js for complex scenarios, falls back to analytic solver
    for simple cases or if Matter.js fails.
    
    Args:
        input_data: Scene and simulation configuration
        
    Returns:
        Simulation frames and energy analysis
        
    Example:
        >>> result = await simulate_physics(SimulatePhysicsInput(
        ...     scene={"kind": "pulley.single_fixed_v0", ...},
        ...     engine="matter-js",
        ...     duration_s=5.0
        ... ))
        >>> print(f"Generated {len(result.frames)} frames")
    """
    # Parse scene dict to Scene object
    scene = Scene(**input_data.scene)
    
    # Override duration if specified
    if input_data.duration_s != scene.world.time_step_s * 100:
        # Adjust time step or frame count as needed
        pass
    
    frames_list = []
    engine_used = input_data.engine
    
    # Try Matter.js first if requested
    if input_data.engine == "matter-js":
        try:
            matter_frames = simulate_scene(scene)
            if matter_frames and len(matter_frames) > 0:
                # Convert Matter.js frames to output format
                for frame in matter_frames:
                    frames_list.append(SimulationFrame(
                        t=frame["t"],
                        positions=frame["positions"]
                    ))
                engine_used = "matter-js"
            else:
                # Empty frames, fall back to analytic
                engine_used = "analytic-fallback"
                analytic_frames = simulate_analytic(scene)
                for frame in analytic_frames:
                    frames_list.append(SimulationFrame(
                        t=frame["t"],
                        positions=frame["positions"]
                    ))
        except Exception as e:
            # Matter.js failed, fall back to analytic
            engine_used = f"analytic-fallback (matter-js error: {str(e)[:50]})"
            analytic_frames = simulate_analytic(scene)
            for frame in analytic_frames:
                frames_list.append(SimulationFrame(
                    t=frame["t"],
                    positions=frame["positions"]
                ))
    else:
        # Use analytic solver directly
        analytic_frames = simulate_analytic(scene)
        for frame in analytic_frames:
            frames_list.append(SimulationFrame(
                t=frame["t"],
                positions=frame["positions"]
            ))
        engine_used = "analytic"
    
    # Compute energy if requested
    energy = {}
    if input_data.output_format in ["frames", "energy_only"]:
        # TODO: Implement energy calculation from frames + scene
        energy = {
            "kinetic_j": [],
            "potential_j": [],
            "total_j": []
        }
    
    # Compute summary if requested
    summary = {}
    if input_data.output_format in ["summary", "frames"]:
        if frames_list:
            # Max speed (approximate from position delta)
            max_speed = 0.0
            for i in range(1, len(frames_list)):
                dt = frames_list[i].t - frames_list[i-1].t
                for body_id in frames_list[i].positions:
                    if body_id in frames_list[i-1].positions:
                        pos1 = frames_list[i-1].positions[body_id]
                        pos2 = frames_list[i].positions[body_id]
                        dx = pos2[0] - pos1[0]
                        dy = pos2[1] - pos1[1]
                        speed = ((dx**2 + dy**2)**0.5) / dt if dt > 0 else 0
                        max_speed = max(max_speed, speed)
            
            summary = {
                "max_speed_m_s": max_speed,
                "final_positions": dict(frames_list[-1].positions),
                "total_time_s": frames_list[-1].t
            }
    
    # Only include frames if output_format requests them
    output_frames = frames_list if input_data.output_format != "energy_only" else []
    
    return SimulatePhysicsOutput(
        engine=engine_used,
        frames=output_frames,
        energy=energy,
        summary=summary,
        meta={
            "frames_count": len(frames_list),
            "solver": engine_used,
            "scene_kind": scene.kind
        }
    )
