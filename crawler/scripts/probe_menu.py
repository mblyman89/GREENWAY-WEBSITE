"""
crawler/scripts/probe_menu.py — ONE-OFF diagnostic (not wired into the API).

Cultivera's GET /listings/market/{id}/product-lines returns an EMPTY list for
SUBX (market 99) at HTTP 200 — the products are real (we see them in the
storefront) so the request must be missing an identifier or parameter the site
sends. The SUBX search record carries SEVERAL ids (Id, SellerBusinessId,
CampaignId, ...); the menu call may key on a DIFFERENT one than the market Id.

This probe reuses the crawler's OWN authenticated CultiveraClient session to:
  1) pull SUBX's full search record and print EVERY id-ish field (so we see the
     real values), then
  2) try the product-lines endpoint against EACH candidate id, plus a few id-in-
     query variants, reporting status + record count + shape for each.

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

from app.cultivera_api import CultiveraClient, extract_records  # type: ignore
from app.config import get_settings  # type: ignore


def _shape(payload: Any) -> str:
    if isinstance(payload, list):
        first = payload[0] if payload else None
        keys = ", ".join(list(first.keys())[:12]) if isinstance(first, dict) else "-"
        return f"LIST(len={len(payload)}) first-item-keys=[{keys}]"
    if isinstance(payload, dict):
        keys = ", ".join(list(payload.keys())[:12])
        return f"OBJECT keys=[{keys}]"
    return f"{type(payload).__name__}"


async def _try(client: CultiveraClient, path: str) -> None:
    """GET one path, print a one-line summary (+first record if it has any)."""
    try:
        res = await client._get_json(path)  # noqa: SLF001 (diagnostic)
    except Exception as exc:  # noqa: BLE001
        print(f"[EXC ] {path}\n        {exc}")
        return
    if not res.ok:
        print(f"[{res.status or '---'}] {path}\n        error={res.error}")
        return
    recs = extract_records(res.raw)
    n = len(recs)
    flag = "   <<< HAS RECORDS" if n > 0 else ""
    print(f"[200 ] {path}\n        records={n}  shape={_shape(res.raw)}{flag}")
    if n > 0:
        print("        FIRST RECORD (truncated 1800 chars):")
        dump = json.dumps(recs[0], indent=2)[:1800]
        print("        " + dump.replace("\n", "\n        "))


async def _probe(market_id: str, slug: str) -> None:
    settings = get_settings()
    client = CultiveraClient(settings)

    # --- 1) Pull SUBX's full search record so we can read every id it carries.
    print(f"\n=== SUBX search record (slug={slug!r}) ===")
    search = await client.search_markets(slug)
    rec: dict[str, Any] | None = None
    if search.ok:
        for r in extract_records(search.raw):
            slug_val = str(r.get("UniqueSlug") or r.get("slug") or "").lower()
            name_val = str(r.get("Name") or r.get("name") or "").lower()
            if slug.lower() in slug_val or slug.lower() in name_val.replace(" ", ""):
                rec = r
                break
        if rec is None and extract_records(search.raw):
            rec = extract_records(search.raw)[0]
    if rec is None:
        print("  (could not find SUBX in search results — using market_id arg only)")
    else:
        print("  FULL RECORD:")
        print("  " + json.dumps(rec, indent=2).replace("\n", "\n  "))

    # Collect candidate ids from the record (dedupe, keep as strings).
    id_fields = [
        "Id", "SellerBusinessId", "CampaignId", "MarketId", "SellerId",
        "BusinessId", "LocationId", "StoreId", "Uuid",
    ]
    ids: list[tuple[str, str]] = [("arg", market_id)]
    if rec:
        for f in id_fields:
            v = rec.get(f)
            if v is not None and str(v).strip() and (f, str(v)) not in ids:
                ids.append((f, str(v)))

    print("\n=== Trying product-lines against each candidate id ===")
    seen: set[str] = set()
    for label, idv in ids:
        for tmpl in (
            "listings/market/{id}/product-lines",
            "listings/seller/{id}/product-lines",
            "listings/business/{id}/product-lines",
            "listings/market/{id}/product-lines?CurrentPage=1&PageSize=200&Search=&SortBy=&IncludeOutOfStock=true",
        ):
            path = tmpl.format(id=idv)
            if path in seen:
                continue
            seen.add(path)
            print(f"-- id[{label}]={idv}")
            await _try(client, path)

    # Also try the slug-based menu the storefront URL used.
    print("\n=== Trying slug-based menu variants ===")
    for path in (
        f"listings/market/slug/{slug}/product-lines",
        f"markets/{slug}/product-lines",
        f"listings/market/{slug}/product-lines",
    ):
        await _try(client, path)

    print("\n" + "=" * 78)
    print("Any line marked '<<< HAS RECORDS' is the real request. Also send me the")
    print("FULL RECORD block above so I can see SUBX's real id values.\n")


def main() -> None:
    args = sys.argv[1:]
    market_id = args[0] if len(args) >= 1 else "99"
    slug = args[1] if len(args) >= 2 else "subx"
    asyncio.run(_probe(market_id, slug))


if __name__ == "__main__":
    main()
