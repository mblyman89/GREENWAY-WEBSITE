#!/usr/bin/env python3
"""
SLICE D2 - Wax Wednesday is TWO tiers, not a three-rung ladder.

Owner, verbatim:
  "I apologize about Wednesday, the deal is 20% off or 30% off over 150 dollars.
   Not the ladder nor 20% to 25%."

The storefront ALREADY advertises exactly that. src/components/specials/
SpecialsContent.tsx says:

  "All concentrates and vapes are 20% off."
  "Get 30% off when you buy $150 or more before tax."

The code did something else - a 15/20/30 ladder at $50/$100/$150 - so the
advertised rate was under-delivered across the entire bottom of the range.
Measured against the live cart before this change:

    spend      code paid   advertised
    $10.00        0.00%          20%     <- 20 points short
    $49.99        0.00%          20%     <- 20 points short
    $50.00       15.00%          20%     <-  5 points short
    $99.99       15.00%          20%     <-  5 points short
    $100.00      20.00%          20%         ok
    $150.00      30.00%          30%         ok

A customer buying a single $40 cartridge was promised 20% off and charged full
price. This slice makes the code match the sign in the window.

WHAT IS DELIBERATELY *NOT* CHANGED
----------------------------------
DEFAULT_SPEND_TIERS stays as it is. It is the GENERIC fallback for any
threshold_spend promotion staff create in /admin/promotions, not Wednesday's
definition. Rewriting it would silently re-price unrelated promotions. Wednesday
gets EXPLICIT tiers instead, carried on the seed row, exactly as Tuesday's
qtyTiers now are - one source of truth, read by seedConfigFor().
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SEED = os.path.join(REPO, "src/lib/promotions/daily-deal-seed.ts")
PUBLISHED = os.path.join(REPO, "src/lib/promotions/published-rules-core.ts")
CART = os.path.join(REPO, "src/lib/specials/cart-discount.ts")

EDITS = []

# ------------------------------------------------------------ seed type
EDITS.append((
    SEED,
    """  /** Quantity tiers for multi_item_tier deals (SLICE D1). */
  qtyTiers?: { at: number; percent: number }[];""",
    """  /** Quantity tiers for multi_item_tier deals (SLICE D1). */
  qtyTiers?: { at: number; percent: number }[];
  /** Spend tiers (minor units -> percent) for threshold_spend deals (SLICE D2). */
  spendTiers?: { at: number; percent: number }[];""",
    "seed: type carries spendTiers",
))

# ------------------------------------------------------------ seed row
EDITS.append((
    SEED,
    '''    promoKey: "daily.wednesday",
    title: "Wax Wednesday",
    description: "Spend-tiered savings on concentrates and vapes \u2014 up to 30% off at $150+.",
    weekday: 3,
    discountType: "threshold_spend",
    discountPercent: 30,
    perItemSale: false,
    bonusNote: "up to 30% off",''',
    '''    promoKey: "daily.wednesday",
    title: "Wax Wednesday",
    description: "20% off concentrates and vapes \u2014 or 30% off when you spend $150 or more.",
    weekday: 3,
    discountType: "threshold_spend",
    discountPercent: 30,
    perItemSale: false,
    // SLICE D2: TWO tiers, matching what /specials advertises. The code
    // previously ran a 15/20/30 ladder at $50/$100/$150, so a customer buying a
    // single $40 cartridge was promised 20% off and charged full price.
    spendTiers: [
      { at: 0, percent: 20 },
      { at: 15000, percent: 30 },
    ],
    bonusNote: "20% off \u00b7 30% at $150+",''',
    "seed: Wednesday spend tiers",
))

# ------------------------------------------------------- seedConfigFor case
EDITS.append((
    PUBLISHED,
    '''    case "daily.saturday":
      return { basketTopItem: { topPercent: 30, restPercent: 15 } };''',
    '''    case "daily.wednesday": {
      // Wax Wednesday (SLICE D2): 20% off, 30% at $150+. DERIVED from the seed
      // row for the same reason Tuesday is - two hand-written copies of the
      // same numbers is how the register and the website drift apart.
      const tiers = DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.wednesday")?.spendTiers;
      return tiers?.length ? { spendTiers: tiers.map((t) => ({ ...t })) } : {};
    }
    case "daily.saturday":
      return { basketTopItem: { topPercent: 30, restPercent: 15 } };''',
    "published: Wednesday tiers derive from seed",
))

# ------------------------------------------------------------ website cart
EDITS.append((
    CART,
    '''/** Wax Wednesday spend tier (eligible regular spend, minor units) -> percent. */
function waxWednesdayPercentForSpend(spendMinorUnits: number): number {
  if (spendMinorUnits >= 15000) return 30; // $150+
  if (spendMinorUnits >= 10000) return 20; // $100+
  if (spendMinorUnits >= 5000) return 15; // $50+
  return 0;
}''',
    '''/**
 * Wax Wednesday spend tier (eligible regular spend, minor units) -> percent.
 *
 * SLICE D2: TWO tiers, matching the sign in the window. /specials advertises
 * "All concentrates and vapes are 20% off" and "Get 30% off when you buy $150
 * or more before tax", but this function ran a 15/20/30 ladder at $50/$100/$150
 * and returned ZERO below $50 - so a single $40 cartridge was advertised at 20%
 * off and rang up at full price.
 */
export function waxWednesdayPercentForSpend(spendMinorUnits: number): number {
  if (spendMinorUnits >= 15000) return 30; // $150+
  return spendMinorUnits > 0 ? 20 : 0; // every eligible basket gets 20%
}''',
    "cart: Wednesday two tiers",
))


def edit(text, old, new, label):
    if text.count(new) == 1:
        print(f"  {label}: already applied")
        return text
    assert text.count(old) == 1, f"{label}: found {text.count(old)} copies of OLD, expected 1"
    out = text.replace(old, new, 1)
    assert out != text, f"{label}: no-op"
    print(f"  {label}: applied")
    return out


def main():
    by_file = {}
    for path, old, new, label in EDITS:
        by_file.setdefault(path, []).append((old, new, label))

    for path, edits in by_file.items():
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
        original = text
        for old, new, label in edits:
            text = edit(text, old, new, label)
        if text != original:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
        with open(path, "r", encoding="utf-8") as f:
            assert f.read() == text, f"{path}: disk mismatch"

    with open(CART, "r", encoding="utf-8") as f:
        cart = f.read()
    assert "if (spendMinorUnits >= 10000) return 20; // $100+" not in cart, "the $100 rung survived"
    assert "if (spendMinorUnits >= 5000) return 15; // $50+" not in cart, "the $50 rung survived"
    assert cart.count("return spendMinorUnits > 0 ? 20 : 0;") == 1, "the 20% base tier is missing"

    with open(SEED, "r", encoding="utf-8") as f:
        seed = f.read()
    assert seed.count("{ at: 15000, percent: 30 },") == 1, "seed missing the $150 tier"
    assert seed.count("{ at: 0, percent: 20 },") == 1, "seed missing the 20% base tier"

    with open(PUBLISHED, "r", encoding="utf-8") as f:
        pub = f.read()
    assert pub.count('DAILY_DEAL_SEEDS.find((s) => s.promoKey === "daily.wednesday")?.spendTiers') == 1, (
        "seedConfigFor does not derive the Wednesday tiers from the seed"
    )

    # DEFAULT_SPEND_TIERS is the generic fallback and must be left alone.
    engine = os.path.join(REPO, "src/lib/promotions/discount-engine-core.ts")
    with open(engine, "r", encoding="utf-8") as f:
        eng = f.read()
    assert "{ at: 5000, percent: 15 }, // $50+" in eng, (
        "DEFAULT_SPEND_TIERS was modified - it is the GENERIC fallback for "
        "staff-created promotions, not Wednesday's definition"
    )
    print("Verified on disk.")


if __name__ == "__main__":
    main()
