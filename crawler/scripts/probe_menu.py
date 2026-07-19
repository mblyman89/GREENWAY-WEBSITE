"""
crawler/scripts/probe_menu.py — ONE-OFF diagnostic (not wired into the API).

Cultivera's GET /listings/market/{id}/product-lines returns an EMPTY list for
some vendors (e.g. SUBX, market 99) even though the storefront clearly shows a
menu. This probe reuses the crawler's OWN authenticated CultiveraClient session
to try a list of candidate menu endpoints and reports, for each, the HTTP status,
how many records came back, and the top-level JSON shape — so we can PIN the real
endpoint empirically instead of guessing.

Run it from the crawler folder (same venv the crawler uses):
    python -m scripts.probe_menu 99 subx
or:
    python scripts/probe_menu.py 99 subx

It prints a compact table. Whichever path shows records > 0 is the real one.
Nothing here changes the API contract or ships to production.
"""
from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

# Import the crawler's real client + settings so we reuse the buyer's session.
from app.cultivera_api import CultiveraClient, extract_records  # type: ignore
from app.config import get_settings  # type: ignore


def _shape(payload: Any) -> str:
    """A short human description of the payload's top-level shape."""
    if isinstance(payload, list):
        first = payload[0] if payload else None
        keys = (
            ", ".join(list(first.keys())[:12]) if isinstance(first, dict) else "-"
        )
        return f"LIST(len={len(payload)}) first-item-keys=[{keys}]"
    if isinstance(payload, dict):
        keys = ", ".join(list(payload.keys())[:12])
        return f"OBJECT keys=[{keys}]"
    return f"{type(payload).__name__}"


async def _probe(market_id: str, slug: str) -> None:
    settings = get_settings()
    client = CultiveraClient(settings)

    m = market_id
    s = slug
    # Candidate menu endpoints to try (path templates). Ordered from the current
    # pinned one through plausible alternatives observed on Cultivera storefronts.
    candidates = [
        f"listings/market/{m}/product-lines",
        f"listings/market/{m}",
        f"listings/market/{m}/products",
        f"listings/market/{m}/menu",
        f"listings/market/{m}/product-lines?CurrentPage=1&PageSize=200",
        f"listings/market/{m}/product-lines?PageSize=200&CurrentPage=1&Search=",
        f"markets/{m}/listings",
        f"markets/{m}/product-lines",
        f"markets/{m}/products",
        f"market/{m}/product-lines",
        f"listings/market/slug/{s}/product-lines",
        f"listings/market/{s}/product-lines",
        f"bm/market/{s}/menu",
        f"public/listings/market/{m}/product-lines",
        f"listings/product-lines?marketId={m}",
        f"listings/product-lines?MarketId={m}",
        f"product-lines/market/{m}",
    ]

    print(f"\nProbing menu endpoints for market_id={m!r} slug={s!r}\n" + "=" * 78)
    for path in candidates:
        try:
            res = await client._get_json(path)  # noqa: SLF001 (diagnostic)
        except Exception as exc:  # noqa: BLE001
            print(f"[EXC ] {path}\n        {exc}")
            continue
        if not res.ok:
            print(f"[{res.status or '---'}] {path}\n        error={res.error}")
            continue
        n = len(extract_records(res.raw))
        flag = "  <<< HAS RECORDS" if n > 0 else ""
        print(f"[200 ] {path}\n        records={n}  shape={_shape(res.raw)}{flag}")
        # If we found products, also dump the first record so we can pin fields.
        if n > 0:
            first = extract_records(res.raw)[0]
            print("        FIRST RECORD (truncated 1500 chars):")
            print("        " + json.dumps(first, indent=2)[:1500].replace("\n", "\n        "))
    print("=" * 78 + "\nDone. Any line marked '<<< HAS RECORDS' is the real endpoint.\n")


def main() -> None:
    args = sys.argv[1:]
    market_id = args[0] if len(args) >= 1 else "99"
    slug = args[1] if len(args) >= 2 else "subx"
    asyncio.run(_probe(market_id, slug))


if __name__ == "__main__":
    main()
