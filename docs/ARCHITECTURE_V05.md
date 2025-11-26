# Project Einstein v0.5 – Two-Phase Simulation Architecture

This document summarizes the current (v0.5) simulation workflow and points to the canonical instructions.

- Canonical spec: `.github/instructions/instruction.instructions.md`
- Breaking change: `/chat` is no longer used for initialization. Use `/init_sim` (initialize) and `/run_sim` (execute).

## Workflow

1) Initialization (automatic)
- Frontend uploads the image, calls `POST /init_sim { image_id, conversation_id? }`.
- Backend runs tools sequentially: segment → label → validate → build.
- Returns `status: "initialized"` with a universal scene (bodies/constraints) and counts.
- UI shows detected entities and enables the "Convert Simulation" button.

2) Execution (manual)
- User clicks "Convert Simulation"; frontend calls `POST /run_sim { conversation_id, duration_s, frame_rate, analyze }`.
- Backend simulates with Matter.js and optionally analyzes results.
- Returns frames + analysis for visualization.

## Frontend Architecture Notes

- ID strategy: use `body.id` as the primary key everywhere; optionally link to vision via `body.source_segment_id`.
- Coordinate system: shared transform store applies mapping/image → canvas transform and camera pan/zoom consistently across layers.
- SimulationLayer roles:
  - Engine + scene initialization
  - Interaction (mouse constraint, selection, drag) – to be split next
  - Sync (debounced backend updates) – to be split next
  - Renderer extracted: `SimulationRenderer` owns Matter.Render and animation loop

## Backend Architecture Notes

- Routers: `/init_sim` and `/run_sim` implement the two-phase workflow.
- Universal Builder (v0.4 format) remains flexible: arbitrary bodies and constraints.
- Body schema includes optional `source_segment_id` and geometry metadata for traceability.

## Migration Status

- v0.4 docs remain for historical context; marked deprecated.
- Frontend analytic solver path removed; only Matter.js or backend frames are used.
- Renderer extraction complete; Interaction and Sync extraction planned.

## Next Steps

- Extract `SimulationInteraction` (mouse/hover/activation) and `SimulationSync`.
- Promote transform store to a top-level provider shared by Canvas and Simulation layers.
- Optional: WebSocket progress for initialization (v0.6 roadmap).
