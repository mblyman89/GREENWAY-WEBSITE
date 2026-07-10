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

    # --- Environment ------------------------------------------------------------
    # "production" tightens hard-security requirements: CRAWL_ALLOW_DOMAINS must
    # be set (S-5) so the crawler can only ever research explicitly-approved
    # hosts. Anything else ("development", default) keeps the permissive
    # operator-trust behavior for local testing.
    crawler_env: str = Field(default="development", alias="CRAWLER_ENV")

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

    # Deep research: maximum TOTAL pages fetched per research request (the
    # target page + same-site pages walked by the C2 frontier crawl — every
    # fetched page's own links join the queue until this budget is spent).
    # Politeness (robots + per-domain delay) applies to every one of them.
    # C2: default raised 5 → 25 — the owner explicitly wants the WHOLE site
    # read and is fine with a crawl taking several minutes per vendor.
    crawl_max_pages: int = Field(default=25, alias="CRAWL_MAX_PAGES")

    # --- URL seeding (Slice H2) ------------------------------------------------
    # Two-phase cost control: BEFORE spending expensive browser fetches, ask
    # crawl4ai's AsyncUrlSeeder for the site's full URL inventory (sitemap
    # and/or Common Crawl index — no page fetches) and score candidates with
    # BM25 against the seven KB target fields. The crawl budget then goes to
    # the BEST pages instead of the first ones we stumble on. Soft-disables
    # when crawl4ai < 0.7 is installed (AsyncUrlSeeder missing) or on any
    # seeder error — nav + sitemap discovery still work.
    crawl_seed_enabled: bool = Field(default=True, alias="CRAWL_SEED_ENABLED")
    # "sitemap" (polite, reads the site's own map), "cc" (Common Crawl index —
    # zero traffic to the site), or "sitemap+cc" (both).
    crawl_seed_source: str = Field(default="sitemap", alias="CRAWL_SEED_SOURCE")
    crawl_seed_max_urls: int = Field(default=100, alias="CRAWL_SEED_MAX_URLS")

    # --- Social (Meta Graph API — sanctioned, DF-9) ---------------------------
    # A long-lived access token for a Greenway-owned Facebook Page linked to a
    # Greenway Instagram BUSINESS account. Used ONLY for the sanctioned
    # Instagram Business Discovery + Facebook Page public-content endpoints.
    # NEVER a password; generate via the Meta developer console (see
    # crawler/docs/SOCIAL_SETUP.md). When unset, social features soft-disable.
    meta_graph_token: str = Field(default="", alias="META_GRAPH_TOKEN")
    meta_ig_business_id: str = Field(default="", alias="META_IG_BUSINESS_ID")
    meta_graph_version: str = Field(default="v21.0", alias="META_GRAPH_VERSION")

    # --- Slice H9b: structured product harvesting -----------------------------
    # When true, a vendor/brand crawl ALSO writes the verified product lineup as
    # structured kb_products DRAFT rows (drafts-only, ON CONFLICT DO NOTHING), in
    # addition to the human-readable research_products reference draft. Opt-out
    # by setting HARVEST_PRODUCTS_ENABLED=false. Requires Supabase configured.
    harvest_products_enabled: bool = Field(default=True, alias="HARVEST_PRODUCTS_ENABLED")

    # --- Slice H9d: social-link following -------------------------------------
    # After scraping a vendor's own site, detect the social-profile links they
    # advertise (the "follow us" icons) and politely fetch each profile page
    # (logged-out, through the SAME robots/SSRF/allow-list/rate-limit path as any
    # page) to harvest a public about/bio candidate. No paid API, no login.
    # Opt-out with FOLLOW_SOCIAL_LINKS=false. Bounded by SOCIAL_LINKS_MAX_FOLLOW.
    follow_social_links: bool = Field(default=True, alias="FOLLOW_SOCIAL_LINKS")
    social_links_max_follow: int = Field(default=4, ge=0, le=15, alias="SOCIAL_LINKS_MAX_FOLLOW")

    # --- Slice H9e: vendor-website discovery ----------------------------------
    # Keyword-targeted search (keyless DuckDuckGo HTML) that FINDS a vendor's own
    # first-party website + contact info. Returns candidates for the owner to
    # REVIEW before feeding any URL into the batch crawler — never auto-crawls.
    # Third-party marketplaces (Jane/Leafly/Weedmaps/...) are always excluded.
    # Opt-out with DISCOVERY_ENABLED=false; cap results with DISCOVERY_MAX_RESULTS.
    discovery_enabled: bool = Field(default=True, alias="DISCOVERY_ENABLED")
    discovery_max_results: int = Field(default=10, ge=1, le=50, alias="DISCOVERY_MAX_RESULTS")

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
    def is_production(self) -> bool:
        return self.crawler_env.strip().lower() in ("production", "prod")

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
