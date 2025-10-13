"""Application configuration using pydantic-settings."""

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
    APP_ENV: str = "dev"
    DATABASE_URL: str = "postgresql+psycopg://app:app@localhost:5432/app"
    REDIS_URL: str = "redis://localhost:6379/0"
    S3_ENDPOINT_URL: str | None = "http://localhost:9000"
    S3_ACCESS_KEY_ID: str | None = None
    S3_SECRET_ACCESS_KEY: str | None = None
    S3_BUCKET: str | None = None
    JWT_SECRET: str = "change-me"
    SAM_MODE: str = "http"  # "stub" | "http"
    SAM_HTTP_URL: str | None = "http://localhost:9001/segment"
    LABELER_MODE: str = "openai"  # "stub" | "openai"
    OPENAI_API_KEY: str | None = None
    LABELER_MODEL: str = "gpt-5"
    # Rapier Node.js worker integration
    RAPIER_WORKER_PATH: str | None = None  # If None, defaults to backend/sim_worker/rapier_worker.js
    RAPIER_WORKER_TIMEOUT_S: float = 10.0
    OPENAI_API_KEY: str | None = None
    OPENAI_BASE_URL: str | None = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_TEMPERATURE: float = 0.5
    OPENAI_TOP_P: float | None = None
    OPENAI_MAX_OUTPUT_TOKENS: int | None = None
    OPENAI_PRESENCE_PENALTY: float | None = None
    OPENAI_FREQUENCY_PENALTY: float | None = None
    CHAT_SYSTEM_PROMPT: str | None = (
        "You are Project Einstein, a pedagogical AI mentor. "
        "Provide clear, concise guidance grounded in accurate science."
    )
    FRONTEND_ORIGIN: str | None = Field(
        default=None, validation_alias="FRONTEND_ORIGIN"
    )
    CORS_ALLOW_ORIGINS: list[str] = Field(default_factory=list)
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
