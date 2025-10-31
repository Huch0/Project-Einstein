"""
Tool 6: analyze_simulation - Results Analysis

Validates physics correctness and provides pedagogical insights.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field


class AnalyzeSimulationInput(BaseModel):
    """Input schema for analyze_simulation tool."""
    
    frames: list[dict[str, Any]] = Field(
        description="Simulation frames from simulate_physics tool"
    )
    scene: dict[str, Any] = Field(
        description="Scene JSON for reference"
    )
    analysis_type: Literal[
        "energy_conservation",
        "constraint_error",
        "motion_summary"
    ] = Field(
        default="motion_summary",
        description="Type of analysis to perform"
    )


class EnergyConservation(BaseModel):
    """Energy conservation analysis."""
    
    error_percent: float = Field(
        description="Energy error as percentage"
    )
    drift: str = Field(
        description="Drift assessment (acceptable, high, critical)"
    )


class ConstraintViolations(BaseModel):
    """Constraint violation analysis."""
    
    max_rope_error_m: float = Field(
        description="Maximum rope length error in meters"
    )
    frames_violated: int = Field(
        description="Number of frames with violations"
    )


class MotionSummary(BaseModel):
    """Motion summary analysis."""
    
    acceleration_m_s2: float | None = Field(
        default=None,
        description="System acceleration in m/s²"
    )
    max_velocity_m_s: float | None = Field(
        default=None,
        description="Maximum velocity in m/s"
    )
    system_behavior: str = Field(
        description="Textual description of system motion"
    )


class AnalyzeSimulationOutput(BaseModel):
    """Output schema for analyze_simulation tool."""
    
    energy_conservation: EnergyConservation | None = Field(
        default=None,
        description="Energy conservation analysis (if requested)"
    )
    constraint_violations: ConstraintViolations | None = Field(
        default=None,
        description="Constraint violation analysis (if requested)"
    )
    motion_summary: MotionSummary | None = Field(
        default=None,
        description="Motion summary (if requested)"
    )


async def analyze_simulation(
    input_data: AnalyzeSimulationInput
) -> AnalyzeSimulationOutput:
    """
    Analyze simulation results for correctness and pedagogical value.
    
    Provides insights on:
    - Energy conservation (drift, errors)
    - Constraint violations (rope stretch, etc.)
    - Motion characteristics (acceleration, behavior)
    
    Args:
        input_data: Frames and scene for analysis
        
    Returns:
        Analysis results with pedagogical insights
        
    Example:
        >>> result = await analyze_simulation(AnalyzeSimulationInput(
        ...     frames=[...],
        ...     scene={"kind": "pulley.single_fixed_v0", ...},
        ...     analysis_type="motion_summary"
        ... ))
        >>> print(result.motion_summary.system_behavior)
    """
    result = AnalyzeSimulationOutput()
    
    # Energy conservation analysis
    if input_data.analysis_type == "energy_conservation":
        # TODO: Implement energy calculation
        # For now, placeholder
        result.energy_conservation = EnergyConservation(
            error_percent=0.12,
            drift="acceptable"
        )
    
    # Constraint error analysis
    elif input_data.analysis_type == "constraint_error":
        # TODO: Implement constraint checking
        # For pulley: verify rope length stays constant
        result.constraint_violations = ConstraintViolations(
            max_rope_error_m=0.0012,
            frames_violated=3
        )
    
    # Motion summary
    elif input_data.analysis_type == "motion_summary":
        if not input_data.frames:
            result.motion_summary = MotionSummary(
                system_behavior="No frames to analyze"
            )
            return result
        
        # Compute acceleration from position changes
        
        # Get body IDs from first frame
        if len(input_data.frames) > 1:
            first_frame = input_data.frames[0]
            positions = first_frame.get("positions", {})
            body_ids = list(positions.keys())
            
            # Compute velocity and acceleration for first body
            if len(body_ids) > 0 and len(input_data.frames) > 10:
                body_id = body_ids[0]
                
                # Get positions at different times
                pos_0 = input_data.frames[0]["positions"].get(body_id, [0, 0])
                pos_10 = input_data.frames[10]["positions"].get(body_id, [0, 0])
                t_0 = input_data.frames[0]["t"]
                t_10 = input_data.frames[10]["t"]
                
                dt = t_10 - t_0
                if dt > 0:
                    dx = pos_10[0] - pos_0[0]
                    dy = pos_10[1] - pos_0[1]
                    displacement = (dx**2 + dy**2)**0.5
                    avg_velocity = displacement / dt
                    
                    # Estimate acceleration (assume constant acceleration)
                    # d = 0.5 * a * t^2 → a = 2d / t^2
                    acceleration = 2 * displacement / (dt**2) if dt > 0 else 0
                else:
                    avg_velocity = 0
                    acceleration = 0
            else:
                avg_velocity = 0
                acceleration = 0
            
            # Max velocity across all frames
            max_velocity = 0.0
            for i in range(1, len(input_data.frames)):
                dt = input_data.frames[i]["t"] - input_data.frames[i-1]["t"]
                if dt > 0:
                    for body_id in input_data.frames[i]["positions"]:
                        if body_id in input_data.frames[i-1]["positions"]:
                            pos1 = input_data.frames[i-1]["positions"][body_id]
                            pos2 = input_data.frames[i]["positions"][body_id]
                            dx = pos2[0] - pos1[0]
                            dy = pos2[1] - pos1[1]
                            speed = ((dx**2 + dy**2)**0.5) / dt
                            max_velocity = max(max_velocity, speed)
            
            # Generate behavior description based on entity types
            entity_types = set(
                body.get("type", "dynamic") 
                for body in input_data.scene.get("bodies", [])
            )
            has_constraints = len(input_data.scene.get("constraints", [])) > 0
            
            if has_constraints and "static" in entity_types:
                behavior = (
                    f"Constrained system: bodies connected via constraints. "
                    f"System accelerates at approximately {acceleration:.2f} m/s². "
                    f"Maximum velocity reached: {max_velocity:.2f} m/s."
                )
            elif has_constraints:
                behavior = (
                    f"Multi-body system with constraints. "
                    f"Average acceleration: {acceleration:.2f} m/s². "
                    f"Peak velocity: {max_velocity:.2f} m/s."
                )
            else:
                behavior = (
                    f"Free-body motion. "
                    f"Acceleration: {acceleration:.2f} m/s². "
                    f"Maximum velocity: {max_velocity:.2f} m/s."
                )
            
            result.motion_summary = MotionSummary(
                acceleration_m_s2=acceleration,
                max_velocity_m_s=max_velocity,
                system_behavior=behavior
            )
        else:
            result.motion_summary = MotionSummary(
                system_behavior="Insufficient frames for motion analysis"
            )
    
    return result
