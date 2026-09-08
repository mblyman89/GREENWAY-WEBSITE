#!/usr/bin/env python3
"""
apply-l4-consumers-2.py — Slice L4, second consumer pass.

Closes the three type holes the first consumer pass opened, by mirroring the
AN-1 `unitGrams` plumbing EXACTLY (same field shape, same null semantics, same
placement) so the volume basis travels the identical road the weight basis
already travels:

  1. src/lib/orders/order-pricing.ts   — PricedOrderLine.unitVolumeMl, its
     population from the resolved menu item, and its hand-off into the
     LimitCartLine the server-authoritative gate evaluates.
  2. src/lib/menu/cart-limit-meter-core.ts — CartLimitLineInput.unitVolumeMl.
  3. src/app/api/pos/menu/route.ts     — the volumeMlFromLabel import.

Every edit asserts EXACTLY ONE anchor match and reads the file back off disk,
because silent no-op string replacement has bitten this workstream before.
Idempotent: an already-applied edit is reported SKIP, never a failure.
"""

import sys

EDITS = [
    # ---------------------------------------------------------------- 1 ---
    (
        "src/lib/orders/order-pricing.ts",
        "PricedOrderLine.unitVolumeMl",
        """  /** AN-1 — grams one unit weighs (from the variant label; null = unknown). */
  unitGrams?: number | null;
};""",
        """  /** AN-1 — grams one unit weighs (from the variant label; null = unknown). */
  unitGrams?: number | null;
  /**
   * SLICE L4 — millilitres ONE unit contains. The liquid bucket is metered in
   * millilitres against 72 FLUID ounces (RCW/WAC liquid maximum), so a real
   * measured package volume must reach the server gate the same way unitGrams
   * does. null = unknown, and the engine falls back to the weight-carried
   * basis rather than assuming a size.
   */
  unitVolumeMl?: number | null;
};""",
    ),
    (
        "src/lib/orders/order-pricing.ts",
        "order-pricing volume imports",
        """import {
  gramsFromVariantLabel,
  lineGramsFromUnit,
  normalizeUnitGrams,
} from "@/lib/pos/variant-grams-core";""",
        """import {
  gramsFromVariantLabel,
  lineGramsFromUnit,
  normalizeUnitGrams,
} from "@/lib/pos/variant-grams-core";
// SLICE L4 — pure per-variant millilitre helpers (label → ml; per-unit → line).
import { lineVolumeMl, volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";""",
    ),
    (
        "src/lib/orders/order-pricing.ts",
        "order-pricing unitVolumeMl population",
        """      // AN-1: true per-unit weight from the resolved variant's label.
      unitGrams: gramsFromVariantLabel(w.resolved.variant.label),""",
        """      // AN-1: true per-unit weight from the resolved variant's label.
      unitGrams: gramsFromVariantLabel(w.resolved.variant.label),
      // SLICE L4: true per-unit VOLUME. Prefers the L3-plumbed net_volume_ml
      // (a measured package volume carried from intake); falls back to the
      // variant label for a card staged before that plumbing existed.
      unitVolumeMl: w.resolved.item.netVolumeMl ?? volumeMlFromLabel(w.resolved.variant.label),""",
    ),
    (
        "src/lib/orders/order-pricing.ts",
        "order-pricing limitLines volumeMl",
        """    const grams = lineGramsFromUnit(l.unitGrams, l.quantity);
    return {
      category: l.category,
      quantity: l.quantity,
      ...(grams !== null ? { grams } : {}),""",
        """    const grams = lineGramsFromUnit(l.unitGrams, l.quantity);
    // SLICE L4: and the true whole-line millilitres, which is what the liquid
    // bucket actually meters. Omitted when unknown so the engine keeps its
    // weight-carried fallback instead of reading a zero as "no volume sold".
    const volumeMl = lineVolumeMl(l.unitVolumeMl ?? null, l.quantity);
    return {
      category: l.category,
      quantity: l.quantity,
      ...(grams !== null ? { grams } : {}),
      ...(volumeMl !== null && volumeMl > 0 ? { volumeMl } : {}),""",
    ),
    # ---------------------------------------------------------------- 2 ---
    (
        "src/lib/menu/cart-limit-meter-core.ts",
        "CartLimitLineInput.unitVolumeMl",
        """  category: string | null;
  quantity: number;
  variantLabel: string | null;
  /**
   * SLICE 16 — the low-THC beverage classification""",
        """  category: string | null;
  quantity: number;
  variantLabel: string | null;
  /**
   * SLICE L4 — millilitres ONE unit contains, plumbed from intake's measured
   * net_volume_ml. Optional: absent/null makes the meter parse the variant
   * label instead, and if that yields nothing the engine uses the
   * weight-carried basis. No density is ever assumed.
   */
  unitVolumeMl?: number | null;
  /**
   * SLICE 16 — the low-THC beverage classification""",
    ),
    # ---------------------------------------------------------------- 3 ---
    (
        "src/app/api/pos/menu/route.ts",
        "pos/menu volumeMlFromLabel import",
        """import { gramsFromVariantLabel } from "@/lib/pos/variant-grams-core";""",
        """import { gramsFromVariantLabel } from "@/lib/pos/variant-grams-core";
// SLICE L4 — label → millilitres, the fallback when a card predates the L3
// intake volume plumbing.
import { volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";""",
    ),
]


def main() -> int:
    applied = 0
    skipped = 0
    for path, label, old, new in EDITS:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
        if new in src:
            print(f"SKIP    {label} (already applied)")
            skipped += 1
            continue
        count = src.count(old)
        if count != 1:
            print(f"FAIL    {label}: anchor matched {count} times in {path}")
            return 1
        src = src.replace(old, new, 1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(src)
        with open(path, "r", encoding="utf-8") as fh:
            back = fh.read()
        if new not in back:
            print(f"FAIL    {label}: disk read-back did not contain the edit")
            return 1
        print(f"APPLIED {label}")
        applied += 1
    print(f"\n{applied} applied, {skipped} skipped, {len(EDITS)} total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
