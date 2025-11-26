/**
 * Simulation Controls Component
 * * Playback controls for physics simulation (play/pause/reset/step).
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
  editingEnabled?: boolean; // [추가] 편집 모드 상태를 받는 prop
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
  editingEnabled = false, // [추가] 기본값 false
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
      editingEnabled, // 로그에도 추가
    });
    lastLoggedFrame.current = currentFrame;
  }
  
  // [UX] 편집 모드일 때 버튼 툴팁 메시지 생성
  const playButtonTitle = editingEnabled 
    ? "편집 모드에서는 재생할 수 없습니다." 
    : (isPlaying ? "일시정지" : "재생");

  const commonDisabled = disabled || editingEnabled || totalFrames === 0;

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
          // [수정] editingEnabled 상태면 클릭 불가
          disabled={commonDisabled}
          title={playButtonTitle}
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
          // [수정] 편집 중 리셋 방지 (필요에 따라 허용 가능하나 보통 막는 게 안전)
          disabled={commonDisabled}
          title="처음으로 리셋"
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
          // [수정] 편집 중 스텝 진행 방지
          disabled={commonDisabled || isPlaying}
          title="1프레임 앞으로"
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
            // [수정] 편집 중 타임라인 이동 방지
            disabled={disabled || editingEnabled}
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
          // [수정] 설정값 변경은 허용할 수도 있지만, 통일성을 위해 막음
          disabled={disabled || editingEnabled}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground tabular-nums w-8">
          {playbackSpeed.toFixed(2)}x
        </span>
      </div>
    </div>
  );
}