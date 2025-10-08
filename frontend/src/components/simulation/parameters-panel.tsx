import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, StepForward, RotateCcw } from 'lucide-react';

export default function ParametersPanel() {
  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle className="font-headline text-lg">Controls & Parameters</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h3 className="font-medium text-sm text-muted-foreground">Simulation Controls</h3>
          <div className="grid grid-cols-4 gap-2">
            <Button variant="outline" size="icon" aria-label="Play">
              <Play className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Pause">
              <Pause className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Step Forward">
              <StepForward className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Reset">
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-6">
          <div className="grid gap-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="gravity">Gravity</Label>
              <span className="text-sm text-muted-foreground">9.81 m/s²</span>
            </div>
            <Slider id="gravity" defaultValue={[9.81]} max={20} step={0.1} />
          </div>
          <div className="grid gap-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="friction">Friction (μ)</Label>
              <span className="text-sm text-muted-foreground">0.2</span>
            </div>
            <Slider id="friction" defaultValue={[0.2]} max={1} step={0.05} />
          </div>
           <div className="grid gap-2">
            <div className="flex justify-between items-center">
              <Label htmlFor="timestep">Time Step (dt)</Label>
              <span className="text-sm text-muted-foreground">0.016 s</span>
            </div>
            <Slider id="timestep" defaultValue={[0.016]} min={0.001} max={0.1} step={0.001} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
