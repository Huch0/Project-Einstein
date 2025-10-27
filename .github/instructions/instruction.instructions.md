------

applyTo: '**'applyTo: '**'

------

Project Einstein – Agent-Controlled Simulation Pipeline (v0.3)Project Einstein – GPT↔Simulator Interface (Authoritative Instruction)



## GoalGoal

Build a GPT-5 Agent-driven simulation system where each pipeline stage (segmentation, labeling, scene building, physics) is exposed as an independent Tool. The agent orchestrates the entire workflow through natural language chat, allowing iterative refinement and user collaboration.Define and validate a robust interface that bridges GPT’s semantic understanding of diagram segments and the physics simulator’s scene requirements. We assume high-quality segments from SAM/SAM2 and accurate labeling from GPT-5. Our job is to specify the intermediate contracts and implement a minimal but testable builder that produces a simulator-ready Scene JSON (Rapier 2D).



## Architecture Shift: Monolithic → Tool-based AgentKey Principles

- Separation of concerns: segmentation (SAM) → labeling (GPT) → scene assembly (Interface Builder) → simulation (Rapier)

**Previous (v0.2):** Single endpoint `/diagram/parse` auto-executes entire pipeline- Contracts over heuristics: precise JSON schemas for inputs/outputs; deterministic, testable transforms

**Current (v0.3):** Each stage is a callable Tool; GPT-5 Agent orchestrates via function calling- Coordinate rigor: explicit px↔m mapping, origin policy, and reference consistency (segment ids ↔ entities ↔ bodies)



## Core PrinciplesData Contracts

1. **Tool-first Design**: Every pipeline stage = one tool with clear input/output contracts1) Segments (from SAM)

2. **Agent Orchestration**: GPT-5 decides tool sequence, handles errors, asks clarifying questions  - Format:

3. **Iterative Refinement**: User can correct labels, adjust scene parameters, rerun physics    {

4. **State Management**: Agent maintains conversation context (uploaded images, segments, scenes)      "segments": [

5. **Contracts over Heuristics**: Precise JSON schemas; deterministic transforms; no magic        { "id": 1, "bbox": [x,y,w,h], "polygon_px": [[x,y],...], "mask_path": null }

      ],

## Tool Catalog (v0.3)      "image": { "width_px": W, "height_px": H }

    }

### 1. `segment_image` - SAM/SAM2 Segmentation

**Input:**2) GPT Labels (from GPT-5)

```json  - Format (strict JSON):

{    {

  "image_data": "base64_encoded_image | file_path | image_id",      "entities": [

  "mode": "bbox | polygon | mask",        { "segment_id": "1", "label": "mass", "props": { "mass_guess_kg": 2.0 } },

  "sam_server_url": "http://localhost:9001/segment"        { "segment_id": "3", "label": "pulley", "props": { "wheel_radius_m": 0.1 } },

}        { "segment_id": "4", "label": "surface" }

```      ]

**Output:**    }

```json

{3) Build Scene Request (Interface Builder input)

  "segments": [  - Format:

    {"id": 1, "bbox": [x,y,w,h], "polygon_px": [[x,y],...], "mask_path": "s3://..."}    {

  ],      "image": { "width_px": W, "height_px": H },

  "image": {"width_px": W, "height_px": H, "image_id": "uuid"}      "segments": [{ "id": 1, "bbox": [x,y,w,h], "polygon_px": [[x,y],...] }],

}      "labels": { "entities": [...] },

```      "mapping": { "origin_mode": "anchor_centered", "scale_m_per_px": S },

**Purpose:** Extract object boundaries from physics diagram image.      "defaults": { "gravity_m_s2": 9.81 }

    }

### 2. `label_segments` - GPT Vision Entity Recognition

**Input:**4) Build Scene Response (Interface Builder output)

```json  - Format:

{    {

  "image_id": "uuid",      "scene": <Scene JSON v0.1.0>,

  "segments": [{...}],      "warnings": ["string"],

  "context": "This is a pulley system with friction",      "meta": { "source": "sam+gpt", "resolver": "v1" }

  "use_vision": true    }

}

```Scene JSON (Simulator-ready)

**Output:**- Canonical schema defined in backend/app/sim/schema.py (v0.1.0) for a single fixed pulley:

```json  - world: gravity/time_step

{  - bodies: exactly two dynamic bodies with mass and initial position (meters)

  "version": "v0.2",  - constraints: one ideal_fixed_pulley with anchor and rope_length (computed if omitted)

  "entities": [  - normalization: reference checks + rope length derivation

    {"segment_id": "1", "type": "mass", "props": {"mass_guess_kg": 3.0, "material": "wood"}},

    {"segment_id": "2", "type": "pulley", "props": {"wheel_radius_m": 0.1, "friction": "ideal"}},Builder Rules (v1)

    {"segment_id": "3", "type": "surface", "props": {"mu_k": 0.5}}- Entity mapping: pick exactly two masses (left→body_a=m1, right→body_b=m2), one pulley (anchor), optional surface (friction/scale hints)

  ],- Positioning: body/pulley positions = centers of segment bboxes, mapped from px to meters using mapping.scale_m_per_px and origin_mode

  "confidence": {"overall": 0.92, "per_entity": [0.95, 0.88, 0.93]}- Masses: if GPT props.mass_guess_kg present, use; else infer mass ratio by bbox areas and scale from a base value

}- Rope length: derived from initial geometry unless provided; wheel radius optional

```- Warnings: non-blocking anomalies (e.g., missing pulley, >2 masses) reported in response.warnings

**Purpose:** Identify physics entities and estimate properties from visual/text cues.

APIs and Endpoints

### 3. `validate_scene_entities` - Entity Set Validation- POST /diagram/parse: orchestrates segmentation→labeling→build→simulate (simulate optional via ?simulate=1) and returns images/detections/segments/mapping/scene/meta

**Input:**- Internal interface function: build_scene(request) → response

```json

{Testing Strategy

  "entities": [{...}],- Unit: feed curated segments+labels into builder and assert a valid Scene (ids, counts, normalization, coordinate transforms)

  "allow_incomplete": false- Property: sanity of px→m mapping around image center; deterministic selection of masses and pulley

}- Integration (optional): run Rapier worker on built Scene, return frames for visualization

```

**Output:**Roadmap

```json- v0.2: Interface Builder v1 (this doc), pulley.single_fixed_v0

{- v0.3: Multi-body support; polygon colliders; better friction/scale estimation

  "valid": true,- v0.4: Interactive editing loop (GPT suggestions ↔ scene delta)

  "scene_kind": "pulley.single_fixed_v0",

  "warnings": ["Surface detected but not required for pulley scene"],Acceptance

  "missing_required": [],- Given valid segments+labels+mapping, builder yields a valid Scene JSON (pydantic schema) with references intact and rope_length set.

  "suggestions": ["Add wheel_radius_m to pulley props for better accuracy"]- Basic tests run green.

}

```Entity Library and Builder Registry (v0.2 Directive)

**Purpose:** Check if entity set is sufficient for scene building; suggest scene type.- Purpose: generalize beyond a single pulley by introducing a typed Entity Library and a SceneKind registry with a resolver.

- Entity labels (from GPT) MUST use a strict JSON envelope with versioning. For v0.2:

### 4. `build_physics_scene` - Scene JSON Construction  {

**Input:**    "version": "v0.2",

```json    "entities": [

{      { "segment_id": "<id>", "type": "mass|pulley|surface|ramp|spring|pendulum_pivot|anchor", "props": { /* per-type */ } }

  "image": {"width_px": W, "height_px": H},    ]

  "segments": [{...}],  }

  "entities": [{...}],- Backward compatibility: if version is absent and keys are {label, props}, map label→type and accept as v0.1 input.

  "mapping": {"origin_mode": "anchor_centered", "scale_m_per_px": 0.01},- Resolver (deterministic):

  "defaults": {"gravity_m_s2": 9.81, "time_step_s": 0.016}  1) ≥2 mass + 1 pulley → pulley.single_fixed_v0

}  2) 1 mass + 1 ramp → ramp.block_v0

```  3) 1 mass + 1 pendulum_pivot → pendulum.single_v0

**Output:**  4) 1 mass + 1 spring (± anchor) → spring_mass.single_v0

```json  else → error with required-entity hints.

{- Builder registry: extract current pulley builder into a registered builder; add new builders per SceneKind. All builders must produce the canonical Scene JSON and enumerate warnings for inferred/defaulted props.

  "scene": {

    "version": "0.1.0",OpenAPI 3.0 Spec (Authoritative Schema Source)

    "kind": "pulley.single_fixed_v0",- Maintain the contract as an OpenAPI 3.0 YAML file at: docs/entity-library.v0.2.openapi.yaml

    "bodies": [{...}],- This spec must define:

    "constraints": [{...}],  - Components/schemas for Segments, LabelEnvelope v0.2, Entity per-type props, Mapping, Defaults, BuildSceneRequestV2, BuildSceneResponse, and a minimal Scene shape.

    "world": {...}  - Path: POST /diagram/parse with request/response bodies referencing the above schemas; include optional query params (simulate, debug).

  },- Any new entity type or SceneKind MUST be accompanied by schema updates in this file. PRs changing entity/scene contracts MUST update this spec.

  "warnings": ["Mass B inferred from area ratio"],

  "meta": {"resolver": "v2", "builder": "pulley_single_fixed_v0"}Implementation Notes

}- Positioning and units: continue to use bbox-center mapping and mapping.scale_m_per_px; allow per-entity overrides where defined by schema (e.g., custom pulley anchor).

```- Warnings are non-blocking; simulation falls back to analytic if a physics worker produces empty/invalid frames.

**Purpose:** Convert entities + geometry → simulator-ready Scene JSON.- Tests: add unit + property tests per builder; verify resolver determinism and px→m mapping around image center.

### 5. `simulate_physics` - Physics Engine Execution
**Input:**
```json
{
  "scene": {...},
  "engine": "matter-js | analytic",
  "duration_s": 5.0,
  "output_format": "frames | summary | energy_only"
}
```
**Output:**
```json
{
  "engine": "matter-js",
  "frames": [{"t": 0, "positions": {"m1": [x,y], "m2": [x,y]}}, ...],
  "energy": {"kinetic_j": [...], "potential_j": [...], "total_j": [...]},
  "summary": {"max_speed_m_s": 2.3, "final_positions": {...}},
  "meta": {"frames_count": 312, "solver": "matter-js v0.19"}
}
```
**Purpose:** Run physics simulation; return motion frames and energy data.

### 6. `analyze_simulation` - Results Analysis
**Input:**
```json
{
  "frames": [{...}],
  "scene": {...},
  "analysis_type": "energy_conservation | constraint_error | motion_summary"
}
```
**Output:**
```json
{
  "energy_conservation": {"error_percent": 0.12, "drift": "acceptable"},
  "constraint_violations": {"max_rope_error_m": 0.0012, "frames_violated": 3},
  "motion_summary": {
    "acceleration_m_s2": 1.96,
    "max_velocity_m_s": 2.35,
    "system_behavior": "m2 descends, m1 accelerates right"
  }
}
```
**Purpose:** Validate physics correctness; provide pedagogical insights.

## Data Contracts

### Segment Schema (SAM Output)
```typescript
{
  id: number | string,
  bbox: [x: number, y: number, w: number, h: number],  // pixels
  polygon_px?: Array<[x: number, y: number]>,          // precise outline
  mask_path?: string                                    // S3/local path
}
```

### Entity Schema (GPT Vision Output)
```typescript
{
  segment_id: string,
  type: "mass" | "pulley" | "surface" | "ramp" | "spring" | "pendulum_pivot" | "anchor",
  props: {
    // Type-specific properties
    mass_guess_kg?: number,
    wheel_radius_m?: number,
    mu_k?: number,
    material?: string,
    ...
  },
  confidence?: number  // 0-1, from Vision API
}
```

### Scene Schema (Builder Output → Physics Input)
```typescript
{
  version: "0.1.0",
  kind: "pulley.single_fixed_v0" | "ramp.block_v0" | "pendulum.single_v0",
  world: {
    gravity_m_s2: number,
    time_step_s: number
  },
  bodies: Array<{
    id: string,
    mass_kg: number,
    position_m: [x: number, y: number],
    collider?: {type: "circle", radius_m: number} | {type: "polygon", vertices: [...]}
  }>,
  constraints: Array<{
    type: "ideal_fixed_pulley" | "rope" | "spring",
    ...constraint_specific_props
  }>
}
```

## Agent Workflow Example

**User:** "Simulate this pulley diagram" [uploads image]

**Agent:**
1. Calls `segment_image(image)` → gets segments
2. Calls `label_segments(segments, image)` → gets entities  
3. Calls `validate_scene_entities(entities)` → confirms pulley scene
4. Shows user: "I detected 2 masses (3kg, 6kg) and 1 pulley. Is this correct?"
5. **User:** "The left mass is actually 5kg"
6. Agent updates entity props
7. Calls `build_physics_scene(segments, entities)` → gets Scene JSON
8. Calls `simulate_physics(scene, engine="matter-js")` → gets frames
9. Returns visualization + analysis: "Mass B descends at 1.96 m/s², energy conserved within 0.1%"

## Implementation Requirements

### Backend Structure
```
backend/app/
├── agent/
│   ├── tools/               # Tool implementations
│   │   ├── __init__.py
│   │   ├── segment_image.py
│   │   ├── label_segments.py
│   │   ├── validate_entities.py
│   │   ├── build_scene.py
│   │   ├── simulate_physics.py
│   │   └── analyze_results.py
│   ├── tool_registry.py     # Tool schemas + registration
│   └── agent_context.py     # Conversation state management
├── sim/
│   ├── schema.py            # Scene JSON schemas
│   ├── builders/            # Per-scene-kind builders
│   └── physics/             # Matter.js + analytic engines
└── routers/
    ├── diagram.py           # Legacy monolithic endpoint (keep for compatibility)
    └── agent.py             # NEW: Agent chat endpoint
```

### Agent Chat Endpoint
```python
POST /agent/chat
{
  "message": "Simulate this pulley diagram",
  "conversation_id": "uuid",
  "attachments": [{"type": "image", "data": "base64..."}]
}
→ Response:
{
  "assistant_message": "I'll analyze your diagram. One moment...",
  "tool_calls": [{"name": "segment_image", "args": {...}}],
  "state": {"segments": [...], "entities": null, "scene": null}
}
```

## Testing Strategy
1. **Tool Unit Tests:** Each tool with mock inputs → validate output schema
2. **Agent Integration Tests:** Multi-turn conversations → assert correct tool sequence
3. **End-to-End:** Upload image → agent chat → get simulation frames
4. **Error Handling:** Missing entities, invalid scenes, physics failures

## Migration Plan
1. **Phase 1 (current):** Implement tools as wrappers around existing code
2. **Phase 2:** Create agent chat endpoint with tool calling
3. **Phase 3:** Add conversation state management
4. **Phase 4:** Deprecate monolithic `/diagram/parse` (keep for backward compat)

## Acceptance Criteria
- ✅ Each tool callable independently with valid JSON I/O
- ✅ Agent can orchestrate full pipeline through natural language
- ✅ User can correct intermediate results (labels, scene params)
- ✅ Simulation results returned with pedagogical analysis
- ✅ All existing tests pass; new tool tests green
