"""
Router: /init_sim - Agent Scene Initialization (v0.6)

Builds a physics scene directly from an uploaded diagram using the agent-based builder.
Returns initialized scene ready for simulation.
"""

import io
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.agent.agent_context import get_context_store
from app.agent.tools.build_scene import (
    BuildSceneInput,
    build_physics_scene,
    _render_scene_image,
)
from app.routers.diagram import get_uploaded_image_bytes
from app.logging_utils import get_logger

logger = get_logger("init_sim")

router = APIRouter(prefix="/init_sim", tags=["initialization"])

def _save_scene_visualization(
    scene: dict,
    image_metadata: dict,
    conversation_id: str,
    log_timestamp: Optional[str] = None,
) -> None:
    try:
        _, output_path = _render_scene_image(
            scene,
            image_metadata,
            label=f"conversation-{conversation_id}",
            log_timestamp=log_timestamp,
        )
        if output_path:
            logger.info("Scene debug saved to %s", output_path)
    except Exception as exc:  # pragma: no cover - diagnostics best-effort only
        logger.warning("Failed to save scene visualization: %s", exc, exc_info=False)


def _load_image_metadata(image_id: str) -> dict[str, Any]:
    """Load image metadata for the uploaded diagram."""

    try:
        image_bytes = get_uploaded_image_bytes(image_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - environment misconfiguration
        raise HTTPException(status_code=500, detail="Pillow is required for initialization") from exc

    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
            width, height = img.size
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image data for {image_id}: {exc}") from exc

    return {
        "width_px": int(width),
        "height_px": int(height),
        "image_id": image_id,
    }


def _scene_entities(scene: dict) -> list[dict[str, Any]]:
    """Translate scene bodies and constraints into entity summaries."""

    entities: list[dict[str, Any]] = []

    for body in scene.get("bodies", []):
        body_id = body.get("id")
        if not body_id:
            continue

        props = {
            "mass_kg": body.get("mass_kg"),
            "position_m": body.get("position_m"),
            "velocity_m_s": body.get("velocity_m_s"),
            "collider": body.get("collider"),
            "material": body.get("material"),
            "notes": body.get("notes"),
        }

        entities.append({
            "segment_id": str(body_id),
            "type": body.get("type", "body"),
            "props": {k: v for k, v in props.items() if v is not None},
        })

    for constraint in scene.get("constraints", []):
        constraint_id = constraint.get("id")
        if not constraint_id:
            continue

        props = {
            "body_a": constraint.get("body_a"),
            "body_b": constraint.get("body_b"),
            "anchor_m": constraint.get("anchor_m"),
            "rope_length_m": constraint.get("rope_length_m"),
            "notes": constraint.get("notes"),
        }

        entities.append({
            "segment_id": f"constraint::{constraint_id}",
            "type": constraint.get("type", "constraint"),
            "props": {k: v for k, v in props.items() if v is not None},
        })

    return entities


# ===========================
# Request/Response Models
# ===========================

class InitSimRequest(BaseModel):
    """Request body for /init_sim endpoint."""
    
    image_id: str = Field(
        description="Uploaded image identifier from /diagram/upload"
    )
    conversation_id: Optional[str] = Field(
        default=None,
        description="Existing conversation ID (optional, will create new if not provided)"
    )
    options: dict = Field(
        default_factory=dict,
        description="Optional configuration (auto_validate, scale_m_per_px, etc.)"
    )


class InitSimResponse(BaseModel):
    """Response from /init_sim endpoint."""
    
    status: str = Field(
        description="Status: 'initialized', 'failed', 'in_progress'"
    )
    conversation_id: str = Field(
        description="Conversation ID for this initialization session"
    )
    image_id: str = Field(
        description="Image ID that was processed"
    )
    initialization: dict = Field(
        description="Initialization results (segments_count, entities_count, scene, warnings, errors)"
    )
    ready_for_simulation: bool = Field(
        description="Whether scene is ready for /run_sim"
    )


class InitSimStatusResponse(BaseModel):
    """Response from /init_sim/status/{conversation_id}."""
    
    conversation_id: str
    status: str = Field(
        description="Status: 'in_progress', 'initialized', 'failed'"
    )
    current_step: Optional[str] = Field(
        default=None,
        description="Current step: 'segment', 'label', 'validate', 'build'"
    )
    progress: dict = Field(
        description="Progress details (segments_count, entities_count, has_scene)"
    )


# ===========================
# Validation Helper (REMOVED - using tool directly)
# ===========================
# validate_scene_entities tool is now called directly in the pipeline


# ===========================
# Scene Builder Helper (REMOVED - using tool directly)
# ===========================
# build_physics_scene tool is now called directly in the pipeline


# ===========================
# Endpoints
# ===========================

@router.post("", response_model=InitSimResponse)
async def initialize_simulation(request: InitSimRequest):
    """Generate a physics scene directly from the uploaded diagram image."""
    context_store = get_context_store()
    
    # Get or create context
    if request.conversation_id:
        context = context_store.get_context(request.conversation_id)
        if not context:
            raise HTTPException(
                status_code=404,
                detail=f"Conversation {request.conversation_id} not found"
            )

        logger.info(f"[init_sim] Using existing conversation: {request.conversation_id}")
    else:
        context = context_store.create_context()
        logger.info(f"[init_sim] Created new conversation: {context.conversation_id}")
    
    try:
        image_metadata = _load_image_metadata(request.image_id)
        context.update_pipeline_state(
            image_id=request.image_id,
            image_metadata=image_metadata,
            segments=[],
            detections=[],
            entities=[],
            entity_summary={},
            scene=None,
        )
        context_store.update_context(context)

        logger.info(f"[init_sim] Building scene for image {request.image_id}")

        builder_options = dict(request.options or {})
        default_scale = float(builder_options.get("scale_m_per_px", 0.01))
        builder_options.setdefault("scale_m_per_px", default_scale)
        builder_options.setdefault("mapping", {
            "origin_mode": "image_center",
            "scale_m_per_px": default_scale,
        })
        builder_options.setdefault("refinement_rounds", 1)

        build_result = await build_physics_scene(BuildSceneInput(
            conversation_id=context.conversation_id,
            image=image_metadata,
            image_id=request.image_id,
            options=builder_options,
        ))

        scene = build_result.scene
        detections = build_result.detections or []
        warnings = build_result.warnings or []

        logger.info(
            "[init_sim] ✅ Scene built: %s bodies, %s constraints",
            len(scene.get("bodies", [])),
            len(scene.get("constraints", [])),
        )
        if warnings:
            logger.warning("[init_sim] ⚠️ Builder warnings: %s", warnings)

        entities = _scene_entities(scene)
        entity_summary: dict[str, int] = {}
        for entity in entities:
            entity_type = entity.get("type", "entity")
            entity_summary[entity_type] = entity_summary.get(entity_type, 0) + 1

        context.update_pipeline_state(
            detections=detections,
            entities=entities,
            entity_summary=entity_summary,
            scene=scene,
            mapping=scene.get("mapping"),
        )
        context_store.update_context(context)

        scene_log_timestamp = build_result.meta.get("scene_log_timestamp") if build_result.meta else None
        _save_scene_visualization(
            scene,
            image_metadata,
            context.conversation_id,
            log_timestamp=scene_log_timestamp,
        )

        mapping = scene.get("mapping") or builder_options.get("mapping") or {
            "origin_mode": "image_center",
            "scale_m_per_px": default_scale,
        }

        return InitSimResponse(
            status="initialized",
            conversation_id=context.conversation_id,
            image_id=request.image_id,
            initialization={
                "segments_count": len(detections),
                "entities_count": len(entities),
                "entities": entities,
                "scene": scene,
                "scene_meta": build_result.meta,
                "segments": detections,
                "detections": detections,
                "image": image_metadata,
                "mapping": mapping,
                "entity_summary": entity_summary,
                "warnings": warnings,
                "errors": [],
            },
            ready_for_simulation=True,
        )

    except HTTPException:
        raise
    except Exception as e:  # pragma: no cover - unexpected failures bubbled as HTTP 500
        logger.error(f"[init_sim] Initialization failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Initialization error: {str(e)}"
        )


@router.get("/status/{conversation_id}", response_model=InitSimStatusResponse)
async def get_initialization_status(conversation_id: str):
    """
    Check initialization progress for a conversation.
    
    Useful for long-running operations or async workflows.
    """
    context_store = get_context_store()
    context = context_store.get_context(conversation_id)
    
    if not context:
        raise HTTPException(
            status_code=404,
            detail=f"Conversation {conversation_id} not found"
        )
    
    # Determine current status
    has_detections = bool(context.detections)
    has_entities = bool(context.entities)
    has_scene = bool(context.scene)
    
    if has_scene:
        status = "initialized"
        current_step = "complete"
    elif has_entities or has_detections:
        status = "in_progress"
        current_step = "build"
    else:
        status = "in_progress"
        current_step = "pending"
    
    return InitSimStatusResponse(
        conversation_id=conversation_id,
        status=status,
        current_step=current_step,
        progress={
            "segments_count": len(context.detections),
            "detections_count": len(context.detections),
            "entities_count": len(context.entities),
            "has_scene": has_scene
        }
    )
