// Shared simulation scene types & zod schema (v0.1.0) for pulley prototype.
import { z } from 'zod';

export const worldSettingsSchema = z.object({
  gravity_m_s2: z.number().positive().default(9.81),
  air_resistance_coeff: z.number().min(0).default(0),
  time_step_s: z.number().positive().max(0.1).default(0.016),
  seed: z.number().int().optional().nullable(),
});

export const materialSchema = z.object({
  name: z.string().default('default'),
  friction: z.number().min(0).default(0),
  restitution: z.number().min(0).max(1).default(0),
});

export const bodySchema = z.object({
  id: z.string(),
  type: z.literal('dynamic').default('dynamic'),
  mass_kg: z.number().positive(),
  position_m: z.tuple([z.number(), z.number()]),
  velocity_m_s: z.tuple([z.number(), z.number()]).default([0, 0]),
  material: materialSchema.default({ name: 'default', friction: 0, restitution: 0 }),
});

export const pulleyConstraintSchema = z.object({
  id: z.string().default('pulley_1'),
  type: z.literal('ideal_fixed_pulley').default('ideal_fixed_pulley'),
  body_a: z.string(),
  body_b: z.string(),
  pulley_anchor_m: z.tuple([z.number(), z.number()]).default([0, 2]),
  rope_length_m: z.number().positive().optional(),
  rope_mass_kg: z.number().min(0).default(0),
  wheel_radius_m: z.number().positive().default(0.1),
});

export const sceneSchema = z.object({
  version: z.literal('0.1.0').default('0.1.0'),
  kind: z.literal('pulley.single_fixed_v0'),
  world: worldSettingsSchema,
  bodies: z.array(bodySchema).length(2),
  constraints: z.array(pulleyConstraintSchema).length(1),
  notes: z.string().optional(),
});

export type WorldSettings = z.infer<typeof worldSettingsSchema>;
export type Material = z.infer<typeof materialSchema>;
export type Body = z.infer<typeof bodySchema>;
export type PulleyConstraint = z.infer<typeof pulleyConstraintSchema>;
export type Scene = z.infer<typeof sceneSchema>;

export function examplePulleyScene(params?: Partial<{
  mass_a_kg: number;
  mass_b_kg: number;
  gravity: number;
  wheel_radius_m: number;
  vertical_offset_m: number;
}>): Scene {
  const {
    mass_a_kg = 2,
    mass_b_kg = 5,
    gravity = 9.81,
    wheel_radius_m = 0.1,
    vertical_offset_m = 0.5,
  } = params || {};

  const bodies: Body[] = [
    { id: 'm1', type: 'dynamic', mass_kg: mass_a_kg, position_m: [-0.5, 0.5 + vertical_offset_m], velocity_m_s: [0, 0], material: { name: 'default', friction: 0, restitution: 0 } },
    { id: 'm2', type: 'dynamic', mass_kg: mass_b_kg, position_m: [0.5, 1.5 + vertical_offset_m], velocity_m_s: [0, 0], material: { name: 'default', friction: 0, restitution: 0 } },
  ];
  const pulley = {
    id: 'pulley_1',
    type: 'ideal_fixed_pulley' as const,
    body_a: 'm1',
    body_b: 'm2',
    pulley_anchor_m: [0, 2 + vertical_offset_m] as [number, number],
    rope_mass_kg: 0,
    wheel_radius_m,
  };
  // Compute rope length (piecewise segments ignoring wrap)
  const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const rope_length_m = dist(bodies[0].position_m, pulley.pulley_anchor_m) + dist(bodies[1].position_m, pulley.pulley_anchor_m);
  const scene: Scene = {
    version: '0.1.0',
    kind: 'pulley.single_fixed_v0',
    world: { gravity_m_s2: gravity, air_resistance_coeff: 0, time_step_s: 0.016, seed: undefined },
    bodies,
    constraints: [{ ...pulley, rope_length_m }],
    notes: 'Example single fixed ideal pulley problem (two masses).',
  };
  return sceneSchema.parse(scene);
}

export interface FrameBodyState {
  id: string;
  position_m: [number, number];
  velocity_m_s: [number, number];
}

export interface SimulationFrame {
  t: number; // seconds
  bodies: FrameBodyState[];
  meta?: { energy_total_j?: number; warnings?: string[] };
}

export interface SimulationRunResult {
  frames: SimulationFrame[];
  scene: Scene;
}
