# Interactive Simulation - 프로젝트 구조 분석 및 구현 전략

**Date**: 2025-11-07  
**Goal**: 실시간 물리 시뮬레이션 + 드래그 인터랙션 구현 가능성 검증 및 구현 계획

---

## 📊 현재 시스템 아키텍처 분석

### 1. **Frontend 시뮬레이션 파이프라인**

#### **Current Architecture (Playback Mode)**
```
Backend Matter.js Worker (Node.js)
   ↓ (POST /run_sim)
frames[] 배열 (미리 계산된 위치 데이터)
   ↓
SimulationContext.loadSimulationRun()
   ↓ (frames 저장)
SimulationLayer (재생만 가능)
   ↓ (requestAnimationFrame - 인덱스 증가만)
Canvas 렌더링 (frames[currentIndex] 표시)
```

**핵심 문제점**:
- ✅ Backend에서 전체 시뮬레이션을 미리 계산 (deterministic)
- ❌ Frontend는 계산된 frames를 **재생만** 가능 (비디오 플레이어와 유사)
- ❌ **실시간 물리 연산 없음** - Matter.js Engine이 초기화되지만 업데이트되지 않음
- ❌ **사용자 인터랙션 불가** - 드래그 핸들러가 Canvas 위치 이동용으로만 사용됨

#### **Target Architecture (Interactive Mode)**
```
Backend Universal Builder
   ↓ (Scene JSON 생성)
Frontend SimulationContext
   ↓ (Scene 저장)
simulation-layer.tsx
   ↓ (initializeMatterScene)
Matter.js Engine (클라이언트 실행)
   ↓ (requestAnimationFrame 루프)
Engine.update() + enforcePulleyConstraints()
   ↓
Matter.Render → Canvas (실시간 렌더링)
   ↑ (사용자 입력)
Matter.MouseConstraint → Body 위치 변경
```

---

### 2. **핵심 파일 구조 분석**

#### **Frontend - Simulation Layer**

| 파일 | 역할 | 현재 상태 | Interactive Mode 구현 필요 사항 |
|------|------|-----------|---------------------------|
| `frontend/src/simulation/SimulationContext.tsx` | Scene/Frames 전역 상태 관리 | ✅ Playback 모드 완전 구현 | ⚠️ `simulationMode` state 추가 필요 |
| `frontend/src/simulation/matterRunner.ts` | Matter.js 초기화 및 시뮬레이션 | ✅ `initializeMatterScene()` 완성<br>✅ `runMatterSimulation()` batch mode | ⚠️ 이미 완전히 구현됨 (재사용 가능) |
| `frontend/src/components/simulation/simulation-layer.tsx` | 렌더링 레이어 | ✅ Canvas 렌더링 인프라<br>✅ `matterEngineRef` 존재<br>❌ Engine.update() 루프 없음 | ⚠️ requestAnimationFrame 루프 추가<br>⚠️ MouseConstraint 추가 |
| `frontend/src/components/simulation/simulation-viewer.tsx` | Standalone 시뮬레이션 뷰어 | ✅ 완전한 Playback UI | ℹ️ 참고용 (Whiteboard에서는 simulation-layer 사용) |
| `frontend/src/components/simulation/parameters-panel.tsx` | 파라미터 편집 UI | ✅ Universal parameters<br>✅ `updateSceneAndResimulate()` 준비됨 | ⚠️ Mode Toggle UI 추가 필요 |

#### **Backend - Scene Management**

| 파일 | 역할 | 현재 상태 | Interactive Mode 관련 |
|------|------|-----------|----------------------|
| `backend/app/sim/universal_builder.py` | Universal Scene 생성 | ✅ 완전 구현 | ✅ Scene JSON 생성 (변경 불필요) |
| `backend/app/sim/physics/matter_bridge.py` | Matter.js Worker 브릿지 | ✅ 완전 구현 | ✅ 시뮬레이션 실행 (변경 불필요) |
| `backend/app/routers/run_sim.py` | POST /run_sim 엔드포인트 | ✅ 완전 구현 | ℹ️ Playback Mode에서 계속 사용 |
| `backend/app/routers/init_sim.py` | POST /init_sim (Scene 초기화) | ✅ 완전 구현 | ✅ Interactive Mode Scene 소스 |
| **NEW** | `POST /api/simulation/update` | ❌ 미구현 | ⚠️ Scene 업데이트 + 재시뮬레이션 API 필요 (선택사항) |

---

### 3. **Scene 데이터 흐름**

#### **Scene 구조 (Universal Schema)**
```typescript
interface Scene {
  version: string;
  world: {
    gravity_m_s2: number;
    time_step_s: number;
  };
  bodies: Array<{
    id: string;
    type: "dynamic" | "static" | "kinematic";
    mass_kg: number;
    position_m: [number, number];
    angle_rad?: number;
    collider: {
      type: "circle" | "rectangle" | "polygon";
      radius_m?: number;
      width_m?: number;
      height_m?: number;
      vertices?: Array<[number, number]>;
    };
    material?: {
      friction?: number;
      restitution?: number;
      density?: number;
    };
  }>;
  constraints: Array<{
    type: "rope" | "spring" | "ideal_fixed_pulley" | "distance";
    body_a?: string;
    body_b?: string;
    length_m?: number;
    pulley_anchor_m?: [number, number];
    // ... 기타 constraint 파라미터
  }>;
  mapping?: {
    origin_px: [number, number];
    scale_m_per_px: number;
  };
}
```

#### **Scene 관리 상태**

| Context | Scene 저장 여부 | 업데이트 메커니즘 | Interactive Mode 사용 |
|---------|---------------|------------------|---------------------|
| `SimulationContext` | ✅ `scene` state | ✅ `updateSceneAndResimulate()` | ✅ Scene 소스로 사용 가능 |
| `GlobalChatContext` | ❌ Scene 직접 저장 안함 | ℹ️ conversationId로 Backend 조회 | ℹ️ 간접적 Scene 접근 |
| Backend AgentContext | ✅ `context.scene` | ✅ `update_pipeline_state()` | ✅ Backend API로 조회 가능 |

---

## 🔍 드래그 앤 드롭 즉시 반영 가능성 분석

### ✅ **결론: 구현 가능하며, 두 가지 아키텍처 선택지 존재**

---

### **Option 1: Local-Only Interactive Mode (권장)**

#### **장점**:
- ⚡ **즉시 반응** - 네트워크 지연 없음
- 🎯 **간단한 구현** - Frontend만 수정
- 💻 **오프라인 작동** - Backend 불필요
- 🔄 **실시간 피드백** - 매 프레임 물리 연산

#### **단점**:
- ⚠️ **비결정적** - 같은 초기 조건에서도 결과 다를 수 있음 (부동소수점 오차)
- 📊 **Backend와 불일치** - Frontend와 Backend 시뮬레이션 결과 약간 다름
- 💾 **저장 불가** - Backend에 Scene 업데이트 저장 안됨 (추가 API 필요)

#### **아키텍처**:
```typescript
// simulation-layer.tsx
useEffect(() => {
  if (!playing || !scene || simulationMode !== 'interactive') return;

  const engine = matterEngineRef.current;
  if (!engine) return;

  let lastTime = performance.now();
  let animationId: number;

  const animate = (currentTime: number) => {
    const deltaTime = (currentTime - lastTime) / 1000; // ms → s
    lastTime = currentTime;

    // 실시간 물리 연산
    Matter.Engine.update(engine, deltaTime * 1000); // Matter.js는 ms 단위

    // Pulley 제약 조건 강제
    if (pulleyConstraints.length > 0) {
      enforcePulleyConstraints(pulleyConstraints);
    }

    // Matter.js 렌더러 사용
    if (matterRenderRef.current) {
      Matter.Render.world(matterRenderRef.current);
    }

    animationId = requestAnimationFrame(animate);
  };

  animationId = requestAnimationFrame(animate);

  return () => {
    cancelAnimationFrame(animationId);
  };
}, [playing, scene, simulationMode]);
```

#### **드래그 처리**:
```typescript
// simulation-layer.tsx - Matter.MouseConstraint 추가
const mouse = Matter.Mouse.create(render.canvas);
const mouseConstraint = Matter.MouseConstraint.create(engine, {
  mouse: mouse,
  constraint: {
    stiffness: 0.2,
    render: { visible: false }
  }
});

// Static body 드래그 방지
Matter.Events.on(mouseConstraint, 'startdrag', (event) => {
  const body = event.body;
  if (body.isStatic) {
    mouseConstraint.body = null; // 드래그 취소
  }
});

Matter.World.add(engine.world, mouseConstraint);
render.mouse = mouse;
```

**드래그 → Scene 즉시 반영**:
- ✅ `mouseConstraint`가 자동으로 body 위치 변경
- ✅ `Engine.update()`가 매 프레임 새 위치로 물리 연산
- ✅ **즉시 반영됨** (네트워크 왕복 없음)

---

### **Option 2: Backend Sync Mode (고급)**

#### **장점**:
- ✅ **일관성** - Frontend와 Backend 동일한 Scene 상태
- 💾 **영구 저장** - 변경사항 Backend에 저장됨
- 📊 **Deterministic** - Backend에서 정확한 시뮬레이션 재현 가능

#### **단점**:
- ⏱️ **네트워크 지연** - 드래그 → API 호출 → 응답 (100~500ms)
- 🔧 **복잡한 구현** - Backend API 추가 필요
- 📡 **온라인 필수** - Backend 연결 필요

#### **아키텍처**:
```typescript
// simulation-layer.tsx
const handleBodyDragEnd = async (bodyId: string, newPosition: [number, number]) => {
  // 1. 로컬 Scene 업데이트
  const updatedScene = {
    ...scene,
    bodies: scene.bodies.map(body =>
      body.id === bodyId
        ? { ...body, position_m: newPosition }
        : body
    )
  };

  // 2. Backend API 호출 (선택적)
  try {
    const response = await fetch('/api/simulation/update', {
      method: 'POST',
      body: JSON.stringify({
        conversation_id: conversationId,
        scene: updatedScene
      })
    });

    const { frames } = await response.json();
    
    // 3. 새 frames로 Playback 재생 (선택)
    // 또는 Interactive Mode에서 로컬 Engine 계속 사용
  } catch (error) {
    console.warn('Backend sync failed, using local physics only');
  }
};
```

#### **Backend API 구현**:
```python
# backend/app/routers/simulation_update.py
@router.post("/simulation/update")
async def update_simulation(
    conversation_id: str,
    scene: dict
):
    """
    Scene 업데이트 후 재시뮬레이션
    
    1. Scene 검증
    2. Context에 저장
    3. Matter.js Worker 실행 (선택)
    4. 새 frames 반환
    """
    context = get_context_store().get_context(conversation_id)
    context.update_pipeline_state(scene=scene)
    
    # 재시뮬레이션 (선택)
    frames = await simulate_physics(scene)
    
    return {
        "status": "updated",
        "scene": scene,
        "frames": frames
    }
```

---

## 📋 구현 우선순위 및 작업 계획

### **Phase 1: Local Interactive Mode (필수 - 1~2일)**

#### **Task 1.1: Matter.js Engine 실시간 업데이트**
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**구현 내용**:
1. ✅ `matterEngineRef.current` 이미 존재 → 재사용
2. ⚠️ `requestAnimationFrame` 루프 추가
3. ⚠️ `Matter.Engine.update(engine, deltaTime)` 호출
4. ⚠️ `enforcePulleyConstraints()` import 및 호출
5. ⚠️ `Matter.Render` 설정 및 실행

**예상 코드량**: ~80 lines (useEffect hook 추가)

---

#### **Task 1.2: Mouse Constraint (드래그 인터랙션)**
**파일**: `frontend/src/components/simulation/simulation-layer.tsx`

**구현 내용**:
1. ⚠️ `Matter.Mouse.create()` 및 `Matter.MouseConstraint.create()`
2. ⚠️ Static body 필터링 (드래그 불가)
3. ⚠️ `World.add(engine.world, mouseConstraint)`
4. ⚠️ 터치 이벤트 지원 (`touch-action: none`)

**예상 코드량**: ~40 lines

---

#### **Task 1.3: Mode Toggle UI**
**파일**: `frontend/src/components/simulation/parameters-panel.tsx`

**구현 내용**:
1. ⚠️ Playback/Interactive Toggle 버튼
2. ⚠️ `SimulationContext.simulationMode` state 추가
3. ⚠️ Interactive 모드에서 UI 조정 (Speed 슬라이더 숨김)

**예상 코드량**: ~50 lines

---

### **Phase 2: Scene Update + Backend Sync (선택사항 - 2~3일)**

#### **Task 2.1: Backend API 구현**
**파일**: `backend/app/routers/simulation_update.py` (신규 생성)

**구현 내용**:
1. ⚠️ `POST /api/simulation/update` 엔드포인트
2. ⚠️ Scene 검증 (Pydantic model)
3. ⚠️ AgentContext 업데이트
4. ⚠️ (선택) Matter.js Worker 재실행

**예상 코드량**: ~100 lines

---

#### **Task 2.2: Frontend Scene Sync**
**파일**: `frontend/src/simulation/SimulationContext.tsx`

**구현 내용**:
1. ⚠️ `syncSceneToBackend()` 메서드 추가
2. ⚠️ Debounce 처리 (드래그 완료 후 호출)
3. ⚠️ Error handling (네트워크 실패 시 로컬 유지)

**예상 코드량**: ~60 lines

---

## 🎯 권장 구현 전략

### **Recommended: Option 1 (Local-Only) 먼저 구현**

**이유**:
1. ✅ **즉시 사용 가능** - Backend 수정 불필요
2. ✅ **빠른 피드백** - 네트워크 지연 없음
3. ✅ **사용자 경험 우선** - 실시간 인터랙션이 핵심 가치
4. ✅ **점진적 개선** - 나중에 Backend Sync 추가 가능

**구현 후**:
- Interactive Mode에서 **즉시 드래그 & 실험** 가능
- Playback Mode로 **정확한 시뮬레이션 재현** 가능
- 두 모드를 자유롭게 전환하며 학습 효과 극대화

---

## 📊 현재 Infrastructure 상태

### ✅ **이미 구현된 것**

| 기능 | 위치 | 상태 |
|------|------|------|
| Matter.js 초기화 | `matterRunner.ts::initializeMatterScene()` | ✅ 완전 구현 (424 lines) |
| Scene → Matter.js 변환 | `matterRunner.ts::createBody()` | ✅ 완전 구현 (circle, rect, polygon 지원) |
| Pulley 제약 조건 | `matterRunner.ts::enforcePulleyConstraints()` | ✅ 완전 구현 (수학적 제약 강제) |
| Engine Reference | `simulation-layer.tsx::matterEngineRef` | ✅ 존재 (Line 194) |
| Canvas 렌더링 | `simulation-layer.tsx` | ✅ 완전 구현 |
| Scene State 관리 | `SimulationContext.tsx::scene` | ✅ 완전 구현 |
| Scene 업데이트 함수 | `SimulationContext.tsx::updateSceneAndResimulate()` | ✅ 완전 구현 (Line 237) |
| Parameters Panel | `parameters-panel.tsx` | ✅ Universal parameters 지원 |

### ⚠️ **필요한 것 (추가 구현)**

| 기능 | 필요 작업 | 예상 공수 |
|------|-----------|----------|
| Real-time Engine Loop | `requestAnimationFrame` + `Engine.update()` | ~1시간 |
| Mouse Constraint | `Matter.MouseConstraint` 설정 | ~30분 |
| Mode Toggle UI | Playback/Interactive 버튼 | ~30분 |
| State 분기 처리 | `simulationMode` 기반 로직 분리 | ~30분 |
| Backend Update API | `POST /api/simulation/update` | ~2시간 (선택) |

**Total 예상 시간**: 
- **Phase 1 (필수)**: ~2.5시간
- **Phase 2 (선택)**: +2시간

---

## 🔧 즉시 반영 메커니즘 분석

### **Question: "드래그 앤 드롭으로 물체 위치 조정 → Scene 즉시 반영?"**

### ✅ **Answer: 가능하며, 이미 Infrastructure가 준비되어 있음**

---

### **현재 Scene 업데이트 흐름**

#### **1. Parameters Panel에서 파라미터 변경**
```typescript
// parameters-panel.tsx (Line 206)
updateSceneAndResimulate((prev: any | null) => {
  const updatedBodies = prev.bodies.map((b: any) =>
    b.id === selectedEntityId
      ? { ...b, mass_kg: newMass }
      : b
  );
  return { ...prev, bodies: updatedBodies };
});
```

**동작 순서**:
1. ✅ Scene 객체 수정 (mass 변경)
2. ✅ `SimulationContext.setScene()` 호출
3. ✅ `performResimulation()` 자동 실행
4. ✅ `runMatterSimulation()` → 새 frames 생성
5. ✅ UI 자동 업데이트

---

#### **2. Interactive Mode에서 드래그**
```typescript
// simulation-layer.tsx (추가 구현 필요)
const mouseConstraint = Matter.MouseConstraint.create(engine, {
  mouse: Matter.Mouse.create(render.canvas),
  constraint: { stiffness: 0.2 }
});

Matter.Events.on(mouseConstraint, 'enddrag', (event) => {
  const body = event.body;
  const newPosition = fromMatterPosition(body); // [x, -y] 변환
  
  // Option A: 로컬에서만 업데이트 (즉시 반영)
  // → 아무것도 안해도 Engine이 자동으로 새 위치 사용
  
  // Option B: Scene 객체 동기화 (Backend 저장용)
  updateSceneAndResimulate((prev) => ({
    ...prev,
    bodies: prev.bodies.map(b =>
      b.id === body.label
        ? { ...b, position_m: newPosition }
        : b
    )
  }));
});
```

**동작 순서**:
1. ✅ Matter.js MouseConstraint가 body 위치 변경
2. ✅ `Engine.update()`가 매 프레임 새 위치로 물리 연산
3. ✅ **즉시 반영됨** (별도 API 호출 불필요)
4. (선택) Scene 객체에 반영 → Backend 저장

---

### **즉시 반영 가능한 이유**

| 메커니즘 | 설명 |
|---------|------|
| **1. Matter.js는 Mutable** | `Body.setPosition()` 호출 시 즉시 engine.world.bodies 업데이트 |
| **2. Engine.update() 매 프레임 실행** | requestAnimationFrame 루프에서 deltaTime마다 물리 연산 |
| **3. Render는 Engine State 읽기** | `Matter.Render.world()`가 현재 body 위치를 canvas에 그림 |
| **4. MouseConstraint 자동 통합** | Matter.js가 마우스 입력 → body 위치 변경 자동 처리 |

---

### **Scene 객체 동기화 필요성**

| 상황 | Scene 동기화 | 이유 |
|------|------------|------|
| Interactive Mode 실험 | ❌ 불필요 | Engine만 업데이트하면 됨 |
| Backend 저장 | ✅ 필요 | `updateSceneAndResimulate()` 호출 |
| Playback Mode로 전환 | ✅ 필요 | Frames 재생성 필요 |
| 교사에게 공유 | ✅ 필요 | Backend에 Scene 저장 |

---

## 🚀 다음 단계

### **Immediate Actions**

1. **Phase 1 구현 시작**:
   ```bash
   # simulation-layer.tsx 수정
   - requestAnimationFrame 루프 추가
   - Matter.Engine.update() 호출
   - Matter.MouseConstraint 설정
   ```

2. **SimulationContext에 Mode 추가**:
   ```typescript
   // SimulationContext.tsx
   const [simulationMode, setSimulationMode] = useState<'playback' | 'interactive'>('playback');
   ```

3. **Parameters Panel에 Toggle UI 추가**:
   ```tsx
   <Button onClick={() => setSimulationMode('interactive')}>
     Interactive Mode
   </Button>
   ```

---

### **Testing Scenarios**

#### **Scenario 1: 도르래 시뮬레이션 드래그**
1. 도르래 이미지 업로드 → GPT가 Scene 생성
2. Interactive Mode 선택
3. Play 버튼 클릭 → 질량 A, B가 실시간 움직임
4. 질량 A를 드래그하여 위로 끌어올림
5. **Expected**: 질량 B가 아래로 내려옴 (로프 제약 조건 유지)

#### **Scenario 2: 경사면 시뮬레이션**
1. 경사면 + 물체 이미지 업로드
2. Interactive Mode 선택
3. 물체가 경사면을 따라 미끄러짐
4. 물체를 드래그하여 경사면 꼭대기로 이동
5. **Expected**: 놓으면 다시 미끄러지기 시작

#### **Scenario 3: Mode 전환**
1. Playback Mode에서 시뮬레이션 재생
2. Interactive Mode로 전환
3. **Expected**: 현재 프레임 위치에서 Interactive 시뮬레이션 시작
4. 물체 드래그 후 Playback Mode로 전환
5. **Expected**: Backend frames 재생으로 복귀 (드래그 변경사항 무시)

---

## 📝 결론

### ✅ **실시간 물리 시뮬레이션 + 드래그 인터랙션 구현 가능**

**이유**:
1. ✅ Matter.js 초기화 Infrastructure 완비 (`matterRunner.ts`)
2. ✅ Engine Reference 존재 (`simulation-layer.tsx`)
3. ✅ Scene State 관리 시스템 완비 (`SimulationContext`)
4. ✅ Parameters Panel이 Scene 업데이트 지원 (`updateSceneAndResimulate`)
5. ✅ 필요한 추가 작업: requestAnimationFrame 루프 + MouseConstraint만 추가

---

### ⚡ **드래그 → Scene 즉시 반영 가능**

**메커니즘**:
- ✅ **Local-Only Mode**: Matter.js MouseConstraint가 body 위치 자동 업데이트 → 즉시 반영
- ✅ **Backend Sync Mode**: 드래그 완료 후 API 호출 → Scene 저장 (선택사항)

**권장 접근법**:
1. **Phase 1**: Local Interactive Mode 구현 (즉시 반영)
2. **Phase 2**: Backend Update API 추가 (영구 저장)
3. **최종**: Playback (정확한 분석) + Interactive (실시간 실험) 하이브리드 시스템

---

### 🎯 **Next Steps**

**Priority 1 (필수 - 2.5시간)**:
- [ ] `simulation-layer.tsx`: requestAnimationFrame 루프
- [ ] `simulation-layer.tsx`: Matter.MouseConstraint
- [ ] `SimulationContext.tsx`: simulationMode state
- [ ] `parameters-panel.tsx`: Mode Toggle UI

**Priority 2 (선택 - 2시간)**:
- [ ] Backend: `POST /api/simulation/update` API
- [ ] Frontend: Scene Sync with debounce

---

**Status**: ✅ **구현 준비 완료** - 모든 Infrastructure 존재, 통합만 필요
