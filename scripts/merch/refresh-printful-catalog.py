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

IDS = [586, 71, 753, 1543, 839, 943, 629, 99, 206, 422, 266, 765, 531, 541, 502]  # keep in sync with BLANKS in garment-catalog-core.ts
# D278: products Printful's public v1 API doesn't serve (404) - read from a hand-copied snapshot of Printful's product pages.
SITE_SNAPSHOT = pathlib.Path(__file__).resolve().parent / "printful-site-snapshot.json"
SITE_IDS = [772, 626, 707, 763, 790, 625, 800]
ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "S/M", "L/XL", "One size"]
OUT = pathlib.Path(__file__).resolve().parents[2] / "src/lib/merch-studio/garment-colors-data.ts"


def fetch(i):
    req = urllib.request.Request(f"https://api.printful.com/products/{i}", headers={"User-Agent": "greenway-merch-studio"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)["result"]


def from_snapshot(snap, i):
    p = snap["products"][str(i)]
    return {
        "product": {"image": p["image"], "files": [{"id": k, "type": v} for k, v in p["files"].items()], "options": [{"id": o} for o in p["options"]]},
        "variants": [{"color": c, "size": sz, "id": vid, "price": cents / 100, "in_stock": st, "color_code": hx, "image": img} for c, sz, vid, cents, st, hx, img in p["variants"]],
    }


def main():
    global IDS
    today = datetime.date.today().isoformat()
    data = {i: fetch(i) for i in IDS}
    snap = json.loads(SITE_SNAPSHOT.read_text())
    for i in SITE_IDS:
        data[i] = from_snapshot(snap, i)
    for k, extra in snap.get("extra", {}).items():
        pr = data[int(k)]["product"]
        have = {f["id"] for f in pr["files"]}
        pr["files"] += [{"id": a, "type": b} for a, b in extra.get("files", {}).items() if a not in have]
        haveo = {o["id"] for o in pr["options"]}
        pr["options"] += [{"id": o} for o in extra.get("options", []) if o not in haveo]
    IDS = IDS + SITE_IDS
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
    # R71 S3: Printful file id -> file TYPE (what the Orders + Mockup APIs expect).
    L.append("/** R71: Printful file id (catalog `files[].id`) -> file type (`files[].type`, used by the Orders + Mockup APIs). */")
    L.append("export const PRINTFUL_FILE_TYPES: Record<number, Readonly<Record<string, string>>> = {")
    for i in IDS:
        ft = {f["id"]: f["type"] for f in data[i]["product"]["files"] if f["type"] != "mockup"}
        L.append(f"  {i}: {{" + ", ".join(f"{json.dumps(k)}: {json.dumps(v)}" for k, v in ft.items()) + "},")
    L.append("};")
    # R71 S3: product option ids (thread_colors_*, embroidery_type, ...) so exports never invent an option name.
    L.append("/** R71: Printful product option ids (catalog `product.options[].id`). */")
    L.append("export const PRINTFUL_OPTION_IDS: Record<number, readonly string[]> = {")
    for i in IDS:
        L.append(f"  {i}: [" + ", ".join(json.dumps(o["id"]) for o in data[i]["product"]["options"]) + "],")
    L.append("};")
    # R71 S4: every catalog variant (colour x size) -> Printful variant_id + base price (cents) + stock flag.
    L.append("/** R71: [colour name, size, Printful catalog variant_id, base price CENTS, in stock] per product. */")
    L.append("export type VariantRow = readonly [color: string, size: string, variantId: number, cents: number, inStock: boolean];")
    L.append("export const PRINTFUL_VARIANTS: Record<number, readonly VariantRow[]> = {")
    for i in IDS:
        rows = []
        for v in data[i]["variants"]:
            rows.append("[" + ", ".join([json.dumps(v["color"]), json.dumps(v["size"]), str(int(v["id"])), str(round(float(v["price"]) * 100)), "true" if v.get("in_stock") else "false"]) + "]")
        L.append(f"  {i}: [" + ", ".join(rows) + "],")
    L.append("};")
    # Garment preview slice: per colour [name, colour_code, colour_code2 (two-tone) or null, Printful variant photo URL] + product photo.
    L.append("/** Garment preview: [colour name, colour_code, colour_code2 (second colour of a two-tone item) or null, Printful's photo of that colour]. */")
    L.append("export type ColorInfoRow = readonly [name: string, hex: string, hex2: string | null, image: string];")
    L.append("export const PRINTFUL_COLOR_INFO: Record<number, readonly ColorInfoRow[]> = {")
    for i in IDS:
        ci = {}
        for v in data[i]["variants"]:
            if v["color"] not in ci:
                h2 = v.get("color_code2")
                ci[v["color"]] = [v["color"], (v["color_code"] or "#cccccc").lower(), h2.lower() if h2 else None, v.get("image") or ""]
        L.append(f"  {i}: [" + ", ".join(json.dumps(r) for r in ci.values()) + "],")
    L.append("};")
    L.append("/** Garment preview: Printful's main product photo. */")
    L.append("export const PRINTFUL_PRODUCT_IMAGE: Record<number, string> = {")
    for i in IDS:
        L.append(f"  {i}: {json.dumps(data[i]['product'].get('image') or '')},")
    L.append("};")
    OUT.write_text("\n".join(L) + "\n")
    print(f"wrote {OUT} ({len(IDS)} products)")


if __name__ == "__main__":
    main()
