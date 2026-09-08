#!/usr/bin/env python3
"""
fix-l4-plumbing-test.py — corrects TWO fidelity errors in my own test file.

Neither is an engine defect; both were verified against the real source before
being changed, and NEITHER assertion was weakened:

  1. REC_LIQUID_ML is IMPORTED by sales-limits-core, not re-exported from it
     (grep: no `export ... REC_LIQUID_ML` in that module). Importing it from
     there yielded undefined, hence `NaN > 50`. It is imported from its home
     module, liquid-volume-core, instead. The assertion is unchanged.

  2. priceCart reads `entry.product.unitGrams` straight off the menu bundle
     (sale-flow-core.ts:446); it does NOT parse the label itself. The API route
     is what calls gramsFromVariantLabel. My "12oz" card therefore arrived with
     no weight and no volume, fell to the 28 g default, and 7 of them fit. The
     test card is corrected to carry what the real bundle carries. The
     assertion (6 legal, 7 refused) is unchanged, and it now passes for the
     right reason.
"""

import sys

PATH = "tests/compliance/liquid-limit-ml-plumbing.test.ts"

EDITS = [
    (
        "REC_LIQUID_ML import moved to its home module",
        """  lineMl,
  REC_LIQUID_ML,
  type LimitCartLine,
} from "../../src/lib/compliance/sales-limits-core";
import {
  ML_PER_FLUID_OUNCE,
  volumeMlFromLabel,
  lineVolumeMl,
} from "../../src/lib/compliance/liquid-volume-core";""",
        """  lineMl,
  type LimitCartLine,
} from "../../src/lib/compliance/sales-limits-core";
// REC_LIQUID_ML lives here; sales-limits-core imports it rather than
// re-exporting it, so it must be taken from its home module.
import {
  ML_PER_FLUID_OUNCE,
  REC_LIQUID_ML,
  volumeMlFromLabel,
  lineVolumeMl,
} from "../../src/lib/compliance/liquid-volume-core";""",
    ),
    (
        "the 12oz card carries the weight the real bundle carries",
        """  it("the register's own 12oz card still allows exactly 6 and refuses 7", () => {
    const p = card({ variantLabel: "12oz" });""",
        """  it("the register's own 12oz card still allows exactly 6 and refuses 7", () => {
    // unitGrams is supplied BY THE BUNDLE: /api/pos/menu calls
    // gramsFromVariantLabel and priceCart reads the result off the card
    // (sale-flow-core.ts:446). Building the card the way the route does is
    // what makes this a real regression test rather than a default-value one.
    const p = card({ variantLabel: "12oz", unitGrams: gramsFromVariantLabel("12oz") });""",
    ),
]


def main() -> int:
    with open(PATH, "r", encoding="utf-8") as fh:
        src = fh.read()
    for label, old, new in EDITS:
        if new in src:
            print(f"SKIP    {label}")
            continue
        count = src.count(old)
        if count != 1:
            print(f"FAIL    {label}: anchor matched {count} times")
            return 1
        src = src.replace(old, new, 1)
        print(f"APPLIED {label}")
    with open(PATH, "w", encoding="utf-8") as fh:
        fh.write(src)
    with open(PATH, "r", encoding="utf-8") as fh:
        back = fh.read()
    for label, _old, new in EDITS:
        if new not in back:
            print(f"FAIL    {label}: disk read-back missing")
            return 1
    print("disk read-back OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
