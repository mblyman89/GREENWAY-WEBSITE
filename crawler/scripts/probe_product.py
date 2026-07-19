"""
crawler/scripts/probe_product.py — ONE-OFF diagnostic (not wired into the API).

The vendor MENU is now solved: POST /listings/market/<marketId> returns the
product cards ({Data:[...]}). Clicking a card on Cultivera's storefront
(page /bm/market/<slug>/product/<productId>) opens a DETAIL page that lists the
per-size VARIANTS in a table: strain name, weight (1g/3.5g/7g/14g), price,
was-price (strike-through discount), available quantity, and a per-variant
image.

We need to find the exact request that returns that variant table. The old code
GUESSED it was GET /listings/<productId>/market/<marketId> — but the menu turned
out to need POST, so we do NOT trust that guess. This probe tries BOTH GET and
POST across the plausible detail routes (with a few filter bodies) and prints
status + record/shape + the first record so we can pin the real one.

Whichever line shows a variant table (look for a 'Products'/'Variants' array or
per-size rows with UnitPrice/AvailableQuantity) is the real request.

Run from the crawler folder with the venv active:
    python -m scripts.probe_product 99 4899
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
        keys = ", ".join(list(first.keys())[:16]) if isinstance(first, dict) else "-"
        return f"LIST(len={len(payload)}) first-item-keys=[{keys}]"
    if isinstance(payload, dict):
        keys = ", ".join(list(payload.keys())[:16])
        return f"OBJECT keys=[{keys}]"
    return f"{type(payload).__name__}"


def _variant_hint(payload: Any) -> str:
    """Look for a nested per-size variant array and report its length + keys."""
    obj = payload
    if isinstance(obj, dict) and isinstance(obj.get("Data"), (dict, list)):
        obj = obj.get("Data")
    if isinstance(obj, list) and obj:
        obj = obj[0]
    if not isinstance(obj, dict):
        return ""
    for key in ("Products", "products", "Variants", "variants", "ProductLines", "Items"):
        arr = obj.get(key)
        if isinstance(arr, list) and arr:
            first = arr[0] if isinstance(arr[0], dict) else {}
            keys = ", ".join(list(first.keys())[:16])
            return f"  <<< VARIANTS[{key}]={len(arr)} keys=[{keys}]"
    return ""


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
        snippet = (resp.text or "")[:300].replace("\n", " ")
        print(f"[{resp.status_code}] {label}\n        {snippet}")
        return
    try:
        payload = resp.json()
    except Exception:  # noqa: BLE001
        print(f"[{resp.status_code}] {label}\n        (non-JSON: {resp.text[:200]!r})")
        return
    recs = extract_records(payload)
    hint = _variant_hint(payload)
    flag = "   <<< HAS RECORDS" if recs else ""
    print(f"[{resp.status_code}] {label}\n        records={len(recs)}  shape={_shape(payload)}{flag}{hint}")
    if recs or hint:
        print("        FIRST RECORD (truncated 2200 chars):")
        first = recs[0] if recs else payload
        print("        " + json.dumps(first, indent=2)[:2200].replace("\n", "\n        "))


async def _probe(market_id: str, product_id: str) -> None:
    settings = get_settings()
    client = CultiveraClient(settings)
    m, p = market_id, product_id

    bodies: list[dict[str, Any]] = [
        {},
        {"CurrentPage": 1, "PageSize": 200},
        {"MarketId": int(m) if m.isdigit() else m, "ProductLineId": int(p) if p.isdigit() else p},
        {"MarketId": int(m) if m.isdigit() else m, "ProductId": int(p) if p.isdigit() else p},
    ]

    # Candidate detail paths (both orderings + a couple of nesting styles).
    detail_paths = [
        f"listings/{p}/market/{m}",
        f"listings/market/{m}/product/{p}",
        f"listings/market/{m}/{p}",
        f"listings/market/{m}/product-lines/{p}",
        f"listings/product/{p}/market/{m}",
        f"listings/{p}",
        f"listings/product-line/{p}",
        f"listings/product-line/{p}/market/{m}",
    ]

    print(f"\n=== GET detail candidates (market {m}, product {p}) ===")
    for path in detail_paths:
        await _request(client, "GET", path)

    print("\n=== POST detail candidates (the menu needed POST — detail might too) ===")
    for path in detail_paths:
        for body in bodies:
            await _request(client, "POST", path, body)

    print("\n" + "=" * 78)
    print("Look for '<<< VARIANTS[...]' — that line is the real product-detail")
    print("request (the per-size weights/prices table). Send me the WHOLE output")
    print("including the FIRST RECORD block and any 400/405 error snippets.\n")


def main() -> None:
    args = sys.argv[1:]
    market_id = args[0] if len(args) >= 1 else "99"
    product_id = args[1] if len(args) >= 2 else "4899"
    asyncio.run(_probe(market_id, product_id))


if __name__ == "__main__":
    main()
