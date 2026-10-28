from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки из переменных окружения (префикс NOTETAKER_) или файла .env."""

    model_config = SettingsConfigDict(env_prefix="NOTETAKER_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://postgres@127.0.0.1:5433/notetaker"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    default_timezone: str = "UTC"

    # Планировщик напоминаний
    scheduler_enabled: bool = True
    scheduler_interval_seconds: float = 15.0

    # Заметки в корзине удаляются окончательно через столько дней
    trash_retention_days: int = 30

    # Email: "console" (лог), "smtp" (например, Mailpit в docker compose), "memory" (тесты)
    email_backend: str = "console"
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_from: str = "notetaker@localhost"


@lru_cache
def get_settings() -> Settings:
    return Settings()
