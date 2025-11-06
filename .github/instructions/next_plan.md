# 🧩 Context-aware Simulation Integration

## 🎯 Goal
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