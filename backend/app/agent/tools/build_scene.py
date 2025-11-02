"""
Tool 4: build_physics_scene - Scene JSON Construction (v0.4)

Converts entities + geometry → simulator-ready Scene JSON using Universal Builder.
"""

from typing import Any

from pydantic import BaseModel, Field

from app.sim.universal_builder import build_scene_universal
from app.sim.schema import Scene


class BuildSceneInput(BaseModel):
    """Input schema for build_physics_scene tool."""
    
    image: dict[str, Any] = Field(
        description="Image metadata with width_px, height_px"
    )
    segments: list[dict[str, Any]] = Field(
        description="Segment data from segment_image tool"
    )
    entities: list[dict[str, Any]] = Field(
        description="Entity labels from label_segments tool"
    )
    mapping: dict[str, Any] = Field(
        default_factory=lambda: {
            "origin_mode": "anchor_centered",
            "scale_m_per_px": 0.01
        },
        description="Coordinate mapping configuration"
    )
    defaults: dict[str, Any] = Field(
        default_factory=lambda: {
            "gravity_m_s2": 9.81,
            "time_step_s": 0.016
        },
        description="Default physics parameters"
    )


class BuildSceneOutput(BaseModel):
    """Output schema for build_physics_scene tool."""
    
    scene: dict[str, Any] = Field(
        description="Complete Scene JSON ready for simulator"
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-blocking build warnings"
    )
    meta: dict[str, Any] = Field(
        default_factory=dict,
        description="Build metadata (resolver, builder version, etc.)"
    )


async def build_physics_scene(input_data: BuildSceneInput) -> BuildSceneOutput:
    """
    Build simulator-ready Scene JSON from entities and geometry.
    
    Uses the Universal Builder (v0.4) - no scene-kind restrictions.
    
    Args:
        input_data: Segments, entities, and mapping configuration
        
    Returns:
        Scene JSON with bodies, constraints, and warnings
        
    Example:
        >>> result = await build_physics_scene(BuildSceneInput(
        ...     image={"width_px": 800, "height_px": 600},
        ...     segments=[...],
        ...     entities=[...]
        ... ))
        >>> assert "bodies" in result.scene
    """
    # Convert to dict format for universal builder
    request_dict = {
        "image": input_data.image,
        "segments": input_data.segments,
        "labels": {"version": "v0.4", "entities": input_data.entities},
        "mapping": input_data.mapping,
        "defaults": input_data.defaults
    }
    
    # Call universal builder (v0.4)
    response = build_scene_universal(request_dict)
    
    # Extract scene, warnings, and meta from response
    scene_dict = response.get("scene", {})
    warnings = response.get("warnings", [])
    meta = response.get("meta", {})
    
    return BuildSceneOutput(
        scene=scene_dict,
        warnings=warnings,
        meta=meta
    )
