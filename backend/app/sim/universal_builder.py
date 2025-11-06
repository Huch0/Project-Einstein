"""
Universal Physics Builder (v0.4)

Dynamically generates Matter.js-ready Scene JSON from any combination of entities.
No rigid scene-kind schemas - supports flexible composition of bodies and constraints.
"""

from typing import Any, Dict, List, Tuple, Optional
import math

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


def _coerce_number(value: Any) -> Optional[float]:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def _coerce_positive(value: Any, default: float) -> float:
    number = _coerce_number(value)
    if number is not None and number > 0.0:
        return number
    return default


def _coerce_non_negative(value: Any) -> Optional[float]:
    number = _coerce_number(value)
    if number is None or number < 0.0:
        return None
    return number


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
        estimated_mass = estimate_mass_from_area(bbox)
        mass_kg = _coerce_positive(props.get("mass_guess_kg"), estimated_mass)
    elif entity_type in {"surface", "ramp", "ground", "rope", "anchor"}:
        body_type = "static"
        fallback_mass = 1000.0 if entity_type in {"surface", "ground"} else 1.0
        mass_kg = _coerce_positive(props.get("mass_guess_kg"), fallback_mass)
    elif entity_type == "pulley":
        body_type = "static"  # Pulley wheel is fixed
        mass_kg = _coerce_positive(props.get("mass_guess_kg"), 0.1)
    else:
        # Default dynamic
        body_type = "dynamic"
        mass_kg = _coerce_positive(props.get("mass_guess_kg"), 1.0)
    
    # Create collider from polygon or bbox
    raw_polygon_px = segment.get("polygon_px")
    outline_px: List[Tuple[float, float]]
    outline_m: List[Tuple[float, float]]

    if raw_polygon_px and len(raw_polygon_px) >= 3:
        outline_px = [(float(pt[0]), float(pt[1])) for pt in raw_polygon_px]
        outline_m = [
            px_to_meters((pt[0], pt[1]), img_center, scale_m_per_px)
            for pt in outline_px
        ]
        collider = {
            "type": "polygon",
            "vertices": [list(vertex) for vertex in outline_m]
        }
    else:
        x, y, w, h = bbox
        outline_px = [
            (float(x), float(y)),
            (float(x + w), float(y)),
            (float(x + w), float(y + h)),
            (float(x), float(y + h))
        ]
        outline_m = [
            px_to_meters(vertex, img_center, scale_m_per_px)
            for vertex in outline_px
        ]
        width_m = w * scale_m_per_px
        height_m = h * scale_m_per_px
        collider = {
            "type": "rectangle",
            "width_m": width_m,
            "height_m": height_m
        }
    
    # Material properties
    material = {}
    friction = _coerce_non_negative(props.get("mu_k"))
    if friction is not None:
        material["friction"] = friction

    restitution = _coerce_non_negative(props.get("restitution"))
    if restitution is not None:
        material["restitution"] = restitution
    
    body_id = f"{entity_type}_{entity.get('segment_id', 'unknown')}"
    
    body_dict: Dict[str, Any] = {
        "id": body_id,
        "type": body_type,
        "mass_kg": mass_kg,
        "position_m": list(pos_m),
        "velocity_m_s": [0.0, 0.0],
        "collider": collider,
    }

    if material:
        body_dict["material"] = material

    body_dict["source_segment_id"] = entity.get("segment_id")
    body_dict["geometry"] = {
        "polygon_px": [list(vertex) for vertex in outline_px],
        "polygon_m": [list(vertex) for vertex in outline_m],
        "bbox_px": [float(v) for v in bbox],
        "center_px": [float(pos_px[0]), float(pos_px[1])],
        "center_m": [float(pos_m[0]), float(pos_m[1])],
    }

    return body_dict


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
        "constraints": constraints,
        "mapping": {
            "scale_m_per_px": scale_m_per_px,
            "origin_mode": mapping.get("origin_mode", "anchor_centered"),
            "origin_px": [img_center[0], img_center[1]],
        },
        "image": {
            "width_px": W,
            "height_px": H,
        },
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
