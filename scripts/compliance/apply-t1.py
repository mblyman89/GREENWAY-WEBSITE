#!/usr/bin/env python3
"""SLICE T1 apply harness.

Rewires the FIVE hand-rolled brand matchers onto brand-match-core. Every edit
asserts the anchor appears EXACTLY once, then re-reads the file from disk to
confirm the change landed. Idempotent: an edit already applied is skipped by
`text.count(new) == 1` ALONE (never by a heuristic).
"""
import sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]

EDITS = [
    # ---------------------------------------------------------------- engine
    (
        "src/lib/promotions/discount-engine-core.ts",
        [
            (
                'import {\n  apportionBundleSavings,\n  bundleTargetMinorUnits,\n} from "@/lib/promotions/bundle-apportionment-core";',
                'import {\n  apportionBundleSavings,\n  bundleTargetMinorUnits,\n} from "@/lib/promotions/bundle-apportionment-core";\n'
                '// SLICE T1: the ONE brand matcher. This module used to carry its own\n'
                '// trim+lowercase copy (hasCi below), one of FIVE in the codebase.\n'
                'import { brandInList } from "@/lib/promotions/brand-match-core";',
            ),
            (
                'function hasCi(list: string[], value: string | null | undefined): boolean {\n'
                '  if (!value) return false;\n'
                '  const v = value.trim().toLowerCase();\n'
                '  return list.some((x) => x.trim().toLowerCase() === v);\n'
                '}',
                '/**\n'
                ' * Case-insensitive membership for CATEGORY and PRODUCT-KEY tokens.\n'
                ' *\n'
                ' * SLICE T1: BRANDS no longer come through here -- they go to brandInList,\n'
                ' * which normalises punctuation and spacing as well as case. Categories and\n'
                ' * product keys keep the strict trim+lowercase rule on purpose: a product key\n'
                ' * is an opaque identifier where punctuation is MEANINGFUL, and folding it\n'
                ' * away could let one SKU collect another SKU\'s discount.\n'
                ' */\n'
                'function hasCi(list: string[], value: string | null | undefined): boolean {\n'
                '  if (!value) return false;\n'
                '  const v = value.trim().toLowerCase();\n'
                '  return list.some((x) => x.trim().toLowerCase() === v);\n'
                '}',
            ),
            (
                '  if (hasCi(rule.excludeBrands, line.brand)) return false;',
                '  if (brandInList(rule.excludeBrands, line.brand)) return false;',
            ),
            (
                '  const brandMatch = hasCi(rule.targetBrands, line.brand);',
                '  const brandMatch = brandInList(rule.targetBrands, line.brand);',
            ),
        ],
    ),
    # -------------------------------------------------------------- checkout
    (
        "src/lib/specials/cart-discount.ts",
        [
            (
                '      // Top Shelf Thursday: flat 25% off featured brands (per-item).\n'
                '      const brands = topShelfThursdayBrands.map((b) => b.trim().toLowerCase());\n'
                '      for (const line of cartLines) {\n'
                '        if (isMerchOrAccessory(line)) continue;\n'
                '        if (line.brand && brands.includes(line.brand.trim().toLowerCase())) {\n'
                '          resultMap.set(line.lineId, applyPercentLine(line, 25, "Top Shelf Thursday"));\n'
                '        }\n'
                '      }',
                '      // Top Shelf Thursday: flat 25% off featured brands (per-item).\n'
                '      // SLICE T1: brand comparison delegated to brand-match-core so the\n'
                '      // REGISTER and the product card can never disagree about who is on\n'
                '      // sale. This branch previously carried its own trim+lowercase copy.\n'
                '      for (const line of cartLines) {\n'
                '        if (isMerchOrAccessory(line)) continue;\n'
                '        if (brandInList(topShelfThursdayBrands, line.brand)) {\n'
                '          resultMap.set(line.lineId, applyPercentLine(line, 25, "Top Shelf Thursday"));\n'
                '        }\n'
                '      }',
            ),
        ],
    ),
    # ----------------------------------------------------------- menu cards
    (
        "src/lib/specials/daily-deals.ts",
        [
            (
                'function itemMatchesBrands(item: GreenwayMenuItem, brands: string[]) {\n'
                '  if (!item.brand) return false;\n'
                '  const itemBrand = item.brand.trim().toLowerCase();\n'
                '  return brands.some((brand) => brand.trim().toLowerCase() === itemBrand);\n'
                '}',
                '// SLICE T1: the shop card asks the SAME question the register asks, using\n'
                '// the same matcher. When these were two copies, a brand spelled slightly\n'
                '// differently could show a "25% off" badge and then ring up at full price.\n'
                'function itemMatchesBrands(item: GreenwayMenuItem, brands: string[]) {\n'
                '  return brandInList(brands, item.brand);\n'
                '}',
            ),
        ],
    ),
    # ---------------------------------------------------------- publish guard
    (
        "src/lib/promotions/promo-guard.ts",
        [
            (
                '    if (r.scope === "brand")\n'
                '      return r.value ? p.brand.trim().toLowerCase() === r.value.trim().toLowerCase() : false;',
                '    // SLICE T1: same matcher as the engine, so the below-cost publish guard\n'
                '    // previews exactly the products the engine will actually discount.\n'
                '    if (r.scope === "brand") return brandMatches(p.brand, r.value);',
            ),
        ],
    ),
    # ---------------------------------------------------------- admin preview
    (
        "src/lib/promotions/promotions-store.ts",
        [
            (
                '    if (r.scope === "brand")\n'
                '      return r.value ? item.brand.trim().toLowerCase() === r.value.trim().toLowerCase() : false;',
                '    // SLICE T1: same matcher as the engine, so "products affected" in the\n'
                '    // admin preview equals what the register will really discount.\n'
                '    if (r.scope === "brand") return brandMatches(item.brand, r.value);',
            ),
        ],
    ),
]

# Imports, each anchored on a VERIFIED unique existing line in that file (read
# from disk first -- no generic "last import" guessing, which would misplace the
# statement inside a multi-line import block).
IMPORTS = [
    (
        "src/lib/specials/cart-discount.ts",
        'import type { StoreWeekday } from "@/lib/specials/daily-deals";',
        'import { brandInList } from "@/lib/promotions/brand-match-core";',
    ),
    (
        "src/lib/specials/daily-deals.ts",
        'import { TOP_SHELF_THURSDAY_BRANDS } from "@/lib/promotions/daily-deal-seed";',
        'import { brandInList } from "@/lib/promotions/brand-match-core";',
    ),
    (
        "src/lib/promotions/promo-guard.ts",
        'import { isSupabaseServiceConfigured } from "@/lib/supabase/env";',
        'import { brandMatches } from "@/lib/promotions/brand-match-core";',
    ),
    (
        "src/lib/promotions/promotions-store.ts",
        'import { getEnrichmentsForKeys, mediaUrlsForIds } from "@/lib/enrichment/store";',
        'import { brandMatches } from "@/lib/promotions/brand-match-core";',
    ),
]

changed = 0
skipped = 0


def apply(rel, old, new):
    global changed, skipped
    p = ROOT / rel
    text = p.read_text()
    if text.count(new) == 1:
        skipped += 1
        print(f"  SKIP (already applied) {rel}")
        return
    n = text.count(old)
    assert n == 1, f"{rel}: anchor found {n} times, expected exactly 1\n---\n{old[:300]}"
    p.write_text(text.replace(old, new, 1))
    back = p.read_text()
    assert back.count(new) == 1, f"{rel}: read-back failed"
    assert old not in back or old in new, f"{rel}: old text still present"
    changed += 1
    print(f"  OK {rel}")


def add_import(rel, anchor, stmt):
    """Insert `stmt` immediately after a VERIFIED-unique existing import line."""
    global changed, skipped
    p = ROOT / rel
    text = p.read_text()
    if text.count(stmt) == 1:
        skipped += 1
        print(f"  SKIP (import present) {rel}")
        return
    assert text.count(stmt) == 0, f"{rel}: import appears {text.count(stmt)} times"
    n = text.count(anchor)
    assert n == 1, f"{rel}: import anchor found {n} times, expected 1: {anchor}"
    p.write_text(text.replace(anchor, anchor + "\n" + stmt, 1))
    back = p.read_text()
    assert back.count(stmt) == 1, f"{rel}: import read-back failed"
    assert back.count(anchor) == 1, f"{rel}: anchor damaged"
    changed += 1
    print(f"  OK import -> {rel}")


print("SLICE T1: rewiring five brand matchers onto brand-match-core")
for rel, pairs in EDITS:
    for old, new in pairs:
        apply(rel, old, new)
for rel, anchor, stmt in IMPORTS:
    add_import(rel, anchor, stmt)

print(f"\nchanged={changed} skipped={skipped}")
if changed == 0 and skipped == 0:
    print("NOTHING HAPPENED", file=sys.stderr)
    sys.exit(1)
