# Simulation Box Naming Feature

## 구현된 기능

각 시뮬레이션 BOX를 구별하고 Agent와 채팅 시 어떤 BOX에 대해 이야기하는지 명확히 표시할 수 있도록 구현했습니다.

## 주요 변경사항

### 1. **SimulationBoxNode에 name 필드 추가** ✅

**파일:** `frontend/src/whiteboard/types.ts`

```typescript
export interface SimulationBoxNode extends BaseNode {
    type: 'simulation-box';
    bounds: { width: number; height: number };
    linkedSimulationId: string;
    childIds: NodeId[];
    name?: string;  // 🆕 사용자 정의 이름
    conversationId?: string;
    agentState?: { ... };
}
```

### 2. **BOX 이름 편집 기능** ✅

**파일:** `frontend/src/whiteboard/components/simulation-box-node.tsx`

#### 기능:
- **더블클릭**으로 이름 편집 모드 진입
- **Enter** 키로 저장
- **Escape** 키로 취소
- 기본 이름: "Simulation Box"

#### UI:
```tsx
{isEditingName ? (
    <Input
        value={boxName}
        onChange={(e) => setBoxName(e.target.value)}
        onBlur={() => {
            setIsEditingName(false);
            if (boxName.trim()) {
                updateNode(node.id, (current) => {
                    if (current.type !== 'simulation-box') return current;
                    return { ...current, name: boxName.trim() };
                });
            }
        }}
        onKeyDown={(e) => {
            if (e.key === 'Enter') {
                e.currentTarget.blur();
            } else if (e.key === 'Escape') {
                setBoxName(node.name || '');
                setIsEditingName(false);
            }
        }}
        className="h-6 w-32 text-xs px-2"
        autoFocus
    />
) : (
    <span 
        className="cursor-text hover:text-foreground"
        onDoubleClick={() => setIsEditingName(true)}
    >
        {node.name || 'Simulation Box'}
    </span>
)}
```

### 3. **Agent Chat Panel에 BOX 이름 표시** ✅

**파일:** `frontend/src/components/simulation/agent-chat-panel.tsx`

```typescript
export interface AgentChatPanelProps {
  boxName?: string;  // 🆕 BOX 이름
  conversationId?: string;
  context?: AgentContext;
  onSendMessage: (message: string) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
}
```

#### 헤더에 표시:
```tsx
<span className="text-sm font-medium">
    {boxName ? `${boxName} - Agent Chat` : 'Agent Chat'}
</span>
```

**예시:**
- BOX 이름이 "Pulley System A"인 경우: `Pulley System A - Agent Chat`
- BOX 이름이 없는 경우: `Agent Chat`

### 4. **Agent 메시지에 BOX 컨텍스트 추가** ✅

**파일:** `frontend/src/hooks/use-simulation-box-agent.ts`

모든 Agent 메시지에 BOX 이름이 자동으로 포함되어 전송됩니다:

```typescript
const sendMessage = useCallback(async (message: string) => {
    // BOX 이름을 메시지 앞에 추가
    const contextualMessage = boxName 
        ? `[Regarding "${boxName}" simulation box] ${message}`
        : message;
    
    const response = await sendAgentMessage({
        message: contextualMessage,
        conversation_id: conversationId,
    });
    // ...
}, [boxId, boxName, conversationId, onConversationUpdate]);
```

#### 실제 전송 예시:

**사용자 입력:**
```
What is the acceleration?
```

**실제 Agent로 전송되는 메시지 (BOX 이름이 "Pulley System A"인 경우):**
```
[Regarding "Pulley System A" simulation box] What is the acceleration?
```

**GPT-5 Agent는 이제:**
- 어떤 시뮬레이션 BOX에 대해 이야기하는지 알 수 있음
- 여러 BOX 간 혼동 방지
- 더 정확한 컨텍스트 기반 응답 제공

## 사용자 워크플로우

### 1. BOX 이름 설정
1. Simulation Box 헤더의 "Simulation Box" 텍스트를 **더블클릭**
2. 원하는 이름 입력 (예: "Two Mass Pulley", "Inclined Plane", "Spring System")
3. **Enter** 키 누르거나 포커스 해제로 저장

### 2. Agent와 대화
1. 📤 (Upload) 버튼으로 다이어그램 업로드
2. 💬 (Chat) 버튼 클릭
3. Chat Panel 헤더에 BOX 이름 표시: `"Two Mass Pulley - Agent Chat"`
4. 메시지 입력 시 자동으로 BOX 컨텍스트 포함

### 3. 여러 BOX 관리
```
화이트보드:
┌─────────────────────────┐
│ Two Mass Pulley         │  ← BOX 1
│ [3kg]  [pulley]  [6kg]  │
└─────────────────────────┘

┌─────────────────────────┐
│ Inclined Plane          │  ← BOX 2
│    [block]              │
│   /                     │
└─────────────────────────┘
```

각 BOX는 독립적인 conversation_id와 이름을 가지므로:
- Agent는 어떤 BOX에 대한 질문인지 명확히 인식
- 사용자는 여러 시뮬레이션을 동시에 작업 가능

## 백엔드 통합

Agent 시스템 프롬프트(YAML)에서 BOX 컨텍스트를 인식하도록 이미 설정됨:

**파일:** `backend/app/agent/prompts/agent_system.yaml`

```yaml
system_prompt: |
  You are an expert physics simulation assistant...
  
  When users reference simulation boxes by name (e.g., "[Regarding "Pulley System A" simulation box]"),
  use this information to maintain context and provide accurate, box-specific responses.
```

## 예시 대화

### BOX: "Two Mass Pulley"

**User:** What is the acceleration?

**실제 전송:**
```
[Regarding "Two Mass Pulley" simulation box] What is the acceleration?
```

**Agent 응답:**
```
In the "Two Mass Pulley" system, the acceleration is 1.96 m/s².

The heavier mass (6 kg) descends while the lighter mass (3 kg) accelerates 
horizontally across the surface. This acceleration is calculated from:

a = (m₂ - μₖ·m₁)g / (m₁ + m₂)
  = (6 - 0.5×3)×9.8 / (3 + 6)
  = 1.96 m/s²
```

### BOX: "Spring Oscillator"

**User:** Increase spring constant

**실제 전송:**
```
[Regarding "Spring Oscillator" simulation box] Increase spring constant
```

**Agent 응답:**
```
I'll increase the spring constant for the "Spring Oscillator" system.
Current k = 50 N/m. What value would you like? (e.g., 75 N/m, 100 N/m)
```

## 기술적 세부사항

### State Management

```typescript
// Node state
interface SimulationBoxNode {
    name?: string;           // 사용자 정의 이름
    conversationId?: string; // Agent 대화 ID
    agentState?: {          // Agent 상태
        segments_count: number;
        entities_count: number;
        scene_kind?: string;
        has_scene: boolean;
        frames_count: number;
    };
}
```

### Hook 통합

```typescript
const {
    conversationId,
    agentState,
    context,
    loading,
    error,
    uploadImage,
    sendMessage,
    inspectSimulation,
} = useSimulationBoxAgent({
    boxId: node.id,
    boxName: node.name,  // 🆕 BOX 이름 전달
    conversationId: node.conversationId,
    onConversationUpdate: (convId, state) => {
        updateNode(node.id, (current) => {
            return {
                ...current,
                conversationId: convId,
                agentState: state,
            };
        });
    },
});
```

## UI/UX 개선사항

### 시각적 피드백
- ✅ 편집 가능한 영역 hover 시 하이라이트
- ✅ 편집 모드에서 Input 자동 포커스
- ✅ Chat Panel 헤더에 BOX 이름 표시
- ✅ BOX 이름이 없으면 기본값 "Simulation Box" 표시

### 키보드 단축키
- **더블클릭**: 이름 편집 시작
- **Enter**: 저장
- **Escape**: 취소

## 다음 단계 (선택사항)

1. **BOX 아이콘/색상 커스터마이징**
   - 각 BOX에 색상이나 아이콘 추가
   - 더 쉬운 시각적 구분

2. **BOX 태그 시스템**
   - "pulley", "ramp", "spring" 등 태그 추가
   - 필터링 및 검색 기능

3. **BOX 템플릿**
   - 자주 사용하는 설정을 템플릿으로 저장
   - 빠른 BOX 생성

4. **Agent 멀티 BOX 비교**
   - "Compare Pulley System A and B" 같은 크로스 BOX 분석
   - 여러 시뮬레이션 동시 비교

## 결론

이제 사용자는:
✅ 각 시뮬레이션 BOX에 의미있는 이름을 부여 가능
✅ Agent와 대화 시 어떤 BOX에 대해 이야기하는지 명확히 알 수 있음
✅ 여러 시뮬레이션을 동시에 관리하며 혼동 없이 작업 가능
✅ Chat Panel에서 BOX 이름이 표시되어 컨텍스트 유지

모든 변경사항이 프론트엔드에 반영되어 즉시 사용 가능합니다! 🎉
