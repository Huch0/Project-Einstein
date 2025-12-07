# Mouse Interaction & Edit Mode - Technical Specification

## Problem Analysis

### Root Cause
Matter.js MouseConstraint **requires Engine.update() to process mouse events**. When the physics engine is paused (no Engine.update()), MouseConstraint event handlers (mousedown, mousemove, startdrag, enddrag) never fire, even though:
- Canvas receives native mouse events
- Matter.Mouse object tracks position correctly
- MouseConstraint is added to the World

### Solution Architecture
**Two-phase approach:**
1. **Edit Mode (playing=false, editingEnabled=true)**:
   - Make all dynamic bodies temporarily static
   - Continue calling Engine.update() with minimal timestep (16ms)
   - MouseConstraint events now fire correctly
   - No physics simulation (gravity, collisions) due to static bodies

2. **Play Mode (playing=true)**:
   - Restore bodies to original dynamic/static state
   - Normal physics simulation resumes

## Implementation Plan

### Phase 1: Body State Management ✅
**File:** `simulation-layer.tsx`

**Changes:**
1. Add `useEffect` that toggles body static state based on `playing` and `editingEnabled`
2. Store original static state in `body.__wasStaticOriginal` property
3. On edit mode entry: Make all non-static bodies static
4. On play mode entry: Restore bodies marked as originally dynamic

**Code:**
```typescript
useEffect(() => {
    const engine = matterEngineRef.current;
    if (!engine || !scene) return;

    const bodies = Matter.Composite.allBodies(engine.world);
    
    if (!playing && editingEnabled) {
        // Edit mode: Make all bodies static
        bodies.forEach(body => {
            if (!body.isStatic) {
                (body as any).__wasStaticOriginal = false;
                Matter.Body.setStatic(body, true);
            }
        });
    } else if (playing) {
        // Play mode: Restore dynamics
        bodies.forEach(body => {
            if ((body as any).__wasStaticOriginal === false) {
                Matter.Body.setStatic(body, false);
                delete (body as any).__wasStaticOriginal;
            }
        });
    }
}, [playing, editingEnabled, scene]);
```

### Phase 2: Engine Update in Edit Mode ✅
**File:** `simulation-layer.tsx` (render loop)

**Changes:**
1. Remove gravity manipulation (no longer needed)
2. Always call `Engine.update()` even in edit mode
3. Fixed 16ms timestep in edit mode (prevents time accumulation)
4. Physics doesn't run because bodies are static

**Code:**
```typescript
if (playing) {
    Matter.Engine.update(engine, deltaTime * 1000);
    // Pulley constraints, logging...
} else {
    // Edit mode: Still update for MouseConstraint
    Matter.Engine.update(engine, 16);
}
```

### Phase 3: Clean Up Debug Logging 🔄
**Files:** 
- `simulation-layer.tsx`
- `simulation-controls.tsx`
- `simulation-box-node.tsx`

**Actions:**
1. Remove temporary test logs:
   - `🧪 TEST: Direct canvas click detected!`
   - `🧪 Current mouse position: ...` (2-second interval)
   - `🖱️ MouseConstraint active: ...` (5-second interval)

2. Keep essential logs:
   - MouseConstraint creation/removal
   - Body click/selection events
   - Drag start/end events
   - Backend sync operations

3. Reduce logging frequency:
   - Frame count logs: Every 10 seconds (not 5)
   - SimulationControls: Only on state changes

### Phase 4: Verify Click Detection ✅
**Test cases:**

1. **Edit Mode Entry:** ✅
   - Click Edit button
   - Console: `🔒 Edit mode: Making all bodies static`
   - Console: `MouseConstraint added`
   - Bodies should NOT fall

2. **Click Detection:** ✅
   - Click on object in edit mode
   - Console: `🖱️ MOUSEDOWN event triggered`
   - Console: `✅ Body CLICKED: [body_id]`
   - Orange highlight appears immediately

3. **Double-Click Activation:** ✅
   - Double-click object
   - Console: `🔥 DOUBLE-CLICK detected`
   - Console: `✨ Body activated for dragging`
   - Purple glow appears

4. **Drag Static Body:** ✅
   - After activation, drag object
   - Console: `🎯 STARTDRAG event on: [body_id]`
   - Object follows mouse
   - Console: `Static body [id] drag completed`
   - Console: `📤 Syncing [id] position to backend...`

5. **Play Mode:** ✅
   - Click Play
   - Console: `🔓 Play mode: Restoring body dynamics`
   - Physics simulation starts
   - Objects fall/interact normally

### Phase 5: Backend Sync & Resimulation 🔄
**Priority: High** - Critical for persistence

**Current State:**
- ✅ Drag position synced to backend via `debouncedBackendSyncRef`
- ✅ API call: `/simulation/batch_update` with `resimulate: false`
- ❌ Frontend frames NOT updated after drag
- ❌ Play after drag uses OLD frames (position mismatch)

**Problem:**
```
User drags mass_a from (100, 200) to (150, 250)
  ↓
Backend scene updated, but resimulate=false
  ↓
Frontend frames still show mass_a at (100, 200)
  ↓
User clicks Play → old simulation runs (wrong starting position!)
```

**Solution Architecture:**

**Option A: Resimulate on Play** (Recommended)
```typescript
// When Play button clicked:
1. Check if scene was modified in edit mode (track dirty flag)
2. If dirty: Call backend resimulation API
3. Wait for new frames
4. Start playback with updated frames
```

**Option B: Resimulate on Edit End**
```typescript
// When Edit mode disabled:
1. Flush all pending updates
2. Call backend resimulation API
3. Update frames in background
4. User can Play immediately
```

**Option C: Resimulate on Drag End** (Too aggressive)
```typescript
// After each drag:
1. Debounced backend update triggers resimulation
2. Frames updated constantly
3. Performance impact: High
```

**Chosen: Option A (Resimulate on Play)**
- Best UX: User can make multiple edits without waiting
- Explicit action: Play = "run with my changes"
- Performance: Only one resimulation per edit session

**Implementation Plan:**

**Step 1: Track Scene Modifications**
```typescript
// SimulationContext.tsx
const [sceneModified, setSceneModified] = useState(false);

// When body dragged:
setSceneModified(true);

// When resimulation completes:
setSceneModified(false);
```

**Step 2: Intercept Play Button**
```typescript
// SimulationContext.tsx or simulation-box-node.tsx
const handlePlay = async () => {
    if (sceneModified && !playing) {
        console.log('[Simulation] Scene modified, triggering resimulation...');
        
        // Flush pending updates
        if (debouncedBackendSyncRef.current) {
            await debouncedBackendSyncRef.current.flush();
        }
        
        // Trigger resimulation
        await performResimulation(scene);
        
        // Now frames are updated, start playing
        setPlaying(true);
    } else {
        // Normal play
        setPlaying(true);
    }
};
```

**Step 3: Backend API**
```typescript
// lib/simulation-api.ts
export async function resimulateScene(
    conversationId: string,
    duration?: number
): Promise<{ frames: any[] }> {
    const response = await fetch(`${API_BASE_URL}/run_sim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            conversation_id: conversationId,
            duration_s: duration || 5,
        }),
    });
    
    if (!response.ok) {
        throw new Error(`Resimulation failed: ${response.statusText}`);
    }
    
    return response.json();
}
```

**Step 4: Update Frames**
```typescript
// SimulationContext.tsx
const performResimulation = async (currentScene: any) => {
    try {
        const { frames: newFrames } = await resimulateScene(
            globalChat.activeBoxId,
            config.duration
        );
        
        setFrames(newFrames);
        setCurrentIndex(0);
        setSceneModified(false);
        
        console.log('[Simulation] ✅ Resimulation complete,', newFrames.length, 'frames');
    } catch (error) {
        console.error('[Simulation] Resimulation failed:', error);
    }
};
```

**Files to Modify:**
1. `SimulationContext.tsx`: Add `sceneModified` state, `performResimulation()`
2. `simulation-box-node.tsx`: Modify Play button handler
3. `simulation-layer.tsx`: Call `setSceneModified(true)` on drag end
4. `lib/simulation-api.ts`: Add `resimulateScene()` wrapper

**Testing Checklist:**
- [ ] Drag object in edit mode
- [ ] `sceneModified` flag set to true
- [ ] Click Play
- [ ] Console: "Scene modified, triggering resimulation..."
- [ ] Backend `/run_sim` called
- [ ] Frames updated
- [ ] Playback starts from new position
- [ ] Reset button clears `sceneModified` flag

### Phase 6: Feature Enhancement 📋
**Priority: Medium**

1. **Visual Feedback Improvements:**
   - Hover state: Subtle border glow (currently implemented)
   - Selected state: Orange border (currently implemented)
   - Activated state: Purple glow + flash (currently implemented)
   - Dragging state: Enhanced visual (TBD)

2. **Backend Sync Optimization:**
   - Currently: 1000ms debounce
   - Consider: Batch multiple entity updates in one request
   - Add retry logic for failed syncs

3. **Constraint Editing:**
   - Currently: Only position editing supported
   - Future: Edit constraint parameters (pulley ratio, etc.)
   - Requires backend API extension

## Key Technical Insights

### Why Engine.update() is Required
Matter.js MouseConstraint listens to native canvas events, but **event handlers are called during Engine.update()**:

```javascript
// Inside Matter.js Engine.update():
Events.trigger(engine, 'beforeUpdate', event);
// ... MouseConstraint processes queued events here ...
Events.trigger(engine, 'afterUpdate', event);
```

Without Engine.update(), event queue never processes → handlers never fire.

### Why Static Bodies Don't Fall
Static bodies in Matter.js:
- Have infinite mass (`body.mass = Infinity`)
- Ignore all forces (gravity, collisions)
- Can be moved via `Body.setPosition()` only
- Don't participate in collision resolution

This allows Engine.update() to run without physics simulation.

### Coordinate System
- **Scene (backend):** Y-up (positive Y = upward)
- **Matter.js:** Y-down (positive Y = downward)
- **Conversion:** `sceneY = -matterY`

Always convert when syncing to backend!

## Debugging Checklist

When MouseConstraint doesn't work:
- [ ] Is `Engine.update()` being called? (Check render loop)
- [ ] Is MouseConstraint added to `engine.world`? (Check effect logs)
- [ ] Is canvas `pointer-events: auto`? (Check computed style)
- [ ] Are bodies actually in the world? (Check `Composite.allBodies()`)
- [ ] Is mouse position updating? (Check `mouse.position` logs)
- [ ] Are event listeners registered? (Check `Events.on()` calls)
- [ ] Is edit mode active? (`editingEnabled && !playing`)

## Future Considerations

### Multi-User Editing
- Lock mechanism for concurrent edits
- Real-time sync via WebSocket
- Conflict resolution strategy

### Undo/Redo
- Track entity position history
- Implement command pattern
- Backend state snapshots

### Performance Optimization
- Virtual scrolling for large simulations
- LOD (Level of Detail) rendering
- Web Worker for physics calculations

---

**Status:** Phase 1 & 2 Complete ✅ | Phase 3-5 Pending 🔄
**Last Updated:** 2025-11-08
**Author:** GitHub Copilot + User Collaboration
