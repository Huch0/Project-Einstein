import { useEffect } from 'react';
import Matter from 'matter-js';

// Drag state type
type DragState = {
  manualDragBody: Matter.Body | null;
  manualDragOffset: { x: number; y: number } | null;
};

type InteractionProps = {
  engine: Matter.Engine | null;
  render: Matter.Render | null;
  scene: any;
  editingEnabled: boolean;
  playing: boolean;
  hoveredBodyId: string | null;
  setHoveredBodyId: (id: string | null) => void;
  selectedEntityId: string | null;
  setSelectedEntityId: (id: string | null) => void;
  setActivatedBodyId: (id: string | null) => void;
  activatedBodyIdRef: React.MutableRefObject<string | null>;
  activationTimestampRef: React.MutableRefObject<number>;
  activeTransform: any; // CanvasTransform
  updateBodyLocal: (bodyId: string, updates: Record<string, any>) => void;
  setSceneModified: (v: boolean) => void;
  sceneModifiedRef: React.MutableRefObject<boolean>;
  debouncedBackendSyncRef: React.MutableRefObject<{ debouncedUpdate: Function; flush: () => Promise<any> } | null>;
  globalConversationId?: string | null;
  setCursor: (cursor: string) => void;
  containerEl?: HTMLElement | null; // outer container for pointer events when DIV is target
  dragStateRef: React.MutableRefObject<DragState>;
};

// Handles mouse-based interaction: selection, hover, drag, backend sync.
export function SimulationInteraction({
  engine,
  render,
  scene,
  editingEnabled,
  playing,
  hoveredBodyId,
  setHoveredBodyId,
  setSelectedEntityId,
  setActivatedBodyId,
  activatedBodyIdRef,
  activationTimestampRef,
  activeTransform,
  updateBodyLocal,
  setSceneModified,
  sceneModifiedRef,
  debouncedBackendSyncRef,
  globalConversationId,
  setCursor,
  containerEl,
  dragStateRef,
}: InteractionProps) {
  useEffect(() => {
    // EFFECT PURPOSE: Initialize / reuse mouseConstraint & listeners exactly once per (engine, render, scene, editingEnabled, playing) change.
    if (!engine || !render || !scene) return;

    const canvasEl = render.canvas;
    // Mark render object with unique identifier for debugging
    if (!(render as any).__canvasIdentifier) {
      (render as any).__canvasIdentifier = `render_${Date.now()}`;
    }
    console.log('[SimulationInteraction] 🎨 Render object ID:', (render as any).__canvasIdentifier);
    
    // Mark canvas element with unique ID to track if it's being replaced
    if (!(canvasEl as any).__canvasElementId) {
      (canvasEl as any).__canvasElementId = `canvas_${Date.now()}`;
      console.log('[SimulationInteraction] 🖼️ NEW Canvas element created:', (canvasEl as any).__canvasElementId);
    } else {
      console.log('[SimulationInteraction] 🖼️ Reusing existing canvas element:', (canvasEl as any).__canvasElementId);
    }
    
    // Use dragStateRef from parent - survives canvas recreation!
    console.log('[SimulationInteraction] 🗺️ Using dragStateRef from parent', {
      hasBody: !!dragStateRef.current.manualDragBody,
      bodyId: dragStateRef.current.manualDragBody?.label || dragStateRef.current.manualDragBody?.id
    });
    
    // Instrument basic canvas diagnostics every mount
    try {
      const w = canvasEl.width;
      const h = canvasEl.height;
      // eslint-disable-next-line no-console
      console.log('[SimulationInteraction] 🔍 Canvas diagnostics', { width: w, height: h, styleW: canvasEl.style.width, styleH: canvasEl.style.height, pointerEvents: canvasEl.style.pointerEvents });
    } catch {}

    // Attach one-time global mousedown spy to verify events actually reaching window & target
    if (!(window as any).__einsteinGlobalMouseSpy) {
      (window as any).__einsteinGlobalMouseSpy = true;
      window.addEventListener('mousedown', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        const isCanvas = e.target === canvasEl;
        // eslint-disable-next-line no-console
        console.log('[SimulationInteraction] 🕵️ global mousedown', { tag, isCanvas });
      });
      window.addEventListener('pointerdown', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        const isCanvas = e.target === canvasEl;
        // eslint-disable-next-line no-console
        console.log('[SimulationInteraction] 🕵️ global pointerdown', { tag, isCanvas, pointerId: e.pointerId });
      });
    }

    // Guard repeated instrumentation logs
    if (!(render as any).__canvasDiagnosticsLogged) {
      (render as any).__canvasDiagnosticsLogged = true;
    }

    // Determine if we need to (re)create mouseConstraint
    const existing = (render as any).__interactionMouseConstraint as Matter.MouseConstraint | undefined;
    let mouseConstraint: Matter.MouseConstraint;
    const shouldEnable = editingEnabled && !playing;
    if (existing && shouldEnable) {
      mouseConstraint = existing;
      // eslint-disable-next-line no-console
      console.log('[SimulationInteraction] ♻️ Reusing mouseConstraint');
    } else {
      // Remove if exists but should not enable
      if (existing && !shouldEnable) {
        try { Matter.World.remove(engine.world, existing); } catch {}
        (render as any).__interactionMouseConstraint = undefined;
      }
      if (!shouldEnable) return; // nothing to set up in play mode
      // CREATE new mouseConstraint
      const hostElement: HTMLElement = (render.canvas.parentElement as HTMLElement) || render.canvas;
      const primaryElement: HTMLElement = containerEl || hostElement;
      const mouse = Matter.Mouse.create(primaryElement);
      mouseConstraint = Matter.MouseConstraint.create(engine, {
        mouse,
        constraint: { stiffness: 0.2, render: { visible: false } },
        collisionFilter: { mask: 0xFFFFFFFF },
      });
      (mouseConstraint as any).canStartDrag = () => true;
      Matter.World.add(engine.world, mouseConstraint);
      render.mouse = mouse;
      (render as any).__interactionMouseConstraint = mouseConstraint;
    }

    // Shared references post-(re)create
  const hostElement: HTMLElement = (render.canvas.parentElement as HTMLElement) || render.canvas;
  const primaryElement: HTMLElement = containerEl || hostElement;
  
  // Debug: log element hierarchy
  console.log('[SimulationInteraction] 🔍 Element hierarchy:', 
    'canvas=' + canvasEl.tagName, 
    'host=' + hostElement.tagName, 
    'primary=' + primaryElement.tagName,
    'canvasIsHost=' + (canvasEl === hostElement),
    'hostIsPrimary=' + (hostElement === primaryElement)
  );
  
  // mouseConstraint already determined above; reuse it here.
    // Debug instrumentation once per effect run
    try {
      const bodies = Matter.Composite.allBodies(engine.world);
      console.log('[SimulationInteraction] 🧪 Init/Check bodies=', bodies.map(b => ({ id: (b as any).label || b.id, x: b.position.x, y: b.position.y, static: b.isStatic })));
      console.log('[SimulationInteraction] 🧪 PointerEnabled=', editingEnabled && !playing, 'SceneFallback=', !!(scene as any)?.__fallback);
    } catch {}

  let draggedBody: Matter.Body | null = null;
  let mouseConstraintDragStarted = false; // tracks if Matter's own drag fired
  // Manual drag state stored on render to survive effect re-runs
  let manualDragBody: Matter.Body | null = (render as any).__manualDragBody || null;
  let manualDragOffset: { x: number; y: number } | null = (render as any).__manualDragOffset || null;
  let manualDragPendingBody: Matter.Body | null = (render as any).__manualDragPendingBody || null;
  let manualDragPendingOffset: { x: number; y: number } | null = (render as any).__manualDragPendingOffset || null;
  let manualDragActivationTimer: number | null = (render as any).__manualDragActivationTimer || null;
  // Diagnostics: track drag start/end positions to investigate post-drag reversion
  let dragOriginalPos: { x: number; y: number } | null = null;
  let dragFinalPos: { x: number; y: number } | null = null;
  let loggedPostDragHover = false;

    // Utility: robust body picking (bounds + vertices + Query.point + distance fallback)
    const pickBodyAtPoint = (point: Matter.Vector, bodies: Matter.Body[]): Matter.Body | null => {
      // 1. Fast bounds + vertices containment
      let hit = bodies.find(b => Matter.Bounds.contains(b.bounds, point) && Matter.Vertices.contains(b.vertices, point));
      if (hit) return hit;
      // 2. Matter.Query.point (handles concave/rotated)
      const queried = Matter.Query.point(bodies, point);
      if (queried.length > 0) return queried[0];
      // 3. Distance to body center (for tiny bodies / precision misses)
      const DIST_THRESHOLD = 12; // pixels
      let closest: { body: Matter.Body; dist: number } | null = null;
      for (const b of bodies) {
        const d = Math.hypot(b.position.x - point.x, b.position.y - point.y);
        if (d <= DIST_THRESHOLD && (!closest || d < closest.dist)) {
          closest = { body: b, dist: d };
        }
      }
      return closest?.body ?? null;
    };

    const mousedownHandler = (event: any) => {
      const bodies = Matter.Composite.allBodies(engine.world);
      const clicked = pickBodyAtPoint(event.mouse.position, bodies);
      if (clicked) {
        const id = clicked.label || clicked.id?.toString() || 'unknown';
        // eslint-disable-next-line no-console
        console.log('[SimulationInteraction] 🖱️ mousedown hit:', id, { static: clicked.isStatic });
        setSelectedEntityId(id);
      } else {
        // eslint-disable-next-line no-console
        console.log('[SimulationInteraction] 🖱️ mousedown empty');
        setSelectedEntityId(null);
        activatedBodyIdRef.current = null;
        // DON'T call setActivatedBodyId(null) - causes canvas recreation
      }
    };

    const mousemoveHover = (event: any) => {
      const bodies = Matter.Composite.allBodies(engine.world);
      const hovered = pickBodyAtPoint(event.mouse.position, bodies);
      // Simplified stabilization: operate ONLY on hovered body to avoid diagonal jitter from mass snapping
      try {
        if (editingEnabled && !playing && hovered && !(hovered as any).__activelyDragging) {
          if (dragFinalPos && !loggedPostDragHover) {
            const id = hovered.label || hovered.id?.toString() || 'unknown';
            const mismatch = Math.hypot(hovered.position.x - dragFinalPos.x, hovered.position.y - dragFinalPos.y);
            // eslint-disable-next-line no-console
            console.log('[SimulationInteraction] 🔎 Post-drag first hover position check', {
              id,
              current: { x: hovered.position.x, y: hovered.position.y },
              dragOriginalPos,
              dragFinalPos,
              mismatch,
            });
            loggedPostDragHover = true;
          }
          // Zero any residual motion
          if (Math.abs(hovered.velocity.x) > 0.001 || Math.abs(hovered.velocity.y) > 0.001 || Math.abs(hovered.angularVelocity) > 0.001) {
            Matter.Body.setVelocity(hovered, { x: 0, y: 0 });
            Matter.Body.setAngularVelocity(hovered, 0);
            hovered.force.x = 0; hovered.force.y = 0; hovered.torque = 0;
          }
          // Perform ONE-TIME snap after drag end if flagged, then clear flag
            if ((hovered as any).__needsPostDragSnap) {
              const snap = 0.5;
              const snappedX = Math.round(hovered.position.x / snap) * snap;
              const snappedY = Math.round(hovered.position.y / snap) * snap;
              if (snappedX !== hovered.position.x || snappedY !== hovered.position.y) {
                Matter.Body.setPosition(hovered, { x: snappedX, y: snappedY });
              }
              delete (hovered as any).__needsPostDragSnap;
            }
          // Keep hovered body sleeping so engine doesn't integrate tiny velocities
          try { (Matter as any).Sleeping?.set?.(hovered, true); } catch {}
        }
      } catch {}
      if (hovered) {
        const id = hovered.label || hovered.id?.toString() || 'unknown';
        setHoveredBodyId(id);
        setCursor('grab');
      } else {
        if (hoveredBodyId !== null) setHoveredBodyId(null);
        setCursor('default');
      }
    };

    const startDrag = (event: any) => {
      const body: Matter.Body | undefined = event.body;
      if (!body) return;
      const id = body.label || body.id?.toString() || 'unknown';
      // eslint-disable-next-line no-console
      console.log('[SimulationInteraction] 🚚 startdrag:', id, { static: body.isStatic });
  dragOriginalPos = { x: body.position.x, y: body.position.y };
  dragFinalPos = null;
  loggedPostDragHover = false;
      
      // Update activation state via ref ONLY
      activatedBodyIdRef.current = id;
      activationTimestampRef.current = performance.now();
      
      // DON'T call setActivatedBodyId - causes canvas recreation!
      
      draggedBody = body;
      mouseConstraintDragStarted = true;
  (body as any).__activelyDragging = true;
      // If a manual fallback activation was pending, cancel it now to prevent dual drag handlers
      if (manualDragActivationTimer !== null) {
        clearTimeout(manualDragActivationTimer);
        manualDragActivationTimer = null;
        if (manualDragPendingBody) {
          const pendingId = manualDragPendingBody.label || manualDragPendingBody.id?.toString() || 'unknown';
          console.log('[SimulationInteraction] ❌ Cancel manual fallback (mouseConstraint started) for', pendingId);
        }
        manualDragPendingBody = null;
        manualDragPendingOffset = null;
      }
      // Increase stiffness for more direct dragging feel
      try { (mouseConstraint as any).constraint.stiffness = 0.7; } catch {}
      if (body.isStatic) {
        (body as any).__wasStatic = true;
        (body as any).__staticDragStart = { x: body.position.x, y: body.position.y, angle: body.angle };
        // Temporarily make static body dynamic so MouseConstraint can drag it
        Matter.Body.setStatic(body, false);
        (body as any).__tempDynamic = true;
        // Reset any residual motion
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(body, 0);
        body.force.x = 0; body.force.y = 0; body.torque = 0;
      }
      // Wake sleeping bodies when a new drag starts
      try { (Matter as any).Sleeping?.set?.(body, false); } catch {}
      // Stabilize dynamic bodies too (in case previous play mode left velocity)
      Matter.Body.setVelocity(body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(body, 0);
      body.force.x = 0; body.force.y = 0; body.torque = 0;
      // Increase air friction during drag for damping; restore later
      (body as any).__preDragFrictionAir = body.frictionAir;
      body.frictionAir = Math.min(0.5, (body.frictionAir || 0) + 0.4);
      // Per-tick stabilization (prevent diagonal drift while editing)
      const freezeDuringEdit = (evt: Matter.IEventTimestamped<Matter.Engine>) => {
        if (!draggedBody || draggedBody !== body) return;
        // Only in edit mode (engine gravity zero outside playing per SimulationLayer)
        Matter.Body.setAngularVelocity(body, 0);
        // Keep velocity near zero to suppress inertia drift
        if (Math.hypot(body.velocity.x, body.velocity.y) > 0.01) {
          Matter.Body.setVelocity(body, { x: 0, y: 0 });
        }
      };
      (body as any).__freezeHandler = freezeDuringEdit;
      try { Matter.Events.on(engine, 'beforeUpdate', freezeDuringEdit); } catch {}
    };

    const endDrag = async () => {
      const body = draggedBody;
      if (!body) return;
      const id = body.label || body.id?.toString() || 'unknown';
      // eslint-disable-next-line no-console
      console.log('[SimulationInteraction] ✅ enddrag:', id, { x: body.position.x, y: body.position.y });
  dragFinalPos = { x: body.position.x, y: body.position.y };
      if ((body as any).__wasStatic) {
        delete (body as any).__wasStatic;
        delete (body as any).__staticDragStart;
      }
      if ((body as any).__tempDynamic) {
        Matter.Body.setStatic(body, true);
        delete (body as any).__tempDynamic;
      }
      if ((body as any).__activelyDragging) {
        delete (body as any).__activelyDragging;
      }
      // HARD FREEZE: eliminate residual motion & diagonal drift
      try {
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(body, 0);
        body.force.x = 0; body.force.y = 0; body.torque = 0;
        // Put body to sleep (Matter internal) to suppress solver jitter until next drag
        (Matter as any).Sleeping?.set?.(body, true);
        // Flag for one-time post-drag snap on next hover
        (body as any).__needsPostDragSnap = true;
      } catch {}
      // Reset mouseConstraint state (prevent lingering constraint influence)
      try {
        const mc = (render as any).__interactionMouseConstraint as Matter.MouseConstraint | undefined;
        if (mc) {
          (mc as any).body = null;
          if ((mc as any).constraint) {
            (mc as any).constraint.stiffness = 0.2;
            (mc as any).constraint.pointA = { x: 0, y: 0 };
          }
        }
      } catch {}
      // NEW: Force dynamic bodies to become temporary static after drag end for hover stability
      if (!(body as any).__originallyStatic && !body.isStatic) {
        (body as any).__tempPostDragStatic = true;
        Matter.Body.setStatic(body, true);
      }
      // Restore frictionAir if modified
      if ((body as any).__preDragFrictionAir !== undefined) {
        body.frictionAir = (body as any).__preDragFrictionAir;
        delete (body as any).__preDragFrictionAir;
      }
      // Remove freeze handler
      if ((body as any).__freezeHandler) {
        try { Matter.Events.off(engine as Matter.Engine, 'beforeUpdate', (body as any).__freezeHandler); } catch {}
        delete (body as any).__freezeHandler;
      }
      if (!body.position || !Number.isFinite(body.position.x) || !Number.isFinite(body.position.y)) {
        draggedBody = null;
        return;
      }
      const newPosition: [number, number] = [
        (body.position.x - activeTransform.originPx[0]) * activeTransform.pixelsToMeters,
        (activeTransform.originPx[1] - body.position.y) * activeTransform.pixelsToMeters,
      ];
      
      // Mark scene as modified to prevent regeneration
      sceneModifiedRef.current = true;
      
      // DO NOT call updateBodyLocal() immediately - causes canvas recreation!
      console.log('[SimulationInteraction] 💾 MouseConstraint: Matter body positioned, marked scene as modified');
      
      // Backend sync (async, in parallel)
      if (globalConversationId && debouncedBackendSyncRef.current) {
        try {
          debouncedBackendSyncRef.current.debouncedUpdate({ [id]: { position_m: newPosition } });
          await debouncedBackendSyncRef.current.flush();
          console.log('[SimulationInteraction] ✅ MouseConstraint: backend sync complete, updating scene state');
          updateBodyLocal(id, { position_m: newPosition });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[SimulationInteraction] Backend sync failed', e);
          console.log('[SimulationInteraction] 💾 Updating scene state despite backend error');
          updateBodyLocal(id, { position_m: newPosition });
        }
      } else {
        // No backend sync, delay scene update
        setTimeout(() => {
          console.log('[SimulationInteraction] 💾 Delayed scene state update (MouseConstraint, no backend)');
          updateBodyLocal(id, { position_m: newPosition });
        }, 100);
      }
      if (body.isStatic) {
        activatedBodyIdRef.current = null;
        // DON'T call setActivatedBodyId(null) - causes canvas recreation
      }
      draggedBody = null;
      mouseConstraintDragStarted = false;
    };

    const mousemoveDragStatic = (event: any) => {
      if (!draggedBody || !(draggedBody as Matter.Body).isStatic) return;
      const id = draggedBody.label || (draggedBody as any).id?.toString() || 'unknown';
      if (activatedBodyIdRef.current !== id) return;
      const pos = event.mouse.position;
      Matter.Body.setPosition(draggedBody, { x: pos.x, y: pos.y });
      // DO NOT update scene state during drag - causes canvas recreation!
      // The Matter body position is updated, that's enough for visual feedback
      // Scene state will be updated after drag completes in mouseupDragStatic
    };

    Matter.Events.on(mouseConstraint, 'mousedown', mousedownHandler);
    Matter.Events.on(mouseConstraint, 'mousemove', mousemoveHover);
    Matter.Events.on(mouseConstraint, 'startdrag', startDrag);
    Matter.Events.on(mouseConstraint, 'enddrag', endDrag);
    Matter.Events.on(mouseConstraint, 'mousemove', mousemoveDragStatic);

    // Fallback click listener if MouseConstraint events do not fire
    const fallbackClick = (e: MouseEvent) => {
      if (!editingEnabled || playing) return;
      const rect = canvasEl.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const bodies = Matter.Composite.allBodies(engine.world);
      const hit = pickBodyAtPoint({ x, y } as Matter.Vector, bodies);
      if (hit) {
        const id = hit.label || hit.id?.toString() || 'unknown';
        // eslint-disable-next-line no-console
        console.log('[SimulationInteraction] 🖱️ Fallback canvas click hit:', id);
        setSelectedEntityId(id);
        setHoveredBodyId(id);
      } else {
        // eslint-disable-next-line no-console
        console.log('[SimulationInteraction] 🖱️ Fallback canvas click empty');
      }
    };
    const hostClickHandler = (e: MouseEvent) => {
      if (!editingEnabled || playing) return;
      const rect = hostElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const bodies = Matter.Composite.allBodies(engine.world);
      const hit = pickBodyAtPoint({ x, y } as Matter.Vector, bodies);
      if (hit) {
        const id = hit.label || hit.id?.toString() || 'unknown';
        console.log('[SimulationInteraction] 🖱️ Host fallback click hit:', id);
        setSelectedEntityId(id);
        setHoveredBodyId(id);
      } else {
        console.log('[SimulationInteraction] 🖱️ Host fallback click empty');
      }
    };
    canvasEl.addEventListener('click', fallbackClick);
    if (hostElement !== canvasEl && !(hostElement as any).__hostClickAttached) {
      hostElement.addEventListener('click', hostClickHandler);
      (hostElement as any).__hostClickAttached = true;
    }

    // Manual drag fallback (if Matter mouseConstraint doesn't emit startdrag)
    const pointerDown = (e: PointerEvent) => {
      if (!editingEnabled || playing) return;
      if (mouseConstraintDragStarted) return; // MouseConstraint will handle
      const rect = (primaryElement.getBoundingClientRect());
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const bodies = Matter.Composite.allBodies(engine.world);
      const hit = pickBodyAtPoint({ x, y } as Matter.Vector, bodies);
      if (!hit) return;
      
      // IMMEDIATELY activate manual drag using dragStateRef (survives render & canvas recreation)
      dragStateRef.current.manualDragBody = hit;
      dragStateRef.current.manualDragOffset = { x: x - hit.position.x, y: y - hit.position.y };
      manualDragBody = hit;
      manualDragOffset = dragStateRef.current.manualDragOffset;
      
      const id = hit.label || hit.id?.toString() || 'unknown';
      console.log('[SimulationInteraction] 🛠️ Manual drag ACTIVATED immediately:', id, 'renderID=', (render as any).__canvasIdentifier);
      
      if (manualDragBody.isStatic) {
        (manualDragBody as any).__wasStaticManual = true;
        Matter.Body.setStatic(manualDragBody, false);
      }
      (manualDragBody as any).__activelyDragging = true;
      
      // Update activation state via ref ONLY (no setState to avoid canvas recreation)
      activatedBodyIdRef.current = id;
      activationTimestampRef.current = performance.now();
      
      // DON'T call setActivatedBodyId - it causes canvas recreation!
      // If activation flash is needed, renderer should read from activatedBodyIdRef
    };

    const pointerMove = (e: PointerEvent) => {
      // ALWAYS read from dragStateRef (survives render & canvas recreation)
      const currentManualDragBody = dragStateRef.current.manualDragBody;
      const currentManualDragOffset = dragStateRef.current.manualDragOffset;
      
      // Debug: log first few calls to verify it's being called
      if (!(render as any).__pointerMoveCallCount) (render as any).__pointerMoveCallCount = 0;
      if ((render as any).__pointerMoveCallCount < 3) {
        console.log('[SimulationInteraction] 🎯 pointerMove entry', {
          hasBody: !!currentManualDragBody,
          hasOffset: !!currentManualDragOffset,
          bodyId: currentManualDragBody?.label || currentManualDragBody?.id,
          mcStarted: mouseConstraintDragStarted,
          renderCanvasId: (render as any).__canvasIdentifier || 'unknown',
          targetTag: (e.currentTarget as HTMLElement)?.tagName,
          targetIsCanvas: e.currentTarget === canvasEl
        });
        (render as any).__pointerMoveCallCount++;
      }
      
      if (!currentManualDragBody || !currentManualDragOffset || mouseConstraintDragStarted) {
        return;
      }
      const rect = primaryElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const newX = x - currentManualDragOffset.x;
      const newY = y - currentManualDragOffset.y;
      Matter.Body.setPosition(currentManualDragBody, { x: newX, y: newY });
      // Debug pointer move trace
      if ((currentManualDragBody as any).__debugPointerMovesLogged === undefined) {
        (currentManualDragBody as any).__debugPointerMovesLogged = 0;
      }
      if ((currentManualDragBody as any).__debugPointerMovesLogged < 10) {
        console.log('[SimulationInteraction] ✋ manual pointerMove', { id: currentManualDragBody.label || currentManualDragBody.id, x: newX, y: newY });
        (currentManualDragBody as any).__debugPointerMovesLogged++;
      }
      
      // DON'T update scene state during drag - causes canvas recreation!
      // Matter body position is enough for visual feedback.
      // Scene will be synced to backend on pointerUp.
      
      // Force immediate render for visual feedback
      try { Matter.Render.world(render as Matter.Render); } catch {}
    };

    const pointerUp = async (e?: PointerEvent) => {
      console.log('[SimulationInteraction] 🆙 pointerUp CALLED', {
        pointerId: e?.pointerId,
        currentTarget: (e?.currentTarget as HTMLElement)?.tagName,
        hasBody: !!dragStateRef.current.manualDragBody
      });
      
      // Release pointer capture from the element that captured it
      if (e && e.currentTarget) {
        try {
          (e.currentTarget as Element).releasePointerCapture(e.pointerId);
          console.log('[SimulationInteraction] 📌 Pointer released:', e.pointerId);
        } catch {}
      }
      
      // ALWAYS read from dragStateRef
      const currentManualDragBody = dragStateRef.current.manualDragBody;
      
      if (!currentManualDragBody || mouseConstraintDragStarted) {
        dragStateRef.current.manualDragBody = null;
        dragStateRef.current.manualDragOffset = null;
        return;
      }
      const body = currentManualDragBody;
      const id = body.label || body.id?.toString() || 'unknown';
      // eslint-disable-next-line no-console
      console.log('[SimulationInteraction] 🛠️ Manual fallback drag END:', id, { x: body.position.x, y: body.position.y });
      if ((body as any).__wasStaticManual) {
        Matter.Body.setStatic(body, true);
        delete (body as any).__wasStaticManual;
      }
      if ((body as any).__activelyDragging) {
        delete (body as any).__activelyDragging;
      }
      // Freeze motion (but DON'T sleep - it makes bodies transparent!)
      try {
        Matter.Body.setVelocity(body, { x: 0, y: 0 });
        Matter.Body.setAngularVelocity(body, 0);
        body.force.x = 0; body.force.y = 0; body.torque = 0;
        // (Matter as any).Sleeping?.set?.(body, true);  ← REMOVED: causes transparency
        (body as any).__needsPostDragSnap = true;
      } catch {}
      // Reset mouseConstraint (avoid latent influence when fallback used)
      try {
        const mc = (render as any).__interactionMouseConstraint as Matter.MouseConstraint | undefined;
        if (mc) {
          (mc as any).body = null;
          if ((mc as any).constraint) {
            (mc as any).constraint.stiffness = 0.2;
            (mc as any).constraint.pointA = { x: 0, y: 0 };
          }
        }
      } catch {}
      // NEW: Force dynamic bodies to temporary static for stability
      if (!(body as any).__originallyStatic && !body.isStatic) {
        (body as any).__tempPostDragStatic = true;
        Matter.Body.setStatic(body, true);
      }
      if (!Number.isFinite(body.position.x) || !Number.isFinite(body.position.y)) {
        dragStateRef.current.manualDragBody = null;
        dragStateRef.current.manualDragOffset = null;
        return;
      }
      const newPosition: [number, number] = [
        (body.position.x - activeTransform.originPx[0]) * activeTransform.pixelsToMeters,
        (activeTransform.originPx[1] - body.position.y) * activeTransform.pixelsToMeters,
      ];
      
      console.log('[SimulationInteraction] 🎯 Final drag position:', id, {
        pixelPos: { x: body.position.x, y: body.position.y },
        meterPos: newPosition
      });
      
      // DON'T update local scene state - it triggers canvas recreation!
      // The Matter body is already at the correct position.
      // We mark the scene as modified so it won't be regenerated.
      
      // Mark scene as modified (for skip logic) - USE REF ONLY, no setState!
      sceneModifiedRef.current = true;
      
      // DO NOT call updateBodyLocal() - it calls setScene() which triggers canvas recreation!
      // The Matter body is already positioned correctly from pointerMove.
      // Position will be persisted when backend sync completes or when scene is saved.
      console.log('[SimulationInteraction] 💾 Matter body already positioned, marked scene as modified');
      
      // Backend sync (async, in parallel)
      if (globalConversationId && debouncedBackendSyncRef.current) {
        console.log('[SimulationInteraction] 🔄 Syncing to backend:', id, newPosition);
        debouncedBackendSyncRef.current.debouncedUpdate({ [id]: { position_m: newPosition } });
        debouncedBackendSyncRef.current.flush()
          .then(() => {
            console.log('[SimulationInteraction] ✅ Backend sync complete, now updating scene state');
            // Update scene state AFTER backend sync to persist position
            updateBodyLocal(id, { position_m: newPosition });
          })
          .catch((e) => {
            console.error('[SimulationInteraction] Manual backend sync failed', e);
            // Still update scene state to persist position locally
            console.log('[SimulationInteraction] 💾 Updating scene state despite backend error');
            updateBodyLocal(id, { position_m: newPosition });
          });
      } else {
        console.log('[SimulationInteraction] ⚠️ No backend sync available:', {
          hasConversationId: !!globalConversationId,
          hasSyncRef: !!debouncedBackendSyncRef.current
        });
        // No backend sync, but we still need to persist the position eventually
        // Delay the scene update to avoid immediate canvas recreation
        setTimeout(() => {
          console.log('[SimulationInteraction] 💾 Delayed scene state update (no backend)');
          updateBodyLocal(id, { position_m: newPosition });
        }, 100);
      }
      
      dragStateRef.current.manualDragBody = null;
      dragStateRef.current.manualDragOffset = null;
      
      // Clear activation state via ref only
      activatedBodyIdRef.current = null;
      // DON'T call setActivatedBodyId(null) - causes canvas recreation!
      
      console.log('[SimulationInteraction] ✅ Drag complete for:', id, '(Matter body preserved)');
    };

    const canvasPointerDown = (e: PointerEvent) => {
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch (err) {
        console.warn('[SimulationInteraction] ⚠️ Capture failed:', err);
      }
      pointerDown(e);
    };
    const hostPointerDown = (e: PointerEvent) => {
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch (err) {
        console.warn('[SimulationInteraction] ⚠️ Capture failed:', err);
      }
      if (!mouseConstraintDragStarted) pointerDown(e);
    };
    const containerPointerDown = (e: PointerEvent) => {
      console.log('[SimulationInteraction] 🧲 pointerdown container', {
        targetTag: (e.currentTarget as HTMLElement)?.tagName,
        targetIsCanvas: e.currentTarget === canvasEl,
        targetIsPrimary: e.currentTarget === primaryElement
      });
      // Capture pointer IMMEDIATELY in the event handler on the element that received the event
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        console.log('[SimulationInteraction] ✅ Pointer captured on', (e.currentTarget as HTMLElement)?.tagName);
      } catch (err) {
        console.warn('[SimulationInteraction] ⚠️ Capture failed:', err);
      }
      if (!mouseConstraintDragStarted) pointerDown(e);
    };
    if (!(canvasEl as any).__canvasPointerAttached) {
      canvasEl.addEventListener('pointerdown', canvasPointerDown);
      (canvasEl as any).__canvasPointerAttached = true;
    }
    if (hostElement !== canvasEl && !(hostElement as any).__hostPointerAttached) {
      hostElement.addEventListener('pointerdown', hostPointerDown);
      (hostElement as any).__hostPointerAttached = true;
    }
    if (primaryElement !== hostElement && primaryElement !== canvasEl && !(primaryElement as any).__containerPointerAttached) {
      primaryElement.addEventListener('pointerdown', containerPointerDown);
      (primaryElement as any).__containerPointerAttached = true;
    }
    
    // Attach pointermove/pointerup - ALWAYS attach (cleanup will remove)
    canvasEl.addEventListener('pointermove', pointerMove, { capture: true });
    canvasEl.addEventListener('pointerup', pointerUp, { capture: true });
    console.log('[SimulationInteraction] 📎 Attached pointermove/up to canvas');
    
    if (primaryElement !== canvasEl) {
      primaryElement.addEventListener('pointermove', pointerMove, { capture: true });
      primaryElement.addEventListener('pointerup', pointerUp, { capture: true });
      console.log('[SimulationInteraction] 📎 Attached pointermove/up to primaryElement');
    }

    return () => {
      console.log('[SimulationInteraction] 🧹 Cleanup started', {
        editingEnabled,
        playing,
        hasManualDragBody: !!dragStateRef.current.manualDragBody
      });
      
      Matter.Events.off(mouseConstraint, 'mousedown', mousedownHandler);
      Matter.Events.off(mouseConstraint, 'mousemove', mousemoveHover);
      Matter.Events.off(mouseConstraint, 'startdrag', startDrag);
      Matter.Events.off(mouseConstraint, 'enddrag', endDrag);
      Matter.Events.off(mouseConstraint, 'mousemove', mousemoveDragStatic);
      
      // NEVER clear drag state during cleanup - it survives across re-renders
      // Only clear when truly leaving edit mode
      const leavingEditMode = !(editingEnabled && !playing);
      const isCurrentlyDragging = !!dragStateRef.current.manualDragBody;
      
      if (leavingEditMode && !isCurrentlyDragging) {
        console.log('[SimulationInteraction] 🧹 Full cleanup: leaving edit mode');
        try { Matter.World.remove(engine.world, mouseConstraint); } catch {}
        (render as any).__interactionMouseConstraint = undefined;
        dragStateRef.current.manualDragBody = null;
        dragStateRef.current.manualDragOffset = null;
        (render as any).__manualDragPendingBody = null;
        (render as any).__manualDragPendingOffset = null;
        (render as any).__manualDragActivationTimer = null;
      } else if (isCurrentlyDragging) {
        console.log('[SimulationInteraction] 🚫 Preserving drag state across re-render');
      }
      try { render.canvas.removeEventListener('click', fallbackClick); } catch {}
      if ((hostElement as any).__hostClickAttached) {
        try { hostElement.removeEventListener('click', hostClickHandler); } catch {}
        delete (hostElement as any).__hostClickAttached;
      }
      if ((canvasEl as any).__canvasPointerAttached) {
        try { canvasEl.removeEventListener('pointerdown', canvasPointerDown); } catch {}
        delete (canvasEl as any).__canvasPointerAttached;
      }
      if ((hostElement as any).__hostPointerAttached) {
        try { hostElement.removeEventListener('pointerdown', hostPointerDown); } catch {}
        delete (hostElement as any).__hostPointerAttached;
      }
      if ((primaryElement as any).__containerPointerAttached) {
        try { primaryElement.removeEventListener('pointerdown', containerPointerDown); } catch {}
        delete (primaryElement as any).__containerPointerAttached;
      }
      
      // ALWAYS remove pointermove/pointerup (will be re-attached on next effect run)
      try { 
        canvasEl.removeEventListener('pointermove', pointerMove, { capture: true } as any);
        canvasEl.removeEventListener('pointerup', pointerUp, { capture: true } as any);
      } catch {}
      
      if (primaryElement !== canvasEl) {
        try { 
          primaryElement.removeEventListener('pointermove', pointerMove, { capture: true } as any);
          primaryElement.removeEventListener('pointerup', pointerUp, { capture: true } as any);
        } catch {}
      }
      // Only clear timers if leaving edit mode; otherwise preserve across effect re-run
      if (!(editingEnabled && !playing)) {
        if (manualDragActivationTimer !== null) {
          clearTimeout(manualDragActivationTimer);
        }
        manualDragActivationTimer = null;
        manualDragPendingBody = null;
        manualDragPendingOffset = null;
        manualDragBody = null;
        manualDragOffset = null;
      }
      // Attempt to remove freeze handler if still attached
      if (draggedBody && (draggedBody as any).__freezeHandler) {
        try { Matter.Events.off(engine as Matter.Engine, 'beforeUpdate', (draggedBody as any).__freezeHandler); } catch {}
        delete (draggedBody as any).__freezeHandler;
      }
    };
  // Trimmed dependency list: only core toggles that require (re)initialization.
  }, [engine, render, scene, editingEnabled, playing]);

  return null;
}

export default SimulationInteraction;