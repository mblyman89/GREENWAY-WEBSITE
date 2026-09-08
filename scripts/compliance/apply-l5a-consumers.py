#!/usr/bin/env python3
"""
L5a step 2 — route every per-unit volume decision through resolveUnitVolumeMl,
and plumb the measured volume into the CUSTOMER-FACING cart.

Five edits, each asserted to match exactly once and read back off disk:

  1. src/app/api/pos/menu/route.ts       — register bundle: precedence fix
  2. src/lib/orders/order-pricing.ts     — online order pricing: precedence fix
  3. src/lib/menu/cart-limit-meter-core.ts — website meter: precedence fix
  4. src/components/cart/CartProvider.tsx  — CartItemInput gains unitVolumeMl
  5. src/components/menu/ProductDetailPurchasePanel.tsx — pass netVolumeMl in

Idempotent: every edit SKIPs when already applied.
"""
import io
import sys

EDITS = [
    # ---- 1. register bundle ------------------------------------------------
    (
        "src/app/api/pos/menu/route.ts",
        "unitVolumeMl: item.netVolumeMl ?? volumeMlFromLabel(variant.label),",
        "unitVolumeMl: resolveUnitVolumeMl(variant.label, item.netVolumeMl),",
        "resolveUnitVolumeMl(variant.label, item.netVolumeMl)",
    ),
    (
        "src/app/api/pos/menu/route.ts",
        'import { volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";',
        'import { resolveUnitVolumeMl } from "@/lib/compliance/liquid-volume-core";',
        'import { resolveUnitVolumeMl } from "@/lib/compliance/liquid-volume-core";',
    ),
    # ---- 2. online order pricing ------------------------------------------
    (
        "src/lib/orders/order-pricing.ts",
        "unitVolumeMl: w.resolved.item.netVolumeMl ?? volumeMlFromLabel(w.resolved.variant.label),",
        "unitVolumeMl: resolveUnitVolumeMl(w.resolved.variant.label, w.resolved.item.netVolumeMl),",
        "resolveUnitVolumeMl(w.resolved.variant.label, w.resolved.item.netVolumeMl)",
    ),
    (
        "src/lib/orders/order-pricing.ts",
        'import { lineVolumeMl, volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";',
        'import { lineVolumeMl, resolveUnitVolumeMl } from "@/lib/compliance/liquid-volume-core";',
        'import { lineVolumeMl, resolveUnitVolumeMl } from "@/lib/compliance/liquid-volume-core";',
    ),
    # ---- 3. website cart meter --------------------------------------------
    (
        "src/lib/menu/cart-limit-meter-core.ts",
        "    const perUnitMl = item.unitVolumeMl ?? volumeMlFromLabel(item.variantLabel);",
        "    const perUnitMl = resolveUnitVolumeMl(item.variantLabel, item.unitVolumeMl);",
        "resolveUnitVolumeMl(item.variantLabel, item.unitVolumeMl)",
    ),
    (
        "src/lib/menu/cart-limit-meter-core.ts",
        'import { lineVolumeMl, volumeMlFromLabel } from "@/lib/compliance/liquid-volume-core";',
        'import { lineVolumeMl, resolveUnitVolumeMl } from "@/lib/compliance/liquid-volume-core";',
        'import { lineVolumeMl, resolveUnitVolumeMl } from "@/lib/compliance/liquid-volume-core";',
    ),
    # ---- 4. the customer cart's item shape --------------------------------
    (
        "src/components/cart/CartProvider.tsx",
        """  /** SLICE 16 — mg of active delta-9 THC in one sellable unit (one can). */
  unitThcMg?: number | null;
};""",
        """  /** SLICE 16 — mg of active delta-9 THC in one sellable unit (one can). */
  unitThcMg?: number | null;
  /**
   * SLICE L5a — the MEASURED millilitres in one package, carried from intake
   * (net_volume_ml) so the storefront meter can enforce the 72 FLUID ounce
   * (2129.292 ml) liquid cap on a product whose LABEL states no volume.
   *
   * Without this the website's only volume source was the variant label, and
   * transform.ts maps the package label "each" to the EMPTY STRING while
   * mg/pack labels ("100mg", "4pk") carry no volume either. Measured before
   * the fix: 72 unlabelled liquids read as exactly at the cap and were NOT
   * blocked online, while the register blocked the same product at 3 and the
   * server refused the order — the shopper was misled, then refused.
   *
   * The variant label still WINS when it states a volume (see
   * resolveUnitVolumeMl); this is the fallback for when it cannot.
   * null = unknown, never zero.
   */
  unitVolumeMl?: number | null;
};""",
        "SLICE L5a — the MEASURED millilitres in one package",
    ),
    # ---- 5. the only cannabis add-to-cart call site ------------------------
    (
        "src/components/menu/ProductDetailPurchasePanel.tsx",
        """            otherwiseTaken: item.otherwiseTaken ?? null,
            unitsPerPackage: item.unitsPerPackage ?? null,""",
        """            otherwiseTaken: item.otherwiseTaken ?? null,
            unitsPerPackage: item.unitsPerPackage ?? null,
            // SLICE L5a — the measured package volume, so the cart drawer and
            // checkout blocks apply the 2129.292 ml liquid cap to bottles
            // whose variant label states no size (transform.ts renders the
            // "each" package label as ""). The register already had this; the
            // website did not, so it showed 72 bottles as legal.
            unitVolumeMl: item.netVolumeMl ?? null,""",
        "unitVolumeMl: item.netVolumeMl ?? null,",
    ),
]


def main() -> int:
    for path, old, new, marker in EDITS:
        src = io.open(path, encoding="utf-8").read()
        if marker in src:
            print(f"SKIP  {path}: already applied ({marker[:48]}...)")
            continue
        count = src.count(old)
        assert count == 1, f"{path}: anchor matched {count} times, expected 1\n---\n{old}\n---"
        io.open(path, "w", encoding="utf-8").write(src.replace(old, new, 1))
        back = io.open(path, encoding="utf-8").read()
        assert marker in back, f"{path}: edit did NOT land on disk"
        # NOTE: `old` may legitimately survive as a PREFIX of `new` (the
        # append-style edits keep the anchor and add lines after it). The
        # honest invariant is that the anchor is no longer UNACCOMPANIED --
        # i.e. the new text is present exactly once and the old text does not
        # appear anywhere the new text does not cover.
        assert back.count(new) == 1, f"{path}: new text present {back.count(new)}x, expected 1"
        if old not in new:
            assert old not in back, f"{path}: old text still present on disk"
        print(f"OK    {path}: applied and verified on disk")
    print("\nAll L5a consumer edits verified on disk.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
