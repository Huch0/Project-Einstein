"""
Router: /run_sim - Simulation Execution (v0.5)

Runs Matter.js simulation on pre-initialized scene.
Requires successful /init_sim execution first.

Pipeline:
1. Load scene from context (must exist)
2. simulate_physics(scene) → frames
3. analyze_simulation(frames, scene) → analysis (optional)

Returns simulation frames and physics analysis.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.agent.agent_context import get_context_store
from app.agent.tools.simulate_physics import simulate_physics, SimulatePhysicsInput
from app.agent.tools.analyze_results import analyze_simulation, AnalyzeSimulationInput

logger = logging.getLogger("run_sim")

router = APIRouter(prefix="/run_sim", tags=["simulation"])


# ===========================
# Request/Response Models
# ===========================

class RunSimRequest(BaseModel):
    """Request body for /run_sim endpoint."""
    
    conversation_id: str = Field(
        description="Conversation ID from /init_sim"
    )
    duration_s: float = Field(
        default=5.0,
        description="Simulation duration in seconds"
    )
    frame_rate: int = Field(
        default=60,
        description="Frames per second"
    )
    analyze: bool = Field(
        default=True,
        description="Whether to run physics analysis after simulation"
    )


class RunSimResponse(BaseModel):
    """Response from /run_sim endpoint."""
    
    status: str = Field(
        description="Status: 'simulated', 'failed'"
    )
    conversation_id: str = Field(
        description="Conversation ID for this simulation"
    )
    simulation: dict = Field(
        description="Simulation results (frames, meta)"
    )
    analysis: Optional[dict] = Field(
        default=None,
        description="Physics analysis results (energy, forces, motion_summary)"
    )


# ===========================
# Analysis Helper (REMOVED - using tool directly)
# ===========================
# analyze_simulation tool is now called directly in the pipeline


# ===========================
# Endpoint
# ===========================

@router.post("", response_model=RunSimResponse)
async def run_simulation(request: RunSimRequest):
    """
    Execute Matter.js simulation on pre-initialized scene.
    
    Requirements:
    - Conversation must exist (from /init_sim)
    - Scene must be built (initialization complete)
    
    Pipeline:
    1. Load scene from context
    2. simulate_physics(scene, duration, frame_rate)
    3. analyze_simulation(frames, scene) [optional]
    
    Returns:
        RunSimResponse with simulation frames and analysis
    """
    context_store = get_context_store()
    
    # Get context
    context = context_store.get_context(request.conversation_id)
    if not context:
        raise HTTPException(
            status_code=404,
            detail=f"Conversation {request.conversation_id} not found"
        )
    
    # Check if scene exists
    if not context.scene:
        raise HTTPException(
            status_code=400,
            detail="Scene not initialized. Call /init_sim first to build the scene."
        )
    
    logger.info(f"[run_sim] Starting simulation for conversation {request.conversation_id}")
    logger.info(f"[run_sim] Scene: {len(context.scene.get('bodies', []))} bodies, {len(context.scene.get('constraints', []))} constraints")
    
    try:
        # ===========================
        # Step 1: Run Simulation
        # ===========================
        logger.info(f"[run_sim] Running Matter.js simulation ({request.duration_s}s @ {request.frame_rate}fps)")
        
        sim_result = await simulate_physics(SimulatePhysicsInput(
            scene=context.scene,
            duration_s=request.duration_s,
            frame_rate=request.frame_rate
        ))
        
        frames = [frame.dict() for frame in sim_result.frames]
        meta = sim_result.meta
        
        logger.info(f"[run_sim] ✅ Simulation complete: {len(frames)} frames generated")
        
        # Update context with frames
        context.update_pipeline_state(frames=frames)
        context_store.update_context(context)
        
        # ===========================
        # Step 2: Analyze (Optional)
        # ===========================
        analysis = None
        if request.analyze and frames:
            logger.info(f"[run_sim] Analyzing simulation results")
            
            # Use analyze_simulation tool
            analysis_result = await analyze_simulation(AnalyzeSimulationInput(
                frames=frames,
                scene=context.scene,
                analysis_type="motion_summary"
            ))
            
            # Convert tool output to response format
            analysis = {
                "energy_conservation": analysis_result.energy_conservation.dict() if analysis_result.energy_conservation else None,
                "constraint_violations": analysis_result.constraint_violations.dict() if analysis_result.constraint_violations else None,
                "motion_summary": analysis_result.motion_summary.dict() if analysis_result.motion_summary else None,
            }
            
            logger.info(f"[run_sim] ✅ Analysis complete")
        
        # ===========================
        # Success Response
        # ===========================
        return RunSimResponse(
            status="simulated",
            conversation_id=request.conversation_id,
            simulation={
                "frames": frames,
                "meta": {
                    **meta,
                    "frames_count": len(frames),
                    "simulation_time_s": request.duration_s,
                    "engine": "matter-js v0.19"
                }
            },
            analysis=analysis
        )
        
    except Exception as e:
        logger.error(f"[run_sim] Simulation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Simulation error: {str(e)}"
        )
