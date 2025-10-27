# SimulationBox Playback Controls Integration

## Overview

시뮬레이션 BOX에 재생 관련 컨트롤(재생/일시정지, 리셋, 스텝, 타임라인, 속도 조절)을 통합했습니다. 이제 각 SimulationBox는 독립적인 플레이백 컨트롤을 가지며, 사용자가 시뮬레이션을 직접 제어할 수 있습니다.

## Architecture

### Components

1. **SimulationControls** (`components/simulation/simulation-controls.tsx`)
   - Reusable playback control UI component
   - Props:
     - `isPlaying`: 현재 재생 상태
     - `currentFrame`: 현재 프레임 인덱스
     - `totalFrames`: 전체 프레임 수
     - `playbackSpeed`: 재생 속도 (0.25x ~ 2x)
     - Callbacks: `onPlayPause`, `onReset`, `onStep`, `onFrameChange`, `onSpeedChange`

2. **SimulationBoxNode** (`whiteboard/components/simulation-box-node.tsx`)
   - Integrates SimulationControls below SimulationLayer
   - Wires simulation context to control callbacks
   - Shows controls only when frames are available

3. **SimulationContext** (`simulation/SimulationContext.tsx`)
   - Global simulation state provider
   - Exposes: `frames`, `playing`, `currentIndex`, `setPlaying`, `resetSimulation`, `dt`, `updateConfig`

### Data Flow

```
User Interaction → SimulationControls
                        ↓
                   Callbacks
                        ↓
              SimulationBoxNode handlers
                        ↓
              SimulationContext methods
                        ↓
              Global simulation state update
                        ↓
              Re-render with new state
```

## Features

### Playback Controls

1. **Play/Pause Button**
   - Toggles simulation playback
   - Visual feedback with Play/Pause icons

2. **Reset Button**
   - Stops playback
   - Resets to frame 0

3. **Step Button**
   - Advances one frame at a time
   - Useful for frame-by-frame analysis
   - Currently: temporarily enables playback for one frame interval

4. **Timeline Slider**
   - Visual representation of playback progress
   - Direct frame navigation (placeholder - needs context support)
   - Shows current frame / total frames

5. **Speed Control**
   - Adjustable playback speed: 0.25x, 0.5x, 1x, 1.5x, 2x
   - Implemented by adjusting simulation `dt`
   - Higher speed = smaller dt (more frames per second)

## Current Limitations & Future Work

### Known Issues

1. **Global Simulation State**
   - SimulationContext is currently global (shared across all boxes)
   - Multiple boxes will interfere with each other
   - **Solution needed**: Per-box simulation instances or box-filtered state

2. **Frame Navigation Not Implemented**
   - `handleFrameChange` is a placeholder
   - SimulationContext doesn't expose `setCurrentIndex`
   - **Fix**: Add `setCurrentIndex` to context or implement frame seeking

3. **Step Forward Logic**
   - Current implementation: temporary play/pause
   - **Better approach**: Direct frame increment in context

4. **Speed Control Base Value**
   - Hardcoded `baseDt = 0.02`
   - Should derive from original config or per-simulation metadata

### Roadmap

#### Phase 1: Per-Box Simulation State (HIGH PRIORITY)
- **Option A**: Multiple SimulationProvider instances (one per box)
- **Option B**: Extend context to support multiple simulations with box IDs
- **Option C**: Local state in SimulationBoxNode (no shared context)

**Recommended**: Option B - extend SimulationContext with simulation registry keyed by box ID

```tsx
interface SimulationRegistry {
  [boxId: string]: {
    frames: SimulationFrame[];
    playing: boolean;
    currentIndex: number;
    config: SimulationConfig;
  };
}

const SimulationContext = createContext<{
  simulations: SimulationRegistry;
  getSimulation: (boxId: string) => SimulationState;
  setPlaying: (boxId: string, playing: boolean) => void;
  resetSimulation: (boxId: string) => void;
  // ... other per-box methods
} | null>(null);
```

#### Phase 2: Enhanced Frame Control
- Add `setCurrentIndex(boxId: string, index: number)` to context
- Implement direct frame seeking in timeline slider
- Add frame skip controls (e.g., +10 frames, -10 frames)

#### Phase 3: Advanced Playback Features
- Playback loop mode
- Frame range selection (play from frame X to Y)
- Export frame sequence as GIF/video
- Slow-motion analysis with sub-frame interpolation

#### Phase 4: Multi-Box Coordination (OPTIONAL)
- Sync playback across multiple boxes
- Compare simulations side-by-side with synchronized timeline
- Master playback controls for coordinated analysis

## Usage Example

### 1. Upload Image to SimulationBox
```tsx
// User clicks Upload button in box header
// Agent processes image → segments → labels → builds scene → simulates
// Frames are populated in SimulationContext
```

### 2. Controls Appear Automatically
```tsx
{frames.length > 0 && (
  <SimulationControls
    isPlaying={playing}
    currentFrame={currentIndex}
    totalFrames={frames.length}
    // ... callbacks
  />
)}
```

### 3. User Interactions
- Click **Play**: `setPlaying(true)` → animation loop runs
- Click **Pause**: `setPlaying(false)` → animation stops
- Click **Reset**: `resetSimulation()` → back to frame 0
- Adjust **Speed**: `updateConfig({ dt: baseDt / speed })`

## Testing Checklist

- [ ] Upload diagram image to SimulationBox
- [ ] Verify controls appear after simulation runs
- [ ] Test Play/Pause toggle
- [ ] Test Reset returns to frame 0
- [ ] Test Speed control affects playback rate
- [ ] Verify controls disabled during agent processing
- [ ] Test with multiple SimulationBoxes (expect interference due to global state)

## Code References

### SimulationControls Component
```tsx
// frontend/src/components/simulation/simulation-controls.tsx
export function SimulationControls({
  isPlaying, currentFrame, totalFrames, playbackSpeed,
  onPlayPause, onReset, onStep, onFrameChange, onSpeedChange,
  disabled = false,
}: SimulationControlsProps)
```

### Integration in SimulationBoxNode
```tsx
// frontend/src/whiteboard/components/simulation-box-node.tsx
const {
  frames, playing, currentIndex,
  setPlaying, resetSimulation, dt, updateConfig,
} = useSimulation();

<SimulationControls
  isPlaying={playing}
  currentFrame={currentIndex}
  totalFrames={frames.length}
  playbackSpeed={playbackSpeed}
  onPlayPause={handlePlayPause}
  onReset={handleReset}
  // ... other props
/>
```

## Related Documentation

- [Simulation Box Naming](./SIMULATION_BOX_NAMING.md)
- [Agent Integration](../backend/app/agent/README.md)
- Project Einstein Instructions: `.github/instructions/instruction.instructions.md`

## Migration Notes

### From Global Control Panel
- Previous: Single Control Panel for entire workspace
- Current: Per-box controls in each SimulationBox
- **Backward Compatibility**: Old Control Panel can coexist during transition
- **Removal Plan**: Deprecate global Control Panel after per-box state implemented

### Breaking Changes
- None (additive feature)
- Global Control Panel still functional if it exists

## Acceptance Criteria

✅ SimulationControls component created with all UI elements  
✅ Controls integrated into SimulationBoxNode  
✅ Play/Pause/Reset handlers wired to SimulationContext  
✅ Controls appear only when frames are available  
✅ Controls disabled during agent processing  
⬜ Per-box simulation state (future work)  
⬜ Direct frame navigation (future work)  
⬜ Step forward properly implemented (future work)

---

**Status**: Feature implemented with known limitations (global state).  
**Next Steps**: Implement per-box simulation state to enable independent playback.
