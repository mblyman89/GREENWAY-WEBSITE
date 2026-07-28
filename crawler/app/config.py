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

    # --- Dynamic-content capture (Slice C3) -------------------------------------
    # When true (default) the browser fetch scrolls the FULL page (so lazy-loaded
    # sections and images render), waits for images, removes cookie/newsletter
    # overlays that hide content, and best-effort clicks visible "load more /
    # show more / view all" buttons before capturing the HTML. Every knob is
    # soft-degrading: features the installed crawl4ai doesn't support are simply
    # skipped (the repo pins a wide crawl4ai range). Set false for the fastest,
    # plain page-load capture.
    crawl_dynamic_content: bool = Field(default=True, alias="CRAWL_DYNAMIC_CONTENT")
    # C7: overlay removal (crawl4ai `remove_overlay_elements`) is OFF by default.
    # It was added in C3 to hide cookie/newsletter popups, but on age-gated
    # dispensary themes ("Are you 21?") crawl4ai's remover strips the modal AND
    # the real content wrapper behind it, leaving a thin shell with no nav links
    # \u2014 the "1 page, 0 drafts" regression the owner hit on every vendor. The real
    # content is UNDER the modal (an overlay, not a separate page), so we don't
    # need to delete anything; we scroll/scan the page as-is (plus the C7 age-gate
    # "click YES" nudge). Set true only if a specific site truly needs it.
    crawl_remove_overlays: bool = Field(default=False, alias="CRAWL_REMOVE_OVERLAYS")
    # Pause between scroll steps during the full-page scan (seconds). Higher =
    # gentler + more time for lazy content; the owner is fine with slow crawls.
    crawl_scroll_delay_seconds: float = Field(default=0.3, alias="CRAWL_SCROLL_DELAY_SECONDS")
    # Extra settle time after scripts run before the HTML snapshot (seconds).
    crawl_settle_seconds: float = Field(default=2.0, alias="CRAWL_SETTLE_SECONDS")
    # Per-page browser timeout (seconds) — generous because full-page scans of
    # image-heavy catalogs legitimately take a while.
    crawl_page_timeout_seconds: float = Field(default=90.0, alias="CRAWL_PAGE_TIMEOUT_SECONDS")

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

    # --- Cultivera Market (CV-2: authenticated vendor-menu fetch) -------------
    # The owner is an authenticated Cultivera Market BUYER (their rep approved
    # using the marketplace this way). The worker logs in ONCE with these
    # credentials, caches the session (JWT access token + refresh token), reuses
    # it, and re-logs on 401 — then calls Cultivera's JSON API politely (slow,
    # human-paced) to fetch a vendor's live menu. These are the buyer's OWN
    # marketplace credentials; leave empty to keep Cultivera features disabled.
    #   Login page: https://wa.cultiveramarket.com/   API: (auto-detected below)
    cultivera_email: str = Field(default="", alias="CULTIVERA_EMAIL")
    cultivera_password: str = Field(default="", alias="CULTIVERA_PASSWORD")
    # The marketplace SPA origin the buyer logs into (region-specific). The API
    # base is discovered from the app at runtime (never hard-coded/guessed); this
    # is only the human-facing site the browser navigates to.
    cultivera_site_url: str = Field(
        default="https://wa.cultiveramarket.com",
        alias="CULTIVERA_SITE_URL",
    )
    # Optional explicit API base override. When empty, the auth step discovers it
    # from the running app (the SPA reveals its own API origin). Setting this
    # skips discovery. NO trailing slash.
    cultivera_api_base: str = Field(default="", alias="CULTIVERA_API_BASE")
    # Politeness for the authenticated JSON calls: a human-paced pause (seconds)
    # is taken BEFORE each request, jittered up to +50%. The owner explicitly
    # wants slow, respectful traffic (polite mode, not stealth).
    cultivera_min_delay_seconds: float = Field(default=3.0, alias="CULTIVERA_MIN_DELAY_SECONDS")
    # How long a cached session is trusted before a proactive re-login (seconds).
    # A 401 always forces a re-login regardless; this just avoids using a token
    # we already know is likely stale. Default 45 min (Cultivera tokens are JWTs
    # whose real `exp` is honored when decodable — this is only the fallback).
    cultivera_session_ttl_seconds: int = Field(default=2_700, alias="CULTIVERA_SESSION_TTL_SECONDS")
    # Where the cached session JSON lives (relative to crawler/). Gitignored.
    cultivera_session_file: str = Field(default=".cache/cultivera_session.json", alias="CULTIVERA_SESSION_FILE")

    # --- GrowFlow (second wholesale marketplace) ------------------------------
    # The owner is ALSO an authenticated GrowFlow BUYER (Greenway Marijuana,
    # license 413541; their rep approved using the marketplace this way).
    # GrowFlow (marketplace.growflow.com) uses an Auth0-hosted login and a
    # GraphQL API. The worker logs in ONCE with these credentials via a real
    # browser (Auth0 redirect), captures the Bearer token GrowFlow sends on its
    # GraphQL calls, caches/reuses it, and re-logs on 401 — then calls GrowFlow's
    # GraphQL API politely (slow, human-paced). These are the buyer's OWN
    # marketplace credentials; leave empty to keep GrowFlow features disabled.
    #   Login page: https://marketplace.growflow.com/   (Auth0: auth.growflow.com)
    growflow_email: str = Field(default="", alias="GROWFLOW_EMAIL")
    growflow_password: str = Field(default="", alias="GROWFLOW_PASSWORD")
    # The marketplace SPA origin the buyer logs into. Only the human-facing site
    # the browser navigates to; the GraphQL endpoint is discovered from the app.
    growflow_site_url: str = Field(
        default="https://marketplace.growflow.com",
        alias="GROWFLOW_SITE_URL",
    )
    # Optional explicit GraphQL endpoint override. When empty, the auth step
    # discovers it from the running app (the SPA reveals its own GraphQL origin).
    growflow_graphql_url: str = Field(default="", alias="GROWFLOW_GRAPHQL_URL")
    # The buyer's US state (GrowFlow scopes vendors/menus by state). WA for
    # Greenway. Used as the `state` GraphQL variable.
    growflow_state: str = Field(default="WA", alias="GROWFLOW_STATE")
    # Optional explicit BuyerVendorId override. When empty, the auth/api step
    # discovers it from getStoreFrontUserVendorsV2 (never guessed). For Greenway
    # this is 2368; leave empty to auto-detect (recommended).
    growflow_buyer_vendor_id: str = Field(default="", alias="GROWFLOW_BUYER_VENDOR_ID")
    # Politeness for the authenticated GraphQL calls: a human-paced pause
    # (seconds) taken BEFORE each request, jittered up to +50%. Polite, not stealth.
    growflow_min_delay_seconds: float = Field(default=3.0, alias="GROWFLOW_MIN_DELAY_SECONDS")
    # How long a cached session is trusted before a proactive re-login (seconds).
    # A 401 always forces a re-login. Default 45 min; the real JWT `exp` is honored
    # when decodable, this is only the fallback.
    growflow_session_ttl_seconds: int = Field(default=2_700, alias="GROWFLOW_SESSION_TTL_SECONDS")
    # Where the cached session JSON lives (relative to crawler/). Gitignored.
    growflow_session_file: str = Field(default=".cache/growflow_session.json", alias="GROWFLOW_SESSION_FILE")

    # --- LeafLink (third wholesale marketplace) -------------------------------
    # The owner is ALSO an authenticated LeafLink retail BUYER (Greenway
    # Marijuana, company slug greenway-marijuana / id 3053). LeafLink
    # (app.leaflink.com) uses an Auth0-hosted login (auth.leaflink.com) and a
    # COOKIE-authenticated internal API (verified live: the same fetch answers
    # 200 with cookies, 403 without \u2014 see docs/LEAFLINK_PINNED.md). The worker
    # logs in ONCE with these credentials via a real browser, captures the
    # app.leaflink.com cookies, caches/reuses them, and re-logs on 401/403 \u2014
    # then calls the internal REST API politely (slow, human-paced). These are
    # the buyer's OWN credentials; leave empty to keep LeafLink disabled.
    #   Login page: https://www.leaflink.com/accounts/login/ (Auth0: auth.leaflink.com)
    leaflink_email: str = Field(default="", alias="LEAFLINK_EMAIL")
    leaflink_password: str = Field(default="", alias="LEAFLINK_PASSWORD")
    # The app origin the cookies belong to (the SPA the buyer logs into).
    leaflink_site_url: str = Field(
        default="https://app.leaflink.com",
        alias="LEAFLINK_SITE_URL",
    )
    # The buyer company's URL slug \u2014 every internal API path is scoped by it
    # (e.g. /api/internal/greenway-marijuana/shop/products/). Pinned live.
    leaflink_company_slug: str = Field(
        default="greenway-marijuana", alias="LEAFLINK_COMPANY_SLUG"
    )
    # Politeness for the authenticated REST calls: a human-paced pause
    # (seconds) BEFORE each request, jittered up to +50%. Polite, not stealth.
    leaflink_min_delay_seconds: float = Field(default=3.0, alias="LEAFLINK_MIN_DELAY_SECONDS")
    # How long a cached cookie session is trusted before a proactive re-login
    # (seconds). A 401/403 always forces a re-login; this is the fallback.
    leaflink_session_ttl_seconds: int = Field(default=2_700, alias="LEAFLINK_SESSION_TTL_SECONDS")
    # Where the cached session JSON lives (relative to crawler/). Gitignored.
    leaflink_session_file: str = Field(default=".cache/leaflink_session.json", alias="LEAFLINK_SESSION_FILE")

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
    def cultivera_enabled(self) -> bool:
        """Cultivera menu fetch runs only when the buyer's credentials are set."""
        return bool(self.cultivera_email.strip() and self.cultivera_password.strip())

    @property
    def cultivera_site(self) -> str:
        """The marketplace site origin, normalized (no trailing slash)."""
        return self.cultivera_site_url.strip().rstrip("/")

    @property
    def cultivera_api(self) -> str:
        """Explicit API base override (no trailing slash), or '' to auto-detect."""
        return self.cultivera_api_base.strip().rstrip("/")

    @property
    def cultivera_session_path(self) -> Path:
        """Absolute path to the cached session file (parent dir ensured)."""
        raw = self.cultivera_session_file.strip() or ".cache/cultivera_session.json"
        p = Path(raw)
        if not p.is_absolute():
            p = Path(__file__).resolve().parent.parent / p
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def growflow_enabled(self) -> bool:
        """GrowFlow menu fetch runs only when the buyer's credentials are set."""
        return bool(self.growflow_email.strip() and self.growflow_password.strip())

    @property
    def growflow_site(self) -> str:
        """The GrowFlow marketplace origin, normalized (no trailing slash)."""
        return self.growflow_site_url.strip().rstrip("/")

    @property
    def growflow_graphql(self) -> str:
        """Explicit GraphQL endpoint override, or '' to auto-detect from the app."""
        return self.growflow_graphql_url.strip().rstrip("/")

    @property
    def growflow_session_path(self) -> Path:
        """Absolute path to the cached GrowFlow session file (parent dir ensured)."""
        raw = self.growflow_session_file.strip() or ".cache/growflow_session.json"
        p = Path(raw)
        if not p.is_absolute():
            p = Path(__file__).resolve().parent.parent / p
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def leaflink_enabled(self) -> bool:
        """LeafLink menu fetch runs only when the buyer's credentials are set."""
        return bool(self.leaflink_email.strip() and self.leaflink_password.strip())

    @property
    def leaflink_site(self) -> str:
        """The LeafLink app origin, normalized (no trailing slash)."""
        return self.leaflink_site_url.strip().rstrip("/")

    @property
    def leaflink_slug(self) -> str:
        """The buyer company's URL slug, normalized (no slashes)."""
        return self.leaflink_company_slug.strip().strip("/")

    @property
    def leaflink_session_path(self) -> Path:
        """Absolute path to the cached LeafLink session file (parent dir ensured)."""
        raw = self.leaflink_session_file.strip() or ".cache/leaflink_session.json"
        p = Path(raw)
        if not p.is_absolute():
            p = Path(__file__).resolve().parent.parent / p
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

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
