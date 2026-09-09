#!/usr/bin/env python3
"""SLICE D3 - wire saturday-headline-core into the register engine.

Mutation harness per the standing rules: every edit asserts EXACTLY ONE match,
then the file is re-read from disk and verified. Idempotency is decided by
`text.count(new) == 1` ALONE (never `count(old) == 0`, which is wrong whenever
NEW contains OLD as a substring).
"""
import io
import re
import sys

PATH = "src/lib/promotions/discount-engine-core.ts"

with io.open(PATH, encoding="utf-8") as f:
    text = f.read()
orig = text

# ---------------------------------------------------------------------------
# EDIT 1 - import the pure core.
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
# EDIT 2 - applyOnePromotion accepts the competing-savings map.
# ---------------------------------------------------------------------------
OLD2 = """export function applyOnePromotion(
  rule: EngineRule,
  lines: EngineCartLine[],
): Map<string, LineDiscount> {"""
NEW2 = """export function applyOnePromotion(
  rule: EngineRule,
  lines: EngineCartLine[],
  /**
   * SLICE D3: the best per-unit saving each line is ALREADY receiving from a
   * higher-value promotion (clearance markdown, vendor day). Only the basket
   * headline branch consults it, to avoid awarding "30% off one item" to a
   * line whose existing offer would beat it -- best-deal-wins would then
   * discard the headline and the advertised deal would reach nobody.
   * Optional and defaulted, so every existing caller is unaffected.
   */
  competingUnitSavings?: ReadonlyMap<string, number>,
): Map<string, LineDiscount> {"""
if text.count(NEW2) == 1:
    print("EDIT 2: already applied")
else:
    assert text.count(OLD2) == 1, f"EDIT 2 anchor: {text.count(OLD2)} copies"
    text = text.replace(OLD2, NEW2)
    print("EDIT 2: applied")

# ---------------------------------------------------------------------------
# EDIT 3 - replace the basketTopItem branch with the pure core.
# ---------------------------------------------------------------------------
OLD3 = """        const { topPercent, restPercent } = rule.config.basketTopItem;
        const headlinePercent = Math.max(topPercent, restPercent);
        const othersPercent = Math.min(topPercent, restPercent);
        let targetId: string | null = null;
        let lowest = Number.POSITIVE_INFINITY;
        for (const l of eligible) {
          if (l.regularPriceMinorUnits < lowest) {
            lowest = l.regularPriceMinorUnits;
            targetId = l.lineId;
          }
        }
        for (const l of eligible) {
          if (l.lineId === targetId) {
            if (l.quantity <= 1) {
              out.set(l.lineId, flatPercentDiscount(l, headlinePercent, rule.title));
            } else {
              const oneAtHeadline = round(l.regularPriceMinorUnits * (1 - headlinePercent / 100));
              const restAt = round(l.regularPriceMinorUnits * (1 - othersPercent / 100));
              const blendedTotal = oneAtHeadline + restAt * (l.quantity - 1);
              const blendedUnit = clampEngineUnit(l, round(blendedTotal / l.quantity));
              out.set(l.lineId, {
                unitPrice: blendedUnit,
                percent: othersPercent,
                label: `${rule.title} \u00b7 ${headlinePercent}% one item + ${othersPercent}%`,
              });
            }
          } else {
            out.set(l.lineId, flatPercentDiscount(l, othersPercent, rule.title));
          }
        }"""

NEW3 = """        const { topPercent, restPercent } = rule.config.basketTopItem;
        const headlinePercent = Math.max(topPercent, restPercent);
        const othersPercent = Math.min(topPercent, restPercent);

        // SLICE D3: pick the target through the shared pure core. It keeps the
        // owner's rule (the LOWEST-priced item wins the headline) but skips a
        // line whose existing offer already beats the headline -- a clearance
        // or vendor-day item. Measured before this fix: across 2,000 Saturday
        // baskets each holding one clearance item, the advertised "30% off any
        // one item" reached NOBODY in 100% of them, because Saturday handed the
        // 30% to the cheapest line (the clearance item) and best-deal-wins then
        // discarded it in favour of the 50%. Ties now break on lineId, so the
        // same basket no longer prices differently by cart order.
        const targetId = pickHeadlineLine(
          eligible.map((l) => ({
            lineId: l.lineId,
            regularPriceMinorUnits: l.regularPriceMinorUnits,
            competingUnitSavingsMinorUnits: competingUnitSavings?.get(l.lineId) ?? 0,
          })),
          headlinePercent,
          othersPercent,
        );

        for (const l of eligible) {
          const isTarget = l.lineId === targetId;
          if (isTarget && l.quantity <= 1) {
            out.set(l.lineId, flatPercentDiscount(l, headlinePercent, rule.title));
            continue;
          }
          if (!isTarget) {
            out.set(l.lineId, flatPercentDiscount(l, othersPercent, rule.title));
            continue;
          }
          // Target line, quantity > 1: ONE unit at the headline, the rest at
          // the others rate, with exact integer maths (SLICE D2's lesson --
          // rounding the PRICE overcharged 1,169 of 1,498 blended lines, worst
          // case 12 cents on price=507 qty=8).
          const t = saturdayLineTotal(
            l.regularPriceMinorUnits,
            l.quantity,
            headlinePercent,
            othersPercent,
            true,
          );
          const blendedUnit = clampEngineUnit(l, t.blendedUnitMinorUnits);
          out.set(l.lineId, {
            unitPrice: blendedUnit,
            // The line really carries one headline unit, so reporting the
            // others-rate understated what the customer received.
            percent: effectiveLinePercent(
              l.regularPriceMinorUnits,
              l.quantity,
              (l.regularPriceMinorUnits - blendedUnit) * l.quantity,
            ),
            label: `${rule.title} \u00b7 ${headlinePercent}% one item + ${othersPercent}%`,
          });
        }"""
if text.count(NEW3) == 1:
    print("EDIT 3: already applied")
else:
    assert text.count(OLD3) == 1, f"EDIT 3 anchor: {text.count(OLD3)} copies"
    text = text.replace(OLD3, NEW3)
    print("EDIT 3: applied")

# ---------------------------------------------------------------------------
# EDIT 4 - computePromotions: two-pass so basket rules can see competing offers.
# ---------------------------------------------------------------------------
OLD4 = """  // Evaluate rules by priority (higher first) so ties favour the higher-priority promo.
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of ordered) {
    const discounts = applyOnePromotion(rule, lines);"""
NEW4 = """  // Evaluate rules by priority (higher first) so ties favour the higher-priority promo.
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);

  // SLICE D3: a basket headline rule ("30% off one item") must know what the
  // other promotions are already giving each line, or it hands its headline to
  // a clearance item and best-deal-wins throws the headline away. Pre-compute
  // the best per-unit saving every OTHER rule offers, then feed that in. Only
  // basket rules read it, so no other deal's behaviour changes.
  const isBasketHeadline = (r: EngineRule) =>
    r.discountType === "basket" && Boolean(r.config.basketTopItem);
  const competing = new Map<string, number>();
  if (ordered.some(isBasketHeadline)) {
    for (const rule of ordered) {
      if (isBasketHeadline(rule)) continue;
      for (const [lineId, d] of applyOnePromotion(rule, lines).entries()) {
        const line = lines.find((l) => l.lineId === lineId);
        if (!line) continue;
        const saving = line.regularPriceMinorUnits - d.unitPrice;
        if (saving > (competing.get(lineId) ?? 0)) competing.set(lineId, saving);
      }
    }
  }

  for (const rule of ordered) {
    const discounts = applyOnePromotion(rule, lines, competing);"""
if text.count(NEW4) == 1:
    print("EDIT 4: already applied")
else:
    assert text.count(OLD4) == 1, f"EDIT 4 anchor: {text.count(OLD4)} copies"
    text = text.replace(OLD4, NEW4)
    print("EDIT 4: applied")

if text == orig:
    print("no changes needed")
    sys.exit(0)

with io.open(PATH, "w", encoding="utf-8") as f:
    f.write(text)

# Disk read-back verification.
with io.open(PATH, encoding="utf-8") as f:
    disk = f.read()
for i, needle in enumerate([NEW1, NEW2, NEW3, NEW4], start=1):
    assert disk.count(needle) == 1, f"read-back EDIT {i}: {disk.count(needle)} copies"
print("VERIFIED on disk: all 4 edits present exactly once")
