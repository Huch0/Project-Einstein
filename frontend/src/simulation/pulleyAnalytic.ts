// Analytic solver for a single fixed pulley: one mass on horizontal surface with kinetic friction μk, one hanging mass.
// Diagram reference placeholder: test1.jpg
// Equations:
//  m1: T - μk m1 g = m1 a
//  m2: m2 g - T = m2 a  (downward positive for m2)
// => a = (m2 g - μk m1 g) / (m1 + m2)
// T = m1 a + μk m1 g
// Assumes a > 0 (system moves with m2 descending). If a <= 0, system static (not handled fully here).

import type { SimulationFrame } from '@/simulation/types';

export interface PulleyAnalyticParams {
  m1_kg: number;          // horizontal mass
  m2_kg: number;          // hanging mass
  mu_k: number;           // kinetic friction coefficient
  g: number;              // gravity magnitude
  timeStep_s: number;     // simulation dt
  totalTime_s: number;    // total simulated time
}

export interface PulleyAnalyticResult {
  frames: SimulationFrame[];
  acceleration_m_s2: number;
  tension_N: number;
  staticCondition: boolean; // true if system should not move (|driving| <= |friction|)
}

export function simulatePulleyAnalytic(params: PulleyAnalyticParams): PulleyAnalyticResult {
  const { m1_kg, m2_kg, mu_k, g, timeStep_s, totalTime_s } = params;
  const driving = m2_kg * g;
  const resist = mu_k * m1_kg * g;
  let a = (driving - resist) / (m1_kg + m2_kg);
  let staticCondition = false;
  if (a <= 0) {
    // System doesn't move (hanging weight insufficient to overcome friction)
    a = 0;
    staticCondition = true;
  }
  const tension = m1_kg * a + mu_k * m1_kg * g; // from m1 equation
  const frames: SimulationFrame[] = [];
  let t = 0;
  let v = 0; // speed of rope (m2 downward positive)
  let s = 0; // displacement of m2 downward
  while (t <= totalTime_s + 1e-9) {
    frames.push({
      t,
      bodies: [
        { id: 'm1', position_m: [s, 0], velocity_m_s: [v, 0] }, // horizontal displacement s to the right
        { id: 'm2', position_m: [0, -s], velocity_m_s: [0, -v] }, // downward displacement s
      ],
      meta: { energy_total_j: 0 },
    });
    if (!staticCondition) {
      v += a * timeStep_s;
      s += v * timeStep_s;
    }
    t += timeStep_s;
  }
  return { frames, acceleration_m_s2: a, tension_N: tension, staticCondition };
}
