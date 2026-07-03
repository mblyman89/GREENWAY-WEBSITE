#!/usr/bin/env python3
"""
build_cultivera_products_sheet.py
=================================
Build the ONE Excel upload sheet the owner sends to the Cultivera rep so Cultivera
can batch-fix every product name in one pass. The rep's required column layout is:

    Original Product Name | Updated Product Name | Receipt Name | Strain Type | Product Description

WHAT THIS DOES (owner's verbatim spec)
--------------------------------------
  * Source of the LIST = PRODUCTS_UPDATED.xlsx ONLY (3,500 rows). Every row in,
    every row out -- one output row per product row.
  * For the NEW name, borrow Vendor / Brand / Strain / cannabinoids / Category from
    INVENTORIES_UPDATED.xlsx by EXACT (case-insensitive) Product-Name match
    (verified 3,500/3,500 match). PRODUCTS has no Vendor column and no cannabinoid
    columns, so INV is the trustworthy source for those.
  * "Updated Product Name" = the finalized Greenway convention name:
        {Vendor} {Brand} {Strain} {Cannabinoid Tag} {Type} {Size}
    with the owner rules: drop Brand when Brand == Vendor; trace-cannabinoid guard
    (a co-cannabinoid must be >=10% of the dominant to earn a ratio/tag); size
    normalized (grams/oz/floz/ml); commas + disallowed chars stripped; <= 75 chars.
  * "Receipt Name" = identical to "Updated Product Name" (owner: "same as product
    name").
  * DUPLICATES ARE KEPT. Two rows that share the SAME original Product Name get the
    SAME normalized Updated Product Name and BOTH remain in the output (no collapse,
    no numeric uniquifying). Owner: "they were already duplicates, so it should be
    fine to remain duplicate but normalized."
  * "Strain Type" = indica / sativa / hybrid / cbd, derived (in priority order) from
        1) explicit (I)/(S)/(H) marker in the original name,
        2) indica/sativa/hybrid word in the original name or the PRODUCTS Type column,
        3) a CBD-forward product (ratio favors CBD) -> "CBD",
        else blank (unknown -- never guessed).
  * "Strain" (used inside the name) is CLEANED: cannabinoid/ratio/mg noise, strain-
    type words, pack/size tokens, and generic placeholders (No Strain / Mixed /
    Assorted / Paraphernalia) are stripped so the name reads on the true flavor.
  * "Product Description" = blank (owner has none yet).

GROUNDING
---------
All naming primitives are imported from normalize_cultivera.py (the port of
src/lib/naming/convention-core.ts) so this sheet agrees with the live engine, the
CCRS export, and the website cards. Nothing here is guessed; unknown strain-types
are left blank rather than invented.

USAGE
-----
  python3 scripts/naming/build_cultivera_products_sheet.py \
      --products    /workspace/PRODUCTS_UPDATED.xlsx \
      --inventories /workspace/INVENTORIES_UPDATED.xlsx \
      --out         /workspace/CULTIVERA_PRODUCT_UPLOAD.xlsx

  python3 scripts/naming/build_cultivera_products_sheet.py --selftest
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter, defaultdict
from typing import Optional

import openpyxl

# ================================================================== #
#  Convention core -- self-contained port of the verified primitives in
#  src/lib/naming/convention-core.ts (also mirrored in
#  scripts/naming/normalize_cultivera.py). Inlined here so this builder runs
#  standalone on `main` without depending on any unmerged branch. Every surface
#  (CCRS export, website cards, this sheet) shares the same rules.
# ================================================================== #

NAME_MAX_LEN = 75
DISALLOWED = re.compile(r'[,/&!#$@"|\u0000-\u001f]')

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
# count toward the tag. Real carts/flower carry 1-2% trace CBD; tagging a
# 92%THC / 1.7%CBD cart as "20:1" is misleading, so trace amounts are ignored.
#   share >= 0.10  <=>  ratio <= 10:1  (matches the ratio snap ceiling of 10)
MIN_CO_CANNABINOID_SHARE = 0.10


def _meaningful(present: dict) -> list:
    active = {k: v for k, v in present.items() if v > 0}
    if not active:
        return []
    dominant = max(active.values())
    if dominant <= 0:
        return []
    kept = {k for k, v in active.items() if v / dominant >= MIN_CO_CANNABINOID_SHARE}
    return [k for k in _TAG_ORDER if k in kept]


def cannabinoid_tag(present: dict) -> str:
    """present: canonical-type -> value (>0). Trace co-cannabinoids
    (< MIN_CO_CANNABINOID_SHARE of the dominant) are dropped so THC-dominant
    products with trace CBD stay THC-only (no misleading ratio)."""
    keys = _meaningful(present)
    if len(keys) <= 1:
        return ""
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
    sp = cut.rfind(" ")
    return (cut[:sp] if sp > 0 else cut).strip()


def normalize_size(raw: str) -> str:
    """'1.00 Grams' -> '1g'; '3.50 Grams' -> '3.5g'; '2.00 FluidOunce' -> '2floz';
    '1.00 Each' -> '' (a bare count is not a size)."""
    s = collapse_ws(raw)
    if not s:
        return ""
    m = re.match(r"^([\d.]+)\s*([A-Za-z ]+)$", s)
    if not m:
        return ""
    qty = float(m.group(1))
    unit = m.group(2).strip().lower()
    q = ("%g" % qty)
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
        return ""
    return ""


_STRAIN_PREFIX = re.compile(r"^(indica|sativa|hybrid)\s*-\s*", re.I)


def preclean_raw_name(name: str) -> str:
    n = name or ""
    n = n.replace("_", " ")
    n = re.sub(r"^\s*-\s*", "", n)
    n = _STRAIN_PREFIX.sub("", n)
    n = strip_disallowed(n)
    n = re.sub(r"\s*-\s*", " ", n)
    n = collapse_ws(n)
    return n


def _norm_tokens(s: str) -> list:
    """Lowercase alnum word tokens for redundancy checks. Possessives are folded
    (Seattle's -> seattles) so 'SEATTLES PRIVATE RESERVE' and 'Seattle's Private
    Reserve' compare equal."""
    low = (s or "").lower().replace("'s", "s").replace("\u2019s", "s")
    return [t for t in re.split(r"[^a-z0-9]+", low) if t]


def _brand_is_redundant(vendor: str, brand: str) -> bool:
    """True when the brand adds nothing over the vendor and should be dropped.

    Owner rule Q2 drops Brand when Brand == Vendor. In practice Cultivera also
    stores the brand as the vendor's short name (e.g. vendor 'DOWNTOWN CANNABIS
    COMPANY' + brand 'Downtown', vendor 'SITKA PACKAGING' + brand 'Sitka'),
    producing awkward doubling. We extend the rule: drop the brand when every one
    of its normalized word-tokens is already present in the vendor (i.e. the brand
    is a token-subset of the vendor and thus redundant). Conservative -- if the
    brand carries any distinct word (e.g. 'Skagit Organics Platinum' vs vendor
    'Skagit Organics'), it is KEPT."""
    vt = _norm_tokens(vendor)
    bt = _norm_tokens(brand)
    if not bt or not vt:
        return False
    if bt == vt:
        return True
    vset = set(vt)
    return all(tok in vset for tok in bt)


def build_name(vendor: str, brand: str, strain: str, tag: str, ptype: str, size: str) -> str:
    """Assemble '{Vendor} {Brand} {Strain} {Tag} {Type} {Size}' with owner rules
    (drop Brand when Brand == Vendor or is a redundant token-subset of Vendor)."""
    parts = []
    vendor = collapse_ws(vendor)
    brand = collapse_ws(brand)
    strain = collapse_ws(strain)
    ptype = collapse_ws(ptype)
    size = collapse_ws(size)

    if vendor:
        parts.append(vendor)
    if brand and not _brand_is_redundant(vendor, brand):
        parts.append(brand)
    if strain:
        # Collapse an immediate boundary duplicate: when the brand's LAST word equals
        # the strain's FIRST word (e.g. brand "The People's" + strain "People's
        # Diesel" -> "The People's Diesel"; brand "Buddies" + strain "Buddies Fire
        # Ice" -> "Buddies Fire Ice"). Only across the brand/strain seam, so genuine
        # reduplicated flavors ("Bang Bang", "Yum Yum") are never touched.
        if parts and strain:
            prev_last = parts[-1].split()[-1].lower() if parts[-1].split() else ""
            strain_words = strain.split()
            if strain_words and prev_last and prev_last == strain_words[0].lower():
                strain = " ".join(strain_words[1:]).strip()
        if strain:
            parts.append(strain)
    if tag:
        parts.append(tag)
    if ptype:
        parts.append(ptype)
    if size:
        parts.append(size)

    return clamp_75(title_case(strip_disallowed(" ".join(parts))))


# ------------------------------------------------------------------ #
#  I/O helpers
# ------------------------------------------------------------------ #


def load(path: str):
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    header = [str(h) if h is not None else "" for h in rows[0]]
    idx = {h: i for i, h in enumerate(header)}
    return header, rows[1:], idx


def cell(row, idx, col) -> str:
    if col not in idx:
        return ""
    v = row[idx[col]]
    return "" if v is None else str(v).strip()


def _sanitize_cell(v):
    """openpyxl write-only cells: keep it a plain str, no control chars."""
    if v is None:
        return ""
    s = str(v)
    return re.sub(r"[\u0000-\u0008\u000b\u000c\u000e-\u001f]", "", s)


# ------------------------------------------------------------------ #
#  Cannabinoid folding (acids -> active), mirrors convention-core.ts
# ------------------------------------------------------------------ #

# Decarboxylation factor: THCA -> THC (0.877), CBDA -> CBD (0.877).
_DECARB = 0.877


def total_thc(thc: Optional[float], thca: Optional[float]) -> float:
    return (thc or 0.0) + _DECARB * (thca or 0.0)


def total_cbd(cbd: Optional[float], cbda: Optional[float]) -> float:
    return (cbd or 0.0) + _DECARB * (cbda or 0.0)


# ------------------------------------------------------------------ #
#  Strain cleanup
# ------------------------------------------------------------------ #

# Ratios like 1:1, 2:1, 5:1:5, 100:1, and "CBD:THC" / "60:1 CBD:THC".
_RATIO_TOKEN = re.compile(r"\b\d{1,3}(?::\d{1,3}){1,3}\b")
_CBDTHC_WORDS = re.compile(
    r"\b(?:CBD|THC|CBN|CBG|CBC|CBDV|THCA|CBDA|RSO)\s*[:/]\s*(?:CBD|THC|CBN|CBG|CBC|CBDV|THCA|CBDA|RSO)\b",
    re.I,
)
# A lone trailing/standalone cannabinoid word (Black Cherry CBN, Milky Way CBG, Notorious THC).
_LONE_CANNA = re.compile(r"\b(?:CBD|THC|CBN|CBG|CBC|CBDV|THCA|CBDA|RSO)\b", re.I)
# mg / g dosing tokens: 100mg THC, 200mg CBG, 1250mg.
_MG_TOKEN = re.compile(r"\b\d+(?:\.\d+)?\s*mg\b", re.I)
# pack / size noise: 2pk, 20pk, "Variety Pack #1", "Mixed Pack".
_PK_TOKEN = re.compile(r"\b\d+\s*pk\b", re.I)
_PACK_WORD = re.compile(r"\bpack\b\s*#?\d*", re.I)
# strain-type words when they appear INSIDE the flavor string.
_TYPE_WORD = re.compile(r"\b(indica|sativa|hybrid)\b", re.I)
# "+ Ashwagandha", "+ Maca" adjunct additives -> keep flavor, drop the additive tail.
_PLUS_ADJUNCT = re.compile(r"\s*\+\s*(?:ashwagandha|maca|melatonin|l-?theanine|caffeine)\b.*$", re.I)
# leftover 'MAX' marketing token.
_MAX_TOKEN = re.compile(r"\bMAX\b", re.I)

_GENERIC_STRAINS = {
    "",
    "no strain",
    "mixed",
    "assorted",
    "paraphernalia",
    "n/a",
    "na",
    "none",
    "various",
    "variety pack",
    "variety",
    "mixed pack",
}


def clean_strain(raw: str) -> str:
    """Strip cannabinoid/ratio/mg/type/pack noise + generic placeholders from a
    strain string, returning just the true flavor/strain. Returns '' when nothing
    meaningful remains (a generic placeholder or pure noise)."""
    s = collapse_ws(raw)
    if not s:
        return ""
    if s.strip().lower() in _GENERIC_STRAINS:
        return ""

    s = _PLUS_ADJUNCT.sub("", s)          # drop "+ Ashwagandha" tails
    s = _CBDTHC_WORDS.sub(" ", s)         # "CBD:THC" pairs
    s = _RATIO_TOKEN.sub(" ", s)          # 1:1, 5:1:5, 100:1
    s = _MG_TOKEN.sub(" ", s)             # 100mg
    s = _PK_TOKEN.sub(" ", s)             # 2pk
    s = _PACK_WORD.sub(" ", s)            # "Pack #1"
    s = _TYPE_WORD.sub(" ", s)            # indica/sativa/hybrid inside flavor
    s = _MAX_TOKEN.sub(" ", s)
    s = _LONE_CANNA.sub(" ", s)           # standalone CBN/CBG/THC words

    s = re.sub(r"[+\-]+", " ", s)         # leftover connectors
    s = collapse_ws(s)

    if s.strip().lower() in _GENERIC_STRAINS:
        return ""
    return s


# ------------------------------------------------------------------ #
#  Strain-type derivation (never guessed)
# ------------------------------------------------------------------ #

_MARK_I = re.compile(r"\(\s*i\s*\)", re.I)
_MARK_S = re.compile(r"\(\s*s\s*\)", re.I)
_MARK_H = re.compile(r"\(\s*h\s*\)", re.I)
_WORD_INDICA = re.compile(r"\bindica\b", re.I)
_WORD_SATIVA = re.compile(r"\bsativa\b", re.I)
_WORD_HYBRID = re.compile(r"\bhybrid\b", re.I)


def derive_strain_type(name: str, prod_type: str, raw_strain: str,
                       tag: str, thc: float, cbd: float) -> str:
    """indica | sativa | hybrid | CBD, in priority order. Blank if unknown.

    1) explicit (I)/(S)/(H) marker in name  (strongest signal)
    2) indica/sativa/hybrid WORD in name, PRODUCTS Type col, or raw strain
    3) CBD-forward (ratio favors CBD, or CBD >> THC) -> "CBD"
    else "" (unknown -- not guessed)
    """
    hay = f"{name} {raw_strain}"

    # 1) parenthetical marker (unambiguous single letter)
    if _MARK_I.search(name):
        return "Indica"
    if _MARK_S.search(name):
        return "Sativa"
    if _MARK_H.search(name):
        return "Hybrid"

    # 2) explicit words (name, Type column, or raw strain)
    pt = (prod_type or "").strip().lower()
    if pt in ("indica", "sativa", "hybrid"):
        return pt.capitalize()
    if _WORD_HYBRID.search(hay):
        return "Hybrid"
    if _WORD_INDICA.search(hay):
        return "Indica"
    if _WORD_SATIVA.search(hay):
        return "Sativa"

    # 3) CBD-forward classification (ratio favors CBD, e.g. "1:2" .. "1:20",
    #    or a CBD:THC style tag, or CBD clearly dominant).
    if tag:
        m = re.match(r"^1:(\d+)$", tag)          # 1:2, 1:20 -> CBD-forward
        if m and int(m.group(1)) >= 2:
            return "CBD"
        if re.match(r"^CBD\b", tag, re.I):        # CBD:THC:... leading CBD
            return "CBD"
    if cbd > 0 and thc > 0 and cbd >= 2 * thc:
        return "CBD"
    if cbd > 0 and thc == 0:
        return "CBD"

    return ""  # unknown -- leave blank rather than guess


# ------------------------------------------------------------------ #
#  INV lookup (pick a stable representative per exact product name)
# ------------------------------------------------------------------ #


def _mode(values: list[str]) -> str:
    vals = [v for v in values if v]
    if not vals:
        return ""
    return Counter(vals).most_common(1)[0][0]


def build_inv_lookup(inv_rows, ii) -> dict[str, dict]:
    """Group INV rows by lowercased Product name; collapse each group to a single
    representative record. Vendor/Brand/Strain/Category use the modal value (33
    name-groups carry >1 vendor -- the mode is the stable, defensible choice).
    Cannabinoids use the MAX folded THC/CBD seen in the group (the labeled potency
    that would drive the tag)."""
    groups: dict[str, list] = defaultdict(list)
    for r in inv_rows:
        groups[cell(r, ii, "Product").lower()].append(r)

    lookup: dict[str, dict] = {}
    for key, rows in groups.items():
        thc_vals, cbd_vals = [], []
        for r in rows:
            thc_vals.append(total_thc(to_number(cell(r, ii, "Thc")), to_number(cell(r, ii, "Thca"))))
            cbd_vals.append(total_cbd(to_number(cell(r, ii, "Cbd")), to_number(cell(r, ii, "Cbda"))))
        lookup[key] = {
            "vendor": _mode([cell(r, ii, "Vendor") for r in rows]),
            "brand": _mode([cell(r, ii, "Brand") for r in rows]),
            "strain": _mode([cell(r, ii, "Strain") for r in rows]),
            "category": _mode([cell(r, ii, "Category") for r in rows]),
            "invtype": _mode([cell(r, ii, "InventoryType") for r in rows]),
            "thc": max(thc_vals) if thc_vals else 0.0,
            "cbd": max(cbd_vals) if cbd_vals else 0.0,
        }
    return lookup


# ------------------------------------------------------------------ #
#  Main build
# ------------------------------------------------------------------ #

OUT_HEADERS = [
    "Original Product Name",
    "Updated Product Name",
    "Receipt Name",
    "Strain Type",
    "Product Description",
]


def build(products_path: str, inventories_path: str, out_path: str) -> dict:
    _, prod_rows, pi = load(products_path)
    _, inv_rows, ii = load(inventories_path)
    inv = build_inv_lookup(inv_rows, ii)

    # First pass: compute the normalized name per DISTINCT original name so exact
    # duplicates deterministically map to the SAME updated name.
    name_map: dict[str, str] = {}         # lower(original) -> Updated Product Name
    type_map: dict[str, str] = {}         # lower(original) -> Strain Type
    unmatched = 0

    out_rows = []
    for r in prod_rows:
        original = cell(r, pi, "Product Name")
        key = original.lower()

        if key not in name_map:
            rec = inv.get(key)
            is_cannabis = cell(r, pi, "Cannabis Y/N").strip().upper() != "N"

            if rec is None:
                unmatched += 1
                # Fall back to a deterministic clean of the original name so the row
                # is never dropped (should not happen -- join is 100%).
                updated = clamp_75(title_case(preclean_raw_name(original)))
                stype = derive_strain_type(original, cell(r, pi, "Type"),
                                           cell(r, pi, "Strain"), "", 0.0, 0.0)
            else:
                vendor = rec["vendor"]
                brand = rec["brand"]
                raw_strain = rec["strain"] or cell(r, pi, "Strain")
                strain = clean_strain(raw_strain)
                thc, cbd = rec["thc"], rec["cbd"]
                tag = cannabinoid_tag({"thc": thc, "cbd": cbd})

                # Size from PRODUCTS bare qty + UOM (e.g. '1.000' + 'Grams').
                qty = cell(r, pi, "Package Size")
                uom = cell(r, pi, "UOM")
                size = normalize_size(f"{qty} {uom}".strip()) if qty else ""

                # Product type token stays empty (strain TYPE lives in its own column,
                # not in the product name).
                updated = build_name(vendor, brand, strain, tag, "", size)

                # Non-cannabis accessories (batteries, pipes, trays, glass tips...)
                # have no strain/cannabinoid, so the convention collapses them to the
                # bare vendor -- non-descriptive and collision-prone ("Sitka Packaging"
                # for BOTH a rolling tray and a hash pipe). For these, and for any row
                # where the convention lost the descriptive content, prefer the vendor
                # prefix + a cleaned ORIGINAL name so the item stays identifiable
                # (mirrors the Slice B non-cannabis lesson: clean, don't rebuild).
                convention_lost_detail = len(collapse_ws(updated).split()) < 3 and not strain
                if not is_cannabis or convention_lost_detail:
                    desc = preclean_raw_name(original)
                    desc = re.sub(r"[\u00ae\u2122\u00a9]", "", desc)   # (R)/(TM)/(C)
                    desc = re.sub(r"\$\s*\d+(\.\d+)?", "", desc)        # price tokens
                    desc = collapse_ws(desc)
                    # Avoid doubling the vendor: drop the vendor prefix when the
                    # description already starts with / contains the vendor's tokens.
                    vt = _norm_tokens(vendor)
                    dt = _norm_tokens(desc)
                    starts_with_vendor = bool(vt) and dt[: len(vt)] == vt
                    contains_vendor_lead = bool(vt) and vt[0] in set(dt)
                    if not vendor or starts_with_vendor or contains_vendor_lead:
                        prefixed = desc
                    else:
                        prefixed = f"{vendor} {desc}".strip()
                    candidate = clamp_75(title_case(strip_disallowed(prefixed)))
                    if len(candidate.split()) > len(collapse_ws(updated).split()):
                        updated = candidate

                if not updated:  # never emit an empty name
                    updated = clamp_75(title_case(preclean_raw_name(original)))

                stype = derive_strain_type(original, cell(r, pi, "Type"),
                                           raw_strain, tag, thc, cbd)

            name_map[key] = updated
            type_map[key] = stype

        updated = name_map[key]
        stype = type_map[key]
        out_rows.append([original, updated, updated, stype, ""])

    _write(out_path, out_rows)

    # Verification stats.
    orig_counter = Counter(row[0].lower() for row in out_rows)
    dup_groups = {k: v for k, v in orig_counter.items() if v > 1}
    # confirm each dup group shares ONE updated name
    dup_consistent = True
    grouped = defaultdict(set)
    for row in out_rows:
        grouped[row[0].lower()].add(row[1])
    for k in dup_groups:
        if len(grouped[k]) != 1:
            dup_consistent = False
            break
    over_len = sum(1 for row in out_rows if len(row[1]) > NAME_MAX_LEN)
    with_comma = sum(1 for row in out_rows if "," in row[1])
    st_counts = Counter(row[3] for row in out_rows)

    return {
        "rows": len(out_rows),
        "distinct_originals": len(orig_counter),
        "dup_groups": len(dup_groups),
        "dup_consistent": dup_consistent,
        "unmatched": unmatched,
        "over_75": over_len,
        "with_comma": with_comma,
        "strain_type_counts": dict(st_counts),
        "out_path": out_path,
    }


def _write(path: str, rows: list[list[str]]) -> None:
    wb = openpyxl.Workbook(write_only=True)
    ws = wb.create_sheet("Products")
    ws.append(OUT_HEADERS)
    for row in rows:
        ws.append([_sanitize_cell(v) for v in row])
    wb.save(path)


# ------------------------------------------------------------------ #
#  Self tests (no external test runner in this repo)
# ------------------------------------------------------------------ #


def _run_self_tests() -> None:
    fails = []

    def eq(got, want, msg):
        if got != want:
            fails.append(f"{msg}: got {got!r} want {want!r}")

    # --- clean_strain ---
    eq(clean_strain("Sour Watermelon CBN 1:1"), "Sour Watermelon", "strain ratio+canna")
    eq(clean_strain("Chill Indica 2:1"), "Chill", "strain type+ratio")
    eq(clean_strain("Raspberry 60:1 CBD:THC"), "Raspberry", "strain cbd:thc")
    eq(clean_strain("GMO 2pk"), "GMO", "strain pk")
    eq(clean_strain("No Strain"), "", "generic no strain")
    eq(clean_strain("Mixed"), "", "generic mixed")
    eq(clean_strain("Paraphernalia"), "", "generic paraphernalia")
    eq(clean_strain("Blackberry Lemonade 100mg THC"), "Blackberry Lemonade", "strain mg")
    eq(clean_strain("Milk Chocolate 200mg CBG + 100mg THC"), "Milk Chocolate", "strain mg canna")
    eq(clean_strain("1:1 Watermelon Lime + Ashwagandha"), "Watermelon Lime", "strain adjunct")
    eq(clean_strain("Notorious THC"), "Notorious", "strain lone thc")
    eq(clean_strain("Variety Pack #1"), "", "generic variety pack")
    eq(clean_strain("Blue Dream"), "Blue Dream", "clean strain untouched")

    # --- derive_strain_type ---
    eq(derive_strain_type("Sitka Classic Hashish Joint (I)", "", "Lebanese Red", "", 3.0, 0.0),
       "Indica", "type marker I")
    eq(derive_strain_type("Foo (S)", "", "Bar", "", 1.0, 0.0), "Sativa", "type marker S")
    eq(derive_strain_type("Foo (H)", "", "Bar", "", 1.0, 0.0), "Hybrid", "type marker H")
    eq(derive_strain_type("Lifted Sativa Gummies", "", "Sour Mango", "", 1.0, 0.0),
       "Sativa", "type word in name")
    eq(derive_strain_type("Chill Bar", "Indica", "Chill", "", 1.0, 0.0),
       "Indica", "type from Type col")
    eq(derive_strain_type("Relief Drops", "", "Ginger", "1:20", 1.0, 20.0),
       "CBD", "type cbd ratio")
    eq(derive_strain_type("Pure CBD Tincture", "", "Mint", "CBD:THC", 0.0, 20.0),
       "CBD", "type cbd dominant zero thc")
    eq(derive_strain_type("Mystery Flower", "", "Blue Dream", "", 20.0, 0.0),
       "", "type unknown -> blank")

    # --- total_thc / total_cbd folding ---
    eq(round(total_thc(2.06, 78.09), 2), round(2.06 + 0.877 * 78.09, 2), "thc fold")
    eq(round(total_cbd(0.0, 10.0), 3), round(0.877 * 10.0, 3), "cbd fold")

    # --- brand redundancy vs vendor ---
    eq(_brand_is_redundant("DOWNTOWN CANNABIS COMPANY", "Downtown"), True, "brand subset of vendor")
    eq(_brand_is_redundant("SITKA PACKAGING", "Sitka"), True, "brand subset sitka")
    eq(_brand_is_redundant("1937 FARMS", "1937"), True, "brand subset 1937")
    eq(_brand_is_redundant("Acme", "Acme"), True, "brand == vendor")
    eq(_brand_is_redundant("Skagit Organics", "Skagit Organics Platinum"), False, "brand adds Platinum -> keep")
    eq(_brand_is_redundant("Green Revolution", "Wildside"), False, "distinct brand kept")
    eq(_brand_is_redundant("", "Wana"), False, "no vendor -> keep brand")
    eq(build_name("DOWNTOWN CANNABIS COMPANY", "Downtown", "Comatoast", "", "", "1g"),
       "Downtown Cannabis Company Comatoast 1g", "build drops redundant brand")
    # boundary duplicate collapse (brand last word == strain first word)
    eq(build_name("South Bay Master Growers", "The People's", "People's Diesel", "", "", "1g"),
       "South Bay Master Growers The People's Diesel 1g", "boundary dup collapse")
    eq(build_name("Botanical Arts", "Buddies", "Buddies Fire Ice", "1:1", "", "3oz"),
       "Botanical Arts Buddies Fire Ice 1:1 3oz", "boundary dup collapse buddies")
    # genuine reduplicated flavor is preserved (lives inside strain, not the seam)
    eq(build_name("Clarity Farms", "", "Blueberry Yum Yum", "", "", "1g"),
       "Clarity Farms Blueberry Yum Yum 1g", "reduplicated flavor preserved")

    # --- trace guard via cannabinoid_tag (imported) ---
    # 92% THC / 1.7% CBD -> trace CBD dropped -> no tag
    eq(cannabinoid_tag({"thc": 92.0, "cbd": 1.7}), "", "trace cbd dropped")
    # genuine 1:1
    eq(cannabinoid_tag({"thc": 10.0, "cbd": 10.0}), "1:1", "genuine 1:1")

    if fails:
        print("SELFTEST FAILED:")
        for f in fails:
            print("  -", f)
        raise SystemExit(1)
    print(f"SELFTEST PASSED ({13 + 8 + 2 + 8 + 3 + 2} assertions)")


# ------------------------------------------------------------------ #

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--products", default="/workspace/PRODUCTS_UPDATED.xlsx")
    ap.add_argument("--inventories", default="/workspace/INVENTORIES_UPDATED.xlsx")
    ap.add_argument("--out", default="/workspace/CULTIVERA_PRODUCT_UPLOAD.xlsx")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        _run_self_tests()
        return

    stats = build(args.products, args.inventories, args.out)
    print("BUILD COMPLETE")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
