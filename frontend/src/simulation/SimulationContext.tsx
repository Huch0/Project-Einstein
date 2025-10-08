"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { simulatePulleyAnalytic } from '@/simulation/pulleyAnalytic';
import type { SimulationFrame } from '@/simulation/types';

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
  };
  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation() {
  const ctx = useContext(SimulationContext);
  if (!ctx) throw new Error('useSimulation must be used within SimulationProvider');
  return ctx;
}
