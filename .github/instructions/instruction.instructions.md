------

applyTo: '**'

------

# Project Einstein – Automated Initialization Workflow (v0.5)

## Goal

Build a **two-phase simulation workflow** that separates initialization from execution:
1. **Initialization Phase** (`/init_sim`): Automatic preprocessing (segment → label → validate → build)
2. **Execution Phase** (user-triggered): Manual simulation start via "Convert Simulation" button

This eliminates GPT-5 Agent dependency for initialization while maintaining deterministic, transparent setup.

**Key Changes from v0.4:**
- ❌ **REMOVED:** GPT-5 Agent auto-chaining for initialization (unreliable tool calling)
- ❌ **REMOVED:** `/chat` endpoint for image upload workflow
- ✅ **NEW:** `/init_sim` endpoint with sequential initialization pipeline
- ✅ **NEW:** "Convert Simulation" button for manual simulation trigger
- ✅ **NEW:** Explicit initialization state tracking in UI



## Architecture Philosophy

### Core Principles

1. **Two-Phase Workflow**
   - **Phase 1 (Automated)**: Image upload → `/init_sim` → segments + entities + scene (no simulation yet)
   - **Phase 2 (Manual)**: User clicks "Convert Simulation" → run Matter.js simulation
   - Clear separation: Setup vs Execution

2. **Deterministic Initialization**
   - No GPT-5 Agent uncertainty during setup
   - Sequential tool execution: `segment` → `label_segments` → `validate_entities` → `builder`
   - All steps complete before simulation starts
   - Frontend receives initialization status updates

3. **User Control**
   - Users see initialization progress in real-time
   - Users explicitly trigger simulation (not auto-run)
   - "Convert Simulation" button appears only after successful initialization
   - Clear feedback at each stage

4. **Universal Builder (v0.4 retained)**
   - Scene JSON structure remains flexible
   - `bodies: []` can have 1, 2, 10, or 100 bodies
   - `constraints: []` supports any combination of constraint types
   - No scene-kind restrictions



## Pipeline Overview (v0.5)

```
┌──────────────────────────────────────────────────────────────┐
│                    PHASE 1: INITIALIZATION                    │
│                  (Automatic via /init_sim)                    │
└──────────────────────────────────────────────────────────────┘

┌──────────────┐
│ User uploads │
│    image     │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Frontend: sendInitSimulation(image_id)                      │
│  → POST /init_sim { image_id, conversation_id }             │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Backend: /init_sim endpoint                                 │
│  1. segment_image_tool(image_id)                            │
│     → segments: [{id, bbox, polygon_px}, ...]               │
│  2. label_segments_tool(image_id, segments)                 │
│     → entities: [{type, props, confidence}, ...]            │
│  3. validate_entities_tool(entities)                        │
│     → validation: {valid, warnings, errors}                 │
│  4. build_physics_scene_tool(segments, entities)            │
│     → scene: {bodies, constraints, world}                   │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Response to Frontend:                                       │
│  {                                                           │
│    status: "initialized",                                    │
│    conversation_id: "uuid",                                  │
│    segments_count: 4,                                        │
│    entities_count: 3,                                        │
│    scene: {...},                                             │
│    warnings: [...]                                           │
│  }                                                           │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Frontend: Update UI                                         │
│  - Show initialization success message                       │
│  - Display "Convert Simulation" button                       │
│  - Show detected entities (3 masses, 1 pulley, etc.)        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                    PHASE 2: EXECUTION                         │
│              (Manual via "Convert Simulation")                │
└──────────────────────────────────────────────────────────────┘

┌──────────────┐
│ User clicks  │
│ "Convert     │
│ Simulation"  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Frontend: runSimulation(conversation_id)                    │
│  → POST /run_sim { conversation_id }                        │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Backend: /run_sim endpoint                                  │
│  1. Load scene from context (already built in Phase 1)      │
│  2. simulate_physics_tool(scene, duration_s, frame_rate)    │
│     → frames: [{t, positions, velocities, forces}, ...]     │
│  3. analyze_simulation_tool(frames, scene)                  │
│     → analysis: {energy, forces, motion_summary}            │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Response to Frontend:                                       │
│  {                                                           │
│    status: "simulated",                                      │
│    frames: [...],                                            │
│    analysis: {...},                                          │
│    meta: {frames_count: 312, simulation_time_s: 5.0}       │
│  }                                                           │
└──────┬───────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  Frontend: Visualize Simulation                              │
│  - Render animation with frames data                         │
│  - Display physics analysis                                  │
│  - Show energy conservation graph                            │
└──────────────────────────────────────────────────────────────┘
```

## API Endpoints (v0.5)

### 1. `POST /init_sim` - Initialization Pipeline ⭐ NEW

**Purpose:** Execute sequential initialization without GPT-5 Agent chaining.

**Input:**
```json
{
  "image_id": "uuid",
  "conversation_id": "uuid (optional, generated if not provided)",
  "options": {
    "auto_validate": true,
    "scale_m_per_px": 0.01
  }
}
```

**Process (Sequential):**
1. Call `segment_image_tool(image_id)`
2. Call `label_segments_tool(image_id, segments)`
3. Call `validate_entities_tool(entities)` (optional)
4. Call `build_physics_scene_tool(segments, entities)`

**Output:**
```json
{
  "status": "initialized",
  "conversation_id": "uuid",
  "image_id": "uuid",
  "initialization": {
    "segments_count": 4,
    "entities_count": 3,
    "entities": [
      {"type": "mass", "segment_id": "1", "props": {...}},
      {"type": "pulley", "segment_id": "2", "props": {...}}
    ],
    "scene": {
      "bodies": [...],
      "constraints": [...]
    },
    "warnings": ["Mass inferred from area"],
    "errors": []
  },
  "ready_for_simulation": true
}
```

**Error Handling:**
- Segmentation fails → return `{"status": "failed", "step": "segment", "error": "..."}`
- Labeling fails → return `{"status": "failed", "step": "label", "error": "..."}`
- Validation fails → return `{"status": "failed", "step": "validate", "errors": [...]}`
- Builder fails → return `{"status": "failed", "step": "build", "error": "..."}`

---

### 2. `POST /run_sim` - Simulation Execution ⭐ NEW

**Purpose:** Run Matter.js simulation on pre-initialized scene.

**Input:**
```json
{
  "conversation_id": "uuid",
  "duration_s": 5.0,
  "frame_rate": 60,
  "analyze": true
}
```

**Process:**
1. Load scene from context (must be initialized first)
2. Call `simulate_physics_tool(scene, duration_s, frame_rate)`
3. Optionally call `analyze_simulation_tool(frames, scene)`

**Output:**
```json
{
  "status": "simulated",
  "conversation_id": "uuid",
  "simulation": {
    "frames": [
      {"t": 0.0, "positions": {...}, "velocities": {...}},
      {"t": 0.016, "positions": {...}, "velocities": {...}}
    ],
    "meta": {
      "frames_count": 312,
      "simulation_time_s": 5.0,
      "engine": "matter-js v0.19"
    }
  },
  "analysis": {
    "energy_conservation": {"error_percent": 0.2},
    "motion_summary": {...},
    "pedagogical_insights": [...]
  }
}
```

**Error Handling:**
- No scene found → return `{"status": "not_initialized", "error": "Call /init_sim first"}`
- Simulation fails → return `{"status": "failed", "error": "..."}`

---

### 3. `GET /init_sim/status/{conversation_id}` - Status Check ⭐ NEW

**Purpose:** Check initialization progress (for long-running operations).

**Output:**
```json
{
  "conversation_id": "uuid",
  "status": "in_progress | initialized | failed",
  "current_step": "segment | label | validate | build",
  "progress": {
    "segments_count": 4,
    "entities_count": 0,  // Not yet labeled
    "has_scene": false
  }
}
```

---

### 4. `POST /chat` - Conversational Chat (Legacy, kept for Q&A)

**Purpose:** Ask questions about simulation, modify parameters, etc.

**Input:**
```json
{
  "message": "What happens if I increase mass A to 5kg?",
  "conversation_id": "uuid",
  "mode": "ask"  // NOT "agent"
}
```

**Output:**
```json
{
  "assistant_message": "Increasing mass A would...",
  "conversation_id": "uuid"
}
```

**Note:** `/chat` is NO LONGER used for initialization workflow in v0.5.

---

## Tool Catalog (v0.4, used by /init_sim)

### 1. `segment_image` - SAM/SAM2 Segmentation

**Input:**
```json
{
  "image_data": "base64_encoded_image | file_path | image_id",
  "mode": "bbox | polygon | mask",
  "sam_server_url": "http://localhost:9001/segment"
}
```

**Output:**
```json
{
  "segments": [
    {"id": 1, "bbox": [x,y,w,h], "polygon_px": [[x,y],...], "mask_path": "s3://..."}
  ],
  "image": {"width_px": W, "height_px": H, "image_id": "uuid"}
}
```

**Purpose:** Extract object boundaries from physics diagram image.

---

### 2. `label_segments` - GPT-5 Entity Recognition

**Input:**
```json
{
  "image_id": "uuid",
  "segments": [{...}],
  "context": "This is a pulley system with friction",
  "use_vision": true
}
```

**Output:**
```json
{
  "version": "v0.4",
  "entities": [
    {"segment_id": "1", "type": "mass", "props": {"mass_guess_kg": 3.0, "material": "wood"}},
    {"segment_id": "2", "type": "pulley", "props": {"wheel_radius_m": 0.1}},
    {"segment_id": "3", "type": "surface", "props": {"mu_k": 0.5}}
  ],
  "confidence": {"overall": 0.92, "per_entity": [0.95, 0.88, 0.93]}
}
```

**Purpose:** Identify physics entities and estimate properties from visual/text cues.

**Entity Types:** `mass`, `pulley`, `surface`, `ramp`, `spring`, `pendulum_pivot`, `anchor`, `rope`

---

### 3. `build_physics_scene` - Universal Physics Builder ⭐

**Input:**
```json
{
  "image": {"width_px": W, "height_px": H},
  "segments": [{"id": 1, "bbox": [x,y,w,h], "polygon_px": [[x,y],...]}],
  "entities": [{...}],
  "mapping": {"origin_mode": "image_center", "scale_m_per_px": 0.01},
  "defaults": {"gravity_m_s2": 9.81, "time_step_s": 0.016}
}
```

**Output:**
```json
{
  "scene": {
    "version": "0.4.0",
    "world": {
      "gravity_m_s2": 9.81,
      "time_step_s": 0.016
    },
    "bodies": [
      {
        "id": "mass_1",
        "type": "dynamic",
        "mass_kg": 3.0,
        "position_m": [0.5, 1.2],
        "velocity_m_s": [0, 0],
        "collider": {
          "type": "rectangle",
          "width_m": 0.1,
          "height_m": 0.1
        }
      }
    ],
    "constraints": [
      {
        "type": "rope",
        "body_a": "mass_1",
        "body_b": "mass_2",
        "length_m": 2.0,
        "stiffness": 1.0
      }
    ]
  },
  "warnings": ["Mass inferred from bbox area", "Rope length derived from geometry"],
  "meta": {
    "builder": "universal_v1",
    "entity_count": 3,
    "constraint_count": 1
  }
}
```

**Purpose:** Convert entities + geometry → Matter.js-ready Scene JSON.

**Key Features:**
- **No scene-kind restrictions** - any entity combination supported
- **Dynamic constraint inference** - GPT-5 determines physical relationships
- **Flexible body count** - 1 to N bodies, not limited to 2
- **Multiple constraint types** - rope, spring, hinge, fixed, distance

---

### 4. `simulate_physics` - Matter.js Simulation

**Input:**
```json
{
  "scene": {...},
  "duration_s": 5.0,
  "frame_rate": 60
}
```

**Output:**
```json
{
  "frames": [
    {
      "t": 0.000,
      "positions": {"mass_1": [0.5, 1.2], "mass_2": [0.5, 0.8]},
      "velocities": {"mass_1": [0, 0], "mass_2": [0, 0]},
      "forces": {"mass_1": [0, -29.43], "mass_2": [0, -58.86]}
    },
    {
      "t": 0.016,
      "positions": {"mass_1": [0.5, 1.201], "mass_2": [0.5, 0.799]},
      "velocities": {"mass_1": [0, 0.08], "mass_2": [0, -0.08]},
      "forces": {"mass_1": [0, -29.43], "mass_2": [0, -58.86]}
    }
  ],
  "meta": {
    "engine": "matter-js v0.19",
    "frames_count": 312,
    "simulation_time_s": 5.0
  }
}
```

**Purpose:** Run Matter.js 2D rigid body physics simulation.

**Note:** Analytic solver removed in v0.4 - all simulations use Matter.js.

---

### 5. `analyze_simulation` - Physics Analysis

**Input:**
```json
{
  "frames": [{...}],
  "scene": {...},
  "analysis_type": "energy_conservation | forces | motion_summary | all"
}
```

**Output:**
```json
{
  "energy_conservation": {
    "initial_total_j": 100.0,
    "final_total_j": 99.8,
    "error_percent": 0.2,
    "drift": "acceptable"
  },
  "forces": {
    "mass_1": {"avg_force_n": 29.43, "max_force_n": 35.2},
    "mass_2": {"avg_force_n": 58.86, "max_force_n": 62.1}
  },
  "motion_summary": {
    "mass_1": {"max_velocity_m_s": 1.5, "displacement_m": [0, 0.3]},
    "mass_2": {"max_velocity_m_s": 1.5, "displacement_m": [0, -0.3]},
    "system_behavior": "Mass 2 descends, mass 1 rises with constant acceleration"
  },
  "pedagogical_insights": [
    "System conserves energy within 0.2% (excellent)",
    "Acceleration matches theoretical prediction: a = 1.96 m/s²",
    "Rope constraint maintains constant total length"
  ]
}
```

**Purpose:** Validate physics correctness and provide educational insights.

---

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

### Entity Schema (GPT-5 Output)
```typescript
{
  segment_id: string,
  type: "mass" | "pulley" | "surface" | "ramp" | "spring" | "pendulum_pivot" | "anchor" | "rope",
  props: {
    // Type-specific properties (all optional, builder provides defaults)
    mass_guess_kg?: number,
    wheel_radius_m?: number,
    mu_k?: number,           // kinetic friction coefficient
    material?: string,
    spring_constant_n_m?: number,
    length_m?: number,
    ...
  },
  confidence?: number  // 0-1, from Vision API
}
```

### Scene Schema (Universal Builder Output)
```typescript
{
  version: "0.4.0",
  world: {
    gravity_m_s2: number,      // default: 9.81
    time_step_s: number        // default: 0.016 (60 fps)
  },
  bodies: Array<{
    id: string,                // unique identifier
    type: "dynamic" | "static" | "kinematic",
    mass_kg: number,
    position_m: [x: number, y: number],
    velocity_m_s?: [vx: number, vy: number],
    angle_rad?: number,
    angular_velocity_rad_s?: number,
    collider: {
      type: "circle" | "rectangle" | "polygon",
      // Circle
      radius_m?: number,
      // Rectangle
      width_m?: number,
      height_m?: number,
      // Polygon
      vertices?: Array<[x: number, y: number]>
    },
    material?: {
      friction?: number,       // 0-1
      restitution?: number     // 0-1 (bounciness)
    }
  }>,
  constraints: Array<{
    type: "rope" | "spring" | "hinge" | "fixed" | "distance",
    body_a?: string,           // body id (null for world anchor)
    body_b?: string,
    point_a_m?: [x: number, y: number],  // local attachment point
    point_b_m?: [x: number, y: number],
    // Rope/Distance
    length_m?: number,
    // Spring
    stiffness?: number,
    damping?: number,
    // Hinge
    angle_limits?: [min: number, max: number]
  }>
}
```

---

## Universal Builder Logic

### Entity → Body Mapping

```python
def create_body_from_entity(entity, segment, mapping):
    """Convert any entity to Matter.js body"""
    
    # Position from segment bbox center
    bbox = segment["bbox"]
    pos_px = [bbox[0] + bbox[2]/2, bbox[1] + bbox[3]/2]
    pos_m = px_to_meters(pos_px, mapping)
    
    # Mass estimation
    if entity["type"] == "mass":
        mass_kg = entity["props"].get("mass_guess_kg") or estimate_from_area(segment)
    elif entity["type"] == "pulley":
        mass_kg = 0.1  # Small mass for pulley wheel
    elif entity["type"] == "surface":
        return create_static_body(segment, mapping)  # Static ground
    
    # Collider from polygon or bbox
    if segment.get("polygon_px"):
        collider = create_polygon_collider(segment["polygon_px"], mapping)
    else:
        collider = create_rectangle_collider(bbox, mapping)
    
    return {
        "id": f"{entity['type']}_{entity['segment_id']}",
        "type": "dynamic" if entity["type"] == "mass" else "static",
        "mass_kg": mass_kg,
        "position_m": pos_m,
        "collider": collider
    }
```

### Constraint Inference

```python
def infer_constraints(entities, bodies, segments):
    """GPT-5 determines physical relationships"""
    
    constraints = []
    
    # Find pulleys and connected masses
    pulleys = [e for e in entities if e["type"] == "pulley"]
    masses = [e for e in entities if e["type"] == "mass"]
    
    for pulley in pulleys:
        # Find masses vertically aligned with pulley
        connected = find_vertically_aligned(pulley, masses, segments)
        
        if len(connected) >= 2:
            # Create rope constraint through pulley
            rope_length = calculate_rope_length(connected, pulley, segments)
            constraints.append({
                "type": "rope",
                "body_a": connected[0]["id"],
                "body_b": connected[1]["id"],
                "length_m": rope_length,
                "via_pulley": pulley["id"]  # Matter.js composite constraint
            })
    
    # Find springs
    springs = [e for e in entities if e["type"] == "spring"]
    for spring in springs:
        attached = find_adjacent_mass(spring, masses, segments)
        if attached:
            constraints.append({
                "type": "spring",
                "body_a": attached["id"],
                "body_b": None,  # Anchored to world
                "stiffness": spring["props"].get("spring_constant_n_m", 100),
                "length_m": 0.5
            })
    
    return constraints
```

---

## Agent Workflow Example

**User:** "Simulate this pulley diagram" [uploads image]

**Agent:**
1. Calls `segment_image(image)` → gets segments
2. Calls `label_segments(segments, image)` → gets entities
3. Analyzes entities: "I see 2 masses and 1 pulley"
4. Calls `build_physics_scene(segments, entities)` → Universal Builder creates scene
5. Shows user: "Built scene with 2 dynamic bodies connected via rope through pulley"
6. Calls `simulate_physics(scene)` → Matter.js runs simulation
7. Calls `analyze_simulation(frames, scene)` → Get physics insights
8. Returns: "Mass B (6kg) descends at 1.96 m/s², energy conserved within 0.2%"

**User:** "What if I add a third mass?"

**Agent:**
1. User uploads modified image or describes change
2. Re-runs pipeline with 3 masses
3. Universal Builder adapts: creates 3 bodies + appropriate constraints
4. New simulation runs automatically
5. Returns updated analysis

---

## Implementation Requirements

### Backend Structure (v0.5)
```
backend/app/
├── routers/
│   ├── unified_chat.py          # Legacy /chat endpoint (Q&A only)
│   ├── init_sim.py              # NEW: /init_sim endpoint ⭐
│   ├── run_sim.py               # NEW: /run_sim endpoint ⭐
│   └── diagram.py               # Image upload
├── agent/
│   ├── tools/
│   │   ├── segment_image.py
│   │   ├── label_segments.py
│   │   ├── validate_entities.py # NEW: Entity validation ⭐
│   │   ├── build_scene.py       # Universal Builder
│   │   ├── simulate_physics.py
│   │   └── analyze_results.py
│   └── context_store.py         # Conversation state management
└── sim/
    ├── universal_builder.py     # Dynamic scene construction
    ├── constraint_resolver.py   # Infer physical relationships
    └── matter_engine.py         # Matter.js wrapper
```

### Frontend Structure (v0.5)
```
frontend/src/
├── lib/
│   ├── agent-api.ts             # MODIFY: Add init_sim, run_sim calls ⭐
│   └── unified-chat-api.ts      # Legacy chat
├── components/
│   └── simulation/
│       └── simulation-box-node.tsx  # MODIFY: Add "Convert Simulation" button ⭐
└── hooks/
    └── use-simulation-box-agent.ts  # MODIFY: Use /init_sim instead of /chat ⭐
```

### Key Files to Create/Modify

#### **NEW Files (Backend)**

1. **`routers/init_sim.py`** ⭐
   - `POST /init_sim` endpoint
   - Sequential execution: segment → label → validate → build
   - Return initialization result with scene data
   ```python
   @router.post("/init_sim")
   async def initialize_simulation(
       image_id: str,
       conversation_id: Optional[str] = None,
       options: Optional[dict] = None
   ):
       # 1. Segment image
       segments = await segment_image_tool(image_id)
       
       # 2. Label segments
       entities = await label_segments_tool(image_id, segments)
       
       # 3. Validate entities (optional)
       validation = validate_entities_tool(entities)
       
       # 4. Build scene
       scene = build_physics_scene_tool(segments, entities)
       
       return {
           "status": "initialized",
           "conversation_id": conversation_id,
           "initialization": {
               "segments_count": len(segments),
               "entities_count": len(entities),
               "scene": scene,
               "warnings": validation.get("warnings", [])
           },
           "ready_for_simulation": True
       }
   ```

2. **`routers/run_sim.py`** ⭐
   - `POST /run_sim` endpoint
   - Load pre-built scene from context
   - Run simulation + analysis
   ```python
   @router.post("/run_sim")
   async def run_simulation(
       conversation_id: str,
       duration_s: float = 5.0,
       frame_rate: int = 60,
       analyze: bool = True
   ):
       # Load scene from context
       context = context_store.get_context(conversation_id)
       if not context or not context.scene:
           raise HTTPException(400, "Scene not initialized. Call /init_sim first.")
       
       # Simulate
       frames = await simulate_physics_tool(context.scene, duration_s, frame_rate)
       
       # Analyze (optional)
       analysis = None
       if analyze:
           analysis = analyze_simulation_tool(frames, context.scene)
       
       return {
           "status": "simulated",
           "frames": frames,
           "analysis": analysis
       }
   ```

3. **`agent/tools/validate_entities.py`** ⭐
   - Check entity consistency
   - Warn about missing properties
   - Detect impossible configurations
   ```python
   def validate_entities_tool(entities: List[dict]) -> dict:
       warnings = []
       errors = []
       
       # Check for at least one dynamic body
       dynamic_entities = [e for e in entities if e["type"] == "mass"]
       if not dynamic_entities:
           warnings.append("No dynamic bodies found")
       
       # Check for unrealistic masses
       for entity in entities:
           if entity["type"] == "mass":
               mass = entity["props"].get("mass_guess_kg", 0)
               if mass < 0.1 or mass > 1000:
                   warnings.append(f"Unusual mass: {mass}kg")
       
       return {
           "valid": len(errors) == 0,
           "warnings": warnings,
           "errors": errors
       }
   ```

#### **MODIFY Files (Frontend)**

1. **`lib/agent-api.ts`** ⭐
   - Add `sendInitSimulation()` function
   - Add `runSimulation()` function
   ```typescript
   export async function sendInitSimulation(
     imageId: string,
     conversationId?: string
   ): Promise<InitSimResponse> {
     const response = await fetch(`${API_BASE}/init_sim`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         image_id: imageId,
         conversation_id: conversationId,
       }),
     });
     return response.json();
   }
   
   export async function runSimulation(
     conversationId: string,
     duration_s: number = 5.0
   ): Promise<SimulationResponse> {
     const response = await fetch(`${API_BASE}/run_sim`, {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({
         conversation_id: conversationId,
         duration_s,
         frame_rate: 60,
         analyze: true,
       }),
     });
     return response.json();
   }
   ```

2. **`hooks/use-simulation-box-agent.ts`** ⭐
   - Replace `/chat` call with `/init_sim` on image upload
   - Add state: `isInitialized`, `readyForSimulation`
   ```typescript
   useEffect(() => {
     if (backgroundImage && !hasRunInitialization) {
       console.log('[Agent] 🖼️ Image uploaded, running initialization...');
       
       // Call /init_sim instead of /chat
       sendInitSimulation(imageId, conversationId)
         .then((result) => {
           if (result.status === 'initialized') {
             setIsInitialized(true);
             setReadyForSimulation(true);
             // Store scene data
             setSceneData(result.initialization.scene);
           }
         });
       
       setHasRunInitialization(true);
     }
   }, [backgroundImage]);
   ```

3. **`components/simulation/simulation-box-node.tsx`** ⭐
   - Add "Convert Simulation" button
   - Show button only when `readyForSimulation === true`
   - Button click triggers `runSimulation()`
   ```tsx
   {readyForSimulation && !hasSimulation && (
     <Button
       onClick={handleConvertSimulation}
       className="..."
     >
       ▶️ Convert Simulation
     </Button>
   )}
   
   const handleConvertSimulation = async () => {
     try {
       const result = await runSimulation(conversationId);
       if (result.status === 'simulated') {
         setFrames(result.frames);
         setHasSimulation(true);
       }
     } catch (error) {
       console.error('Simulation failed:', error);
     }
   };
   ```

---

## Migration Strategy (v0.4 → v0.5)

### Phase 1: Create /init_sim Endpoint 🔄
- Create `backend/app/routers/init_sim.py`
- Implement sequential tool execution (no GPT-5 Agent)
- Add error handling for each step
- Test with sample images

### Phase 2: Create /run_sim Endpoint 🔄
- Create `backend/app/routers/run_sim.py`
- Load scene from context store
- Execute simulation + analysis
- Return structured results

### Phase 3: Update Frontend API Client 🔄
- Modify `agent-api.ts`: Add `sendInitSimulation()`, `runSimulation()`
- Update `use-simulation-box-agent.ts`: Call `/init_sim` on image upload
- Remove old `/chat` initialization logic

### Phase 4: Add "Convert Simulation" Button 🔄
- Modify `simulation-box-node.tsx`
- Add button component (appears after initialization)
- Connect to `runSimulation()` API call
- Handle loading/error states

### Phase 5: Deprecate /chat for Initialization ✅
- Keep `/chat` endpoint for Q&A only
- Update system prompt: Remove auto-initialization instructions
- Frontend no longer sends `mode: "agent"` for image uploads

---

## Testing Strategy

### Unit Tests
```python
def test_init_sim_sequential_execution():
    """Test /init_sim executes all steps in order"""
    response = await init_sim(image_id="test_pulley.png")
    assert response["status"] == "initialized"
    assert response["initialization"]["segments_count"] > 0
    assert response["initialization"]["entities_count"] > 0
    assert response["initialization"]["scene"] is not None

def test_run_sim_requires_initialization():
    """Test /run_sim fails without /init_sim"""
    with pytest.raises(HTTPException) as exc:
        await run_sim(conversation_id="uninitialized")
    assert exc.value.status_code == 400
    assert "not initialized" in exc.value.detail

def test_validate_entities_warnings():
    """Test entity validation detects issues"""
    entities = [{"type": "mass", "props": {"mass_guess_kg": 0.01}}]  # Too light
    validation = validate_entities_tool(entities)
    assert len(validation["warnings"]) > 0
    assert "Unusual mass" in validation["warnings"][0]
```

### Integration Tests
- Upload image → Call `/init_sim` → Verify all 4 steps complete
- Call `/run_sim` without `/init_sim` → Verify error response
- Upload various diagrams → Check initialization adapts correctly
- Click "Convert Simulation" button → Verify simulation runs

### Frontend Tests
```typescript
describe('Simulation Workflow', () => {
  it('should show "Convert Simulation" button after initialization', async () => {
    // Upload image
    await uploadImage(testImage);
    
    // Wait for initialization
    await waitFor(() => {
      expect(screen.getByText('Convert Simulation')).toBeInTheDocument();
    });
  });
  
  it('should run simulation when button clicked', async () => {
    // Setup: Already initialized
    render(<SimulationBox initialized={true} />);
    
    // Click button
    fireEvent.click(screen.getByText('Convert Simulation'));
    
    // Verify API call
    await waitFor(() => {
      expect(mockRunSimulation).toHaveBeenCalled();
    });
  });
});
```

---

## Acceptance Criteria

### v0.5 Requirements
- ✅ `/init_sim` endpoint created and working
- ✅ Sequential execution: segment → label → validate → build
- ✅ `/run_sim` endpoint created and working
- ✅ Frontend calls `/init_sim` on image upload (not `/chat`)
- ✅ "Convert Simulation" button appears after initialization
- ✅ Button triggers `/run_sim` API call
- ✅ Simulation only runs when user explicitly clicks button
- ✅ Initialization state tracked in UI
- ✅ Error handling for each pipeline step
- ✅ All tests pass (unit + integration)

### Success Metrics
- Image upload → initialization completes in < 5 seconds
- User sees clear feedback: "Detected 2 masses, 1 pulley"
- "Convert Simulation" button appears immediately after init
- Simulation starts within 1 second of button click
- No automatic simulation execution (user control maintained)
- Error messages are clear and actionable

---

## Roadmap

### v0.5 (Current): Automated Initialization Workflow
- Create `/init_sim` endpoint with sequential pipeline
- Create `/run_sim` endpoint for manual simulation trigger
- Add "Convert Simulation" button to UI
- Remove GPT-5 Agent dependency for initialization

### v0.6 (Next): Real-time Progress Updates
- WebSocket support for initialization progress
- Live updates: "Segmenting... 50% complete"
- Streaming simulation frames to frontend
- Cancel initialization/simulation mid-process

### v0.7 (Future): Advanced Validation
- Physics plausibility checks (energy, forces)
- Suggest corrections: "Mass too light for observed motion"
- Interactive entity editing before simulation
- Compare simulation vs theoretical predictions

---

**Status**: v0.5 specification complete, ready for implementation  
**Breaking Changes**: `/chat` no longer handles image upload workflow  
**Migration Path**: Frontend must call `/init_sim` → `/run_sim` instead of single `/chat` call
````