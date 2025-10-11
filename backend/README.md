# Project Einstein Backend

FastAPI service providing ingestion, simulation, and tutoring APIs for Project Einstein.

## Quick start

```bash
uv sync --dev
uv run uvicorn app.main:app --reload
```

## Rapier 2D Node.js worker (optional)

This backend can run a physics simulation using Rapier 2D via a small Node.js worker.

Setup (one-time):

```powershell
# From backend/sim_worker
cd backend/sim_worker
npm install
```

Usage: the `/diagram/parse` endpoint accepts `?simulate=1` to run the worker. Ensure Node is installed and accessible as `node` on your PATH. You can override the worker path and timeout via env:

```powershell
$env:RAPIER_WORKER_PATH = "C:\\Users\\USER\\Desktop\\25-2\\Project-Einstein\\backend\\sim_worker\\rapier_worker.js"
$env:RAPIER_WORKER_TIMEOUT_S = "10"
```

Notes:
- The current worker approximates bodies as unit boxes and ignores the pulley constraint (v0). It's a placeholder to verify the bridge and data flow. We'll evolve it to respect the pulley constraint and polygons.
