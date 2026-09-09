#!/usr/bin/env python3
"""
SLICE D2 (part 5) - the website cart's Sunday still used the floored percent.

D1 fixed Ice Cream Sunday in discount-engine-core.ts. It did NOT fix the
independent copy of the same arithmetic in src/lib/specials/cart-discount.ts,
which is what the promotions-harmony parity suite compares against. Measured on
a $30 + $22 + $10 basket:

    legacy website cart : 992   (floor(15.87%) = 15% spread)
    rules engine        : 1000  (exact - the cheapest unit is $10.00)

So the website quoted $9.92 where the register charged $10.00: the two engines
disagreed, AND the website under-delivered the advertised 3-for-2 by 8c.

The fix is not to re-implement the maths a second time - that duplication is the
root cause of this entire round. The cart now calls the SAME
bundle-apportionment-core the engine uses, so the two cannot diverge again.

The parity suite is the reason this was caught. It is doing exactly its job:
"the advertised price must equal the charged price."
"""

import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CART = os.path.join(REPO, "src/lib/specials/cart-discount.ts")

OLD = '''      units.sort((a, b) => a.price - b.price);
      const groupCount = Math.floor(units.length / 3);
      if (groupCount <= 0 || eligibleRegularTotal <= 0) break;
      let targetSavings = 0;
      for (let i = 0; i < groupCount; i += 1) targetSavings += units[i].price;
      // Equivalent basket-wide percent (capped so no unit ever reaches $0).
      const percent = Math.min(99, Math.floor((targetSavings / eligibleRegularTotal) * 100));
      if (percent <= 0) break;
      for (const line of eligible) {
        const raw = round(line.regularPriceMinorUnits * (1 - percent / 100));
        const discounted = clampLineUnit(line, raw);
        resultMap.set(line.lineId, {
          lineId: line.lineId,
          unitPriceMinorUnits: discounted,
          regularPriceMinorUnits: line.regularPriceMinorUnits,
          quantity: line.quantity,
          unitSavingsMinorUnits: line.regularPriceMinorUnits - discounted,
          appliedLabel: `Ice Cream Sunday · 3-for-2 equivalent (${percent}% off basket)`,
          appliedPercent: percent,
        });
      }
      break;'''

NEW = '''      units.sort((a, b) => a.price - b.price);
      const groupCount = Math.floor(units.length / 3);
      if (groupCount <= 0 || eligibleRegularTotal <= 0) break;

      // SLICE D2: exact-cent apportionment via the SHARED core, not a floored
      // basket percent. The old code converted the savings target into
      // floor(target / total * 100), which on a $30 + $22 + $10 basket paid
      // $9.92 against an advertised $10.00 3-for-2 - and disagreed with the
      // register, which had already been corrected in D1. Calling the same
      // module the engine calls is what stops the two drifting apart again.
      const apportionLines = eligible.map((line) => ({
        lineId: line.lineId,
        regularPriceMinorUnits: line.regularPriceMinorUnits,
        quantity: line.quantity,
        floorMinorUnits: clampLineUnit(line, 0),
      }));
      const targetSavings = bundleTargetMinorUnits(apportionLines, 3, 2);
      if (targetSavings <= 0) break;
      const spread = apportionBundleSavings(apportionLines, targetSavings);
      if (spread.placedMinorUnits <= 0) break;

      for (const line of eligible) {
        const off = spread.perUnitOff.get(line.lineId) ?? 0;
        if (off <= 0) continue;
        const discounted = clampLineUnit(line, line.regularPriceMinorUnits - off);
        const appliedPercent =
          line.regularPriceMinorUnits > 0
            ? Math.round(((line.regularPriceMinorUnits - discounted) / line.regularPriceMinorUnits) * 100)
            : 0;
        resultMap.set(line.lineId, {
          lineId: line.lineId,
          unitPriceMinorUnits: discounted,
          regularPriceMinorUnits: line.regularPriceMinorUnits,
          quantity: line.quantity,
          unitSavingsMinorUnits: line.regularPriceMinorUnits - discounted,
          appliedLabel: "Ice Cream Sunday · buy 3, pay for 2",
          appliedPercent,
        });
      }
      break;'''

IMPORT_OLD = 'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";'
IMPORT_NEW = (
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";\n'
    'import {\n'
    '  apportionBundleSavings,\n'
    '  bundleTargetMinorUnits,\n'
    '} from "@/lib/promotions/bundle-apportionment-core";'
)


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
    with open(CART, "r", encoding="utf-8") as f:
        text = f.read()
    original = text
    text = edit(text, IMPORT_OLD, IMPORT_NEW, "cart: import the shared core")
    text = edit(text, OLD, NEW, "cart: Sunday uses exact apportionment")
    if text != original:
        with open(CART, "w", encoding="utf-8") as f:
            f.write(text)
    with open(CART, "r", encoding="utf-8") as f:
        disk = f.read()
    assert disk == text, "disk mismatch"
    assert "Math.floor((targetSavings / eligibleRegularTotal) * 100)" not in disk, (
        "the floored Sunday percent survived"
    )
    assert disk.count("apportionBundleSavings") == 2, "expected 1 import + 1 call"
    print("Verified on disk.")


if __name__ == "__main__":
    main()
