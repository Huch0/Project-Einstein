"""Diagram parsing stub endpoint.

Accepts an uploaded image and returns deterministic mock detections plus a
pulley scene (two masses). This scaffolds the image→scene pipeline until
real CV/ML integration.
"""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException, Query
from PIL import Image
import io
from pydantic import BaseModel, Field

from app.sim.schema import example_pulley_scene
from app.pipeline.sam_detector import SamClient
from app.agent.labeler import get_labeler, SegmentIn
from app.tools.rapier_bridge import simulate_scene
from app.models.settings import settings

router = APIRouter(prefix="/diagram", tags=["diagram"])


class Detection(BaseModel):
  id: str
  label: str
  bbox_px: tuple[int, int, int, int]  # x,y,w,h
  source_segment_id: int | str | None = None


class DiagramParseResponse(BaseModel):
  image: dict
  detections: list[Detection]
  parameters: dict
  mapping: dict
  scene: dict
  meta: dict = Field(default_factory=lambda: {"version": "0.1.0", "generator": "stub"})
  segments: list[dict] | None = None


@router.post("/parse", response_model=DiagramParseResponse)
async def parse_diagram(
  file: UploadFile = File(...),
  simulate: int = Query(0, ge=0, le=1, description="If 1, run Rapier simulation and include results in meta.simulation"),
) -> DiagramParseResponse:  # noqa: D401
  if file.content_type not in {"image/png", "image/jpeg", "image/jpg"}:
    raise HTTPException(status_code=400, detail="Unsupported file type")

  # Read real image size
  contents = await file.read()
  try:
    img = Image.open(io.BytesIO(contents))
    width_px, height_px = img.size
  except Exception:
    raise HTTPException(status_code=400, detail="Invalid image file")

  # SAM segmentation (http only)
  sam = SamClient(mode=settings.SAM_MODE, http_url=settings.SAM_HTTP_URL)
  segs = sam.segment(contents)
  segments_payload = [
    {"id": s.id, "bbox": list(s.bbox), "mask_path": s.mask_path, "polygon_px": s.polygon_px}
    for s in segs
  ]

  # Label segments using configured labeler (stub|openai)
  labeler = get_labeler()
  labeled = labeler.label([SegmentIn(id=s["id"], bbox=s["bbox"], mask_path=s.get("mask_path")) for s in segments_payload])

  # Map labeled entities to canonical detections order: massA, pulley, massB, surface
  masses = [e for e in labeled if e.label == "mass"]
  pulleys = [e for e in labeled if e.label == "pulley"]
  surfaces = [e for e in labeled if e.label == "surface"]
  # sort masses by x position (left=massA, right=massB)
  masses_sorted = sorted(masses, key=lambda e: e.bbox_px[0])
  detections: list[Detection] = []
  if len(masses_sorted) > 0:
    detections.append(Detection(id="massA", label="block", bbox_px=tuple(masses_sorted[0].bbox_px), source_segment_id=masses_sorted[0].id))
  if len(pulleys) > 0:
    detections.append(Detection(id="pulley", label="pulley", bbox_px=tuple(pulleys[0].bbox_px), source_segment_id=pulleys[0].id))
  if len(masses_sorted) > 1:
    detections.append(Detection(id="massB", label="block", bbox_px=tuple(masses_sorted[1].bbox_px), source_segment_id=masses_sorted[1].id))
  if len(surfaces) > 0:
    detections.append(Detection(id="surface", label="table", bbox_px=tuple(surfaces[0].bbox_px), source_segment_id=surfaces[0].id))

  if not detections:
    raise HTTPException(status_code=422, detail="Labeler returned no usable entities")

  # Parameters from detections
  def area(b):
    return b[2] * b[3]
  mA = next((d for d in detections if d.id == "massA"), None)
  mB = next((d for d in detections if d.id == "massB"), None)
  base_mass = 3.0
  if mA and mB:
    mass_a = base_mass
    mass_b = base_mass * (area(mB.bbox_px) / area(mA.bbox_px) if area(mA.bbox_px) else 1.0)
  else:
    mass_a = base_mass
    mass_b = base_mass
  gravity = 10.0
  mu_k = 0.5

  # Heuristic scale assumption: derive from detected surface width if available; else 100px=1m
  if len(surfaces) > 0:
    surf_w = surfaces[0].bbox_px[2]
    scale_m_per_px = 1.0 / max(100.0, float(surf_w))  # rough estimate
  else:
    scale_m_per_px = 1.0 / 100.0

  # Build scene with positions inferred from detections (centers in px -> meters relative to image center)
  def center_of(b: tuple[int,int,int,int]) -> tuple[float,float]:
    x,y,w,h = b
    return (x + w/2.0, y + h/2.0)

  img_cx, img_cy = width_px/2.0, height_px/2.0
  def px_to_m(pt: tuple[float,float]) -> tuple[float,float]:
    px, py = pt
    return ((px - img_cx) * scale_m_per_px, (py - img_cy) * scale_m_per_px)

  # Defaults if missing
  m1_pos_m = (-0.5, 0.5)
  m2_pos_m = (0.5, 1.5)
  pulley_anchor_m = (0.0, 2.0)
  if mA:
    m1_pos_m = px_to_m(center_of(mA.bbox_px))
  if mB:
    m2_pos_m = px_to_m(center_of(mB.bbox_px))
  if len(pulleys) > 0:
    pulley_anchor_m = px_to_m(center_of(pulleys[0].bbox_px))

  from app.sim.schema import Scene, Body, PulleyConstraint, WorldSettings
  scene_model = Scene(
    bodies=[
      Body(id="m1", mass_kg=mass_a, position_m=(float(m1_pos_m[0]), float(m1_pos_m[1]))),
      Body(id="m2", mass_kg=mass_b, position_m=(float(m2_pos_m[0]), float(m2_pos_m[1]))),
    ],
    constraints=[
      PulleyConstraint(body_a="m1", body_b="m2", pulley_anchor_m=(float(pulley_anchor_m[0]), float(pulley_anchor_m[1])))
    ],
    world=WorldSettings(gravity_m_s2=gravity),
    notes="Scene initialized from SAM detections (centers mapped from px to m)",
  ).normalize()
  scene = scene_model.model_dump()
  scene["meta"] = {"diagram_scale_m_per_px": scale_m_per_px, "origin_mode": "anchor_centered"}

  meta = {
    "version": "0.1.0",
    "generator": f"sam+{settings.LABELER_MODE}",
    "sam_mode": settings.SAM_MODE,
    "sam_segments_count": len(segments_payload),
    "sam_http": bool(settings.SAM_HTTP_URL),
    "filename": file.filename,
  }

  # Optionally run Rapier simulation of the assembled scene
  if simulate == 1:
    try:
      sim_result = simulate_scene(scene)
      meta["simulation"] = {
        "engine": "rapier2d",
        "frames_count": len(sim_result.get("frames", [])),
        "frames": sim_result.get("frames", []),
        "energy": sim_result.get("energy", {}),
      }
    except Exception as e:
      meta["simulation_error"] = str(e)

  return DiagramParseResponse(
    image={"width_px": width_px, "height_px": height_px},
    detections=detections,
    parameters={
      "massA_kg": mass_a,
      "massB_kg": mass_b,
      "mu_k": mu_k,
      "gravity_m_s2": gravity,
    },
    mapping={
      "origin_mode": "anchor_centered",
      "scale_m_per_px": scale_m_per_px,
    },
    scene=scene,
    meta=meta,
    segments=segments_payload,
  )
