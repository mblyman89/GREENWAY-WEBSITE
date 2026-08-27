#!/usr/bin/env python3
"""books-71 recon: measure the coverage of the map that ALREADY EXISTS.

src/lib/pos/transform.ts CATEGORY_MAP is a hand-built Cultivera-category ->
Greenway-slug map. It is already used by the menu transform. This script parses
it OUT of the TypeScript source (so the measurement cannot drift from the code)
and applies it to Michael's real INVENTORIES.xlsx.

Why parse rather than retype: retyping it here would create a second copy that
can silently disagree with the real one. Rule: measure the artifact, not a memory
of it.
"""
from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import openpyxl

CATEGORY_SLOTS = [
    ("flower", 10), ("popcorn-bud", 20), ("infused-flower", 30), ("trim", 40),
    ("preroll", 50), ("preroll-pack", 60), ("blunt", 70), ("infused-preroll", 80),
    ("infused-preroll-pack", 90), ("infused-blunt", 100), ("cartridge", 120),
    ("disposable-cartridge", 130), ("concentrate", 140), ("rso", 150),
    ("edible-solid", 160), ("edible-liquid", 170), ("tincture", 180),
    ("topical", 190), ("accessories", 200), ("paraphernalia", 210), ("merch", 220),
]
SLOT_OF = dict(CATEGORY_SLOTS)


def acct(slug: str) -> str:
    if slug not in SLOT_OF:
        return "??UNKNOWN-SLUG"
    return "2" + str(SLOT_OF[slug]).zfill(4)


def parse_category_map(ts_path: Path) -> dict[str, str]:
    src = ts_path.read_text()
    m = re.search(
        r"const CATEGORY_MAP: Record<string, GreenwayCategory> = \{(.*?)\n\};",
        src, re.DOTALL)
    if not m:
        raise SystemExit("CATEGORY_MAP not found -- refusing to guess its contents.")
    body = m.group(1)
    out: dict[str, str] = {}
    for line in body.splitlines():
        mm = re.match(r'\s*"([^"]+)"\s*:\s*"([^"]+)"\s*,?\s*(?://.*)?$', line)
        if mm:
            out[mm.group(1)] = mm.group(2)
    return out


def to_cents(raw):
    if raw is None:
        return None
    s = str(raw).strip().replace("$", "").replace(",", "")
    if s == "":
        return None
    try:
        return int((Decimal(s) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except InvalidOperation:
        return None


def to_qty(raw):
    try:
        return Decimal(str(raw).strip().replace(",", ""))
    except (InvalidOperation, AttributeError):
        return None


def usd(c: int) -> str:
    return f"${c // 100:,}.{c % 100:02d}"


def main(xlsx: str, ts: str) -> int:
    cmap = parse_category_map(Path(ts))
    print("=" * 78)
    print("THE MAP THAT ALREADY EXISTS: transform.ts CATEGORY_MAP")
    print("=" * 78)
    print(f"entries parsed out of the TypeScript source : {len(cmap)}")
    bad = {k: v for k, v in cmap.items() if v not in SLOT_OF}
    print(f"entries pointing at a slug with NO account   : {len(bad)}")
    if bad:
        print("   ", bad)

    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    ws = wb["Inventories"]
    it = ws.iter_rows(values_only=True)
    hdr = ["" if c is None else str(c).strip() for c in next(it)]
    idx = {n: i for i, n in enumerate(hdr)}

    total_val = 0
    hit_rows = hit_val = 0
    miss_rows = miss_val = 0
    miss: dict[str, list] = defaultdict(lambda: [0, 0])
    acct_val: dict[str, int] = defaultdict(int)
    acct_rows: dict[str, int] = defaultdict(int)
    cats_seen = Counter()

    for row in it:
        if row is None or all(c is None or str(c).strip() == "" for c in row):
            continue
        cat = re.sub(r"\s+", " ", str(row[idx["Category"]]).strip())
        cats_seen[cat] += 1
        cents = to_cents(row[idx["Cost"]])
        qty = to_qty(row[idx["Units In Stock"]])
        val = 0
        if cents is not None and qty is not None and qty > 0:
            val = int((Decimal(cents) * qty).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        total_val += val
        slug = cmap.get(cat)
        if slug is None:
            miss_rows += 1
            miss_val += val
            e = miss[cat]
            e[0] += 1
            e[1] += val
            acct_val["20890"] += val
            acct_rows["20890"] += 1
        else:
            hit_rows += 1
            hit_val += val
            acct_val[acct(slug)] += val
            acct_rows[acct(slug)] += 1
    wb.close()

    def pct(x: int) -> str:
        return f"{(Decimal(x) * 100 / Decimal(total_val)).quantize(Decimal('0.01'))}%"

    print()
    print(f"Cultivera categories in the file            : {len(cats_seen)}")
    print(f"of those, PRESENT in the existing map       : "
          f"{sum(1 for c in cats_seen if c in cmap)}")
    print(f"of those, ABSENT from the existing map      : "
          f"{sum(1 for c in cats_seen if c not in cmap)}")
    print()
    print(f"TOTAL shelf value : {usd(total_val)}")
    print(f"  mapped   rows={hit_rows:<6} {usd(hit_val):>13}  {pct(hit_val)}")
    print(f"  UNMAPPED rows={miss_rows:<6} {usd(miss_val):>13}  {pct(miss_val)}")
    print()
    print("--- CATEGORIES THE EXISTING MAP DOES NOT COVER ---")
    if not miss:
        print("  (none -- the existing map covers every category in the file)")
    for k, (n, v) in sorted(miss.items(), key=lambda kv: -kv[1][1]):
        print(f"  {k:<26} rows={n:<5} {usd(v)}")
    print()
    print("--- OPENING BALANCE BY ACCOUNT, using the EXISTING map ---")
    for a in sorted(acct_val, key=lambda k: -acct_val[k]):
        print(f"  {a}  rows={acct_rows[a]:<6} {usd(acct_val[a]):>13}")
    print(f"         TOTAL   {usd(sum(acct_val.values())):>13}")
    assert sum(acct_val.values()) == total_val, "value leaked"
    print("  (assert passed: no value leaked)")
    print()
    print("--- NOTE: entries in the map whose slug has no inventory account ---")
    print("    (these would post to a non-existent account if used blindly)")
    for k, v in cmap.items():
        if v not in SLOT_OF:
            print(f"    {k!r} -> {v!r}")
    if not bad:
        print("    (none)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
