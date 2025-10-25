#!/usr/bin/env node
/**
 * Matter.js Physics Worker for Project Einstein
 * Reads Scene JSON from stdin, simulates with Matter.js, outputs frames to stdout.
 */

import Matter from 'matter-js';
import fs from 'fs';

const { Engine, World, Bodies, Constraint, Runner } = Matter;

/**
 * Convert Scene JSON to Matter.js world
 */
function toMatter(scene) {
  // Create engine with gravity
  const gravity = scene.world?.gravity_m_s2 ?? 9.81;
  const engine = Engine.create({
    gravity: { x: 0, y: gravity }, // Matter.js uses y-down by default (same as our scene!)
  });

  const bodyMap = new Map(); // id -> Matter.Body
  const constraints = [];

  // Create bodies
  for (const bodyDef of scene.bodies || []) {
    const { id, mass_kg, position_m, collider } = bodyDef;
    const [x, y] = position_m;

    let body;
    if (collider?.type === 'circle') {
      const radius = collider.radius_m;
      body = Bodies.circle(x, y, radius, {
        mass: mass_kg,
        friction: 0.0,
        frictionAir: 0.0,
        restitution: 0.0,
      });
    } else {
      // Default to small circle collider
      body = Bodies.circle(x, y, 0.05, {
        mass: mass_kg,
        friction: 0.0,
        frictionAir: 0.0,
        restitution: 0.0,
      });
    }

    body.label = id;
    bodyMap.set(id, body);
    World.add(engine.world, body);
  }

  // Create constraints (rope for pulley)
  for (const constraintDef of scene.constraints || []) {
    if (constraintDef.type === 'ideal_fixed_pulley') {
      const { pulley_anchor_m, body_a, body_b, rope_length_m } = constraintDef;
      const bodyA = bodyMap.get(body_a);
      const bodyB = bodyMap.get(body_b);

      if (!bodyA || !bodyB) {
        console.error(`[Matter] Missing bodies for pulley: ${body_a}, ${body_b}`);
        continue;
      }
      
      if (!pulley_anchor_m || pulley_anchor_m.length !== 2) {
        console.error(`[Matter] Invalid pulley_anchor_m:`, pulley_anchor_m);
        continue;
      }

      // Create two rope segments: anchor -> bodyA, anchor -> bodyB
      // Matter.js Constraint with stiffness=1 acts like an inextensible rope
      const dist1 = Math.hypot(bodyA.position.x - pulley_anchor_m[0], bodyA.position.y - pulley_anchor_m[1]);
      const dist2 = Math.hypot(bodyB.position.x - pulley_anchor_m[0], bodyB.position.y - pulley_anchor_m[1]);

      // Fixed anchor point (no body, just world space)
      const ropeA = Constraint.create({
        pointA: { x: pulley_anchor_m[0], y: pulley_anchor_m[1] },
        bodyB: bodyA,
        length: dist1,
        stiffness: 1.0, // Inextensible rope
        damping: 0.0,
      });

      const ropeB = Constraint.create({
        pointA: { x: pulley_anchor_m[0], y: pulley_anchor_m[1] },
        bodyB: bodyB,
        length: dist2,
        stiffness: 1.0,
        damping: 0.0,
      });

      World.add(engine.world, [ropeA, ropeB]);
      constraints.push({ ropeA, ropeB, bodyA, bodyB, anchor: pulley_anchor_m, totalLength: rope_length_m });

      console.error(`[Matter] Created pulley: anchor=${pulley_anchor_m}, dist1=${dist1.toFixed(3)}, dist2=${dist2.toFixed(3)}, rope_length=${rope_length_m.toFixed(3)}`);
    }
  }

  return { engine, bodyMap, constraints };
}

/**
 * Custom rope constraint enforcement
 * Matter.js constraints work independently, but for pulley we need coupled motion:
 * - When bodyA descends by Δd, bodyB must ascend by Δd
 * - Total rope length dist1 + dist2 = constant
 */
function enforcePulleyConstraints(constraints) {
  for (const pc of constraints) {
    const { bodyA, bodyB, anchor, totalLength } = pc;

    const p1 = bodyA.position;
    const p2 = bodyB.position;
    const dist1 = Math.hypot(p1.x - anchor[0], p1.y - anchor[1]);
    const dist2 = Math.hypot(p2.x - anchor[0], p2.y - anchor[1]);

    const error = (dist1 + dist2) - totalLength;

    if (Math.abs(error) < 0.001) continue; // Within tolerance

    // Direction vectors from anchor to bodies
    const n1x = (p1.x - anchor[0]) / dist1;
    const n1y = (p1.y - anchor[1]) / dist1;
    const n2x = (p2.x - anchor[0]) / dist2;
    const n2y = (p2.y - anchor[1]) / dist2;

    // Mass ratio for correction distribution
    const m1 = bodyA.mass;
    const m2 = bodyB.mass;
    const totalMass = m1 + m2;

    // Position correction (inverse mass weighting)
    const correction1 = -error * (m2 / totalMass);
    const correction2 = -error * (m1 / totalMass);

    Matter.Body.setPosition(bodyA, {
      x: p1.x + n1x * correction1,
      y: p1.y + n1y * correction1,
    });

    Matter.Body.setPosition(bodyB, {
      x: p2.x + n2x * correction2,
      y: p2.y + n2y * correction2,
    });

    // Velocity projection to prevent rope stretching rate
    const v1 = bodyA.velocity;
    const v2 = bodyB.velocity;
    const vn1 = v1.x * n1x + v1.y * n1y;
    const vn2 = v2.x * n2x + v2.y * n2y;
    const totalVn = vn1 + vn2; // Rope length rate

    if (Math.abs(totalVn) > 0.001) {
      const vCorrection = -totalVn * 0.5;

      Matter.Body.setVelocity(bodyA, {
        x: v1.x + n1x * vCorrection,
        y: v1.y + n1y * vCorrection,
      });

      Matter.Body.setVelocity(bodyB, {
        x: v2.x + n2x * vCorrection,
        y: v2.y + n2y * vCorrection,
      });
    }

    // Log only if error is significant (> 1mm)
    // This reduces console spam while keeping important warnings
    // if (Math.abs(error) > 0.001) {
    //   console.error(`[Matter enforcePulley] error=${error.toFixed(6)} dist1=${dist1.toFixed(3)} dist2=${dist2.toFixed(3)}`);
    // }
  }
}

/**
 * Run simulation
 */
function simulate(scene) {
  const { engine, bodyMap, constraints } = toMatter(scene);

  const timeStep = scene.world?.time_step_s ?? 0.016;
  const totalTime = 5.0; // 5 seconds for better visibility
  const numSteps = Math.ceil(totalTime / timeStep);

  const frames = [];

  // Initial frame (t=0)
  const positions0 = {};
  for (const [id, body] of bodyMap) {
    positions0[id] = [body.position.x, body.position.y];
  }
  frames.push({ t: 0, positions: positions0 });

  console.error(`[Matter] Starting simulation: ${numSteps} steps, dt=${timeStep}s`);

  // Run simulation
  for (let i = 0; i < numSteps; i++) {
    Engine.update(engine, timeStep * 1000); // Matter.js uses milliseconds

    // Apply custom pulley constraint enforcement
    enforcePulleyConstraints(constraints);

    const t = (i + 1) * timeStep;
    const positions = {};
    for (const [id, body] of bodyMap) {
      positions[id] = [body.position.x, body.position.y];
    }
    frames.push({ t: parseFloat(t.toFixed(3)), positions });
  }

  console.error(`[Matter] Simulation complete: ${frames.length} frames`);

  // Calculate energy (optional)
  let ke = 0, pe = 0;
  const g = scene.world?.gravity_m_s2 ?? 9.81;
  for (const [id, body] of bodyMap) {
    const v = Math.hypot(body.velocity.x, body.velocity.y);
    ke += 0.5 * body.mass * v * v;
    pe += body.mass * g * body.position.y;
  }

  return {
    frames,
    energy: { kinetic_j: ke, potential_j: pe, total_j: ke + pe },
  };
}

/**
 * Main: Read scene from stdin, simulate, output to stdout
 */
async function main() {
  let input = '';

  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    const scene = JSON.parse(input);
    const result = simulate(scene);
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(`[Matter worker error] ${err.message}`);
    process.exit(1);
  }
}

main();
