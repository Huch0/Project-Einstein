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
  constraints: any[];
  scale: number;
  width: number;
  height: number;
  playing: boolean;
  pointerEnabled: boolean;
  hoveredBodyId: string | null;
  selectedBodyId: string | null;
  activatedBodyIdRef: React.MutableRefObject<string | null>;
  activationTimestampRef: React.MutableRefObject<number>;
  pulleyConstraintsRef: React.MutableRefObject<any[]>;
  onRenderCreated?: (render: Matter.Render) => void;
}

export default function SimulationRenderer({
  engineRef,
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  
  // [핵심 해결책] 렌더러가 준비되었음을 알리는 State 추가
  const [activeRender, setActiveRender] = useState<Matter.Render | null>(null);

  // Store constraints in ref
  const constraintsRef = useRef<any[]>(constraints || []);
  useEffect(() => {
    constraintsRef.current = constraints || [];
  }, [constraints]);

  // 1. Canvas 생성 Effect
  useEffect(() => {
    const host = hostRef.current;
    const engine = engineRef.current; 
    // 크기가 유효할 때만 생성
    if (!host || !engine || width <= 0 || height <= 0) return;

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

    // [중요] State 업데이트 -> 애니메이션 루프 Effect를 트리거함
    setActiveRender(render);
    
    onRenderCreated?.(render);

    // afterRender overlays setup
    const afterRender = () => {
      if (!engine) return; 
      
      const ctx = render.context as CanvasRenderingContext2D;
      const bodies = Matter.Composite.allBodies(engine.world);
      const currentConstraints = constraintsRef.current;

      // Draw pulley ropes
      if (currentConstraints && Array.isArray(currentConstraints)) {
        try {
          currentConstraints.forEach((constraint: any) => {
            if (constraint.type !== 'ideal_fixed_pulley') return;
            const bodyA = bodies.find(b => (b as any).label === constraint.body_a);
            const bodyB = bodies.find(b => (b as any).label === constraint.body_b);
            if (!bodyA || !bodyB) {
              return;
            }

            // Find pulley body by label (should contain 'pulley' in name)
            const pulleyBody = bodies.find(b => {
              const label = (b as any).label;
              return label && (label.toLowerCase().includes('pulley') || label === 'pulley1');
            });
            
            if (!pulleyBody) {
              return;
            }
            
            // Use live pulley body position (always synced with Matter.js)
            const anchorX = pulleyBody.position.x;
            const anchorY = pulleyBody.position.y;

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
    // 의존성 배열에서 pointerEnabled를 제거하여 Edit 토글 시 재생성 방지
  }, [engineRef, width, height, hoveredBodyId, selectedBodyId, activatedBodyIdRef, activationTimestampRef, onRenderCreated]);

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
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      frameCount++;

      if (playing) {
        Matter.Engine.update(engine, dt * 1000);
        const constraints = pulleyConstraintsRef.current;
        if (constraints && constraints.length > 0) enforcePulleyConstraints(constraints);
        
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

  return (
    <div
      ref={hostRef}
      className="absolute inset-0"
      style={{ pointerEvents: pointerEnabled ? 'auto' : 'none', zIndex: 10 }}
    />
  );
}