'use client';

import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSimulation } from '@/simulation/SimulationContext';
import { formatNumber } from '@/lib/utils';

export default function AnalysisPanel() { // kept filename; acts as "Analysis" panel now
  const { acceleration, tension, staticCondition, frames, massA, massB, gravity, friction, dt, runAnalytic, playing } = useSimulation();

  // Derive basic kinematics & energies from last frame
  const analysis = useMemo(() => {
    if (!frames.length) return null;
    const last = frames[frames.length - 1];
    const m1 = massA;
    const m2 = massB;
    // Pick rope speed magnitude from m1 velocity
    const vx = last.bodies.find(b => b.id === 'm1')?.velocity_m_s[0] ?? 0;
    const speed = Math.abs(vx);
    // Position (displacement) from m1 x or -m2 y
    const disp = last.bodies.find(b => b.id === 'm1')?.position_m[0] ?? 0;
    // Energies (relative) – treat gravitational potential loss of m2 as positive 'released energy'
    const releasedPotential = m2 * gravity * disp; // since m2 descended disp
    const kinetic = 0.5 * (m1 + m2) * speed * speed;
    const mech = kinetic + releasedPotential; // not strictly physical sum; placeholder for future separation
    // Simple arrays for sparkline (kinetic) – sample up to 40 points
    const sampleEvery = Math.ceil(frames.length / 40);
    const kineticSeries = frames.filter((_, i) => i % sampleEvery === 0).map(f => {
      const v = Math.abs(f.bodies.find(b => b.id === 'm1')?.velocity_m_s[0] ?? 0);
      return 0.5 * (m1 + m2) * v * v;
    });
    return { speed, disp, releasedPotential, kinetic, mech, kineticSeries };
  }, [frames, massA, massB, gravity]);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="font-headline text-lg">Analysis</CardTitle>
                <CardDescription className="mt-1">
                Real‑time analytic evaluation (ideal rope, single pulley). Use Parameters panel to modify masses, friction, gravity.
                </CardDescription>
            </div>
            <Button variant="outline" onClick={() => runAnalytic()}>Run Simulation</Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        <div className="relative h-full rounded-md border bg-muted/50">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4 text-sm">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <Info label="m1 (kg)" value={massA} />
                <Info label="m2 (kg)" value={massB} />
                <Info label="μk" value={friction} />
                <Info label="g (m/s²)" value={gravity} />
                <Info label="dt (s)" value={dt} />
                <Info label="frames" value={frames.length} />
              </div>
              <div className="text-xs space-y-1">
                <div>Acceleration: {acceleration !== undefined ? `${formatNumber(acceleration,3)} m/s²` : '—'} {staticCondition && '(static)'} </div>
                <div>Tension: {tension !== undefined ? `${formatNumber(tension,2)} N` : '—'}</div>
                <div>Status: {playing ? 'playing' : 'idle'} <Button size="sm" variant="outline" className="ml-2 h-5 px-2" onClick={() => runAnalytic()}>Re-run</Button></div>
                {analysis && (
                  <>
                    <div>Displacement (m2 down): {formatNumber(analysis.disp,3)} m</div>
                    <div>Speed: {formatNumber(analysis.speed,3)} m/s</div>
                    <div>Kinetic Energy: {formatNumber(analysis.kinetic,3)} J</div>
                    <div>Released Potential: {formatNumber(analysis.releasedPotential,3)} J</div>
                    <div>Total (proto) Energy: {formatNumber(analysis.mech,3)} J</div>
                  </>
                )}
              </div>
              {analysis && analysis.kineticSeries.length > 1 && (
                <div className="mt-2 font-mono text-[10px] leading-tight">
                  <div className="mb-1 text-muted-foreground">Kinetic Energy Sparkline</div>
                  <Sparkline values={analysis.kineticSeries} />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between rounded border bg-background/40 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{typeof value === 'number' ? value.toFixed(3) : value}</span>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  // Map to blocks (eight levels)
  const blocks = ['▁','▂','▃','▄','▅','▆','▇','█'];
  const chars = values.map(v => {
    const idx = Math.round(((v - min) / range) * (blocks.length - 1));
    return blocks[idx];
  }).join('');
  return <div>{chars}</div>;
}
