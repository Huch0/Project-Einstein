"""Application configuration using pydantic-settings."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_BACKEND_DIR = Path(__file__).resolve().parents[2]
_ENV_FILE = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    APP_ENV: str = "dev"
    DATABASE_URL: str = "postgresql+psycopg://app:app@localhost:5432/app"
    REDIS_URL: str = "redis://localhost:6379/0"
    S3_ENDPOINT_URL: str | None = "http://localhost:9000"
    S3_ACCESS_KEY_ID: str | None = None
    S3_SECRET_ACCESS_KEY: str | None = None
    S3_BUCKET: str | None = None
    JWT_SECRET: str = "change-me"
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

    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")


@lru_cache
def get_settings() -> Settings:
    """Return a cached settings instance."""
    return Settings()


settings = get_settings()
