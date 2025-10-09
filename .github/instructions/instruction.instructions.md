---
applyTo: '**'
---
Project Einstein – Authoritative Instruction Set

Purpose
Test an AI-powered pipeline that detects and interprets objects in physics problem diagrams (e.g., pulley systems, blocks, and ropes) using **SAM (Segment Anything Model)** and **GPT-5**, then converts them into a structured **Scene JSON** ready for simulation via **Rapier 2D (Node.js)**.


Objectives
1. Accept a physics problem diagram image (`.jpg`, `.png`).
2. Use **SAM/SAM2** for object segmentation.
3. Use **GPT-5** for semantic labeling (mass, pulley, rope, surface).
4. Generate a validated **Scene JSON** for Rapier simulation.
5. Send Scene JSON to a **Node.js Rapier Worker** and receive simulation results (positions, velocities, etc).

Implementation Steps

1. Input Handling (`backend/app/routers/diagram.py`)
- Accept .jpg or .png images uploaded to /uploads.
- Max size: 4 MB; Max dimension: 4096 px per side.

2. Segmentation (`backend/app/pipeline/`)
- Call SAM or SAM2 via API or local inference.
- Example output:
```json
{
  "segments": [
    { "id": 1, "bbox": [x, y, w, h], "mask_path": "..." },
    { "id": 2, "bbox": [x, y, w, h], "mask_path": "..." }
  ]
}
```

3. Semantic Interpretation (backend/app/agent/)

- Prompt GPT-5 with: “This image is a physics problem diagram.” “Identify each segment as a mass, pulley, rope, or surface.”
- Output example: 
```json
{
  "entities": [
    { "label": "mass", "id": "A", "mass_guess_kg": 2.0 },
    { "label": "pulley", "id": "P1" }
  ]
}
```

4. Scene Assembly (backend/app/sim/schema.py)
- Merge SAM + GPT-5 results → canonical Scene JSON:
```json
{
  "version": "0.1.0",
  "bodies": [
    { "id": "A", "mass_kg": 2, "shape": "box", "position": [0, 1] },
    { "id": "B", "mass_kg": 1, "shape": "box", "position": [0, -1] }
  ],
  "constraints": [
    { "type": "pulley", "bodies": ["A","B"], "rope_length_m": 2 }
  ],
  "parameters": { "gravity_m_s2": 9.81 },
  "meta": { "source": "test2.jpg", "detector": "sam+gpt5" }
}
```
- Validate Scene JSON using pydantic in schema.py.

5. Rapier Simulation Bridge (backend/app/tools/)
- FastAPI sends Scene JSON to Node.js Rapier Worker via REST or subprocess.
- Worker path: backend/sim_worker/rapier_worker.js
- The worker uses @dimforge/rapier2d-node:
```bash
npm install @dimforge/rapier2d-node
```
- Node.js simulates and returns:
```json
{
  "frames": [
    { "t": 0.00, "positions": {"A": [0,1.0], "B": [0,-1.0]} },
    { "t": 0.02, "positions": {"A": [0,0.98], "B": [0,-0.98]} }
  ],
  "energy": {"kinetic": 1.23, "potential": 9.81}
}
```
6. Result Handling (backend/app/routers/diagram.py)
- Receive simulation output from Node.js worker.
- Return JSON or stream animation-ready frame data.

Folder Integration Summary
Path	Role
backend/app/agent/	GPT-5 semantic reasoning
backend/app/models/	internal data models
backend/app/pipeline/	SAM segmentation pipeline
backend/app/sim/schema.py	Scene JSON schema definition
backend/app/routers/diagram.py	Upload & orchestration endpoint
backend/app/tools/	Node.js Rapier bridge utilities
backend/main.py	FastAPI app entry point

Example Flow
```javascript
POST /diagram/upload
 → SAM segmentation
 → GPT-5 interpretation
 → Scene JSON build
 → Node.js Rapier simulation
 → Response: Simulation results JSON
```

Roadmap
v0.1	SAM + GPT-5 → single pulley JSON generation
v0.2	Node.js Rapier Worker integration
v0.3	Multi-body simulation (2+ pulleys/masses)
v0.4	Real-time simulation + overlay visualization