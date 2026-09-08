#!/usr/bin/env python3
"""
SLICE D1 (Tuesday + website cart) - make Doobie Tuesday a real quantity tier
and bring the website cart's own copy of the arithmetic into line.

Owner's ruling, verbatim:
  "the tiers are, 1-3 prerolls are 20%, 4+ are 25% off. this should apply to
   any preroll including infused, blunts and packs."
  "if a discount specifically states 4 or more prerolls is 25% off, then its
   25% off, whether the store wants to win or not."

"Buy 4 for the price of 3" IS 25% off on identical items, so the tier does not
withdraw the advertised bundle - it delivers it at every quantity above 4
instead of only at exact multiples of four.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SEED = os.path.join(REPO, "src/lib/promotions/daily-deal-seed.ts")
PUBLISHED = os.path.join(REPO, "src/lib/promotions/published-rules-core.ts")
CART = os.path.join(REPO, "src/lib/specials/cart-discount.ts")

EDITS = []

# ---------------------------------------------------------------- seed config
EDITS.append((
    SEED,
    '''    weekday: 2,
    discountType: "multi_item_tier",
    discountPercent: 20,
    perItemSale: false,
    bonusNote: "20% off \u00b7 or 4 for 3",''',
    '''    weekday: 2,
    discountType: "multi_item_tier",
    discountPercent: 20,
    perItemSale: false,
    // SLICE D1: 1-3 prerolls 20%, 4+ 25%. "Buy 4 for the price of 3" IS 25%
    // off on identical items, so the tier DELIVERS the advertised bundle at
    // every quantity from 4 up, instead of only at exact multiples of four.
    qtyTiers: [
      { at: 1, percent: 20 },
      { at: 4, percent: 25 },
    ],
    bonusNote: "20% off \u00b7 or 4 for 3 (25%)",''',
    "seed: Tuesday qty tiers",
))

# --------------------------------------------------------- seed type carries it
EDITS.append((
    SEED,
    """  discountType: DiscountType;
  discountPercent: number;""",
    """  discountType: DiscountType;
  discountPercent: number;
  /** Quantity tiers for multi_item_tier deals (SLICE D1). */
  qtyTiers?: { at: number; percent: number }[];""",
    "seed: type carries qtyTiers",
))

# ------------------------------------------------------- DB-empty fallback
EDITS.append((
    PUBLISHED,
    '''    case "daily.tuesday":
      // Doobie Tuesday: 20% off OR 4-for-3 mix & match, store-advantaged.
      return { eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } } };''',
    '''    case "daily.tuesday":
      // Doobie Tuesday (SLICE D1): 1-3 prerolls 20%, 4+ 25%. This replaces an
      // eitherOr config that resolved to whichever option saved the customer
      // LESS, which made the advertised 4-for-3 unreachable and dropped a
      // 6-preroll cart to 16%.
      return {
        qtyTiers: [
          { at: 1, percent: 20 },
          { at: 4, percent: 25 },
        ],
      };''',
    "published: Tuesday fallback tiers",
))

# --------------------------------------------- website cart: Tuesday rewrite
OLD_TUE = '''      // Option A \u2014 flat 20% (applies from qty 1).
      const flatPercent = 20;
      let flatSavings = 0;
      for (const line of eligible) {
        const d = applyPercentLine(line, flatPercent, "Doobie Tuesday");
        flatSavings += d.unitSavingsMinorUnits * line.quantity;
      }

      // Option B \u2014 4-for-3 mix & match spread (needs 4+ eligible units).
      const units: number[] = [];
      let eligibleTotal = 0;
      for (const line of eligible) {
        eligibleTotal += line.regularPriceMinorUnits * line.quantity;
        for (let i = 0; i < line.quantity; i += 1) units.push(line.regularPriceMinorUnits);
      }
      units.sort((a, b) => a - b);
      const groups = Math.floor(units.length / 4);
      let bundleTarget = 0;
      for (let i = 0; i < groups; i += 1) bundleTarget += units[i];
      const bundlePercent =
        groups > 0 && eligibleTotal > 0
          ? Math.min(99, Math.floor((bundleTarget / eligibleTotal) * 100))
          : 0;
      let bundleSavings = 0;
      if (bundlePercent > 0) {
        for (const line of eligible) {
          const d = applyPercentLine(line, bundlePercent, "Doobie Tuesday");
          bundleSavings += d.unitSavingsMinorUnits * line.quantity;
        }
      }

      // Store-advantaged pick: the SMALLER positive savings wins; a
      // zero-savings option never beats a positive one.
      let percent = 0;
      let bundleChosen = false;
      if (flatSavings > 0 && (bundleSavings <= 0 || flatSavings <= bundleSavings)) {
        percent = flatPercent;
      } else if (bundleSavings > 0) {
        percent = bundlePercent;
        bundleChosen = true;
      }
      if (percent <= 0) break;'''

NEW_TUE = '''      // SLICE D1: a real quantity tier -- 1-3 prerolls 20%, 4+ 25%. The
      // previous code computed a flat 20% AND a floored 4-for-3 spread and
      // kept whichever saved the customer LESS, so the advertised bundle was
      // discarded at every quantity where it helped and chosen only at 6 and
      // 7, where it dragged the basket down to 16% and 14%. The owner's
      // ruling: "if a discount specifically states 4 or more prerolls is 25%
      // off, then its 25% off, whether the store wants to win or not."
      const totalEligibleUnits = eligible.reduce((sum, line) => sum + line.quantity, 0);
      const percent = totalEligibleUnits >= 4 ? 25 : 20;
      const bundleChosen = totalEligibleUnits >= 4;
      if (percent <= 0) break;'''

EDITS.append((CART, OLD_TUE, NEW_TUE, "cart: Tuesday is a tier"))

# ------------------------------- website cart: the header comment lied too
# The block comment above the case still documented the store-advantaged pick
# and the floored percent. Stale documentation next to corrected code is how a
# fixed bug gets re-introduced, so it is part of the change, not a follow-up.
EDITS.append((
    CART,
    '''      // Doobie Tuesday (Task R, owner-specified): 20% off prerolls & blunts OR
      // buy 4 for the price of 3 mix & match \u2014 WHICHEVER SAVES THE CUSTOMER
      // LESS when both qualify (store-advantaged; deterministic and identical
      // for every customer, so it stays "available to all who meet the
      // discount conditions" per the CCRS guide).
      //
      // The 4-for-3 option is COMPLIANT like Sunday: the cheapest unit per
      // full group of 4 sets the savings target, converted to an equivalent
      // whole-number percent (floor) SPREAD across all eligible lines so no
      // unit is ever free or below cost.''',
    '''      // Doobie Tuesday (SLICE D1, owner-specified): a QUANTITY TIER, not an
      // either/or. 1-3 eligible prerolls get 20% off; 4 or more get 25% off.
      // Applies to any preroll including infused, blunts and packs.
      //
      // "Buy 4 for the price of 3" IS 25% off, so the tier does not withdraw
      // the advertised bundle - it honours it at EVERY quantity from 4 up
      // rather than only at exact multiples of four. The owner's ruling:
      // "if a discount specifically states 4 or more prerolls is 25% off,
      //  then its 25% off, whether the store wants to win or not."
      //
      // The store-wins policy is a ROUNDING rule (half-cent to the store), not
      // a deal-selection rule. It must never be used to pick the cheaper of
      // two advertised offers.
      //
      // Still deterministic and identical for every customer, so it remains
      // "available to all who meet the discount conditions" per the CCRS
      // guide, and applyPercentLine still clamps each unit to its cost floor.''',
    "cart: Tuesday header comment",
))


def edit(text, old, new, label):
    # Idempotency is decided by NEW alone. Testing `count(old) == 0` as well is
    # WRONG whenever NEW contains OLD as a substring (an append-style edit): OLD
    # still appears inside the applied NEW, so the guard misfires and the run
    # aborts on an already-correct file. NEW present exactly once IS the proof.
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
        if text == original:
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        with open(path, "r", encoding="utf-8") as f:
            assert f.read() == text, f"{path}: disk mismatch"

    # Verify the old arithmetic is gone from the cart path.
    with open(CART, "r", encoding="utf-8") as f:
        cart = f.read()
    assert "Math.floor((bundleTarget / eligibleTotal) * 100)" not in cart, (
        "the floored 4-for-3 spread is still in cart-discount.ts"
    )
    assert "flatSavings <= bundleSavings" not in cart, "the store-advantaged pick is still present"
    assert "WHICHEVER SAVES THE CUSTOMER" not in cart, "the stale header comment survived"
    # Positive proof the tier actually landed, not just that the old code left.
    assert cart.count("const percent = totalEligibleUnits >= 4 ? 25 : 20;") == 1, (
        "the quantity tier is not in cart-discount.ts"
    )

    with open(SEED, "r", encoding="utf-8") as f:
        seed = f.read()
    assert seed.count("qtyTiers?: { at: number; percent: number }[];") == 1, "seed type missing qtyTiers"
    assert seed.count("{ at: 4, percent: 25 },") == 1, "seed missing the 4+ = 25% tier"

    with open(PUBLISHED, "r", encoding="utf-8") as f:
        published = f.read()
    assert "eitherOr: { flatPercent: 20, bundle: { n: 4, m: 3 } }" not in published, (
        "the Tuesday eitherOr fallback is still present"
    )
    assert published.count("{ at: 4, percent: 25 },") >= 1, "published fallback missing the 4+ tier"
    print("Verified on disk.")


if __name__ == "__main__":
    main()
