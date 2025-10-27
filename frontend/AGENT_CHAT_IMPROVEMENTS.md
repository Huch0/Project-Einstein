# Agent Chat Panel Improvements

## 개요

Agent Chat Panel에 3가지 주요 개선사항을 적용했습니다:

1. **Context 삽입 버튼** - 다른 SimulationBox를 메시지에 참조할 수 있는 기능
2. **리사이즈 가능한 패널** - 스크롤 대신 패널 크기를 조절할 수 있는 기능
3. **헤더 버튼 가시성 개선** - 버튼이 이미지와 겹치지 않도록 배경 불투명도 개선

## 1. Context 삽입 버튼 (@mention)

### 기능 설명

- Agent Chat Panel 하단에 `@` 아이콘 버튼 추가
- 버튼 클릭 시 현재 화면의 다른 SimulationBox 목록이 팝오버로 표시됨
- Box를 선택하면 `@BoxName` 형태로 메시지에 자동 삽입
- 다른 시뮬레이션을 참조하여 비교하거나 관련 질문을 할 때 유용

### 사용 예시

```
User: "@Pulley System의 가속도와 @Ramp System의 가속도를 비교해줘"
Agent: "두 시스템의 가속도를 비교하면..."
```

### 구현 세부사항

**AgentChatPanel 인터페이스 확장:**
```tsx
export interface SimulationBoxInfo {
  id: string;
  name?: string;
}

export interface AgentChatPanelProps {
  // ... existing props
  availableBoxes?: SimulationBoxInfo[];  // NEW
}
```

**Context 버튼 UI:**
```tsx
<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline" size="icon">
      <AtSign className="h-4 w-4" />
    </Button>
  </PopoverTrigger>
  <PopoverContent>
    {availableBoxes.map(box => (
      <button onClick={() => insertBoxReference(box)}>
        {box.name || 'Unnamed Box'}
      </button>
    ))}
  </PopoverContent>
</Popover>
```

**SimulationBoxNode에서 데이터 제공:**
```tsx
const availableBoxes = orderedNodeIds
  .map(id => nodes[id])
  .filter((n): n is SimulationBoxNodeType => 
    n?.type === 'simulation-box' && n.id !== node.id
  )
  .map(n => ({ id: n.id, name: n.name }));

<AgentChatPanel
  availableBoxes={availableBoxes}
  // ...
/>
```

## 2. 리사이즈 가능한 Chat Panel

### 기능 설명

- Chat Panel의 왼쪽 가장자리를 드래그하여 폭 조절 가능
- 최소 300px, 최대 800px 범위 내에서 조절
- 드래그 중 커서가 `ew-resize`로 변경
- 리사이즈 핸들에 호버 시 GripVertical 아이콘 표시

### 구현 세부사항

**State 추가:**
```tsx
const [width, setWidth] = useState(400); // Default 400px
const resizeRef = useRef<{
  isResizing: boolean;
  startX: number;
  startWidth: number;
}>({ isResizing: false, startX: 0, startWidth: 400 });
```

**Resize 이벤트 핸들러:**
```tsx
const handleResizeStart = (e: React.MouseEvent) => {
  e.preventDefault();
  resizeRef.current = {
    isResizing: true,
    startX: e.clientX,
    startWidth: width,
  };
  document.body.style.cursor = 'ew-resize';
  document.body.style.userSelect = 'none';
};

useEffect(() => {
  const handleMouseMove = (e: MouseEvent) => {
    if (!resizeRef.current.isResizing) return;
    const deltaX = resizeRef.current.startX - e.clientX;
    const newWidth = Math.max(300, Math.min(800, 
      resizeRef.current.startWidth + deltaX
    ));
    setWidth(newWidth);
  };

  const handleMouseUp = () => {
    resizeRef.current.isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  if (resizeRef.current.isResizing) {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }
}, []);
```

**Layout 변경:**
```tsx
// Before: absolute inset-0 (fullscreen overlay)
<div className="absolute inset-0 ...">

// After: right-aligned panel with dynamic width
<div 
  className="absolute right-0 top-0 bottom-0 ..."
  style={{ width: `${width}px` }}
>
  {/* Resize Handle */}
  <div
    className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize ..."
    onMouseDown={handleResizeStart}
  >
    <GripVertical className="h-4 w-4" />
  </div>
  ...
</div>
```

## 3. 헤더 버튼 가시성 개선

### 문제점

- 기존: `bg-background/95` (95% 불투명도) → 이미지와 겹칠 때 버튼이 잘 안보임
- 버튼 배경이 없어서 이미지가 밝을 때 아이콘이 식별하기 어려움

### 해결책

**헤더 배경 완전 불투명화:**
```tsx
// Before:
className="... bg-background/95 ..."

// After:
className="... bg-background ..."  // 100% 불투명
```

**버튼에 개별 배경 추가:**
```tsx
// Before:
<button className="... hover:bg-muted">

// After:
<button className="... bg-background hover:bg-accent hover:text-accent-foreground">
```

**컨텐츠 영역 배경도 완전 불투명화:**
```tsx
// Before:
className="... bg-background/90 ..."

// After:
className="... bg-background ..."
```

### 버튼별 스타일 차별화

- **Upload/Inspect 버튼**: `hover:bg-accent` (중립적 강조)
- **Chat 버튼**: Active 시 `bg-primary` (활성 상태 명확히 표시)
- **Remove 버튼**: `hover:bg-destructive` (위험한 동작 강조)

## 사용자 경험 개선

### Before

❌ Chat Panel이 전체 화면을 덮음 (시뮬레이션 안 보임)  
❌ 긴 대화 내용 확인하려면 스크롤만 가능  
❌ 다른 Box 참조하려면 수동으로 이름 타이핑  
❌ 버튼이 밝은 이미지와 겹치면 잘 안보임

### After

✅ Chat Panel이 오른쪽에 리사이즈 가능한 패널로 표시 (시뮬레이션과 동시 확인)  
✅ 패널 폭을 조절하여 최적의 레이아웃 구성  
✅ `@` 버튼으로 다른 Box 쉽게 참조  
✅ 헤더 버튼이 항상 명확하게 보임

## 기술적 세부사항

### 의존성 추가

```tsx
import { AtSign, GripVertical } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
```

### 타입 정의

```tsx
export interface SimulationBoxInfo {
  id: string;
  name?: string;
}
```

### 상태 관리

- `width`: 패널 너비 (300-800px)
- `resizeRef`: 리사이즈 작업 상태 추적
- `input`: 메시지 입력 값 (기존)

## 테스트 시나리오

### Context 삽입 기능

1. SimulationBox 2개 이상 생성
2. 각 Box에 이름 부여 ("Pulley", "Ramp")
3. 한 Box에서 Chat Panel 열기
4. `@` 버튼 클릭
5. 다른 Box ("Ramp") 선택
6. `@Ramp`가 입력창에 자동 삽입되는지 확인
7. "Compare @Pulley and @Ramp" 메시지 전송
8. Agent가 두 시뮬레이션을 인식하는지 확인 (향후 백엔드 구현 필요)

### 리사이즈 기능

1. Chat Panel 열기
2. 왼쪽 가장자리에 마우스 호버
3. Grip 아이콘 표시 확인
4. 드래그하여 패널 폭 확대
5. 시뮬레이션과 채팅 동시 확인 가능한지 테스트
6. 최소 폭(300px) 및 최대 폭(800px) 제한 동작 확인

### 버튼 가시성

1. 밝은 색상의 이미지 업로드
2. 헤더 버튼들이 명확하게 보이는지 확인
3. 각 버튼 호버 시 배경색 변경 확인
4. Chat 버튼 토글 시 파란색 배경 확인
5. Remove 버튼 호버 시 빨간색 배경 확인

## 향후 개선사항

### Context 삽입 기능 확장

- [ ] 백엔드에서 `@BoxName` 파싱 및 해당 Box의 컨텍스트 로드
- [ ] 자동완성 기능 (타이핑 중 `@` 입력하면 Box 목록 표시)
- [ ] Box 삭제 시 참조 처리 (Orphaned references)

### 리사이즈 기능 개선

- [ ] 패널 위치 조정 (좌/우 전환)
- [ ] 최소화/최대화 버튼
- [ ] 패널 크기 localStorage에 저장 (다음 세션에도 유지)

### 버튼 레이아웃

- [ ] 더 많은 버튼 추가 시 Overflow 메뉴 고려
- [ ] 모바일/터치 디바이스 대응 (버튼 크기 조정)

## 파일 변경 내역

### 수정된 파일

1. **frontend/src/components/simulation/agent-chat-panel.tsx**
   - `SimulationBoxInfo` 타입 추가
   - `availableBoxes` prop 추가
   - Resize 핸들 및 로직 추가
   - Context 삽입 버튼 및 Popover 추가
   - Layout 변경 (fullscreen → right panel)

2. **frontend/src/whiteboard/components/simulation-box-node.tsx**
   - `availableBoxes` 계산 로직 추가
   - `AgentChatPanel`에 `availableBoxes` prop 전달
   - 헤더 버튼 스타일 개선 (`bg-background` 추가)
   - 헤더/컨텐츠 배경 불투명도 100%로 변경

### 새로 생성된 파일

- **frontend/AGENT_CHAT_IMPROVEMENTS.md** (이 문서)

## 관련 문서

- [Simulation Box Naming](./SIMULATION_BOX_NAMING.md)
- [Simulation Box Controls](./SIMULATION_BOX_CONTROLS.md)
- [Next Steps: Per-Box State](./NEXT_STEPS_PER_BOX_STATE.md)

---

**Status**: 구현 완료 ✅  
**Testing**: UI 테스트 필요 (백엔드 Context 파싱은 향후 구현)  
**Breaking Changes**: 없음 (Backward compatible)
