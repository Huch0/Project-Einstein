"""
Universal Physics Builder (v0.4)

Dynamically generates Matter.js-ready Scene JSON from any combination of entities.
No rigid scene-kind schemas - supports flexible composition of bodies and constraints.
"""

from typing import Any, Dict, List, Tuple
from app.sim.schema import Scene, Body, WorldSettings


def px_to_meters(
    px_pos: Tuple[float, float],
    img_center: Tuple[float, float],
    scale_m_per_px: float
) -> Tuple[float, float]:
    """Convert pixel coordinates to meters relative to image center."""
    px, py = px_pos
    cx, cy = img_center
    return ((px - cx) * scale_m_per_px, (py - cy) * scale_m_per_px)


def estimate_mass_from_area(bbox: List[int], base_mass_kg: float = 3.0) -> float:
    """Estimate mass from bbox area (simple heuristic)."""
    if len(bbox) < 4:
        return base_mass_kg
    area = max(1, bbox[2] * bbox[3])  # width * height in pixels
    # Normalize to base area of 50x50 pixels
    base_area = 2500
    return base_mass_kg * (area / base_area)


def create_body_from_entity(
    entity: Dict[str, Any],
    segment: Dict[str, Any],
    img_center: Tuple[float, float],
    scale_m_per_px: float
) -> Dict[str, Any]:
    """
    Convert entity + segment to Matter.js body.
    
    Args:
        entity: Labeled entity {segment_id, type, props, ...}
        segment: SAM segment {id, bbox, polygon_px, ...}
        img_center: (cx_px, cy_px)
        scale_m_per_px: Coordinate scaling factor
        
    Returns:
        Body dict with id, type, mass_kg, position_m, collider
    """
    bbox = segment.get("bbox", [0, 0, 100, 100])
    
    # Position from bbox center
    pos_px = (bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2)
    pos_m = px_to_meters(pos_px, img_center, scale_m_per_px)
    
    entity_type = entity.get("type", "mass")
    props = entity.get("props", {})
    
    # Determine body type and mass
    if entity_type == "mass":
        body_type = "dynamic"
        mass_kg = props.get("mass_guess_kg") or estimate_mass_from_area(bbox)
    elif entity_type == "surface":
        body_type = "static"
        mass_kg = 1000.0  # Large mass for static bodies
    elif entity_type == "pulley":
        body_type = "static"  # Pulley wheel is fixed
        mass_kg = 0.1
    else:
        # Default dynamic
        body_type = "dynamic"
        mass_kg = props.get("mass_guess_kg", 1.0)
    
    # Create collider from polygon or bbox
    polygon_px = segment.get("polygon_px")
    if polygon_px and len(polygon_px) > 3:
        # Polygon collider (convert to meters)
        vertices_m = [
            px_to_meters((pt[0], pt[1]), img_center, scale_m_per_px)
            for pt in polygon_px
        ]
        collider = {
            "type": "polygon",
            "vertices": vertices_m
        }
    else:
        # Rectangle collider from bbox
        width_m = bbox[2] * scale_m_per_px
        height_m = bbox[3] * scale_m_per_px
        collider = {
            "type": "rectangle",
            "width_m": width_m,
            "height_m": height_m
        }
    
    # Material properties
    material = {}
    if "mu_k" in props:
        material["friction"] = props["mu_k"]
    if "restitution" in props:
        material["restitution"] = props["restitution"]
    
    body_id = f"{entity_type}_{entity.get('segment_id', 'unknown')}"
    
    return {
        "id": body_id,
        "type": body_type,
        "mass_kg": mass_kg,
        "position_m": list(pos_m),
        "velocity_m_s": [0.0, 0.0],
        "collider": collider,
        "material": material if material else None
    }


def infer_rope_constraint(
    pulley_entity: Dict[str, Any],
    mass_entities: List[Dict[str, Any]],
    segments_by_id: Dict[str, Dict[str, Any]],
    img_center: Tuple[float, float],
    scale_m_per_px: float
) -> Dict[str, Any] | None:
    """
    Infer rope constraint connecting two masses through a pulley.
    
    Finds masses vertically aligned with pulley and creates rope constraint.
    """
    pulley_seg = segments_by_id.get(str(pulley_entity.get("segment_id")))
    if not pulley_seg:
        return None
    
    pulley_bbox = pulley_seg.get("bbox", [0, 0, 0, 0])
    pulley_cx = pulley_bbox[0] + pulley_bbox[2] / 2
    pulley_cy = pulley_bbox[1] + pulley_bbox[3] / 2
    
    # Find masses vertically aligned (within tolerance)
    tolerance_px = 100  # Horizontal alignment tolerance
    connected_masses = []
    
    for mass_ent in mass_entities:
        mass_seg = segments_by_id.get(str(mass_ent.get("segment_id")))
        if not mass_seg:
            continue
        
        mass_bbox = mass_seg.get("bbox", [0, 0, 0, 0])
        mass_cx = mass_bbox[0] + mass_bbox[2] / 2
        
        # Check if horizontally aligned with pulley
        if abs(mass_cx - pulley_cx) < tolerance_px:
            mass_cy = mass_bbox[1] + mass_bbox[3] / 2
            distance_from_pulley = abs(mass_cy - pulley_cy)
            connected_masses.append({
                "entity": mass_ent,
                "segment": mass_seg,
                "distance": distance_from_pulley
            })
    
    # Need at least 2 masses for pulley system
    if len(connected_masses) < 2:
        return None
    
    # Sort by distance from pulley, take closest 2
    connected_masses.sort(key=lambda m: m["distance"])
    mass_a = connected_masses[0]["entity"]
    mass_b = connected_masses[1]["entity"]
    
    # Calculate rope length (sum of distances from pulley to each mass)
    mass_a_seg = connected_masses[0]["segment"]
    mass_b_seg = connected_masses[1]["segment"]
    
    mass_a_cy = mass_a_seg["bbox"][1] + mass_a_seg["bbox"][3] / 2
    mass_b_cy = mass_b_seg["bbox"][1] + mass_b_seg["bbox"][3] / 2
    
    dist_a = abs(mass_a_cy - pulley_cy) * scale_m_per_px
    dist_b = abs(mass_b_cy - pulley_cy) * scale_m_per_px
    rope_length_m = dist_a + dist_b
    
    return {
        "type": "rope",
        "body_a": f"mass_{mass_a.get('segment_id')}",
        "body_b": f"mass_{mass_b.get('segment_id')}",
        "length_m": rope_length_m,
        "stiffness": 1.0  # Ideal rope (inextensible)
    }


def build_scene_universal(request: Dict[str, Any]) -> Dict[str, Any]:
    """
    Universal Physics Builder - handles any entity combination.
    
    Args:
        request: {
            image: {width_px, height_px},
            segments: [{id, bbox, polygon_px}, ...],
            labels: {entities: [{segment_id, type, props}, ...]},
            mapping: {origin_mode, scale_m_per_px},
            defaults: {gravity_m_s2, time_step_s}
        }
        
    Returns:
        {
            scene: Scene JSON (v0.4),
            warnings: [str, ...],
            meta: {builder, entity_count, constraint_count}
        }
    """
    warnings = []
    
    # Extract inputs
    image = request.get("image", {})
    W = image.get("width_px", 800)
    H = image.get("height_px", 600)
    img_center = (W / 2, H / 2)
    
    segments = request.get("segments", [])
    labels = request.get("labels", {})
    entities = labels.get("entities", [])
    
    mapping = request.get("mapping", {})
    scale_m_per_px = mapping.get("scale_m_per_px", 0.01)
    
    defaults = request.get("defaults", {})
    gravity = defaults.get("gravity_m_s2", 9.81)
    time_step = defaults.get("time_step_s", 0.016)
    
    # Build segment lookup
    segments_by_id = {str(seg.get("id")): seg for seg in segments}
    
    # Create bodies from entities
    bodies = []
    mass_entities = []
    pulley_entities = []
    
    for entity in entities:
        segment_id = str(entity.get("segment_id"))
        segment = segments_by_id.get(segment_id)
        
        if not segment:
            warnings.append(f"Segment {segment_id} not found for entity {entity.get('type')}")
            continue
        
        body = create_body_from_entity(entity, segment, img_center, scale_m_per_px)
        bodies.append(body)
        
        # Track entity types for constraint inference
        entity_type = entity.get("type")
        if entity_type == "mass":
            mass_entities.append(entity)
        elif entity_type == "pulley":
            pulley_entities.append(entity)
    
    # Infer constraints dynamically
    constraints = []
    
    # Find pulley systems (rope constraints)
    for pulley_ent in pulley_entities:
        rope_constraint = infer_rope_constraint(
            pulley_ent,
            mass_entities,
            segments_by_id,
            img_center,
            scale_m_per_px
        )
        if rope_constraint:
            constraints.append(rope_constraint)
        else:
            warnings.append(f"Pulley {pulley_ent.get('segment_id')} has no connected masses")
    
    # TODO: Add more constraint inference logic
    # - Spring constraints
    # - Contact surfaces
    # - Hinges
    
    # Build Scene JSON
    scene_dict = {
        "version": "0.4.0",
        "world": {
            "gravity_m_s2": gravity,
            "time_step_s": time_step
        },
        "bodies": bodies,
        "constraints": constraints
    }
    
    return {
        "scene": scene_dict,
        "warnings": warnings,
        "meta": {
            "builder": "universal_v1",
            "entity_count": len(entities),
            "constraint_count": len(constraints),
            "body_count": len(bodies)
        }
    }
