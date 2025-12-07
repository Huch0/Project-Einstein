# Chat & Agent Integration Summary (v0.4)

> [DEPRECATED IN v0.5] The chat-based initialization workflow described here has been replaced. Use the /init_sim (initialization) and /run_sim (execution) endpoints as specified in .github/instructions/instruction.instructions.md. Keep /chat for Q&A; do not use it for image upload or initialization.

## ✅ 완료된 작업

### 1. **Unified Chat Router 구현** (`unified_chat.py`)

**핵심 기능:**
- ✅ Ask Mode: 일반 대화 (교육용 Q&A)
- ✅ Agent Mode: Tool 사용 (시뮬레이션 파이프라인)
- ✅ SSE Streaming: 실시간 진행 상황 업데이트
- ✅ 단일 엔드포인트 (`POST /chat`)

**코드 통계:**
- 새로 작성: `unified_chat.py` (700+ lines)
- 기존 분리: `chat.py` + `agent.py` → `legacy/` 폴더로 이동
- API 엔드포인트: 4개 (chat, list_conversations, get_context, delete_context)

---

## 📊 Before vs After

### Before (v0.3)

```
backend/app/routers/
├── chat.py       # Ask mode만 지원
├── agent.py      # Agent mode만 지원
└── diagram.py    # Legacy endpoint

main.py:
  app.include_router(chat.router)      # /chat
  app.include_router(agent_router.router)  # /agent/chat
```

**문제점:**
- 두 개의 분리된 엔드포인트
- Streaming 지원 없음
- 중복된 conversation 관리 로직
- 모드 전환 불가

### After (v0.4)

```
backend/app/routers/
├── unified_chat.py   # ⭐ Ask + Agent 통합
├── diagram.py        # Legacy (호환성 유지)
└── legacy/
    ├── chat.py       # 백업
    └── agent.py      # 백업

main.py:
  app.include_router(unified_chat.router)  # /chat (Ask + Agent)
```

**개선점:**
- ✅ 단일 엔드포인트 (`/chat`)
- ✅ SSE Streaming 지원
- ✅ Mode 파라미터로 동작 제어 (`mode: "ask" | "agent"`)
- ✅ 통합된 context 관리

---

## 🎯 API 사용법

### Ask Mode (일반 대화)

```typescript
// 요청
POST /chat
{
  "message": "What is Newton's second law?",
  "conversation_id": "optional-uuid",
  "mode": "ask"
}

// 응답
{
  "message": "Newton's second law states that F = ma...",
  "conversation_id": "uuid",
  "mode": "ask",
  "tool_calls": [],
  "state": {}
}
```

**특징:**
- GPT와 직접 대화
- Tool 호출 없음
- 빠른 응답 (~1-2초)
- 교육용 Q&A에 최적화

---

### Agent Mode (Tool 사용, Non-Streaming)

```typescript
// 요청
POST /chat
{
  "message": "Simulate this pulley diagram",
  "conversation_id": "optional-uuid",
  "mode": "agent",
  "attachments": [
    {"type": "image", "id": "img_123"}
  ],
  "stream": false
}

// 응답
{
  "message": "Simulation complete! Mass B descends at 1.96 m/s²...",
  "conversation_id": "uuid",
  "mode": "agent",
  "tool_calls": [
    {"name": "segment_image", "arguments": {...}, "result": {...}},
    {"name": "label_segments", "arguments": {...}, "result": {...}},
    {"name": "build_physics_scene", "arguments": {...}, "result": {...}},
    {"name": "simulate_physics", "arguments": {...}, "result": {...}}
  ],
  "state": {
    "segments_count": 4,
    "entities_count": 3,
    "has_scene": true,
    "frames_count": 312
  }
}
```

**특징:**
- Tool 자동 실행
- 전체 완료 후 응답
- 느린 응답 (~5-30초)
- 단순한 workflow에 적합

---

### Agent Mode (Streaming) ⭐ NEW

```typescript
// 요청
POST /chat
{
  "message": "Simulate this pulley diagram",
  "mode": "agent",
  "attachments": [{"type": "image", "id": "img_123"}],
  "stream": true
}

// 응답 (Server-Sent Events)
event: init
data: {"conversation_id": "abc-123"}

event: tool_start
data: {"tool": "segment_image", "index": 0, "total": 4}

event: tool_complete
data: {"tool": "segment_image", "success": true}

event: state_update
data: {"segments_count": 4}

event: tool_start
data: {"tool": "label_segments", "index": 1, "total": 4}

event: tool_complete
data: {"tool": "label_segments", "success": true}

event: state_update
data: {"entities_count": 3}

event: message
data: {"content": "Simulation complete!"}

event: done
data: {"conversation_id": "abc-123"}
```

**특징:**
- ✅ 실시간 진행 상황 표시
- ✅ Tool 실행 중 UI 업데이트 가능
- ✅ 사용자 경험 대폭 개선
- ✅ 대화형 workflow에 최적화

---

## 🎨 Frontend 구현 예시

### React Component (Mode Toggle)

```typescript
function ChatPanel() {
  const [mode, setMode] = useState<'ask' | 'agent'>('ask');
  const [message, setMessage] = useState('');
  const [conversationId, setConversationId] = useState<string>();
  
  return (
    <div>
      {/* Mode Toggle (코파일럿 스타일) */}
      <div className="mode-toggle">
        <button 
          className={mode === 'ask' ? 'active' : ''}
          onClick={() => setMode('ask')}
        >
          💬 Ask
        </button>
        <button 
          className={mode === 'agent' ? 'active' : ''}
          onClick={() => setMode('agent')}
        >
          🤖 Agent
        </button>
      </div>
      
      {/* Input */}
      <input 
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={
          mode === 'ask' 
            ? "Ask about physics concepts..."
            : "Describe what you want to simulate..."
        }
      />
      
      {/* Send Button */}
      <button onClick={() => sendMessage(message, mode, conversationId)}>
        Send
      </button>
    </div>
  );
}
```

### SSE Client (Streaming)

```typescript
function StreamingChatClient() {
  const [progress, setProgress] = useState<string[]>([]);
  
  function startStreaming(message: string, attachments: any[]) {
    const eventSource = new EventSource(
      `/chat?${new URLSearchParams({
        message,
        mode: 'agent',
        stream: 'true',
        attachments: JSON.stringify(attachments)
      })}`
    );
    
    eventSource.addEventListener('tool_start', (e) => {
      const { tool, index, total } = JSON.parse(e.data);
      setProgress(prev => [
        ...prev, 
        `[${index + 1}/${total}] Running ${tool}...`
      ]);
    });
    
    eventSource.addEventListener('tool_complete', (e) => {
      const { tool, success } = JSON.parse(e.data);
      if (success) {
        setProgress(prev => [
          ...prev.slice(0, -1),
          `✓ ${tool} completed`
        ]);
      }
    });
    
    eventSource.addEventListener('state_update', (e) => {
      const state = JSON.parse(e.data);
      updateVisualization(state);
    });
    
    eventSource.addEventListener('message', (e) => {
      const { content } = JSON.parse(e.data);
      displayMessage(content);
    });
    
    eventSource.addEventListener('done', () => {
      eventSource.close();
      setProgress([]);
    });
  }
  
  return (
    <div>
      {progress.map((msg, i) => (
        <div key={i} className="progress-item">{msg}</div>
      ))}
    </div>
  );
}
```

---

## 📁 파일 구조 변경

```diff
backend/app/
├── routers/
-   ├── chat.py                  # REMOVED (→ legacy/)
-   ├── agent.py                 # REMOVED (→ legacy/)
+   ├── unified_chat.py          # NEW (Ask + Agent 통합)
+   ├── UNIFIED_CHAT_MIGRATION.md  # NEW (마이그레이션 가이드)
+   ├── legacy/
+   │   ├── chat.py             # BACKUP
+   │   └── agent.py            # BACKUP
    └── diagram.py               # UNCHANGED

main.py:
- from .routers import chat
- from .routers import agent as agent_router
+ from .routers import unified_chat

- app.include_router(chat.router)
- app.include_router(agent_router.router)
+ app.include_router(unified_chat.router)
```

---

## 🚀 다음 단계 (Frontend 작업)

### 1. **Mode Toggle UI 추가**
- [ ] Ask/Agent 모드 전환 버튼
- [ ] 모드별 placeholder 텍스트 변경
- [ ] 모드별 아이콘 표시

### 2. **SSE Client 구현**
- [ ] EventSource 연결 관리
- [ ] Progress indicator UI
- [ ] Tool 실행 상태 시각화

### 3. **State Management 업데이트**
- [ ] Agent mode state 저장
- [ ] Streaming 중간 결과 처리
- [ ] Error handling

### 4. **기존 코드 마이그레이션**
- [ ] `/chat` → `/chat` (mode 파라미터 추가)
- [ ] `/agent/chat` → `/chat` (mode="agent")
- [ ] Streaming API 사용으로 전환

---

## 🐛 알려진 제한사항

### 1. **Context 분리**
- Ask mode: `ChatRepository` 사용
- Agent mode: `ConversationContext` 사용
- **Issue:** 같은 conversation_id로 모드 전환 불가
- **Workaround:** 모드별 별도 conversation ID 사용

### 2. **Streaming in Ask Mode**
- Ask mode는 streaming 미지원
- **Reason:** Tool 호출이 없어 progress 이벤트가 없음
- **Future:** GPT streaming API 연동 고려

### 3. **Sequential Tool Execution**
- Tool들이 순차 실행됨 (병렬 실행 미지원)
- **Impact:** 긴 대기 시간
- **Future:** 독립적인 tool들은 병렬 실행 고려

---

## ✅ 완료 체크리스트

### Backend ✅
- [x] `unified_chat.py` 작성 (700+ lines)
- [x] Ask mode 구현
- [x] Agent mode 구현
- [x] SSE streaming 구현
- [x] `main.py` 업데이트
- [x] Legacy 파일 백업
- [x] Migration 문서 작성

### Frontend ⬜ (다음 단계)
- [ ] Mode toggle UI
- [ ] SSE client 구현
- [ ] Progress indicator
- [ ] State management 업데이트
- [ ] 기존 API 호출 마이그레이션

---

## 🎉 요약

### 핵심 변경사항
1. ✅ Chat + Agent → **Unified Router** 통합
2. ✅ Ask/Agent **Mode 분리** (단일 엔드포인트)
3. ✅ **SSE Streaming** 지원 (실시간 진행 상황)
4. ✅ Legacy 코드 백업 (`routers/legacy/`)

### 사용자 경험 개선
- ✅ 코파일럿 스타일 Ask/Agent 모드 전환
- ✅ 실시간 tool 실행 progress 표시
- ✅ 중간 상태 시각화 가능
- ✅ 단일 conversation context

### 코드 품질
- ✅ 중복 제거 (chat + agent 로직 통합)
- ✅ 명확한 모드 분리
- ✅ Type-safe Pydantic schemas
- ✅ 상세한 문서화

---

**Status:** ✅ Backend 완료, Frontend 작업 대기  
**Next:** Frontend에서 unified endpoint 사용 + SSE 연동
