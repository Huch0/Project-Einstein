"""
Router: /simulation/batch_update - Scene Batch Update API (v1.0)

Provides REST API for updating scene bodies and constraints in batch.
Designed for Interactive Mode frontend integration.

Features:
- Batch body/constraint updates
- Validation (reuses scene_editor logic)
- Optional resimulation
- History tracking (scene_history)

Architecture:
- Reuses ConversationContext.apply_scene_updates()
- Validates updates using scene_editor helpers
- Records snapshots via record_scene_snapshot()
- Optional Matter.js simulation
"""

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.agent.agent_context import get_context_store, ConversationContext
from app.agent.tools.simulate_physics import simulate_physics, SimulatePhysicsInput

logger = logging.getLogger("simulation_update")

router = APIRouter(prefix="/simulation", tags=["simulation"])


# ===========================
# Helper Functions
# ===========================

def _ensure_scene_initialized(context: ConversationContext) -> None:
    """Ensure scene_state is initialized before updates."""
    if not context.scene_state:
        context.reset_scene_state(
            mapping=context.mapping or context.scene.get("mapping") if context.scene else None
        )


def _validate_and_merge_body_update(
    context: ConversationContext,
    body_id: str,
    updates: dict[str, Any]
) -> dict[str, Any]:
    """
    Merge updates into existing body with validation.
    
    Args:
        context: Conversation context
        body_id: Body identifier
        updates: Update dictionary (position_m, mass_kg, etc.)
        
    Returns:
        Merged body dictionary
        
    Raises:
        HTTPException: If body not found or validation fails
    """
    # Get existing body from scene_state
    existing_body = context.scene_state.get("bodies", {}).get(body_id)
    
    if not existing_body:
        raise HTTPException(
            status_code=404,
            detail=f"Body '{body_id}' not found in scene"
        )
    
    # Merge updates
    updated_body = {**existing_body, **updates}
    
    # Validate position bounds (if position updated)
    if "position_m" in updates:
        # Import validation helper from scene_editor
        try:
            from app.agent.tools.scene_editor import _clamp_block_to_image_bounds
            
            # Get size for validation
            collider = updated_body.get("collider", {})
            if collider.get("type") == "rectangle":
                size_m = (
                    collider.get("width_m", 1.0),
                    collider.get("height_m", 1.0)
                )
            elif collider.get("type") == "circle":
                radius = collider.get("radius_m", 0.5)
                size_m = (radius * 2, radius * 2)
            else:
                size_m = (1.0, 1.0)  # Default size
            
            # Validate and clamp position
            validated_pos, validated_size, warnings = _clamp_block_to_image_bounds(
                context,
                tuple(updates["position_m"]),
                size_m
            )
            
            if warnings:
                logger.warning(f"[batch_update] Position clamping warnings for {body_id}: {warnings}")
            
            updated_body["position_m"] = list(validated_pos)
            
            # Update size if clamped
            if collider.get("type") == "rectangle":
                updated_body["collider"]["width_m"] = validated_size[0]
                updated_body["collider"]["height_m"] = validated_size[1]
                
        except ImportError:
            # Fallback: No validation
            logger.warning("[batch_update] Could not import validation helpers, skipping position validation")
            pass
    
    return updated_body


def _validate_and_merge_constraint_update(
    context: ConversationContext,
    constraint_id: str,
    updates: dict[str, Any]
) -> dict[str, Any]:
    """
    Merge updates into existing constraint with validation.
    
    Args:
        context: Conversation context
        constraint_id: Constraint identifier
        updates: Update dictionary
        
    Returns:
        Merged constraint dictionary
        
    Raises:
        HTTPException: If constraint not found
    """
    # Get existing constraint
    existing_constraint = context.scene_state.get("constraints", {}).get(constraint_id)
    
    if not existing_constraint:
        raise HTTPException(
            status_code=404,
            detail=f"Constraint '{constraint_id}' not found in scene"
        )
    
    # Merge updates
    updated_constraint = {**existing_constraint, **updates}
    
    return updated_constraint


# ===========================
# Request/Response Models
# ===========================

class BatchSceneUpdateRequest(BaseModel):
    """Request body for batch scene update."""
    
    conversation_id: str = Field(
        description="Conversation ID from /init_sim"
    )
    
    body_updates: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description="Body updates {body_id: {position_m, mass_kg, material, ...}}"
    )
    
    constraint_updates: dict[str, dict[str, Any]] = Field(
        default_factory=dict,
        description="Constraint updates {constraint_id: {length_m, stiffness, ...}}"
    )
    
    resimulate: bool = Field(
        default=False,
        description="Whether to run Matter.js simulation after update"
    )
    
    simulation_config: dict[str, Any] = Field(
        default_factory=dict,
        description="Simulation options (duration_s, frame_rate) if resimulate=true"
    )


class BatchSceneUpdateResponse(BaseModel):
    """Response from batch scene update."""
    
    status: str = Field(
        description="Status: 'updated', 'failed'"
    )
    
    conversation_id: str = Field(
        description="Conversation ID"
    )
    
    updated_bodies: list[str] = Field(
        description="List of updated body IDs"
    )
    
    updated_constraints: list[str] = Field(
        description="List of updated constraint IDs"
    )
    
    scene: dict[str, Any] = Field(
        description="Updated scene snapshot"
    )
    
    frames: Optional[list[dict[str, Any]]] = Field(
        default=None,
        description="Simulation frames (if resimulate=true)"
    )
    
    meta: dict[str, Any] = Field(
        default_factory=dict,
        description="Metadata (warnings, validation_notes, etc.)"
    )


# ===========================
# Endpoint
# ===========================

@router.post("/batch_update", response_model=BatchSceneUpdateResponse)
async def batch_update_scene(request: BatchSceneUpdateRequest):
    """
    Batch update scene bodies and constraints.
    
    Workflow:
    1. Load conversation context
    2. Validate and merge body updates
    3. Validate and merge constraint updates
    4. Apply updates to scene_state
    5. Record snapshot to scene_history
    6. Optional: Run Matter.js simulation
    
    Use Cases:
    - Interactive Mode: Drag & drop body position updates
    - Parameters Panel: Mass, friction, restitution updates
    - Constraint editing: Rope length, spring stiffness updates
    
    Example:
        POST /simulation/batch_update
        {
          "conversation_id": "abc123",
          "body_updates": {
            "massA": {"position_m": [0, 1.5], "mass_kg": 2.0},
            "massB": {"position_m": [0, -1.0]}
          },
          "resimulate": false
        }
    
    Returns:
        BatchSceneUpdateResponse with updated scene and optional frames
    """
    context_store = get_context_store()
    
    # ===========================
    # Step 1: Get Context
    # ===========================
    context = context_store.get_context(request.conversation_id)
    if not context:
        raise HTTPException(
            status_code=404,
            detail=f"Conversation {request.conversation_id} not found"
        )
    
    # Ensure scene_state is initialized
    _ensure_scene_initialized(context)
    
    logger.info(
        f"[batch_update] Processing updates for conversation {request.conversation_id}: "
        f"{len(request.body_updates)} bodies, {len(request.constraint_updates)} constraints"
    )
    
    try:
        # ===========================
        # Step 2: Validate and Merge Body Updates
        # ===========================
        updated_bodies: dict[str, dict[str, Any]] = {}
        validation_warnings: list[str] = []
        
        for body_id, updates in request.body_updates.items():
            try:
                updated_body = _validate_and_merge_body_update(context, body_id, updates)
                updated_bodies[body_id] = updated_body
                logger.debug(f"[batch_update] Updated body {body_id}: {list(updates.keys())}")
            except HTTPException as e:
                raise e
            except Exception as e:
                logger.error(f"[batch_update] Failed to update body {body_id}: {e}", exc_info=True)
                validation_warnings.append(f"Body {body_id}: {str(e)}")
        
        # ===========================
        # Step 3: Validate and Merge Constraint Updates
        # ===========================
        updated_constraints: dict[str, dict[str, Any]] = {}
        
        for constraint_id, updates in request.constraint_updates.items():
            try:
                updated_constraint = _validate_and_merge_constraint_update(
                    context, constraint_id, updates
                )
                updated_constraints[constraint_id] = updated_constraint
                logger.debug(f"[batch_update] Updated constraint {constraint_id}: {list(updates.keys())}")
            except HTTPException as e:
                raise e
            except Exception as e:
                logger.error(f"[batch_update] Failed to update constraint {constraint_id}: {e}", exc_info=True)
                validation_warnings.append(f"Constraint {constraint_id}: {str(e)}")
        
        # ===========================
        # Step 4: Apply Updates to Context
        # ===========================
        context.apply_scene_updates(
            bodies=updated_bodies if updated_bodies else None,
            constraints=updated_constraints if updated_constraints else None
        )
        
        # ===========================
        # Step 5: Record Snapshot
        # ===========================
        note = f"batch_update: {len(updated_bodies)} bodies, {len(updated_constraints)} constraints"
        if request.resimulate:
            note += " (resimulated)"
        
        scene = context.record_scene_snapshot(note=note)
        
        logger.info(
            f"[batch_update] ✅ Scene updated: {len(updated_bodies)} bodies, "
            f"{len(updated_constraints)} constraints"
        )
        
        # ===========================
        # Step 6: Optional Resimulation
        # ===========================
        frames = None
        simulation_meta = {}
        
        if request.resimulate:
            logger.info("[batch_update] Running Matter.js simulation after update")
            
            duration_s = request.simulation_config.get("duration_s", 5.0)
            frame_rate = request.simulation_config.get("frame_rate", 60)
            
            try:
                sim_result = await simulate_physics(SimulatePhysicsInput(
                    scene=scene,
                    duration_s=duration_s,
                    frame_rate=frame_rate
                ))
                
                frames = [frame.dict() for frame in sim_result.frames]
                simulation_meta = sim_result.meta
                
                # Update context with new frames
                context.update_pipeline_state(frames=frames)
                
                logger.info(f"[batch_update] ✅ Simulation complete: {len(frames)} frames")
                
            except Exception as e:
                logger.error(f"[batch_update] Simulation failed: {e}", exc_info=True)
                validation_warnings.append(f"Simulation error: {str(e)}")
        
        # ===========================
        # Step 7: Save Context
        # ===========================
        context_store.update_context(context)
        
        # ===========================
        # Success Response
        # ===========================
        return BatchSceneUpdateResponse(
            status="updated",
            conversation_id=request.conversation_id,
            updated_bodies=list(updated_bodies.keys()),
            updated_constraints=list(updated_constraints.keys()),
            scene=scene,
            frames=frames,
            meta={
                "warnings": validation_warnings,
                "scene_history_length": len(context.scene_history),
                "simulation": simulation_meta if request.resimulate else None
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[batch_update] Update failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Scene update error: {str(e)}"
        )
