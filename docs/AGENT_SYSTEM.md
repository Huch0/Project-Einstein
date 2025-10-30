# Agent-Driven Simulation System

## 🎯 Overview

Project Einstein now features a **GPT-5 Tool-Using Agent** that orchestrates the entire physics simulation pipeline through natural language interaction. Each **SimulationBox** maintains its own conversation context with the agent, enabling personalized, iterative refinement of simulations.

## 🏗️ Architecture

### Backend: Agent Tool System

```
backend/app/agent/
├── tools/
│   ├── segment_image.py       # SAM segmentation wrapper
│   ├── label_segments.py      # GPT Vision entity recognition
│   ├── validate_entities.py   # Scene type resolver
│   ├── build_scene.py         # Scene JSON builder
│   ├── simulate_physics.py    # Matter.js/analytic wrapper
│   └── analyze_results.py     # Physics analysis + insights
├── tool_registry.py           # OpenAI function schema registry
├── agent_context.py           # Conversation state management
└── labeler.py                 # (existing) Labeling logic

backend/app/routers/
└── agent.py                   # POST /agent/chat endpoint
```

### Frontend: SimulationBox Integration

```
frontend/src/
├── lib/
│   └── agent-api.ts           # Agent API client
├── hooks/
│   └── use-simulation-box-agent.ts  # Per-box agent hook
├── components/simulation/
│   └── agent-chat-panel.tsx   # Natural language chat UI
└── whiteboard/components/
    └── simulation-box-node.tsx  # Agent-enabled SimulationBox
```

## 🔄 Agent Workflow

### 1. Upload Image → Full Pipeline

```typescript
// User uploads image to SimulationBox
uploadImage(file)

// Agent orchestrates:
1. segment_image(image_data)
   → Returns: segments with bbox + polygon_px
   
2. label_segments(segments, context="physics diagram")
   → Returns: entities [{segment_id, type, props}]
   
3. validate_scene_entities(entities)
   → Returns: scene_kind="pulley.single_fixed_v0", warnings
   
4. build_physics_scene(segments, entities, mapping)
   → Returns: Scene JSON with bodies + constraints
   
5. simulate_physics(scene, engine="matter-js", duration=5s)
   → Returns: 312 frames with positions over time
   
6. analyze_simulation(frames, scene)
   → Returns: acceleration, energy conservation, motion summary
```

### 2. Natural Language Interaction

```typescript
// User asks questions
sendMessage("What is the system acceleration?")
→ Agent: "The system accelerates at 1.96 m/s². Mass B (6kg) descends..."

// User modifies parameters
sendMessage("Increase mass A to 5kg")
→ Agent: Calls build_physics_scene + simulate_physics with updated mass
→ Returns new frames

// User inspects physics
inspectSimulation()
→ Agent: Calls analyze_simulation
→ Returns: "Energy conserved within 0.1%, no constraint violations"
```

## 🎨 UI Features

### SimulationBox Header

- **Upload Button** 📤: Upload diagram → agent auto-processes
- **Inspect Button** 🧪: Analyze current simulation (energy, constraints)
- **Chat Button** 💬: Open natural language chat panel
- **State Badge**: Shows scene_kind or entity count
- **Loading Overlay**: "Agent processing..." during tool calls
- **Error Display**: Red banner for failures

### Agent Chat Panel

- **Message History**: User ↔ Agent conversation
- **Natural Language Input**: Ask anything about the simulation
- **Quick Actions**:
  - "Acceleration?" → Get system acceleration
  - "Energy Check" → Check conservation
  - "Modify Mass" → Change parameters
- **Auto-scroll**: Latest messages always visible
- **Typing Indicator**: Animated dots while agent thinks

## 📡 API Endpoints

### POST `/agent/chat`

Orchestrate simulation pipeline via natural language.

**Request:**
```json
{
  "message": "Simulate this pulley diagram",
  "conversation_id": "abc-123",  // optional
  "attachments": [{
    "type": "image",
    "data": "data:image/png;base64,..."
  }]
}
```

**Response:**
```json
{
  "assistant_message": "I found a pulley system with masses 3kg and 6kg...",
  "conversation_id": "abc-123",
  "tool_calls": [
    {"name": "segment_image", "result": {...}},
    {"name": "label_segments", "result": {...}},
    ...
  ],
  "state": {
    "segments_count": 4,
    "entities_count": 3,
    "scene_kind": "pulley.single_fixed_v0",
    "has_scene": true,
    "frames_count": 312
  }
}
```

### GET `/agent/context/{conversation_id}`

Retrieve full conversation state (messages, tool calls, segments, entities, scene, frames).

### DELETE `/agent/context/{conversation_id}`

Reset conversation and clear state.

## 🧪 Tool Registry

Each tool has strict Pydantic schemas for input/output validation:

| Tool | Input | Output |
|------|-------|--------|
| `segment_image` | image_data, mode, sam_url | segments, image metadata |
| `label_segments` | segments, context, use_vision | entities (v0.2 format) |
| `validate_scene_entities` | entities, allow_incomplete | valid, scene_kind, warnings |
| `build_physics_scene` | segments, entities, mapping | Scene JSON, warnings |
| `simulate_physics` | scene, engine, duration | frames, energy, summary |
| `analyze_simulation` | frames, scene, analysis_type | energy/constraints/motion |

Tools are automatically converted to OpenAI function calling format via `tool_registry.get_openai_function_schemas()`.

## 🔒 Conversation State

Each SimulationBox maintains isolated state:

```typescript
interface ConversationContext {
  conversation_id: string;
  image_id?: string;
  segments: Array<Segment>;
  entities: Array<Entity>;
  scene_kind?: string;
  scene?: Scene;
  frames: Array<Frame>;
  messages: Array<Message>;  // Chat history
  tool_calls: Array<ToolCall>;  // Execution log
}
```

## 🚀 Usage Example

```typescript
// 1. Create SimulationBox
const box = createSimulationBox();

// 2. Upload diagram
const file = /* user file */;
await uploadImage(file);

// Agent automatically:
// - Segments image (SAM)
// - Labels entities (GPT Vision)
// - Validates scene type
// - Builds Scene JSON
// - Simulates physics (Matter.js)
// - Returns frames for visualization

// 3. Ask questions
await sendMessage("Why does mass B move faster?");
→ "Mass B (6kg) is heavier than mass A (3kg), creating net force..."

// 4. Modify and re-simulate
await sendMessage("Set friction to 0.3");
→ Agent rebuilds scene with mu_k=0.3, re-simulates

// 5. Inspect results
await inspectSimulation();
→ "Energy drift: 0.08% (excellent), Max rope error: 0.001m"
```

## 🧩 Integration with Existing Code

### SimulationContext (Legacy)

The original `SimulationContext` (global state) **coexists** with per-box agent contexts:

- **Global**: Dashboard simulation (parseAndBind flow)
- **Per-box**: Whiteboard SimulationBox nodes (agent flow)

### Backward Compatibility

- `/diagram/parse` endpoint **still works** (monolithic)
- Agent tools wrap existing code (SAM detector, builders, physics)
- No breaking changes to existing simulations

## 📝 Testing

```bash
# Backend tool tests
cd backend
pytest tests/test_agent_tools.py -v

# Results:
✓ test_validate_scene_entities_pulley
✓ test_validate_scene_entities_ramp
✓ test_validate_scene_entities_incomplete
✓ test_label_segments_stub
```

## 🔮 Future Enhancements

- [ ] **Real GPT Vision**: Replace stub labeler with OpenAI Vision API
- [ ] **Multi-turn Editing**: "Move mass A to the left" → regenerate scene
- [ ] **Physics Teaching**: "Explain why tension equals..." → pedagogical insights
- [ ] **Scene Variants**: "What if I remove friction?" → compare scenarios
- [ ] **Export Conversations**: Save chat history + simulation data
- [ ] **Voice Input**: Speak to agent instead of typing

## 🎓 Pedagogical Value

The agent system enables:

1. **Exploratory Learning**: Students ask "what if" questions
2. **Iterative Refinement**: Modify parameters without restarting
3. **Conceptual Feedback**: Agent explains physics principles
4. **Error Guidance**: "Mass too light, system won't move" → suggestions
5. **Multi-scenario Comparison**: Track different configurations side-by-side

---

**Agent Tool System: Complete! 🎉**

Each SimulationBox is now a **self-contained physics lab** with an AI teaching assistant.
