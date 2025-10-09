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
from typing import Any, Dict, List, Tuple

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


class SamClient:
  def __init__(self, mode: str = "stub", http_url: str | None = None):
    self.mode = mode
    self.http_url = http_url

  def segment(self, image_bytes: bytes) -> List[Segment]:  # noqa: D401
    if self.mode != "http":
      raise RuntimeError("SAM client is configured to only support 'http' mode now.")
    if not self.http_url:
      raise RuntimeError("SAM http mode requires http_url")
    return self._segment_via_http(image_bytes)

  # Stub method removed to enforce real SAM usage

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
      segs.append(Segment(id=int(s.get("id", i)), bbox=bbox, mask_path=s.get("mask_path")))
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
