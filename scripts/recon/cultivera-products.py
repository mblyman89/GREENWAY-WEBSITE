#!/usr/bin/env python3
"""books-71 recon: measure PRODUCTS.xlsx and ask one question of it --
does it carry anything the cut-over needs that INVENTORIES.xlsx does not?
Read-only.
"""
from __future__ import annotations

import sys
from collections import Counter

import openpyxl


def main(path: str) -> int:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["Sheet1"]
    it = ws.iter_rows(values_only=True)
    hdr = ["" if c is None else str(c).strip() for c in next(it)]
    idx = {n: i for i, n in enumerate(hdr)}

    total = 0
    blank_counts = Counter()
    names = Counter()
    exact_dupe_rows = Counter()
    cats = Counter()
    invtypes = Counter()
    vendor_price_present = 0
    price_present = 0
    cannabis = Counter()
    taxexempt = Counter()

    for row in it:
        if row is None or all(c is None or str(c).strip() == "" for c in row):
            continue
        total += 1
        for n, i in idx.items():
            v = row[i]
            if v is None or str(v).strip() == "":
                blank_counts[n] += 1
        names[str(row[idx["Product Name"]]).strip()] += 1
        exact_dupe_rows[tuple("" if c is None else str(c) for c in row)] += 1
        cats[str(row[idx["Category"]]).strip()] += 1
        invtypes[str(row[idx["Inventory Type"]]).strip()] += 1
        if str(row[idx["Vendor Price"]] or "").strip() != "":
            vendor_price_present += 1
        if str(row[idx["Price"]] or "").strip() != "":
            price_present += 1
        cannabis[str(row[idx["Cannabis Y/N"]]).strip()] += 1
        taxexempt[str(row[idx["Tax Exempt Y/N"]]).strip()] += 1

    wb.close()
    print("=" * 78)
    print("MEASURED: PRODUCTS.xlsx")
    print("=" * 78)
    print(f"data rows                     : {total}")
    print(f"distinct Product Name         : {len(names)}")
    dupe_names = sum(1 for v in names.values() if v > 1)
    print(f"names appearing >1 time       : {dupe_names}")
    full_dupes = sum(v - 1 for v in exact_dupe_rows.values() if v > 1)
    print(f"FULLY IDENTICAL duplicate rows: {full_dupes}")
    print(f"rows with a retail Price      : {price_present}")
    print(f"rows with a Vendor Price      : {vendor_price_present}   <-- COST?")
    print(f"Cannabis Y/N                  : {dict(cannabis)}")
    print(f"Tax Exempt Y/N                : {dict(taxexempt)}")
    print()
    print(f"--- Inventory Type ({len(invtypes)} distinct) ---")
    for k, v in invtypes.most_common():
        print(f"  {k:<34} {v}")
    print()
    print(f"--- Category ({len(cats)} distinct) --- (first 15 by count)")
    for k, v in cats.most_common(15):
        print(f"  {k:<34} {v}")
    print()
    print("--- columns that are ENTIRELY blank ---")
    for n in hdr:
        if blank_counts[n] == total:
            print(f"  {n}")
    print()
    print("--- blank counts for the columns that matter to costing ---")
    for n in ("Product Name", "Category", "Inventory Type", "Price",
              "Vendor Price", "Package Size", "UOM", "Brand"):
        if n in idx:
            print(f"  {n:<18} blank={blank_counts[n]} of {total}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
