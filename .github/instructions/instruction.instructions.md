---
applyTo: '**'
---
Project Einstein – GPT↔Simulator Interface (Authoritative Instruction)

Goal
Define and validate a robust interface that bridges GPT’s semantic understanding of diagram segments and the physics simulator’s scene requirements. We assume high-quality segments from SAM/SAM2 and accurate labeling from GPT-5. Our job is to specify the intermediate contracts and implement a minimal but testable builder that produces a simulator-ready Scene JSON (Rapier 2D).

Key Principles
- Separation of concerns: segmentation (SAM) → labeling (GPT) → scene assembly (Interface Builder) → simulation (Rapier)
- Contracts over heuristics: precise JSON schemas for inputs/outputs; deterministic, testable transforms
- Coordinate rigor: explicit px↔m mapping, origin policy, and reference consistency (segment ids ↔ entities ↔ bodies)

Data Contracts
1) Segments (from SAM)
  - Format:
    {
      "segments": [
        { "id": 1, "bbox": [x,y,w,h], "polygon_px": [[x,y],...], "mask_path": null }
      ],
      "image": { "width_px": W, "height_px": H }
    }

2) GPT Labels (from GPT-5)
  - Format (strict JSON):
    {
      "entities": [
        { "segment_id": "1", "label": "mass", "props": { "mass_guess_kg": 2.0 } },
        { "segment_id": "3", "label": "pulley", "props": { "wheel_radius_m": 0.1 } },
        { "segment_id": "4", "label": "surface" }
      ]
    }

3) Build Scene Request (Interface Builder input)
  - Format:
    {
      "image": { "width_px": W, "height_px": H },
      "segments": [{ "id": 1, "bbox": [x,y,w,h], "polygon_px": [[x,y],...] }],
      "labels": { "entities": [...] },
      "mapping": { "origin_mode": "anchor_centered", "scale_m_per_px": S },
      "defaults": { "gravity_m_s2": 9.81 }
    }

4) Build Scene Response (Interface Builder output)
  - Format:
    {
      "scene": <Scene JSON v0.1.0>,
      "warnings": ["string"],
      "meta": { "source": "sam+gpt", "resolver": "v1" }
    }

Scene JSON (Simulator-ready)
- Canonical schema defined in backend/app/sim/schema.py (v0.1.0) for a single fixed pulley:
  - world: gravity/time_step
  - bodies: exactly two dynamic bodies with mass and initial position (meters)
  - constraints: one ideal_fixed_pulley with anchor and rope_length (computed if omitted)
  - normalization: reference checks + rope length derivation

Builder Rules (v1)
- Entity mapping: pick exactly two masses (left→body_a=m1, right→body_b=m2), one pulley (anchor), optional surface (friction/scale hints)
- Positioning: body/pulley positions = centers of segment bboxes, mapped from px to meters using mapping.scale_m_per_px and origin_mode
- Masses: if GPT props.mass_guess_kg present, use; else infer mass ratio by bbox areas and scale from a base value
- Rope length: derived from initial geometry unless provided; wheel radius optional
- Warnings: non-blocking anomalies (e.g., missing pulley, >2 masses) reported in response.warnings

APIs and Endpoints
- POST /diagram/parse: orchestrates segmentation→labeling→build→simulate (simulate optional via ?simulate=1) and returns images/detections/segments/mapping/scene/meta
- Internal interface function: build_scene(request) → response

Testing Strategy
- Unit: feed curated segments+labels into builder and assert a valid Scene (ids, counts, normalization, coordinate transforms)
- Property: sanity of px→m mapping around image center; deterministic selection of masses and pulley
- Integration (optional): run Rapier worker on built Scene, return frames for visualization

Roadmap
- v0.2: Interface Builder v1 (this doc), pulley.single_fixed_v0
- v0.3: Multi-body support; polygon colliders; better friction/scale estimation
- v0.4: Interactive editing loop (GPT suggestions ↔ scene delta)

Acceptance
- Given valid segments+labels+mapping, builder yields a valid Scene JSON (pydantic schema) with references intact and rope_length set.
- Basic tests run green.