"""
Tool 2: label_segments - GPT Vision Entity Recognition

Identifies physics entities and estimates properties from segments.
"""

from typing import Any

from pydantic import BaseModel, Field

from app.agent.labeler import OpenAILabeler


class LabelSegmentsInput(BaseModel):
    """Input schema for label_segments tool."""
    
    image_id: str = Field(
        description="Unique identifier for the source image"
    )
    segments: list[dict[str, Any]] = Field(
        description="Segment data from segment_image tool"
    )
    context: str = Field(
        default="",
        description="Additional context about the diagram (e.g., 'pulley system with friction')"
    )
    use_vision: bool = Field(
        default=True,
        description="Whether to use GPT Vision API (True) or stub labeler (False)"
    )


class EntityProps(BaseModel):
    """Physical properties for an entity."""
    
    mass_guess_kg: float | None = Field(
        default=None,
        description="Estimated mass in kilograms"
    )
    wheel_radius_m: float | None = Field(
        default=None,
        description="Pulley wheel radius in meters"
    )
    mu_k: float | None = Field(
        default=None,
        description="Coefficient of kinetic friction"
    )
    material: str | None = Field(
        default=None,
        description="Material type (wood, metal, etc.)"
    )


class Entity(BaseModel):
    """Single labeled entity."""
    
    segment_id: str = Field(
        description="ID of the segment this entity corresponds to"
    )
    type: str = Field(
        description="Entity type: mass, pulley, surface, ramp, spring, pendulum_pivot, anchor"
    )
    props: EntityProps = Field(
        default_factory=EntityProps,
        description="Physical properties specific to entity type"
    )
    confidence: float | None = Field(
        default=None,
        description="Confidence score 0-1 from Vision API"
    )


class LabelSegmentsOutput(BaseModel):
    """Output schema for label_segments tool."""
    
    version: str = Field(
        default="v0.2",
        description="Label schema version"
    )
    entities: list[Entity]
    confidence: dict[str, Any] = Field(
        default_factory=dict,
        description="Overall confidence metrics"
    )


async def label_segments(input_data: LabelSegmentsInput) -> LabelSegmentsOutput:
    """
    Identify physics entities from segmented image regions.
    
    Args:
        input_data: Segments and context for labeling
        
    Returns:
        Labeled entities with type and physical properties
        
    Example:
        >>> result = await label_segments(LabelSegmentsInput(
        ...     image_id="abc123",
        ...     segments=[{"id": 1, "bbox": [10, 20, 30, 40]}],
        ...     context="simple pulley system"
        ... ))
        >>> print(f"Found {len(result.entities)} entities")
    """
    from app.agent.labeler import SegmentIn, get_labeler
    
    # Convert tool schema segments → labeler schema
    segments_in = [
        SegmentIn(
            id=seg.get("id", idx),
            bbox=seg.get("bbox", [0, 0, 0, 0]),
            mask_path=seg.get("mask_path"),
        )
        for idx, seg in enumerate(input_data.segments, start=1)
    ]
    
    # Get configured labeler (openai or stub)
    labeler = get_labeler()
    
    # Label segments
    labeled = labeler.label(segments_in)
    
    # Convert labeler output → tool output schema
    entities = []
    for ent in labeled:
        props_dict = ent.props or {}
        entities.append(Entity(
            segment_id=str(ent.id),
            type=ent.label if ent.label != "unknown" else "mass",  # fallback
            props=EntityProps(
                mass_guess_kg=props_dict.get("mass_guess_kg"),
                wheel_radius_m=props_dict.get("wheel_radius_m"),
                mu_k=props_dict.get("friction_k") or props_dict.get("mu_k"),
                material=props_dict.get("material"),
            ),
            confidence=ent.confidence,
        ))
    
    # Calculate overall confidence
    if entities:
        avg_conf = sum(e.confidence or 0.5 for e in entities) / len(entities)
    else:
        avg_conf = 0.0
    
    return LabelSegmentsOutput(
        version="v0.2",
        entities=entities,
        confidence={
            "overall": round(avg_conf, 2),
            "per_entity": [e.confidence or 0.5 for e in entities],
            "method": "openai" if labeler.__class__.__name__ == "OpenAILabeler" else "stub",
        },
    )
