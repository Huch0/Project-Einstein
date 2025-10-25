"""Diagram parsing endpoint.

Accepts an uploaded image and returns detections, scene, and optional simulation.
Orchestrates SAM segmentation → GPT labeling → Scene building → Matter.js physics.
"""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException, Query
import logging
import json
from PIL import Image
import io
from pydantic import BaseModel, Field

from app.sim.schema import example_pulley_scene
from app.pipeline.sam_detector import SamClient
from app.agent.labeler import get_labeler, SegmentIn
from app.sim.physics import simulate_scene, simulate_pulley_scene, simulate_ramp_scene
from app.models.settings import settings
from app.sim.builder import build_scene as build_scene_v1
from app.sim.registry import build_scene_v2

router = APIRouter(prefix="/diagram", tags=["diagram"])
logger = logging.getLogger("diagram")


class Detection(BaseModel):
  id: str
  label: str
  bbox_px: tuple[int, int, int, int]  # x,y,w,h
  source_segment_id: int | str | None = None
  polygon_px: list[tuple[float, float]] | None = None  # precise object outline from SAM


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
  simulate: int = Query(0, ge=0, le=1, description="If 1, run Matter.js simulation and include results in meta.simulation"),
  gravity: float | None = Query(None, description="Override gravity (m/s^2) e.g. 9.81"),
  wheel_radius: float | None = Query(None, description="Override pulley wheel radius (m) for builder/scene"),
  debug: int = Query(0, ge=0, le=1, description="If 1, include detailed builder/labeler information in meta.debug and log it."),
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

  # Prepare compact debug view of labeler output
  debug_labeler_entities = [
    {
      "id": str(e.id),
      "label": e.label,
      "bbox_px": list(e.bbox_px),
      "props": getattr(e, "props", {}),
    }
    for e in labeled
  ]

  # Map labeled entities to detections (dynamic based on GPT labeling)
  # GPT determines what entities exist; we assign canonical IDs for frontend compatibility
  segment_map = {s.id: s for s in segs}
  
  detections: list[Detection] = []
  
  # Collect masses and sort by x position for deterministic ordering
  masses = [e for e in labeled if e.label == "mass"]
  masses_sorted = sorted(masses, key=lambda e: e.bbox_px[0])
  
  # Add masses with canonical IDs (massA for first, massB for second, then mass_2, mass_3, ...)
  # This maintains frontend compatibility while allowing GPT to determine mass count
  for idx, mass in enumerate(masses_sorted):
    seg = segment_map.get(mass.id)
    if idx == 0:
      mass_id = "massA"
    elif idx == 1:
      mass_id = "massB"
    else:
      mass_id = f"mass_{idx}"  # Additional masses beyond pulley constraint
    
    detections.append(Detection(
      id=mass_id,
      label="block", 
      bbox_px=tuple(mass.bbox_px), 
      source_segment_id=mass.id,
      polygon_px=seg.polygon_px if seg and seg.polygon_px else None
    ))
  
  # Add pulleys with canonical ID (pulley for first, then pulley_1, pulley_2, ...)
  pulleys = [e for e in labeled if e.label == "pulley"]
  for idx, pulley in enumerate(pulleys):
    seg = segment_map.get(pulley.id)
    pulley_id = "pulley" if idx == 0 else f"pulley_{idx}"
    detections.append(Detection(
      id=pulley_id,
      label="pulley", 
      bbox_px=tuple(pulley.bbox_px), 
      source_segment_id=pulley.id,
      polygon_px=seg.polygon_px if seg and seg.polygon_px else None
    ))
  
  # Add surfaces with canonical ID (surface for first, then surface_1, surface_2, ...)
  surfaces = [e for e in labeled if e.label == "surface"]
  for idx, surface in enumerate(surfaces):
    seg = segment_map.get(surface.id)
    surface_id = "surface" if idx == 0 else f"surface_{idx}"
    detections.append(Detection(
      id=surface_id,
      label="table", 
      bbox_px=tuple(surface.bbox_px), 
      source_segment_id=surface.id,
      polygon_px=seg.polygon_px if seg and seg.polygon_px else None
    ))

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
  # v0.2 label envelope (with v0.1 compatibility via 'type' mirroring 'label')
  gpt_labels = {"version": "v0.2", "entities": []}
  for e in labeled:
    # Forward labeler props verbatim so builder can use mass guesses, gravity, friction, etc.
    props = dict(getattr(e, "props", {}) or {})
    if e.label == "pulley" and wheel_radius is not None:
      props["wheel_radius_m"] = float(wheel_radius)
    gpt_labels["entities"].append({"segment_id": str(e.id), "type": e.label, "label": e.label, "props": props})

  builder_req = {
    "image": {"width_px": width_px, "height_px": height_px},
    "segments": segments_payload,
    "labels": gpt_labels,
    "mapping": {"origin_mode": "anchor_centered", "scale_m_per_px": scale_m_per_px},
    "defaults": {"gravity_m_s2": gravity},
  }
  # Build via v2 registry first; fallback to v1 builder on error
  try:
    built = build_scene_v2(builder_req)
  except Exception as _err:
    built = build_scene_v1(builder_req)
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

  # Optionally include detailed debug info in response + logs
  if debug == 1:
    # Summarize scene for quick inspection
    try:
      bodies = scene.get("bodies", [])
      cons = (scene.get("constraints", []) or [{}])[0]
      scene_summary = {
        "masses": {b.get("id"): {"mass_kg": b.get("mass_kg"), "position_m": b.get("position_m")} for b in bodies},
        "pulley": {
          "anchor_m": cons.get("pulley_anchor_m"),
          "wheel_radius_m": cons.get("wheel_radius_m"),
          "rope_length_m": cons.get("rope_length_m"),
        },
        "world": scene.get("world", {}),
      }
    except Exception:
      scene_summary = {"error": "failed_to_summarize_scene"}

    debug_blob = {
      "image": {"width_px": width_px, "height_px": height_px},
      "mapping": {"origin_mode": "anchor_centered", "scale_m_per_px": scale_m_per_px},
      "labeler_entities": debug_labeler_entities,
      "builder_request": builder_req,
      "scene_summary": scene_summary,
    }
    meta["debug"] = debug_blob
    try:
      logger.info("diagram.debug %s", json.dumps(debug_blob, ensure_ascii=False))
    except Exception:
      pass

  # Optionally run simulation of the assembled scene
  if simulate == 1:
    try:
      kind = (built.get("meta") or {}).get("scene_kind", scene.get("kind"))
      if kind == "pulley.single_fixed_v0":
        # Try Matter.js with rope constraint enforcement
        try:
          sim_result = simulate_scene(scene)
          frames = sim_result.get("frames", [])
          if frames and len(frames) > 0:
            meta["simulation"] = {"engine": "matter-js", "frames_count": len(frames), "frames": frames, "energy": sim_result.get("energy", {})}
          else:
            raise RuntimeError("Matter.js returned empty frames")
        except Exception as matter_err:
          logger.warning(f"Matter.js simulation failed: {matter_err}, falling back to analytic")
          analytic = simulate_pulley_scene(scene, total_time_s=2.0)
          meta["simulation"] = {"engine": "analytic", "frames_count": len(analytic.get("frames", [])), "frames": analytic.get("frames", []), "energy": analytic.get("energy", {})}
      elif kind == "ramp.block_v0":
        analytic = simulate_ramp_scene(scene, total_time_s=2.0)
        meta["simulation"] = {"engine": "analytic", "frames_count": len(analytic.get("frames", [])), "frames": analytic.get("frames", []), "energy": analytic.get("energy", {})}
      else:
        # Unknown kind: attempt analytic pulley as a safe default
        analytic = simulate_pulley_scene(scene, total_time_s=2.0)
        meta["simulation"] = {"engine": "analytic", "frames_count": len(analytic.get("frames", [])), "frames": analytic.get("frames", []), "energy": analytic.get("energy", {})}
    except Exception as e:
      # Fallback to analytic frames so the frontend still gets motion in stub mode
      try:
        kind = (built.get("meta") or {}).get("scene_kind", scene.get("kind"))
        if kind == "ramp.block_v0":
          analytic = simulate_ramp_scene(scene, total_time_s=2.0)
        else:
          analytic = simulate_pulley_scene(scene, total_time_s=2.0)
        meta["simulation"] = {
          "engine": "analytic",
          "frames_count": len(analytic.get("frames", [])),
          "frames": analytic.get("frames", []),
          "energy": analytic.get("energy", {}),
        }
        meta["simulation_error"] = str(e)
      except Exception as ee:
        meta["simulation_error"] = f"matter:{e}; analytic:{ee}"

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
