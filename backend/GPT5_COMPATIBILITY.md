# GPT-5 API 호환성 가이드

## 해결된 문제

### 1. ❌ `max_tokens=null` 에러
**증상:**
```
Error code: 400 - {'error': {'message': "Invalid type for 'max_tokens': 
expected an unsupported value, but got null instead."}}
```

**해결:**
```python
# Before (에러 발생)
api_params = {
    "model": "gpt-5",
    "messages": [...],
    "max_tokens": None,  # ❌ GPT-5에서 null 불가
}

# After (수정됨)
api_params = {
    "model": "gpt-5",
    "messages": [...],
}
# None이 아닐 때만 추가
if max_output_tokens is not None:
    api_params["max_tokens"] = max_output_tokens
```

### 2. ❌ `temperature` 에러
**증상:**
```
Error code: 400 - {'error': {'message': "Unsupported value: 'temperature' 
does not support 0.5 with this model. Only the default (1) value is supported."}}
```

**해결:**
```python
# Before (에러 발생)
api_params = {
    "model": "gpt-5",
    "messages": [...],
    "temperature": 0.5,  # ❌ GPT-5는 1.0만 지원
}

# After (수정됨)
api_params = {
    "model": "gpt-5",
    "messages": [...],
}
# GPT-5가 아닐 때만 temperature 추가
if not model.startswith("gpt-5"):
    api_params["temperature"] = 0.5
```

## GPT-5 API 제약사항

### 지원되지 않는 파라미터

| 파라미터 | GPT-4 | GPT-5 | 비고 |
|---------|-------|-------|------|
| `temperature` | ✅ 0.0~2.0 | ⚠️ 1.0만 지원 | 다른 값 사용 시 400 에러 |
| `max_tokens` | ✅ 설정 가능 | ✅ 설정 가능 | `null` 전달 시 400 에러 |
| `top_p` | ✅ 0.0~1.0 | ❓ 확인 필요 | |
| `presence_penalty` | ✅ -2.0~2.0 | ❓ 확인 필요 | |
| `frequency_penalty` | ✅ -2.0~2.0 | ❓ 확인 필요 | |

### Chat API vs Responses API

**Chat API** (`chat.completions.create`):
- GPT-4o, GPT-4, GPT-3.5 등에서 사용
- 표준 파라미터 지원

**Responses API** (`responses.create`):
- GPT-5 전용 (Labeler에서 사용)
- 다른 입력/출력 구조
- `reasoning`, `text` 파라미터 사용

## 수정된 코드

### `chat/engine.py`
```python
async def generate(
    self,
    conversation: ConversationState,
    user_message: ChatMessage,
    metadata: dict[str, Any],
) -> list[ChatMessage]:
    prompt_messages = list(self._build_prompt(conversation, user_message))
    
    # Build API call parameters
    api_params: dict[str, Any] = {
        "model": self._config.model,
        "messages": prompt_messages,
    }
    
    # GPT-5 only supports default temperature (1.0)
    # For other models, include temperature if specified
    if not self._config.model.startswith("gpt-5"):
        api_params["temperature"] = self._config.temperature
    
    # Only include optional parameters if they are not None
    if self._config.top_p is not None:
        api_params["top_p"] = self._config.top_p
    if self._config.max_output_tokens is not None:
        api_params["max_tokens"] = self._config.max_output_tokens
    if self._config.presence_penalty is not None:
        api_params["presence_penalty"] = self._config.presence_penalty
    if self._config.frequency_penalty is not None:
        api_params["frequency_penalty"] = self._config.frequency_penalty
    
    try:
        response = await self._client.chat.completions.create(**api_params)
    except OpenAIError as exc:
        raise RuntimeError("OpenAI chat completion failed") from exc
    return self._to_chat_messages(response, metadata)
```

### `models/settings.py`
```python
class Settings(BaseSettings):
    # ...
    OPENAI_MODEL: str = "gpt-5"
    OPENAI_TEMPERATURE: float = 1.0  # GPT-5 only supports default (1.0)
    OPENAI_TOP_P: float | None = None
    OPENAI_MAX_OUTPUT_TOKENS: int | None = None
    # ...
```

## 환경 설정

### `.env` 파일
```bash
# GPT-5 사용 시
OPENAI_API_KEY=your_gpt5_api_key
OPENAI_MODEL=gpt-5
OPENAI_TEMPERATURE=1.0  # 반드시 1.0

# GPT-4o 사용 시 (fallback)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o
OPENAI_TEMPERATURE=0.7  # 원하는 값 설정 가능
```

## 모델 전환 가이드

### GPT-5 → GPT-4o 전환
```bash
# .env 수정
OPENAI_MODEL=gpt-4o
OPENAI_TEMPERATURE=0.7
LABELER_MODEL=gpt-4o
```

서버 재시작:
```bash
cd backend
uv run python -m uvicorn app.main:app --reload --port 8000
```

### GPT-4o → GPT-5 전환
```bash
# .env 수정
OPENAI_MODEL=gpt-5
OPENAI_TEMPERATURE=1.0  # 필수!
LABELER_MODEL=gpt-5
```

## 디버깅 팁

### 에러 로그 확인
```python
# 400 에러 발생 시 전체 요청 로깅
import logging
logging.basicConfig(level=logging.DEBUG)

# OpenAI 라이브러리 디버그 모드
import openai
openai.log = "debug"
```

### API 파라미터 검증
```python
# engine.py에 임시 로깅 추가
print(f"[DEBUG] API params: {api_params}")
response = await self._client.chat.completions.create(**api_params)
```

### 모델별 분기 확인
```python
if self._config.model.startswith("gpt-5"):
    print("[DEBUG] Using GPT-5 mode (no temperature)")
else:
    print(f"[DEBUG] Using GPT-4 mode (temperature={self._config.temperature})")
```

## 테스트

### 단위 테스트
```bash
cd backend
uv run pytest tests/test_agent_tools.py -v
```

### 통합 테스트 (Chat)
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Hello!",
    "conversation_id": null
  }'
```

### Agent 엔드포인트 테스트
```bash
curl -X POST http://localhost:8000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Test GPT-5",
    "conversation_id": null
  }'
```

## 결론

✅ **수정 완료:**
- `max_tokens=null` 에러 해결
- `temperature` GPT-5 호환성 추가
- 조건부 파라미터 전달로 GPT-4/GPT-5 모두 지원

✅ **안전한 기본값:**
- `OPENAI_TEMPERATURE=1.0` (GPT-5 기본값)
- Optional 파라미터는 None일 때 전달하지 않음

✅ **하위 호환성:**
- GPT-4o로 전환 시에도 정상 작동
- 환경변수만 변경하면 됨

이제 GPT-5 Chat API를 사용할 때 파라미터 관련 에러가 발생하지 않습니다! 🎉
