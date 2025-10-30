"""
Tool 3: validate_scene_entities - Entity Set Validation

Checks if entity set is sufficient for scene building and determines scene type.
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
        default=False,
        description="Allow incomplete entity sets (for iterative building)"
    )


class ValidateEntitiesOutput(BaseModel):
    """Output schema for validate_scene_entities tool."""
    
    valid: bool = Field(
        description="Whether entity set is valid for scene building"
    )
    scene_kind: str | None = Field(
        default=None,
        description="Determined scene type (e.g., 'pulley.single_fixed_v0')"
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-blocking validation warnings"
    )
    missing_required: list[str] = Field(
        default_factory=list,
        description="Required entities that are missing"
    )
    suggestions: list[str] = Field(
        default_factory=list,
        description="Suggestions to improve scene"
    )


async def validate_scene_entities(
    input_data: ValidateEntitiesInput
) -> ValidateEntitiesOutput:
    """
    Validate entity set and determine scene type.
    
    Resolver rules (from instruction.instructions.md):
    - ≥2 mass + 1 pulley → pulley.single_fixed_v0
    - 1 mass + 1 ramp → ramp.block_v0
    - 1 mass + 1 pendulum_pivot → pendulum.single_v0
    - 1 mass + 1 spring → spring_mass.single_v0
    
    Args:
        input_data: Entity list to validate
        
    Returns:
        Validation result with scene_kind and suggestions
        
    Example:
        >>> result = await validate_scene_entities(ValidateEntitiesInput(
        ...     entities=[
        ...         {"type": "mass", "segment_id": "1"},
        ...         {"type": "mass", "segment_id": "2"},
        ...         {"type": "pulley", "segment_id": "3"}
        ...     ]
        ... ))
        >>> assert result.scene_kind == "pulley.single_fixed_v0"
    """
    # Count entity types
    type_counts = Counter(e.get("type") for e in input_data.entities)
    
    warnings = []
    missing_required = []
    suggestions = []
    scene_kind = None
    valid = False
    
    # Apply resolver rules
    mass_count = type_counts.get("mass", 0)
    has_pulley = type_counts.get("pulley", 0) > 0
    has_ramp = type_counts.get("ramp", 0) > 0
    has_pendulum_pivot = type_counts.get("pendulum_pivot", 0) > 0
    has_spring = type_counts.get("spring", 0) > 0
    has_surface = type_counts.get("surface", 0) > 0
    
    # Rule 1: Pulley system
    if mass_count >= 2 and has_pulley:
        scene_kind = "pulley.single_fixed_v0"
        valid = True
        if has_surface:
            warnings.append(
                "Surface detected but not required for pulley scene"
            )
        if mass_count > 2:
            warnings.append(
                f"Found {mass_count} masses, only first 2 will be used in pulley system"
            )
    
    # Rule 2: Ramp/incline
    elif mass_count >= 1 and has_ramp:
        scene_kind = "ramp.block_v0"
        valid = True
        if mass_count > 1:
            warnings.append(
                f"Found {mass_count} masses, only first will be used on ramp"
            )
    
    # Rule 3: Pendulum
    elif mass_count >= 1 and has_pendulum_pivot:
        scene_kind = "pendulum.single_v0"
        valid = True
        if mass_count > 1:
            warnings.append(
                f"Found {mass_count} masses, only first will be used as pendulum bob"
            )
    
    # Rule 4: Spring-mass
    elif mass_count >= 1 and has_spring:
        scene_kind = "spring_mass.single_v0"
        valid = True
        if mass_count > 1:
            warnings.append(
                f"Found {mass_count} masses, only first will be used in spring system"
            )
    
    # No match - provide hints
    else:
        if mass_count == 0:
            missing_required.append("At least 1 mass required")
        
        if mass_count == 1:
            missing_required.append(
                "Need either: pulley (for 2nd mass), ramp, pendulum_pivot, or spring"
            )
            suggestions.append(
                "For pulley system: add another mass + pulley"
            )
            suggestions.append(
                "For ramp: add ramp entity"
            )
            suggestions.append(
                "For pendulum: add pendulum_pivot entity"
            )
            suggestions.append(
                "For spring-mass: add spring entity"
            )
        
        elif mass_count >= 2:
            missing_required.append(
                "Need pulley for multi-mass system"
            )
            suggestions.append(
                "Add pulley entity to create pulley.single_fixed_v0 scene"
            )
        
        if input_data.allow_incomplete:
            warnings.append(
                "Incomplete entity set, but allow_incomplete=True"
            )
            valid = True
    
    # Additional suggestions
    if valid and scene_kind == "pulley.single_fixed_v0":
        pulley_entities = [e for e in input_data.entities if e.get("type") == "pulley"]
        if pulley_entities:
            pulley = pulley_entities[0]
            if not pulley.get("props", {}).get("wheel_radius_m"):
                suggestions.append(
                    "Add wheel_radius_m to pulley props for better accuracy"
                )
    
    return ValidateEntitiesOutput(
        valid=valid,
        scene_kind=scene_kind,
        warnings=warnings,
        missing_required=missing_required,
        suggestions=suggestions
    )
