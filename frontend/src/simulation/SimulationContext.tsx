"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { simulatePulleyAnalytic } from '@/simulation/pulleyAnalytic';
import type { SimulationFrame } from '@/simulation/types';
import { parseDiagram, type DiagramParseDetection } from '@/lib/api';

export interface SimulationConfig {
  massA: number;
  massB: number;
  gravity: number;
  wheelRadius: number;
  dt: number; // integrator dt for analytic playback
  friction: number; // kinetic friction (not exposed in current UI; default 0.5 for test1.jpg)
  duration: number;
}

interface SimulationState extends SimulationConfig {
  frames: SimulationFrame[];
  playing: boolean;
  currentIndex: number;
  acceleration?: number;
  tension?: number;
  staticCondition?: boolean;
  runAnalytic: () => void;
  setPlaying: (p: boolean) => void;
  updateConfig: (partial: Partial<SimulationConfig>) => void;
  backgroundImage: string | null;
  setBackgroundImage: (dataUrl: string | null) => void;
  detections: DiagramParseDetection[];
  imageSizePx: { width: number; height: number } | null;
  scale_m_per_px: number | null;
  parseAndBind: (file: File) => Promise<void>;
}

const SimulationContext = createContext<SimulationState | null>(null);

export function SimulationProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SimulationConfig>({
    massA: 3,
    massB: 6,
    gravity: 10,
    wheelRadius: 0.1,
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
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [detections, setDetections] = useState<DiagramParseDetection[]>([]);
  const [imageSizePx, setImageSizePx] = useState<{ width: number; height: number } | null>(null);
  const [scale_m_per_px, setScale] = useState<number | null>(null);

  const runAnalytic = useCallback(() => {
    const result = simulatePulleyAnalytic({
      m1_kg: config.massA,
      m2_kg: config.massB,
      mu_k: config.friction,
      g: config.gravity,
      timeStep_s: config.dt,
      totalTime_s: config.duration,
    });
    setFrames(result.frames);
    setAcceleration(result.acceleration_m_s2);
    setTension(result.tension_N);
    setStaticCondition(result.staticCondition);
    setCurrentIndex(0);
    setPlaying(true);
    lastTimestamp.current = null;
  }, [config]);

  const updateConfig = useCallback((partial: Partial<SimulationConfig>) => {
    setConfig(prev => ({ ...prev, ...partial }));
  }, []);

  const parseAndBind = useCallback(async (file: File) => {
    const res = await parseDiagram(file);
    setDetections(res.detections);
    setImageSizePx({ width: res.image.width_px, height: res.image.height_px });
    setScale(res.mapping.scale_m_per_px);
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
  }, [runAnalytic]);

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
    runAnalytic,
    setPlaying,
    updateConfig,
    backgroundImage,
    setBackgroundImage,
    detections,
    imageSizePx,
    scale_m_per_px,
    parseAndBind,
  };
  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation() {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error('useSimulation must be used within SimulationProvider');
  return ctx;
}
