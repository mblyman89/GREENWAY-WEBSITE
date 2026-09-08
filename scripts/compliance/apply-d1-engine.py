#!/usr/bin/env python3
"""
SLICE D1 (engine) - replace the floored whole-percent bundle spread with
exact-cent apportionment, and make Doobie Tuesday a real quantity tier.

Three edits to src/lib/promotions/discount-engine-core.ts:
  1. import the pure core,
  2. rewrite bundleSpreadDiscounts to apportion whole cents per unit,
  3. remove the eitherOr "smaller savings wins" interception so the declared
     multi_item_tier mechanic is what runs.
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET = os.path.join(REPO, "src/lib/promotions/discount-engine-core.ts")

# ---------------------------------------------------------------- 1. import
OLD_IMPORT = 'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";'
NEW_IMPORT = '''import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";
import {
  apportionBundleSavings,
  bundleTargetMinorUnits,
} from "@/lib/promotions/bundle-apportionment-core";'''

# ------------------------------------------------- 2. bundleSpreadDiscounts
OLD_BUNDLE = '''  const out = new Map<string, LineDiscount>();
  const freePerGroup = Math.max(0, Math.floor(n) - Math.floor(m));
  if (n < 2 || freePerGroup <= 0) return out;
  const units: number[] = [];
  let eligibleTotal = 0;
  for (const l of eligible) {
    eligibleTotal += l.regularPriceMinorUnits * l.quantity;
    for (let i = 0; i < l.quantity; i += 1) units.push(l.regularPriceMinorUnits);
  }
  units.sort((a, b) => a - b);
  const groups = Math.floor(units.length / Math.floor(n));
  if (groups <= 0 || eligibleTotal <= 0) return out;
  let targetSavings = 0;
  for (let i = 0; i < groups * freePerGroup; i += 1) targetSavings += units[i];
  // Equivalent basket-wide percent, floored (store-advantaged), capped at 99.
  const percent = Math.min(99, Math.floor((targetSavings / eligibleTotal) * 100));
  if (percent <= 0) return out;
  for (const l of eligible) {
    const d = flatPercentDiscount(l, percent, label);
    out.set(l.lineId, { ...d, label: `${label} · ${Math.floor(n)} for ${Math.floor(m)} (${percent}% spread)` });
  }
  return out;
}'''

NEW_BUNDLE = '''  const out = new Map<string, LineDiscount>();

  // SLICE D1: the savings target is apportioned in WHOLE CENTS, not converted
  // into a floored whole-number percent. Flooring a percent threw away up to
  // 0.999% of the basket -- on the owner's $60/$40/$20 Sunday cart that was
  // $19.20 paid against a $20.00 advertised 3-for-2, an 80c shortfall in the
  // customer's disfavour. See bundle-apportionment-core.ts for the measurements.
  const apportionLines = eligible.map((l) => ({
    lineId: l.lineId,
    regularPriceMinorUnits: l.regularPriceMinorUnits,
    quantity: l.quantity,
    // The floor is resolved HERE, by the code that knows the product's cost
    // and category, and it is absolute: no apportionment may breach it.
    floorMinorUnits: clampEngineUnit(l, 0),
  }));

  const target = bundleTargetMinorUnits(apportionLines, n, m);
  if (target <= 0) return out;

  const result = apportionBundleSavings(apportionLines, target);
  if (result.placedMinorUnits <= 0) return out;

  for (const l of eligible) {
    const off = result.perUnitOff.get(l.lineId) ?? 0;
    if (off <= 0) continue;
    const unit = clampEngineUnit(l, l.regularPriceMinorUnits - off);
    const pct =
      l.regularPriceMinorUnits > 0
        ? round(((l.regularPriceMinorUnits - unit) / l.regularPriceMinorUnits) * 100)
        : 0;
    out.set(l.lineId, {
      unitPrice: unit,
      percent: pct,
      label: `${label} · ${Math.floor(n)} for ${Math.floor(m)}`,
    });
  }
  return out;
}'''

# --------------------------------------------------- 3. drop the eitherOr pick
OLD_EITHEROR = '''  // Either/or overrides the base mechanic: flat % OR bundle N-for-M, whichever
  // yields the SMALLER total savings when both qualify (store-advantaged).
  if (rule.config.eitherOr) {
    const { flatPercent, bundle } = rule.config.eitherOr;
    const optionA = new Map<string, LineDiscount>();
    if (flatPercent > 0) {
      for (const l of eligible) optionA.set(l.lineId, flatPercentDiscount(l, flatPercent, rule.title));
    }
    const optionB = bundleSpreadDiscounts(eligible, bundle.n, bundle.m, rule.title);
    const savingsA = totalSavings(optionA, eligible);
    const savingsB = totalSavings(optionB, eligible);
    if (savingsA <= 0 && savingsB <= 0) return out;
    // Pick the option with the SMALLER positive savings; a zero-savings option
    // never beats a positive one (the deal must actually apply).
    let chosen: Map<string, LineDiscount>;
    if (savingsA <= 0) chosen = optionB;
    else if (savingsB <= 0) chosen = optionA;
    else chosen = savingsA <= savingsB ? optionA : optionB;
    for (const [k, v] of chosen.entries()) out.set(k, v);
    return out;
  }'''

NEW_EITHEROR = '''  // SLICE D1 -- READ THIS BEFORE REINSTATING ANY "WHICHEVER SAVES LESS" LOGIC.
  //
  // This block used to intercept every eitherOr rule and keep whichever of the
  // two advertised options saved the customer LESS. It was believed to be the
  // owner's "store wins" policy. It was not. That policy is about ROUNDING
  // ("if we need to round, we should always round up or round in our favor"),
  // and it had been promoted into a deal-SELECTION rule.
  //
  // The measured consequence on Doobie Tuesday ("20% off OR 4 for 3"):
  //   qty  1-3  ->  20%   correct
  //   qty  4    ->  20%   the 4-for-3 is worth 25%, so it was DISCARDED
  //   qty  6    ->  16%   the bundle now saves LESS, so it WON
  //   qty  7    ->  14%   worse still
  //   qty  8    ->  20%   back again
  // A customer's discount FELL by adding a sixth preroll, and the store
  // advertised 20% while charging 16%. The owner's ruling: "if a discount
  // specifically states 4 or more prerolls is 25% off, then its 25% off,
  // whether the store wants to win or not."
  //
  // An either/or deal now resolves to the option that HONOURS the advertising,
  // i.e. the better of the two for the customer. Where a deal wants tiers, it
  // declares qtyTiers and the multi_item_tier branch below runs them.
  if (rule.config.eitherOr) {
    const { flatPercent, bundle } = rule.config.eitherOr;
    const optionA = new Map<string, LineDiscount>();
    if (flatPercent > 0) {
      for (const l of eligible) optionA.set(l.lineId, flatPercentDiscount(l, flatPercent, rule.title));
    }
    const optionB = bundleSpreadDiscounts(eligible, bundle.n, bundle.m, rule.title);
    const savingsA = totalSavings(optionA, eligible);
    const savingsB = totalSavings(optionB, eligible);
    if (savingsA <= 0 && savingsB <= 0) return out;
    // Honour the advertising: the option that actually delivers what the deal
    // promises. A zero-savings option never beats a positive one.
    let chosen: Map<string, LineDiscount>;
    if (savingsA <= 0) chosen = optionB;
    else if (savingsB <= 0) chosen = optionA;
    else chosen = savingsA >= savingsB ? optionA : optionB;
    for (const [k, v] of chosen.entries()) out.set(k, v);
    return out;
  }'''


def edit(text, old, new, label):
    # Idempotency is decided by NEW alone; testing count(old)==0 too is wrong
    # whenever NEW contains OLD as a substring (append-style edit).
    if text.count(new) == 1:
        print(f"  {label}: already applied")
        return text
    assert text.count(old) == 1, f"{label}: found {text.count(old)} copies of OLD, expected 1"
    out = text.replace(old, new, 1)
    assert out != text, f"{label}: no-op"
    print(f"  {label}: applied")
    return out


def main():
    with open(TARGET, "r", encoding="utf-8") as f:
        text = f.read()
    original = text

    text = edit(text, OLD_IMPORT, NEW_IMPORT, "import the apportionment core")
    text = edit(text, OLD_BUNDLE, NEW_BUNDLE, "exact-cent bundle spread")
    text = edit(text, OLD_EITHEROR, NEW_EITHEROR, "either/or honours the advertising")

    if text != original:
        with open(TARGET, "w", encoding="utf-8") as f:
            f.write(text)
    # Always re-read and re-verify from disk, including on the already-applied
    # path: the checks below are the real contract, and skipping them when
    # nothing changed is exactly how a bad state stays invisible.
    with open(TARGET, "r", encoding="utf-8") as f:
        disk = f.read()
    assert disk == text, "disk content does not match what we wrote"
    assert "Math.floor((targetSavings / eligibleTotal) * 100)" not in disk, (
        "the floored-percent spread is still present"
    )
    assert disk.count("apportionBundleSavings") == 2, (
        f"expected 1 import + 1 call, found {disk.count('apportionBundleSavings')}"
    )
    assert "savingsA >= savingsB ? optionA : optionB" in disk, "either/or direction not flipped"
    # GUARD (regression found in D1): the first draft of this script rewrote the
    # STATUTORY_GRAMS_PER_OUNCE import to "@/lib/compliance/sales-limits-core",
    # which IMPORTS that constant but re-exports it as GRAMS_PER_OUNCE. The name
    # resolved to undefined, gramsForLabel("1oz") became NaN, and Ounce Friday
    # would have silently stopped applying. Never let the module path move.
    assert 'from "@/lib/compliance/grams-per-ounce"' in disk, (
        "STATUTORY_GRAMS_PER_OUNCE must come from grams-per-ounce (sales-limits-core "
        "re-exports it under a DIFFERENT name and yields undefined)"
    )
    assert 'STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/sales-limits-core"' not in disk, (
        "wrong module for STATUTORY_GRAMS_PER_OUNCE"
    )
    print("Verified on disk.")


if __name__ == "__main__":
    main()
