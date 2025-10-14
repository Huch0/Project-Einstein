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
from app.sim.builder import build_scene
from app.sim.analytic import simulate_pulley_scene

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
  labels: dict | None = None


@router.post("/parse", response_model=DiagramParseResponse)
async def parse_diagram(
  file: UploadFile = File(...),
  simulate: int = Query(0, ge=0, le=1, description="If 1, run Rapier simulation and include results in meta.simulation"),
  gravity: float | None = Query(None, description="Override gravity (m/s^2) e.g. 9.81"),
  wheel_radius: float | None = Query(None, description="Override pulley wheel radius (m) for builder/scene"),
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

  # Parameters/mapping heuristics (scale) used by builder; gravity default
  gravity = float(gravity) if gravity is not None else 10.0
  mu_k = 0.5

  # Heuristic scale assumption: derive from detected surface width if available; else 100px=1m
  if len(surfaces) > 0:
    surf_w = surfaces[0].bbox_px[2]
    scale_m_per_px = 1.0 / max(100.0, float(surf_w))  # rough estimate
  else:
    scale_m_per_px = 1.0 / 100.0

  # Build Scene via Interface Builder (canonical path)
  # Convert labeler output to builder's GPT labels contract
  gpt_labels = {"entities": []}
  for e in labeled:
    props = {}
    if e.label == "pulley" and wheel_radius is not None:
      props["wheel_radius_m"] = float(wheel_radius)
    gpt_labels["entities"].append({"segment_id": str(e.id), "label": e.label, "props": props})

  builder_req = {
    "image": {"width_px": width_px, "height_px": height_px},
    "segments": segments_payload,
    "labels": gpt_labels,
    "mapping": {"origin_mode": "anchor_centered", "scale_m_per_px": scale_m_per_px},
    "defaults": {"gravity_m_s2": gravity},
  }
  built = build_scene(builder_req)
  scene = built.get("scene", {})
  # Attach mapping meta for downstream consumers
  scene.setdefault("meta", {})
  scene["meta"].update({"diagram_scale_m_per_px": scale_m_per_px, "origin_mode": "anchor_centered"})

  meta = {
    "version": "0.1.0",
    "generator": f"sam+{settings.LABELER_MODE}",
    "sam_mode": settings.SAM_MODE,
    "sam_segments_count": len(segments_payload),
    "sam_http": bool(settings.SAM_HTTP_URL),
    "filename": file.filename,
  }
  # Surface builder provenance and warnings
  meta["builder"] = built.get("meta", {})
  if built.get("warnings"):
    meta["warnings"] = built.get("warnings")
  # Surface friction and gravity hints for analytic fallback consumers
  meta["surface"] = {"mu_k": mu_k}
  meta["gravity_m_s2_hint"] = gravity

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
      # Fallback to analytic frames so the frontend still gets motion in stub mode
      try:
        analytic = simulate_pulley_scene(scene, total_time_s=2.0)
        meta["simulation"] = {
          "engine": "analytic",
          "frames_count": len(analytic.get("frames", [])),
          "frames": analytic.get("frames", []),
          "energy": analytic.get("energy", {}),
        }
        meta["simulation_error"] = str(e)
      except Exception as ee:
        meta["simulation_error"] = f"rapier:{e}; analytic:{ee}"

  # Reflect masses from the built scene for parameters
  def _mass_from_scene(scn: dict, body_id: str, default: float = 3.0) -> float:
    try:
      for b in scn.get("bodies", []):
        if b.get("id") == body_id:
          return float(b.get("mass_kg", default))
    except Exception:
      pass
    return default

  return DiagramParseResponse(
    image={"width_px": width_px, "height_px": height_px},
    detections=detections,
    parameters={
      "massA_kg": _mass_from_scene(scene, "m1"),
      "massB_kg": _mass_from_scene(scene, "m2"),
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
    labels=gpt_labels,
  )
