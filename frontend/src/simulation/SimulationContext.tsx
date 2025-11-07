"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type { SimulationFrame } from '@/simulation/types';
import { runMatterSimulation } from '@/simulation/matterRunner';
import {
  normalizeSceneMapping,
  normalizeSceneToImageBounds,
  type SceneNormalizationReport,
  type NormalizedSceneMapping,
} from '@/simulation/coords';
import { parseDiagram, type DiagramParseDetection, type DiagramParseResponse } from '@/lib/api';

const toVec2 = (value: unknown): [number, number] | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  if (value && typeof value === 'object' && 'x' in (value as Record<string, unknown>) && 'y' in (value as Record<string, unknown>)) {
    const point = value as { x: unknown; y: unknown };
    const x = Number(point.x);
    const y = Number(point.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  return null;
};

const cloneSceneSnapshot = (source: any | null) => {
  if (!source || typeof source !== 'object') {
    return source;
  }

  const cloneBodies = Array.isArray(source.bodies)
    ? source.bodies.map((body: any) => {
        if (!body || typeof body !== 'object') {
          return body;
        }
        const clonedBody: any = { ...body };
        if (Array.isArray(body.position_m)) {
          clonedBody.position_m = [...body.position_m];
        }
        if (Array.isArray(body.velocity_m_s)) {
          clonedBody.velocity_m_s = [...body.velocity_m_s];
        }
        if (Array.isArray(body.vertices_world)) {
          clonedBody.vertices_world = body.vertices_world.map((vert: any) =>
            Array.isArray(vert) ? [...vert] : vert,
          );
        }
        if (body.collider && typeof body.collider === 'object') {
          clonedBody.collider = { ...body.collider };
          if (Array.isArray(body.collider.vertices)) {
            clonedBody.collider.vertices = body.collider.vertices.map((vert: any) =>
              Array.isArray(vert) ? [...vert] : vert,
            );
          }
          if (Array.isArray(body.collider.points_m)) {
            clonedBody.collider.points_m = body.collider.points_m.map((vert: any) =>
              Array.isArray(vert) ? [...vert] : vert,
            );
          }
          if (Array.isArray(body.collider.polygon_m)) {
            clonedBody.collider.polygon_m = body.collider.polygon_m.map((vert: any) =>
              Array.isArray(vert) ? [...vert] : vert,
            );
          }
        }
        if (body.material && typeof body.material === 'object') {
          clonedBody.material = { ...body.material };
        }
        return clonedBody;
      })
    : undefined;

  const cloneConstraints = Array.isArray(source.constraints)
    ? source.constraints.map((constraint: any) =>
        constraint && typeof constraint === 'object' ? { ...constraint } : constraint,
      )
    : undefined;

  return {
    ...source,
    world: source.world && typeof source.world === 'object' ? { ...source.world } : source.world,
    mapping:
      source.mapping && typeof source.mapping === 'object' ? { ...source.mapping } : source.mapping,
    bodies: cloneBodies,
    constraints: cloneConstraints,
  };
};

const fallbackMappingFromScale = (
  image: { width: number; height: number } | null | undefined,
  scale: number | null | undefined,
): NormalizedSceneMapping | null => {
  if (!image) return null;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  return {
    origin_px: [image.width / 2, image.height / 2],
    scale_m_per_px: scale,
  };
};

type SceneNormalizationOverrides = {
  imageSize?: { width: number; height: number } | null;
  scale?: number | null;
  mode?: 'translate-only' | 'translate-and-scale';
  targetBodies?: 'dynamic' | 'all';
};

interface SimulationRunPayload {
  frames: Array<{
    t: number;
    positions?: Record<string, [number, number]>;
    bodies?: Array<{
      id: string;
      position_m: [number, number];
      velocity_m_s?: [number, number];
    }>;
  }>;
  meta?: {
    frames_count?: number;
    simulation_time_s?: number;
    time_step_s?: number;
  };
  scene?: any | null;
  detections?: DiagramParseDetection[];
  imageSizePx?: { width: number; height: number } | null;
  scale_m_per_px?: number | null;
  labels?: { entities: Array<{ segment_id: string; label: string; props?: Record<string, unknown> }> } | null;
  renderImageDataUrl?: string | null;
}

export type SimulationMode = 'playback' | 'interactive';

export interface SimulationConfig {
  // Universal physics config (not pulley-specific)
  gravity: number;
  dt: number; // integrator dt for playback
  friction: number; // default friction coefficient
  duration: number;
  restitution: number;
}

// Editing mode for interactive object manipulation
export type EditingMode = 'disabled' | 'enabled';

// Entity update callback type (for Frontend Matter.js body updates)
export type UpdateEntityCallback = (
  entityId: string, 
  updates: {
    position?: [number, number];
    mass?: number;
    friction?: number;
    velocity?: [number, number];
    angularVelocity?: number;
  }
) => void;

interface SimulationState extends SimulationConfig {
  frames: SimulationFrame[];
  playing: boolean;
  currentIndex: number;
  simulationMode: SimulationMode;
  setSimulationMode: (mode: SimulationMode) => void;
  
  // Editing mode (for interactive object manipulation)
  editingEnabled: boolean;
  setEditingEnabled: (enabled: boolean) => void;
  
  acceleration?: number;
  tension?: number;
  staticCondition?: boolean;
  resetSimulation: () => void;
  setPlaying: (p: boolean) => void;
  setFrameIndex: (index: number) => void;
  updateConfig: (partial: Partial<SimulationConfig>) => void;
  updateSceneAndResimulate: (sceneUpdates: any | ((prev: any | null) => any | null)) => Promise<void>; // Universal scene update
  detections: DiagramParseDetection[];
  imageSizePx: { width: number; height: number } | null;
  scale_m_per_px: number | null;
  scene: any | null;
  labels: { entities: Array<{ segment_id: string; label: string; props?: Record<string, unknown> }> } | null;
  parseAndBind: (file: File) => Promise<DiagramParseResponse>;
  loadSimulationRun: (payload: SimulationRunPayload) => Promise<void>;
  renderImageDataUrl: string | null;
  
  // Entity selection (for click-to-edit)
  selectedEntityId: string | null;
  setSelectedEntityId: (id: string | null) => void;
  
  // Frontend entity update (for Interactive Mode)
  updateEntityCallback: UpdateEntityCallback | null;
  registerUpdateEntityCallback: (callback: UpdateEntityCallback) => void;
  normalizationReport: SceneNormalizationReport | null;
}

const SimulationContext = createContext<SimulationState | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SimulationConfig>({
    gravity: 10,
    dt: 0.02,
    friction: 0.5,
    duration: 2,
    restitution: 1,
  });
  const [frames, setFrames] = useState<SimulationFrame[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [simulationMode, setSimulationMode] = useState<SimulationMode>('playback');
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [acceleration, setAcceleration] = useState<number | undefined>();
  const [tension, setTension] = useState<number | undefined>();
  const [staticCondition, setStaticCondition] = useState<boolean | undefined>();
  const lastTimestamp = useRef<number | null>(null);
  const frameRequestRef = useRef<number | null>(null);
  const loadRequestRef = useRef(0);
  const playingRef = useRef(false);
  const [detections, setDetections] = useState<DiagramParseDetection[]>([]);
  const [imageSizePx, setImageSizePx] = useState<{ width: number; height: number } | null>(null);
  const [scale_m_per_px, setScale] = useState<number | null>(null);
  const [scene, setScene] = useState<any | null>(null);
  const [labels, setLabels] = useState<{ entities: Array<{ segment_id: string; label: string; props?: Record<string, unknown> }> } | null>(null);
  const [renderImageDataUrl, setRenderImageDataUrl] = useState<string | null>(null);
  
  // Entity selection state
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  
  // Frontend entity update callback (registered by SimulationLayer)
  const [updateEntityCallback, setUpdateEntityCallback] = useState<UpdateEntityCallback | null>(null);
  
  const registerUpdateEntityCallback = useCallback((callback: UpdateEntityCallback) => {
    setUpdateEntityCallback(() => callback);
  }, []);
  const [normalizationReport, setNormalizationReport] = useState<SceneNormalizationReport | null>(null);

  const normalizeSceneForState = useCallback(
    (sceneInput: any | null, overrides?: SceneNormalizationOverrides) => {
      if (!sceneInput) {
        return { scene: null as any, report: null as SceneNormalizationReport | null };
      }

      const mode = overrides?.mode ?? 'translate-and-scale';
      const image = overrides?.imageSize ?? imageSizePx;
      const scaleOverride = overrides?.scale ?? scale_m_per_px;
      const cloned = cloneSceneSnapshot(sceneInput);
      const existingMapping = normalizeSceneMapping((cloned as any)?.mapping);
      const mapping: NormalizedSceneMapping | null = existingMapping ?? fallbackMappingFromScale(image, scaleOverride);

      if (!image || !mapping) {
        const bodies = Array.isArray((cloned as any)?.bodies) ? (cloned as any).bodies : [];
        const ids = bodies
          .map((body: any): string | null => (typeof body?.id === 'string' ? body.id : null))
          .filter((candidate: string | null): candidate is string => typeof candidate === 'string' && candidate.length > 0);

        const fallbackReport: SceneNormalizationReport = {
          applied: false,
          translation_m: [0, 0],
          scale: undefined,
          adjustedBodyIds: ids,
          mode,
          warnings: ['Normalization skipped: missing mapping or image dimensions.'],
        };

        return { scene: cloned, report: fallbackReport };
      }

      if (!existingMapping) {
        (cloned as any).mapping = {
          origin_px: [...mapping.origin_px],
          scale_m_per_px: mapping.scale_m_per_px,
        };
      }

      const result = normalizeSceneToImageBounds(cloned, mapping, image, {
        margin_m: 0.02,
        mode,
        targetBodies: overrides?.targetBodies ?? 'dynamic',
      });

      return { scene: result.scene, report: result.report };
    },
    [imageSizePx, scale_m_per_px],
  );

  const resetSimulation = useCallback(() => {
    console.log('[SimulationContext] resetSimulation called');
    // Stop playback and reset to beginning
    setPlaying(false);
    setCurrentIndex(0);
    lastTimestamp.current = null;
    console.log('[SimulationContext] reset complete, playing set to false');
  }, []);

  const performResimulation = useCallback(
    (sceneToRun: any | null) => {
      if (!sceneToRun) {
        console.warn('[SimulationContext] performResimulation skipped: no scene provided');
        setFrames([]);
        setPlaying(false);
        return;
      }

      const requestId = ++loadRequestRef.current;
      setPlaying(false);

      try {
        const duration = typeof config.duration === 'number' && config.duration > 0 ? config.duration : 5;
        const { frames: matterFrames, dt: simDt } = runMatterSimulation(sceneToRun, {
          duration_s: duration,
          restitutionOverride: config.restitution,
        });

        if (requestId !== loadRequestRef.current) {
          return;
        }

        const mappedFrames: SimulationFrame[] = matterFrames.map((frame) => ({
          t: frame.t,
          bodies: frame.bodies.map((body) => ({
            id: body.id,
            position_m: body.position_m,
            velocity_m_s: body.velocity_m_s,
            angle_rad: body.angle_rad,
            angular_velocity_rad_s: body.angular_velocity_rad_s,
            vertices_world: body.vertices_world,
          })),
        }));

        setFrames(mappedFrames);
        setCurrentIndex(0);
        lastTimestamp.current = null;
        setPlaying(mappedFrames.length > 0);

        const dtFromScene =
          typeof sceneToRun?.world?.time_step_s === 'number' && sceneToRun.world.time_step_s > 0
            ? sceneToRun.world.time_step_s
            : undefined;
        const dtCandidate = dtFromScene ?? (typeof simDt === 'number' && simDt > 0 ? simDt : undefined);
        if (dtCandidate) {
          setConfig((prev) => ({ ...prev, dt: dtCandidate }));
        }
      } catch (error) {
        console.error('[SimulationContext] performResimulation failed', error);
      }
    },
  [config.duration, config.restitution],
  );

  // Update scene and immediately re-run Matter.js with the latest parameters
  const updateSceneAndResimulate = useCallback(
    async (sceneUpdates: any | ((prev: any | null) => any | null)) => {
      let normalizationResult: { scene: any | null; report: SceneNormalizationReport | null } = {
        scene: null,
        report: null,
      };

      setScene((prevScene: any | null) => {
        const base = cloneSceneSnapshot(prevScene);
        const candidate =
          typeof sceneUpdates === 'function'
            ? sceneUpdates(base)
            : sceneUpdates;

        if (candidate === undefined) {
          normalizationResult = normalizeSceneForState(base);
          return normalizationResult.scene;
        }

        if (candidate === null) {
          normalizationResult = { scene: null, report: null };
          return null;
        }

        normalizationResult = normalizeSceneForState(candidate);
        return normalizationResult.scene;
      });

      if (!normalizationResult.scene) {
        console.warn('[SimulationContext] updateSceneAndResimulate cleared the scene');
        setNormalizationReport(null);
        setFrames([]);
        setPlaying(false);
        return;
      }

      setNormalizationReport(normalizationResult.report ?? null);
      performResimulation(normalizationResult.scene);
    },
    [normalizeSceneForState, performResimulation],
  );

  const updateConfig = useCallback(
    (partial: Partial<SimulationConfig>) => {
      let shouldResimulate = false;

      setConfig((prev) => {
        const next: SimulationConfig = { ...prev, ...partial };

        if (partial.restitution !== undefined) {
          const rest = partial.restitution;
          if (typeof rest === 'number' && Number.isFinite(rest)) {
            next.restitution = Math.min(Math.max(rest, 0), 1);
          } else {
            next.restitution = prev.restitution;
          }
        }

        if (partial.friction !== undefined) {
          const fr = partial.friction;
          next.friction = typeof fr === 'number' && Number.isFinite(fr) && fr >= 0 ? fr : prev.friction;
        }

        if (partial.dt !== undefined) {
          const dtCandidate = partial.dt;
          next.dt =
            typeof dtCandidate === 'number' && Number.isFinite(dtCandidate) && dtCandidate > 0
              ? dtCandidate
              : prev.dt;
        }

        if (partial.duration !== undefined) {
          const durationCandidate = partial.duration;
          const sanitized =
            typeof durationCandidate === 'number' && Number.isFinite(durationCandidate) && durationCandidate > 0
              ? durationCandidate
              : prev.duration;
          if (sanitized !== prev.duration) {
            shouldResimulate = true;
          }
          next.duration = sanitized;
        }

        if (partial.gravity !== undefined) {
          const gravityCandidate = partial.gravity;
          next.gravity =
            typeof gravityCandidate === 'number' && Number.isFinite(gravityCandidate)
              ? gravityCandidate
              : prev.gravity;
        }

        return next;
      });

      if (shouldResimulate && scene) {
        const normalization = normalizeSceneForState(scene);
        if (normalization.scene) {
          setScene(normalization.scene);
          setNormalizationReport(normalization.report ?? null);
          performResimulation(normalization.scene);
        }
      }
    },
    [scene, normalizeSceneForState, performResimulation, setNormalizationReport, setScene],
  );

  const parseAndBind = useCallback(async (file: File): Promise<DiagramParseResponse> => {
    // Reset state before parsing
    setPlaying(false);
    setCurrentIndex(0);
    setFrames([]);
    
    const res = await parseDiagram(file, { simulate: true, debug: true });
    setDetections(res.detections);
    setImageSizePx({ width: res.image.width_px, height: res.image.height_px });
    setScale(res.mapping.scale_m_per_px);
  const normalization = normalizeSceneForState(res.scene ?? null, {
      imageSize: { width: res.image.width_px, height: res.image.height_px },
      scale: typeof res.mapping?.scale_m_per_px === 'number' ? res.mapping.scale_m_per_px : null,
    });
    setScene(normalization.scene);
    setNormalizationReport(normalization.report);
    if (res.labels && Array.isArray(res.labels.entities)) {
      setLabels(res.labels as any);
    } else {
      setLabels(null);
    }
    // Prefer backend Rapier frames if present; else fall back to analytic
    const sim = (res.meta as any)?.simulation;
    const framesFromBackend = sim?.frames as Array<any> | undefined;
    if (Array.isArray(framesFromBackend) && framesFromBackend.length > 0) {
      // Rapier returns { t, positions: { id: [x,y] } }, convert to { t, bodies: [{id, position_m, velocity_m_s}] }
      const mapped: SimulationFrame[] = framesFromBackend.map(f => {
        const positions = f.positions || {};
        const bodies = Object.entries(positions)
          .map(([id, pos]) => {
            const tuple = toVec2(pos);
            if (!tuple) return null;
            return {
              id,
              position_m: tuple,
              velocity_m_s: [0, 0] as [number, number],
            };
          })
          .filter(Boolean) as Array<{
            id: string;
            position_m: [number, number];
            velocity_m_s: [number, number];
          }>;
        console.log('[SimulationContext] frame:', { t: f.t, positions, bodiesCount: bodies.length });
        return {
          t: f.t,
          bodies,
        };
      });
      setFrames(mapped);
      // If backend scene includes time step, use it for playback cadence
      const backendDt = (res.scene as any)?.world?.time_step_s;
      setConfig(prev => ({
        ...prev,
        dt: typeof backendDt === 'number' && backendDt > 0 ? backendDt : prev.dt,
      }));
      setCurrentIndex(0);
      setPlaying(true);
      lastTimestamp.current = null;
      // eslint-disable-next-line no-console
      console.log('Rapier simulation summary', sim);
      return res;
    }
    // Bind parameters to current config
    setConfig(prev => ({
      ...prev,
      massA: res.parameters.massA_kg,
      massB: res.parameters.massB_kg,
      gravity: res.parameters.gravity_m_s2,
      friction: res.parameters.mu_k,
    }));
    // Optional: rerun analytic with new params
    // runAnalytic();
    return res;
  }, []);

  const loadSimulationRun = useCallback(async (payload: SimulationRunPayload) => {
    // eslint-disable-next-line no-console
    console.debug('[SimulationContext] loadSimulationRun payload', payload);

    const requestId = ++loadRequestRef.current;

    setPlaying(false);
    setFrames([]);
    setCurrentIndex(0);
    lastTimestamp.current = null;

    const normalization = normalizeSceneForState(payload.scene ?? null, {
      imageSize: payload.imageSizePx ?? null,
      scale: payload.scale_m_per_px ?? null,
    });
    setScene(normalization.scene);
    setNormalizationReport(normalization.report);
    setDetections(payload.detections ?? []);
    setImageSizePx(payload.imageSizePx ?? null);
    setScale(payload.scale_m_per_px ?? null);
    setLabels(payload.labels ?? null);
  setRenderImageDataUrl(payload.renderImageDataUrl ?? null);

    const applyFrames = (framesToApply: SimulationFrame[], dtCandidate?: number) => {
      if (requestId !== loadRequestRef.current) {
        return;
      }
      setFrames(framesToApply);
      setCurrentIndex(0);
      lastTimestamp.current = null;
      setPlaying(framesToApply.length > 0);

      if (typeof dtCandidate === 'number' && Number.isFinite(dtCandidate) && dtCandidate > 0) {
        setConfig(prev => ({ ...prev, dt: dtCandidate }));
      }
    };

    if (Array.isArray(payload.frames) && payload.frames.length > 0) {
      const mappedFrames: SimulationFrame[] = payload.frames.map((frame) => {
        if (Array.isArray((frame as any)?.bodies) && (frame as any).bodies.length > 0) {
          const bodies = (frame as any).bodies
            .map((b: any) => {
              const tuple = toVec2(b?.position_m);
              if (!tuple) return null;
              const velocity = toVec2(b?.velocity_m_s) ?? ([0, 0] as [number, number]);
              return {
                id: b?.id ?? 'body',
                position_m: tuple,
                velocity_m_s: velocity,
                angle_rad: typeof b?.angle_rad === 'number' ? b.angle_rad : undefined,
                angular_velocity_rad_s:
                  typeof b?.angular_velocity_rad_s === 'number' ? b.angular_velocity_rad_s : undefined,
                vertices_world: Array.isArray(b?.vertices_world) ? b.vertices_world : undefined,
              };
            })
            .filter(Boolean) as Array<{
              id: string;
              position_m: [number, number];
              velocity_m_s: [number, number];
              angle_rad?: number;
              angular_velocity_rad_s?: number;
              vertices_world?: Array<[number, number]>;
            }>;

          return {
            t: (frame as any).t ?? 0,
            bodies,
          } satisfies SimulationFrame;
        }

        const positions = (frame as any)?.positions ?? {};
        const bodies = Object.entries(positions)
          .map(([id, pos]) => {
            const tuple = toVec2(pos);
            if (!tuple) return null;
            return {
              id,
              position_m: tuple,
              velocity_m_s: [0, 0] as [number, number],
            };
          })
          .filter(Boolean) as Array<{
            id: string;
            position_m: [number, number];
            velocity_m_s: [number, number];
          }>;

        return {
          t: (frame as any).t ?? 0,
          bodies,
        } satisfies SimulationFrame;
      });

      const dtFromMeta = typeof payload.meta?.time_step_s === 'number' && payload.meta.time_step_s > 0 ? payload.meta.time_step_s : undefined;
      const dtFromFrames = mappedFrames.length >= 2 ? mappedFrames[1].t - mappedFrames[0].t : undefined;
      applyFrames(mappedFrames, dtFromMeta ?? dtFromFrames);
      return;
    }

    if (payload.scene) {
      try {
        const duration = payload.meta?.simulation_time_s ?? 5;
        const sceneForSimulation = normalization.scene ?? payload.scene;
        const localResult = runMatterSimulation(sceneForSimulation, {
          duration_s: duration,
          restitutionOverride: config.restitution,
        });
        const localFrames: SimulationFrame[] = localResult.frames.map(frame => ({
          t: frame.t,
          bodies: frame.bodies.map(body => ({
            id: body.id,
            position_m: body.position_m,
            velocity_m_s: body.velocity_m_s,
            angle_rad: body.angle_rad,
            angular_velocity_rad_s: body.angular_velocity_rad_s,
            vertices_world: body.vertices_world,
          })),
        }));
        applyFrames(localFrames, payload.meta?.time_step_s ?? localResult.dt);
        return;
      } catch (error) {
        console.error('[SimulationContext] Matter.js simulation failed', error);
      }
    }

    const mapped: SimulationFrame[] = (payload.frames ?? []).map(frame => {
      if (Array.isArray(frame.bodies) && frame.bodies.length > 0) {
        const bodies = frame.bodies
          .map(b => {
            const tuple = toVec2(b.position_m);
            if (!tuple) return null;
            const velocity = toVec2(b.velocity_m_s) ?? ([0, 0] as [number, number]);
            return {
              id: b.id,
              position_m: tuple,
              velocity_m_s: velocity,
            };
          })
          .filter(Boolean) as Array<{
            id: string;
            position_m: [number, number];
            velocity_m_s: [number, number];
          }>;

        return {
          t: frame.t,
          bodies,
        };
      }

      const positions = frame.positions ?? {};
      const bodies = Object.entries(positions)
        .map(([id, pos]) => {
          const tuple = toVec2(pos);
          if (!tuple) return null;
          return {
            id,
            position_m: tuple,
            velocity_m_s: [0, 0] as [number, number],
          };
        })
        .filter(Boolean) as Array<{
          id: string;
          position_m: [number, number];
          velocity_m_s: [number, number];
        }>;

      return {
        t: frame.t,
        bodies,
      };
    });

    const fallbackDtCandidates: Array<number | undefined> = [
      payload.meta?.time_step_s,
      payload.meta?.frames_count && payload.meta?.simulation_time_s
        ? payload.meta.simulation_time_s / payload.meta.frames_count
        : undefined,
    ];
    const fallbackDt = fallbackDtCandidates.find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    applyFrames(mapped, fallbackDt);
  }, [setConfig]);

  const setFrameIndex = useCallback((index: number) => {
    setCurrentIndex(() => {
      if (frames.length === 0) {
        return 0;
      }
      const clamped = Math.max(0, Math.min(index, frames.length - 1));
      return clamped;
    });
    lastTimestamp.current = null;
  }, [frames.length]);

  useEffect(() => {
    playingRef.current = playing;
    if (!playing && frameRequestRef.current !== null) {
      cancelAnimationFrame(frameRequestRef.current);
      frameRequestRef.current = null;
    }
  }, [playing]);

  // Playback loop
  useEffect(() => {
    if (!playing || frames.length === 0) {
      return;
    }

    const stepMs = config.dt * 1000;

    const tick = (ts: number) => {
      if (!playingRef.current) {
        return;
      }

      if (lastTimestamp.current === null) {
        lastTimestamp.current = ts;
      }

      const elapsed = ts - lastTimestamp.current;
      if (elapsed >= stepMs) {
        lastTimestamp.current = ts;
        setCurrentIndex(i => {
          if (i + 1 < frames.length) return i + 1;
          return i; // freeze on last frame
        });
      }

      if (playingRef.current) {
        frameRequestRef.current = requestAnimationFrame(tick);
      }
    };

    frameRequestRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRequestRef.current !== null) {
        cancelAnimationFrame(frameRequestRef.current);
        frameRequestRef.current = null;
      }
    };
  }, [playing, frames, config.dt]);

  const value: SimulationState = {
    ...config,
    frames,
    playing,
    currentIndex,
    simulationMode,
    setSimulationMode,
    editingEnabled,
    setEditingEnabled,
    acceleration,
    tension,
    staticCondition,
    resetSimulation,
    setPlaying,
    setFrameIndex,
    updateConfig,
    updateSceneAndResimulate,
    detections,
    imageSizePx,
    scale_m_per_px,
    scene,
    labels,
    parseAndBind,
    loadSimulationRun,
    renderImageDataUrl,
    
    // Entity selection
    selectedEntityId,
    setSelectedEntityId,
    
    // Frontend entity update
    updateEntityCallback,
    registerUpdateEntityCallback,
    normalizationReport,
  };
  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation() {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error('useSimulation must be used within SimulationProvider');
  return ctx;
}
