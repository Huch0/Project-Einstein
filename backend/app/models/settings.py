"""Application configuration using pydantic-settings."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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

  model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
  """Return a cached settings instance."""
  return Settings()


settings = get_settings()
