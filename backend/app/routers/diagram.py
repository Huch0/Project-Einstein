"""Diagram parsing endpoint (v0.4 - Universal Builder).

Accepts an uploaded image and returns detections, scene, and optional simulation.
Orchestrates SAM segmentation → GPT labeling → Universal Builder → Matter.js physics.
"""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException, Query
from fastapi.responses import Response
import logging
import json
import http.client
from urllib.parse import urlparse
from PIL import Image
import io
from uuid import uuid4
from pathlib import Path
from pydantic import BaseModel, Field

from app.sim.schema import example_pulley_scene
from app.agent.tools.label_segments import label_segments, LabelSegmentsInput
from app.sim.physics import simulate_scene
from app.models.settings import settings
from app.sim.universal_builder import build_scene_universal

router = APIRouter(prefix="/diagram", tags=["diagram"])
logger = logging.getLogger("diagram")


def _segment_via_http(image_bytes: bytes, sam_server_url: str) -> list[dict]:
    """Call SAM server via HTTP POST with raw image bytes."""
    parsed = urlparse(sam_server_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 9001
    path = parsed.path or "/segment"
    
    # SAM server expects raw image bytes (not multipart)
    headers = {
        "Content-Type": "application/octet-stream",
        "Content-Length": str(len(image_bytes))
    }
    
    logger.info(f"Sending image to SAM server: {len(image_bytes)} bytes")
    
    conn = http.client.HTTPConnection(host, port, timeout=30)
    conn.request("POST", path, image_bytes, headers)
    response = conn.getresponse()
    
    if response.status != 200:
        error_body = response.read().decode()
        logger.error(f"SAM server error {response.status}: {error_body}")
        raise ValueError(f"SAM server error: {response.status}")
    
    data = json.loads(response.read().decode())
    conn.close()
    
    logger.info(f"Received {len(data.get('segments', []))} segments from SAM")
    return data.get("segments", [])


def _segment_stub(image_bytes: bytes) -> list[dict]:
    """Generate stub segments for testing."""
    W, H = 800, 600
    return [
        {"id": 1, "bbox": [100, 350, 80, 80], "polygon_px": [[100,350],[180,350],[180,430],[100,430]], "mask_path": None},
        {"id": 2, "bbox": [620, 350, 80, 80], "polygon_px": [[620,350],[700,350],[700,430],[620,430]], "mask_path": None},
        {"id": 3, "bbox": [360, 80, 80, 80], "polygon_px": [[400,90],[430,110],[430,140],[400,160],[370,140],[370,110]], "mask_path": None},
        {"id": 4, "bbox": [0, 550, W, 50], "polygon_px": [[0,550],[W,550],[W,600],[0,600]], "mask_path": None}
    ]


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

  # SAM segmentation (http or stub based on settings)
  if settings.SAM_MODE == "http" and settings.SAM_HTTP_URL:
    raw_segments = _segment_via_http(contents, settings.SAM_HTTP_URL)
  else:
    raw_segments = _segment_stub(contents)
  
  segments_payload = [
    {
      "id": s["id"],
      "bbox": s["bbox"],
      "mask_path": s.get("mask_path"),
      "polygon_px": s.get("polygon_px")
    }
    for s in raw_segments
  ]

  # Label segments using configured labeler (stub|openai)
  labeled_result = await label_segments(LabelSegmentsInput(
    image_id="diagram_upload",
    segments=segments_payload,
    context="physics diagram",
    use_vision=True
  ))
  labeled = labeled_result.entities

  # Prepare compact debug view of labeler output
  debug_labeler_entities = [
    {
      "id": str(e.segment_id),
      "label": e.type,
      "props": e.props.model_dump(exclude_none=True) if e.props else {},
    }
    for e in labeled
  ]

  # Map labeled entities to detections (dynamic based on GPT labeling)
  # GPT determines what entities exist; we assign canonical IDs for frontend compatibility
  segment_map = {s["id"]: s for s in raw_segments}
  
  detections: list[Detection] = []
  
  # Collect masses and sort by x position for deterministic ordering
  masses = [e for e in labeled if e.type == "mass"]
  
  # Get bbox for sorting (need to lookup from segments)
  def get_bbox_x(entity):
    seg = segment_map.get(int(entity.segment_id) if entity.segment_id.isdigit() else entity.segment_id)
    return seg["bbox"][0] if seg else 0
  
  masses_sorted = sorted(masses, key=get_bbox_x)
  
  # Add masses with canonical IDs (massA for first, massB for second, then mass_2, mass_3, ...)
  # This maintains frontend compatibility while allowing GPT to determine mass count
  for idx, mass in enumerate(masses_sorted):
    seg = segment_map.get(int(mass.segment_id) if mass.segment_id.isdigit() else mass.segment_id)
    if not seg:
      continue
      
    if idx == 0:
      mass_id = "massA"
    elif idx == 1:
      mass_id = "massB"
    else:
      mass_id = f"mass_{idx}"  # Additional masses beyond pulley constraint
    
    detections.append(Detection(
      id=mass_id,
      label="block", 
      bbox_px=tuple(seg["bbox"]), 
      source_segment_id=mass.segment_id,
      polygon_px=seg.get("polygon_px") if seg else None
    ))
  
  # Add pulleys with canonical ID (pulley for first, then pulley_1, pulley_2, ...)
  pulleys = [e for e in labeled if e.type == "pulley"]
  for idx, pulley in enumerate(pulleys):
    seg = segment_map.get(int(pulley.segment_id) if pulley.segment_id.isdigit() else pulley.segment_id)
    if not seg:
      continue
      
    pulley_id = "pulley" if idx == 0 else f"pulley_{idx}"
    detections.append(Detection(
      id=pulley_id,
      label="pulley", 
      bbox_px=tuple(seg["bbox"]), 
      source_segment_id=pulley.segment_id,
      polygon_px=seg.get("polygon_px") if seg else None
    ))
  
  # Add surfaces with canonical ID (surface for first, then surface_1, surface_2, ...)
  surfaces = [e for e in labeled if e.type == "surface"]
  for idx, surface in enumerate(surfaces):
    seg = segment_map.get(int(surface.segment_id) if surface.segment_id.isdigit() else surface.segment_id)
    if not seg:
      continue
      
    surface_id = "surface" if idx == 0 else f"surface_{idx}"
    detections.append(Detection(
      id=surface_id,
      label="table", 
      bbox_px=tuple(seg["bbox"]), 
      source_segment_id=surface.segment_id,
      polygon_px=seg.get("polygon_px") if seg else None
    ))

  if not detections:
    raise HTTPException(status_code=422, detail="Labeler returned no usable entities")

  # Parameters/mapping heuristics (scale) used by builder; gravity default
  gravity = float(gravity) if gravity is not None else 10.0
  mu_k = 0.5

  # Heuristic scale assumption: derive from detected surface width if available; else 100px=1m
  if len(surfaces) > 0:
    surf_seg = segment_map.get(int(surfaces[0].segment_id) if surfaces[0].segment_id.isdigit() else surfaces[0].segment_id)
    surf_w = surf_seg["bbox"][2] if surf_seg else 100
    scale_m_per_px = 1.0 / max(100.0, float(surf_w))  # rough estimate
  else:
    scale_m_per_px = 1.0 / 100.0

  # Build Scene via Universal Builder (v0.4)
  # Convert labeler output to universal builder's entity contract
  gpt_labels = {"version": "v0.4", "entities": []}
  for e in labeled:
    # Forward labeler props verbatim so builder can use mass guesses, gravity, friction, etc.
    props = e.props.model_dump(exclude_none=True) if e.props else {}
    if e.type == "pulley" and wheel_radius is not None:
      props["wheel_radius_m"] = float(wheel_radius)
    gpt_labels["entities"].append({
      "segment_id": str(e.segment_id), 
      "type": e.type, 
      "label": e.type, 
      "props": props
    })

  builder_req = {
    "image": {"width_px": width_px, "height_px": height_px},
    "segments": segments_payload,
    "labels": gpt_labels,
    "mapping": {"origin_mode": "anchor_centered", "scale_m_per_px": scale_m_per_px},
    "defaults": {"gravity_m_s2": gravity},
  }
  
  # Build via universal builder (no fallback needed)
  built = build_scene_universal(builder_req)
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

  # Optionally run simulation (Matter.js only in v0.4)
  if simulate == 1:
    try:
      sim_result = simulate_scene(scene)
      frames = sim_result.get("frames", [])
      if frames and len(frames) > 0:
        meta["simulation"] = {
          "engine": "matter-js",
          "frames_count": len(frames),
          "frames": frames,
          "energy": sim_result.get("energy", {})
        }
      else:
        meta["simulation_error"] = "Matter.js returned empty frames"
    except Exception as e:
      meta["simulation_error"] = str(e)

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


# ===========================
# Image Upload Endpoint
# ===========================

# In-memory storage for uploaded images (replace with S3/database in production)
_uploaded_images: dict[str, bytes] = {}


class ImageUploadResponse(BaseModel):
    """Response for image upload."""
    image_id: str = Field(description="Unique image ID")
    width_px: int = Field(description="Image width in pixels")
    height_px: int = Field(description="Image height in pixels")
    content_type: str = Field(description="Image MIME type")
    size_bytes: int = Field(description="Image file size")


@router.post("/upload", response_model=ImageUploadResponse)
async def upload_image(
    file: UploadFile = File(..., description="Image file to upload")
) -> ImageUploadResponse:
    """
    Upload an image for later use in Agent mode.
    
    The image is stored temporarily with a unique ID that can be used
    in chat attachments.
    
    Example:
        POST /diagram/upload
        Content-Type: multipart/form-data
        file: <image file>
        
        Response:
        {
            "image_id": "img_abc123",
            "width_px": 800,
            "height_px": 600,
            "content_type": "image/jpeg",
            "size_bytes": 52341
        }
    """
    if file.content_type not in {"image/png", "image/jpeg", "image/jpg"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Use PNG or JPEG."
        )
    
    # Read image bytes
    contents = await file.read()
    
    # Validate image
    try:
        img = Image.open(io.BytesIO(contents))
        width, height = img.size
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image file: {str(e)}"
        )
    
    # Generate unique ID
    image_id = f"img_{uuid4().hex[:12]}"
    
    # Store image in memory (TODO: replace with S3/database)
    _uploaded_images[image_id] = contents
    
    logger.info(f"Uploaded image {image_id}: {width}x{height}px, {len(contents)} bytes")
    
    return ImageUploadResponse(
        image_id=image_id,
        width_px=width,
        height_px=height,
        content_type=file.content_type or "image/jpeg",
        size_bytes=len(contents)
    )


@router.get("/image/{image_id}")
async def get_uploaded_image(image_id: str):
    """
    Retrieve an uploaded image by ID.
    
    Returns the raw image bytes with appropriate Content-Type header.
    """
    if image_id not in _uploaded_images:
        raise HTTPException(
            status_code=404,
            detail=f"Image {image_id} not found"
        )
    
    image_bytes = _uploaded_images[image_id]
    
    # Detect content type
    try:
        img = Image.open(io.BytesIO(image_bytes))
        content_type = f"image/{img.format.lower()}" if img.format else "image/jpeg"
    except Exception:
        content_type = "image/jpeg"
    
    return Response(content=image_bytes, media_type=content_type)


def get_uploaded_image_bytes(image_id: str) -> bytes:
    """
    Get image bytes by ID (for internal use by tools).
    
    Raises:
        ValueError: If image_id not found
    """
    if image_id not in _uploaded_images:
        raise ValueError(f"Image {image_id} not found in uploaded images")
    
    return _uploaded_images[image_id]
