"""CV-2 — polite authenticated Cultivera Market JSON client.

Given a cached session (from cultivera_auth), this makes SLOW, human-paced JSON
calls to Cultivera's own API to (1) search/list the marketplace's vendors and
(2) fetch ONE vendor's live menu. The owner explicitly wants polite traffic
(not stealth): we pause before every request and re-use the login as long as
possible.

NEVER GUESS:
  * We do NOT hard-code Cultivera's exact endpoint paths or response shapes as
    facts. The endpoint *candidates* below come from the recon of the live app
    (the SPA's own XHRs), but each request tries a small ordered list of known
    candidate paths and returns the FIRST that answers with JSON. The raw JSON
    is returned untouched for the downstream tolerant normalizers
    (`normalizeSnapshot` / `normalizeMenuItem` in the Next app) to interpret.
  * Exact field names get pinned only from a real authenticated probe once the
    owner supplies credentials. Until then everything is defensive.

Everything that does NOT touch the network (delay math, URL joining, extracting
a list of records out of an arbitrary JSON envelope) is a PURE function so it
can be unit-tested with no network — see crawler/tests/test_cultivera_api.py.
"""
from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlencode, urljoin

import httpx

from .config import Settings, get_settings
from .cultivera_auth import (
    CultiveraAuthError,
    CultiveraSessionData,
    auth_headers,
    get_session,
    resolve_api_base,
)

# Endpoint path CANDIDATES seen in the live app's network calls (recon). Each
# call tries these in order and uses the first that returns usable JSON. This is
# resilient to the exact path we don't control — we never assume only one works.
_MARKETS_SEARCH_PATHS = (
    "markets/available",
    "markets/connected",
    "public/markets/available",
)
_MARKET_BY_SLUG_PATHS = (
    "markets/slug/{slug}",
    "public/markets/slug/{slug}",
)
_MENU_LISTINGS_PATHS = (
    # PINNED from a live authenticated browser capture of Cultivera's own
    # storefront (page /bm/market/<slug>/menu fires this): the menu lives at
    # /listings/market/<marketId>/product-lines. Kept FIRST; older candidates
    # remain as tolerant fallbacks in case the shape ever differs.
    "listings/market/{market}/product-lines",
    "listings/market/{market}",
    "public/listings/market/{market}",
    "markets/{market}/listings",
)

# Full-marketplace vendor SEARCH (PINNED from live capture): the website calls
# GET /markets/connected?CurrentPage=1&PageSize=N&Search=<q>&ShowFavoriteOnly=false&MarketSlug=
# WITH a server-side Search param, which searches ALL vendors (hundreds) rather
# than only the buyer's connected/favorite list. PageSize is generous so a
# single page returns every match for a typical query.
_MARKETS_SEARCH_BASE = "markets/connected"
_MARKETS_SEARCH_PAGE_SIZE = 200

# Product DETAIL (per-variant listing) — PINNED from a live authenticated probe
# of Cultivera's own storefront (page bm/market/<slug>/product/<id> fires):
#   GET /listings/{productId}/market/{marketId}
# The response is ONE product-line object whose `Products` array holds the
# per-size variants (UnitPrice DOLLAR floats, AvailableQuantity, UnitSize,
# MaxOrderLimit, per-variant ImageUrl, strain embedded in Name brackets).
# We return it RAW; the Next app's pure normalizers do dollars -> integer cents.
_PRODUCT_DETAIL_PATHS = (
    "listings/{product}/market/{market}",
)

# HTTP timeout (seconds) for a single JSON call. Generous but bounded — a menu
# fetch can be a large payload. Matches the codebase style of a per-call literal
# (fetcher.py uses 10.0/20.0; llm_extract.py 60.0) rather than a config field.
_REQUEST_TIMEOUT_SECONDS = 30.0

# Keys under which an API envelope commonly nests its list payload. Tolerant:
# we look through these in order and take the first list we find.
_LIST_ENVELOPE_KEYS = (
    "data", "items", "results", "listings", "products",
    "markets", "records", "rows", "content",
)


# ---------------------------------------------------------------------------
# PURE helpers (no network) — unit-tested
# ---------------------------------------------------------------------------
def polite_delay_seconds(base: float, *, rand: float | None = None) -> float:
    """A human-paced pause: `base` seconds, jittered up to +50%.

    `rand` (0..1) is injectable so the math is deterministic in tests. When
    omitted a real random fraction is used. Never negative.
    """
    base = max(0.0, float(base))
    frac = random.random() if rand is None else max(0.0, min(1.0, float(rand)))
    return base * (1.0 + 0.5 * frac)


def join_url(api_base: str, path: str) -> str:
    """Join an API base and a relative path safely (single slash, no dupes)."""
    if not api_base:
        return path
    base = api_base.rstrip("/") + "/"
    return urljoin(base, path.lstrip("/"))


def extract_records(payload: Any) -> list[dict[str, Any]]:
    """Pull a list of record dicts out of an arbitrary JSON envelope.

    Tolerant of the many shapes an API might use:
      * a bare list                          -> that list
      * {"data": [...]}, {"items": [...]}    -> the nested list
      * {"data": {"items": [...]}}           -> one level deeper
      * a single object                      -> [that object]
    Returns [] when nothing list-like is present. Never raises.
    """
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if not isinstance(payload, dict):
        return []
    # Cultivera wraps its payload under a PascalCase "Data" key (live-probed),
    # while other envelopes use lowercase "data"/"items"/etc. Match keys
    # case-INSENSITIVELY so Data / DATA / data all unwrap the same way.
    lowered = {k.lower(): v for k, v in payload.items() if isinstance(k, str)}
    for key in _LIST_ENVELOPE_KEYS:
        val = lowered.get(key)
        if isinstance(val, list):
            return [x for x in val if isinstance(x, dict)]
        if isinstance(val, dict):
            # one level deeper (e.g. {"data": {"items": [...]}})
            lowered2 = {k.lower(): v for k, v in val.items() if isinstance(k, str)}
            for k2 in _LIST_ENVELOPE_KEYS:
                v2 = lowered2.get(k2)
                if isinstance(v2, list):
                    return [x for x in v2 if isinstance(x, dict)]
    # A lone record object with no list wrapper.
    return [payload]


def normalize_for_match(text: str) -> str:
    """Lowercase and strip every non-alphanumeric char for tolerant matching.

    Marketplace vendor names are messy: extra spaces, underscores, punctuation,
    and decorative symbols (live-probed: "ThunderChief" behind a wall of
    underscores; "fire-bros."). Reducing both the query and the candidate to
    just their lowercase letters+digits lets "thunder chief" match
    "ThunderChief" and "fire bros" match "FIRE BROS.".
    """
    return "".join(ch for ch in (text or "").lower() if ch.isalnum())


def build_markets_search_path(query: str, *, page: int = 1, page_size: int | None = None) -> str:
    """Build the full-marketplace search path (PINNED from live capture).

    GET markets/connected?CurrentPage=<page>&PageSize=<n>&Search=<query>
        &ShowFavoriteOnly=false&MarketSlug=

    An empty query returns the default (connected) list. A non-empty query is
    passed to the server-side Search param, which searches ALL vendors.
    """
    size = _MARKETS_SEARCH_PAGE_SIZE if page_size is None else page_size
    params = {
        "CurrentPage": page,
        "PageSize": size,
        "Search": (query or "").strip(),
        "ShowFavoriteOnly": "false",
        "MarketSlug": "",
    }
    return f"{_MARKETS_SEARCH_BASE}?{urlencode(params)}"


def matches_query(record: dict[str, Any], query: str) -> bool:
    """Space/punctuation-INSENSITIVE substring match of `query` against a
    record's name-ish fields. Used to filter a markets list client-side when the
    API has no search param (tolerant fallback). Empty query matches everything.

    Field keys cover both lowercase spellings and Cultivera's live PascalCase
    shape (Name, UniqueSlug).
    """
    q = normalize_for_match(query)
    if not q:
        return True
    for key in ("Name", "name", "UniqueSlug", "displayName", "display_name",
                "sellerName", "seller_name", "businessName", "business_name",
                "slug", "title"):
        val = record.get(key)
        if isinstance(val, str) and q in normalize_for_match(val):
            return True
    return False


# ---------------------------------------------------------------------------
# Result value objects
# ---------------------------------------------------------------------------
@dataclass
class CultiveraApiResult:
    """A raw API result: the JSON payload plus which path/URL answered.

    `records` is a tolerant list extraction for convenience; `raw` preserves the
    full untouched payload so the downstream normalizers can see everything.
    """

    ok: bool
    url: str = ""
    status: int = 0
    raw: Any = None
    records: list[dict[str, Any]] | None = None
    error: str = ""


# ---------------------------------------------------------------------------
# The polite client
# ---------------------------------------------------------------------------
class CultiveraApiError(RuntimeError):
    """Raised when an authenticated Cultivera API call cannot be completed."""


class CultiveraClient:
    """A thin, polite, re-authenticating JSON client.

    Usage (async):
        client = CultiveraClient(settings)
        markets = await client.search_markets("acme farms")
        menu = await client.fetch_menu(market_id="...", slug="acme-farms")

    Every network call:
      * sleeps a human-paced delay BEFORE the request (polite_delay_seconds),
      * attaches the cached session's auth headers,
      * on a 401 re-logs in ONCE (get_session(force=True)) and retries once,
      * returns the raw JSON (never a guessed shape).
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._session: CultiveraSessionData | None = None

    async def _ensure_session(self, *, force: bool = False) -> CultiveraSessionData:
        if self._session is None or force:
            self._session = await get_session(self._settings, force=force)
        return self._session

    async def _sleep_polite(self) -> None:
        delay = polite_delay_seconds(self._settings.cultivera_min_delay_seconds)
        if delay > 0:
            await asyncio.sleep(delay)

    async def _get_json(self, path: str) -> CultiveraApiResult:
        """GET one path with auth + politeness + a single 401 re-login retry."""
        session = await self._ensure_session()
        api_base = resolve_api_base(session, self._settings)
        url = join_url(api_base, path)

        for attempt in range(2):  # attempt 0 normal; attempt 1 after re-login
            await self._sleep_polite()
            headers = auth_headers(session)
            try:
                async with httpx.AsyncClient(
                    timeout=_REQUEST_TIMEOUT_SECONDS,
                    follow_redirects=True,
                    headers=headers,
                    **({"proxy": self._settings.proxy_url} if self._settings.proxy_url else {}),
                ) as client:
                    resp = await client.get(url)
            except httpx.HTTPError as exc:
                return CultiveraApiResult(ok=False, url=url, error=f"request failed: {exc}")

            if resp.status_code == 401 and attempt == 0:
                # Session expired mid-flight → force a fresh login once, retry.
                try:
                    session = await self._ensure_session(force=True)
                except CultiveraAuthError as exc:
                    return CultiveraApiResult(
                        ok=False, url=url, status=401, error=f"re-auth failed: {exc}"
                    )
                # recompute base in case the fresh session changed it
                api_base = resolve_api_base(session, self._settings)
                url = join_url(api_base, path)
                continue

            if resp.status_code >= 400:
                return CultiveraApiResult(
                    ok=False, url=url, status=resp.status_code,
                    error=f"HTTP {resp.status_code}",
                )

            try:
                payload = resp.json()
            except (ValueError, TypeError) as exc:
                return CultiveraApiResult(
                    ok=False, url=url, status=resp.status_code,
                    error=f"non-JSON response: {exc}",
                )
            return CultiveraApiResult(
                ok=True, url=url, status=resp.status_code,
                raw=payload, records=extract_records(payload),
            )

        return CultiveraApiResult(ok=False, url=url, error="exhausted retries")

    async def _first_ok(self, paths: tuple[str, ...]) -> CultiveraApiResult:
        """Try candidate paths in order; return the first JSON success.

        Returns the LAST failure if none succeed (so the caller can report why).
        """
        last: CultiveraApiResult | None = None
        for path in paths:
            result = await self._get_json(path)
            if result.ok:
                return result
            last = result
        return last or CultiveraApiResult(ok=False, error="no candidate paths")

    async def search_markets(self, query: str = "") -> CultiveraApiResult:
        """Search the FULL marketplace's vendors by `query`.

        Uses the server-side Search param (PINNED from live capture):
        GET markets/connected?...&Search=<query>&ShowFavoriteOnly=false...
        which searches ALL vendors (hundreds), not just the buyer's connected
        favorites. A tolerant client-side matches_query pass still runs as a
        safety net so space/punctuation differences never hide a real hit.
        Raw payload is preserved for the downstream normalizer.
        """
        path = build_markets_search_path(query)
        result = await self._get_json(path)
        if result.ok and query.strip() and result.records is not None:
            filtered = [r for r in result.records if matches_query(r, query)]
            # Only narrow when the client-side pass still found something; if the
            # server already narrowed to exact hits whose fields we don't match
            # on, keep the server's list rather than blanking it.
            if filtered:
                result = CultiveraApiResult(
                    ok=True, url=result.url, status=result.status,
                    raw=result.raw, records=filtered,
                )
        return result

    async def fetch_market_by_slug(self, slug: str) -> CultiveraApiResult:
        """Resolve a single vendor's market record by its slug."""
        safe = quote(slug.strip(), safe="")
        paths = tuple(p.format(slug=safe) for p in _MARKET_BY_SLUG_PATHS)
        return await self._first_ok(paths)

    async def fetch_menu(self, *, market_id: str = "", slug: str = "") -> CultiveraApiResult:
        """Fetch ONE vendor's live listings (their menu).

        Accepts either a market id or a slug (whichever the caller resolved).
        The raw JSON is returned for the downstream normalizeSnapshot to shape;
        we never assume the item field names here.
        """
        market = (market_id or slug).strip()
        if not market:
            raise CultiveraApiError("fetch_menu requires a market_id or slug")
        safe = quote(market, safe="")
        paths = tuple(p.format(market=safe) for p in _MENU_LISTINGS_PATHS)
        return await self._first_ok(paths)

    async def fetch_product_detail(
        self, *, market_id: str, product_id: str
    ) -> CultiveraApiResult:
        """Fetch ONE product line's full per-variant DETAIL.

        Pinned endpoint (live probe): GET /listings/{productId}/market/{marketId}.
        Returns the raw JSON — one product-line object with a `Products` array of
        per-size variants — for the Next app's pure normalizers to shape (dollar
        floats become integer cents THERE, never here).
        """
        market = (market_id or "").strip()
        product = (product_id or "").strip()
        if not market or not product:
            raise CultiveraApiError(
                "fetch_product_detail requires both a market_id and a product_id"
            )
        safe_market = quote(market, safe="")
        safe_product = quote(product, safe="")
        paths = tuple(
            p.format(market=safe_market, product=safe_product)
            for p in _PRODUCT_DETAIL_PATHS
        )
        return await self._first_ok(paths)
