#!/usr/bin/env python3
"""
R70 - regenerate src/lib/merch-studio/garment-colors-data.ts from Printful's
PUBLIC catalog API (no key needed): GET https://api.printful.com/products/{id}

Usage (from the repo root):
    python3 scripts/merch/refresh-printful-catalog.py
Then review the git diff (new/removed colours, price changes) and run the
pure self-tests. Prices are stored in CENTS (standing rule 8): the lowest
variant price for each size.
"""
import datetime, json, pathlib, urllib.request

IDS = [586, 71, 753, 1543, 839, 943, 629, 99, 206, 422, 266]  # keep in sync with BLANKS in garment-catalog-core.ts
ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "S/M", "L/XL", "One size"]
OUT = pathlib.Path(__file__).resolve().parents[2] / "src/lib/merch-studio/garment-colors-data.ts"


def fetch(i):
    req = urllib.request.Request(f"https://api.printful.com/products/{i}", headers={"User-Agent": "greenway-merch-studio"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["result"]


def main():
    today = datetime.date.today().isoformat()
    data = {i: fetch(i) for i in IDS}
    L = [
        "/**",
        " * R70 S1 - garment colours + per-size base prices, GENERATED from Printful's",
        " * public catalog API (GET https://api.printful.com/products/{id}, no auth)",
        f" * on {today}. Do not hand-edit: re-run the generator in",
        ' * docs/roadmap/R70-MERCH-STUDIO.md section "Refreshing the catalog".',
        " *",
        " * colors: [Printful colour name, Printful colour_code hex]",
        " * sizes:  [size, base price in CENTS (rule 8), lowest variant price for that size]",
        " */",
        "export type ColorRow = readonly [name: string, hex: string];",
        "export type SizeRow = readonly [size: string, cents: number];",
        f'export const PRINTFUL_SNAPSHOT_DATE = "{today}";',
        "export const PRINTFUL_COLORS: Record<number, readonly ColorRow[]> = {",
    ]
    for i in IDS:
        cols = {}
        for v in data[i]["variants"]:
            cols.setdefault(v["color"], (v["color_code"] or "#cccccc").lower())
        L.append(f"  {i}: [" + ", ".join(json.dumps([k, v]) for k, v in cols.items()) + "],")
    L.append("};")
    L.append("export const PRINTFUL_SIZES: Record<number, readonly SizeRow[]> = {")
    for i in IDS:
        sp = {}
        for v in data[i]["variants"]:
            c = round(float(v["price"]) * 100)
            sp[v["size"]] = min(sp.get(v["size"], 10**9), c)
        s = sorted(sp, key=lambda x: ORDER.index(x) if x in ORDER else 99)
        L.append(f"  {i}: [" + ", ".join(json.dumps([k, sp[k]]) for k in s) + "],")
    L.append("};")
    OUT.write_text("\n".join(L) + "\n")
    print(f"wrote {OUT} ({len(IDS)} products)")


if __name__ == "__main__":
    main()
