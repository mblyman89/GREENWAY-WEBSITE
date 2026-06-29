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

    # When true (default), the fetcher sends a realistic, rotating modern-browser
    # User-Agent + full browser headers instead of the bare bot UA. This is NOT
    # deception of a protection system — it's identifying as a normal browser so
    # legitimate public pages render the same content a human would see. Set to
    # false to always send `crawl_user_agent` verbatim (e.g. if a partner asks
    # you to identify as GreenwayBot).
    crawl_realistic_headers: bool = Field(default=True, alias="CRAWL_REALISTIC_HEADERS")

    # Retry/backoff for transient failures (429/5xx/network blips). Honors a
    # server's Retry-After header when present.
    crawl_max_retries: int = Field(default=3, alias="CRAWL_MAX_RETRIES")
    crawl_backoff_base_seconds: float = Field(default=1.5, alias="CRAWL_BACKOFF_BASE_SECONDS")
    crawl_backoff_max_seconds: float = Field(default=30.0, alias="CRAWL_BACKOFF_MAX_SECONDS")

    # Optional transparent egress proxy (e.g. a reputable commercial proxy used
    # at polite rates). Off by default. Used by BOTH the browser and httpx paths.
    # Standard HTTP_PROXY/HTTPS_PROXY env vars also work; this is an explicit knob.
    crawl_proxy_url: str = Field(default="", alias="CRAWL_PROXY_URL")

    # Per-domain allow-list (comma-separated hostnames). Empty = allow any host
    # the operator submits. When set, only listed domains may be researched.
    crawl_allow_domains: str = Field(default="", alias="CRAWL_ALLOW_DOMAINS")

    # --- Social (Meta Graph API — sanctioned, DF-9) ---------------------------
    # A long-lived access token for a Greenway-owned Facebook Page linked to a
    # Greenway Instagram BUSINESS account. Used ONLY for the sanctioned
    # Instagram Business Discovery + Facebook Page public-content endpoints.
    # NEVER a password; generate via the Meta developer console (see
    # crawler/docs/SOCIAL_SETUP.md). When unset, social features soft-disable.
    meta_graph_token: str = Field(default="", alias="META_GRAPH_TOKEN")
    meta_ig_business_id: str = Field(default="", alias="META_IG_BUSINESS_ID")
    meta_graph_version: str = Field(default="v21.0", alias="META_GRAPH_VERSION")

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
    def social_enabled(self) -> bool:
        """Sanctioned social features run only when a Meta Graph token is set."""
        return bool(self.meta_graph_token.strip())

    @property
    def allow_domains(self) -> list[str]:
        return [d.strip().lower() for d in self.crawl_allow_domains.split(",") if d.strip()]

    @property
    def proxy_url(self) -> str:
        return self.crawl_proxy_url.strip()

    @property
    def cache_path(self) -> Path:
        p = Path(__file__).resolve().parent.parent / self.crawl_cache_dir
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
