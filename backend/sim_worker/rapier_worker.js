// Minimal Rapier 2D worker that reads Scene JSON from stdin and writes results to stdout.
// Contract:
//  - Input: single JSON object matching backend/app/sim/schema.py Scene
//  - Output: { frames: [...], energy: { kinetic, potential } }
import fs from 'fs';
import process from 'process';
import RAPIER from '@dimforge/rapier2d/rapier.js';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function toRapier(scene) {
  const world = new RAPIER.World(new RAPIER.Vector2(0, -scene.world.gravity_m_s2)); // y-up in Rapier; our world y-down positive -> invert
  const bodyMap = new Map();
  const colliderMap = new Map();

  for (const b of scene.bodies) {
    const rbDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(b.position_m[0], -b.position_m[1]);
    const rb = world.createRigidBody(rbDesc);
    rb.setLinvel(b.velocity_m_s[0], -b.velocity_m_s[1], true);
    // Approximate as box from mass (arbitrary density assumption) or use unit box
    const half = 0.25; // meters
    const colDesc = RAPIER.ColliderDesc.cuboid(half, half);
    const col = world.createCollider(colDesc, rb);
    col.setFriction(b.material?.friction ?? 0);
    bodyMap.set(b.id, rb);
    colliderMap.set(b.id, col);
  }
  return { world, bodyMap, colliderMap };
}

function simulate(scene) {
  const { world, bodyMap } = toRapier(scene);
  const dt = scene.world.time_step_s ?? 0.016;
  const steps = Math.min(300, Math.ceil(2.0 / dt)); // cap at ~2s
  const frames = [];

  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const positions = {};
    for (const [id, rb] of bodyMap) {
      const tr = rb.translation();
      positions[id] = [tr.x, -tr.y]; // back to y-down
    }
    frames.push({ t: Number(t.toFixed(5)), positions });
    world.step();
  }

  // Simple energies
  let kinetic = 0, potential = 0;
  for (const [id, rb] of bodyMap) {
    const v = rb.linvel();
    const m = 1.0; // Rapier mass defaults; not matching our schema mass exactly
    kinetic += 0.5 * m * (v.x * v.x + v.y * v.y);
    const yDown = -rb.translation().y;
    potential += (scene.world.gravity_m_s2 ?? 9.81) * m * yDown;
  }
  return { frames, energy: { kinetic, potential } };
}

async function main() {
  try {
    const raw = await readStdin();
    const scene = JSON.parse(raw);
    await RAPIER.init();
    const result = simulate(scene);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    const msg = { error: String(err && err.stack || err) };
    process.stdout.write(JSON.stringify(msg));
    process.exitCode = 1;
  }
}

// Run main (Rapier initializes inside)
main().catch(err => {
  const msg = { error: String(err && err.stack || err) };
  process.stdout.write(JSON.stringify(msg));
  process.exitCode = 1;
});
