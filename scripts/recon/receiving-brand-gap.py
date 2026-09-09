#!/usr/bin/env python3
"""
scripts/recon/receiving-brand-gap.py

MEASURE, don't guess: does the RECEIVING INTAKE brand resolver agree with the
promotions brand matcher (src/lib/promotions/brand-match-core.ts)?

Receiving intake resolves a manifest brand label to a brands.id via
`resolveBrandId` (src/lib/inventory/intake-store.ts:371):

    .ilike("display_name", label)

Postgres ILIKE with no wildcards is an EXACT match that ignores case only. It
does NOT ignore whitespace runs, punctuation, or hyphens. brandKey() does.

This script reads the real brand display names out of the back-office database
and reports, for every brand, which realistic manifest spellings resolve under
ILIKE and which resolve only under brandKey. No network, no assumptions.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
DB = os.path.join(ROOT, "back-office", "GREENWAY WEBSITE", "database", "vendors")


def brand_key(value):
    """Mirror of brandKey() in src/lib/promotions/brand-match-core.ts."""
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def ilike_exact(a, b):
    """Mirror of Postgres ILIKE with no wildcard metacharacters."""
    if a is None or b is None:
        return False
    return a.lower() == b.lower()


def collect_brands():
    names = []
    if not os.path.isdir(DB):
        print("FATAL: brand database not found at %s" % DB)
        sys.exit(2)
    for vendor in sorted(os.listdir(DB)):
        bdir = os.path.join(DB, vendor, "brands")
        if not os.path.isdir(bdir):
            continue
        for slug in sorted(os.listdir(bdir)):
            path = os.path.join(bdir, slug, "brand.json")
            if not os.path.isfile(path):
                continue
            with open(path, encoding="utf-8") as fh:
                try:
                    doc = json.load(fh)
                except Exception as exc:
                    print("  ! unreadable %s: %s" % (path, exc))
                    continue
            nm = doc.get("display_name") or doc.get("displayName") or doc.get("name")
            if isinstance(nm, str) and nm.strip():
                names.append((vendor, slug, nm.strip()))
    return names


def variants(name):
    """Manifest spellings a vendor realistically sends for the same brand.

    Every one of these is the SAME brand to a human being. These are the exact
    classes of drift the T1 measurement found in the live catalogue: doubled
    interior spaces, case flips, and hyphen/space swaps.
    """
    out = {}
    out["double space"] = re.sub(r" ", "  ", name, count=1) if " " in name else None
    out["upper case"] = name.upper()
    out["lower case"] = name.lower()
    out["hyphenated"] = name.replace(" ", "-") if " " in name else None
    out["trailing space"] = name + " "
    out["no space"] = name.replace(" ", "") if " " in name else None
    return {k: v for k, v in out.items() if v and v != name}


def main():
    brands = collect_brands()
    print("brands read from back-office database: %d" % len(brands))
    if not brands:
        sys.exit(2)

    # brandKey collision check on the real set: does squeezing merge two
    # DIFFERENT companies? T1 proved it does not; re-prove it here.
    by_key = {}
    for vendor, slug, name in brands:
        by_key.setdefault(brand_key(name), []).append((vendor, name))
    merges = {k: v for k, v in by_key.items() if len({n for _, n in v}) > 1}
    print("distinct display names        : %d" % len({n for _, _, n in brands}))
    print("distinct brandKey values      : %d" % len(by_key))
    print("brandKey merges (>1 spelling) : %d" % len(merges))
    for k, v in sorted(merges.items()):
        vendors = {vend for vend, _ in v}
        spellings = sorted({n for _, n in v})
        flag = "SAME vendor" if len(vendors) == 1 else "!! DIFFERENT vendors"
        print("   %-22s %-11s %s" % (k, flag, spellings))

    # The real question: variant resolution under each matcher.
    tot = ilike_hits = key_hits = 0
    examples = []
    for vendor, slug, name in brands:
        for label, variant in sorted(variants(name).items()):
            tot += 1
            i_ok = ilike_exact(variant, name)
            k_ok = brand_key(variant) == brand_key(name) and brand_key(name) != ""
            if i_ok:
                ilike_hits += 1
            if k_ok:
                key_hits += 1
            if k_ok and not i_ok and len(examples) < 12:
                examples.append((name, label, variant))

    print()
    print("=== variant resolution over %d realistic manifest spellings ===" % tot)
    print("resolved by ILIKE  (receiving intake today) : %d  (%.1f%%)"
          % (ilike_hits, 100.0 * ilike_hits / tot))
    print("resolved by brandKey (promotions matcher)   : %d  (%.1f%%)"
          % (key_hits, 100.0 * key_hits / tot))
    print("MISSED by receiving, caught by brandKey     : %d" % (key_hits - ilike_hits))
    print()
    print("examples of spellings receiving intake would NOT resolve")
    print("(brand_id lands NULL -> lot is unbranded -> invisible to brand deals):")
    for name, label, variant in examples:
        print("   %-28s %-14s %r" % (name, label, variant))


if __name__ == "__main__":
    main()
