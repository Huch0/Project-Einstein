from fastapi.testclient import TestClient
from PIL import Image
import io
import os
import shutil

from app.main import app


def _fake_png_bytes(w=100, h=80) -> bytes:
  img = Image.new("RGB", (w, h), color=(200, 200, 200))
  bio = io.BytesIO()
  img.save(bio, format="PNG")
  return bio.getvalue()


def test_parse_diagram_stub_labeler(monkeypatch):
  # Force stub labeler and SAM stub url to avoid network
  monkeypatch.setenv("LABELER_MODE", "stub")
  monkeypatch.setenv("SAM_MODE", "http")
  # Simulate SAM segments by monkeypatching client
  from app.pipeline.sam_detector import SamClient, Segment

  def fake_segment(self, image_bytes: bytes):
    return [
      Segment(id=1, bbox=(10, 30, 20, 20), mask_path=None, polygon_px=[(10,30),(30,30),(30,50),(10,50)]),
      Segment(id=2, bbox=(60, 28, 18, 18), mask_path=None, polygon_px=[(60,28),(78,28),(78,46),(60,46)]),
      Segment(id=3, bbox=(40, 5, 15, 15), mask_path=None, polygon_px=[(40,5),(55,5),(55,20),(40,20)]),
      Segment(id=4, bbox=(0, 60, 100, 10), mask_path=None, polygon_px=[(0,60),(100,60),(100,70),(0,70)]),
    ]

  monkeypatch.setattr(SamClient, "segment", fake_segment, raising=True)

  client = TestClient(app)
  files = {"file": ("t.png", _fake_png_bytes(), "image/png")}
  r = client.post("/diagram/parse", files=files)
  assert r.status_code == 200
  data = r.json()
  assert data["image"]["width_px"] == 100
  assert len(data["detections"]) >= 2
  assert data["segments"][0]["polygon_px"]


def test_parse_diagram_simulation_flag_no_node(monkeypatch):
  # Force stub labeler and fake SAM; request simulate=1; with no node, should report simulation_error in meta
  monkeypatch.setenv("LABELER_MODE", "stub")
  from app.pipeline.sam_detector import SamClient, Segment

  def fake_segment(self, image_bytes: bytes):
    return [Segment(id=1, bbox=(10, 30, 20, 20), mask_path=None, polygon_px=[(10,30),(30,30),(30,50),(10,50)])]

  monkeypatch.setattr(SamClient, "segment", fake_segment, raising=True)

  # Ensure node not on path for this test by checking; if present, skip to avoid flakiness
  if shutil.which("node"):
    return

  client = TestClient(app)
  files = {"file": ("t.png", _fake_png_bytes(), "image/png")}
  r = client.post("/diagram/parse?simulate=1", files=files)
  assert r.status_code == 200
  meta = r.json()["meta"]
  assert "simulation_error" in meta
