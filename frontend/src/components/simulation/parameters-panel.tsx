"use client";

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, StepForward, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { examplePulleyScene, Scene } from '@/simulation/types';
import { useSimulation } from '@/simulation/SimulationContext';

type Scope = 'global' | 'A' | 'B';

export default function ParametersPanel() {
  const { massA, massB, gravity, wheelRadius, dt, updateConfig, runAnalytic, playing, setPlaying, scene, labels } = useSimulation();
  const [localScene, setLocalScene] = useState<Scene | null>(null);
  const [scope, setScope] = useState<Scope>('global');

  const rebuildScene = (overrides: Partial<{ mass_a_kg: number; mass_b_kg: number; gravity: number; wheel_radius_m: number }>) => {
    // If backend scene exists, we can just adjust local preview; analytic run remains available
    const base = localScene ?? (scene as Scene | null);
    const next = base ?? examplePulleyScene({
      mass_a_kg: overrides.mass_a_kg ?? massA,
      mass_b_kg: overrides.mass_b_kg ?? massB,
      gravity: overrides.gravity ?? gravity,
      wheel_radius_m: overrides.wheel_radius_m ?? wheelRadius,
    });
    setLocalScene(next);
    runAnalytic();
  };

  // Derive simple entity mapping for display (A/B masses, pulley)
  const entityMap = useMemo(() => {
    const entities = labels?.entities ?? [];
    const masses = entities.filter(e => (e.label || '').toLowerCase() === 'mass');
    const pulley = entities.find(e => (e.label || '').toLowerCase() === 'pulley');
    // Left/right by segment center x if segments present
    return { masses, pulley };
  }, [labels]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="font-headline text-lg">Controls & Parameters</CardTitle>
          {labels && labels.entities?.length ? (
            <div className="flex gap-1 rounded-md border bg-background p-1">
              <Button type="button" variant={scope === 'global' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('global')} aria-pressed={scope==='global'}>Global</Button>
              <Button type="button" variant={scope === 'A' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('A')} aria-pressed={scope==='A'}>A</Button>
              <Button type="button" variant={scope === 'B' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('B')} aria-pressed={scope==='B'}>B</Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
        {!scene ? (
          <div className="col-span-1 md:col-span-2 flex items-center justify-center text-sm text-muted-foreground">
            Upload an image to enable Controls & Parameters.
          </div>
        ) : !labels || !labels.entities?.length ? (
          <div className="col-span-1 md:col-span-2 flex items-center justify-center text-sm text-muted-foreground">
            Analyzing diagram… parameters will appear after labeling.
          </div>
        ) : (
        <>
        <div className="space-y-4">
          <h3 className="font-medium text-sm text-muted-foreground">Simulation Controls</h3>
          <div className="grid grid-cols-4 gap-2">
            <Button variant="outline" size="icon" aria-label="Play" onClick={() => { setPlaying(true); runAnalytic(); }} disabled={playing}>
              <Play className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Pause" onClick={() => setPlaying(false)} disabled={!playing}>
              <Pause className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Step Forward">
              <StepForward className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Reset">
              <RotateCcw className="h-4 w-4" onClick={() => { runAnalytic(); setPlaying(false); }} />
            </Button>
          </div>
        </div>
        <div className="space-y-6">
          {scope === 'global' && (
            <>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="gravity">Gravity</Label>
                  <span className="text-sm text-muted-foreground">{gravity.toFixed(2)} m/s²</span>
                </div>
                <Slider id="gravity" value={[gravity]} max={20} step={0.1} onValueChange={(v) => { const g = v[0]; updateConfig({ gravity: g }); rebuildScene({ gravity: g }); }} />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="wheelRadius">Wheel Radius (m)</Label>
                  <span className="text-sm text-muted-foreground">{wheelRadius.toFixed(3)}</span>
                </div>
                <Slider id="wheelRadius" value={[wheelRadius]} min={0.05} max={0.5} step={0.01} onValueChange={(v) => { const r = v[0]; updateConfig({ wheelRadius: r }); rebuildScene({ wheel_radius_m: r }); }} />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="timestep">Time Step (dt)</Label>
                  <span className="text-sm text-muted-foreground">{dt.toFixed(3)} s</span>
                </div>
                <Slider id="timestep" value={[dt]} min={0.001} max={0.1} step={0.001} onValueChange={(v) => { updateConfig({ dt: v[0] }); }} />
              </div>
            </>
          )}
          {scope === 'A' && (
            <div className="grid gap-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="massA">Mass A (kg)</Label>
                <span className="text-sm text-muted-foreground">{massA.toFixed(2)}</span>
              </div>
              <Slider id="massA" value={[massA]} min={0.1} max={20} step={0.1} onValueChange={(v) => { const m = v[0]; updateConfig({ massA: m }); rebuildScene({ mass_a_kg: m }); }} />
            </div>
          )}
          {scope === 'B' && (
            <div className="grid gap-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="massB">Mass B (kg)</Label>
                <span className="text-sm text-muted-foreground">{massB.toFixed(2)}</span>
              </div>
              <Slider id="massB" value={[massB]} min={0.1} max={20} step={0.1} onValueChange={(v) => { const m = v[0]; updateConfig({ massB: m }); rebuildScene({ mass_b_kg: m }); }} />
            </div>
          )}
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Scope: <code>{scope}</code></div>
            <div>Scene kind: <code>{(scene as any)?.kind ?? (localScene?.kind ?? 'unknown')}</code></div>
            <div>Rope length: {(localScene ?? (scene as any))?.constraints?.[0]?.rope_length_m?.toFixed?.(3) ?? '—'} m</div>
          </div>
        </div>
        </>
        )}
      </CardContent>
    </Card>
  );
}
