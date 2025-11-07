# Matter.js Physics Law Enablement Plan

## Current Observations

- Equal-mass blocks that should exchange velocity during collisions currently merge and drift, indicating nearly perfectly inelastic responses.
- Dynamic bodies are initialized with correct positions and velocities, but collision restitution defaults to `0.0`, so kinetic energy is lost instead of conserved.
- Backend scene schema (`material.restitution`, `material.friction`) is parsed but the front-end `matterRunner` ignores these fields when constructing `Matter.Body` instances.
- No per-collision debugging instrumentation exists, making it hard to confirm solver inputs.

## Root Cause Summary

1. **Restitution dropped:** `createBody` in `frontend/src/simulation/matterRunner.ts` always creates bodies with Matter’s default restitution (0) because the renderer copies only `fillStyle`, `strokeStyle`, and `lineWidth`. Consequently, collisions are entirely inelastic.
2. **Material metadata unused:** The backend already emits `material.restitution` and `material.friction`; ignoring them prevents the physics layer from honoring analytic expectations (e.g., elastic collisions on a frictionless track).
3. **No override pathway:** There is no UI or configuration surface to tune these coefficients after scene load, so even manual fixes require code changes.

## Implementation Plan

### 1. Propagate Material Properties

- Extend `createBody` to read `bodyDef.material.restitution` and `bodyDef.material.friction`.
- Clamp values to sensible ranges (`restitution` between 0 and 1, `friction` ≥ 0).
- Use `Body.set(body, 'restitution', value)` or include `restitution` / `friction` on the `Matter.IBodyDefinition` passed to `Bodies.rectangle`, `Bodies.circle`, etc.
- Preserve scene defaults by falling back to a configurable constant (`DEFAULT_DYNAMIC_RESTITUTION = 1.0` for perfectly elastic collisions).

### 2. Provide Simulation-Level Overrides

- Add optional override parameters to `runMatterSimulation(scene, options)`:

  ```ts
  type MatterSimulationOptions = {
    duration_s?: number;
    maxSteps?: number;
    restitutionOverride?: number | null;
    frictionOverride?: number | null;
  };
  ```

- When overrides are provided, apply them to dynamic bodies to quickly experiment without regenerating scenes.

### 3. Expose Controls in the UI

- Surface restitution/friction in the simulation context so advanced users (and automated tests) can request elastic or inelastic behavior.
- Maintain the backend value as the default; the UI overrides would simply call `updateSceneAndResimulate` with modified `material` properties before re-running Matter.js.

### 4. Instrument & Validate

- Register a debug listener:

  ```ts
  Matter.Events.on(engine, 'collisionStart', ({ pairs }) => {
    pairs.forEach(({ bodyA, bodyB }) => console.debug('collision', bodyA.label, bodyB.label));
  });
  ```

- Add unit tests using a simplified two-body scene to assert post-collision velocities approximate theoretical elastic results within tolerance.
- Use a reproducible fixture in `frontend/tests/` that seeds two equal masses with opposing velocities; verify they exchange speeds when restitution ≈ 1.

### 5. Safeguards & Tuning

- Ensure bodies converted to canvas space keep consistent mass (already handled through `Body.setMass`).
- Maintain angular velocity correction (`anglePrev`) to avoid energy spikes when restitution > 0.
- For partially inelastic problems, allow restitution values between 0 and 1; document expected behavior for educators.

## Next Steps Checklist

1. Update `matterRunner.createBody` to apply material restitution/friction.
2. Add optional overrides to `runMatterSimulation` and thread them through `SimulationContext` as needed.
3. Build a regression test for equal-mass head-on collisions verifying momentum exchange when restitution ≥ 0.95.
4. Document new controls for the pedagogy/UX team so they understand how to request elastic vs inelastic collisions.
