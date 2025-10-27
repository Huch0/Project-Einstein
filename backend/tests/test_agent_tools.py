"""
Unit tests for agent tools.
"""

import pytest
from app.agent.tools.segment_image import SegmentImageInput, segment_image
from app.agent.tools.label_segments import LabelSegmentsInput, label_segments
from app.agent.tools.validate_entities import ValidateEntitiesInput, validate_scene_entities


@pytest.mark.asyncio
async def test_validate_scene_entities_pulley():
    """Test pulley scene validation."""
    input_data = ValidateEntitiesInput(
        entities=[
            {"segment_id": "1", "type": "mass", "props": {"mass_guess_kg": 3.0}},
            {"segment_id": "2", "type": "mass", "props": {"mass_guess_kg": 6.0}},
            {"segment_id": "3", "type": "pulley", "props": {"wheel_radius_m": 0.1}},
        ]
    )
    
    result = await validate_scene_entities(input_data)
    
    assert result.valid is True
    assert result.scene_kind == "pulley.single_fixed_v0"
    assert len(result.missing_required) == 0


@pytest.mark.asyncio
async def test_validate_scene_entities_ramp():
    """Test ramp scene validation."""
    input_data = ValidateEntitiesInput(
        entities=[
            {"segment_id": "1", "type": "mass", "props": {"mass_guess_kg": 2.0}},
            {"segment_id": "2", "type": "ramp", "props": {}},
        ]
    )
    
    result = await validate_scene_entities(input_data)
    
    assert result.valid is True
    assert result.scene_kind == "ramp.block_v0"


@pytest.mark.asyncio
async def test_validate_scene_entities_incomplete():
    """Test incomplete entity set."""
    input_data = ValidateEntitiesInput(
        entities=[
            {"segment_id": "1", "type": "mass", "props": {"mass_guess_kg": 3.0}},
        ],
        allow_incomplete=False
    )
    
    result = await validate_scene_entities(input_data)
    
    assert result.valid is False
    assert len(result.missing_required) > 0
    assert len(result.suggestions) > 0


@pytest.mark.asyncio
async def test_label_segments_stub():
    """Test stub labeler output format."""
    input_data = LabelSegmentsInput(
        image_id="test_image",
        segments=[
            {"id": 1, "bbox": [10, 20, 30, 40]},
            {"id": 2, "bbox": [50, 60, 70, 80]},
            {"id": 3, "bbox": [90, 100, 110, 120]},
        ],
        context="pulley system",
        use_vision=False
    )
    
    result = await label_segments(input_data)
    
    assert result.version == "v0.2"
    assert len(result.entities) >= 3  # At least 3 entities
    
    # Check that entities have valid types
    entity_types = [e.type for e in result.entities]
    assert all(t in ["mass", "pulley", "surface", "rope"] for t in entity_types)
    
    # Verify confidence scores are valid
    assert all(0 <= e.confidence <= 1 for e in result.entities if e.confidence)

