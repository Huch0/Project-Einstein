"""Interface Builder v1: segments+labels → Scene JSON (pulley.single_fixed_v0).

Contracts per instruction:
- Input: dict with keys image, segments, labels, mapping, defaults
- Output: dict with keys scene (pydantic model dump), warnings, meta
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from app.sim.schema import Scene, Body, PulleyConstraint, WorldSettings


def _center_of_bbox(b: Tuple[int, int, int, int]) -> Tuple[float, float]:
  x, y, w, h = b
  return (x + w / 2.0, y + h / 2.0)


def _px_to_m(pt: Tuple[float, float], img_cx: float, img_cy: float, scale_m_per_px: float) -> Tuple[float, float]:
  px, py = pt
  return ((px - img_cx) * scale_m_per_px, (py - img_cy) * scale_m_per_px)


def build_scene(req: Dict[str, Any]) -> Dict[str, Any]:
  warnings: List[str] = []
  image = req.get("image") or {}
  W = float(image.get("width_px", 0))
  H = float(image.get("height_px", 0))
  if not W or not H:
    warnings.append("missing_image_dims")

  segments = req.get("segments") or []
  labels = req.get("labels") or {}
  entities = labels.get("entities") or []
  mapping = req.get("mapping") or {}
  origin_mode = mapping.get("origin_mode", "anchor_centered")
  S = float(mapping.get("scale_m_per_px", 0.01))  # default 100px = 1m

  # Build lookup from segment_id -> bbox
  by_seg_id: Dict[str | int, Tuple[int, int, int, int]] = {}
  for s in segments:
    seg_id = s.get("id")
    bbox = s.get("bbox") or [0, 0, 0, 0]
    by_seg_id[str(seg_id)] = (int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3]))
  # Areas for mass inference
  def _area(bb: Tuple[int, int, int, int]) -> float:
    return float(max(0, bb[2]) * max(0, bb[3]))

  # Extract labeled entities
  masses: List[Dict[str, Any]] = []
  pulleys: List[Dict[str, Any]] = []
  # Collect global hints
  scale_hints: List[float] = []
  gravity_hints: List[float] = []
  for e in entities:
    lab = (e.get("label") or "").lower()
    if lab == "mass":
      masses.append(e)
    elif lab == "pulley":
      pulleys.append(e)
    # Surface props may include scale; any entity may include gravity
    props = e.get("props") or {}
    try:
      if "scale_m_per_px" in props:
        scale_hints.append(float(props.get("scale_m_per_px")))
    except Exception:
      pass
    try:
      if "gravity_m_s2" in props:
        gravity_hints.append(float(props.get("gravity_m_s2")))
    except Exception:
      pass

  if len(masses) < 2:
    warnings.append("expected_2_masses")
  if len(pulleys) < 1:
    warnings.append("missing_pulley")

  # Map masses to left(m1)/right(m2) by bbox center x
  def ent_center_x(ent: Dict[str, Any]) -> float:
    seg_id = str(ent.get("segment_id"))
    bb = by_seg_id.get(seg_id, (0, 0, 0, 0))
    cx, _ = _center_of_bbox(bb)
    return cx

  masses_sorted = sorted(masses, key=ent_center_x)
  m1_ent = masses_sorted[0] if masses_sorted else None
  m2_ent = masses_sorted[1] if len(masses_sorted) > 1 else None
  pulley_ent = pulleys[0] if pulleys else None

  # Mass values
  base_mass = 3.0
  def mass_guess(ent: Dict[str, Any] | None) -> float | None:
    if not ent:
      return None
    try:
      mg = (ent.get("props") or {}).get("mass_guess_kg")
      return float(mg) if mg is not None else None
    except Exception:
      return None

  mg_a = mass_guess(m1_ent)
  mg_b = mass_guess(m2_ent)
  if mg_a is not None and mg_b is not None:
    mass_a = mg_a
    mass_b = mg_b
  elif mg_a is not None and mg_b is None:
    # infer b from area ratio relative to a
    bb_a = by_seg_id.get(str(m1_ent.get("segment_id"))) if m1_ent else (0, 0, 0, 0)
    bb_b = by_seg_id.get(str(m2_ent.get("segment_id"))) if m2_ent else (0, 0, 0, 0)
    r = (_area(bb_b) / _area(bb_a)) if _area(bb_a) > 0 else 1.0
    mass_a = mg_a
    mass_b = max(0.1, mg_a * r)
  elif mg_a is None and mg_b is not None:
    bb_a = by_seg_id.get(str(m1_ent.get("segment_id"))) if m1_ent else (0, 0, 0, 0)
    bb_b = by_seg_id.get(str(m2_ent.get("segment_id"))) if m2_ent else (0, 0, 0, 0)
    r = (_area(bb_a) / _area(bb_b)) if _area(bb_b) > 0 else 1.0
    mass_b = mg_b
    mass_a = max(0.1, mg_b * r)
  else:
    # Neither provided → infer ratio from areas based on base_mass
    bb_a = by_seg_id.get(str(m1_ent.get("segment_id"))) if m1_ent else (0, 0, 0, 0)
    bb_b = by_seg_id.get(str(m2_ent.get("segment_id"))) if m2_ent else (0, 0, 0, 0)
    r = (_area(bb_b) / _area(bb_a)) if _area(bb_a) > 0 else 1.0
    mass_a = base_mass
    mass_b = max(0.1, base_mass * r)

  # Positions (px centers → meters), origin centered at image center for anchor_centered
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

  # Optional: wheel radius from labels.props
  wheel_radius_m = 0.1
  if pulley_ent:
    try:
      pr = (pulley_ent.get("props") or {}).get("wheel_radius_m")
      if pr is not None:
        wheel_radius_m = float(pr)
    except Exception:
      pass

  # Build scene
  gravity_default = float((req.get("defaults") or {}).get("gravity_m_s2", 9.81))
  gravity = gravity_default
  if gravity_hints:
    # If conflicting hints, take median and warn
    gh_sorted = sorted(gravity_hints)
    med = gh_sorted[len(gh_sorted)//2]
    gravity = med
    if any(abs(g - med) > 1e-6 for g in gravity_hints):
      warnings.append("conflicting_gravity_hints")

  if scale_hints:
    sh_sorted = sorted(scale_hints)
    med_s = sh_sorted[len(sh_sorted)//2]
    if abs(med_s - S) > 1e-9:
      # override mapping scale by GPT hint
      S = med_s
      warnings.append("mapping_scale_overridden_by_hint")
  scene_model = Scene(
    bodies=[
      Body(id="m1", mass_kg=float(mass_a), position_m=(float(m1_pos[0]), float(m1_pos[1]))),
      Body(id="m2", mass_kg=float(mass_b), position_m=(float(m2_pos[0]), float(m2_pos[1]))),
    ],
    constraints=[
      PulleyConstraint(body_a="m1", body_b="m2", pulley_anchor_m=(float(pulley_pos[0]), float(pulley_pos[1])), wheel_radius_m=float(wheel_radius_m))
    ],
    world=WorldSettings(gravity_m_s2=gravity),
    notes=f"origin_mode={origin_mode}; built by interface builder v1",
  ).normalize()

  return {
    "scene": scene_model.model_dump(),
    "warnings": warnings,
    "meta": {"source": "sam+gpt", "resolver": "v1"},
  }


__all__ = ["build_scene"]
