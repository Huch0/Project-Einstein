"use client";

import { useState } from 'react';
import { simulatePulleyAnalytic } from '@/simulation/pulleyAnalytic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { formatNumber } from '@/lib/utils';

export function PulleySimRunner() {
  // Parameters based on test1.jpg: m1=3kg on table μk=0.5, m2=6kg hanging, g ~10 m/s²
  const [m1, setM1] = useState(3);
  const [m2, setM2] = useState(6);
  const [mu, setMu] = useState(0.5);
  const [g, setG] = useState(10);
  const [dt, setDt] = useState(0.02);
  const [duration, setDuration] = useState(2.0);
  const [result, setResult] = useState<ReturnType<typeof simulatePulleyAnalytic> | null>(null);

  const run = () => {
    const r = simulatePulleyAnalytic({
      m1_kg: m1,
      m2_kg: m2,
      mu_k: mu,
      g,
      timeStep_s: dt,
      totalTime_s: duration,
    });
    setResult(r);
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="font-headline text-lg">Pulley Analytic (test1.jpg)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 overflow-y-auto">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <Param label="m1 (kg)" value={m1} onChange={setM1} min={0.5} max={20} step={0.1} />
            <Param label="m2 (kg)" value={m2} onChange={setM2} min={0.5} max={20} step={0.1} />
            <Param label="μk" value={mu} onChange={setMu} min={0} max={1} step={0.01} />
            <Param label="g (m/s²)" value={g} onChange={setG} min={1} max={20} step={0.1} />
            <Param label="dt (s)" value={dt} onChange={setDt} min={0.005} max={0.1} step={0.005} />
            <Param label="Duration (s)" value={duration} onChange={setDuration} min={0.2} max={10} step={0.1} />
            <Button onClick={run}>Run Simulation</Button>
          </div>
          <div className="space-y-3 text-sm">
            {result ? (
              <div className="space-y-2">
                <div>Acceleration: {formatNumber(result.acceleration_m_s2, 3)} m/s² {result.staticCondition && '(static)'} </div>
                <div>Tension: {formatNumber(result.tension_N, 2)} N</div>
                <div>Frames: {result.frames.length}</div>
                <div>
                  Final displacement (m2 down): {formatNumber(result.frames[result.frames.length - 1].bodies[1].position_m[1] * -1, 3)} m
                </div>
                <div className="max-h-40 overflow-y-auto border rounded p-2 font-mono text-xs bg-muted">
                  {result.frames.slice(0, 10).map(f => (
                    <div key={f.t}>
                      t={formatNumber(f.t,3)}s s={formatNumber(-f.bodies[1].position_m[1],3)} v={formatNumber(-f.bodies[1].velocity_m_s[1],3)}
                    </div>
                  ))}
                  {result.frames.length > 10 && <div>... (+{result.frames.length - 10} frames)</div>}
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">Set parameters and click run to compute analytic motion.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Param({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step: number }) {
  return (
    <div className="grid gap-1">
      <div className="flex justify-between items-center">
        <Label>{label}</Label>
        <span className="text-xs text-muted-foreground">{value.toFixed(3)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} />
    </div>
  );
}
