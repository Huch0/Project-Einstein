"""
Router: /init_sim - Automated Initialization Pipeline (v0.5)

Executes sequential initialization workflow without GPT-5 Agent:
1. segment_image: SAM segmentation
2. label_segments: GPT-5 Vision entity recognition
3. validate_entities: Consistency checks
4. build_physics_scene: Universal Builder scene construction

Returns initialized scene ready for simulation.
"""

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.agent.agent_context import get_context_store, ConversationContext
from app.agent.tools.segment_image import segment_image, SegmentImageInput
from app.agent.tools.label_segments import label_segments, LabelSegmentsInput
from app.agent.tools.validate_entities import validate_scene_entities, ValidateEntitiesInput
from app.agent.tools.build_scene import build_physics_scene, BuildSceneInput

logger = logging.getLogger("init_sim")

router = APIRouter(prefix="/init_sim", tags=["initialization"])


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
    """
    Execute sequential initialization pipeline.
    
    Pipeline:
    1. segment_image(image_id) → segments
    2. label_segments(image_id, segments) → entities
    3. validate_entities(entities) → validation
    4. build_physics_scene(segments, entities) → scene
    
    Returns:
        InitSimResponse with initialized scene ready for simulation
    """
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
        # ===========================
        # Step 1: Segment Image
        # ===========================
        logger.info(f"[init_sim] Step 1/4: Segmenting image {request.image_id}")
        
        segment_result = await segment_image(SegmentImageInput(
            image_data=request.image_id,
            mode="polygon",
            sam_server_url="http://localhost:9001/segment"
        ))
        
        segments = [seg.dict() for seg in segment_result.segments]
        image_metadata = segment_result.image.dict()
        
        logger.info(f"[init_sim] ✅ Segmentation complete: {len(segments)} segments found")
        
        # Update context
        context.update_pipeline_state(
            image_id=request.image_id,
            image_metadata=image_metadata,
            segments=segments
        )
        context_store.update_context(context)
        
        if not segments:
            return InitSimResponse(
                status="failed",
                conversation_id=context.conversation_id,
                image_id=request.image_id,
                initialization={
                    "segments_count": 0,
                    "entities_count": 0,
                    "scene": None,
                    "warnings": [],
                    "errors": ["No segments found in image"]
                },
                ready_for_simulation=False
            )
        
        # ===========================
        # Step 2: Label Segments
        # ===========================
        logger.info(f"[init_sim] Step 2/4: Labeling {len(segments)} segments")
        
        label_result = await label_segments(LabelSegmentsInput(
            image_id=request.image_id,
            segments=segments,
            context=request.options.get("context", ""),
            use_vision=True
        ))
        
        entities = [entity.dict() for entity in label_result.entities]
        
        logger.info(f"[init_sim] ✅ Labeling complete: {len(entities)} entities identified")
        
        # Update context
        context.update_pipeline_state(entities=entities)
        context_store.update_context(context)
        
        if not entities:
            return InitSimResponse(
                status="failed",
                conversation_id=context.conversation_id,
                image_id=request.image_id,
                initialization={
                    "segments_count": len(segments),
                    "entities_count": 0,
                    "scene": None,
                    "warnings": [],
                    "errors": ["No entities could be labeled from segments"]
                },
                ready_for_simulation=False
            )
        
        # ===========================
        # Step 3: Validate Entities
        # ===========================
        auto_validate = request.options.get("auto_validate", True)
        validation = {"valid": True, "warnings": [], "errors": []}
        
        if auto_validate:
            logger.info(f"[init_sim] Step 3/4: Validating {len(entities)} entities")
            
            # Call validate_scene_entities tool
            validate_result = await validate_scene_entities(ValidateEntitiesInput(
                entities=entities,
                allow_incomplete=True
            ))
            
            # Convert tool output to validation dict
            validation = {
                "valid": validate_result.valid,
                "warnings": validate_result.warnings,
                "errors": [] if validate_result.valid else ["Validation failed"]
            }
            
            # Log entity summary
            logger.info(f"[init_sim] Entity summary: {validate_result.entity_summary}")
            if validate_result.suggestions:
                for suggestion in validate_result.suggestions:
                    logger.info(f"[init_sim] 💡 {suggestion}")
            
            if not validation["valid"]:
                logger.error(f"[init_sim] ❌ Validation failed: {validation['errors']}")
                return InitSimResponse(
                    status="failed",
                    conversation_id=context.conversation_id,
                    image_id=request.image_id,
                    initialization={
                        "segments_count": len(segments),
                        "entities_count": len(entities),
                        "entities": entities,
                        "scene": None,
                        "warnings": validation["warnings"],
                        "errors": validation["errors"]
                    },
                    ready_for_simulation=False
                )
            
            if validation["warnings"]:
                logger.warning(f"[init_sim] ⚠️ Validation warnings: {validation['warnings']}")
        else:
            logger.info(f"[init_sim] Step 3/4: Skipping validation (auto_validate=False)")
        
        # ===========================
        # Step 4: Build Scene
        # ===========================
        logger.info(f"[init_sim] Step 4/4: Building physics scene")
        
        build_result = await build_physics_scene(BuildSceneInput(
            image=image_metadata,
            segments=segments,
            entities=entities,
            mapping={
                "origin_mode": "anchor_centered",
                "scale_m_per_px": 0.01
            },
            defaults={
                "gravity_m_s2": 9.81,
                "time_step_s": 0.016
            }
        ))
        
        scene = build_result.scene
        build_warnings = build_result.warnings
        
        logger.info(f"[init_sim] ✅ Scene built: {len(scene.get('bodies', []))} bodies, {len(scene.get('constraints', []))} constraints")
        if build_warnings:
            logger.warning(f"[init_sim] Build warnings: {build_warnings}")
        
        # Combine validation and build warnings
        all_warnings = validation["warnings"] + build_warnings
        
        # Update context
        context.update_pipeline_state(scene=scene)
        context_store.update_context(context)
        
        # ===========================
        # Success Response
        # ===========================
        return InitSimResponse(
            status="initialized",
            conversation_id=context.conversation_id,
            image_id=request.image_id,
            initialization={
                "segments_count": len(segments),
                "entities_count": len(entities),
                "entities": entities,
                "scene": scene,
                "warnings": all_warnings,
                "errors": []
            },
            ready_for_simulation=True
        )
        
    except HTTPException:
        raise
    except Exception as e:
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
    has_segments = bool(context.segments)
    has_entities = bool(context.entities)
    has_scene = bool(context.scene)
    
    if has_scene:
        status = "initialized"
        current_step = "complete"
    elif has_entities:
        status = "in_progress"
        current_step = "build"
    elif has_segments:
        status = "in_progress"
        current_step = "label"
    else:
        status = "in_progress"
        current_step = "segment"
    
    return InitSimStatusResponse(
        conversation_id=conversation_id,
        status=status,
        current_step=current_step,
        progress={
            "segments_count": len(context.segments),
            "entities_count": len(context.entities),
            "has_scene": has_scene
        }
    )
