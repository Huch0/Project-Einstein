/**
 * Simulation Controls Component
 * 
 * Playback controls for physics simulation (play/pause/reset/step).
 */

import { Play, Pause, RotateCcw, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useRef } from 'react';

export interface SimulationControlsProps {
  isPlaying: boolean;
  currentFrame: number;
  totalFrames: number;
  playbackSpeed: number;
  onPlayPause: () => void;
  onReset: () => void;
  onStep: () => void;
  onFrameChange: (frame: number) => void;
  onSpeedChange: (speed: number) => void;
  disabled?: boolean;
}

export function SimulationControls({
  isPlaying,
  currentFrame,
  totalFrames,
  playbackSpeed,
  onPlayPause,
  onReset,
  onStep,
  onFrameChange,
  onSpeedChange,
  disabled = false,
}: SimulationControlsProps) {
  const lastLoggedFrame = useRef(-1);
  
  // Only log on significant changes (not every frame)
  if (Math.abs(currentFrame - lastLoggedFrame.current) >= 10 || currentFrame === 0) {
    console.log('[SimulationControls] Rendered:', {
      isPlaying,
      currentFrame,
      totalFrames,
      playbackSpeed,
      disabled,
    });
    lastLoggedFrame.current = currentFrame;
  }
  
  return (
    <div className="flex flex-col gap-2 p-2 bg-background/95 border-t">
      {/* Playback Buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            console.log('[SimulationControls] ▶️/⏸️ Play/Pause clicked');
            onPlayPause();
          }}
          disabled={disabled || totalFrames === 0}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            console.log('[SimulationControls] 🔄 Reset clicked');
            onReset();
          }}
          disabled={disabled || totalFrames === 0}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            console.log('[SimulationControls] ⏭️ Step clicked');
            onStep();
          }}
          disabled={disabled || totalFrames === 0 || isPlaying}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        
        {/* Frame Counter */}
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {currentFrame} / {totalFrames}
        </div>
      </div>

      {/* Timeline Slider */}
      {totalFrames > 0 && (
        <div className="flex items-center gap-2">
          <Slider
            value={[currentFrame]}
            max={totalFrames - 1}
            step={1}
            onValueChange={(value) => onFrameChange(value[0])}
            disabled={disabled}
            className="flex-1"
          />
        </div>
      )}

      {/* Speed Control */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-12">Speed:</span>
        <Slider
          value={[playbackSpeed]}
          min={0.25}
          max={2}
          step={0.25}
          onValueChange={(value) => onSpeedChange(value[0])}
          disabled={disabled}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground tabular-nums w-8">
          {playbackSpeed.toFixed(2)}x
        </span>
      </div>
    </div>
  );
}
