"""
crawler/scripts/probe_menu.py — ONE-OFF diagnostic (not wired into the API).

Findings so far (SUBX, market Id=99, SellerBusinessId=432):
  * GET  listings/market/99/product-lines      -> 200 but EMPTY list
  * GET  listings/market/99                     -> 405 (Method Not Allowed!)
  * GET  listings/market/432/product-lines      -> 400 (432 is not a market id)

The 405 on `listings/market/99` is the smoking gun: that route EXISTS but wants
a different HTTP method — almost certainly POST with a filter body. So this v3
probe reuses the crawler's authenticated session to try POST (and a couple GET
variants) on the promising endpoints with several plausible JSON bodies, and
reports status + record count + shape + first record for each.

Whichever line shows records > 0 is the real request. Nothing here changes the
API contract or ships to production.

Run from the crawler folder with the venv active:
    python -m scripts.probe_menu 99 subx
"""
from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

import httpx

from app.cultivera_api import (  # type: ignore
    CultiveraClient,
    extract_records,
    join_url,
)
from app.cultivera_auth import auth_headers, resolve_api_base  # type: ignore
from app.config import get_settings  # type: ignore


def _shape(payload: Any) -> str:
    if isinstance(payload, list):
        first = payload[0] if payload else None
        keys = ", ".join(list(first.keys())[:14]) if isinstance(first, dict) else "-"
        return f"LIST(len={len(payload)}) first-item-keys=[{keys}]"
    if isinstance(payload, dict):
        keys = ", ".join(list(payload.keys())[:14])
        return f"OBJECT keys=[{keys}]"
    return f"{type(payload).__name__}"


async def _request(
    client: CultiveraClient,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> None:
    """Raw method+path+body request via the crawler's authed session."""
    session = await client._ensure_session()  # noqa: SLF001 (diagnostic)
    api_base = resolve_api_base(session, client._settings)  # noqa: SLF001
    url = join_url(api_base, path)
    headers = auth_headers(session)
    label = f"{method:4s} {path}" + (f"  body={json.dumps(body)}" if body else "")
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, headers=headers) as hc:
            if method == "POST":
                resp = await hc.post(url, json=body or {})
            else:
                resp = await hc.get(url)
    except Exception as exc:  # noqa: BLE001
        print(f"[EXC ] {label}\n        {exc}")
        return
    if resp.status_code >= 400:
        # Show a snippet of the error body — it often names the missing field.
        snippet = (resp.text or "")[:300].replace("\n", " ")
        print(f"[{resp.status_code}] {label}\n        {snippet}")
        return
    try:
        payload = resp.json()
    except Exception:  # noqa: BLE001
        print(f"[{resp.status_code}] {label}\n        (non-JSON: {resp.text[:200]!r})")
        return
    recs = extract_records(payload)
    n = len(recs)
    flag = "   <<< HAS RECORDS" if n > 0 else ""
    print(f"[{resp.status_code}] {label}\n        records={n}  shape={_shape(payload)}{flag}")
    if n > 0:
        print("        FIRST RECORD (truncated 1800 chars):")
        print("        " + json.dumps(recs[0], indent=2)[:1800].replace("\n", "\n        "))


async def _probe(market_id: str, slug: str) -> None:
    settings = get_settings()
    client = CultiveraClient(settings)
    m = market_id

    print(f"\n=== POST attempts on market {m} endpoints (the 405 route wants POST) ===")
    bodies: list[dict[str, Any]] = [
        {},
        {"CurrentPage": 1, "PageSize": 200},
        {"CurrentPage": 1, "PageSize": 200, "Search": "", "SortBy": "", "IncludeOutOfStock": True},
        {"MarketId": int(m) if m.isdigit() else m, "CurrentPage": 1, "PageSize": 200},
        {"page": 1, "pageSize": 200},
    ]
    post_paths = [
        f"listings/market/{m}",
        f"listings/market/{m}/product-lines",
        f"listings/market/{m}/products",
    ]
    for path in post_paths:
        for body in bodies:
            await _request(client, "POST", path, body)

    print("\n=== GET the storefront-observed helper calls (context/side-effects) ===")
    for path in (
        f"market/{m}/cart/count",
        f"listings/market/{m}/product-lines",
        f"markets/{m}",
        "markets/connected?CurrentPage=1&PageSize=200&Search=subx&ShowFavoriteOnly=false&MarketSlug=",
    ):
        await _request(client, "GET", path)

    print("\n=== POST a generic listings search with MarketId in the body ===")
    for path in ("listings/search", "listings", "listings/product-lines"):
        for body in (
            {"MarketId": int(m) if m.isdigit() else m, "CurrentPage": 1, "PageSize": 200},
            {"marketId": int(m) if m.isdigit() else m, "page": 1, "pageSize": 200},
        ):
            await _request(client, "POST", path, body)

    print("\n" + "=" * 78)
    print("Any line marked '<<< HAS RECORDS' is the real request. Send me the whole")
    print("output (including the 400/405 error snippets — they often name the fix).\n")


def main() -> None:
    args = sys.argv[1:]
    market_id = args[0] if len(args) >= 1 else "99"
    slug = args[1] if len(args) >= 2 else "subx"
    asyncio.run(_probe(market_id, slug))


if __name__ == "__main__":
    main()
