# Unified Chat Router Migration Guide (v0.4)

## 📋 Overview

**Date:** October 30, 2025  
**Status:** ✅ Complete  
**Breaking Change:** Yes (API endpoint consolidation)

### What Changed

Merged `chat.py` and `agent.py` into **`unified_chat.py`** with two modes:
- **Ask Mode**: Normal conversation (educational Q&A)
- **Agent Mode**: Tool-enabled simulation pipeline

### New Features

1. **Mode Selection**: Single endpoint with `mode: "ask" | "agent"` parameter
2. **Streaming Support**: Server-Sent Events (SSE) for real-time tool progress
3. **Unified Context**: Single conversation ID across both modes
4. **Simplified API**: One endpoint instead of two separate routers

---

## 🔄 API Changes

### Before (v0.3)

```typescript
// Ask mode (normal chat)
POST /chat
{
  "message": "What is Newton's second law?",
  "conversation_id": "uuid"
}

// Agent mode (tool-enabled)
POST /agent/chat
{
  "message": "Simulate this diagram",
  "conversation_id": "uuid",
  "attachments": [...]
}
```

### After (v0.4)

```typescript
// Unified endpoint with mode selection
POST /chat
{
  "message": "What is Newton's second law?",
  "conversation_id": "uuid",
  "mode": "ask"  // or "agent"
}

// Agent mode with streaming
POST /chat
{
  "message": "Simulate this diagram",
  "conversation_id": "uuid",
  "mode": "agent",
  "attachments": [...],
  "stream": true  // Enable SSE
}
```

---

## 📡 Streaming API (New Feature)

### Request

```typescript
POST /chat
Content-Type: application/json

{
  "message": "Simulate this pulley diagram",
  "mode": "agent",
  "attachments": [{"type": "image", "id": "img_123"}],
  "stream": true
}
```

### Response (Server-Sent Events)

```
event: init
data: {"conversation_id": "abc-123"}

event: thinking
data: {"status": "calling_gpt"}

event: tool_start
data: {"tool": "segment_image", "index": 0, "total": 4}

event: tool_complete
data: {"tool": "segment_image", "success": true}

event: state_update
data: {"segments_count": 4, "entities_count": 0, ...}

event: tool_start
data: {"tool": "label_segments", "index": 1, "total": 4}

event: tool_complete
data: {"tool": "label_segments", "success": true}

event: state_update
data: {"segments_count": 4, "entities_count": 3, ...}

event: tool_start
data: {"tool": "build_physics_scene", "index": 2, "total": 4}

event: tool_complete
data: {"tool": "build_physics_scene", "success": true}

event: state_update
data: {"has_scene": true, ...}

event: tool_start
data: {"tool": "simulate_physics", "index": 3, "total": 4}

event: tool_complete
data: {"tool": "simulate_physics", "success": true}

event: state_update
data: {"frames_count": 312}

event: thinking
data: {"status": "generating_final_message"}

event: message
data: {"content": "Simulation complete! The system shows..."}

event: done
data: {"conversation_id": "abc-123"}
```

---

## 🎯 Mode Comparison

| Feature | Ask Mode | Agent Mode |
|---------|----------|------------|
| **Purpose** | Educational Q&A | Simulation pipeline |
| **Tool Calls** | ❌ No | ✅ Yes |
| **Streaming** | ❌ Not supported | ✅ SSE streaming |
| **Attachments** | ❌ Ignored | ✅ Images, files |
| **Context** | Chat messages | Full pipeline state |
| **Response Time** | Fast (~1-2s) | Slower (~5-30s) |

---

## 🔧 Frontend Integration

### Basic Usage (Ask Mode)

```typescript
async function askQuestion(question: string, conversationId?: string) {
  const response = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: question,
      conversation_id: conversationId,
      mode: 'ask'
    })
  });
  
  const data = await response.json();
  console.log(data.message);  // Assistant's response
  return data.conversation_id;  // For next turn
}
```

### Streaming Usage (Agent Mode)

```typescript
function streamAgentChat(
  message: string,
  attachments: Array<{type: string, id: string}>,
  conversationId?: string
) {
  const eventSource = new EventSource(
    '/chat?' + new URLSearchParams({
      message,
      mode: 'agent',
      stream: 'true',
      conversation_id: conversationId || '',
      attachments: JSON.stringify(attachments)
    })
  );
  
  eventSource.addEventListener('init', (e) => {
    const { conversation_id } = JSON.parse(e.data);
    console.log('Conversation started:', conversation_id);
  });
  
  eventSource.addEventListener('tool_start', (e) => {
    const { tool, index, total } = JSON.parse(e.data);
    showProgress(`Running ${tool} (${index + 1}/${total})...`);
  });
  
  eventSource.addEventListener('tool_complete', (e) => {
    const { tool, success } = JSON.parse(e.data);
    if (success) {
      showSuccess(`✓ ${tool} completed`);
    }
  });
  
  eventSource.addEventListener('state_update', (e) => {
    const state = JSON.parse(e.data);
    updateVisualization(state);
  });
  
  eventSource.addEventListener('message', (e) => {
    const { content } = JSON.parse(e.data);
    displayAssistantMessage(content);
  });
  
  eventSource.addEventListener('done', (e) => {
    const { conversation_id } = JSON.parse(e.data);
    eventSource.close();
    console.log('Stream complete:', conversation_id);
  });
  
  eventSource.addEventListener('tool_error', (e) => {
    const { tool, error } = JSON.parse(e.data);
    showError(`${tool} failed: ${error}`);
  });
}
```

---

## 🗂️ File Structure

### New Structure (v0.4)

```
backend/app/routers/
├── unified_chat.py       # ⭐ NEW: Unified Ask/Agent router
├── diagram.py            # Legacy monolithic endpoint
├── legacy/
│   ├── chat.py          # OLD: Ask-only router (archived)
│   └── agent.py         # OLD: Agent-only router (archived)
└── __init__.py
```

### Legacy Files

Moved to `routers/legacy/`:
- `chat.py` - Original Ask mode implementation
- `agent.py` - Original Agent mode implementation

**Status:** Kept for reference, not imported by `main.py`

---

## ✅ Migration Checklist

### Backend
- [x] Create `unified_chat.py` with Ask/Agent modes
- [x] Implement SSE streaming for Agent mode
- [x] Update `main.py` to use unified router
- [x] Move legacy files to `legacy/` folder
- [x] Verify no import errors

### Frontend (TODO)
- [ ] Update chat UI to support mode selection
- [ ] Implement SSE client for streaming
- [ ] Add progress indicators for tool execution
- [ ] Update state management for Agent mode
- [ ] Add mode toggle (Ask ↔ Agent)

---

## 🚀 Example Workflows

### Workflow 1: Educational Q&A (Ask Mode)

```
User: "Explain conservation of momentum"
  ↓
[POST /chat with mode="ask"]
  ↓
GPT responds with explanation
  ↓
User: "Can you give an example?"
  ↓
[POST /chat with same conversation_id, mode="ask"]
  ↓
GPT provides example
```

### Workflow 2: Simulation Pipeline (Agent Mode + Streaming)

```
User: "Simulate this pulley diagram" [uploads image]
  ↓
[POST /chat with mode="agent", stream=true]
  ↓
Frontend receives SSE events:
  1. tool_start: segment_image
  2. tool_complete: segment_image
  3. state_update: segments_count=4
  4. tool_start: label_segments
  5. tool_complete: label_segments
  6. state_update: entities_count=3
  7. tool_start: build_physics_scene
  8. tool_complete: build_physics_scene
  9. state_update: has_scene=true
  10. tool_start: simulate_physics
  11. tool_complete: simulate_physics
  12. state_update: frames_count=312
  13. message: "Simulation shows mass B descends..."
  14. done
  ↓
User sees real-time progress + final visualization
```

---

## 🐛 Troubleshooting

### Issue: "Streaming only supported in Agent mode"

**Cause:** Tried to use `stream=true` with `mode="ask"`

**Solution:** Remove `stream` parameter or switch to `mode="agent"`

### Issue: "Agent context not found"

**Cause:** Conversation ID from Ask mode used in Agent mode (or vice versa)

**Solution:** Context is mode-specific. Use separate conversation IDs for Ask/Agent.

### Issue: SSE connection drops

**Cause:** Long-running tool execution exceeds timeout

**Solution:** 
- Increase server timeout settings
- Client should handle reconnection
- Use non-streaming mode as fallback

---

## 📊 Performance

### Ask Mode
- **Latency:** 500-2000ms
- **Overhead:** Minimal (single GPT call)
- **Best For:** Quick questions, clarifications

### Agent Mode (Non-Streaming)
- **Latency:** 5-30s (depends on tool count)
- **Overhead:** Multiple tool executions
- **Best For:** Simple workflows, batch processing

### Agent Mode (Streaming)
- **Latency:** Same total time, but better UX
- **Overhead:** SSE connection + event serialization
- **Best For:** Interactive workflows, real-time feedback

---

## 🔮 Future Enhancements

1. **Hybrid Mode**: Auto-detect when to use tools vs plain chat
2. **Tool Parallelization**: Run independent tools concurrently
3. **Partial Results**: Stream intermediate visualization data
4. **Error Recovery**: Retry failed tools with different parameters
5. **Context Sharing**: Allow switching between Ask/Agent with same conversation

---

## 📝 Notes

- **Backward Compatibility:** Old endpoints (`/chat` for Ask, `/agent/chat` for Agent) are **removed**. Clients must migrate to unified endpoint.
- **Context Storage:** Ask mode uses `ChatRepository`, Agent mode uses `ConversationContext`. They are **not interchangeable**.
- **Streaming Format:** Uses SSE (text/event-stream), not WebSockets.
- **Tool Execution:** Sequential only (no parallel execution yet).

---

**Migration Complete** ✅  
**Next Steps:** Update frontend to use unified endpoint with mode selection and SSE streaming.
