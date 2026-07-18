"""GF-3 — polite authenticated GrowFlow GraphQL client.

Given a cached session (from growflow_auth), this makes SLOW, human-paced
GraphQL calls to GrowFlow's own API to (1) list the marketplace's stores/vendors
the buyer can see and (2) fetch ONE store's live menu. The owner explicitly
wants polite traffic (not stealth): we pause before every request and reuse the
login as long as possible.

NEVER GUESS:
  * The operation names, variables and response envelopes below were pinned from
    a LIVE authenticated probe of marketplace.growflow.com (see
    probe/GROWFLOW_PINNED.md). getStoreFrontsV2 returns
    `data.getStoreFronts[]`; getStoreListingV2 returns
    `data.getStoreListing { listings[], products[] }`.
  * The raw JSON `data` payload is returned untouched for the downstream tolerant
    normalizers (`normalizeStoreList` / `normalizeSnapshot` in the Next app) to
    interpret. We map field names in exactly one place (growflow-menu-core.ts).

Everything that does NOT touch the network (delay math, GraphQL body building,
pulling a data node out of a GraphQL envelope, client-side store filtering) is a
PURE function so it can be unit-tested with no network — see
crawler/tests/test_growflow_api.py.
"""
from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings, get_settings
from .growflow_auth import (
    GrowflowAuthError,
    GrowflowSessionData,
    auth_headers,
    get_session,
)

# HTTP timeout (seconds) for a single GraphQL call. Generous but bounded — a menu
# fetch can be a large payload. Matches the codebase style (fetcher.py 10/20,
# llm_extract.py 60) of a per-call literal rather than a config field.
_REQUEST_TIMEOUT_SECONDS = 30.0

# --- GraphQL documents (pinned from the live app) ---------------------------
# We request the exact fields the SPA does. Field names are PascalCase because
# that is what GrowFlow's schema uses (verified). If GrowFlow adds/removes a
# field, the tolerant Next normalizer copes; a hard schema error surfaces as a
# GraphQL "errors" array which we return verbatim.
_STOREFRONTS_QUERY = """
query getStoreFrontsV2($state: String!, $vendorId: Int!, $isTraining: Boolean!) {
  getStoreFronts(state: $state, vendorId: $vendorId, isTraining: $isTraining) {
    Id
    LicenseNumber
    VendorId
    AccountId
    Name
    AccessStatus
    IsPrivateVisibility
    IsPublicVisibility
    PreOrders
    Website
    Email
    Phone
    City
    Region
    PostalCode
    Description
    IsFeatured
    IsFavorite
    Order
    LogoUrl
    StoreAccessType
    MinimumOrderValueMode
    MinimumOrderValue
  }
}
""".strip()

_STORE_LISTING_QUERY = """
query getStoreListingV2($state: String!, $vendorId: Int!, $storeFrontId: Int!) {
  getStoreListing(state: $state, vendorId: $vendorId, storeFrontId: $storeFrontId) {
    listings {
      id
      imageUrl
      products { Id }
    }
    products {
      Id
      Price
      DefaultPrice
      Name
      Description
      Discount
      IsSample
      IsEducationalSample
      MSRP
      AvailableGrams
      QuantityType
      Available
      BulkGramsAvailable
      Size
      ImageUrl
      ImageOriginalUrl
      Image2Url
      Image3Url
      VideoEmbedLink
      UnitName
      UnitShortName
      StrainName
      StrainTypeName
      StrainNotes
      ProductCategoryId
      ProductCategoryName
      ProductCategoryParentName
      ProductBrandId
      ProductBrandName
      ProductStatus
      MinTHCMax
      MaxTHCMax
      MinCBDMax
      MaxCBDMax
      MinTotalOptional
      MaxTotalOptional
      MinTotalTerpenes
      MaxTotalTerpenes
      Order
    }
  }
}
""".strip()


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


def build_graphql_body(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    """Build a GraphQL POST body: {"query": ..., "variables": {...}}."""
    return {"query": query, "variables": dict(variables or {})}


def coerce_vendor_id(value: Any) -> int:
    """Coerce a BuyerVendorId to an int (GraphQL wants Int!). 0 when unusable."""
    if isinstance(value, bool):  # bool is an int subclass — reject explicitly
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return 0


def graphql_data_node(payload: Any, field: str) -> Any:
    """Pull `data.<field>` out of a GraphQL envelope, tolerant of shapes.

    Accepts {"data": {field: X}} -> X, or a bare {field: X} -> X, or the bare
    value itself. Returns None when absent. Never raises.
    """
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, dict) and field in data:
            return data[field]
        if field in payload:
            return payload[field]
    return None


def graphql_errors(payload: Any) -> list[str]:
    """Return the list of GraphQL error messages (empty if none)."""
    if not isinstance(payload, dict):
        return []
    errs = payload.get("errors")
    if not isinstance(errs, list):
        return []
    out: list[str] = []
    for e in errs:
        if isinstance(e, dict) and e.get("message"):
            out.append(str(e["message"]))
        elif isinstance(e, str):
            out.append(e)
    return out


def extract_stores(payload: Any) -> list[dict[str, Any]]:
    """Pull the store list out of a getStoreFronts response envelope."""
    node = graphql_data_node(payload, "getStoreFronts")
    if isinstance(node, list):
        return [x for x in node if isinstance(x, dict)]
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    return []


def matches_store(record: dict[str, Any], query: str) -> bool:
    """Case-insensitive substring match of `query` against a store's name/license.

    GrowFlow's own search is client-side over the returned store list, so we
    mirror that here. Empty query matches everything.
    """
    q = (query or "").strip().lower()
    if not q:
        return True
    for key in ("Name", "LicenseNumber", "City", "ProductBrandName"):
        val = record.get(key)
        if isinstance(val, str) and q in val.lower():
            return True
    return False


# ---------------------------------------------------------------------------
# Result value objects
# ---------------------------------------------------------------------------
@dataclass
class GrowflowApiResult:
    """A raw GraphQL result: the `data` payload plus which URL answered.

    `records` is a tolerant list extraction for convenience (stores or products);
    `raw` preserves the full untouched `data` node so the downstream normalizer
    can see everything.
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
class GrowflowApiError(RuntimeError):
    """Raised when an authenticated GrowFlow GraphQL call cannot be completed."""


class GrowflowClient:
    """A thin, polite, re-authenticating GraphQL client.

    Usage (async):
        client = GrowflowClient(settings)
        stores = await client.search_stores("acme farms")
        menu = await client.fetch_menu(store_front_id="1211")

    Every network call:
      * sleeps a human-paced delay BEFORE the request (polite_delay_seconds),
      * attaches the cached session's Bearer auth header,
      * on a 401 re-logs in ONCE (get_session(force=True)) and retries once,
      * returns the raw GraphQL `data` node (never a guessed shape).
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._session: GrowflowSessionData | None = None

    async def _ensure_session(self, *, force: bool = False) -> GrowflowSessionData:
        if self._session is None or force:
            self._session = await get_session(self._settings, force=force)
        return self._session

    async def _sleep_polite(self) -> None:
        delay = polite_delay_seconds(self._settings.growflow_min_delay_seconds)
        if delay > 0:
            await asyncio.sleep(delay)

    def _vendor_id(self, session: GrowflowSessionData) -> int:
        """Resolve the Int BuyerVendorId: explicit override, else the session's."""
        override = coerce_vendor_id(self._settings.growflow_buyer_vendor_id)
        if override:
            return override
        return coerce_vendor_id(session.buyer_vendor_id)

    def _state(self, session: GrowflowSessionData) -> str:
        return (self._settings.growflow_state or session.state or "WA").strip()

    async def _post_graphql(
        self, query: str, variables: dict[str, Any], data_field: str
    ) -> GrowflowApiResult:
        """POST one GraphQL op with auth + politeness + a single 401 re-login."""
        session = await self._ensure_session()
        url = session.graphql_url or self._settings.growflow_graphql
        if not url:
            return GrowflowApiResult(
                ok=False, error="no GraphQL endpoint (login did not discover one)"
            )
        body = build_graphql_body(query, variables)

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
                    resp = await client.post(url, json=body)
            except httpx.HTTPError as exc:
                return GrowflowApiResult(ok=False, url=url, error=f"request failed: {exc}")

            if resp.status_code == 401 and attempt == 0:
                try:
                    session = await self._ensure_session(force=True)
                except GrowflowAuthError as exc:
                    return GrowflowApiResult(
                        ok=False, url=url, status=401, error=f"re-auth failed: {exc}"
                    )
                url = session.graphql_url or self._settings.growflow_graphql
                continue

            if resp.status_code >= 400:
                return GrowflowApiResult(
                    ok=False, url=url, status=resp.status_code, error=f"HTTP {resp.status_code}"
                )

            try:
                payload = resp.json()
            except (ValueError, TypeError) as exc:
                return GrowflowApiResult(
                    ok=False, url=url, status=resp.status_code,
                    error=f"non-JSON response: {exc}",
                )

            errs = graphql_errors(payload)
            if errs:
                return GrowflowApiResult(
                    ok=False, url=url, status=resp.status_code,
                    raw=payload.get("data") if isinstance(payload, dict) else None,
                    error="; ".join(errs),
                )

            data = graphql_data_node(payload, data_field)
            records = data if isinstance(data, list) else None
            return GrowflowApiResult(
                ok=True, url=url, status=resp.status_code, raw=data,
                records=[x for x in records if isinstance(x, dict)] if records else None,
            )

        return GrowflowApiResult(ok=False, url=url, error="exhausted retries")

    async def search_stores(self, query: str = "") -> GrowflowApiResult:
        """List (optionally filter) the marketplace stores/vendors the buyer sees.

        Fetches getStoreFrontsV2 and filters client-side with matches_store
        (mirroring the SPA's own client-side search). Raw payload preserved.
        """
        session = await self._ensure_session()
        variables = {
            "state": self._state(session),
            "vendorId": self._vendor_id(session),
            "isTraining": False,
        }
        result = await self._post_graphql(
            _STOREFRONTS_QUERY, variables, "getStoreFronts"
        )
        if result.ok and query.strip():
            stores = extract_stores({"getStoreFronts": result.raw})
            filtered = [r for r in stores if matches_store(r, query)]
            result = GrowflowApiResult(
                ok=True, url=result.url, status=result.status,
                raw=result.raw, records=filtered,
            )
        return result

    async def fetch_menu(self, *, store_front_id: str = "") -> GrowflowApiResult:
        """Fetch ONE store's live menu (getStoreListingV2).

        Returns the raw `getStoreListing { listings, products }` node for the
        Next app to persist via the tolerant normalizer. We never assume the
        item field names here.
        """
        store = (store_front_id or "").strip()
        if not store:
            raise GrowflowApiError("fetch_menu requires a store_front_id")
        store_id = coerce_vendor_id(store)
        if not store_id:
            raise GrowflowApiError(f"store_front_id must be an integer id (got {store_front_id!r})")
        session = await self._ensure_session()
        variables = {
            "state": self._state(session),
            "vendorId": self._vendor_id(session),
            "storeFrontId": store_id,
        }
        return await self._post_graphql(
            _STORE_LISTING_QUERY, variables, "getStoreListing"
        )
