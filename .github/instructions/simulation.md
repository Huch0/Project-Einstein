# Interactive Physics Simulation Instructions

## 🎯 최종 목표 (v0.6 - Unified Editing Mode)

┌─────────────────────────────────────────────────────────────────┐
│                    SimulationContext (State 관리)                │
│  - playing: boolean (재생 상태)                                  │
│  - editingEnabled: boolean (편집 모드)                           │
│  - scene: 물리 Scene 데이터                                      │
│  - frames: 시뮬레이션 프레임 배열                                 │
└──────────────────┬──────────────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                   SimulationLayer (렌더링 + 물리)                │
│                                                                   │
│  useEffect #1: Matter.js Scene 초기화                            │
│    - renderScene 변경 시 실행                                    │
│    - initializeMatterScene() → Matter.js 엔진 생성               │
│    ❌ 문제: scene이 존재하면 무조건 시뮬레이션 준비 완료          │
│                                                                   │
│  useEffect #2: MouseConstraint 관리 ⭐ 핵심                       │
│    - editingEnabled && !playing → MouseConstraint 추가           │
│    - else → MouseConstraint 제거                                 │
│    ✅ 편집 모드 토글 시 정상 동작                                │
│                                                                   │
│  useEffect #3: Interactive Physics Loop 🔴 문제 발생!            │
│    Dependencies: [playing, scene, editingEnabled]                │
│                                                                   │
│    const animate = (currentTime) => {                            │
│      if (playing) {                                              │
│        Matter.Engine.update(engine, deltaTime * 1000);           │
│      } else if (editingEnabled) {  ← 🔥 여기가 문제!            │
│        Matter.Engine.update(engine, 16); // ~60fps               │
│      }                                                            │
│      Matter.Render.world(render);                                │
│      requestAnimationFrame(animate);                             │
│    }                                                              │
│                                                                   │
│  ❌ 문제 발견:                                                   │
│    - editingEnabled=true일 때도 Matter.Engine.update() 실행     │
│    - gravity가 적용되어 블록이 떨어짐!                           │
│    - "편집 = 정지 상태"가 아니라 "편집 = 저속 시뮬레이션"        │
└─────────────────────────────────────────────────────────────────┘
                   │
                   ↓
┌─────────────────────────────────────────────────────────────────┐
│                    ParametersPanel (UI Controls)                 │
│  - Edit 버튼 클릭 → setEditingEnabled(true)                      │
│  - 사용자 기대: 블록이 정지된 상태에서 편집                       │
│  - 실제 동작: editingEnabled=true → useEffect #3 실행            │
│             → Matter.Engine.update(engine, 16) 호출              │
│             → gravity 적용되어 블록이 떨어짐 💥                  │
└─────────────────────────────────────────────────────────────────┘

시뮬레이션 박스에서:
1. **시뮬레이션 정지 시** → 모든 객체를 클릭/드래그하여 편집 가능
2. **객체 클릭** → Simulation Controls 패널에 해당 객체의 파라미터 표시
3. **파라미터 조절** → Position, Mass, Friction 등을 실시간 변경
4. **객체 드래그** → 마우스로 위치 조절
5. **Constraint 인식** → Rope 등으로 연결된 객체는 함께 움직임
6. **Backend 동기화** → 모든 변경사항이 자동으로 저장
7. **시뮬레이션 재생 시** → 편집 불가, 재생만 가능

**핵심 변경사항:**
- ❌ Playback / Interactive 모드 구분 제거
- ✅ Playing 상태에 따라 자동 전환: 정지 시 = 편집 가능, 재생 시 = 편집 불가
- ✅ MouseConstraint를 playing 상태에 따라 동적으로 추가/제거

---

## � 현재 시스템 구조 분석

### 기존 컴포넌트 구조
```
SimulationBox (simulation-box.tsx)
  ├── SimulationViewer (simulation-viewer.tsx)
  │   └── SimulationLayer (simulation-layer.tsx)
  │       └── Matter.js Canvas (실시간 렌더링)
  └── ParametersPanel (parameters-panel.tsx)
      ├── Scope: Global (전역 설정)
      └── Scope: Entity (개별 엔티티)
          └── Entity Selector (드롭다운)
```

### ParametersPanel의 현재 기능
```typescript
// parameters-panel.tsx
- ✅ Simulation Box 선택 (여러 박스 지원)
- ✅ Mode Toggle: Playback vs Interactive
- ✅ Scope Toggle: Global vs Entity
- ✅ Entity Selector: 드롭다운으로 선택
- ✅ Entity Parameters: mass, friction 등 조절 가능
- ✅ Backend Sync: updateBody() API 호출
```

### SimulationLayer의 현재 기능
```typescript
// simulation-layer.tsx
- ✅ Matter.js Engine 실시간 업데이트
- ✅ MouseConstraint 추가됨
- ⚠️ Static body 드래그 방지 (수정 필요)
- ❌ 클릭 시 ParametersPanel과 연동 없음
```

---

## 🔍 핵심 요구사항 재분석

### 1. 클릭 → 파라미터 패널 연동
**현재 문제:**
- ParametersPanel은 드롭다운으로 엔티티 선택
- SimulationLayer에서 클릭해도 ParametersPanel에 반영 안 됨

**해결 방안:**
```typescript
// SimulationContext에 추가
const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

// SimulationLayer에서 클릭 시
Matter.Events.on(mouseConstraint, 'mousedown', (event) => {
    const body = findBodyAtMouse(event.mouse);
    if (body) {
        setSelectedEntityId(body.label); // Context에 저장
        // ParametersPanel의 scope를 'entity'로 자동 전환
    }
});

// ParametersPanel에서
const { selectedEntityId } = useSimulation();
// selectedEntityId가 변경되면 자동으로 해당 엔티티 선택
```

### 2. 파라미터 조절 → 실시간 반영
**현재 상태:**
- ParametersPanel에서 파라미터 변경 시 `updateBody()` API 호출
- Backend 재시뮬레이션 → frames 재생성
- ⚠️ Interactive mode에서는 Frontend Matter.js와 충돌 가능

**해결 방안:**
```typescript
// Interactive Mode에서는 Frontend Matter.js body 직접 업데이트
if (simulationMode === 'interactive') {
    // 1. Matter.js body 즉시 업데이트
    const body = matterBodyMapRef.current.get(entityId);
    if (body) {
        Matter.Body.setMass(body, newMass);
        body.friction = newFriction;
        // ...
    }
    
    // 2. Backend 동기화 (debounced)
    debouncedBackendSync({ [entityId]: updates });
} else {
    // Playback Mode: Backend 재시뮬레이션
    await updateBody(conversationId, entityId, updates, true);
}
```

### 3. 모든 객체 드래그 가능
**현재 문제:**
- Static body 드래그가 막혀있음
- Constraint를 고려하지 않음

**해결 방안:**
```typescript
// startdrag 시 static body도 일시적으로 dynamic으로 변환
if (body.isStatic) {
    // 상태 저장
    const savedState = {
        position: { x: body.position.x, y: body.position.y },
        angle: body.angle,
    };
    
    // Dynamic으로 변환
    Matter.Body.setStatic(body, false);
    
    // 즉시 복원 (NaN 방지)
    Matter.Body.setPosition(body, savedState.position);
    Matter.Body.setAngle(body, savedState.angle);
    Matter.Body.setMass(body, 1);
    Matter.Body.setVelocity(body, { x: 0, y: 0 });
    
    (body as any).__wasStatic = true;
}

// enddrag 시 복원
if ((body as any).__wasStatic) {
    Matter.Body.setStatic(body, true);
    delete (body as any).__wasStatic;
}

// ✅ Constraint는 Matter.js가 자동으로 처리
// Rope로 연결된 객체는 Matter.js Constraint가 자동으로 따라감
```

### 4. 크기 조절
**복잡도:**
- Matter.js에서 body 크기 변경은 body 재생성 필요
- Constraint가 있는 경우 anchor point도 재계산 필요

**해결 방안 (Phase 2):**
```typescript
// ParametersPanel에서 크기 변경 시
const handleSizeChange = async (entityId: string, newSize: { radius?: number, width?: number, height?: number }) => {
    // Backend로 전송 → Scene 재생성
    await updateBody(conversationId, entityId, {
        collider: {
            type: 'circle',
            radius_m: newSize.radius,
        }
    }, true); // resimulate=true
    
    // Frontend는 새 Scene을 받아서 재렌더링
};
```

---

## 🎨 새로운 아키텍처 설계

### State 흐름
```
SimulationContext
  ├── selectedEntityId: string | null  ← 🆕 추가
  ├── setSelectedEntityId(id)          ← 🆕 추가
  ├── simulationMode: 'playback' | 'interactive'
  └── scene, frames, playing, ...

↓↓↓

SimulationLayer
  ├── MouseConstraint.mousedown
  │   → setSelectedEntityId(body.label)
  ├── MouseConstraint.startdrag
  │   → Static body → Dynamic (임시)
  └── MouseConstraint.enddrag
      → Static 복원 + Backend Sync

↓↓↓

ParametersPanel
  ├── selectedEntityId (Context에서 읽음)
  ├── scope 자동 전환: 'entity' (클릭 시)
  └── Parameter 변경 시
      ├── Interactive: Matter.js 직접 업데이트
      └── Playback: Backend 재시뮬레이션
```

### Context 확장
```typescript
// SimulationContext.tsx
interface SimulationState {
    // ... 기존 필드
    selectedEntityId: string | null;
    setSelectedEntityId: (id: string | null) => void;
    
    // Matter.js body 직접 업데이트 (Interactive Mode)
    updateEntityInFrontend: (entityId: string, updates: {
        position?: [number, number];
        mass?: number;
        friction?: number;
        velocity?: [number, number];
    }) => void;
}
```

---

## 📝 구현 계획 (우선순위)

### Phase 1: SimulationContext 확장 ⭐ 최우선
**파일**: `frontend/src/simulation/SimulationContext.tsx`

**추가할 State:**
```typescript
const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

// Frontend Matter.js body 직접 업데이트 함수
const updateEntityInFrontend = useCallback((
    entityId: string, 
    updates: {
        position?: [number, number];
        mass?: number;
        friction?: number;
        velocity?: [number, number];
    }
) => {
    // SimulationLayer의 matterBodyMapRef에 접근 필요
    // → Ref를 Context에서 관리하거나, callback 등록 패턴 사용
}, []);

// Export에 추가
return {
    // ... 기존 필드
    selectedEntityId,
    setSelectedEntityId,
    updateEntityInFrontend,
};
```

**문제점:**
- `matterBodyMapRef`는 SimulationLayer에 있음
- Context에서 직접 접근 불가

**해결책 A: Callback 등록 패턴**
```typescript
// SimulationContext
const [updateEntityCallback, setUpdateEntityCallback] = useState<((entityId: string, updates: any) => void) | null>(null);

// SimulationLayer에서 등록
useEffect(() => {
    const callback = (entityId: string, updates: any) => {
        const body = matterBodyMapRef.current.get(entityId);
        if (!body) return;
        
        if (updates.position) {
            Matter.Body.setPosition(body, { x: updates.position[0], y: -updates.position[1] });
        }
        if (updates.mass !== undefined) {
            Matter.Body.setMass(body, updates.mass);
        }
        // ...
    };
    
    setUpdateEntityCallback(() => callback);
}, []);
```

**해결책 B: Ref를 Context로 이동**
```typescript
// SimulationContext에서 관리
const matterBodyMapRef = useRef<Map<string, Matter.Body>>(new Map());

// SimulationLayer는 Context의 ref를 사용
const { matterBodyMapRef } = useSimulation();
```

→ **채택: 해결책 A (Callback 패턴)** - 컴포넌트 경계 유지

---

### Phase 2: SimulationLayer - 클릭 이벤트 처리 ⭐ 최우선
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**구현:**
```typescript
const { selectedEntityId, setSelectedEntityId } = useSimulation();

useEffect(() => {
    const mouseConstraint = matterMouseConstraintRef.current;
    if (!mouseConstraint) return;
    
    // 클릭 이벤트 (mousedown)
    Matter.Events.on(mouseConstraint, 'mousedown', (event: any) => {
        const mouse = event.mouse;
        const bodies = Matter.Composite.allBodies(matterEngineRef.current!.world);
        
        const clickedBody = bodies.find(body => 
            Matter.Bounds.contains(body.bounds, mouse.position) &&
            Matter.Vertices.contains(body.vertices, mouse.position)
        );
        
        if (clickedBody) {
            const bodyId = clickedBody.label || clickedBody.id?.toString();
            console.log('[SimulationLayer] Body clicked:', bodyId);
            setSelectedEntityId(bodyId);
        } else {
            // 빈 공간 클릭 시 선택 해제
            setSelectedEntityId(null);
        }
    });
    
    return () => {
        Matter.Events.off(mouseConstraint, 'mousedown');
    };
}, [setSelectedEntityId]);
```

---

### Phase 3: SimulationLayer - 모든 객체 드래그 가능 ⭐ 긴급
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**현재 문제 코드 제거:**
```typescript
// ❌ 제거할 코드
if (body.isStatic) {
    (mouseConstraint as any).body = null;
    return;
}
```

**새로운 구현:**
```typescript
Matter.Events.on(mouseConstraint, 'startdrag', (event: any) => {
    const body = event.body;
    if (!body) return;
    
    draggedBody = body;
    
    if (body.isStatic) {
        // 1. 현재 상태 저장 (NaN 방지)
        const savedState = {
            position: { x: body.position.x, y: body.position.y },
            angle: body.angle,
            velocity: { x: 0, y: 0 },
            angularVelocity: 0,
        };
        
        // 2. Static → Dynamic 변환
        Matter.Body.setStatic(body, false);
        
        // 3. 즉시 복원 (Matter.js 버그 우회)
        Matter.Body.setPosition(body, savedState.position);
        Matter.Body.setAngle(body, savedState.angle);
        Matter.Body.setMass(body, 1); // 드래그를 위한 임시 질량
        Matter.Body.setVelocity(body, savedState.velocity);
        Matter.Body.setAngularVelocity(body, savedState.angularVelocity);
        
        // 4. 플래그 저장
        (body as any).__wasStatic = true;
        
        console.log(`[SimulationLayer] Static body ${body.label} made draggable`);
    } else {
        console.log(`[SimulationLayer] Dynamic body ${body.label} dragging`);
    }
});

Matter.Events.on(mouseConstraint, 'enddrag', async (event: any) => {
    const body = draggedBody;
    if (!body) return;
    
    const bodyId = body.label || body.id?.toString() || 'unknown';
    
    // 1. Static 상태 복원
    if ((body as any).__wasStatic) {
        Matter.Body.setStatic(body, true);
        delete (body as any).__wasStatic;
        console.log(`[SimulationLayer] Static state restored for ${bodyId}`);
    }
    
    // 2. Position 검증
    if (!body.position || !Number.isFinite(body.position.x) || !Number.isFinite(body.position.y)) {
        console.error(`[SimulationLayer] Invalid position for ${bodyId}:`, body.position);
        draggedBody = null;
        return;
    }
    
    // 3. Backend 동기화
    const sceneX = body.position.x;
    const sceneY = -body.position.y; // Y 좌표 반전
    const newPosition: [number, number] = [sceneX, sceneY];
    
    console.log(`[SimulationLayer] ${bodyId} dragged to:`, newPosition);
    
    const conversationId = globalChat.activeBoxId;
    if (conversationId && debouncedBackendSyncRef.current) {
        debouncedBackendSyncRef.current.debouncedUpdate({
            [bodyId]: { position_m: newPosition }
        });
    }
    
    draggedBody = null;
});
```

**핵심 포인트:**
- ✅ Constraint는 Matter.js가 자동 처리 (Rope로 연결된 객체는 함께 움직임)
- ✅ Static body를 일시적으로 dynamic으로 만들어 드래그 가능
- ✅ NaN 문제 해결 (즉시 position/angle 복원)

---

### Phase 4: ParametersPanel - 선택된 엔티티 자동 반영
**파일**: `frontend/src/components/simulation/parameters-panel.tsx`

**현재 문제:**
- 드롭다운으로만 엔티티 선택 가능
- SimulationLayer에서 클릭해도 반영 안 됨

**해결:**
```typescript
const { selectedEntityId: contextSelectedId, setSelectedEntityId } = useSimulation();
const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

// Context의 selectedEntityId가 변경되면 자동 동기화
useEffect(() => {
    if (contextSelectedId !== null) {
        setSelectedEntityId(contextSelectedId);
        setScope('entity'); // 자동으로 Entity scope 전환
    }
}, [contextSelectedId]);

// 드롭다운에서 변경 시 Context에도 반영
const handleEntitySelect = (entityId: string) => {
    setSelectedEntityId(entityId);
    setSelectedEntityId(entityId); // Context에 저장
};
```

---

### Phase 5: ParametersPanel - Interactive Mode 파라미터 업데이트
**파일**: `frontend/src/components/simulation/parameters-panel.tsx`

**현재 문제:**
- 파라미터 변경 시 항상 Backend 재시뮬레이션
- Interactive Mode에서는 Frontend Matter.js 직접 업데이트가 더 자연스러움

**해결:**
```typescript
const { simulationMode, updateEntityInFrontend } = useSimulation();

const handleMassChange = async (bodyId: string, newMass: number) => {
    if (simulationMode === 'interactive') {
        // 1. Frontend Matter.js 즉시 업데이트
        updateEntityInFrontend(bodyId, { mass: newMass });
        
        // 2. Backend 동기화 (debounced, resimulate=false)
        debouncedBackendSync(bodyId, { mass_kg: newMass }, false);
        
        toast({
            title: '✅ Mass Updated',
            description: `Frontend updated instantly`,
        });
    } else {
        // Playback Mode: Backend 재시뮬레이션
        await updateBody(conversationId, bodyId, { mass_kg: newMass }, true);
        
        toast({
            title: '✅ Mass Updated',
            description: `Backend resimulated`,
        });
    }
};

// Position, Friction 등도 동일한 패턴
```

---

### Phase 6: 시각적 피드백 구현
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**마우스 오버 하이라이트:**
```typescript
const [hoveredBodyId, setHoveredBodyId] = useState<string | null>(null);

useEffect(() => {
    const canvas = matterRenderRef.current?.canvas;
    if (!canvas) return;
    
    const handleMouseMove = (e: MouseEvent) => {
        const rect = canvas.getBoundingClientRect();
        const mousePos = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
        
        const bodies = Matter.Composite.allBodies(matterEngineRef.current!.world);
        const hoveredBody = bodies.find(body => 
            Matter.Bounds.contains(body.bounds, mousePos) &&
            Matter.Vertices.contains(body.vertices, mousePos)
        );
        
        if (hoveredBody) {
            setHoveredBodyId(hoveredBody.label);
            canvas.style.cursor = 'grab';
        } else {
            setHoveredBodyId(null);
            canvas.style.cursor = 'default';
        }
    };
    
    canvas.addEventListener('mousemove', handleMouseMove);
    return () => canvas.removeEventListener('mousemove', handleMouseMove);
}, []);

// Render loop에서 하이라이트 적용
useEffect(() => {
    if (!hoveredBodyId && !selectedEntityId) return;
    
    const bodies = Matter.Composite.allBodies(matterEngineRef.current!.world);
    bodies.forEach(body => {
        const bodyId = body.label;
        
        if (bodyId === hoveredBodyId) {
            // Hover: 연한 아웃라인
            body.render.lineWidth = 2;
            body.render.strokeStyle = body.isStatic 
                ? 'rgba(59, 130, 246, 0.6)'  // 파란색
                : 'rgba(34, 197, 94, 0.6)';  // 초록색
        } else if (bodyId === selectedEntityId) {
            // Selected: 진한 아웃라인
            body.render.lineWidth = 3;
            body.render.strokeStyle = 'rgba(234, 179, 8, 1)'; // 노란색
        } else {
            // Default
            body.render.lineWidth = 1;
            body.render.strokeStyle = body.isStatic 
                ? 'rgba(255, 255, 255, 0.3)'
                : '#111827';
        }
    });
}, [hoveredBodyId, selectedEntityId]);
```

---

### Phase 7: 크기 조절 (고급 기능)
**복잡도:** 높음 (Body 재생성 필요)

**간단한 접근 (Backend 재시뮬레이션):**
```typescript
// ParametersPanel
const handleSizeChange = async (entityId: string, newRadius: number) => {
    await updateBody(conversationId, entityId, {
        collider: {
            type: 'circle',
            radius_m: newRadius,
        }
    }, true); // resimulate=true → 새 Scene 생성
    
    toast({
        title: '✅ Size Updated',
        description: 'Scene regenerated with new size',
    });
};
```

**복잡한 접근 (Frontend 재생성):**
```typescript
// Matter.js body 재생성
const recreateBodyWithNewSize = (bodyId: string, newSize: any) => {
    const oldBody = matterBodyMapRef.current.get(bodyId);
    if (!oldBody) return;
    
    // 1. 현재 상태 저장
    const state = {
        position: oldBody.position,
        angle: oldBody.angle,
        velocity: oldBody.velocity,
        // ...
    };
    
    // 2. 기존 body 제거
    Matter.World.remove(engine.world, oldBody);
    
    // 3. 새 body 생성
    const newBody = createBodyWithNewSize(bodyId, newSize, state);
    
    // 4. World에 추가
    Matter.World.add(engine.world, newBody);
    matterBodyMapRef.current.set(bodyId, newBody);
    
    // 5. Constraints 재연결 (복잡!)
    // ...
};
```

→ **Phase 7은 Phase 2로 미룸** (너무 복잡)

#### 1.1. Matter.js Engine 실시간 업데이트 루프
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**요구사항**:
- `useEffect` 내에서 `requestAnimationFrame` 루프 구현
- 매 프레임마다 `Matter.Engine.update(engine, deltaTime)` 호출
- Pulley 제약 조건 매 프레임마다 강제 (`enforcePulleyConstraints`)
- 렌더링: Matter.js의 `Render` 사용 또는 Canvas API 직접 사용

**핵심 로직**:
```typescript
useEffect(() => {
  if (!playing || !scene) return;

  const engine = matterEngineRef.current;
  if (!engine) return;

  let lastTime = performance.now();
  let animationId: number;

  const animate = (currentTime: number) => {
    const deltaTime = currentTime - lastTime;
    lastTime = currentTime;

    // 물리 연산
    Matter.Engine.update(engine, deltaTime);
    
    // Pulley 제약 조건 강제
    if (pulleyConstraints.length > 0) {
      enforcePulleyConstraints(pulleyConstraints);
    }

    // 렌더링 (Matter.Render 또는 Canvas API)
    if (matterRenderRef.current) {
      Matter.Render.world(matterRenderRef.current);
    }

    animationId = requestAnimationFrame(animate);
  };

  animationId = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(animationId);
  };
}, [playing, scene]);
```

#### 1.2. Matter.Render 설정
**요구사항**:
- `Matter.Render.create()` 호출하여 Canvas 렌더러 생성
- `simulation-layer.tsx`의 `renderHostRef`를 렌더 타겟으로 사용
- 배경 이미지 위에 시뮬레이션이 오버레이되도록 z-index 조정

**핵심 코드**:
```typescript
const render = Matter.Render.create({
  element: renderHostRef.current,
  engine: engine,
  options: {
    width: canvasWidth,
    height: canvasHeight,
    background: 'transparent',
    wireframes: false,
    showVelocity: false,
    showAngleIndicator: false,
  },
});

Matter.Render.run(render);
matterRenderRef.current = render;
```

---

### Phase 2: 시각적 피드백 구현

#### 2.1. 마우스 오버 하이라이트
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**요구사항**:
- 마우스를 객체 위에 올렸을 때 outline 강조
- Dynamic body: 초록색 outline (물리 시뮬레이션 참여)
- Static body: 파란색 outline (환경 요소)

**구현**:
```typescript
// 모든 body의 원래 스타일 저장
const originalStyles = new Map<Matter.Body, { strokeStyle: string; lineWidth: number }>();

Matter.Events.on(render, 'afterRender', () => {
    const mouse = mouseConstraint.mouse;
    const bodies = Matter.Composite.allBodies(engine.world);
    
    bodies.forEach(body => {
        // 마우스와의 충돌 검사
        const isHovered = Matter.Bounds.contains(body.bounds, mouse.position) &&
                          Matter.Vertices.contains(body.vertices, mouse.position);
        
        if (isHovered) {
            // 저장된 스타일이 없으면 저장
            if (!originalStyles.has(body)) {
                originalStyles.set(body, {
                    strokeStyle: body.render.strokeStyle || '#000',
                    lineWidth: body.render.lineWidth || 1,
                });
            }
            
            // 하이라이트 스타일 적용
            body.render.strokeStyle = body.isStatic 
                ? 'rgba(59, 130, 246, 1)'    // 파란색 (static)
                : 'rgba(34, 197, 94, 1)';    // 초록색 (dynamic)
            body.render.lineWidth = 3;
        } else {
            // 원래 스타일 복원
            const original = originalStyles.get(body);
            if (original) {
                body.render.strokeStyle = original.strokeStyle;
                body.render.lineWidth = original.lineWidth;
                originalStyles.delete(body);
            }
        }
    });
});
```

#### 2.2. 커서 변경
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**CSS 추가**:
```tsx
// renderHostRef div에 동적 커서 추가
const [cursor, setCursor] = useState<string>('default');

useEffect(() => {
    const canvas = matterRenderRef.current?.canvas;
    if (!canvas) return;
    
    const handleMouseMove = (e: MouseEvent) => {
        const mouse = Matter.Mouse.create(canvas);
        Matter.Mouse.setOffset(mouse, canvas.getBoundingClientRect());
        Matter.Mouse.setScale(mouse, { x: 1, y: 1 });
        
        const bodies = Matter.Composite.allBodies(matterEngineRef.current!.world);
        const hoveredBody = bodies.find(body => 
            Matter.Bounds.contains(body.bounds, mouse.position) &&
            Matter.Vertices.contains(body.vertices, mouse.position)
        );
        
        if (hoveredBody) {
            setCursor('grab'); // 또는 'move'
        } else {
            setCursor('default');
        }
    };
    
    canvas.addEventListener('mousemove', handleMouseMove);
    return () => canvas.removeEventListener('mousemove', handleMouseMove);
}, []);

// JSX에서
<div ref={renderHostRef} style={{ cursor }} />
```

---

### Phase 3: 객체 클릭 시 속성 편집 UI

#### 3.1. 선택된 객체 State 관리
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**State 추가**:
```typescript
const [selectedBody, setSelectedBody] = useState<{
    id: string;
    type: 'static' | 'dynamic';
    position: [number, number];
    mass?: number;
    friction?: number;
    // collider 정보
    colliderType: 'circle' | 'rectangle' | 'polygon';
    radius?: number;
    width?: number;
    height?: number;
} | null>(null);
```

**클릭 이벤트 처리**:
```typescript
Matter.Events.on(mouseConstraint, 'mousedown', (event: any) => {
    const mouse = event.mouse;
    const bodies = Matter.Composite.allBodies(engine.world);
    
    const clickedBody = bodies.find(body => 
        Matter.Bounds.contains(body.bounds, mouse.position) &&
        Matter.Vertices.contains(body.vertices, mouse.position)
    );
    
    if (clickedBody) {
        // 객체 정보 추출
        const bodyId = clickedBody.label || clickedBody.id?.toString();
        const bodyMeta = bodyMetadataRef.current.get(bodyId);
        
        setSelectedBody({
            id: bodyId,
            type: clickedBody.isStatic ? 'static' : 'dynamic',
            position: [clickedBody.position.x, -clickedBody.position.y], // Y 좌표 반전
            mass: clickedBody.mass,
            friction: clickedBody.friction,
            colliderType: bodyMeta?.collider?.type || 'circle',
            radius: bodyMeta?.collider?.radius_m,
            width: bodyMeta?.collider?.width_m,
            height: bodyMeta?.collider?.height_m,
        });
        
        console.log('[SimulationLayer] Body selected:', bodyId);
    } else {
        // 빈 공간 클릭 시 선택 해제
        setSelectedBody(null);
    }
});
```

#### 3.2. 속성 편집 패널 컴포넌트
**새 파일**: `frontend/src/components/simulation/entity-editor-panel.tsx`

**컴포넌트 구조**:
```tsx
interface EntityEditorPanelProps {
    selectedEntity: {
        id: string;
        type: 'static' | 'dynamic';
        position: [number, number];
        mass?: number;
        friction?: number;
        colliderType: 'circle' | 'rectangle' | 'polygon';
        radius?: number;
        width?: number;
        height?: number;
    } | null;
    onUpdate: (updates: Partial<{
        position: [number, number];
        mass: number;
        friction: number;
        radius: number;
        width: number;
        height: number;
    }>) => void;
    onClose: () => void;
}

export function EntityEditorPanel({ selectedEntity, onUpdate, onClose }: EntityEditorPanelProps) {
    if (!selectedEntity) return null;
    
    return (
        <div className="absolute right-4 top-4 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 z-10">
            <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">Edit Entity: {selectedEntity.id}</h3>
                <button onClick={onClose}>✕</button>
            </div>
            
            {/* Position */}
            <div className="mb-3">
                <label className="text-sm font-medium">Position (m)</label>
                <div className="flex gap-2">
                    <input 
                        type="number" 
                        value={selectedEntity.position[0].toFixed(2)}
                        onChange={(e) => onUpdate({ 
                            position: [parseFloat(e.target.value), selectedEntity.position[1]] 
                        })}
                        className="flex-1 px-2 py-1 border rounded"
                    />
                    <input 
                        type="number" 
                        value={selectedEntity.position[1].toFixed(2)}
                        onChange={(e) => onUpdate({ 
                            position: [selectedEntity.position[0], parseFloat(e.target.value)] 
                        })}
                        className="flex-1 px-2 py-1 border rounded"
                    />
                </div>
            </div>
            
            {/* Mass (dynamic body만) */}
            {selectedEntity.type === 'dynamic' && (
                <div className="mb-3">
                    <label className="text-sm font-medium">Mass (kg)</label>
                    <input 
                        type="number" 
                        value={selectedEntity.mass}
                        onChange={(e) => onUpdate({ mass: parseFloat(e.target.value) })}
                        step="0.1"
                        className="w-full px-2 py-1 border rounded"
                    />
                </div>
            )}
            
            {/* Friction */}
            <div className="mb-3">
                <label className="text-sm font-medium">Friction</label>
                <input 
                    type="number" 
                    value={selectedEntity.friction}
                    onChange={(e) => onUpdate({ friction: parseFloat(e.target.value) })}
                    step="0.05"
                    min="0"
                    max="1"
                    className="w-full px-2 py-1 border rounded"
                />
            </div>
            
            {/* Size (collider에 따라) */}
            {selectedEntity.colliderType === 'circle' && (
                <div className="mb-3">
                    <label className="text-sm font-medium">Radius (m)</label>
                    <input 
                        type="number" 
                        value={selectedEntity.radius}
                        onChange={(e) => onUpdate({ radius: parseFloat(e.target.value) })}
                        step="0.01"
                        min="0.01"
                        className="w-full px-2 py-1 border rounded"
                    />
                </div>
            )}
            
            {selectedEntity.colliderType === 'rectangle' && (
                <>
                    <div className="mb-3">
                        <label className="text-sm font-medium">Width (m)</label>
                        <input 
                            type="number" 
                            value={selectedEntity.width}
                            onChange={(e) => onUpdate({ width: parseFloat(e.target.value) })}
                            step="0.01"
                            min="0.01"
                            className="w-full px-2 py-1 border rounded"
                        />
                    </div>
                    <div className="mb-3">
                        <label className="text-sm font-medium">Height (m)</label>
                        <input 
                            type="number" 
                            value={selectedEntity.height}
                            onChange={(e) => onUpdate({ height: parseFloat(e.target.value) })}
                            step="0.01"
                            min="0.01"
                            className="w-full px-2 py-1 border rounded"
                        />
                    </div>
                </>
            )}
        </div>
    );
}
```

#### 3.3. SimulationLayer에 통합
```tsx
// simulation-layer.tsx에서
const handleEntityUpdate = useCallback((updates: any) => {
    if (!selectedBody) return;
    
    const body = matterBodyMapRef.current.get(selectedBody.id);
    if (!body) return;
    
    // Matter.js body 업데이트
    if (updates.position) {
        Matter.Body.setPosition(body, { 
            x: updates.position[0], 
            y: -updates.position[1] 
        });
    }
    if (updates.mass !== undefined) {
        Matter.Body.setMass(body, updates.mass);
    }
    if (updates.friction !== undefined) {
        body.friction = updates.friction;
    }
    // ... 크기 변경은 복잡 (body 재생성 필요)
    
    // Backend 동기화
    debouncedBackendSyncRef.current?.debouncedUpdate({
        [selectedBody.id]: {
            position_m: updates.position,
            mass_kg: updates.mass,
            material: { friction: updates.friction },
            // ...
        }
    });
}, [selectedBody]);

// JSX
<EntityEditorPanel 
    selectedEntity={selectedBody}
    onUpdate={handleEntityUpdate}
    onClose={() => setSelectedBody(null)}
/>
```

---

### Phase 4: Backend 동기화 강화

#### 2.1. Mouse Constraint 구현
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**요구사항**:
- Matter.js `MouseConstraint` 사용
- 사용자가 시뮬레이션 박스 내 엔티티를 클릭하여 드래그 가능
- Static body (surface, ground)는 드래그 불가
- Dynamic body만 드래그 가능

**핵심 로직**:
```typescript
const mouse = Matter.Mouse.create(render.canvas);
const mouseConstraint = Matter.MouseConstraint.create(engine, {
  mouse: mouse,
  constraint: {
    stiffness: 0.2,
    render: {
      visible: false,
    },
  },
});

// Static body는 드래그 불가
Matter.Events.on(mouseConstraint, 'startdrag', (event) => {
  const body = event.body;
  if (body.isStatic) {
    mouseConstraint.body = null; // 드래그 취소
  }
});

Matter.World.add(engine.world, mouseConstraint);
render.mouse = mouse;
```

#### 2.2. 터치 이벤트 지원 (모바일)
**요구사항**:
- 터치 스크린에서도 드래그 가능
- `MouseConstraint`는 터치 이벤트도 자동 처리함 (Matter.js 내장 기능)
- 필요 시 `touch-action: none` CSS 추가

---

### Phase 3: 재생 모드 vs 인터랙티브 모드 전환

#### 3.1. 두 가지 모드 정의
**Playback Mode** (기존):
- Backend에서 받은 frames 배열 재생
- 사용자 인터랙션 불가
- 빠른 재생 속도 조절 가능
- 정확한 재현 (deterministic)

**Interactive Mode** (신규):
- Frontend Matter.js 실시간 실행
- 사용자 드래그 가능
- 실시간 물리 연산
- 비결정적 (사용자 입력에 따라 변화)

#### 3.2. 모드 전환 UI
**위치**: `simulation-viewer.tsx` 또는 `parameters-panel.tsx`

**요구사항**:
- Toggle 버튼 또는 Tab 추가
- "Playback" vs "Interactive" 전환
- Interactive 모드에서는:
  - Play/Pause 버튼: 물리 시뮬레이션 시작/정지
  - Reset 버튼: 초기 위치로 리셋
  - Speed 슬라이더 비활성화 (실시간 고정)

**State 관리**:
```typescript
// SimulationContext.tsx
const [simulationMode, setSimulationMode] = useState<'playback' | 'interactive'>('playback');
```

---

### Phase 4: 성능 최적화

#### 4.1. Sleeping Bodies
**요구사항**:
- Matter.js의 `sleeping` 기능 활성화
- 정지된 객체는 물리 연산에서 제외
- 성능 향상

```typescript
const engine = Matter.Engine.create({
  gravity: { x: 0, y: gravity },
  enableSleeping: true, // 추가
});
```

#### 4.2. 렌더링 최적화
**요구사항**:
- 화면 밖 객체는 렌더링 스킵 (culling)
- Canvas 크기 고정 (불필요한 리사이즈 방지)
- `wireframes: false` (더 나은 비주얼)

---

## 🗂️ 파일별 작업 목록

### Frontend

#### 1. `frontend/src/simulation/SimulationContext.tsx`
- [ ] `simulationMode` state 추가 (`'playback' | 'interactive'`)
- [ ] `setSimulationMode()` 메서드 export
- [ ] Interactive 모드일 때 frames 무시

#### 2. `frontend/src/components/simulation/simulation-layer.tsx`
- [ ] `requestAnimationFrame` 루프 구현
- [ ] `Matter.Render.create()` 및 설정
- [ ] `Matter.Engine.update()` 매 프레임 호출
- [ ] `enforcePulleyConstraints()` 통합
- [ ] `Matter.MouseConstraint` 구현
- [ ] Playback vs Interactive 모드 분기 처리

#### 3. `frontend/src/components/simulation/parameters-panel.tsx`
- [ ] Mode Toggle UI 추가 (Playback/Interactive)
- [ ] Interactive 모드 UI 조정:
  - Play: 물리 시작
  - Pause: 물리 정지
  - Reset: Scene 초기화
  - Speed 슬라이더 숨김

#### 4. `frontend/src/simulation/matterRunner.ts`
- [ ] `enforcePulleyConstraints()` export
- [ ] (선택) 헬퍼 함수 추가: `resetMatterScene(engine, scene)`

---

## 🧪 테스트 시나리오

### Scenario 1: 실시간 도르래 시뮬레이션
1. 이미지 업로드 → 도르래 문제 인식
2. Interactive 모드 선택
3. Play 버튼 클릭
4. **기대 결과**: 질량 A, B가 도르래를 통해 실시간으로 움직임

### Scenario 2: 엔티티 드래그
1. Interactive 모드에서 시뮬레이션 실행 중
2. 질량 A를 마우스로 클릭 & 드래그
3. **기대 결과**: 질량 A가 마우스를 따라 이동, 로프가 팽팽해지며 질량 B도 반응

### Scenario 3: 경사면 시뮬레이션
1. 경사면 + 물체 이미지 업로드
2. Interactive 모드 선택
3. Play 버튼 클릭
4. **기대 결과**: 물체가 경사면을 따라 미끄러짐
5. 물체를 드래그하여 다른 위치로 이동
6. **기대 결과**: 놓으면 다시 미끄러지기 시작

### Scenario 4: 모드 전환
1. Playback 모드에서 시뮬레이션 재생
2. Interactive 모드로 전환
3. **기대 결과**: 현재 프레임 위치에서 Interactive 시뮬레이션 시작
4. 다시 Playback 모드로 전환
5. **기대 결과**: Backend frames 재생으로 복귀

---

## ⚠️ 주의사항

### 1. Coordinate System
- **Backend Scene**: Y축 위쪽이 양수 (일반 물리)
- **Matter.js**: Y축 아래쪽이 양수 (Canvas 좌표계)
- **변환 필수**: `matterRunner.ts`의 `toMatterVec()`, `fromMatterPosition()` 활용

### 2. Scene Synchronization
- Interactive 모드에서 파라미터 변경 시:
  - Engine 재생성 필요
  - `destroyMatterScene()` → `initializeMatterScene()` → 새 Engine 생성

### 3. Performance
- 60 FPS 목표
- Engine.update() 호출 주기: ~16ms (1000/60)
- 무거운 Scene (100+ bodies)은 성능 저하 가능 → sleeping 필수

### 4. Backend Frames vs Frontend Physics
- **Backend Frames**: Deterministic (항상 같은 결과)
- **Frontend Physics**: Non-deterministic (부동소수점 오차, 사용자 입력)
- Playback 모드에서 정확한 분석 제공
- Interactive 모드에서 실험/탐구 제공

---

## 🎯 최종 구현 목표 요약

### 사용자 시나리오
```
1. 시뮬레이션 박스에서 객체(예: 공) 클릭
   ↓
2. ParametersPanel이 자동으로 'Entity' scope로 전환
   ↓
3. 해당 객체의 파라미터 표시
   - Position (x, y)
   - Mass (질량)
   - Friction (마찰력)
   - Size (크기) ← Phase 2
   ↓
4. 파라미터 조절
   - Interactive Mode: Frontend Matter.js 즉시 반영
   - Playback Mode: Backend 재시뮬레이션
   ↓
5. 객체 드래그
   - Static body도 드래그 가능 (벽, 바닥, 경사면 등)
   - Constraint(Rope)로 연결된 객체는 함께 움직임
   ↓
6. 모든 변경사항 자동 Backend 동기화 (debounced)
```

---

## ✅ 완료 체크리스트

### Phase 1: Context & 클릭 이벤트 (핵심 기반)
- [ ] SimulationContext에 `selectedEntityId` state 추가
- [ ] SimulationContext에 `updateEntityCallback` 추가 (Callback 패턴)
- [ ] SimulationLayer에서 mousedown 이벤트로 클릭 감지
- [ ] 클릭 시 `setSelectedEntityId(bodyId)` 호출
- [ ] 빈 공간 클릭 시 선택 해제

### Phase 2: 드래그 기능 수정 (긴급)
- [ ] startdrag에서 static body 방지 코드 제거
- [ ] Static body를 일시적으로 dynamic으로 변환
- [ ] Position/angle 저장 및 즉시 복원 (NaN 방지)
- [ ] __wasStatic 플래그로 원래 상태 추적
- [ ] enddrag에서 static 복원
- [ ] Constraint 테스트 (Rope로 연결된 객체 함께 움직이는지)

### Phase 3: ParametersPanel 연동
- [ ] Context의 selectedEntityId 감지 (useEffect)
- [ ] 자동으로 scope='entity' 전환
- [ ] 드롭다운 선택값 동기화
- [ ] 드롭다운 변경 시 Context에도 반영

### Phase 4: Interactive Mode 파라미터 업데이트
- [ ] SimulationLayer에서 updateEntityCallback 등록
- [ ] ParametersPanel에서 파라미터 변경 시:
  - Interactive: updateEntityCallback 호출 → Frontend 즉시 반영
  - Playback: Backend 재시뮬레이션
- [ ] Backend debounced 동기화

### Phase 5: 시각적 피드백
- [ ] Hover 시 outline 하이라이트
- [ ] Selected 시 진한 outline
- [ ] 커서 변경 (grab/default)
- [ ] Dynamic vs Static 구분 (색상)

### Phase 6: 통합 테스트
- [ ] 모든 객체 드래그 가능 (static/dynamic)
- [ ] 객체 클릭 → ParametersPanel 자동 선택
- [ ] 파라미터 조절 → 실시간 반영
- [ ] Rope로 연결된 객체 함께 움직임
- [ ] Backend 동기화 확인 (네트워크 탭)
- [ ] Mode 전환 시 정상 동작

---

## 🚀 구현 우선순위 (재정리)

### Priority 1: Context 확장 (기반)
**시간:** 30분  
**파일:** `SimulationContext.tsx`  
**작업:** selectedEntityId state, updateEntityCallback 추가

### Priority 2: 클릭 이벤트 (사용자 인터랙션 시작)
**시간:** 20분  
**파일:** `simulation-layer.tsx`  
**작업:** mousedown 이벤트로 클릭 감지 및 선택

### Priority 3: 드래그 기능 수정 (긴급)
**시간:** 40분  
**파일:** `simulation-layer.tsx`  
**작업:** Static body 드래그 가능하게 수정, NaN 방지

### Priority 4: ParametersPanel 연동 (핵심 UX)
**시간:** 30분  
**파일:** `parameters-panel.tsx`  
**작업:** Context 동기화, 자동 선택 반영

### Priority 5: Interactive 업데이트 (실시간 반영)
**시간:** 40분  
**파일:** `parameters-panel.tsx`, `simulation-layer.tsx`  
**작업:** Frontend Matter.js 직접 업데이트, Callback 등록

### Priority 6: 시각적 피드백 (UX 향상)
**시간:** 30분  
**파일:** `simulation-layer.tsx`  
**작업:** Hover/Select 하이라이트, 커서 변경

**총 예상 시간:** 약 3시간

---

## 🎓 핵심 설계 결정 정리

### 1. Callback 패턴 채택 이유
```
문제: Context에서 SimulationLayer의 matterBodyMapRef에 접근 불가
해결: SimulationLayer가 Context에 callback 등록
     → Context는 callback 호출만 하면 됨
     → 컴포넌트 경계 유지
```

### 2. Static Body 드래그 전략
```
방법: 일시적 Dynamic 변환
과정:
  1. startdrag: Static → Dynamic (position/angle 저장 후 복원)
  2. 드래그 중: Matter.js가 자동 처리
  3. enddrag: Dynamic → Static 복원
장점:
  - Matter.js의 Constraint 자동 처리 활용
  - Rope로 연결된 객체 자동으로 따라옴
  - 코드 간결
```

### 3. Interactive vs Playback 업데이트 전략
```
Interactive Mode:
  - Frontend Matter.js 직접 업데이트 (즉시 반영)
  - Backend는 debounced 동기화 (resimulate=false)
  - 빠른 피드백, 실험적

Playback Mode:
  - Backend 재시뮬레이션 (resimulate=true)
  - 정확한 물리 계산
  - 분석적
```

### 4. 크기 조절은 Phase 2로
```
이유:
  - Matter.js body 재생성 필요 (복잡)
  - Constraint anchor 재계산 필요
  - 다른 기능에 비해 우선순위 낮음

간단한 해결책:
  - Backend 재시뮬레이션만 지원
  - Interactive mode에서는 크기 조절 비활성화
```

---

## 🎯 최종 목표 재확인

**"시뮬레이션 박스에서 객체를 클릭하면 ParametersPanel에 자동으로 표시되고, 파라미터를 조절하거나 드래그하면 실시간으로 반영되며, Constraint도 자동으로 처리되는 직관적인 물리 에디터"**

- ✅ 객체 클릭 → ParametersPanel 자동 선택
- ✅ 파라미터 조절 → 실시간 반영 (Interactive)
- ✅ 모든 객체 드래그 가능 (static/dynamic)
- ✅ Constraint 자동 처리 (Rope 연결 시 함께 움직임)
- ✅ Backend 자동 동기화
- ✅ 시각적 피드백 (Hover/Select)
- ✅ 직관적인 UX
