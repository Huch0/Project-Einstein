"""Diagram parsing stub endpoint.

Accepts an uploaded image and returns deterministic mock detections plus a
pulley scene (two masses). This scaffolds the image→scene pipeline until
real CV/ML integration.
"""
from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException
from pydantic import BaseModel, Field

from app.sim.schema import example_pulley_scene

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


@router.post("/parse", response_model=DiagramParseResponse)
async def parse_diagram(file: UploadFile = File(...)) -> DiagramParseResponse:  # noqa: D401
  if file.content_type not in {"image/png", "image/jpeg", "image/jpg"}:
    raise HTTPException(status_code=400, detail="Unsupported file type")

  # NOTE: We do not actually decode the image in this stub to avoid heavy deps.
  # Provide fixed dimensions; future iteration will extract real dimensions.
  width_px = 800
  height_px = 450

  # Deterministic mock detections matching typical pulley diagram layout.
  detections = [
    Detection(id="massA", label="block", bbox_px=(120, 110, 80, 80)),
    Detection(id="pulley", label="pulley", bbox_px=(380, 60, 90, 90)),
    Detection(id="massB", label="block", bbox_px=(400, 250, 80, 80)),
    Detection(id="surface", label="table", bbox_px=(0, 180, 400, 20)),
  ]

  # Heuristic scale assumption: 100 px ~ 1 m
  scale_m_per_px = 1.0 / 100.0

  # Derive simple mass guesses from bounding box area ratio; keep deterministic.
  area_a = detections[0].bbox_px[2] * detections[0].bbox_px[3]
  area_b = detections[2].bbox_px[2] * detections[2].bbox_px[3]
  base_mass = 3.0
  mass_a = base_mass
  mass_b = base_mass * (area_b / area_a)  # ~1.0 ratio currently
  gravity = 10.0
  mu_k = 0.5

  scene = example_pulley_scene(mass_a_kg=mass_a, mass_b_kg=mass_b, gravity=gravity).model_dump()
  # Extend meta (not part of schema strict contract) - consumer should treat as optional.
  scene["meta"] = {"diagram_scale_m_per_px": scale_m_per_px}

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
  )
