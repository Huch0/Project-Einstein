from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.sim.schema import Scene, Body, PulleyConstraint, WorldSettings

from . import register

KIND = "pulley.single_fixed_v0"


def _center_of_bbox(b: Tuple[int, int, int, int]) -> Tuple[float, float]:
  x, y, w, h = b
  return (x + w / 2.0, y + h / 2.0)


def _px_to_m(pt: Tuple[float, float], img_cx: float, img_cy: float, scale_m_per_px: float) -> Tuple[float, float]:
  px, py = pt
  return ((px - img_cx) * scale_m_per_px, (py - img_cy) * scale_m_per_px)


def _area(bb: Tuple[int, int, int, int]) -> float:
  return float(max(0, bb[2]) * max(0, bb[3]))


class PulleyBuilder:
  kind = KIND

  def validate(self, request: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    segs = request.get("segments") or []
    image = request.get("image") or {}
    if not image.get("width_px") or not image.get("height_px"):
      warnings.append("missing_image_dims")
    if not segs:
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
    origin_mode = mapping.get("origin_mode", "anchor_centered")
    S = float(mapping.get("scale_m_per_px", 0.01))

    # v0.2 types or v0.1 labels fallback
    def ent_type(ent: Dict[str, Any]) -> str:
      t = ent.get("type")
      if t:
        return str(t)
      # fallback v0.1
      return str(ent.get("label", "")).lower()

    # Lookup segment bbox
    by_seg_id: Dict[str | int, Tuple[int, int, int, int]] = {}
    for s in segments:
      seg_id = s.get("id")
      bbox = s.get("bbox") or [0, 0, 0, 0]
      by_seg_id[str(seg_id)] = (int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3]))

    masses = [e for e in entities if ent_type(e) == "mass"]
    pulleys = [e for e in entities if ent_type(e) == "pulley"]

    # Determine left/right masses by center x
    def ent_center_x(ent: Dict[str, Any]) -> float:
      seg_id = str(ent.get("segment_id"))
      bb = by_seg_id.get(seg_id, (0, 0, 0, 0))
      cx, _ = _center_of_bbox(bb)
      return cx

    masses_sorted = sorted(masses, key=ent_center_x)
    m1_ent = masses_sorted[0] if masses_sorted else None
    m2_ent = masses_sorted[1] if len(masses_sorted) > 1 else None
    pulley_ent = pulleys[0] if pulleys else None

    # Masses from props or infer by area ratio
    base_mass = 3.0

    def mass_guess(ent: Dict[str, Any] | None) -> float | None:
      if not ent:
        return None
      props = ent.get("props") or {}
      for key in ("mass_kg", "mass_guess_kg"):
        if key in props:
          try:
            return float(props.get(key))
          except Exception:
            pass
      return None

    bb_a = by_seg_id.get(str(m1_ent.get("segment_id"))) if m1_ent else (0, 0, 0, 0)
    bb_b = by_seg_id.get(str(m2_ent.get("segment_id"))) if m2_ent else (0, 0, 0, 0)
    mg_a = mass_guess(m1_ent)
    mg_b = mass_guess(m2_ent)
    if mg_a is not None and mg_b is not None:
      mass_a, mass_b = mg_a, mg_b
    elif mg_a is not None and mg_b is None:
      r = (_area(bb_b) / _area(bb_a)) if _area(bb_a) > 0 else 1.0
      mass_a, mass_b = mg_a, max(0.1, mg_a * r)
    elif mg_a is None and mg_b is not None:
      r = (_area(bb_a) / _area(bb_b)) if _area(bb_b) > 0 else 1.0
      mass_a, mass_b = max(0.1, mg_b * r), mg_b
    else:
      r = (_area(bb_b) / _area(bb_a)) if _area(bb_a) > 0 else 1.0
      mass_a, mass_b = base_mass, max(0.1, base_mass * r)

    # Positions
    img_cx, img_cy = W / 2.0, H / 2.0

    def pos_m_of(ent: Dict[str, Any] | None) -> Tuple[float, float]:
      if not ent:
        return (0.0, 0.0)
      seg_id = str(ent.get("segment_id"))
      bb = by_seg_id.get(seg_id, (0, 0, 0, 0))
      return _px_to_m(_center_of_bbox(bb), img_cx, img_cy, S)

    m1_pos = pos_m_of(m1_ent)
    m2_pos = pos_m_of(m2_ent)
    pulley_pos = pos_m_of(pulley_ent)

    # Optional: wheel radius
    wheel_radius_m = 0.1
    if pulley_ent:
      try:
        pr = (pulley_ent.get("props") or {}).get("wheel_radius_m")
        if pr is not None:
          wheel_radius_m = float(pr)
      except Exception:
        pass

    # Gravity from defaults or props hints
    gravity_default = float((req.get("defaults") or {}).get("gravity_m_s2", 9.81))
    gravity = gravity_default
    # Check any entity props gravity hint
    g_hints: List[float] = []
    for e in entities:
      props = e.get("props") or {}
      if "gravity_m_s2" in props:
        try:
          g_hints.append(float(props.get("gravity_m_s2")))
        except Exception:
          pass
    if g_hints:
      g_hints.sort()
      med = g_hints[len(g_hints)//2]
      gravity = med
      if any(abs(x - med) > 1e-6 for x in g_hints):
        warnings.append("conflicting_gravity_hints")

    scene_model = Scene(
      bodies=[
        Body(id="m1", mass_kg=float(mass_a), position_m=(float(m1_pos[0]), float(m1_pos[1]))),
        Body(id="m2", mass_kg=float(mass_b), position_m=(float(m2_pos[0]), float(m2_pos[1]))),
      ],
      constraints=[
        PulleyConstraint(body_a="m1", body_b="m2", pulley_anchor_m=(float(pulley_pos[0]), float(pulley_pos[1])), wheel_radius_m=float(wheel_radius_m))
      ],
      world=WorldSettings(gravity_m_s2=gravity),
      notes=f"origin_mode={origin_mode}; built by registry pulley builder",
    ).normalize()

    return {
      "scene": scene_model.model_dump(),
      "warnings": warnings,
      "meta": {"source": "sam+gpt", "resolver": "v2", "scene_kind": KIND},
    }


# Register on import
auto_builder = PulleyBuilder()
register(auto_builder)
