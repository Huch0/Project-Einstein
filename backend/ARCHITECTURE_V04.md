# Project Einstein v0.4 - Architecture Overview

> [DEPRECATED IN v0.5] This document describes the v0.4 chat-driven initialization flow. As of v0.5, initialization is handled via the new two-phase workflow with /init_sim and /run_sim. See .github/instructions/instruction.instructions.md for the current spec. The /chat endpoint remains for Q&A only and is not used for initialization.

## 🎯 Chat & Agent Integration Complete

```
┌─────────────────────────────────────────────────────────────────┐
│                     Frontend (Next.js)                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐               │
│  │ Chat Panel │  │ Simulation │  │ Code Panel │               │
│  │ [Ask Mode] │  │   Canvas   │  │            │               │
│  │ [Agt Mode] │  │            │  │            │               │
│  └─────┬──────┘  └─────┬──────┘  └────────────┘               │
└────────┼───────────────┼─────────────────────────────────────────┘
         │               │
         │ POST /chat    │
         │ mode=ask|agent│
         │ stream=true   │
         ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Backend (FastAPI v0.4)                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Unified Chat Router (/chat)                    │  │
│  │                                                          │  │
│  │  ┌────────────────┐        ┌────────────────┐          │  │
│  │  │   Ask Mode     │        │  Agent Mode    │          │  │
│  │  │                │        │                │          │  │
│  │  │ • GPT Q&A      │        │ • Tool Calls   │          │  │
│  │  │ • No tools     │        │ • SSE Stream   │          │  │
│  │  │ • Fast (~1s)   │        │ • State Mgmt   │          │  │
│  │  └────────────────┘        └───────┬────────┘          │  │
│  │                                    │                    │  │
│  └────────────────────────────────────┼────────────────────┘  │
│                                       │                       │
│                                       ▼                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Tool Registry (6 Tools)                     │  │
│  │                                                          │  │
│  │  1. segment_image      - SAM segmentation (HTTP/stub)   │  │
│  │  2. label_segments     - GPT entity recognition         │  │
│  │  3. validate_entities  - Scene validation               │  │
│  │  4. build_scene        - Universal Builder              │  │
│  │  5. simulate_physics   - Matter.js simulation           │  │
│  │  6. analyze_results    - Physics analysis               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            Universal Physics Builder                     │  │
│  │                                                          │  │
│  │  • No scene-kind restrictions                           │  │
│  │  • Dynamic constraint inference                         │  │
│  │  • N-body support (1 to ∞)                              │  │
│  │  • Matter.js only (no analytic)                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 📊 API Endpoints

### v0.4 (Current)
```
POST   /chat                    # Unified Ask/Agent endpoint ⭐
GET    /chat/conversations      # List all conversations
GET    /chat/context/{id}       # Get Agent context
DELETE /chat/context/{id}       # Delete conversation

POST   /diagram/parse           # Legacy monolithic endpoint
GET    /health                  # Health check
```

### v0.3 (Deprecated)
```
❌ POST   /chat                  # Removed (Ask only)
❌ POST   /agent/chat            # Removed (Agent only)
```

## 🔄 Request Flow

### Ask Mode (Normal Chat)
```
User → "What is F=ma?"
  ↓
POST /chat {mode: "ask", message: "..."}
  ↓
GPT-4/5 API (no tools)
  ↓
Response: "Newton's second law..."
```

### Agent Mode (Tool-Enabled, Streaming)
```
User → "Simulate this diagram" + [image]
  ↓
POST /chat {mode: "agent", stream: true, attachments: [...]}
  ↓
┌─────────────────────────────────────────┐
│ SSE Stream (Real-time progress)         │
│                                         │
│ 1. tool_start: segment_image            │
│    → SAM segments image                 │
│ 2. tool_complete: segment_image         │
│                                         │
│ 3. tool_start: label_segments           │
│    → GPT labels entities                │
│ 4. tool_complete: label_segments        │
│                                         │
│ 5. tool_start: build_physics_scene      │
│    → Universal Builder creates scene    │
│ 6. tool_complete: build_physics_scene   │
│                                         │
│ 7. tool_start: simulate_physics         │
│    → Matter.js runs simulation          │
│ 8. tool_complete: simulate_physics      │
│                                         │
│ 9. message: "Simulation shows..."       │
│ 10. done                                │
└─────────────────────────────────────────┘
```

## 🎨 Frontend Integration

### Mode Toggle (GitHub Copilot Style)
```typescript
<div className="chat-mode-toggle">
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
```

### SSE Client
```typescript
const eventSource = new EventSource('/chat?mode=agent&stream=true&...');

eventSource.addEventListener('tool_start', (e) => {
  const {tool} = JSON.parse(e.data);
  showProgress(`Running ${tool}...`);
});

eventSource.addEventListener('tool_complete', (e) => {
  updateUI('✓ Complete');
});

eventSource.addEventListener('message', (e) => {
  displayFinalMessage(JSON.parse(e.data).content);
});
```

## 📁 File Structure

```
backend/app/
├── main.py                        # FastAPI app (v0.4)
├── routers/
│   ├── unified_chat.py           # ⭐ NEW: Ask + Agent unified
│   ├── diagram.py                # Legacy endpoint
│   ├── UNIFIED_CHAT_MIGRATION.md # Migration guide
│   └── legacy/
│       ├── chat.py               # OLD: Ask only (backup)
│       └── agent.py              # OLD: Agent only (backup)
├── agent/
│   ├── tools/
│   │   ├── segment_image.py     # SAM (HTTP/stub integrated)
│   │   ├── label_segments.py    # GPT labeling (standalone)
│   │   ├── validate_entities.py
│   │   ├── build_scene.py       # Uses universal_builder
│   │   ├── simulate_physics.py  # Matter.js only
│   │   └── analyze_results.py
│   ├── prompts/
│   │   ├── agent_system.yaml    # v0.4.0
│   │   └── labeler_system.yaml  # v0.4.0
│   ├── tool_registry.py
│   └── agent_context.py
├── sim/
│   ├── universal_builder.py     # Dynamic scene construction
│   ├── schema.py                # Flexible v0.4.0 schema
│   └── physics/
│       └── matter_engine.py     # Matter.js wrapper
├── chat/
│   ├── engine.py                # Ask mode chat engine
│   ├── repository.py            # Conversation storage
│   └── schemas.py
└── models/
    └── settings.py

❌ Deleted (v0.4):
- pipeline/sam_detector.py        # Integrated into segment_image.py
- agent/labeler.py                 # Integrated into label_segments.py
- sim/physics/analytic.py          # Removed (Matter.js only)
- sim/builder.py, registry.py      # Replaced by universal_builder.py
```

## 🔧 Configuration

### Environment Variables
```bash
# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-2024-11-20
OPENAI_TEMPERATURE=0.7
OPENAI_MAX_OUTPUT_TOKENS=4000

# Chat Mode
CHAT_SYSTEM_PROMPT="You are a physics tutor..."

# Labeler Mode (Agent)
LABELER_MODE=openai  # or "stub"

# SAM Segmentation
SAM_MODE=http        # or "stub"
SAM_HTTP_URL=http://localhost:9001/segment
```

## 📊 Performance Metrics

| Metric | Ask Mode | Agent (No Stream) | Agent (Streaming) |
|--------|----------|-------------------|-------------------|
| **First Response** | ~1s | ~30s | ~1s (init) |
| **Total Time** | ~1-2s | ~30s | ~30s |
| **User Experience** | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Tool Calls** | 0 | 4-6 | 4-6 |
| **Network** | 1 request | 1 request | SSE stream |

## 🚀 Next Steps

### Backend ✅ (Complete)
- [x] Unified router implementation
- [x] Ask mode
- [x] Agent mode
- [x] SSE streaming
- [x] Context management
- [x] Documentation

### Frontend ⬜ (TODO)
- [ ] Mode toggle UI (Ask ↔ Agent)
- [ ] SSE client implementation
- [ ] Progress indicator
- [ ] State management updates
- [ ] Tool execution visualization
- [ ] Error handling

### Testing ⬜ (TODO)
- [ ] Ask mode: Q&A flow
- [ ] Agent mode: Full pipeline
- [ ] Streaming: Event handling
- [ ] Error cases: Tool failures
- [ ] Performance: Load testing

## 🎉 Summary

### What We Built
✅ **Unified Chat Router** - Single endpoint for Ask/Agent modes  
✅ **SSE Streaming** - Real-time tool execution progress  
✅ **Mode Separation** - Clean Ask (chat) vs Agent (tools) logic  
✅ **Type Safety** - Pydantic schemas for all requests/responses  
✅ **Documentation** - Comprehensive migration guide

### Breaking Changes
❌ `/chat` (Ask only) → ✅ `/chat` (Ask + Agent with mode param)  
❌ `/agent/chat` → ✅ `/chat` (mode="agent")  
❌ No streaming → ✅ SSE streaming support

### Key Benefits
1. **Simplified API** - One endpoint instead of two
2. **Better UX** - Real-time progress in Agent mode
3. **Cleaner Code** - Reduced duplication
4. **Scalable** - Easy to add new modes (e.g., "hybrid")

---

**Status:** ✅ Backend Complete  
**Version:** v0.4.0  
**Date:** October 30, 2025
