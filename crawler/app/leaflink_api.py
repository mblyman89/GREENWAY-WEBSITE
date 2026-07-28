"""LL-2 — polite cookie-authenticated LeafLink internal-API client.

Given a cached cookie session (from leaflink_auth), this makes SLOW,
human-paced REST calls to LeafLink's own internal API to (1) discover
sellers/brands by searching the shop product catalog and (2) fetch ONE
brand's full menu. The owner explicitly wants polite traffic (not stealth):
we pause before every request and reuse the login as long as possible.

NEVER GUESS:
  * Every endpoint, query param and response envelope below was pinned from a
    LIVE authenticated probe of app.leaflink.com with the owner's retailer
    account (see docs/LEAFLINK_PINNED.md). Unlike GrowFlow (Bearer token +
    GraphQL) LeafLink's internal API is COOKIE-authenticated plain REST with
    classic DRF `{count, next, previous, results[]}` pagination envelopes.
  * Pinned gotcha: `search=<q>` on `shop/products/` is a real filter only when
    it matches something — a NON-matching term silently FALLS BACK to the full
    catalog (same `count` as no search). We therefore probe the unfiltered
    total first and, when the searched count equals it, name-filter the grouped
    brand hits against the query (see `resolve_brand_hits`).
  * A brand's menu is `GET brands/<id>/products?product_lines=1` which returns
    a top-level ARRAY `[{brand, product_lines:[{product_line, products:[...]}]}]`
    whose product rows carry the SAME rich shape as the product-detail endpoint
    (description, quantity, images, specs) — so one call gets the whole menu.
  * The raw JSON payloads are returned untouched for the downstream tolerant
    normalizers (leaflink-menu-core.ts in the Next app) to interpret.

Everything that does NOT touch the network (DRF envelope parsing, next-page
extraction, brand grouping, fallback resolution, menu flattening) is a PURE
function so it can be unit-tested with no network — see
crawler/tests/test_leaflink_api.py. Delay math and tolerant name matching are
shared with the GrowFlow client (same pinned politeness rules).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings, get_settings
from .growflow_api import normalize_for_match, polite_delay_seconds
from .leaflink_auth import (
    LeaflinkAuthError,
    LeaflinkSessionData,
    auth_headers,
    clear_session,
    get_session,
    internal_api_url,
)

# HTTP timeout (seconds) for a single REST call. Generous but bounded — a menu
# fetch can be a large payload. Matches the codebase style of per-call literals
# (growflow_api 30, llm_extract 60).
_REQUEST_TIMEOUT_SECONDS = 30.0

# Pinned page size: the SPA itself pages `shop/products/` with limit=24. We use
# the same size (never a guessed larger one) and follow the DRF `next` URL.
_SEARCH_PAGE_SIZE = 24

# Politeness cap: at most this many search pages per query (24 * 10 = 240
# products is plenty for grouping brand hits out of a search).
_MAX_SEARCH_PAGES = 10


# ---------------------------------------------------------------------------
# PURE helpers (no network) — unit-tested
# ---------------------------------------------------------------------------
def drf_count(payload: Any) -> int:
    """Pull the total `count` out of a DRF envelope. 0 when absent/unusable."""
    if isinstance(payload, dict):
        raw = payload.get("count")
        if isinstance(raw, bool):
            return 0
        if isinstance(raw, int):
            return max(0, raw)
        if isinstance(raw, str) and raw.strip().isdigit():
            return int(raw.strip())
    return 0


def drf_results(payload: Any) -> list[dict[str, Any]]:
    """Pull `results[]` out of a DRF envelope, tolerant of shapes.

    Accepts {"results": [...]} or a bare top-level list (the brand-menu
    endpoint returns a bare array — pinned). Non-dict rows are dropped.
    """
    rows: Any = None
    if isinstance(payload, dict):
        rows = payload.get("results")
    elif isinstance(payload, list):
        rows = payload
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict)]


def next_page_url(payload: Any) -> str:
    """Pull the DRF `next` page URL ('' when there is none)."""
    if isinstance(payload, dict):
        nxt = payload.get("next")
        if isinstance(nxt, str) and nxt.strip().startswith("http"):
            return nxt.strip()
    return ""


def _brand_of(row: dict[str, Any]) -> dict[str, Any]:
    """Tolerantly pull the `brand {id, name, company{id, name}}` node."""
    brand = row.get("brand")
    return brand if isinstance(brand, dict) else {}


def group_products_by_brand(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group product-search rows into brand hits (the vendor-discovery unit).

    Pinned: LeafLink has no usable brand-search endpoint for retailers (the
    Shop Brands tab is JWT/CORS-blocked), so vendor discovery = group product
    hits by `brand {id, name, company{id, name}}`. Each hit carries the brand
    id/name, the selling company, how many matched products it has, and a
    sample image for the UI. Order: most products first, then name.
    """
    grouped: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for row in rows:
        brand = _brand_of(row)
        brand_id = brand.get("id")
        if brand_id is None:
            continue
        key = str(brand_id)
        if key not in grouped:
            company = brand.get("company") if isinstance(brand.get("company"), dict) else {}
            grouped[key] = {
                "brand_id": brand_id,
                "brand_name": str(brand.get("name") or ""),
                "company_id": company.get("id"),
                "company_name": str(company.get("name") or ""),
                "product_count": 0,
                "sample_image": "",
            }
            order.append(key)
        hit = grouped[key]
        hit["product_count"] += 1
        if not hit["sample_image"]:
            img = row.get("featured_image")
            if isinstance(img, str) and img.strip():
                hit["sample_image"] = img.strip()
    hits = [grouped[k] for k in order]
    hits.sort(key=lambda h: (-h["product_count"], h["brand_name"].lower()))
    return hits


def brand_hit_matches(hit: dict[str, Any], query: str) -> bool:
    """Space/punctuation-INSENSITIVE match of `query` against a brand hit's
    brand or company name (same tolerant matching as the GrowFlow client).
    Empty query matches everything.
    """
    q = normalize_for_match(query)
    if not q:
        return True
    for key in ("brand_name", "company_name"):
        val = hit.get(key)
        if isinstance(val, str) and q in normalize_for_match(val):
            return True
    return False


def resolve_brand_hits(
    hits: list[dict[str, Any]],
    *,
    query: str,
    searched_count: int,
    unfiltered_count: int,
) -> list[dict[str, Any]]:
    """Apply the pinned search-fallback gotcha to grouped brand hits.

    LeafLink's `search=` silently falls back to the FULL catalog when nothing
    matches (searched count == unfiltered total). In that case the grouped
    hits are just "whatever the first catalog pages contain", so we keep only
    hits whose brand/company name actually matches the query (usually none —
    which is the honest answer). When the search genuinely filtered
    (counts differ) every grouped hit is a real match and is kept.
    """
    if not query.strip():
        return hits
    if unfiltered_count > 0 and searched_count == unfiltered_count:
        return [h for h in hits if brand_hit_matches(h, query)]
    return hits


def flatten_brand_menu(payload: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Flatten the pinned brand-menu ARRAY into (brand_header, product rows).

    Pinned shape: `[{brand, product_lines:[{product_line, products:[...]}]}]`.
    Each product row gets a `product_line` name attached (copied, source rows
    untouched) so the UI can group by line later. Tolerates missing keys.
    """
    brand: dict[str, Any] = {}
    products: list[dict[str, Any]] = []
    entries = payload if isinstance(payload, list) else [payload]
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if not brand and isinstance(entry.get("brand"), dict):
            brand = entry["brand"]
        lines = entry.get("product_lines")
        if not isinstance(lines, list):
            continue
        for line in lines:
            if not isinstance(line, dict):
                continue
            line_node = line.get("product_line")
            line_name = ""
            if isinstance(line_node, dict):
                line_name = str(line_node.get("name") or "")
            elif isinstance(line_node, str):
                line_name = line_node
            rows = line.get("products")
            if not isinstance(rows, list):
                continue
            for row in rows:
                if isinstance(row, dict):
                    out = dict(row)
                    out.setdefault("product_line", line_name)
                    products.append(out)
    return brand, products


def coerce_brand_id(value: Any) -> int:
    """Coerce a brand id to a positive int (URL path segment). 0 when unusable."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value if value > 0 else 0
    if isinstance(value, float):
        return int(value) if value > 0 else 0
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return 0


# ---------------------------------------------------------------------------
# Result value object
# ---------------------------------------------------------------------------
@dataclass
class LeaflinkApiResult:
    """A raw internal-API result: the payload plus which URL answered.

    `records` is a tolerant list extraction for convenience (brand hits or
    product rows); `raw` preserves the full untouched payload so the
    downstream normalizer can see everything.
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
class LeaflinkApiError(RuntimeError):
    """Raised when an authenticated LeafLink call cannot be completed."""


class LeaflinkClient:
    """A thin, polite, re-authenticating internal-API client.

    Usage (async):
        client = LeaflinkClient(settings)
        brands = await client.search_brands("wyld")
        menu = await client.fetch_menu(brand_id="11765")

    Every network call:
      * sleeps a human-paced delay BEFORE the request (polite_delay_seconds),
      * attaches the cached cookie session's headers,
      * on a 401/403 clears the cached cookies, re-logs in ONCE and retries
        once (pinned: expired cookies answer 403, not 401),
      * returns the raw payload (never a guessed shape).
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._session: LeaflinkSessionData | None = None

    async def _ensure_session(self, *, force: bool = False) -> LeaflinkSessionData:
        if self._session is None or force:
            if force:
                clear_session(self._settings)
            self._session = await get_session(self._settings)
        return self._session

    async def _sleep_polite(self) -> None:
        delay = polite_delay_seconds(self._settings.leaflink_min_delay_seconds)
        if delay > 0:
            await asyncio.sleep(delay)

    def _url(self, path: str) -> str:
        return internal_api_url(
            self._settings.leaflink_site, self._settings.leaflink_slug, path
        )

    async def _get(self, url: str, params: dict[str, Any] | None = None) -> LeaflinkApiResult:
        """GET one internal-API URL with auth + politeness + a single re-login.

        Pinned: cookie-expired calls answer 403 (credentials:'omit' probe) —
        we treat 401 and 403 identically: clear session, re-login, retry once.
        """
        session = await self._ensure_session()
        query = {"error_format": "jsonapi", **(params or {})}

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
                    resp = await client.get(url, params=query)
            except httpx.HTTPError as exc:
                return LeaflinkApiResult(ok=False, url=url, error=f"request failed: {exc}")

            if resp.status_code in (401, 403) and attempt == 0:
                try:
                    session = await self._ensure_session(force=True)
                except LeaflinkAuthError as exc:
                    return LeaflinkApiResult(
                        ok=False, url=url, status=resp.status_code,
                        error=f"re-auth failed: {exc}",
                    )
                continue

            if resp.status_code >= 400:
                return LeaflinkApiResult(
                    ok=False, url=url, status=resp.status_code,
                    error=f"HTTP {resp.status_code}",
                )

            try:
                payload = resp.json()
            except (ValueError, TypeError) as exc:
                return LeaflinkApiResult(
                    ok=False, url=url, status=resp.status_code,
                    error=f"non-JSON response: {exc}",
                )

            return LeaflinkApiResult(
                ok=True, url=url, status=resp.status_code, raw=payload,
                records=drf_results(payload) or None,
            )

        return LeaflinkApiResult(ok=False, url=url, error="exhausted retries")

    async def _search_products(self, query: str) -> LeaflinkApiResult:
        """Walk the paged product search (up to _MAX_SEARCH_PAGES), pooling rows."""
        url = self._url("shop/products/")
        params: dict[str, Any] = {
            "limit": _SEARCH_PAGE_SIZE,
            "offset": 0,
            "search": query.strip(),
            "sort_by": "",
        }
        pooled: list[dict[str, Any]] = []
        first: LeaflinkApiResult | None = None
        next_url = ""
        for page in range(_MAX_SEARCH_PAGES):
            result = (
                await self._get(url, params) if page == 0 else await self._get(next_url)
            )
            if not result.ok:
                return result if first is None else LeaflinkApiResult(
                    ok=True, url=first.url, status=first.status,
                    raw=first.raw, records=pooled,
                )
            if first is None:
                first = result
            pooled.extend(result.records or [])
            next_url = next_page_url(result.raw)
            if not next_url:
                break
        assert first is not None  # loop ran at least once
        return LeaflinkApiResult(
            ok=True, url=first.url, status=first.status, raw=first.raw, records=pooled
        )

    async def search_brands(self, query: str = "") -> LeaflinkApiResult:
        """Discover sellers/brands by searching the shop catalog and grouping.

        Pinned fallback handling: probe the unfiltered total (limit=1) first,
        then run the real search; when the searched count equals the
        unfiltered total the term matched nothing (LeafLink silently returned
        the whole catalog), so the grouped hits are name-filtered against the
        query (see resolve_brand_hits). `records` = brand hits.
        """
        q = (query or "").strip()
        unfiltered_count = 0
        if q:
            probe = await self._get(
                self._url("shop/products/"), {"limit": 1, "offset": 0, "search": "", "sort_by": ""}
            )
            if not probe.ok:
                return probe
            unfiltered_count = drf_count(probe.raw)

        searched = await self._search_products(q)
        if not searched.ok:
            return searched
        hits = group_products_by_brand(searched.records or [])
        hits = resolve_brand_hits(
            hits,
            query=q,
            searched_count=drf_count(searched.raw),
            unfiltered_count=unfiltered_count,
        )
        return LeaflinkApiResult(
            ok=True, url=searched.url, status=searched.status,
            raw=searched.raw, records=hits,
        )

    async def fetch_menu(self, *, brand_id: str = "") -> LeaflinkApiResult:
        """Fetch ONE brand's full menu (header + product-line rows, flattened).

        Two pinned calls: `brands/<id>` (header: name, description, image,
        city, phone, website, ...) and `brands/<id>/products?product_lines=1`
        (rich detail-shaped rows including description, quantity, images,
        specs). `raw` = {"brand": header, "products": flattened rows} and
        `records` = the flattened rows.
        """
        bid = coerce_brand_id(brand_id)
        if not bid:
            raise LeaflinkApiError(
                f"fetch_menu requires an integer brand_id (got {brand_id!r})"
            )

        header = await self._get(self._url(f"brands/{bid}"))
        if not header.ok:
            return header
        menu = await self._get(
            self._url(f"brands/{bid}/products"), {"product_lines": 1}
        )
        if not menu.ok:
            return menu

        flat_brand, products = flatten_brand_menu(menu.raw)
        brand_header = header.raw if isinstance(header.raw, dict) else flat_brand
        return LeaflinkApiResult(
            ok=True, url=menu.url, status=menu.status,
            raw={"brand": brand_header, "products": products},
            records=products,
        )
