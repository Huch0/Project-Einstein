---
applyTo: '**'
---
Project Einstein – Authoritative Instruction Set

Purpose
Provide shared context, architectural direction, quality bars, and coding guidelines for any AI assistant (and human contributors) generating code, answering questions, proposing designs, or reviewing changes in this repository. Treat this as the living contract of how we build.

High-Level Vision
We are building an interactive physics problem-solving and simulation platform. A user supplies a physics problem (potentially with a diagram). The system:
1. Parses / extracts entities (bodies, constraints, forces, initial conditions) using an AI parsing + reasoning pipeline.
2. Produces a structured scene description (our canonical Simulation Scene JSON Schema – to be defined).
3. Runs a deterministic (or controlled stochastic) simulation using a Rapier (rust / rapier.rs) powered physics core compiled to WebAssembly (frontend) and/or executed server-side (future: native microservice or WASM sandbox).
4. Streams state snapshots / events back to the UI for visualization + further AI-guided explanation.

Core Architectural Domains
- backend/app/agent: Orchestration logic for AI reasoning, parsing diagrams/text, generating scene JSON, calling tool functions.
- backend/app/sim: Simulation abstractions (scene schema definition, validation, versioning, potential server-side execution adapters – placeholder now).
- backend/app/tools: Tool interfaces callable by the agent (e.g., unit conversion, equation solving, symbolic helpers, diagram parsing stub, future: force decomposition, free-body generation).
- backend/app/pipeline: Multi-step flows (parse -> enrich -> validate -> simulate -> explain). Keep each step pure where feasible.
- frontend/src/ai: Client flows (currently Genkit flows) for chat & code generation; will integrate with scene generation and simulation execution endpoints.
- frontend/src/components/simulation: UI panels for code, parameters, controls, and a forthcoming WebGL/Canvas viewport fed by simulation frames.

Upcoming Rapier Integration Guidelines
Goal: Introduce a portable physics layer using rapier (https://rapier.rs) with a clean boundary.
Planned Layers:
1. Scene Specification (language-agnostic) – JSON Schema v0 (bodies, shapes, material props, forces, constraints, integrator params, output sampling strategy). File: backend/app/sim/schema.py (to add) & frontend shared TypeScript types (src/simulation/types.ts).
2. Translator (TS & Python) – Validates and normalizes scene -> canonical internal representation -> wasm bindings init.
3. Execution Adapter – JS/TS wrapper around rapier-wasm; potential Python wrapper (through WASM or microservice) later.
4. Streaming Protocol – Each animation frame (or decimated interval) emits: { t, bodies: [{ id, position:[x,y,(z)], velocity, forces? }], meta: { energy?, warnings? } }.
5. Determinism Controls – Provide simulation seed, fixed timestep (dt), substeps. Guarantee reproducibility for identical scene+seed.

Non-Goals (Initial Phase)
- Complex fluid / soft-body simulation.
- Arbitrary user-defined force scripts (will gate behind sandbox design).
- Multi-physics coupling (thermal, EM, etc.) – treat as roadmap.

Coding & Design Standards
General
- Favor clarity over cleverness; small, composable functions.
- Use explicit types (Python: pydantic models / TypedDict / type hints; TypeScript: interfaces/types). Avoid untyped dynamic dict juggling.
- Public function docstrings: short summary + arguments + returns + error modes.
- Place feature flags or experimental toggles behind a single config surface (settings or a TS config object).

Python (Backend)
- FastAPI endpoints: prefix router modules under backend/app/routers/; isolate side-effects in startup events not import time.
- Configuration via pydantic Settings (see `models.settings`). No raw os.getenv scattered around.
- Tests: pytest; name pattern test_*.py; keep fast (unit < 1s). For new modules provide minimal tests (happy path + one edge case).
- Use `async` only where IO-bound; avoid needless coroutine churn.
- Logging (to add): prefer structlog or stdlib logging with JSON formatter (future instruction update when introduced).

TypeScript / Frontend
- Next.js (App Router) – keep server components pure; client components only where interactivity needed.
- Co-locate domain-specific hooks under src/hooks/; generic utils under src/lib/ (to add when needed).
- Adopt ESLint + strict TS config (tighten incrementally if currently permissive).
- UI state: prefer local component state; escalate to context / store only when cross-cutting.

Simulation Data Contracts
- Maintain a versioned schema: scene.version (semantic, e.g. "0.1.0"). Breaking changes require bump + migration function.
- Validate on ingestion (backend) and prior to execution (frontend) – fail fast with structured error { code, field, message }.
- Keep numeric units explicit (SI by default). Example: mass_kg, length_m if ambiguous; or enforce documented SI invariant and drop suffix.

AI / Agent Interaction Principles
- Never execute arbitrary code returned by AI without validation / sandbox.
- Tool calls must be idempotent; if side effects exist (e.g., storing generated scene), return a handle not full duplication.
- Provide reasoning trace (log of steps) for debugging; redact sensitive config.
- Constrain temperature / randomness for parsing steps to ensure repeatability.

Security & Safety
- Secrets only via environment / settings; never commit actual credentials.
- Validate all user-supplied text before passing to model (length bounds, basic sanitization) – TODO: implement input gate.
- WASM execution: run in a constrained worker (frontend) or a sandbox process (backend future) – no direct FS / network.

Performance
- Favor fixed timestep simulation (e.g., 1/120s internal, 1/60s render). Decimate frames (configurable) to reduce bandwidth.
- Avoid over-allocating objects each frame—reuse buffers in streaming adapter (TS level optimization phase 2).

Testing Strategy (Initial Expectations)
- Add unit tests for schema validation (valid scene, missing body, invalid force type, unsupported shape).
- Golden snapshot test for a simple projectile under gravity to assert determinism (positions at fixed timesteps).
- Property test candidate (later): energy monotonicity within tolerance for frictionless closed system.

Documentation Expectations
- Each new public module: top-of-file docstring or header comment summarizing role & constraints.
- Update README sections when adding major capability (schema, simulation adapter).
- Add a CHANGELOG entry for schema version bumps.

Review Guidelines
- Block merges if: missing tests for new logic; schema changes without version bump; public API change undocumented.
- Encourage small PRs (< 400 lines diff net) except for mechanical codegen additions.

Branch & Release
- main: always green (tests pass). Feature branches: feature/<slug>.
- Tag pre-release simulation milestones (v0.1.0-sim-alpha1) as we integrate rapier.

Progressive Enhancement Plan (Roadmap Snapshot)
Phase 1: Define scene schema + minimal projectile simulation with rapier-wasm (frontend only) + streaming to UI panel.
Phase 2: Expand forces (normal, friction, tension, spring). Add explanation overlay (AI commentary per frame segment).
Phase 3: Server-side validation + optional headless simulation (for authoritative replay & grading use-case).
Phase 4: Advanced constraints (pulleys, joints) + migration toolchain.

Contribution Workflow (AI or Human)
1. If schema touch -> bump version + write migration stub even if no old versions yet (placeholder). 
2. Add/Update tests.
3. Run lint & tests locally (to be automated CI pipeline – TODO: add GitHub Actions).
4. Provide concise PR description referencing instruction delta if relevant.

Checklist for Adding Simulation Feature (TL;DR)
- [ ] Define / update scene schema.
- [ ] Validate with pydantic (backend) & zod or similar (frontend) – choose one (recommend zod) + generate TS types.
- [ ] Implement rapier init + world step wrapper.
- [ ] Deterministic seed & timestep controls.
- [ ] Frame streaming channel (websocket or server-sent events) design doc before implementation.
- [ ] Minimal tests (schema, first frame, time progression).
- [ ] Docs & README update.

Style Edge Cases & Decisions
- Use snake_case in JSON keys except where interoperability with external libs enforces camelCase; translate at boundary.
- Prefer returning explicit None/undefined fields only when semantically meaningful; otherwise omit.
- Floating point tolerance in tests: default abs error 1e-6, relax with reasoning if necessary.

When AI Generates Code
- Must adhere to this instruction file.
- Should not add external dependencies without rationale (size, security, maintenance).
- Must flag any assumption if spec ambiguous and proceed conservatively.

Open TODO Anchors (for future refinement)
- TODO(schema): Introduce body grouping + hierarchical transforms.
- TODO(perf): Add object pool for frame serialization.
- TODO(security): Sandbox policy doc for WASM memory limits.
- TODO(devex): Provide make targets for common tasks (lint, test, type-check) both backend & frontend.

Image → Scene (Diagram Parsing) Pipeline (Initial Plan)
Goal: Convert a user-uploaded physics diagram (e.g., pulley setup) into a validated Scene JSON + parameter set + pixel→meter mapping so the analytic / future Rapier simulation animates the actual objects over the original image.

Stages:
1. Ingestion & Preflight (frontend): user uploads image; show immediate preview (data URL). Send multipart/form-data to backend /diagram/parse.
2. Backend Parse Stub (v0): Return deterministic mock detections (pulley wheel, mass A, mass B, table surface) until model integration. Provide: image_w_px, image_h_px, detected objects [{ id, label, bbox_px:[x,y,w,h]}], inferred parameters (mass guesses, μk, gravity default 9.81 or 10 if annotated), and derived scene (using existing pulley.single_fixed_v0 schema with pixel_to_meter_scale in an extension field).
3. Normalization: map pixel bounding boxes to simulation coordinates (choose origin at top-left or anchor-based center; v0 fixed heuristic). Compute scale_m_per_px (e.g., assume 100 px ≈ 1 m if not inferable) and store in result meta.
4. Scene Merge: produce Scene; store detection meta separate (do not pollute canonical schema except via optional extension `meta.diagram` until schema version bump).
5. Parameter Binding (frontend): Update SimulationContext (massA, massB, gravity, friction if available) + store detection list for overlay bounding boxes.
6. Playback: analytic or rapier-driven frames update DOM nodes positioned by projected simulation coordinates -> pixel overlay (coordinate transform uses scale & anchor alignment).
7. User Adjustments: adjusting parameter sliders triggers re-run; masses remain visually aligned with their original bounding boxes (initial frame) but move as simulation proceeds.

Design Principles:
- Keep raw detection results; do not destructively alter original bounding boxes.
- Deterministic stub until ML integration (ensures unit tests stable).
- Encapsulate conversion logic in a single backend function (diagram_to_scene) returning both scene + mapping meta.
- Avoid adding heavy CV deps initially (Pillow/Opencv) – stub only. Defer real model integration behind feature flag.

API Contract (v0): POST /diagram/parse (multipart form: file=<image>) → 200 JSON {
	image: { width_px, height_px },
	detections: [ { id, label, bbox_px:[x,y,w,h] } ],
	parameters: { massA_kg, massB_kg, mu_k, gravity_m_s2 },
	mapping: { origin_mode:"anchor_centered", scale_m_per_px },
	scene: <Scene JSON>,
	meta: { version:"0.1.0", generator:"stub" }
}

Frontend Responsibilities:
- On success: set backgroundImage (already handled), update SimulationContext with masses/gravity and stash detection overlay list.
- Provide toggle to display bounding boxes (future overlay component) and allow clicking a box to focus scope (A/B selection sync with parameters panel).

Testing Additions:
- test_diagram_parse_success: ensures endpoint returns deterministic scene & detection count.
- Pixel→meter scale application test: reconstruct rope length vs computed scene rope_length_m within tolerance.

Planned Iterations:
Phase v0: Hardcoded detection stub.
Phase v1: Simple heuristic (color/edge segmentation) optional.
Phase v2: ML model (e.g., lightweight ONNX) executed client or server; introduce label confidence.
Phase v3: Multi-object scenes (multiple pulleys / blocks) → graph assembly and schema upgrade (scene.kind variant or new schema version).

Security / Validation Additions:
- Enforce max image size (e.g., 4 MB) & dimensions (e.g., <= 4096 px any side) server-side.
- Reject unsupported MIME types early.

Migration Note: When formalizing pixel scale & diagram metadata in schema, bump version to 0.1.1 and add migration placeholder.

Violation Handling
If generated suggestions conflict with this instruction set, they should be reconsidered or explicitly justified with trade-offs.

End of instruction.