"""
Tool 2: label_segments - GPT Vision Entity Recognition

Identifies physics entities and estimates properties from segments.
Standalone implementation (v0.4) - no dependency on legacy labeler.py.
"""

from typing import Any
import json

from pydantic import BaseModel, Field

from app.models.settings import settings


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
        default="v0.4",
        description="Label schema version"
    )
    entities: list[Entity]
    confidence: dict[str, Any] = Field(
        default_factory=dict,
        description="Overall confidence metrics"
    )


def _label_with_stub(segments: list[dict[str, Any]]) -> list[Entity]:
    """
    Geometry-based heuristic labeler (stub implementation).
    
    Rules:
    - Thinnest segment → surface
    - Most square in top half → pulley
    - Remaining segments sorted by x → masses (left to right)
    """
    if not segments:
        return []
    
    # Sort by area (largest first)
    sorted_segs = sorted(
        segments, 
        key=lambda s: s.get("bbox", [0, 0, 0, 0])[2] * s.get("bbox", [0, 0, 0, 0])[3],
        reverse=True
    )
    
    entities = []
    used_ids = set()
    
    # Find surface (thinnest by height)
    surface = min(segments, key=lambda s: s.get("bbox", [0, 0, 0, 1])[3])
    entities.append(Entity(
        segment_id=str(surface.get("id")),
        type="surface",
        props=EntityProps(mu_k=0.5),
        confidence=0.6
    ))
    used_ids.add(surface.get("id"))
    
    # Find pulley (most square in top half)
    img_h = max(
        (s.get("bbox", [0, 0, 0, 0])[1] + s.get("bbox", [0, 0, 0, 0])[3] 
         for s in segments),
        default=600
    )
    
    best_pulley = None
    best_squareness = float('inf')
    
    for seg in segments:
        if seg.get("id") in used_ids:
            continue
        bbox = seg.get("bbox", [0, 0, 0, 0])
        x, y, w, h = bbox
        
        # Skip if in bottom half
        if y > img_h * 0.55:
            continue
        
        # Calculate squareness (closer to 1.0 is more square)
        if h > 0:
            squareness = abs(1 - (w / h))
            if squareness < best_squareness:
                best_squareness = squareness
                best_pulley = seg
    
    if best_pulley:
        entities.append(Entity(
            segment_id=str(best_pulley.get("id")),
            type="pulley",
            props=EntityProps(wheel_radius_m=0.1),
            confidence=0.6
        ))
        used_ids.add(best_pulley.get("id"))
    
    # Remaining segments → masses (sort left to right)
    remaining = [s for s in sorted_segs if s.get("id") not in used_ids]
    remaining_sorted = sorted(remaining, key=lambda s: s.get("bbox", [0, 0, 0, 0])[0])
    
    for idx, seg in enumerate(remaining_sorted):
        # Estimate mass from bbox area
        bbox = seg.get("bbox", [0, 0, 100, 100])
        area = bbox[2] * bbox[3]
        base_area = 2500  # 50x50 pixels
        mass_kg = 3.0 * (area / base_area)
        
        entities.append(Entity(
            segment_id=str(seg.get("id")),
            type="mass",
            props=EntityProps(mass_guess_kg=round(mass_kg, 1)),
            confidence=0.6
        ))
    
    return entities


async def _label_with_openai(
    segments: list[dict[str, Any]], 
    context: str
) -> list[Entity]:
    """
    Label segments using GPT-5 Vision API.
    
    Uses YAML prompts for system/user instructions.
    Falls back to stub labeler on API errors.
    """
    from app.agent.prompts import get_labeler_system_prompt, get_labeler_user_prompt
    
    # Prepare segments for GPT
    segments_compact = [
        {"id": str(seg.get("id")), "bbox": seg.get("bbox", [0, 0, 0, 0])}
        for seg in segments
    ]
    segments_json = json.dumps(segments_compact, indent=2)
    
    # Load prompts from YAML
    system_prompt = get_labeler_system_prompt()
    user_prompt = get_labeler_user_prompt(segments_json)
    
    if context:
        user_prompt += f"\n\nAdditional context: {context}"
    
    # Prepare input for GPT-5 Responses API
    input_payload = {
        "instruction": system_prompt,
        "user_request": user_prompt,
        "segments": segments_compact,
    }
    
    try:
        # Call GPT-5 Responses API
        from openai import OpenAI
        
        client = OpenAI(api_key=settings.OPENAI_API_KEY)
        
        resp = client.responses.create(
            model=settings.LABELER_MODEL,
            input=json.dumps(input_payload),
            reasoning={"effort": "minimal"},
            text={"verbosity": "low"},
        )
        
        # Extract output text
        content = getattr(resp, "output_text", None)
        if not content:
            try:
                content = resp.output[0].content[0].text
            except Exception:
                content = "{}"
        
    except Exception as e:
        print(f"[label_segments] GPT-5 API failed: {e}, using stub fallback")
        return _label_with_stub(segments)
    
    # Clean JSON response (remove markdown code fences)
    def _clean_json(text: str) -> str:
        text = text.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json\n"):
                text = text[5:]
        return text.strip()
    
    content = _clean_json(content)
    
    # Parse JSON response
    try:
        data = json.loads(content)
        raw_entities = data.get("entities") or data.get("labels") or []
    except Exception as e:
        print(f"[label_segments] JSON parse failed: {e}, using stub fallback")
        return _label_with_stub(segments)
    
    # Convert to Entity objects
    entities = []
    segments_by_id = {str(seg.get("id")): seg for seg in segments}
    
    for raw in raw_entities:
        seg_id = str(raw.get("id") or raw.get("segment_id"))
        label = raw.get("label", "mass")
        props_dict = raw.get("props", {})
        
        # Skip if segment not found
        if seg_id not in segments_by_id:
            continue
        
        entities.append(Entity(
            segment_id=seg_id,
            type=label if label != "unknown" else "mass",
            props=EntityProps(
                mass_guess_kg=props_dict.get("mass_guess_kg"),
                wheel_radius_m=props_dict.get("wheel_radius_m"),
                mu_k=props_dict.get("friction_k") or props_dict.get("mu_k"),
                material=props_dict.get("material"),
            ),
            confidence=0.7
        ))
    
    # If no entities parsed, fallback to stub
    if not entities:
        print("[label_segments] No entities from GPT-5, using stub fallback")
        return _label_with_stub(segments)
    
    return entities


async def label_segments(input_data: LabelSegmentsInput) -> LabelSegmentsOutput:
    """
    Identify physics entities from segmented image regions.
    
    Uses GPT-5 Vision API (if configured) or geometry-based stub fallback.
    Standalone implementation - no dependency on legacy labeler.py.
    
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
    # Determine labeling mode
    use_openai = (
        input_data.use_vision 
        and settings.LABELER_MODE == "openai" 
        and settings.OPENAI_API_KEY
    )
    
    if use_openai:
        # Use GPT-5 Vision API
        entities = await _label_with_openai(input_data.segments, input_data.context)
        method = "openai"
    else:
        # Use geometry-based stub
        entities = _label_with_stub(input_data.segments)
        method = "stub"
    
    # Calculate overall confidence
    if entities:
        avg_conf = sum(e.confidence or 0.5 for e in entities) / len(entities)
    else:
        avg_conf = 0.0
    
    return LabelSegmentsOutput(
        version="v0.4",
        entities=entities,
        confidence={
            "overall": round(avg_conf, 2),
            "per_entity": [e.confidence or 0.5 for e in entities],
            "method": method,
        },
    )
