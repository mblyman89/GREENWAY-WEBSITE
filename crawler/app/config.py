"""Configuration for the Greenway crawler worker.

All settings come from environment variables (or a local `.env`). Loaded once at
startup via `get_settings()` (cached). Nothing here is secret in code — secrets
live only in the environment / `.env`, which is gitignored.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Auth -----------------------------------------------------------------
    crawler_shared_secret: str = Field(default="", alias="CRAWLER_SHARED_SECRET")

    # --- Supabase -------------------------------------------------------------
    supabase_url: str = Field(default="", alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(default="", alias="SUPABASE_SERVICE_ROLE_KEY")

    # --- AI provider ----------------------------------------------------------
    ai_base_url: str = Field(default="https://api.openai.com/v1", alias="AI_BASE_URL")
    ai_model: str = Field(default="gpt-4o-mini", alias="AI_MODEL")
    ai_api_key: str = Field(default="", alias="AI_API_KEY")

    # --- Crawl politeness -----------------------------------------------------
    crawl_min_delay_seconds: float = Field(default=2.0, alias="CRAWL_MIN_DELAY_SECONDS")
    crawl_cache_ttl_seconds: int = Field(default=86_400, alias="CRAWL_CACHE_TTL_SECONDS")
    crawl_user_agent: str = Field(
        default="GreenwayBot/1.0 (+https://greenwaymarijuana.com)",
        alias="CRAWL_USER_AGENT",
    )
    crawl_respect_robots: bool = Field(default=True, alias="CRAWL_RESPECT_ROBOTS")

    # --- Service --------------------------------------------------------------
    crawler_port: int = Field(default=8200, alias="CRAWLER_PORT")
    crawl_cache_dir: str = Field(default=".cache", alias="CRAWL_CACHE_DIR")

    # --- Derived --------------------------------------------------------------
    @property
    def ai_enabled(self) -> bool:
        """The schema-extraction LLM step runs only when a key is configured."""
        return bool(self.ai_api_key.strip())

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.supabase_url.strip() and self.supabase_service_role_key.strip())

    @property
    def cache_path(self) -> Path:
        p = Path(__file__).resolve().parent.parent / self.crawl_cache_dir
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
