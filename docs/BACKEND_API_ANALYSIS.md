# Backend API 설계 분석 및 Scene Update API 타당성 검토

**Date**: 2025-11-07  
**Context**: Interactive Mode Phase 2 - Backend Sync 필요성 분석

---

## 🔍 현재 Backend 아키텍처 분석

### 1. **Conversation-based State Management**

#### **ConversationContext 구조**
```python
class ConversationContext:
    conversation_id: str
    
    # Image & Detection
    image_id: str | None
    image_metadata: dict | None
    segments: list[dict]
    detections: list[dict]
    entities: list[dict]
    
    # Scene Management
    scene: dict | None                    # Immutable snapshot
    scene_state: dict                      # Mutable editing state
    scene_history: list[dict]              # Chronological snapshots
    mapping: dict | None
    
    # Simulation Results
    frames: list[dict]
    
    # Methods
    update_pipeline_state(**kwargs)        # Update immutable fields
    apply_scene_updates(bodies, constraints)  # Update mutable scene_state
    scene_snapshot() -> dict               # Generate snapshot from scene_state
    record_scene_snapshot(note) -> dict    # Save to history
```

**핵심 특징**:
- ✅ **Conversation 단위 격리**: 각 대화는 독립적 상태 유지
- ✅ **Immutable snapshot + Mutable state**: scene은 읽기 전용, scene_state는 편집 가능
- ✅ **History tracking**: scene_history로 변경 이력 관리
- ✅ **In-memory store**: ContextStore로 RAM 기반 관리 (Production에서는 Redis/DB 권장)

---

### 2. **기존 API 엔드포인트 분석**

| Endpoint | Method | 기능 | Scene 업데이트 | Frames 생성 |
|----------|--------|------|--------------|------------|
| `/init_sim` | POST | 이미지 → Scene 생성 | ✅ `context.update_pipeline_state(scene=...)` | ❌ |
| `/run_sim` | POST | Scene → Simulation 실행 | ❌ (읽기 전용) | ✅ `context.update_pipeline_state(frames=...)` |
| `/unified_chat` | POST | Agent 기반 대화형 편집 | ✅ `apply_scene_updates()` | ✅ (선택적) |

#### **`/init_sim` - Scene 생성**
```python
@router.post("", response_model=InitSimResponse)
async def initialize_simulation(request: InitSimRequest):
    # 1. 이미지 메타데이터 로드
    image_metadata = _load_image_metadata(request.image_id)
    
    # 2. GPT Agent로 Scene 생성
    build_result = await build_physics_scene(BuildSceneInput(...))
    
    # 3. Context에 Scene 저장
    context.update_pipeline_state(
        scene=scene,
        entities=entities,
        mapping=scene.get("mapping")
    )
    
    return InitSimResponse(ready_for_simulation=True)
```

**특징**:
- ✅ **One-shot Scene 생성**: 이미지 → GPT Agent → Scene JSON
- ✅ **Immutable Scene**: 생성 후 수정 불가
- ❌ **Frames 생성 안함**: `/run_sim` 호출 필요

---

#### **`/run_sim` - Simulation 실행**
```python
@router.post("", response_model=RunSimResponse)
async def run_simulation(request: RunSimRequest):
    # 1. Context에서 Scene 로드
    scene = context.scene
    
    # 2. Matter.js 시뮬레이션 실행
    sim_result = await simulate_physics(SimulatePhysicsInput(
        scene=scene,
        duration_s=request.duration_s,
        frame_rate=request.frame_rate
    ))
    
    # 3. Frames Context에 저장
    context.update_pipeline_state(frames=frames)
    
    return RunSimResponse(simulation={frames, meta})
```

**특징**:
- ✅ **Scene → Frames 파이프라인**: 시뮬레이션만 실행
- ❌ **Scene 수정 불가**: 입력 Scene을 변경하지 않음
- ✅ **Analysis 선택적 실행**: 에너지 보존, 제약 조건 위반 분석

---

#### **`/unified_chat` - Agent 기반 Scene 편집**
```python
@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest):
    # Agent가 scene_editor 툴 사용 시:
    # - create_block()
    # - modify_block()
    # - remove_block()
    # - create_pulley()
    # - create_rope()
    
    # 내부적으로:
    context.apply_scene_updates(bodies={body_id: body})
    scene = context.record_scene_snapshot(note="modify_block:massA")
    
    # 선택적으로 시뮬레이션 실행
    sim_result = await simulate_physics(...)
```

**특징**:
- ✅ **Incremental Scene Editing**: scene_state를 점진적으로 수정
- ✅ **History Tracking**: 모든 변경사항 snapshot으로 기록
- ✅ **Agent-driven**: GPT가 자연어 → 툴 호출로 Scene 편집
- ⚠️ **복잡한 인터페이스**: 일반 REST API보다 Agent 중심 설계

---

### 3. **Scene Editor Tools 분석**

| Tool | 기능 | Scene State 업데이트 | Snapshot 생성 |
|------|------|---------------------|--------------|
| `create_block` | Body 생성 | `apply_scene_updates(bodies={id: body})` | ✅ |
| `modify_block` | Body 속성 수정 | `apply_scene_updates(bodies={id: body})` | ✅ |
| `remove_block` | Body 삭제 | `remove_scene_entities(body_ids=[id])` | ✅ |
| `create_pulley` | Pulley 시스템 생성 | `apply_scene_updates(bodies={...})` | ✅ |
| `create_rope` | Rope constraint 생성 | `apply_scene_updates(constraints={id: rope})` | ✅ |

**공통 패턴**:
```python
def modify_block(input_data: ModifyBlockInput):
    context = _get_context(input_data.conversation_id)
    _ensure_scene_initialized(context)
    
    # 1. Body 수정
    body = {...}
    context.apply_scene_updates(bodies={input_data.body_id: body})
    
    # 2. Snapshot 저장
    scene = _snapshot_after_update(context, note=f"modify_block:{body_id}")
    
    return ModifyBlockOutput(body=body, scene=scene)
```

---

## 📊 Interactive Mode Scene Update 요구사항

### **Frontend 사용 시나리오**

#### **Scenario 1: Interactive Mode에서 드래그**
```typescript
// simulation-layer.tsx
Matter.Events.on(mouseConstraint, 'enddrag', (event) => {
    const body = event.body;
    const newPosition = fromMatterPosition(body); // [x, -y]
    
    // 현재 상태: Local Engine만 업데이트됨
    // 필요: Backend에 새 위치 저장
});
```

**필요한 기능**:
1. ✅ Body position 업데이트
2. ✅ Scene snapshot 생성
3. ✅ 새 Frames 생성 (선택적)
4. ✅ Context에 변경사항 저장

---

#### **Scenario 2: Parameters Panel에서 Mass 변경**
```typescript
// parameters-panel.tsx
const handleMassChange = (bodyId: string, newMass: number) => {
    // 현재: Frontend에서 updateSceneAndResimulate() 호출 → Local Matter.js 재실행
    // 필요: Backend에 mass 변경사항 저장
};
```

**필요한 기능**:
1. ✅ Body mass 업데이트
2. ✅ Scene snapshot 생성
3. ⚠️ 새 Frames 생성 (mass 변경 → 동작 변화)
4. ✅ Context에 변경사항 저장

---

## 🎯 API 설계 옵션 분석

### **Option A: 새로운 `/simulation/update` 엔드포인트 (SIMPLE)**

#### **장점**:
- ✅ **명확한 책임**: Scene 업데이트 전용 API
- ✅ **단순한 인터페이스**: Body/Constraint 업데이트만 처리
- ✅ **Frontend 친화적**: REST API로 직접 호출 가능
- ✅ **선택적 재시뮬레이션**: `resimulate` 플래그로 Frames 생성 제어

#### **단점**:
- ⚠️ **기능 중복**: `scene_editor` 툴과 유사한 기능
- ⚠️ **Agent와 분리**: unified_chat과 독립적 동작
- ⚠️ **History tracking**: scene_history와 통합 필요

#### **API 설계**:
```python
class SceneUpdateRequest(BaseModel):
    conversation_id: str
    updates: dict = Field(description="Body/Constraint updates")
    # Example:
    # {
    #   "bodies": {
    #     "massA": {"mass_kg": 2.0, "position_m": [0, 1]}
    #   },
    #   "constraints": {
    #     "rope1": {"length_m": 1.5}
    #   }
    # }
    resimulate: bool = Field(default=False)
    simulation_options: dict = Field(default_factory=dict)
    # { "duration_s": 5.0, "frame_rate": 60 }

class SceneUpdateResponse(BaseModel):
    status: str
    conversation_id: str
    scene: dict
    frames: list[dict] | None = None
    meta: dict = Field(default_factory=dict)

@router.post("/simulation/update")
async def update_scene(request: SceneUpdateRequest):
    context = get_context(request.conversation_id)
    
    # 1. Scene State 업데이트
    context.apply_scene_updates(
        bodies=request.updates.get("bodies"),
        constraints=request.updates.get("constraints")
    )
    
    # 2. Snapshot 저장
    scene = context.record_scene_snapshot(note="interactive_mode_update")
    
    # 3. 재시뮬레이션 (선택적)
    frames = None
    if request.resimulate:
        sim_result = await simulate_physics(SimulatePhysicsInput(
            scene=scene,
            duration_s=request.simulation_options.get("duration_s", 5.0),
            frame_rate=request.simulation_options.get("frame_rate", 60)
        ))
        frames = [f.dict() for f in sim_result.frames]
        context.update_pipeline_state(frames=frames)
    
    return SceneUpdateResponse(
        status="updated",
        conversation_id=context.conversation_id,
        scene=scene,
        frames=frames
    )
```

**사용 예시**:
```typescript
// Frontend
const response = await fetch('/api/simulation/update', {
    method: 'POST',
    body: JSON.stringify({
        conversation_id: conversationId,
        updates: {
            bodies: {
                massA: { position_m: [0.5, 2.0] }
            }
        },
        resimulate: false  // Local Engine 사용
    })
});
```

---

### **Option B: 기존 `scene_editor` 툴 재사용 (UNIFIED)**

#### **장점**:
- ✅ **중복 제거**: 기존 인프라 활용
- ✅ **Agent 통합**: unified_chat과 동일한 메커니즘
- ✅ **History 일관성**: scene_history에 자동 기록
- ✅ **검증 로직**: 기존 clamping, validation 재사용

#### **단점**:
- ⚠️ **복잡한 인터페이스**: Tool call 형식 필요
- ⚠️ **Agent 의존성**: GPT 없이 사용 어려움
- ⚠️ **Granular updates**: 한 번에 여러 Body 업데이트 불편

#### **API 설계**:
```python
# 기존 modify_block 툴 직접 호출
from app.agent.tools.scene_editor import modify_block, ModifyBlockInput

@router.post("/simulation/update_body")
async def update_body(
    conversation_id: str,
    body_id: str,
    updates: dict
):
    result = modify_block(ModifyBlockInput(
        conversation_id=conversation_id,
        body_id=body_id,
        **updates
    ))
    
    return {
        "status": "updated",
        "body": result.body,
        "scene": result.scene
    }
```

**사용 예시**:
```typescript
// Frontend - 개별 Body 업데이트
for (const bodyId of changedBodyIds) {
    await fetch('/api/simulation/update_body', {
        method: 'POST',
        body: JSON.stringify({
            conversation_id: conversationId,
            body_id: bodyId,
            updates: { position_m: newPositions[bodyId] }
        })
    });
}
```

---

### **Option C: Hybrid - Batch Update Wrapper (RECOMMENDED)**

#### **장점**:
- ✅ **Best of both**: Simple API + Existing infrastructure
- ✅ **Batch updates**: 여러 Body/Constraint 한 번에 업데이트
- ✅ **Validation**: scene_editor 검증 로직 재사용
- ✅ **History tracking**: scene_history에 자동 기록
- ✅ **선택적 재시뮬레이션**: 효율적 Frames 생성

#### **단점**:
- ⚠️ **구현 복잡도**: Wrapper 레이어 추가 필요
- ⚠️ **테스트 부담**: Batch 로직 검증 필요

#### **API 설계**:
```python
class BatchSceneUpdate(BaseModel):
    conversation_id: str
    body_updates: dict[str, dict] = Field(default_factory=dict)
    # { "massA": {"position_m": [0, 1], "mass_kg": 2.0} }
    
    constraint_updates: dict[str, dict] = Field(default_factory=dict)
    # { "rope1": {"length_m": 1.5} }
    
    resimulate: bool = Field(default=False)
    simulation_config: dict = Field(default_factory=dict)

class BatchSceneUpdateResponse(BaseModel):
    status: str
    conversation_id: str
    updated_bodies: list[str]
    updated_constraints: list[str]
    scene: dict
    frames: list[dict] | None = None

@router.post("/simulation/batch_update")
async def batch_update_scene(request: BatchSceneUpdate):
    context = get_context(request.conversation_id)
    _ensure_scene_initialized(context)
    
    # 1. Batch update bodies
    updated_bodies = {}
    for body_id, updates in request.body_updates.items():
        # 기존 body 로드
        existing_body = context.scene_state["bodies"].get(body_id)
        if not existing_body:
            raise HTTPException(404, f"Body {body_id} not found")
        
        # 업데이트 적용
        updated_body = {**existing_body, **updates}
        
        # Validation (scene_editor 로직 재사용)
        if "position_m" in updates:
            validated_pos, _, warnings = _clamp_block_to_image_bounds(
                context, updates["position_m"], ...
            )
            updated_body["position_m"] = validated_pos
        
        updated_bodies[body_id] = updated_body
    
    # 2. Batch update constraints
    updated_constraints = {}
    for constraint_id, updates in request.constraint_updates.items():
        existing_constraint = context.scene_state["constraints"].get(constraint_id)
        if not existing_constraint:
            raise HTTPException(404, f"Constraint {constraint_id} not found")
        
        updated_constraints[constraint_id] = {**existing_constraint, **updates}
    
    # 3. Apply to context
    context.apply_scene_updates(
        bodies=updated_bodies,
        constraints=updated_constraints
    )
    
    # 4. Snapshot
    scene = context.record_scene_snapshot(note="batch_update_interactive_mode")
    
    # 5. Resimulate (optional)
    frames = None
    if request.resimulate:
        sim_result = await simulate_physics(SimulatePhysicsInput(
            scene=scene,
            duration_s=request.simulation_config.get("duration_s", 5.0),
            frame_rate=request.simulation_config.get("frame_rate", 60)
        ))
        frames = [f.dict() for f in sim_result.frames]
        context.update_pipeline_state(frames=frames)
    
    context_store.update_context(context)
    
    return BatchSceneUpdateResponse(
        status="updated",
        conversation_id=context.conversation_id,
        updated_bodies=list(updated_bodies.keys()),
        updated_constraints=list(updated_constraints.keys()),
        scene=scene,
        frames=frames
    )
```

**사용 예시**:
```typescript
// Frontend - 드래그 완료 후 Batch Update
const response = await fetch('/api/simulation/batch_update', {
    method: 'POST',
    body: JSON.stringify({
        conversation_id: conversationId,
        body_updates: {
            massA: { position_m: [0.5, 2.0] },
            massB: { position_m: [0.5, -1.0] }
        },
        resimulate: false  // Local Engine 계속 사용
    })
});

// Parameters Panel - Mass 변경 후 재시뮬레이션
const response = await fetch('/api/simulation/batch_update', {
    method: 'POST',
    body: JSON.stringify({
        conversation_id: conversationId,
        body_updates: {
            massA: { mass_kg: 3.0 }
        },
        resimulate: true,  // Backend에서 새 Frames 생성
        simulation_config: { duration_s: 5.0 }
    })
});
```

---

## 💡 권장 사항 (RECOMMENDATION)

### ✅ **Option C: Hybrid Batch Update 구현**

**이유**:
1. **Frontend 요구사항 충족**: Interactive Mode에서 여러 Body 동시 업데이트 필요
2. **기존 인프라 활용**: scene_editor 검증 로직 재사용
3. **선택적 재시뮬레이션**: Local Engine (빠름) vs Backend Frames (정확함)
4. **History 일관성**: scene_history에 자동 기록
5. **확장 가능**: 향후 Agent 통합 용이

---

### 📋 구현 계획

#### **Phase 2-A: Batch Update API (필수 - 2시간)**
```python
# backend/app/routers/simulation_update.py
@router.post("/simulation/batch_update")
async def batch_update_scene(request: BatchSceneUpdate):
    # 1. Body/Constraint batch update
    # 2. Validation (scene_editor 로직 재사용)
    # 3. apply_scene_updates()
    # 4. record_scene_snapshot()
    # 5. Optional resimulation
```

#### **Phase 2-B: Frontend Integration (1시간)**
```typescript
// frontend/src/lib/simulation-api.ts
export async function updateSceneBackend(
    conversationId: string,
    bodyUpdates: Record<string, any>,
    resimulate: boolean = false
) {
    const response = await fetch('/api/simulation/batch_update', {
        method: 'POST',
        body: JSON.stringify({
            conversation_id: conversationId,
            body_updates: bodyUpdates,
            resimulate
        })
    });
    return response.json();
}
```

#### **Phase 2-C: Interactive Mode 통합 (30분)**
```typescript
// simulation-layer.tsx
Matter.Events.on(mouseConstraint, 'enddrag', async (event) => {
    const body = event.body;
    const newPosition = fromMatterPosition(body);
    
    // Debounce - 드래그 완료 후 한 번만 호출
    await updateSceneBackend(conversationId, {
        [body.label]: { position_m: newPosition }
    }, false);  // Local Engine 계속 사용
});
```

---

## 🚫 구현하지 않을 것

### ❌ **Real-time Sync (WebSocket)**
**이유**:
- Interactive Mode는 Local Engine이 충분히 빠름
- Backend Sync는 "저장" 목적 (실시간 동기화 불필요)
- WebSocket 복잡도 증가 vs 이점 미미

### ❌ **Conflict Resolution**
**이유**:
- Single-user Interactive Mode (동시 편집 시나리오 없음)
- Context는 conversation_id로 격리됨
- 필요 시 scene_history로 rollback 가능

### ❌ **Optimistic UI Update**
**이유**:
- Local Engine이 즉시 반영 (Optimistic UI 불필요)
- Backend 호출은 "저장" 목적만

---

## 📊 타당성 평가 결과

| 요구사항 | Option A (New API) | Option B (Reuse Tools) | Option C (Hybrid) |
|---------|-------------------|----------------------|------------------|
| Frontend 친화성 | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| 코드 중복 | ⚠️ | ✅ | ✅ |
| Batch Update | ✅ | ❌ | ✅ |
| History Tracking | ⚠️ (수동) | ✅ | ✅ |
| Agent 통합 | ❌ | ✅ | ✅ |
| 구현 복잡도 | ⭐⭐ | ⭐ | ⭐⭐⭐ |
| 확장성 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

**최종 점수**:
- Option A: 70/100
- Option B: 65/100
- **Option C: 95/100** ✅

---

## 🎯 결론

### ✅ **Phase 2 구현 필요성: HIGH**

**이유**:
1. **Interactive Mode 완성**: 현재는 Local-Only → Backend 저장 필요
2. **교육적 가치**: 학생 실험 → 교사에게 공유 가능
3. **데이터 일관성**: Frontend와 Backend Scene 동기화
4. **History 관리**: 실험 과정 추적 가능

### ⚡ **권장 구현: Option C (Hybrid Batch Update)**

**핵심 API**:
```python
POST /api/simulation/batch_update
{
  "conversation_id": "abc123",
  "body_updates": {
    "massA": {"position_m": [0, 1], "mass_kg": 2.0}
  },
  "resimulate": false
}
```

**예상 공수**:
- Backend API: 2시간
- Frontend 통합: 1시간
- 테스트: 30분
- **Total: 3.5시간**

**우선순위**: **HIGH** (Interactive Mode Phase 2 완성을 위해 필수)

---

## 📝 Next Steps

1. **Phase 2-A 구현 시작**: `simulation_update.py` 생성
2. **Validation 로직 추출**: `scene_editor/_clamp_block_to_image_bounds()` 재사용
3. **Frontend API Client**: `simulation-api.ts` 추가
4. **Interactive Mode 통합**: `enddrag` 이벤트에 Backend 호출 추가
5. **Parameters Panel 통합**: Mass/Friction 변경 시 Backend Sync

구현하시겠습니까?
