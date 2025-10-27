# Next Steps: Per-Box Simulation State

## Current Situation

시뮬레이션 재생 컨트롤이 각 SimulationBox에 통합되었지만, **SimulationContext가 전역(global) 상태**라서 여러 SimulationBox를 동시에 사용할 때 문제가 발생합니다.

### Problem Example

```
Box A: Pulley system simulation (30 frames)
Box B: Ramp simulation (50 frames)

User clicks Play in Box A:
→ Both Box A and Box B start playing simultaneously (shared state)
→ currentIndex increments globally
→ Box B tries to render frame 30+ but only has 50 frames
→ Interference and confusion
```

## Required Solution: Per-Box Simulation Instances

### Design Option: Simulation Registry in Context

**Core Idea**: SimulationContext manages a registry of simulations keyed by box ID.

```tsx
interface SimulationRegistry {
  [boxId: string]: {
    frames: SimulationFrame[];
    playing: boolean;
    currentIndex: number;
    config: SimulationConfig;
    acceleration?: number;
    tension?: number;
    backgroundImage: string | null;
    detections: DiagramParseDetection[];
    imageSizePx: { width: number; height: number } | null;
    scale_m_per_px: number | null;
    scene: any | null;
    labels: any | null;
  };
}

interface SimulationContextValue {
  // Registry of all simulations
  simulations: SimulationRegistry;
  
  // Per-box accessors
  getSimulation: (boxId: string) => SimulationState | null;
  
  // Per-box control methods
  setPlaying: (boxId: string, playing: boolean) => void;
  resetSimulation: (boxId: string) => void;
  setCurrentIndex: (boxId: string, index: number) => void;
  updateConfig: (boxId: string, partial: Partial<SimulationConfig>) => void;
  
  // Per-box data methods
  setFrames: (boxId: string, frames: SimulationFrame[]) => void;
  setBackgroundImage: (boxId: string, dataUrl: string | null) => void;
  parseAndBind: (boxId: string, file: File) => Promise<void>;
  runAnalytic: (boxId: string) => void;
}
```

### Implementation Steps

#### 1. Refactor SimulationContext

**File**: `frontend/src/simulation/SimulationContext.tsx`

**Changes**:
- Replace single state with `simulations: SimulationRegistry`
- Initialize empty registry: `const [simulations, setSimulations] = useState<SimulationRegistry>({})`
- Convert all methods to accept `boxId: string` parameter
- Implement per-box playback loops (one `useEffect` per active simulation)

**Example**:
```tsx
const setPlaying = useCallback((boxId: string, playing: boolean) => {
  setSimulations(prev => ({
    ...prev,
    [boxId]: {
      ...(prev[boxId] || getDefaultSimulationState()),
      playing,
    },
  }));
}, []);
```

#### 2. Update SimulationBoxNode to Use Box ID

**File**: `frontend/src/whiteboard/components/simulation-box-node.tsx`

**Changes**:
```tsx
const simulation = useSimulation();
const boxSimulation = simulation.getSimulation(node.id);

const handlePlayPause = useCallback(() => {
  simulation.setPlaying(node.id, !boxSimulation?.playing);
}, [node.id, boxSimulation?.playing, simulation]);

const handleReset = useCallback(() => {
  simulation.resetSimulation(node.id);
}, [node.id, simulation]);

// Use boxSimulation instead of global state
<SimulationControls
  isPlaying={boxSimulation?.playing ?? false}
  currentFrame={boxSimulation?.currentIndex ?? 0}
  totalFrames={boxSimulation?.frames.length ?? 0}
  // ...
/>
```

#### 3. Update SimulationLayer to Use Per-Box State

**File**: `frontend/src/components/simulation/simulation-layer.tsx`

**Changes**:
- Accept `boxId` prop
- Call `useSimulation().getSimulation(boxId)` instead of `useSimulation()`
- Pass `boxId` through from SimulationBoxNode

#### 4. Handle Playback Loops Per Box

**Challenge**: Multiple independent animation loops

**Solution**: Single `useEffect` that manages all active simulations:

```tsx
useEffect(() => {
  const activeBoxIds = Object.entries(simulations)
    .filter(([_, sim]) => sim.playing && sim.frames.length > 0)
    .map(([boxId]) => boxId);

  if (activeBoxIds.length === 0) return;

  const lastTimestamps: Record<string, number> = {};

  const handle = (ts: number) => {
    activeBoxIds.forEach(boxId => {
      const sim = simulations[boxId];
      if (!sim?.playing) return;

      const lastTs = lastTimestamps[boxId] ?? ts;
      const elapsed = ts - lastTs;
      const stepMs = sim.config.dt * 1000;

      if (elapsed >= stepMs) {
        lastTimestamps[boxId] = ts;
        setSimulations(prev => {
          const current = prev[boxId];
          if (!current || current.currentIndex + 1 >= current.frames.length) {
            return prev;
          }
          return {
            ...prev,
            [boxId]: {
              ...current,
              currentIndex: current.currentIndex + 1,
            },
          };
        });
      }
    });

    // Continue if any simulation is still playing
    if (Object.values(simulations).some(s => s.playing)) {
      requestAnimationFrame(handle);
    }
  };

  const rafId = requestAnimationFrame(handle);
  return () => cancelAnimationFrame(rafId);
}, [simulations]);
```

#### 5. Update Agent Integration

**File**: `frontend/src/hooks/use-simulation-box-agent.ts`

**Changes**:
- When agent completes simulation, call `simulation.parseAndBind(boxId, file)`
- Ensure frames are stored in correct box's state

## Testing Plan

### Unit Tests
- SimulationContext registry methods
- Per-box state isolation
- Playback loop independence

### Integration Tests
1. Create two SimulationBoxes
2. Upload different diagrams to each
3. Start playback in Box A
4. Verify Box B remains paused
5. Start playback in Box B
6. Verify both play independently at different speeds

### UI Tests
- Timeline updates correctly per box
- Speed control affects only target box
- Reset only resets target box
- Frame counts match per-box simulation

## Estimated Effort

- **SimulationContext refactor**: 2-3 hours
- **SimulationBoxNode updates**: 1 hour
- **SimulationLayer updates**: 30 minutes
- **Testing & debugging**: 1-2 hours
- **Total**: ~5-7 hours

## Priority

**CRITICAL** - Without this, the feature is unusable with multiple boxes.

## Acceptance Criteria

- [ ] Multiple SimulationBoxes can run simulations simultaneously
- [ ] Each box has independent playback state (playing, currentIndex, speed)
- [ ] Controls in one box do not affect other boxes
- [ ] Closing a box cleans up its simulation state
- [ ] No memory leaks from orphaned playback loops
- [ ] All existing features (naming, agent chat) still work

## Alternative Approaches

### Option B: Multiple SimulationProvider Instances

**Pros**: Each box gets its own isolated context  
**Cons**: More complex component tree, harder to manage global operations (if needed later)

**Implementation**:
```tsx
<SimulationProvider boxId={node.id}>
  <SimulationBoxNode node={node} ... />
</SimulationProvider>
```

### Option C: Local State in SimulationBoxNode

**Pros**: Maximum isolation, no shared context  
**Cons**: Duplicate logic, harder to implement multi-box features (sync, compare)

**Not recommended** - loses benefits of centralized state management.

## Recommended Next Action

**Implement Option A (Simulation Registry)** - provides best balance of isolation and centralization.

Start with:
1. Create `SimulationRegistry` type
2. Refactor context state to use registry
3. Update one method (e.g., `setPlaying`) to be per-box
4. Test with single box
5. Expand to all methods
6. Update consuming components
7. Test with multiple boxes

---

**Status**: Design complete, ready for implementation  
**Blocking**: Multi-box usage  
**Dependencies**: None  
**Risk**: Medium (context refactor is delicate)
