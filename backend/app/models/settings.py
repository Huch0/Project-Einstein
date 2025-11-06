"""Application configuration using pydantic-settings (v0.4)."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, ValidationInfo, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ENV_FILE = _BACKEND_DIR / ".env"

def _expand_origin(value: str) -> list[str]:
    origin = value.rstrip("/")
    if origin in {"http://localhost", "http://127.0.0.1"}:
        return [f"{origin}:3000", origin]
    return [origin]


class Settings(BaseSettings):
    # ===== Core Infrastructure =====
    APP_ENV: str = "dev"
    DATABASE_URL: str = "postgresql+psycopg://app:app@localhost:5432/app"
    REDIS_URL: str = "redis://localhost:6379/0"
    S3_ENDPOINT_URL: str | None = "http://localhost:9000"
    S3_ACCESS_KEY_ID: str | None = None
    S3_SECRET_ACCESS_KEY: str | None = None
    S3_BUCKET: str | None = None
    JWT_SECRET: str = "change-me"
    
    # ===== OpenAI API =====
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str | None = None
    OPENAI_MODEL: str = "gpt-5"  # GPT-5 for agent chat
    OPENAI_TEMPERATURE: float = 1.0  # GPT-5 only supports default (1.0)
    OPENAI_TOP_P: float | None = None
    OPENAI_MAX_OUTPUT_TOKENS: int | None = None
    OPENAI_PRESENCE_PENALTY: float | None = None
    OPENAI_FREQUENCY_PENALTY: float | None = None
    
    # ===== Unified Chat (v0.4) =====
    CHAT_DEFAULT_MODE: str = "ask"  # "ask" | "agent"
    CHAT_ENABLE_STREAMING: bool = True
    CHAT_MAX_CONVERSATION_LENGTH: int = 50
    CHAT_CONVERSATION_TIMEOUT_S: int = 3600  # 1 hour
    
    # Ask Mode
    ASK_SYSTEM_PROMPT: str = (
        "You are Project Einstein, a physics tutor AI. "
        "Explain concepts clearly with examples and help students understand physics problems. "
        "You do NOT have access to simulation tools in Ask mode."
    )
    
    # Agent Mode
    AGENT_SYSTEM_PROMPT_PATH: str = "app/agent/prompts/agent_system.yaml"
    AGENT_ENABLE_TOOLS: bool = True
    AGENT_MAX_TOOL_CALLS_PER_TURN: int = 10
    AGENT_TOOL_TIMEOUT_S: float = 30.0
    
    # ===== Universal Physics Builder (v0.4) =====
    BUILDER_MODE: str = "universal"  # v0.4 only supports "universal"
    BUILDER_DEFAULT_SCALE_M_PER_PX: float = 0.01  # 1px = 1cm
    BUILDER_DEFAULT_GRAVITY_M_S2: float = 9.81
    BUILDER_INFER_CONSTRAINTS: bool = True  # Auto-detect rope/spring constraints
    
    # Physics Engine (Matter.js only)
    PHYSICS_ENGINE: str = "matter-js"  # Analytic solver removed in v0.4
    PHYSICS_TIME_STEP_S: float = 0.016  # 60 fps
    PHYSICS_DEFAULT_DURATION_S: float = 5.0
    PHYSICS_MAX_BODIES: int = 100  # Safety limit for N-body systems
    
    # ===== Agent Tools =====
    # Tool: segment_image
    SAM_MODE: str = "http"  # "http" | "stub"
    SAM_HTTP_URL: str = "http://localhost:9001/segment"
    SAM_TIMEOUT_S: float = 10.0
    
    # Tool: label_segments
    LABELER_MODE: str = "openai"  # "openai" | "stub"
    LABELER_MODEL: str = "gpt-5"  # GPT-5 with Responses API
    LABELER_SYSTEM_PROMPT_PATH: str = "app/agent/prompts/labeler_system.yaml"

    # Tool: build_scene (agent-based)
    INIT_SIM_SCENE_MODEL: str | None = None  # Optional override for initialization builder model
    
    # Tool: simulate_physics
    MATTER_WORKER_PATH: str | None = "backend/sim_worker/matter_worker.js"  # If None, defaults to backend/sim_worker/matter_worker.js
    MATTER_WORKER_TIMEOUT_S: float = 10.0
    
    # ===== Frontend & CORS =====
    FRONTEND_ORIGIN: str | None = Field(
        default=None, validation_alias="FRONTEND_ORIGIN"
    )
    CORS_ALLOW_ORIGINS: list[str] = Field(default_factory=list)
    
    # ===== Logging & Audit =====
    CHAT_AUDIT_LOG_ENABLED: bool = True
    CHAT_AUDIT_LOG_PATH: str = "logs/chat-turns.log"

    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    @field_validator("CORS_ALLOW_ORIGINS", mode="before")
    @classmethod
    def _populate_cors(cls, value: list[str] | None, info: ValidationInfo) -> list[str]:
        origins: list[str] = []

        if value:
            for origin in value:
                origins.extend(_expand_origin(origin))

        frontend_origin = info.data.get("FRONTEND_ORIGIN") if info.data else None
        if isinstance(frontend_origin, str) and frontend_origin.strip():
            origins.extend(_expand_origin(frontend_origin))

        return list(dict.fromkeys(origins)) or _expand_origin("http://localhost:9002")


@lru_cache
def get_settings() -> Settings:
    """Return a cached settings instance."""
    return Settings()


settings = get_settings()
