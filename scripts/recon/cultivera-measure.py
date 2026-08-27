#!/usr/bin/env python3
"""books-71 recon: MEASURE Michael's Cultivera INVENTORIES export.

Read-only. Every number printed here is counted from the file, never inferred.
Money is handled as integer cents via Decimal quantisation (never float).
Rule 1: never guess. Anything ambiguous is reported as ambiguous, not resolved.
"""
from __future__ import annotations

import sys
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

import openpyxl

H = [
    "Id", "Location", "Barcode", "Alias", "Product", "Category", "InventoryType",
    "Strain", "Brand", "Vendor", "Product Price", "Cost", "Units Available For Sale",
    "Units In Stock", "Package Size", "Storage Location", "Is Medical", "Is Cannabis",
    "Is Sample", "Lab", "[COA Y/N]", "Cbd", "Cbda", "Thc", "Thca", "Total",
    "Terpene Total", "Units On Hold", "Quantity Sold", "Quantity Purchased",
    "Expiration date", "Received date",
]


def to_cents(raw) -> int | None:
    """Exact money parse. Returns integer cents, or None if unparseable."""
    if raw is None:
        return None
    s = str(raw).strip().replace("$", "").replace(",", "")
    if s == "":
        return None
    try:
        d = Decimal(s)
    except InvalidOperation:
        return None
    return int((d * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_qty(raw) -> Decimal | None:
    if raw is None:
        return None
    s = str(raw).strip().replace(",", "")
    if s == "":
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def main(path: str) -> int:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Inventories"]
    it = ws.iter_rows(values_only=True)
    header = list(next(it))
    hdr = ["" if c is None else str(c).strip() for c in header]
    if hdr != H:
        print("HEADER DRIFT -- refusing to interpret. Rule 48.")
        print("expected:", H)
        print("actual  :", hdr)
        return 1
    idx = {name: i for i, name in enumerate(hdr)}

    total = 0
    cost_missing = 0
    cost_zero = 0
    cost_ok = 0
    qty_missing = 0
    qty_zero = 0
    qty_neg = 0
    ext_cents = 0
    valued_rows = 0
    unparsed_cost: list[str] = []
    cat = Counter()
    cat_value: dict[str, int] = defaultdict(int)
    locations = Counter()
    is_sample = Counter()
    avail_vs_stock_diff = 0
    onhold_nonzero = 0
    ids = Counter()
    barcodes = Counter()
    barcode_blank = 0
    vendors = Counter()
    zero_cost_units = Decimal(0)

    for row in it:
        if row is None or all(c is None or str(c).strip() == "" for c in row):
            continue
        total += 1
        rid = str(row[idx["Id"]]).strip() if row[idx["Id"]] is not None else ""
        ids[rid] += 1
        bc = str(row[idx["Barcode"]]).strip() if row[idx["Barcode"]] is not None else ""
        if bc == "":
            barcode_blank += 1
        else:
            barcodes[bc] += 1

        locations[str(row[idx["Location"]]).strip()] += 1
        is_sample[str(row[idx["Is Sample"]]).strip()] += 1
        vendors[str(row[idx["Vendor"]]).strip()] += 1
        c = str(row[idx["Category"]]).strip()
        cat[c] += 1

        craw = row[idx["Cost"]]
        cents = to_cents(craw)
        if cents is None:
            if craw is None or str(craw).strip() == "":
                cost_missing += 1
            else:
                unparsed_cost.append(str(craw))
                cost_missing += 1
        elif cents == 0:
            cost_zero += 1
        else:
            cost_ok += 1

        stock = to_qty(row[idx["Units In Stock"]])
        avail = to_qty(row[idx["Units Available For Sale"]])
        if stock is None:
            qty_missing += 1
        elif stock == 0:
            qty_zero += 1
        elif stock < 0:
            qty_neg += 1
        if stock is not None and avail is not None and stock != avail:
            avail_vs_stock_diff += 1
        hold = to_qty(row[idx["Units On Hold"]])
        if hold is not None and hold != 0:
            onhold_nonzero += 1

        if cents is not None and stock is not None and stock > 0:
            if cents == 0:
                zero_cost_units += stock
            else:
                line = int((Decimal(cents) * stock).quantize(
                    Decimal("1"), rounding=ROUND_HALF_UP))
                ext_cents += line
                cat_value[c] += line
                valued_rows += 1

    wb.close()

    def usd(cents: int) -> str:
        return f"${cents // 100:,}.{cents % 100:02d}"

    print("=" * 78)
    print("MEASURED: INVENTORIES.xlsx")
    print("=" * 78)
    print(f"data rows                     : {total}")
    print(f"distinct Location values      : {dict(locations)}")
    print()
    print("--- COST COLUMN (the question that mattered) ---")
    print(f"rows with a usable non-zero Cost : {cost_ok}")
    print(f"rows with Cost = 0               : {cost_zero}")
    print(f"rows with Cost blank/unparseable : {cost_missing}")
    if unparsed_cost:
        print(f"  unparseable samples: {unparsed_cost[:5]}")
    print()
    print("--- QUANTITY ---")
    print(f"Units In Stock blank         : {qty_missing}")
    print(f"Units In Stock = 0           : {qty_zero}")
    print(f"Units In Stock negative      : {qty_neg}")
    print(f"Available != In Stock        : {avail_vs_stock_diff}")
    print(f"Units On Hold non-zero       : {onhold_nonzero}")
    print()
    print("--- VALUE OF THE SHELF (Cost x Units In Stock, stock>0, cost>0) ---")
    print(f"rows contributing value     : {valued_rows}")
    print(f"EXTENDED TOTAL              : {usd(ext_cents)}  ({ext_cents} cents)")
    print(f"units held at cost 0        : {zero_cost_units}")
    print()
    print("--- INTEGRITY ---")
    dup_ids = {k: v for k, v in ids.items() if v > 1}
    dup_bc = {k: v for k, v in barcodes.items() if v > 1}
    print(f"duplicate Id values         : {len(dup_ids)}")
    print(f"blank Barcode rows          : {barcode_blank}")
    print(f"duplicate Barcode values    : {len(dup_bc)}")
    if dup_bc:
        first = list(dup_bc.items())[:3]
        print(f"  examples: {first}")
    print(f"Is Sample distribution      : {dict(is_sample)}")
    print(f"distinct Vendor count       : {len(vendors)}")
    print()
    print(f"--- CATEGORIES ({len(cat)} distinct) ---")
    for name, n in cat.most_common():
        print(f"  {name:<34} rows={n:<6} value={usd(cat_value.get(name, 0))}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
