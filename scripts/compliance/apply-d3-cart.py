#!/usr/bin/env python3
"""SLICE D3 - the website cart's Saturday branch, matched to the register.

The website holds its own copy of this arithmetic (it has no cost data, so it
cannot simply import the register's clamps). Both now delegate the two
decisions that matter to saturday-headline-core, so they cannot drift.

NOTE the website has NO competing-promotion concept today: computeCartDiscounts
takes a weekday and applies exactly one day's deal. So there is no clearance
rule to hijack the headline here. The headline pick is still routed through the
shared core so that the tie-break (lineId, not cart order) and the exact-cent
blend are identical to the register.
"""
import io
import sys

PATH = "src/lib/specials/cart-discount.ts"

with io.open(PATH, encoding="utf-8") as f:
    text = f.read()
orig = text

# ---------------------------------------------------------------------------
# EDIT 1 - import the shared core.
# ---------------------------------------------------------------------------
OLD1 = 'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";'
NEW1 = (
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";\n'
    "import {\n"
    "  pickHeadlineLine,\n"
    "  saturdayLineTotal,\n"
    "  effectiveLinePercent,\n"
    '} from "@/lib/promotions/saturday-headline-core";'
)
if text.count(NEW1) == 1:
    print("EDIT 1: already applied")
else:
    assert text.count(OLD1) == 1, f"EDIT 1 anchor: {text.count(OLD1)} copies"
    text = text.replace(OLD1, NEW1)
    print("EDIT 1: applied")

# ---------------------------------------------------------------------------
# EDIT 2 - the Saturday branch.
# ---------------------------------------------------------------------------
OLD2 = """      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l));
      // Find the LOWEST-priced eligible unit to receive the 30% headline deal.
      let topLineId: string | null = null;
      let topUnitPrice = Number.POSITIVE_INFINITY;
      for (const line of eligible) {
        if (line.regularPriceMinorUnits < topUnitPrice) {
          topUnitPrice = line.regularPriceMinorUnits;
          topLineId = line.lineId;
        }
      }
      for (const line of eligible) {
        if (line.lineId === topLineId) {
          // Split the line: 1 unit at 30%, the rest at 15% (blended per-unit).
          if (line.quantity <= 1) {
            resultMap.set(line.lineId, applyPercentLine(line, 30, "Super Saturday"));
          } else {
            const oneAt30 = round(line.regularPriceMinorUnits * 0.7);
            const restAt15 = round(line.regularPriceMinorUnits * 0.85);
            const blendedTotal = oneAt30 + restAt15 * (line.quantity - 1);
            const blendedUnit = clampLineUnit(line, round(blendedTotal / line.quantity));
            resultMap.set(line.lineId, {
              lineId: line.lineId,
              unitPriceMinorUnits: blendedUnit,
              regularPriceMinorUnits: line.regularPriceMinorUnits,
              quantity: line.quantity,
              unitSavingsMinorUnits: line.regularPriceMinorUnits - blendedUnit,
              appliedLabel: "Super Saturday \u00b7 30% one item + 15%",
              appliedPercent: 15,
            });
          }
        } else {
          resultMap.set(line.lineId, applyPercentLine(line, 15, "Super Saturday"));
        }
      }"""

NEW2 = """      const eligible = cartLines.filter((l) => !isMerchOrAccessory(l));
      // SLICE D3: the headline target comes from the SHARED pure core, so the
      // website and the register cannot drift. Two behaviours changed:
      //   1. a price TIE now breaks on lineId instead of cart order, so the
      //      same basket never prices differently depending on the order the
      //      customer happened to add things;
      //   2. the multi-quantity blend uses exact integer maths instead of
      //      round(price * 0.7) -- the old form overcharged 1,169 of 1,498
      //      blended combinations, worst case 12 cents (price=507, qty=8).
      const topLineId = pickHeadlineLine(
        eligible.map((l) => ({
          lineId: l.lineId,
          regularPriceMinorUnits: l.regularPriceMinorUnits,
        })),
        30,
        15,
      );
      for (const line of eligible) {
        const isTarget = line.lineId === topLineId;
        if (isTarget && line.quantity <= 1) {
          resultMap.set(line.lineId, applyPercentLine(line, 30, "Super Saturday"));
          continue;
        }
        if (!isTarget) {
          resultMap.set(line.lineId, applyPercentLine(line, 15, "Super Saturday"));
          continue;
        }
        // Split the line: 1 unit at 30%, the rest at 15% (blended per-unit).
        const t = saturdayLineTotal(line.regularPriceMinorUnits, line.quantity, 30, 15, true);
        const blendedUnit = clampLineUnit(line, t.blendedUnitMinorUnits);
        resultMap.set(line.lineId, {
          lineId: line.lineId,
          unitPriceMinorUnits: blendedUnit,
          regularPriceMinorUnits: line.regularPriceMinorUnits,
          quantity: line.quantity,
          unitSavingsMinorUnits: line.regularPriceMinorUnits - blendedUnit,
          appliedLabel: "Super Saturday \u00b7 30% one item + 15%",
          // The line carries one 30% unit; reporting a flat 15% understated it.
          appliedPercent: effectiveLinePercent(
            line.regularPriceMinorUnits,
            line.quantity,
            (line.regularPriceMinorUnits - blendedUnit) * line.quantity,
          ),
        });
      }"""
if text.count(NEW2) == 1:
    print("EDIT 2: already applied")
else:
    assert text.count(OLD2) == 1, f"EDIT 2 anchor: {text.count(OLD2)} copies"
    text = text.replace(OLD2, NEW2)
    print("EDIT 2: applied")

if text == orig:
    print("no changes needed")
    sys.exit(0)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(text)

with io.open(PATH, encoding="utf-8") as f:
    disk = f.read()
for i, needle in enumerate([NEW1, NEW2], start=1):
    assert disk.count(needle) == 1, f"read-back EDIT {i}: {disk.count(needle)} copies"
print("VERIFIED on disk: both edits present exactly once")
