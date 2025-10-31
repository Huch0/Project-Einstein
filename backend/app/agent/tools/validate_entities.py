"""
Tool 3: validate_scene_entities - Entity Set Validation (v0.4)

Checks if entity set is sufficient for scene building.
In v0.4, no rigid scene_kind required - universal builder handles any combination.
"""

from collections import Counter
from typing import Any

from pydantic import BaseModel, Field


class ValidateEntitiesInput(BaseModel):
    """Input schema for validate_scene_entities tool."""
    
    entities: list[dict[str, Any]] = Field(
        description="Entity list from label_segments tool"
    )
    allow_incomplete: bool = Field(
        default=True,  # v0.4: more permissive
        description="Allow incomplete entity sets (for iterative building)"
    )


class ValidateEntitiesOutput(BaseModel):
    """Output schema for validate_scene_entities tool."""
    
    valid: bool = Field(
        description="Whether entity set can build a physics scene"
    )
    entity_summary: dict[str, int] = Field(
        default_factory=dict,
        description="Count of each entity type detected"
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-blocking validation warnings"
    )
    suggestions: list[str] = Field(
        default_factory=list,
        description="Suggestions to improve scene"
    )


async def validate_scene_entities(
    input_data: ValidateEntitiesInput
) -> ValidateEntitiesOutput:
    """
    Validate entity set for universal builder (v0.4).
    
    v0.4 Philosophy:
    - Any entity combination is potentially valid
    - No rigid scene-kind classification
    - Universal builder handles composition dynamically
    
    Validation rules:
    - At least 1 dynamic body (mass) required
    - Constraints inferred from entity relationships
    - Suggestions based on common patterns
    
    Args:
        input_data: Entity list to validate
        
    Returns:
        Validation result with entity summary and suggestions
        
    Example:
        >>> result = await validate_scene_entities(ValidateEntitiesInput(
        ...     entities=[
        ...         {"type": "mass", "segment_id": "1"},
        ...         {"type": "mass", "segment_id": "2"},
        ...         {"type": "pulley", "segment_id": "3"}
        ...     ]
        ... ))
        >>> assert result.valid == True
        >>> assert result.entity_summary["mass"] == 2
    """
    # Count entity types
    type_counts = Counter(e.get("type") for e in input_data.entities)
    
    warnings = []
    suggestions = []
    valid = False
    
    # v0.4: Minimal validation - just need at least 1 entity
    mass_count = type_counts.get("mass", 0)
    pulley_count = type_counts.get("pulley", 0)
    ramp_count = type_counts.get("ramp", 0)
    spring_count = type_counts.get("spring", 0)
    surface_count = type_counts.get("surface", 0)
    
    # Validation: need at least 1 dynamic body
    if mass_count > 0:
        valid = True
    else:
        warnings.append("No masses detected - need at least 1 dynamic body")
        if input_data.allow_incomplete:
            valid = True  # Allow for iterative building
    
    # Provide helpful suggestions based on entity combination
    if mass_count >= 2 and pulley_count > 0:
        suggestions.append(
            f"Detected {mass_count} masses + {pulley_count} pulley(s) - "
            "universal builder will create pulley system with rope constraints"
        )
    
    if mass_count >= 1 and ramp_count > 0:
        suggestions.append(
            f"Detected {mass_count} mass(es) + {ramp_count} ramp(s) - "
            "universal builder will create ramp scenario with friction"
        )
    
    if mass_count >= 1 and spring_count > 0:
        suggestions.append(
            f"Detected {mass_count} mass(es) + {spring_count} spring(s) - "
            "universal builder will create spring-mass system"
        )
    
    if surface_count > 0:
        suggestions.append(
            f"Detected {surface_count} surface(s) - "
            "will be used for contact constraints and friction"
        )
    
    # Warn about unusual combinations
    if mass_count > 5:
        warnings.append(
            f"Large number of masses ({mass_count}) - simulation may be complex"
        )
    
    if pulley_count > 2:
        warnings.append(
            f"Multiple pulleys ({pulley_count}) - constraint inference may need manual review"
        )
    
    # Missing property warnings
    if pulley_count > 0:
        pulley_entities = [e for e in input_data.entities if e.get("type") == "pulley"]
        for pulley in pulley_entities:
            if not pulley.get("props", {}).get("wheel_radius_m"):
                suggestions.append(
                    f"Pulley {pulley.get('segment_id')} missing wheel_radius_m - "
                    "will use default 0.1m"
                )
    
    if mass_count > 0:
        mass_entities = [e for e in input_data.entities if e.get("type") == "mass"]
        for mass in mass_entities:
            if not mass.get("props", {}).get("mass_guess_kg"):
                warnings.append(
                    f"Mass {mass.get('segment_id')} missing mass_guess_kg - "
                    "will estimate from bbox area"
                )
    
    return ValidateEntitiesOutput(
        valid=valid,
        entity_summary=dict(type_counts),
        warnings=warnings,
        suggestions=suggestions
    )
