# SAM HTTP Server (Real Model)

This is a minimal FastAPI server that exposes a `/segment` endpoint and runs a real Segment Anything (SAM) model to produce segments from an uploaded image.

It accepts raw image bytes (Content-Type: application/octet-stream) and returns JSON:

```json
{
  "segments": [
    { "id": 1, "bbox": [x, y, w, h], "mask_path": null }
  ]
}
```

## 1) Environment

- Python 3.10 or 3.11 recommended
- Torch CPU is fine; CUDA (optional) if you have a GPU

## 2) Install dependencies (reproducible)

We keep this server isolated from the main backend env to avoid heavy deps. Use one of the provided requirements files.

Option A — CPU-only (recommended for easy repro):

```powershell
cd backend/sam_server
uv venv --python 3.11
.venv\Scripts\Activate.ps1
uv pip install -r requirements-cpu.txt
```

Option B — GPU/CUDA (edit as needed):

```powershell
cd backend/sam_server
uv venv --python 3.11
.venv\Scripts\Activate.ps1
uv pip install -r requirements.txt
# If you need a specific CUDA build, install the matching torch/vision/audio from pytorch.org
```

- The original SAM repo provides model weights (e.g., `sam_vit_b.pth`). Download one and place it under `backend/sam_server/weights/`.

## 3) Download SAM weights

Download a checkpoint, e.g. `sam_vit_b.pth` from the official repo:
- https://github.com/facebookresearch/segment-anything#model-checkpoints

Place it here:

```
backend/sam_server/weights/sam_vit_b.pth
```

## 4) Configure which model

In `server.py`, update `MODEL_VARIANT` and `CHECKPOINT_PATH` if needed.
Defaults assume `sam_vit_b.pth`.

## 5) Run the server

```powershell
cd backend/sam_server
.venv\Scripts\Activate.ps1
uv run uvicorn server:app --host 0.0.0.0 --port 9001
```

Quick install using pip (alternate, without uv):

```powershell
cd backend/sam_server
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
pip install --upgrade pip
# CPU-only
pip install -r requirements-cpu.txt
# or, GPU/CUDA (edit requirements.txt torch lines as needed)
# pip install -r requirements.txt
```

You should see it start. The endpoint is:

```
POST http://localhost:9001/segment
Content-Type: application/octet-stream

<raw image bytes>
```

## 6) Point the backend to this server

Set these env vars when running the main backend:

```powershell
# In another terminal, for main backend
cd backend
$env:SAM_MODE = "http"
$env:SAM_HTTP_URL = "http://localhost:9001/segment"
uv run uvicorn app.main:app --reload --port 8000
```

## 7) Response mapping

This server returns bounding boxes for each generated mask. The main backend currently returns fixed `detections` (block/pulley/surface). To make detections reflect SAM output, implement a semantic mapping step (SAM masks → labels) in the main backend.

## 8) Troubleshooting

- If you get `ConnectionRefusedError`: server not running or wrong SAM_HTTP_URL.
- If you hit CUDA errors: install the proper CUDA build of torch or use CPU wheels.
- If model not found: ensure weights file path is correct.

uv run --active uvicorn server:app --host 0.0.0.0 --port 9001