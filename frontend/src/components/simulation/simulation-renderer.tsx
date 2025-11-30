import { useEffect, useRef, useState } from 'react';
import Matter from 'matter-js';
import { enforcePulleyConstraints } from '@/simulation/matterRunner';

// 🎨 스타일 상수 정의
const THEME = {
  PULLEY: {
    ROPE_COLOR: '#6b7280',
    ROPE_WIDTH: 2,
    WHEEL_COLOR: '#374151',
    WHEEL_WIDTH: 3,
  },
  BODY: {
    STATIC: '#3b82f6',
    DYNAMIC: '#10b981',
    SELECTED: '#f59e0b',
    ACTIVATED: 'rgba(168, 85, 247, 1)',
  },
  CANVAS: {
    BACKGROUND: 'transparent',
    PIXEL_RATIO: 1,
  }
} as const;

const GET_PIXEL_RATIO = () => {
    return typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
};

interface SimulationRendererProps {
  engineRef: React.MutableRefObject<Matter.Engine | null>;
  engine: Matter.Engine | null; // [FIX] Direct engine prop to trigger useEffect
  constraints: ReadonlyArray<any>; // [FIX] ReadonlyArray to prevent mutations
  scale: number; // [FIX] Primitive number only, no transform object
  width: number;
  height: number;
  playing: boolean;
  pointerEnabled: boolean;
  hoveredBodyId: string | null;
  selectedBodyId: string | null;
  activatedBodyIdRef: React.MutableRefObject<string | null>;
  activationTimestampRef: React.MutableRefObject<number>;
  pulleyConstraintsRef: React.MutableRefObject<ReadonlyArray<any>>; // [FIX] ReadonlyArray
  onRenderCreated?: (render: Matter.Render) => void;
}

export default function SimulationRenderer({
  engineRef,
  engine,
  constraints,
  scale,
  width,
  height,
  playing,
  pointerEnabled,
  hoveredBodyId,
  selectedBodyId,
  activatedBodyIdRef,
  activationTimestampRef,
  pulleyConstraintsRef,
  onRenderCreated,
}: SimulationRendererProps) {
  console.log('[SimulationRenderer] 🚀 Component CALLED with:', { width, height, playing, scale, constraintsCount: constraints?.length, hasEngine: !!engine });
  
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  
  const [activeRender, setActiveRender] = useState<Matter.Render | null>(null);

  // [FIX] Ref Bridge Pattern: Sync frequently changing props to ref
  // This prevents canvas recreation when hover/selection changes
  const propsRef = useRef({
    hoveredBodyId,
    selectedBodyId,
    constraints: constraints || [],
    scale,
  });

  useEffect(() => {
    propsRef.current = {
      hoveredBodyId,
      selectedBodyId,
      constraints: constraints || [],
      scale,
    };
  }, [hoveredBodyId, selectedBodyId, constraints, scale]);

  // 1. Canvas 생성 Effect
  useEffect(() => {
    const host = hostRef.current;
    
    console.log('[SimulationRenderer] 🔍 Canvas creation useEffect triggered:', {
      hasHost: !!host,
      hasEngine: !!engine,
      width,
      height,
      hasActiveRender: !!activeRender,
    });
    
    // 크기가 유효할 때만 생성
    if (!host || !engine || width <= 0 || height <= 0) {
      console.log('[SimulationRenderer] ⚠️ Early return from canvas creation:', {
        host: !!host,
        engine: !!engine,
        width,
        height,
      });
      return;
    }

    // 기존 렌더러 정리
    if (activeRender) {
      try {
        Matter.Render.stop(activeRender);
        activeRender.canvas.remove();
        activeRender.textures = {};
      } catch {}
      setActiveRender(null);
    }

    const pixelRatio = GET_PIXEL_RATIO();

    const render = Matter.Render.create({
      element: host,
      engine,
      options: {
        width,
        height,
        background: 'transparent',
        wireframes: false,
        pixelRatio: pixelRatio,
      },
    });

    render.canvas.style.width = '100%';
    render.canvas.style.height = '100%';
    render.canvas.style.pointerEvents = pointerEnabled ? 'auto' : 'none';

    render.bounds.min.x = 0;
    render.bounds.max.x = width;
    render.bounds.min.y = 0;
    render.bounds.max.y = height;
    render.options.hasBounds = true;
    render.options.wireframes = false;

    console.log('[SimulationRenderer] 🎨 Canvas created:', {
      width,
      height,
      canvasElement: render.canvas,
      canvasInDOM: document.contains(render.canvas),
    });

    // [중요] State 업데이트 -> 애니메이션 루프 Effect를 트리거함
    setActiveRender(render);
    
    onRenderCreated?.(render);

    // afterRender overlays setup
    const afterRender = () => {
      if (!engine || !render.context) return; 
      
      const ctx = render.context as CanvasRenderingContext2D;
      const bodies = Matter.Composite.allBodies(engine.world);
      
      // [DEBUG] Log body count and positions on first render
      if (!(render as any).__debugLogged) {
        (render as any).__debugLogged = true;
        console.log('[SimulationRenderer] 🔍 Bodies in world:', bodies.length);
        bodies.forEach(b => {
          console.log(`  - ${(b as any).label || b.id}: pos=(${b.position.x.toFixed(1)}, ${b.position.y.toFixed(1)}), static=${b.isStatic}`);
        });
        console.log('[SimulationRenderer] 🖼️ Canvas bounds:', {
          width: render.options.width,
          height: render.options.height,
          bounds: render.bounds,
        });
      }
      
      // [FIX] Read from propsRef to get latest values without recreation
      const { hoveredBodyId, selectedBodyId, constraints, scale } = propsRef.current;

      // Draw pulley ropes
      if (constraints && Array.isArray(constraints)) {
        try {
          constraints.forEach((constraint: any) => {
            if (constraint.type !== 'ideal_fixed_pulley') return;
            const bodyA = bodies.find(b => (b as any).label === constraint.body_a);
            const bodyB = bodies.find(b => (b as any).label === constraint.body_b);
            if (!bodyA || !bodyB) return;

            const anchor = constraint.pulley_anchor_m;
            if (!anchor || !Array.isArray(anchor) || anchor.length < 2) return;
            
            const anchorX = Number(anchor[0]);
            const anchorY = Number(anchor[1]);
            
            if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return;

            ctx.strokeStyle = THEME.PULLEY.ROPE_COLOR;
            ctx.lineWidth = THEME.PULLEY.ROPE_WIDTH;
            ctx.setLineDash([4, 2]);
            ctx.beginPath();
            ctx.moveTo(bodyA.position.x, bodyA.position.y);
            ctx.lineTo(anchorX, anchorY);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(anchorX, anchorY);
            ctx.lineTo(bodyB.position.x, bodyB.position.y);
            ctx.stroke();

            const wheelRadius = constraint.wheel_radius_m || 0.1;
            const wheelRadiusPixels = wheelRadius * scale;
            ctx.setLineDash([]);
            ctx.strokeStyle = THEME.PULLEY.WHEEL_COLOR;
            ctx.lineWidth = THEME.PULLEY.WHEEL_WIDTH;
            ctx.beginPath();
            ctx.arc(anchorX, anchorY, wheelRadiusPixels, 0, 2 * Math.PI);
            ctx.stroke();
            ctx.setLineDash([]);
          });
        } catch (e) {
          console.error('Error drawing pulley:', e);
        }
      }

      // Hover highlight
      if (hoveredBodyId) {
        const hoveredBody = bodies.find(b => (b as any).label === hoveredBodyId);
        if (hoveredBody) {
          ctx.strokeStyle = hoveredBody.isStatic ? THEME.BODY.STATIC : THEME.BODY.DYNAMIC;          
          ctx.lineWidth = 2;
          ctx.beginPath();
          const vertices = hoveredBody.vertices;
          ctx.moveTo(vertices[0].x, vertices[0].y);
          for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y);
          ctx.closePath();
          ctx.stroke();
        }
      }

      // Selected highlight
      if (selectedBodyId) {
        const selectedBody = bodies.find(b => (b as any).label === selectedBodyId);
        if (selectedBody) {
          ctx.strokeStyle = THEME.BODY.SELECTED;
          ctx.lineWidth = 3;
          ctx.beginPath();
          const vertices = selectedBody.vertices;
          ctx.moveTo(vertices[0].x, vertices[0].y);
          for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y);
          ctx.closePath();
          ctx.stroke();
        }
      }

      // Activation flash
      const currentActivatedBodyId = activatedBodyIdRef.current;
      const currentActivationTimestamp = activationTimestampRef.current;
      
      if (currentActivatedBodyId) {
        const activatedBody = bodies.find(b => (b as any).label === currentActivatedBodyId);
        if (activatedBody) {
          const elapsed = performance.now() - currentActivationTimestamp;
          const flashDuration = 500; // ms
          if (elapsed < flashDuration) {
            const opacity = 1 - (elapsed / flashDuration);
            ctx.strokeStyle = `rgba(168, 85, 247, ${opacity})`;
            ctx.lineWidth = 4;
            ctx.beginPath();
            const vertices = activatedBody.vertices;
            ctx.moveTo(vertices[0].x, vertices[0].y);
            for (let i = 1; i < vertices.length; i++) ctx.lineTo(vertices[i].x, vertices[i].y);
            ctx.closePath();
            ctx.stroke();
          }
        }
      }
    };

    Matter.Events.on(render, 'afterRender', afterRender);

    return () => {
      try {
        Matter.Events.off(render, 'afterRender', afterRender);
        Matter.Render.stop(render);
        render.canvas.remove();
        render.textures = {};
      } catch {}
      setActiveRender(null);
    };
    // [FIX] engine prop triggers re-execution when engine is created
  }, [engine, width, height]);

  // 2. Pointer Events만 관리하는 Effect
  useEffect(() => {
    if (activeRender) {
      activeRender.canvas.style.pointerEvents = pointerEnabled ? 'auto' : 'none';
    }
  }, [pointerEnabled, activeRender]);

  // 3. Animation loop (State인 activeRender에 의존)
  useEffect(() => {
    // [핵심] activeRender가 준비되지 않았으면 루프를 시작하지 않음
    if (!engineRef.current || !activeRender) return;
    
    const engine = engineRef.current;
    // Closure 내부에서 사용할 렌더러 인스턴스 캡처
    const currentRender = activeRender;

    let lastTime = performance.now();
    let frameCount = 0;
    let lastLogTime = performance.now();

    const tick = (now: number) => {
      // [DEBUG] Log first tick
      if (frameCount === 0) {
        console.log('[SimulationRenderer] 🎬 Animation loop started, playing:', playing);
      }
      
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      frameCount++;

      if (playing) {
        Matter.Engine.update(engine, dt * 1000);
        const pulleyConstraints = pulleyConstraintsRef.current;
        if (pulleyConstraints && pulleyConstraints.length > 0) {
          // [FIX] Convert ReadonlyArray to mutable array for enforcePulleyConstraints
          enforcePulleyConstraints([...pulleyConstraints]);
        }
        
        if (now - lastLogTime >= 5000) {
          console.log('[SimulationRenderer] 🎬 Physics running (frame', frameCount, ')');
          lastLogTime = now;
        }
      } else {
        const mc: any = (currentRender as any)?.__interactionMouseConstraint;
        const manualBody: Matter.Body | null = (currentRender as any)?.__manualDragBody || null;
        
        // 마우스 클릭 상태 확인
        const isMouseDown = mc?.mouse && mc.mouse.button !== -1;
        const dragActive = !!(mc && mc.body) || isMouseDown || !!manualBody;
        
        if (dragActive) {
          Matter.Engine.update(engine, 16); 
        } else {
          // Idle 상태 미세 움직임 제거
          if (frameCount % 30 === 0) { 
            try {
              const bodies = Matter.Composite.allBodies(engine.world);
              for (const b of bodies) {
                if (Math.abs(b.velocity.x) > 0.001 || Math.abs(b.velocity.y) > 0.001 || Math.abs(b.angularVelocity) > 0.001) {
                  Matter.Body.setVelocity(b, { x: 0, y: 0 });
                  Matter.Body.setAngularVelocity(b, 0);
                  b.force.x = 0; b.force.y = 0; b.torque = 0;
                }
              }
            } catch {}
          }
        }
      }
      
      // [핵심] 캡처된 렌더러 인스턴스를 사용해 그리기
      Matter.Render.world(currentRender);
      
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // [핵심] activeRender가 변경되면 루프를 재시작함
  }, [engineRef, playing, pulleyConstraintsRef, activeRender]);

  console.log('[SimulationRenderer] 📦 Returning JSX, hostRef.current:', hostRef.current);
  
  return (
    <div
      ref={hostRef}
      className="absolute inset-0"
      style={{ pointerEvents: pointerEnabled ? 'auto' : 'none', zIndex: 10 }}
    />
  );
}