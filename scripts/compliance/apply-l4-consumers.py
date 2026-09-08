#!/usr/bin/env python3
"""
SLICE L4 (consumers) — carry the L3 volume from the menu card to the engine.

The engine now measures millilitres, but nothing SUPPLIES them: limitLinesFor()
and cartLimitLines() only ever set `grams`. Without this, L4 silently keeps
using the weight-carried fallback for every liquid and the whole fix is inert.

Mirrors the AN-1 `unitGrams` pattern exactly: a per-UNIT figure rides on the
card/line, and the line total is computed by lineVolumeMl(perUnit, quantity).
"""
import sys

SF = "src/lib/pos/sale-flow-core.ts"
CM = "src/lib/menu/cart-limit-meter-core.ts"
RT = "src/app/api/pos/menu/route.ts"
OR = "src/app/api/orders/route.ts"
OT = "src/lib/orders/types.ts"
OP = "src/lib/orders/order-pricing.ts"
EDITS = []


def edit(path, old, new, label):
    EDITS.append((path, old, new, label))


# ── PricedSaleLine + the register's card type ────────────────────────────

edit(
    SF,
    """  unitGrams?: number | null;
  /**
   * SLICE 16 \u2014 the low-THC beverage classification, carried from the published
   * menu so the register's limit meter can route a qualifying drink out of the
   * 72 oz liquid bucket and into the 200 mg THC bucket""",
    """  unitGrams?: number | null;
  /**
   * SLICE L4 \u2014 millilitres ONE unit of this variant contains, from the
   * L3-plumbed net_volume_ml or (failing that) the variant label. This is the
   * figure the 72 FLUID ounce cap is enforced against; the unitGrams regex
   * above matches only g|oz, so before L4 a 1.5 L bottle had no measure at
   * all and 72 of them fit. Optional so bundles cached before L4 still parse:
   * absent = unknown, and the engine uses the weight-carried basis.
   */
  unitVolumeMl?: number | null;
  /**
   * SLICE 16 \u2014 the low-THC beverage classification, carried from the published
   * menu so the register's limit meter can route a qualifying drink out of the
   * 72 oz liquid bucket and into the 200 mg THC bucket""",
    "SaleFlow card type",
)

edit(
    SF,
    """      unitGrams: entry.product.unitGrams ?? null,
      // SLICE 16: the low-THC beverage classification travels with the line.""",
    """      unitGrams: entry.product.unitGrams ?? null,
      // SLICE L4: per-unit millilitres travel with the line so the register's
      // limit meter can measure a bottle by VOLUME instead of guessing 28 g.
      unitVolumeMl: entry.product.unitVolumeMl ?? null,
      // SLICE 16: the low-THC beverage classification travels with the line.""",
    "SaleFlow line assembly",
)

edit(
    SF,
    """    const grams = lineGramsFromUnit(l.unitGrams, l.quantity);
    return {
      category: l.category,
      quantity: l.quantity,
      ...(grams !== null ? { grams } : {}),""",
    """    const grams = lineGramsFromUnit(l.unitGrams, l.quantity);
    // SLICE L4 \u2014 the LINE's total millilitres. Only set when a real per-unit
    // volume is known; otherwise it is omitted entirely so lineMl() falls back
    // to the weight-carried basis rather than reading an absent volume as 0
    // (which would make the line free of the limit).
    const volumeMl = lineVolumeMl(l.unitVolumeMl, l.quantity);
    return {
      category: l.category,
      quantity: l.quantity,
      ...(grams !== null ? { grams } : {}),
      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),""",
    "limitLinesFor",
)

edit(
    SF,
    'import { lineGramsFromUnit } from "./variant-grams-core";',
    'import { lineGramsFromUnit } from "./variant-grams-core";\n'
    '// SLICE L4 \u2014 the volume basis (pure; no cycle).\n'
    'import { lineVolumeMl } from "@/lib/compliance/liquid-volume-core";',
    "sale-flow import",
)

# ── the website meter must mirror the register exactly ──────────────────
edit(
    CM,
    """    const perUnit = gramsFromVariantLabel(item.variantLabel);
    const grams = lineGramsFromUnit(perUnit, item.quantity);
    return {
      category: item.category,
      quantity: item.quantity,
      ...(grams !== null ? { grams } : {}),""",
    """    const perUnit = gramsFromVariantLabel(item.variantLabel);
    const grams = lineGramsFromUnit(perUnit, item.quantity);
    // SLICE L4 \u2014 the volume basis, mirroring the register's limitLinesFor()
    // so the website meter and the register can never disagree about the same
    // cart. Prefers the plumbed per-package volume (L3); falls back to parsing
    // the variant label, which is the only source the website has for a
    // product whose card predates the L3 intake plumbing.
    const perUnitMl = item.unitVolumeMl ?? volumeMlFromLabel(item.variantLabel);
    const volumeMl = lineVolumeMl(perUnitMl, item.quantity);
    return {
      category: item.category,
      quantity: item.quantity,
      ...(grams !== null ? { grams } : {}),
      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),""",
    "cartLimitLines",
)

edit(
    CM,
    'import { gramsFromVariantLabel, lineGramsFromUnit } from "@/lib/pos/variant-grams-core";',
    'import { gramsFromVariantLabel, lineGramsFromUnit } from "@/lib/pos/variant-grams-core";\n'
    'import { lineVolumeMl, volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";',
    "cart-limit-meter import",
)

# ── the register bundle must carry the figure ───────────────────────────
edit(
    RT,
    "        unitGrams: gramsFromVariantLabel(variant.label),",
    """        unitGrams: gramsFromVariantLabel(variant.label),
        // SLICE L4 \u2014 per-unit millilitres. Prefers the L3-plumbed
        // net_volume_ml (a real measured package volume); falls back to
        // parsing the variant label so a card staged before L3 still gets a
        // volume when its label states one. null = unknown, and the engine
        // then uses the weight-carried basis rather than assuming a size.
        unitVolumeMl: item.netVolumeMl ?? volumeMlFromLabel(variant.label),""",
    "menu route bundle",
)

edit(
    OR,
    "      unitGrams: l.unitGrams ?? null,",
    """      unitGrams: l.unitGrams ?? null,
      // SLICE L4 \u2014 the volume the server's hard gate measures against the
      // 72 FLUID ounce cap.
      unitVolumeMl: l.unitVolumeMl ?? null,""",
    "orders route",
)


def main():
    for path, old, new, label in EDITS:
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        n = src.count(old)
        if n == 0 and src.count(new) == 1:
            print(f"SKIP [{label}] already applied")
            continue
        if n != 1:
            print(f"ABORT [{label}] {path}: anchor found {n} times, expected 1")
            sys.exit(1)
        out = src.replace(old, new, 1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(out)
        with open(path, encoding="utf-8") as fh:
            if fh.read() != out:
                print(f"ABORT [{label}] {path}: write did not stick")
                sys.exit(1)
        print(f"OK   [{label}]")
    print(f"\n{len(EDITS)}/{len(EDITS)} applied.")


if __name__ == "__main__":
    main()
