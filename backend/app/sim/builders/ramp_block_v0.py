from __future__ import annotations

from typing import Any, Dict, List, Tuple

from . import register

KIND = "ramp.block_v0"


def _center_of_bbox(b: Tuple[int, int, int, int]) -> Tuple[float, float]:
  x, y, w, h = b
  return (x + w / 2.0, y + h / 2.0)


def _px_to_m(pt: Tuple[float, float], img_cx: float, img_cy: float, scale_m_per_px: float) -> Tuple[float, float]:
  px, py = pt
  return ((px - img_cx) * scale_m_per_px, (py - img_cy) * scale_m_per_px)


def _area(bb: Tuple[int, int, int, int]) -> float:
  return float(max(0, bb[2]) * max(0, bb[3]))


class RampBlockBuilder:
  kind = KIND

  def validate(self, request: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    if not request.get("image"):
      warnings.append("missing_image_dims")
    if not request.get("segments"):
      warnings.append("missing_segments")
    return warnings

  def build(self, req: Dict[str, Any]) -> Dict[str, Any]:
    warnings: List[str] = []
    image = req.get("image") or {}
    W = float(image.get("width_px", 0))
    H = float(image.get("height_px", 0))
    segments = req.get("segments") or []
    labels = req.get("labels") or {}
    entities = labels.get("entities") or []
    mapping = req.get("mapping") or {}
    S = float(mapping.get("scale_m_per_px", 0.01))

    def etype(e: Dict[str, Any]) -> str:
      if e.get("type"):
        return str(e["type"]).lower()
      return str(e.get("label", "")).lower()

    mass_ent = next((e for e in entities if etype(e) == "mass"), None)
    ramp_ent = next((e for e in entities if etype(e) == "ramp"), None)

    # Lookup bbox centers
    by_seg_id: Dict[str | int, Tuple[int, int, int, int]] = {}
    for s in segments:
      seg_id = s.get("id")
      bbox = s.get("bbox") or [0, 0, 0, 0]
      by_seg_id[str(seg_id)] = (int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3]))

    img_cx, img_cy = W / 2.0, H / 2.0

    def pos_m(ent: Dict[str, Any] | None) -> Tuple[float, float]:
      if not ent:
        return (0.0, 0.0)
      bb = by_seg_id.get(str(ent.get("segment_id")), (0,0,0,0))
      return _px_to_m(_center_of_bbox(bb), img_cx, img_cy, S)

    mass_pos = pos_m(mass_ent)

    # Mass
    mass_kg = 3.0
    if mass_ent:
      props = mass_ent.get("props") or {}
      for key in ("mass_kg", "mass_guess_kg"):
        if key in props:
          try:
            mass_kg = float(props.get(key))
            break
          except Exception:
            pass

    # Ramp angle and friction
    angle_deg = None
    mu_k = 0.0
    if ramp_ent:
      props = ramp_ent.get("props") or {}
      if "angle_deg" in props:
        try:
          angle_deg = float(props.get("angle_deg"))
        except Exception:
          pass
      for mk in ("mu_k", "friction_k"):
        if mk in props:
          try:
            mu_k = float(props.get(mk))
            break
          except Exception:
            pass
    if angle_deg is None:
      angle_deg = 30.0
      warnings.append("angle_inferred_default")

    gravity = float((req.get("defaults") or {}).get("gravity_m_s2", 9.81))

    # Generic scene dict for ramp
    scene = {
      "version": "0.2.0",
      "kind": KIND,
      "world": {"gravity_m_s2": gravity, "time_step_s": 0.016},
      "bodies": [
        {"id": "m1", "mass_kg": mass_kg, "position_m": [float(mass_pos[0]), float(mass_pos[1])], "velocity_m_s": [0.0, 0.0]},
      ],
      "constraints": [
        {"type": "ramp_plane", "angle_deg": angle_deg, "mu_k": mu_k}
      ],
      "meta": {"note": "built by registry ramp builder"},
    }
    return {
      "scene": scene,
      "warnings": warnings,
      "meta": {"source": "sam+gpt", "resolver": "v2", "scene_kind": KIND},
    }


# Register
register(RampBlockBuilder())
