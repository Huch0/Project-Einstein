# 🧩 Next Development Plan (Refactored v0.5 → v0.6 Editing Consistency)

## 0. Executive Summary
현재 Edit 모드에서 드래그한 위치가 화면(Matter.js)에는 반영되지만 `ParametersPanel` / 내부 `scene` 상태에는 즉시 반영되지 않아 사용자 혼란이 발생. 원인: 드래그가 로컬 Matter 바디만 갱신하고, `SimulationContext.scene`을 낙관적으로 업데이트하지 않으며, 디바운스된 `/simulation/batch_update` 응답을 소비하지 않음. 또한 좌표 변환(픽셀→미터) 미적용 가능성 존재. 목표는 “드래그 직후 파라미터 패널과 로컬 scene 동기화” + “Play 시점에서만 비용이 큰 재시뮬레이션” 구조 확립.

## 1. 핵심 문제 분석 (Root Causes)
1. 낙관적 업데이트 결여: `enddrag`에서 backend sync queue만 호출, `scene` 미변경 → 패널은 stale.
2. 좌표계 혼동 위험: canvas(pixel, y-down) → scene(meters, y-up) 변환 함수 역변환 부재.
3. 디바운스 flush 응답 미사용: `/simulation/batch_update`가 반환하는 최신 scene 무시.
4. 재생(Playback)과 편집(Edit) 상태 분리 부족: 편집 중에도 Matter Engine update(16ms) 호출 → 필요 최소화 가능.
5. `sceneModified` 활용 범위 축소: 표시/UX 정보로만 쓰이고 실제 local scene mutation 부재.

## 2. 목표 (Objectives)
| 코드 레벨 | UX 레벨 | 품질 레벨 |
|-----------|---------|-----------|
| 드래그 → local scene 즉시 반영 | 파라미터 패널 즉시 갱신 | 좌표 변환 정확도(≤ 1px 오차) |
| Play 클릭 시 flush + 재시뮬레이션 | Play 전 ‘Pending edits’ 뱃지 | 레이스 조건 제거 |
| 낙관적 scene과 backend authoritative scene 동기화 경로 확립 | Reset 시 편집 플래그 초기화 | 단일 소스(Playback=frames / Edit=scene) 명확화 |

## 3. 아키텍처 변경 전략 (High-Level Strategy)
Phase A: Local Optimistic Scene Update
Phase B: 정확한 좌표 역변환(캔버스→미터)
Phase C: Play 시점 보장형 flush + 재시뮬레이션
Phase D: Parameter Panel 바인딩 개선 (selectedEntityId 기반 실시간)
Phase E: Debounce Helper 개선 (flush 결과 반환 & 마지막 응답 캐시)
Phase F:Telemetry & Drift 검사 (옵션)

## 4. 상세 구현 계획 (Phases)
### Phase A – Local Optimistic Update (필수)
변경 파일: `SimulationContext.tsx`, `simulation-layer.tsx`
1. `SimulationContext`에 `updateBodyLocal(bodyId, updates)` 추가:
     - scene clone 후 해당 body merge.
     - position_m, mass_kg, material, velocity_m_s 지원.
2. `simulation-layer.tsx` `enddrag` 처리에서 backend 디바운스 호출 전에 `updateBodyLocal` 수행.
3. `sceneModified = true` 설정 시점은 local update 직후.

### Phase B – 좌표 역변환 유틸 추가
변경 파일: `coords.ts` (혹은 새 헬퍼 `inverseCoords.ts`)
1. `canvasToSceneMeters(xCanvas, yCanvas, transform)` 구현: 
     - metersX = (xCanvas - transform.canvasOffset.x) / transform.metersToPixels
     - metersY = - (yCanvas - transform.canvasOffset.y) / transform.metersToPixels
2. 드래그 종료 시 Matter Body position을 위 함수로 변환해 `position_m` 저장.
3. 매핑 미존재 시 경고 로그 + fallback(px=meters) (경고 수집: telemetry).

### Phase C – Play 시점 Flush + Resimulate 보장
변경 파일: `simulation-box-node.tsx`, `simulation-api.ts`
1. Play 버튼 핸들러:
     - if(sceneModified){ await debounced.flush();(응답.scene 있으면 merge) → run_sim 호출 }
     - run_sim 응답을 `loadSimulationRun()`으로 통합 (frames + scene 동시 반영).
2. 실패 처리: flush or run_sim 실패 시 사용자에게 toast/경고, 이전 frames 유지.
3. 성공 후 `sceneModified=false`.

### Phase D – ParametersPanel 동기식 갱신
변경 파일: `parameters-panel.tsx`
1. `useEffect([selectedEntityId, sceneModified, scene])`에서 선택된 body 재조회.
2. “(Edited)” 뱃지 표시: `sceneModified && !playing` 조건.
3. 수치 입력 변경 시 Interactive 모드에서는 `updateBodyLocal` + 디바운스 queue, Playback 모드에서는 즉시 `updateSceneAndResimulate`.

### Phase E – Debounce Helper 개선
변경 파일: `simulation-api.ts`
1. `flush()` 반환 타입: 실제 `BatchSceneUpdateResponse | null`.
2. 마지막 응답 캐싱 `lastResponseRef`.
3. 옵션: `mergeLocalSceneOnFlush(response.scene)` 함수로 scene 동기화(충돌 시 local 우선 or backend 우선 전략 선택).

### Phase F – Drift & Telemetry (선택)
1. 드래그 후 backend flush scene.position_m와 local scene.position_m 차이 > tolerance 시 경고.
2. 메트릭: 평균 오차(px), flush latency(ms).

## 5. 데이터 흐름 (Updated Sequence)
```
User Drag → Matter Body Move (Canvas Space)
    ↓ enddrag
Inverse Transform → position_m (meters, y-up)
    ↓
updateBodyLocal(scene) + sceneModified=true
    ↓
Debounced queue (no resimulate)
    ↓ (User may do N edits)
User presses Play
    ↓
Flush queued updates → receive authoritative scene
    ↓ (optional merge)
POST /run_sim → frames
    ↓
loadSimulationRun(frames+scene) → playing=true, sceneModified=false
```

## 6. 변경 필요 파일 목록 & 수정 요약
| File | Change Type | Summary |
|------|-------------|---------|
| `frontend/src/simulation/SimulationContext.tsx` | Add function | `updateBodyLocal`, export in context value |
| `frontend/src/components/simulation/simulation-layer.tsx` | Modify | Use inverse transform, call `updateBodyLocal` before debouncedUpdate |
| `frontend/src/lib/simulation-api.ts` | Modify | Enhance `createDebouncedBatchUpdate` flush return & cache |
| `frontend/src/whiteboard/components/simulation-box-node.tsx` | Modify | Play handler flush+merge+run_sim logic |
| `frontend/src/components/simulation/parameters-panel.tsx` | Modify | Reactive parameter read, Edited badge, local update path |
| `frontend/src/simulation/coords.ts` (or new) | Add | `canvasToSceneMeters` inverse helper |

## 7. 세부 인터페이스 (Contracts)
### `updateBodyLocal(bodyId, updates)`
Inputs: bodyId:string, updates: { position_m?, mass_kg?, material?, velocity_m_s? }
Output: void (state mutation)
Error Modes: bodyId 미존재 → console.warn

### Debounced Flush
Inputs: none
Side Effects: POST `/simulation/batch_update` with aggregated body_updates
Returns: BatchSceneUpdateResponse(scene, updated_bodies, meta)
Edge Cases: 빈 업데이트 → null

### Play Handler Logic (Pseudo)
```typescript
async function onPlay(){
    if(sceneModified){
        const flushResp = await debounced.flush();
        if(flushResp?.scene){ mergeLocalScene(flushResp.scene); }
        const runResp = await runSim(conversationId, cfg.duration);
        await loadSimulationRun(runResp.simulation); // unify
        setSceneModified(false);
    } else {
        setPlaying(true);
    }
}
```

## 8. 테스트 계획 (Test Plan)
Unit:
1. `canvasToSceneMeters` 변환 정확도 (역변환 후 다시 forward 변환 시 오차 < 1e-6).
2. `updateBodyLocal`가 동일한 body 인스턴스 아닌 clone에 반영되는지.
3. Debounce flush 빈 큐 → null 반환.

Integration:
1. Drag → ParametersPanel position 즉시 변경.
2. 다중 드래그 후 Play → 첫 프레임 위치 = 마지막 드래그 위치.
3. Drag 후 즉시 Play (< debounce delay) → flush 강제 수행, 위치 반영.
4. Reset 후 sceneModified=false & frames 재생성 안 함.

Manual UX:
1. Edited Badge 표시/사라짐 타이밍.
2. 실패 시 토스트: 네트워크 단절 환경 시 degrade (local scene 유지, 재시뮬 버튼 재시도).

Performance:
1. 50 드래그 연속 → API 호출 1회 (flush)만 발생.
2. 평균 flush latency < 150ms (로컬 dev 기준).

## 9. 위험 & 대응 (Risks & Mitigations)
| Risk | Impact | Mitigation |
|------|--------|-----------|
| 좌표 역변환 오류 | 잘못된 물리 초기 조건 | 단위 테스트 + 로그 비교(px↔m) |
| 낙관적 scene와 backend scene 충돌 | 위치 덮어쓰기 | 마지막 flush 시 backend 우선 전략 + drift 로그 |
| Play 직전 flush race | 프레임 불일치 | Play handler에서 await strict sequence |
| 성능 저하 (scene clone 반복) | 렌더 지연 | 최소 필드만 shallow merge, vertices untouched |
| 대규모 body 수(>200) | 메모리/복제 비용 증가 | 향후 diff 기반 patch (v0.7) 로드맵에 추가 |

## 10. 측정 지표 (Metrics)
1. Edit→Parameter 반영 시간(ms) (target < 50ms).
2. 드래그 시 평균 CPU 사용(%) 변화.
3. Flush latency(ms).
4. Drift 발생 건수 (scene vs backend) / 일.

## 11. 구현 체크리스트 (Actionable)
[-] A1 add updateBodyLocal
[-] A2 call in enddrag before debouncedUpdate
[-] B1 implement canvasToSceneMeters
[-] B2 replace naive position extraction
[-] C1 modify Play handler (flush+run_sim)
[-] C2 unify loadSimulationRun response parsing
[ ] D1 panel reactive effect
[ ] D2 edited badge UI
[ ] E1 debounce flush returns response
[ ] E2 mergeLocalScene on flush
[ ] Tests unit & integration
※ 완료되면 위 체크박스 업데이트

## 12. 향후 로드맵 (Beyond v0.6)
v0.7 – Diff-based scene patches, constraint interactive editing (length, stiffness), WebSocket live progress for resimulation.
v0.8 – Multi-user edit locks, undo/redo command stack, drift auto-resolution.
v0.9 – Predictive pre-simulation (speculative frames) & energy/tension live overlay.

## 13. 승인 기준 (Acceptance Criteria)
1. Drag 후 ParametersPanel position 즉시 반영.
2. Edited 상태에서 Play → 새 프레임 첫 body 위치 = 마지막 편집 위치.
3. 좌표 변환 테스트 통과 (<1px equivalent 오차).
4. 불필요한 다중 API 호출 없음 (연속 드래그 1회 flush).
5. 실패 시 사용자 재시도 경로 명확.

---
Status: Draft Plan Ready for Implementation  
Owner: Simulation Subsystem  
Last Updated: 2025-11-08

   - Console: `🔄 Scene modified, resimulating...`
   - Console: `✅ Resimulation complete: X frames`
   - Verify: Object starts from NEW position ✅

3. **Multiple Edits Test:**
   - Reset → Edit → Drag object A → Drag object B
   - Click Play
   - Verify: Both objects start from new positions ✅

4. **Reset Test:**
   - After editing → Click Reset
   - sceneModified should be false
   - Click Play → No resimulation (uses original scene)

### Success Criteria
- [ ] `sceneModified` flag tracks edit state
- [ ] Play button triggers resimulation when flag is true
- [ ] New frames generated with updated positions
- [ ] Playback starts from dragged positions
- [ ] Reset clears modified flag
- [ ] No resimulation when playing unmodified scene

### Estimated Time
- Step 1: 10 minutes (state addition)
- Step 2: 5 minutes (flag setting)
- Step 3: 15 minutes (API wrapper)
- Step 4: 30 minutes (Play button logic)
- Step 5: 5 minutes (reset update)
- Testing: 20 minutes
**Total: ~1.5 hours**

---

## 🎯 Context-aware Simulation Integration (Future)

### Goal
시뮬레이션 시스템에서 이미지, 컨텍스트, 채팅을 통합해  
사용자의 의도를 이해하고 시뮬레이션을 직접 제어할 수 있도록 한다.

---

## 1️⃣ 이미지 및 시뮬레이션 박스의 Context 전달

### 목표
사용자가 업로드한 이미지와 해당 이미지에 연결된 **시뮬레이션 박스 정보(simulation box metadata)**를  
채팅 입력 시점에서 LLM에게 Context로 함께 전달할 수 있도록 한다.

### UX
- 채팅 입력창의 **"+" 버튼**을 통해 명시적으로 추가
- LLM은 입력된 이미지 및 시뮬레이션 정보를 함께 인식
- 시뮬레이션 상태, 객체, 파라미터 등을 이해하고 reasoning에 활용

### 예시 구조
```json
{
  "user_message": "이 부분을 좀 더 밝게 조정해줘",
  "context": {
    "image_box": {
      "id": "img_5678",
      "image_url": "...",
      "metadata": {...}
    },
    "simulation_box": {
      "id": "sim_1234",
      "objects": [...],
      "parameters": {...}
    }
  }
}
```

### 구현 요구사항
- [ ] ChatInput에 "+" 버튼 추가 (context attachment UI)
- [ ] SimulationBox/ImageBox 선택 모달 구현
- [ ] 선택된 box의 metadata를 API 요청에 포함
- [ ] Backend: `/chat` endpoint에서 context 파싱 및 LLM에 전달

---

## 2️⃣ ASK 모드의 Context 활용

### 목표
"ASK 모드" (질의응답 중심 모드)에서도 동일한 Context를 활용할 수 있게 한다.

### 사용 시나리오
- 사용자: "이 설정이 왜 이렇게 돼 있어?"
- LLM: 시뮬레이션 Context를 참고하여 현재 상태, 값, 연관 규칙 등을 설명

### 구현 요구사항
- [ ] ASK 모드와 일반 채팅 모드에서 동일한 context 전달 구조 공유
- [ ] Backend: mode=`"ask"` 일 때도 context 인식
- [ ] LLM prompt에 "explain current state" instruction 추가

---

## 3️⃣ Refinement 요청 시 Tool 기반 시뮬레이션 조작

### 목표
사용자가 채팅을 통해 시뮬레이션의 일부를 **"수정(refine)"** 하길 원할 때,  
LLM은 채팅 메시지 + Context 정보를 종합적으로 이해해  
**"어떤 부분을 어떻게 수정해야 하는지"**를 추론한다.

### 동작 방식
1. LLM이 수정 의도 파악
2. 기존에 정의된 **tool 함수(API)** 호출
   - 예: `updateSimulation(params)`, `adjustLighting(area, intensity)` 등
3. LLM은 직접 시뮬레이션 로직을 재작성하지 않고 **tool invocation** 형식으로 수정 명령 전달

### 구현 요구사항
- [ ] Tool catalog 정의 (수정 가능한 작업 목록)
  - `update_mass(body_id, mass_kg)`
  - `update_position(body_id, x, y)`
  - `update_constraint(constraint_id, params)`
  - `re_simulate(conversation_id, duration_s)`
- [ ] Backend: LLM tool call → tool 실행 → 시뮬레이션 업데이트
- [ ] Frontend: 수정 결과 반영 (frames 재로드, UI 갱신)

---

## 📍 현재 상태 (v0.5.0)

### ✅ 완료된 것
- `/init_sim`: 이미지 → 세그먼트 → 엔티티 → 씬 빌드
- `/run_sim`: 시뮬레이션 실행 + 프레임 생성
- GlobalChat: 통합 채팅 상태 관리
- SimulationBoxAgent: 각 박스별 agent 연결

### ❌ 구현 필요
- Context attachment UI ("+" 버튼)
- Backend context parsing
- Tool catalog for refinement
- LLM tool invocation 처리

---

## 🛠️ 구현 순서

### Phase 1: Context Attachment UI
1. `ChatInput` 컴포넌트에 "+" 버튼 추가
2. Box 선택 모달 (`SelectBoxModal` 컴포넌트)
3. 선택된 box metadata를 `attachments` 배열에 추가
4. API 호출 시 `context` 필드에 포함

### Phase 2: Backend Context Handling
1. `/chat` endpoint에서 `context` 필드 파싱
2. LLM system prompt에 context 정보 삽입
3. ASK 모드에서도 동일한 로직 적용

### Phase 3: Tool-based Refinement
1. Tool catalog 정의 (`backend/app/agent/tools/simulation_refinement.py`)
2. LLM에게 tool schema 전달
3. Tool call 결과 → 시뮬레이션 업데이트 → 프론트엔드 반영

---

## 📂 핵심 파일

- **Frontend**
  - `components/chat/chat-input.tsx`: "+" 버튼, context attachment
  - `contexts/global-chat-context.tsx`: context 관리
  - `lib/agent-api.ts`: API 호출 시 context 포함

- **Backend**
  - `routers/unified_chat.py`: context 파싱
  - `agent/tools/simulation_refinement.py`: refinement tools
  - `agent/prompts/agent_system.yaml`: context-aware prompt