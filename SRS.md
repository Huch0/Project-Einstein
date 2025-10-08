# 0. Scope & Goals

* **Goal**: A web app where users upload a static physics diagram, convert it into a simulation, iteratively refine via chat, and receive educational guidance (scaffolding, short checks).
* **Key constraints**:

  * Right-top has two stacked layers: **Simulation (bottom)** and **Ink/Annotation (top, persistent)**.
  * Right-bottom has a **control pane** (parameters & run controls).
  * Left is a **chat interface** that drives edits and tutoring.
  * An **agent built with LangGraph** calls predefined **simulation tools** (server functions) to patch the scene graph and run/compare simulations.

---

# 1. Roles & Primary Workflows

## 1.1 Roles

* **Learner** (default): upload/convert, chat, annotate, run sims, receive guidance.
* **Instructor/Researcher** (later): create tasks, export logs, run A/B toggles.
* **Admin**: manage users, storage quotas.

## 1.2 Workflows (must-have)

### WF-1 Upload → Convert

1. User uploads an image/PDF crop.
2. Backend pipeline: preprocessing → segmentation → polygonization → OCR → entity/constraint inference → SceneGraph JSON.
3. Return: scene_id, overlay (vector) for visual confirmation, list of ambiguities.

**Acceptance**

* Given a 1000×1000 textbook diagram, conversion returns within **≤5s** with ≥1 entity and either a valid SceneGraph or actionable ambiguities.

### WF-2 Revise via Chat

1. User types a request (e.g., “Set the ramp angle to 45°, friction μ=0.2”).
2. **LangGraph agent** parses intent, calls tools (e.g., `set_param`, `add_constraint`).
3. SceneGraph patches applied; simulation re-renders; diff summary posted to chat.

**Acceptance**

* Any tool call must round-trip through schema validation and produce either an applied patch list or a typed error surfaced to the user.

### WF-3 Educational Guidance

1. System detects scene pattern (e.g., “inclined plane + friction”).
2. Offers scaffold (“Predict displacement before running”), runs quick checks, explains “why” using current scene values.

**Acceptance**

* For each supported pattern, at least one **Scaffold**, **What-if**, **Check**, and **Why** message is available and parameterized.

---

# 2. System Architecture & Tech Stack

## 2.1 Frontend

* **Next.js (React + TypeScript)**, **Zustand** (UI state), **React Query** (server state).
* **Rendering**:

  * **Simulation**: **PixiJS** (WebGL2) for 2D; physics on client uses **Planck.js**.
  * **Ink/Annotation**: **Konva.js** on a separate `<canvas>` above the sim (persistent).
* **Input**: Pointer Events (stylus & mouse), keyboard shortcuts; accessible focus order.
* **UI**: shadcn/ui for chat & controls; right-bottom controls pane with sliders/toggles.

## 2.2 Backend

* **FastAPI (Python)** for AI/CV & simulation services; **Uvicorn** ASGI.
* **Celery + Redis** for conversion jobs.
* **Postgres** (core DB), **S3/MinIO** (uploads, overlays, snapshots).
* **WebSocket** (Socket.IO or ASGI websockets) for job status, chat streaming.
* **LangGraph** agent service (Python) within FastAPI process or as a sidecar.

## 2.3 DevOps

* Dockerized services; local `docker-compose`; prod on k8s (or Fly.io for MVP).
* CI: GitHub Actions → tests → build → deploy.
* Observability: Sentry (FE/BE), Prometheus/Grafana, OpenTelemetry spans.

---

# 3. UI Requirements

## 3.1 Layout

* **Left 50%**: Chat panel (messages, tool diffs, inline chips for rollbacks).
* **Right top 50% height**:

  * **Canvas A (bottom)**: Simulation rendering surface.
  * **Canvas B (top)**: Annotation layer (Konva) sharing the same world→screen transform; must persist across simulation updates.
* **Right bottom 50% height**: Controls pane (parameters, run/step/reset, snapshot/compare).

## 3.2 Interaction

* Pan/zoom (wheel + ctrl/⌘), snap to guides, rulers.
* Undo/redo for both SceneGraph and Ink independently.
* Keyboard a11y for all controls; ARIA labels.

## 3.3 Performance Budgets

* 60 fps for ≤100 bodies/constraints scenes on a mid-range laptop (WebGL2).
* Chat round trip ≤3s for common edit ops.

---

# 4. Data Models (authoritative JSON/Pydantic)

```json
// SceneGraph v1
{
  "id": "scene_123",
  "meta": {"version": 1, "units": "SI"},
  "objects": [
    {"id":"obj:box1","type":"rigid","shape":{"kind":"rect","w":1.0,"h":0.5},
     "pose":{"x":0,"y":0,"theta":0},"material":{"density":1.0,"friction":0.4,"restitution":0.0},
     "labels":["block"],"confidence":0.92}
  ],
  "constraints": [
    {"id":"con:ground","type":"plane","params":{"normal":[0,1],"offset":-2.0}, "confidence":0.9}
  ],
  "params":{"g":9.81,"dt":0.016,"solver":"velocity"},
  "ambiguities":[
    {"id":"amb:001","kind":"symbol","candidate_labels":["pulley","wheel"],"bbox":[...],"confidence":0.55}
  ]
}
```

```python
# Patch op schema (union)
class SceneGraphOp(BaseModel):
    op: Literal["add_object","remove_object","edit_object",
                "add_constraint","remove_constraint","edit_constraint",
                "set_param"]
    path: str  # JSONPath-like, e.g., $.objects[id=="obj:box1"].material.friction
    value: Any
```

```json
// Run result
{
  "run_id":"run_456",
  "scene_id":"scene_123",
  "params":{"steps":600,"seed":42},
  "trace":{
    "t":[0.0,0.016,...],
    "positions":{"obj:box1":[[0,0],[0.01,-0.02],...]},
    "energies":{"kin":[...],"pot":[...]}
  },
  "snapshots":[{"time":0.0,"png_url":"s3://..."},{"time":1.0,"png_url":"s3://..."}],
  "summary":{"max_speed":..., "stopped": false}
}
```

---

# 5. API (MVP Endpoints)

* `POST /ingest/diagram` → body `{file: multipart, options?:{dpi?, denoise?}}`
  **200** `{job_id}`

* `WS /jobs/{job_id}` → emits `{status: "queued|running|done|error", progress?, result?}`
  **result** `{scene_id, overlay_url, ambiguities[]}`

* `GET /scene/{id}` → returns **SceneGraph**

* `POST /scene/{id}/apply_ops` → body `{ops: SceneGraphOp[]}`
  **200** `{applied:[], rejected:[], new_version, diff:[]}`

* `POST /simulate/{id}/run` → body `{steps?, dt?, seed?, outputs?:["trace","snapshots","summary"]}`
  **200** **Run result** (above)

* `POST /chat/{scene_id}/turn` → `{message: string}`
  **200** `{messages:[], tool_calls:[], diffs:[]}`

* `GET /tutor/{scene_id}/suggest` → `{scaffold?:[], what_if?:[], checks?:[], why?:[]}`

* `GET /eval/alignment/{scene_id}` → `{score:0..1, entity_diff:[], constraint_diff:[]}`

**Error model** (all endpoints):
`{error_code, message, details?, remediation?}`; 4xx are user/validation; 5xx internal.

---

# 6. Diagram Conversion Pipeline (server)

Stages (Celery task):

1. **Preprocess**: denoise, dewarp/skew correction, binarization.
2. **Segmentation**: detect primitives (lines/arrows/shapes/symbols) and text regions.
3. **Polygonization/Vectorization**: contours → polygons (Douglas–Peucker), splines for curves.
4. **OCR/Units**: extract labels/values (e.g., “μ=0.2”, “m=1kg”), normalize units.
5. **Entity & Constraint Inference**: map vectors to forces, planes, joints; set defaults if missing.
6. **Ambiguity Builder**: any low-confidence element becomes an `ambiguity` with candidates.
7. **Validation**: quick headless run (pybox2d) to catch impossible scenes.

Outputs: `SceneGraph`, `overlay_url` (SVG/JSON vectors), `ambiguities[]`.

---

# 7. Simulation Layer

* **Client**: Planck.js integrates the **SceneGraph** to bodies/joints; shares view transform with Ink layer.
* **Server**: pybox2d for headless regression & batch “what-if” runs (optional in MVP).
* **Controls pane**: standard set—play/pause/step/reset, dt slider, gravity toggle, parameter sliders bound to `params` and object materials.

**Determinism**: `seed` stored with each run; same SceneGraph + seed ⇒ same trace within tolerance.

---

# 8. Tool-Using Agent (LangGraph)

## 8.1 Graph Topology

* **Nodes**:

  * `PlannerLLM`: parses user message → intent + candidate ops.
  * `ToolRouter`: decides which tool(s) to call in sequence/parallel.
  * `ToolExecutor`: executes tools (below) with strict schema validation.
  * `Validator`: sanity check post-patch (no NaNs, bodies not overlapping).
  * `Memory`: short-term (turn window) + long-term (scene summary).
  * `Pedagogy`: suggests scaffold/what-if/checks when appropriate.
  * `HumanConfirm` (conditional): required if ambiguity high or destructive ops.
* **Edges**: Planner → Router → Executor → Validator → (Pedagogy) → Output to chat.

## 8.2 Tool Catalog (authoritative)

All tools are **idempotent** where applicable and return `{ok, changes[], warnings[]}` (or `{ok:false, error}`).

```python
# Signatures (FastAPI handlers; LangGraph tool bindings)

def tool_add_object(scene_id:str, object: ObjectSpec) -> ToolResp: ...
def tool_remove_object(scene_id:str, object_id:str) -> ToolResp: ...
def tool_edit_object(scene_id:str, object_id:str, patch: dict) -> ToolResp: ...

def tool_add_constraint(scene_id:str, constraint: ConstraintSpec) -> ToolResp: ...
def tool_remove_constraint(scene_id:str, constraint_id:str) -> ToolResp: ...
def tool_edit_constraint(scene_id:str, constraint_id:str, patch: dict) -> ToolResp: ...

def tool_set_param(scene_id:str, key:str, value: Any) -> ToolResp: ...

def tool_run_sim(scene_id:str, steps:int=600, dt:float=0.016, seed:int|None=None,
                 outputs:list[str]=["summary"]) -> RunResp: ...

def tool_snapshot(scene_id:str, time:float|str="now") -> SnapshotResp: ...
def tool_compare_runs(run_ids:list[str], metrics:list[str]) -> CompareResp: ...

def tool_query_state(scene_id:str, query: dict) -> QueryResp: ...
def tool_highlight_overlay(scene_id:str, targets:list[str], color:str="yellow") -> ToolResp: ...

def tool_ask_user_confirmation(prompt:str, options:list[str]) -> UserChoice: ...
```

**Schemas**:

* `ObjectSpec` supports `type`, `shape(kind, params)`, `pose`, `material(density, friction, restitution)`, `labels[]`.
* `ConstraintSpec` supports `type` ∈ {`plane`,`pin`,`hinge`,`distance`,`motor`}, endpoints, params.
* All tools enforce Pydantic models; PlannerLLM generates **only** these JSON shapes.

## 8.3 Guardrails

* Tools reject unknown keys and out-of-range values with actionable messages.
* `Validator` runs after each mutating tool; on failure, it **auto-reverts** to the previous SceneGraph version and posts the reason.
* High-impact ops (remove many objects, change units) require `tool_ask_user_confirmation`.

## 8.4 Prompting (summary)

* System prompt: “You are a simulation editor. Produce only valid tool calls…”
* Few-shot examples for common tasks (set μ, change θ, add pulley).
* Hard rules: never invent IDs; fetch with `tool_query_state` before editing.

---

# 9. Pedagogy Engine

* **Pattern rules** keyed on SceneGraph: e.g., `incline+block`, `projectile`, `pendulum`.
* For each pattern:

  * **Scaffold**: prediction prompt + slider preset(s).
  * **What-if**: parameter perturbations (μ, θ, v₀) and expected qualitative change.
  * **Check**: 1–2 multiple-choice or numeric questions, autograded against run result.
  * **Why**: short causal explanation referencing current parameters (e.g., “same h ⇒ same v at base by energy conservation”).
* Content authored as **YAML**; localized via i18n keys.

---

# 10. Non-Functional Requirements

* **Performance**: see §3.3 and WF-1 acceptance.
* **Reliability**: autosave SceneGraph + Ink every 10s and on tool ops; crash-safe restores.
* **Security**: RBAC (learner/instructor/researcher/admin), JWT sessions; uploads virus-scanned.
* **Privacy**: per-course isolation; IRB-ready logging toggle (hash user IDs).
* **Accessibility**: keyboard parity for all actions; ARIA roles; high-contrast theme.
* **Internationalization**: UI copy and pedagogy YAMLs switchable (ko/en); unit systems (SI/USC).
* **Reproducibility**: every run stores code version, SceneGraph version, and `seed`.

---

# 11. Testing & QA

## 11.1 Unit

* **Conversion**: golden images → expected SceneGraph (tolerances on geometry).
* **Tools**: property tests (idempotence, bounds).
* **Validator**: rejects overlapping fixtures, negative masses, unit mismatches.

## 11.2 Integration

* **Chat→Tool→Scene** flow with mocked LLM (prebaked intents).
* **Undo/Redo** across SceneGraph versions.
* **Ink persistence** after scene reloads.

## 11.3 E2E (Playwright)

* Scenarios: projectile, incline with friction, pendulum.
* Assertions: interactive FPS ≥ 55; patch diff visible; scaffold offered.

**Definition of Done (MVP)**

* WF-1/2/3 all pass acceptance; 3 canonical scenarios shipped with scaffold; tool catalog callable via LangGraph; Ink persists across 5 consecutive conversions.

---

# 12. Project Structure (suggested)

```
repo/
  frontend/ (Next.js + TS)
    src/components/ChatPanel.tsx
    src/components/SimCanvas.tsx        # PixiJS
    src/components/InkCanvas.tsx        # Konva
    src/components/ControlPane.tsx
    src/state/store.ts                  # Zustand
    src/api/client.ts                   # React Query hooks
  backend/
    app/main.py                         # FastAPI
    app/routers/ingest.py
    app/routers/scene.py
    app/routers/sim.py
    app/routers/chat.py                 # LangGraph entry
    app/agent/graph.py                  # LangGraph nodes/edges
    app/tools/                         # tool_* implementations
    app/models/scene.py                 # Pydantic schemas
    app/pipeline/convert.py             # Celery task
    app/sim/engine.py                   # pybox2d utilities
    app/pedagogy/rules/                 # YAML pattern files
  infra/
    docker-compose.yml
    k8s/
```

---

# 13. Milestones

* **Sprint 1 (2 weeks)**: FE skeleton (layout, canvases), upload + job status, baseline conversion (preprocess + simple line/shape), minimal SceneGraph, Planck.js render.
* **Sprint 2 (2 weeks)**: Tool catalog v1 + LangGraph agent (Planner→ToolExecutor→Validator), apply_ops, diffs, undo/redo.
* **Sprint 3 (2 weeks)**: Pedagogy v1 (incline/projectile), control pane bindings, snapshots/compare, E2E tests.
* **Beta**: ambiguities UI, OCR/units, accessibility pass, telemetry dashboard.

---

# 14. Developer Notes (edge cases to handle)

* Mixed units (e.g., “cm” in labels) → normalize to SI; warn user.
* Over-segmentation (double lines) → merge heuristics before polygonization.
* Annotation transforms must match zoom/pan; store Ink in world coordinates.
* Chat requests with conflicting ops → present diff preview + confirm.

---
