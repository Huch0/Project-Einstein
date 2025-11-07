import { describe, expect, it } from 'vitest';
import { normalizeSceneToImageBounds } from '../coords';

interface SimpleAabb {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const computeHalfExtents = (body: any): { halfX: number; halfY: number } => {
  const collider = body?.collider;
  if (!collider || typeof collider !== 'object') {
    return { halfX: 0.05, halfY: 0.05 };
  }

  if (collider.type === 'rectangle') {
    const width = Number(collider.width_m) || 0;
    const height = Number(collider.height_m) || 0;
    return { halfX: Math.abs(width) / 2, halfY: Math.abs(height) / 2 };
  }

  if (collider.type === 'circle') {
    const radius = Number(collider.radius_m) || 0;
    return { halfX: Math.abs(radius), halfY: Math.abs(radius) };
  }

  return { halfX: 0.05, halfY: 0.05 };
};

const computeAabb = (body: any): SimpleAabb => {
  const position = Array.isArray(body?.position_m) ? body.position_m : [0, 0];
  const half = computeHalfExtents(body);

  return {
    minX: position[0] - half.halfX,
    maxX: position[0] + half.halfX,
    minY: position[1] - half.halfY,
    maxY: position[1] + half.halfY,
  };
};

describe('normalizeSceneToImageBounds contact separation', () => {
  it('lifts dynamic bodies so they no longer overlap static supports', () => {
    const mapping = {
      origin_px: [512, 384] as [number, number],
      scale_m_per_px: 0.01,
    };
    const image = { width: 1024, height: 768 };

    const scene = {
      world: { gravity_m_s2: 9.81, time_step_s: 0.016 },
      bodies: [
        {
          id: 'ground_1',
          type: 'static',
          position_m: [0, -0.1],
          collider: { type: 'rectangle', width_m: 8, height_m: 0.2 },
        },
        {
          id: 'block_1',
          type: 'dynamic',
          mass_kg: 2,
          position_m: [0, -0.02],
          velocity_m_s: [0, 0],
          collider: { type: 'rectangle', width_m: 0.4, height_m: 0.4 },
        },
      ],
      constraints: [],
    };

    const { scene: normalizedScene, report } = normalizeSceneToImageBounds(scene, mapping, image, {
      margin_m: 0.02,
      mode: 'translate-only',
    });

    const ground = normalizedScene.bodies.find((body: any) => body.id === 'ground_1');
    const block = normalizedScene.bodies.find((body: any) => body.id === 'block_1');

    expect(ground).toBeDefined();
    expect(block).toBeDefined();

    if (!ground || !block) {
      throw new Error('Expected normalized scene to contain ground and block bodies');
    }

    const groundAabb = computeAabb(ground);
    const blockAabb = computeAabb(block);

    expect(blockAabb.minY).toBeGreaterThan(groundAabb.maxY);
    expect(report.adjustedBodyIds).toContain('block_1');
    expect(report.warnings.some((warning) => warning.toLowerCase().includes('contact separation'))).toBe(true);

    const normalizationMeta = ((normalizedScene as any).meta?.normalization ?? {}) as Record<string, any>;
    const contactEntries: Array<{ id: string; delta_m: [number, number] }> = normalizationMeta.contact_separation ?? [];
    const blockContact = contactEntries.find((entry) => entry.id === 'block_1');
    expect(blockContact).toBeDefined();
    expect(blockContact?.delta_m[1]).toBeGreaterThan(0);
  });
});
