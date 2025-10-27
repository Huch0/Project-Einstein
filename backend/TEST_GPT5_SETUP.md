# GPT-5 Agent 설정 완료

## 완료된 작업

### 1. 프롬프트 YAML 파일 생성 ✅
- `app/agent/prompts/agent_system.yaml`: Agent 시스템 프롬프트
- `app/agent/prompts/labeler_system.yaml`: Labeler 시스템 프롬프트
- `app/agent/prompts/__init__.py`: 프롬프트 로딩 유틸리티

### 2. GPT-5 Responses API 통합 ✅
- **Labeler** (`app/agent/labeler.py`):
  - YAML에서 프롬프트 로드
  - GPT-5 Responses API 사용
  - Fallback to stub on error
  
- **Agent** (`app/routers/agent.py`):
  - GPT-5 / GPT-4 자동 감지
  - GPT-5: `client.responses.create()` 사용
  - GPT-4: `client.chat.completions.create()` 사용 (fallback)

### 3. Settings 업데이트 ✅
```python
LABELER_MODEL: str = "gpt-5"  # GPT-5 with Responses API
OPENAI_MODEL: str = "gpt-5"   # GPT-5 for agent chat
OPENAI_TEMPERATURE: float = 1.0  # GPT-5 only supports default (1.0)
```

### 4. GPT-5 호환성 처리 ✅
- **Temperature**: GPT-5는 기본값 1.0만 지원 (다른 값 불가)
- **max_tokens**: None일 때 전달하지 않음
- 조건부 파라미터 전달로 GPT-4/GPT-5 모두 지원
- `pyyaml>=6.0.3` (pyproject.toml에 추가됨)

## 테스트 결과

### Agent Tools Tests
```bash
uv run pytest tests/test_agent_tools.py -v
```
- ✅ test_validate_scene_entities_pulley
- ✅ test_validate_scene_entities_ramp
- ✅ test_validate_scene_entities_incomplete
- ✅ test_label_segments_stub

**전체 테스트 PASS**

## 사용 방법

### 1. 환경 변수 설정
`.env` 파일에 추가:
```bash
OPENAI_API_KEY=your_gpt5_api_key_here
LABELER_MODE=openai
SAM_MODE=http
SAM_HTTP_URL=http://localhost:9001/segment
```

### 2. 백엔드 서버 시작
```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
```

### 3. Agent 엔드포인트 테스트
```bash
POST http://localhost:8000/agent/chat
Content-Type: application/json

{
  "message": "Simulate this pulley diagram",
  "attachments": [
    {
      "type": "image",
      "id": "test_image",
      "data": "base64_encoded_image..."
    }
  ]
}
```

## GPT-5 Responses API 사용 예시

### Labeler (label_segments)
```python
# Input payload
{
  "instruction": "<system_prompt from YAML>",
  "user_request": "<user_prompt with segments>",
  "segments": [{"id": "1", "bbox": [x, y, w, h]}, ...]
}

# API Call
resp = client.responses.create(
    model="gpt-5",
    input=json.dumps(input_payload),
    reasoning={"effort": "minimal"},
    text={"verbosity": "low"},
)

# Output
{
  "entities": [
    {"id": "1", "label": "mass", "props": {"mass_guess_kg": 3.0}},
    {"id": "2", "label": "pulley", "props": {"wheel_radius_m": 0.1}}
  ]
}
```

### Agent (chat endpoint)
```python
# Input
{
  "conversation_history": [
    {"role": "system", "content": "<agent_system_prompt from YAML>"},
    {"role": "user", "content": "Simulate this pulley"}
  ],
  "available_tools": [...]
}

# API Call (GPT-5 자동 감지)
if settings.OPENAI_MODEL.startswith("gpt-5"):
    response = client.responses.create(
        model=settings.OPENAI_MODEL,
        input=json.dumps({...}),
        reasoning={"effort": "medium"},
        text={"verbosity": "medium"},
        tools=tools,
    )
```

## 프롬프트 수정 방법

### Agent 프롬프트 수정
`app/agent/prompts/agent_system.yaml` 편집:
```yaml
system_prompt: |
  You are an expert physics simulation assistant...
  
  Your capabilities:
  1. Image Segmentation (segment_image)
  2. Entity Labeling (label_segments)
  ...
```

### Labeler 프롬프트 수정
`app/agent/prompts/labeler_system.yaml` 편집:
```yaml
system_prompt: |
  You are a physics diagram segment labeler.
  
  Available entity types:
  - mass: Objects with mass...
  - pulley: Pulley wheels...
```

**서버 재시작 없이 프롬프트 변경 반영됨** (YAML 파일 수정 후 자동 로드)

## Fallback 동작

### Labeler Fallback
1. GPT-5 API 호출 실패 → StubLabeler 사용
2. JSON 파싱 실패 → StubLabeler 사용
3. 엔티티 파싱 안됨 → StubLabeler 사용

### Agent Fallback
- GPT-5 미사용 시 GPT-4o Chat API 자동 사용

## 다음 단계

### 1. SAM 서버 시작
```bash
cd backend/sam_server
.\.venv\Scripts\activate
uvicorn server:app --port 9001
```

### 2. Frontend 연동 테스트
- SimulationBox에서 이미지 업로드
- Agent가 자동으로 segment → label → build → simulate
- Chat 패널에서 "What is the acceleration?" 질문

### 3. 파라미터 수정 테스트
- "Change mass A to 5kg" → Agent가 scene rebuild → new simulation

## 관련 파일

### Backend
- `app/agent/prompts/` - YAML 프롬프트 관리
- `app/agent/labeler.py` - GPT-5 Labeler
- `app/routers/agent.py` - GPT-5 Agent endpoint
- `app/models/settings.py` - GPT-5 모델 설정
- `tests/test_agent_tools.py` - 단위 테스트

### 설정
- `pyproject.toml` - pyyaml 의존성
- `.env` - API 키 및 모드 설정

## 주의사항

⚠️ **GPT-5 API Key 필요**: OPENAI_API_KEY 환경변수 설정 필수
⚠️ **SAM Server**: 실제 segmentation을 위해 localhost:9001 필요
⚠️ **Stub Mode**: API 키 없으면 자동으로 stub labeler 사용
⚠️ **Temperature**: GPT-5는 temperature=1.0만 지원 (다른 값 사용 시 400 에러)

## 성공 지표

✅ All tests passing
✅ YAML prompts loading correctly
✅ GPT-5 API integration complete
✅ Fallback mechanisms working
✅ uv environment management working
