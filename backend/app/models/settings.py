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

  model_config = SettingsConfigDict(env_file=".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
  """Return a cached settings instance."""
  return Settings()


settings = get_settings()
