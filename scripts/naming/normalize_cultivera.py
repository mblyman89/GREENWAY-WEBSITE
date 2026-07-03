#!/usr/bin/env python3
"""
normalize_cultivera.py — normalize Cultivera Product/Inventory exports to the
Greenway naming convention, ready to re-upload into Cultivera.

WHY
---
Cultivera enforces a UNIQUE Product Name and uses it as its de-facto master key
(see docs/CULTIVERA_NAMING_RESEARCH.md). The owner's two exports carry hundreds
of accidental spelling variants and messy free-text names. This script rebuilds
each Name from the *structured columns* (the trustworthy source of truth) using
the finalized Greenway convention, then:

  • collapses exact-duplicate canonical Names to a single master row,
  • keeps genuinely-different SKUs unique by always carrying the package Size,
  • preserves strain tokens (never invents/merges strain spellings — flags them),
  • strips commas / disallowed chars and clamps to 75 chars (CCRS ceiling),
  • emits *_NORMALIZED.xlsx + a change report + a duplicates report.

GROUNDING (never guess)
-----------------------
Names are rebuilt ONLY from columns that exist in the sheet:
  INVENTORIES: Vendor, Brand, Strain, Category, InventoryType, Thc/Thca/Cbd/Cbda,
               Package Size.
  PRODUCTS:    Brand, Strain, Category, Type, Inventory Type, UOM, Package Size
               (NO Vendor column, NO cannabinoid columns -> no vendor prefix / no
               ratio tag can be derived, and that limitation is reported, not faked).

The convention mirrors src/lib/naming/convention-core.ts (the TS engine that also
powers the CCRS export and the website cards) so every surface agrees.

USAGE
-----
  python3 scripts/naming/normalize_cultivera.py \
      --products  /workspace/PRODUCTS_UPDATED.xlsx \
      --inventories /workspace/INVENTORIES_UPDATED.xlsx \
      --outdir    /workspace/normalized_cultivera

Requires: openpyxl.
"""

from __future__ import annotations

import argparse
import os
import re
from collections import Counter, defaultdict
from typing import Optional

import openpyxl

# ------------------------------------------------------------------ #
#  Convention core (faithful Python port of convention-core.ts)
# ------------------------------------------------------------------ #

NAME_MAX_LEN = 75
DISALLOWED = re.compile(r'[,/&!#$@"|\u0000-\u001f]')

# Acronyms + units that must NOT be title-cased away.
_ACRONYMS = {"THC", "CBD", "CBG", "CBN", "CBC", "CBDA", "THCA", "CBDV", "RSO", "AIO", "CBD:THC"}
_UNIT_RE = re.compile(r"^\d+(\.\d+)?(mg|g|oz|ml|floz|pk)$", re.I)
_RATIO_RE = re.compile(r"^\d+(:\d+){1,3}$")  # 1:1, 2:1, 2:1:1


def collapse_ws(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def strip_disallowed(s: str) -> str:
    return DISALLOWED.sub(" ", s or "")


def title_case(s: str) -> str:
    out = []
    for word in collapse_ws(s).split(" "):
        if not word:
            continue
        up = word.upper()
        if up in _ACRONYMS or _RATIO_RE.match(word) or _UNIT_RE.match(word) or up.rstrip("S") in _ACRONYMS:
            # keep ratios/units as-is; keep acronyms upper.
            out.append(word if (_RATIO_RE.match(word) or _UNIT_RE.match(word)) else up)
        else:
            out.append(word[0].upper() + word[1:].lower())
    return " ".join(out)


def to_number(v) -> Optional[float]:
    if v is None:
        return None
    try:
        n = float(str(v).replace("%", "").strip())
        return n if n == n else None  # NaN guard
    except (ValueError, TypeError):
        return None


# THC:CBD:CBN:CBG:CBC canonical order for the multi-compound tag.
_TAG_ORDER = ["thc", "cbd", "cbg", "cbn", "cbc"]
_TAG_LABEL = {"thc": "THC", "cbd": "CBD", "cbg": "CBG", "cbn": "CBN", "cbc": "CBC"}
_RATIO_CANDIDATES = [1, 2, 3, 4, 5, 10, 20]


def ratio_tag(thc: float, cbd: float) -> str:
    if thc <= 0 or cbd <= 0:
        return ""
    bigger, smaller = max(thc, cbd), min(thc, cbd)
    r = bigger / smaller
    best = min(_RATIO_CANDIDATES, key=lambda c: abs(r - c))
    return f"{best}:1" if thc >= cbd else f"1:{best}"


# A co-cannabinoid must be at least this fraction of the DOMINANT cannabinoid to
# count toward the tag. Real cannabis flower/carts routinely carry 1-2% "trace"
# CBD; tagging a 92%THC / 1.7%CBD cart as "20:1" is misleading and clutters the
# name, so trace amounts are treated as single-cannabinoid (no tag). 0.10 keeps
# genuine 1:1..5:1 and 10:1 products tagged while dropping trace noise.
#   share >= 0.10  <=>  ratio <= 10:1   (matches the ratio snap ceiling of 10)
MIN_CO_CANNABINOID_SHARE = 0.10


def _meaningful(present: dict[str, float]) -> list[str]:
    """Return the tag-eligible cannabinoids after dropping trace co-compounds."""
    active = {k: v for k, v in present.items() if v > 0}
    if not active:
        return []
    dominant = max(active.values())
    if dominant <= 0:
        return []
    kept = {k for k, v in active.items() if v / dominant >= MIN_CO_CANNABINOID_SHARE}
    return [k for k in _TAG_ORDER if k in kept]


def cannabinoid_tag(present: dict[str, float]) -> str:
    """present: canonical-type -> value (>0). Folds acids already done by caller.
    Trace co-cannabinoids (< MIN_CO_CANNABINOID_SHARE of the dominant) are ignored
    so THC-dominant products with trace CBD stay THC-only (no misleading ratio)."""
    keys = _meaningful(present)
    if len(keys) <= 1:
        return ""  # single dominant cannabinoid (or none) => no tag
    thc = present.get("thc", 0)
    cbd = present.get("cbd", 0)
    if len(keys) == 2 and thc > 0 and cbd > 0 and set(keys) == {"thc", "cbd"}:
        return ratio_tag(thc, cbd)
    return ":".join(_TAG_LABEL[k] for k in keys)


def clamp_75(s: str) -> str:
    s = collapse_ws(s)
    if len(s) <= NAME_MAX_LEN:
        return s
    cut = s[:NAME_MAX_LEN]
    # back off to the last word boundary so we never split a token
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 0 else cut).strip()


def normalize_size(raw: str) -> str:
    """
    Turn Cultivera package-size strings into a compact convention token.
      '1.00 Grams'   -> '1g'
      '3.50 Grams'   -> '3.5g'
      '2.00 FluidOunce' -> '2floz'
      '1.00 Each'    -> ''      (a bare count is not a size token)
      '3.00 Grams' (cart 3pk) -> '3g'
    Flower stays grams. Returns '' when there's no meaningful size.
    """
    s = collapse_ws(raw)
    if not s:
        return ""
    m = re.match(r"^([\d.]+)\s*([A-Za-z ]+)$", s)
    if not m:
        return ""
    qty = float(m.group(1))
    unit = m.group(2).strip().lower()
    q = ("%g" % qty)  # trims trailing zeros: 3.50 -> 3.5, 1.00 -> 1
    if unit in ("grams", "gram", "g"):
        return f"{q}g"
    if unit in ("ounce", "ounces", "oz"):
        return f"{q}oz"
    if unit in ("fluidounce", "fluid ounce", "floz", "fl oz"):
        return f"{q}floz"
    if unit in ("milliliter", "milliliters", "ml"):
        return f"{q}ml"
    if unit in ("milligram", "milligrams", "mg"):
        return f"{q}mg"
    if unit in ("each", "ea", "unit", "units"):
        return ""  # bare count -> not a size
    return ""


# ------------------------------------------------------------------ #
#  Deterministic pre-clean of a raw name (safe, no guessing)
# ------------------------------------------------------------------ #

_STRAIN_PREFIX = re.compile(r"^(indica|sativa|hybrid)\s*-\s*", re.I)


def preclean_raw_name(name: str) -> str:
    n = name or ""
    n = n.replace("_", " ")
    n = re.sub(r"^\s*-\s*", "", n)          # leading dash
    n = _STRAIN_PREFIX.sub("", n)           # 'Indica - ' style prefix
    n = strip_disallowed(n)                 # commas, /, &, etc.
    n = re.sub(r"\s*-\s*", " ", n)          # ' - ' delimiters -> space
    n = collapse_ws(n)
    return n


# ------------------------------------------------------------------ #
#  Build a convention name from structured columns
# ------------------------------------------------------------------ #


def build_name(vendor: str, brand: str, strain: str, tag: str, ptype: str, size: str) -> str:
    """Assemble '{Vendor} {Brand} {Strain} {Tag} {Type} {Size}' with owner rules."""
    parts: list[str] = []
    vendor = collapse_ws(vendor)
    brand = collapse_ws(brand)
    strain = collapse_ws(strain)
    ptype = collapse_ws(ptype)
    size = collapse_ws(size)

    if vendor:
        parts.append(vendor)
    # Owner rule Q2: drop Brand when it equals the Vendor.
    if brand and brand.lower() != vendor.lower():
        parts.append(brand)
    if strain:
        parts.append(strain)
    if tag:
        parts.append(tag)
    if ptype:
        parts.append(ptype)
    if size:
        parts.append(size)

    name = title_case(strip_disallowed(" ".join(parts)))
    # keep the size token lowercase-unit (title_case already preserves via _UNIT_RE)
    return clamp_75(name)


def _with_suffix(base: str, suffix: str) -> str:
    """Append `suffix` while GUARANTEEING the result is <= NAME_MAX_LEN by trimming
    the base first (not the suffix). This makes uniqueness termination guaranteed:
    a long base can never swallow the suffix during clamping (the original infinite
    loop was caused by clamp_75 truncating the suffix back off a 75-char name)."""
    budget = NAME_MAX_LEN - len(suffix) - 1  # -1 for the joining space
    trimmed = base[:budget].rstrip()
    sp = trimmed.rfind(" ")
    if sp > 0:
        trimmed = trimmed[:sp]
    return f"{trimmed} {suffix}".strip()


def make_unique(base: str, taken: set[str], fallback_size: str) -> str:
    """Ensure Name uniqueness (Cultivera requirement). If a collision remains even
    after including size, append a numeric suffix — reported so the owner can split.
    Guaranteed to terminate (see _with_suffix)."""
    if base.lower() not in taken:
        taken.add(base.lower())
        return base
    # Try adding the size if it wasn't already in the base.
    if fallback_size and fallback_size.lower() not in base.lower():
        cand = _with_suffix(base, fallback_size)
        if cand.lower() not in taken:
            taken.add(cand.lower())
            return cand
    # Last resort: numeric suffix (bounded — always fits in the length budget).
    i = 2
    while True:
        cand = _with_suffix(base, str(i))
        if cand.lower() not in taken:
            taken.add(cand.lower())
            return cand
        i += 1


# ------------------------------------------------------------------ #
#  File processors
# ------------------------------------------------------------------ #


def load(path: str):
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    header = [str(h) if h is not None else "" for h in rows[0]]
    data = rows[1:]
    idx = {h: i for i, h in enumerate(header)}
    return header, data, idx


def cell(row, idx, col) -> str:
    if col not in idx:
        return ""
    v = row[idx[col]]
    return "" if v is None else str(v).strip()


def process_inventories(path: str, outdir: str):
    header, data, idx = load(path)
    taken: set[str] = set()
    changes = []       # (row_id, old, new, notes)
    strain_variants = defaultdict(set)  # normalized_strain -> {raw spellings}
    out_rows = []

    for row in data:
        old = cell(row, idx, "Product")
        vendor = cell(row, idx, "Vendor")
        brand = cell(row, idx, "Brand")
        strain = cell(row, idx, "Strain")
        ptype = cell(row, idx, "Category")  # Category is the human type (Flower, Cartridge, ...)
        inv_type = cell(row, idx, "InventoryType")
        size = normalize_size(cell(row, idx, "Package Size"))
        is_cannabis = cell(row, idx, "Is Cannabis").lower() == "true"

        # Cannabinoid tag from verified columns (fold acid forms).
        present = {}
        thc = (to_number(cell(row, idx, "Thc")) or 0) + (to_number(cell(row, idx, "Thca")) or 0)
        cbd = (to_number(cell(row, idx, "Cbd")) or 0) + (to_number(cell(row, idx, "Cbda")) or 0)
        if thc > 0:
            present["thc"] = thc
        if cbd > 0:
            present["cbd"] = cbd
        tag = cannabinoid_tag(present) if is_cannabis else ""

        # track strain spelling variants (flag only, never auto-merge — S3)
        if strain:
            strain_variants[strain.strip().lower()].add(strain)

        if is_cannabis:
            new = build_name(vendor, brand, strain, tag, ptype, size)
        else:
            # Non-cannabis: {Brand} {Type} {Size} (owner Slice B convention).
            new = clamp_75(title_case(strip_disallowed(" ".join(p for p in [brand, ptype, size] if p))))

        notes = []
        if not new:
            new = preclean_raw_name(old)
            notes.append("rebuild_empty_fell_back_to_precleaned_name")
        new = make_unique(new, taken, size)
        if new.lower() != (old or "").strip().lower():
            notes.append("renamed")
        changes.append((cell(row, idx, "Id"), old, new, ";".join(notes)))
        out_rows.append((row, new))

    _write_inventories(header, out_rows, idx, outdir)
    _write_change_report(changes, os.path.join(outdir, "INVENTORIES_change_report.csv"))
    _write_strain_variants(strain_variants, os.path.join(outdir, "INVENTORIES_strain_variants.csv"))
    return changes, out_rows


def process_products(path: str, outdir: str):
    """
    PRODUCTS is the product *master*. We (1) rebuild each Name from structured
    columns, (2) COLLAPSE genuine duplicates — rows whose distinguishing fields
    (brand/strain/type/size/cannabis) are identical AND whose rebuilt name matches
    — into a single master row (Cultivera product-mastering), and (3) only force a
    unique suffix on rows that collide but are genuinely DIFFERENT SKUs. The change
    report records every row's disposition; the duplicates report lists the groups
    that were collapsed so the owner can confirm (or split) each one.
    """
    header, data, idx = load(path)

    # First pass: compute the rebuilt name + a structural key for each row.
    prepared = []  # (row, base_name, struct_key, is_cannabis, size, old, notes)
    for row in data:
        old = cell(row, idx, "Product Name")
        brand = cell(row, idx, "Brand")
        strain = cell(row, idx, "Strain")
        ptype = cell(row, idx, "Category")
        size = normalize_size(f"{cell(row, idx, 'Package Size')} {cell(row, idx, 'UOM')}")
        is_cannabis = cell(row, idx, "Cannabis Y/N").upper() == "Y"

        notes = ["no_vendor_column", "no_cannabinoid_columns"]
        if is_cannabis:
            # Cannabis products have a real Strain (the distinguishing token) so a
            # column rebuild is safe and grounded.
            base = build_name("", brand, strain, "", ptype, size)
        else:
            # Non-cannabis: the source Brand/Type columns are generic (e.g. every
            # rolling paper is Brand="Raw", Type="Accessories"), while the real
            # distinguishing detail (flavor/size/style) lives in the ORIGINAL name.
            # A column rebuild would over-collapse distinct SKUs, so we instead
            # deterministically CLEAN the original name (preserving its tokens).
            base = clamp_75(title_case(preclean_raw_name(old)))
            notes.append("noncannabis_cleaned_original_name")

        if not base:
            base = preclean_raw_name(old)
            notes.append("rebuild_empty_fell_back_to_precleaned_name")

        # The structural dedup key must include the FULL rebuilt name so we only
        # collapse rows that are truly identical after normalization (never merge
        # two different SKUs just because their generic columns match).
        struct = base.lower()
        prepared.append((row, base, struct, is_cannabis, size, old, notes))

    # Group by structural key to find TRUE duplicates (same product, repeated).
    groups = defaultdict(list)
    for i, p in enumerate(prepared):
        groups[p[2]].append(i)

    kept_index = set()          # first row of each true-dup group survives
    collapsed_of = {}           # index -> master index (for reporting)
    dup_groups = []             # (master_name, count) for the duplicates report
    for key, members in groups.items():
        master = members[0]
        kept_index.add(master)
        if len(members) > 1:
            dup_groups.append((prepared[master][1], len(members)))
            for m in members[1:]:
                collapsed_of[m] = master

    # Second pass: assign final unique names ONLY to the kept (master) rows.
    taken: set[str] = set()
    changes = []
    out_rows = []
    for i, (row, base, struct, is_c, size, old, notes) in enumerate(prepared):
        if i in kept_index:
            new = make_unique(base, taken, size)
            disp = list(notes)
            if len([m for m in groups[struct]]) > 1:
                disp.append(f"master_of_{len(groups[struct])}_duplicates")
            if new.lower() != (old or "").strip().lower():
                disp.append("renamed")
            changes.append(("", old, new, ";".join(disp)))
            out_rows.append((row, new))
        else:
            master_i = collapsed_of[i]
            master_name = prepared[master_i][1]
            changes.append(("", old, master_name, "collapsed_duplicate;merged_into_master"))
            # NOT written to the master output (it is a duplicate).

    _write_products(header, out_rows, idx, outdir)
    _write_change_report(changes, os.path.join(outdir, "PRODUCTS_change_report.csv"))
    _write_collapsed_report(dup_groups, os.path.join(outdir, "PRODUCTS_collapsed_groups.csv"))
    return changes, out_rows


# ------------------------------------------------------------------ #
#  Writers
# ------------------------------------------------------------------ #


def _sanitize_cell(v):
    """openpyxl write_only accepts str/num/bool/datetime/None. Stringify anything odd."""
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _write_inventories(header, out_rows, idx, outdir):
    # write_only mode: fast + memory-light for thousands of rows.
    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet("Inventories")
    ws.append(header)
    pi = idx["Product"]
    for row, new in out_rows:
        r = [_sanitize_cell(c) for c in row]
        r[pi] = new
        ws.append(r)
    wb.save(os.path.join(outdir, "INVENTORIES_NORMALIZED.xlsx"))


def _write_products(header, out_rows, idx, outdir):
    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet("Products")
    ws.append(header)
    pi = idx["Product Name"]
    for row, new in out_rows:
        r = [_sanitize_cell(c) for c in row]
        r[pi] = new
        ws.append(r)
    wb.save(os.path.join(outdir, "PRODUCTS_NORMALIZED.xlsx"))


def _write_change_report(changes, path):
    import csv
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Id", "Old Name", "New Name", "Notes"])
        for c in changes:
            w.writerow(c)


def _write_collapsed_report(dup_groups, path):
    import csv
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Master Name", "Rows Collapsed Into It (incl. master)"])
        for name, count in sorted(dup_groups, key=lambda kv: -kv[1]):
            w.writerow([name, count])


def _write_strain_variants(variants, path):
    import csv
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Normalized Strain (lower)", "Distinct Spellings Seen", "Spellings"])
        for k, spells in sorted(variants.items()):
            if len(spells) > 1:
                w.writerow([k, len(spells), " | ".join(sorted(spells))])


def _dup_report(out_rows, name_getter, path, label):
    import csv
    # count by NEW name (post-normalization)
    counts = Counter(new.lower() for _, new in out_rows)
    dups = {k: v for k, v in counts.items() if v > 1}
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([f"{label} Duplicate New-Name (lower)", "Count"])
        for k, v in sorted(dups.items(), key=lambda kv: -kv[1]):
            w.writerow([k, v])
    return len(dups), sum(dups.values())


# ------------------------------------------------------------------ #
#  Main
# ------------------------------------------------------------------ #


def summarize(label, changes):
    total = len(changes)
    renamed = sum(1 for c in changes if "renamed" in c[3])
    return total, renamed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--products", required=True)
    ap.add_argument("--inventories", required=True)
    ap.add_argument("--outdir", required=True)
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    inv_changes, inv_rows = process_inventories(args.inventories, args.outdir)
    prod_changes, prod_rows = process_products(args.products, args.outdir)

    inv_dupg, inv_duprows = _dup_report(
        inv_rows, lambda r: "", os.path.join(args.outdir, "INVENTORIES_duplicates_after.csv"), "Inventory"
    )
    prod_dupg, prod_duprows = _dup_report(
        prod_rows, lambda r: "", os.path.join(args.outdir, "PRODUCTS_duplicates_after.csv"), "Product"
    )

    it, ir = summarize("INVENTORIES", inv_changes)
    pt, pr = summarize("PRODUCTS", prod_changes)

    print("=" * 64)
    print("NORMALIZATION SUMMARY")
    print("=" * 64)
    print(f"INVENTORIES: {it} rows | {ir} renamed | dup new-name groups AFTER: {inv_dupg} ({inv_duprows} rows)")
    print(f"PRODUCTS   : {pt} rows | {pr} renamed | dup new-name groups AFTER: {prod_dupg} ({prod_duprows} rows)")
    print("Outputs in:", args.outdir)


def _run_self_tests():
    """python3 scripts/naming/normalize_cultivera.py --selftest"""
    ok = []

    def chk(name, cond, detail=None):
        ok.append((name, cond, detail))

    # size normalization
    chk("1.00 Grams -> 1g", normalize_size("1.00 Grams") == "1g", normalize_size("1.00 Grams"))
    chk("3.50 Grams -> 3.5g", normalize_size("3.50 Grams") == "3.5g", normalize_size("3.50 Grams"))
    chk("2.00 FluidOunce -> 2floz", normalize_size("2.00 FluidOunce") == "2floz", normalize_size("2.00 FluidOunce"))
    chk("1.00 Each -> ''", normalize_size("1.00 Each") == "", normalize_size("1.00 Each"))

    # ratio + trace guard
    chk("balanced 10/10 -> 1:1", cannabinoid_tag({"thc": 10, "cbd": 10}) == "1:1", cannabinoid_tag({"thc": 10, "cbd": 10}))
    chk("2:1", cannabinoid_tag({"thc": 20, "cbd": 10}) == "2:1", cannabinoid_tag({"thc": 20, "cbd": 10}))
    chk("trace cbd -> no tag", cannabinoid_tag({"thc": 92, "cbd": 1.7}) == "", cannabinoid_tag({"thc": 92, "cbd": 1.7}))
    chk("thc only -> no tag", cannabinoid_tag({"thc": 80}) == "", cannabinoid_tag({"thc": 80}))
    chk("3-compound letters", cannabinoid_tag({"thc": 10, "cbd": 10, "cbn": 5}) == "THC:CBD:CBN", cannabinoid_tag({"thc": 10, "cbd": 10, "cbn": 5}))

    # name build + owner rules
    chk("drop brand==vendor",
        build_name("Grow Op Farms", "Grow Op Farms", "Trainwreck", "", "Cartridge", "1g")
        == "Grow Op Farms Trainwreck Cartridge 1g",
        build_name("Grow Op Farms", "Grow Op Farms", "Trainwreck", "", "Cartridge", "1g"))
    chk("keep distinct brand",
        build_name("Grow Op Farms", "Phat Panda", "Slurricane", "", "Cartridge", "3g")
        == "Grow Op Farms Phat Panda Slurricane Cartridge 3g",
        build_name("Grow Op Farms", "Phat Panda", "Slurricane", "", "Cartridge", "3g"))

    # cleaning
    chk("leading dash + prefix cleaned",
        preclean_raw_name("Indica - 3pk Hawaiian Zkittlez Snickle Fritz") == "3pk Hawaiian Zkittlez Snickle Fritz",
        preclean_raw_name("Indica - 3pk Hawaiian Zkittlez Snickle Fritz"))
    chk("no comma survives", "," not in build_name("V", "B", "Sour, Diesel", "", "Flower", "3.5g"))

    # uniqueness termination on a max-length base
    long_base = "X" * 74
    taken = {long_base.lower()}
    u = make_unique(long_base, taken, "1g")
    chk("unique on long base fits <=75 and differs", len(u) <= NAME_MAX_LEN and u.lower() != long_base.lower(), u)

    fails = [t for t in ok if not t[1]]
    for name, cond, detail in ok:
        print(f"{'PASS' if cond else 'FAIL'} {name}" + ("" if cond else f"  -> {detail!r}"))
    if fails:
        raise SystemExit(f"{len(fails)} self-test(s) failed")
    print(f"\nAll {len(ok)} self-tests passed.")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        _run_self_tests()
    else:
        main()
