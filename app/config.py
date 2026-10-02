"""Application configuration management using pydantic-settings."""

from functools import lru_cache
from zoneinfo import ZoneInfo
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Database
    database_url: str = (
        "postgresql+asyncpg://meetmanager:meetmanager@localhost:5434/agentcom"
    )
    database_url_sync: str = (
        "postgresql://meetmanager:meetmanager@localhost:5434/agentcom"
    )

    # Redis
    redis_url: str = "redis://localhost:6379/2"

    # Server
    host: str = "0.0.0.0"
    port: int = 8009
    debug: bool = True
    log_level: str = "info"
    sql_echo: bool = False

    # Default Super Administrator
    admin_username: str = "admin"
    admin_password: str = "admin123"
    admin_email: str = "admin@agentcom.local"
    admin_display_name: str = "系统超级管理员"

    # Security & JWT
    secret_key: str = "agentcom-super-secret-key-production-ready-2026"
    access_token_expire_minutes: int = 1440
    default_rate_limit: int = 120

    # MCP
    mcp_endpoint: str = "/mcp"
    mcp_server_name: str = "agentcom"
    mcp_server_version: str = "1.0.0"

    # External integrations
    gbrainkg_url: str = "http://localhost:3000"


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings singleton."""
    return Settings()


BUSINESS_TZ = ZoneInfo("Asia/Shanghai")
