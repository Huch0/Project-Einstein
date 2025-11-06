"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type { SimulationFrame } from '@/simulation/types';
import { runMatterSimulation } from '@/simulation/matterRunner';
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
}

export interface SimulationConfig {
  // Universal physics config (not pulley-specific)
  gravity: number;
  dt: number; // integrator dt for playback
  friction: number; // default friction coefficient
  duration: number;
}

interface SimulationState extends SimulationConfig {
  frames: SimulationFrame[];
  playing: boolean;
  currentIndex: number;
  acceleration?: number;
  tension?: number;
  staticCondition?: boolean;
  resetSimulation: () => void;
  setPlaying: (p: boolean) => void;
  setFrameIndex: (index: number) => void;
  updateConfig: (partial: Partial<SimulationConfig>) => void;
  updateSceneAndResimulate: (sceneUpdates: any) => Promise<void>; // Universal scene update
  detections: DiagramParseDetection[];
  imageSizePx: { width: number; height: number } | null;
  scale_m_per_px: number | null;
  scene: any | null;
  labels: { entities: Array<{ segment_id: string; label: string; props?: Record<string, unknown> }> } | null;
  parseAndBind: (file: File) => Promise<DiagramParseResponse>;
}

const SimulationContext = createContext<SimulationState | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SimulationConfig>({
    gravity: 10,
    dt: 0.02,
    friction: 0.5,
    duration: 2,
  });
  const [frames, setFrames] = useState<SimulationFrame[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
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

  const resetSimulation = useCallback(() => {
    console.log('[SimulationContext] resetSimulation called');
    // Stop playback and reset to beginning
    setPlaying(false);
    setCurrentIndex(0);
    lastTimestamp.current = null;
    console.log('[SimulationContext] reset complete, playing set to false');
  }, []);

  const updateConfig = useCallback((partial: Partial<SimulationConfig>) => {
    setConfig(prev => ({ ...prev, ...partial }));
  }, []);

  // NEW: Update scene and re-run Matter.js simulation
  const updateSceneAndResimulate = useCallback(async (sceneUpdates: any) => {
    if (!scene) {
      console.warn('[SimulationContext] No scene to update');
      return;
    }

    // TODO: Call backend API when available
    // For now, just update local scene state
    const updatedScene = { ...scene, ...sceneUpdates };
    setScene(updatedScene);
    
    console.log('[SimulationContext] Scene updated, waiting for backend API to resimulate', updatedScene);
    // Backend API call will go here:
    // const response = await fetch('/api/simulation/update', {
    //   method: 'POST',
    //   body: JSON.stringify({ scene: updatedScene })
    // });
    // const { frames } = await response.json();
    // setFrames(frames);
  }, [scene]);

  const parseAndBind = useCallback(async (file: File): Promise<DiagramParseResponse> => {
    // Reset state before parsing
    setPlaying(false);
    setCurrentIndex(0);
    setFrames([]);
    
    const res = await parseDiagram(file, { simulate: true, debug: true });
    setDetections(res.detections);
    setImageSizePx({ width: res.image.width_px, height: res.image.height_px });
    setScale(res.mapping.scale_m_per_px);
    setScene(res.scene as any);
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
    runAnalytic();
    return res;
  }, [runAnalytic]);

  const loadSimulationRun = useCallback(async (payload: SimulationRunPayload) => {
    // eslint-disable-next-line no-console
    console.debug('[SimulationContext] loadSimulationRun payload', payload);

    const requestId = ++loadRequestRef.current;

    setPlaying(false);
    setFrames([]);
    setCurrentIndex(0);
    lastTimestamp.current = null;

    setScene(payload.scene ?? null);
    setDetections(payload.detections ?? []);
    setImageSizePx(payload.imageSizePx ?? null);
    setScale(payload.scale_m_per_px ?? null);
    setLabels(payload.labels ?? null);

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
        const localResult = runMatterSimulation(payload.scene, { duration_s: duration });
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
  };
  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation() {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error('useSimulation must be used within SimulationProvider');
  return ctx;
}
