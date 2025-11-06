"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type { SimulationFrame } from '@/simulation/types';
import { parseDiagram, type DiagramParseDetection, type DiagramParseResponse } from '@/lib/api';

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
        const bodies = Object.entries(positions).map(([id, pos]) => ({ 
          id, 
          position_m: pos as [number, number], 
          velocity_m_s: [0, 0] as [number, number]
        }));
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
    
    // No backend frames - scene uploaded but simulation not run yet
    console.warn('[SimulationContext] No simulation frames from backend. Upload with simulate=true or wait for Matter.js worker.');
    return res;
  }, []);

  // Playback loop
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const stepMs = config.dt * 1000;
    const handle = (ts: number) => {
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
      if (playing) requestAnimationFrame(handle);
    };
    const id = requestAnimationFrame(handle);
    return () => cancelAnimationFrame(id);
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
    updateConfig,
    updateSceneAndResimulate,
    detections,
    imageSizePx,
    scale_m_per_px,
    scene,
    labels,
    parseAndBind,
  };
  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation() {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error('useSimulation must be used within SimulationProvider');
  return ctx;
}
