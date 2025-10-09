"""Diagram parsing stub endpoint.

Accepts an uploaded image and returns deterministic mock detections plus a
pulley scene (two masses). This scaffolds the image→scene pipeline until
real CV/ML integration.
"""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException
from PIL import Image
import io
from pydantic import BaseModel, Field

from app.sim.schema import example_pulley_scene
from app.pipeline.sam_detector import SamClient
from app.models.settings import settings

router = APIRouter(prefix="/diagram", tags=["diagram"])


class Detection(BaseModel):
  id: str
  label: str
  bbox_px: tuple[int, int, int, int]  # x,y,w,h


class DiagramParseResponse(BaseModel):
  image: dict
  detections: list[Detection]
  parameters: dict
  mapping: dict
  scene: dict
  meta: dict = Field(default_factory=lambda: {"version": "0.1.0", "generator": "stub"})
  segments: list[dict] | None = None


@router.post("/parse", response_model=DiagramParseResponse)
async def parse_diagram(file: UploadFile = File(...)) -> DiagramParseResponse:  # noqa: D401
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
    {"id": s.id, "bbox": list(s.bbox), "mask_path": s.mask_path}
    for s in segs
  ]

  # Heuristic mapping from segments -> detections
  # - surface: widest, very low height (thin), near bottom
  # - pulley: near top and roughly square (aspect ~1)
  # - masses: remaining two largest rectangular boxes
  def aspect(w: int, h: int) -> float:
    return (w / h) if h else 9999.0

  # choose surface
  surface_cand = None
  for s in segments_payload:
    x, y, w, h = s["bbox"]
    if h <= 0:
      continue
    ar = aspect(w, h)
    # "thin" and near bottom third
    if h < 0.08 * height_px and y > height_px * 0.45:
      if surface_cand is None or w > surface_cand["bbox"][2]:
        surface_cand = s

  # pulley candidate: near top quarter and close to square
  pulley_cand = None
  best_sq_err = None
  for s in segments_payload:
    x, y, w, h = s["bbox"]
    if y < height_px * 0.35:
      ratio = abs(1 - (w / h) if h else 0)
      if best_sq_err is None or ratio < best_sq_err:
        best_sq_err = ratio
        pulley_cand = s

  # remove chosen from pool
  remaining = [s for s in segments_payload if s is not surface_cand and s is not pulley_cand]
  # masses: pick two largest by area
  remaining_sorted = sorted(remaining, key=lambda s: s["bbox"][2] * s["bbox"][3], reverse=True)
  mass_a_cand = remaining_sorted[0] if len(remaining_sorted) > 0 else None
  mass_b_cand = remaining_sorted[1] if len(remaining_sorted) > 1 else None

  detections: list[Detection] = []
  if mass_a_cand:
    detections.append(Detection(id="massA", label="block", bbox_px=tuple(mass_a_cand["bbox"])))
  if pulley_cand:
    detections.append(Detection(id="pulley", label="pulley", bbox_px=tuple(pulley_cand["bbox"])))
  if mass_b_cand:
    detections.append(Detection(id="massB", label="block", bbox_px=tuple(mass_b_cand["bbox"])))
  if surface_cand:
    detections.append(Detection(id="surface", label="table", bbox_px=tuple(surface_cand["bbox"])))

  # Fallbacks if something missing
  if not detections:
    raise HTTPException(status_code=422, detail="Could not map SAM segments to detections")

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

  # Heuristic scale assumption: derive from surface width if available; else 100px=1m
  if surface_cand:
    surf_w = surface_cand["bbox"][2]
    scale_m_per_px = 1.0 / max(100.0, float(surf_w))  # rough estimate
  else:
    scale_m_per_px = 1.0 / 100.0

  scene = example_pulley_scene(mass_a_kg=mass_a, mass_b_kg=mass_b, gravity=gravity).model_dump()
  scene["meta"] = {"diagram_scale_m_per_px": scale_m_per_px}

  meta = {
    "version": "0.1.0",
    "generator": "sam+heuristic",
    "sam_mode": settings.SAM_MODE,
    "sam_segments_count": len(segments_payload),
    "sam_http": bool(settings.SAM_HTTP_URL),
    "filename": file.filename,
  }

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
