"""SAM/SAM2 segmentation pipeline abstraction.

Provides a pluggable interface with two modes:
- stub: returns deterministic segments without invoking any model
- http: forwards image to an external HTTP service that runs SAM and returns segments

Segment format aligns with instruction:
{
  "segments": [
    {"id": 1, "bbox": [x, y, w, h], "mask_path": "..."},
    ...
  ]
}
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple, Optional

import base64
import json

import http.client
from urllib.parse import urlparse


BBox = Tuple[int, int, int, int]


@dataclass
class Segment:
  id: int
  bbox: BBox
  mask_path: str | None = None  # optional path or data URL
  polygon_px: Optional[List[Tuple[int, int]]] = None


class SamClient:
  def __init__(self, mode: str = "http", http_url: str | None = None):
    self.mode = mode
    self.http_url = http_url

  def segment(self, image_bytes: bytes) -> List[Segment]:  # noqa: D401
    if self.mode == "stub":
      return self._segment_stub(image_bytes)
    if self.mode == "http":
      if not self.http_url:
        raise RuntimeError("SAM http mode requires http_url")
      return self._segment_via_http(image_bytes)
    raise RuntimeError(f"Unsupported SAM mode: {self.mode}")

  def _segment_via_http(self, image_bytes: bytes) -> List[Segment]:
    url = urlparse(self.http_url)  # type: ignore[arg-type]
    body = image_bytes
    headers = {"Content-Type": "application/octet-stream"}
    conn_cls = http.client.HTTPSConnection if url.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(url.hostname, url.port or (443 if url.scheme == "https" else 80))
    path = url.path or "/segment"
    conn.request("POST", path, body=body, headers=headers)
    resp = conn.getresponse()
    if resp.status != 200:
      raise RuntimeError(f"SAM HTTP error: {resp.status} {resp.reason}")
    data = resp.read()
    payload: Dict[str, Any] = json.loads(data)
    segs: List[Segment] = []
    for i, s in enumerate(payload.get("segments", []), start=1):
      bbox = tuple(s.get("bbox", [0, 0, 0, 0]))  # type: ignore[assignment]
      poly = s.get("polygon_px")
      if isinstance(poly, list):
        try:
          poly_t = [(int(p[0]), int(p[1])) for p in poly]
        except Exception:
          poly_t = None
      else:
        poly_t = None
      segs.append(Segment(id=int(s.get("id", i)), bbox=bbox, mask_path=s.get("mask_path"), polygon_px=poly_t))
    return segs

  def _segment_stub(self, image_bytes: bytes) -> List[Segment]:
    # Open image to get dimensions; if fail, default to 640x480
    try:
      from PIL import Image
      import io as _io
      _img = Image.open(_io.BytesIO(image_bytes))
      W, H = _img.size
    except Exception:
      W, H = 640, 480

    # Define simple boxes approximating the provided diagram:
    # - A left block (3 kg) on a horizontal surface near the top-left
    # - A pulley near the top-right corner
    # - A hanging block (6 kg) on the right side, lower than the pulley
    # - The surface as a thin horizontal bar across the image near the top
    # Proportions scale with image size
    surf_h = max(4, int(0.012 * H))
    mass_w = max(20, int(0.12 * W))
    mass_h = max(20, int(0.12 * H))
    pulley_w = max(16, int(0.08 * W))
    pulley_h = pulley_w

    # Layout anchors (fractional positions tuned for the attached sketch)
    surface_y = int(0.22 * H)
    left_mass_x = int(0.10 * W)
    left_mass_y = surface_y - mass_h  # sit on surface

    pulley_x = int(0.62 * W)
    pulley_y = int(0.18 * H)

    right_mass_x = int(0.78 * W)
    right_mass_y = int(0.55 * H)

    def rect_poly(x: int, y: int, w: int, h: int):
      return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]

    segs: List[Segment] = []
    segs.append(Segment(id=1, bbox=(left_mass_x, left_mass_y, mass_w, mass_h), mask_path=None, polygon_px=rect_poly(left_mass_x, left_mass_y, mass_w, mass_h)))
    segs.append(Segment(id=2, bbox=(right_mass_x, right_mass_y, mass_w, mass_h), mask_path=None, polygon_px=rect_poly(right_mass_x, right_mass_y, mass_w, mass_h)))
    segs.append(Segment(id=3, bbox=(pulley_x, pulley_y, pulley_w, pulley_h), mask_path=None, polygon_px=rect_poly(pulley_x, pulley_y, pulley_w, pulley_h)))
    segs.append(Segment(id=4, bbox=(0, surface_y, W, surf_h), mask_path=None, polygon_px=rect_poly(0, surface_y, W, surf_h)))
    return segs


def _tiny_png_data_url() -> str:
  # A minimal 1x1 transparent PNG
  # fmt: off
  b64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
  )
  # fmt: on
  return f"data:image/png;base64,{b64}"


__all__ = ["Segment", "SamClient"]
