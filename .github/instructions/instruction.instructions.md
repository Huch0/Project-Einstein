------

applyTo: '**'

------

# Project Einstein – Universal Physics Builder (v0.4)

## Goal

Build a **schema-less, universal physics simulation system** where GPT-5 Agent dynamically generates physics scenes from any combination of entities. The system eliminates rigid scene-kind schemas in favor of a flexible, composition-based approach powered by Matter.js.

**Key Changes from v0.3:**
- ❌ **REMOVED:** Analytic solver (all simulations use Matter.js)
- ❌ **REMOVED:** Static scene-kind schemas (`pulley.single_fixed_v0`, etc.)
- ✅ **NEW:** Universal Physics Builder (handles any entity combination)
- ✅ **NEW:** Dynamic constraint resolution (GPT-5 infers physical relationships)



## Architecture Philosophy

### Core Principles

1. **Composition over Classification**
   - No predefined scene types (pulley, ramp, pendulum)
   - Build scenes by composing entities: mass + mass + pulley → pulley system
   - Any combination is valid if physically meaningful

2. **Matter.js Only**
   - Single physics engine eliminates complexity
   - All simulations use realistic 2D rigid body dynamics
   - Constraints implemented via Matter.js constraint library

3. **Dynamic Constraint Resolution**
   - GPT-5 infers relationships: "mass A connects to pulley via rope"
   - Universal Builder translates to Matter.js constraints
   - No hardcoded scene templates

4. **Zero Schema Rigidity**
   - Scene JSON structure is flexible
   - `bodies: []` can have 1, 2, 10, or 100 bodies
   - `constraints: []` supports any combination of constraint types



## Pipeline Overview

```
┌──────────────┐
│ User uploads │
│    image     │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│  SAM Segmentation    │ ← Detects object boundaries
│  Tool: segment_image │
└──────┬───────────────┘
       │ segments: [{id, bbox, polygon_px}, ...]
       ▼
┌──────────────────────────┐
│  GPT-5 Entity Labeling   │ ← "This is a mass, pulley, etc."
│  Tool: label_segments    │
└──────┬───────────────────┘
       │ entities: [{type: "mass", props: {...}}, ...]
       ▼
┌──────────────────────────────┐
│  Universal Physics Builder   │ ← Composes Matter.js scene
│  Tool: build_physics_scene   │ ← NO SCHEMA RESTRICTIONS
└──────┬───────────────────────┘
       │ scene: {bodies, constraints, world}
       ▼
┌──────────────────────┐
│  Matter.js Simulator │ ← Runs 2D rigid body physics
│  Tool: simulate      │
└──────┬───────────────┘
       │ frames: [{t, positions, velocities}, ...]
       ▼
┌──────────────────────┐
│  Physics Analysis    │ ← Energy, forces, pedagogical insights
│  Tool: analyze       │
└──────────────────────┘
```

## Tool Catalog (v0.4)

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

### Backend Structure (v0.4)
```
backend/app/
├── agent/
│   ├── tools/
│   │   ├── segment_image.py
│   │   ├── label_segments.py
│   │   ├── build_scene.py       # Universal Builder
│   │   ├── simulate_physics.py  # Matter.js only
│   │   └── analyze_results.py
│   ├── prompts/
│   │   ├── agent_system.yaml
│   │   └── labeler_system.yaml
│   └── tool_registry.py
├── sim/
│   ├── schema.py                # Flexible Scene schema
│   ├── universal_builder.py     # NEW: Dynamic scene construction
│   ├── constraint_resolver.py   # NEW: Infer physical relationships
│   └── matter_engine.py         # Matter.js wrapper
└── routers/
    ├── diagram.py               # Legacy endpoint
    └── agent.py                 # Agent chat endpoint
```

### Key Files to Modify

1. **`sim/universal_builder.py`** (NEW)
   - `build_scene_universal(entities, segments, mapping)` → Scene JSON
   - No scene-kind branching
   - Dynamic constraint inference

2. **`sim/constraint_resolver.py`** (NEW)
   - `infer_rope_constraints(pulleys, masses, segments)`
   - `infer_spring_constraints(springs, masses)`
   - `infer_contact_surfaces(surfaces, masses)`

3. **`sim/schema.py`** (MODIFY)
   - Remove `Literal["pulley.single_fixed_v0"]`
   - Make `bodies` flexible length
   - Add all constraint types

4. **`sim/matter_engine.py`** (KEEP, remove analytic)
   - Remove `simulatePulleyAnalytic`
   - Keep only Matter.js simulation
   - Add support for all constraint types

---

## Migration Strategy

### Phase 1: Remove Analytic Solver ✅
- Delete `backend/app/sim/pulleyAnalytic.py`
- Remove `engine: "matter-js | analytic"` parameter
- Update all `simulate_physics` calls to use Matter.js only
- Remove analytic fallback logic in frontend

### Phase 2: Implement Universal Builder ✅
- Create `universal_builder.py` with flexible scene construction
- Implement `constraint_resolver.py` for dynamic constraint inference
- Update `schema.py` to allow any body/constraint count
- Add tests for various entity combinations

### Phase 3: Remove Static Builders 🔄
- Keep old builders in `sim/builders/legacy/` for reference
- Redirect all build requests to Universal Builder
- Verify backward compatibility with existing scenes
- Update documentation

### Phase 4: Frontend Integration ✅
- Remove analytic-specific UI code
- Update SimulationContext to expect only Matter.js frames
- Add support for N-body visualization (not just 2 masses)
- Test with complex scenarios (3+ bodies, multiple constraints)

---

## Testing Strategy

### Unit Tests
```python
def test_universal_builder_pulley():
    """2 masses + 1 pulley → valid scene"""
    entities = [mass_a, mass_b, pulley]
    scene = build_scene_universal(entities, segments, mapping)
    assert len(scene["bodies"]) == 2
    assert len(scene["constraints"]) == 1
    assert scene["constraints"][0]["type"] == "rope"

def test_universal_builder_triple_mass():
    """3 masses + 2 pulleys → valid scene"""
    entities = [mass_a, mass_b, mass_c, pulley_1, pulley_2]
    scene = build_scene_universal(entities, segments, mapping)
    assert len(scene["bodies"]) == 3
    assert len(scene["constraints"]) == 2

def test_universal_builder_spring_mass():
    """1 mass + 1 spring → valid scene"""
    entities = [mass, spring]
    scene = build_scene_universal(entities, segments, mapping)
    assert scene["constraints"][0]["type"] == "spring"
```

### Integration Tests
- Upload various diagrams (pulley, ramp, pendulum, spring, hybrid)
- Verify Universal Builder handles all cases
- Check Matter.js simulation runs without errors
- Validate energy conservation in all scenarios

---

## Acceptance Criteria

### v0.4 Requirements
- ✅ Analytic solver completely removed
- ✅ All simulations use Matter.js
- ✅ Universal Builder handles any entity combination
- ✅ No `scene_kind` field in Scene JSON
- ✅ Dynamic constraint inference working
- ✅ 3+ body simulations supported
- ✅ Multiple constraint types (rope, spring, hinge, etc.)
- ✅ Backward compatible with v0.3 scenes
- ✅ All tests pass (unit + integration)
- ✅ Documentation updated

### Success Metrics
- Can simulate pulley, ramp, pendulum, spring-mass with same builder
- Can handle 10+ bodies in single scene
- Energy conservation < 1% error for all scenarios
- Build time < 500ms for complex scenes
- No hardcoded scene-kind logic anywhere

---

## Roadmap

### v0.4 (Current): Universal Physics Builder
- Remove analytic solver
- Implement Universal Builder
- Dynamic constraint inference
- Flexible scene schema

### v0.5 (Next): Advanced Constraints
- Hinge joints with angle limits
- Motor constraints (powered motion)
- Soft body simulation (deformable objects)
- Collision groups and filters

### v0.6 (Future): 3D Support
- Migrate to Rapier3D
- 3D entity recognition
- Camera controls for 3D view
- Volume-based mass estimation

---

**Status**: v0.4 specification complete, ready for implementation  
**Breaking Changes**: Analytic solver removed, scene schema simplified  
**Migration Path**: All v0.3 scenes automatically converted by Universal Builder
````