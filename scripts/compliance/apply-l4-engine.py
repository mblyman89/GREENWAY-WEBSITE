#!/usr/bin/env python3
"""
SLICE L4 — rebase the liquid_edible bucket from grams to millilitres.
Every edit asserts a unique anchor and verifies the write landed on disk.
"""
import sys

SL = "src/lib/compliance/sales-limits-core.ts"
EDITS = []


def edit(path, old, new, label):
    EDITS.append((path, old, new, label))


# ── 1. header doc ─────────────────────────────────────────────────────────
edit(
    SL,
    " *   - liquid_edible   : 72 ounces liquid infused           = 2016 g  (72 \u00d7 28, \u2248 ml)",
    " *   - liquid_edible   : 72 FLUID ounces liquid infused      = 2129.292 ml \u2014 SLICE L4",
    "header line",
)

edit(
    SL,
    """ * that creates real exposure. Declining can only under-sell, which is
 * recoverable and explainable. Do NOT "fix" this to 30.""",
    """ * that creates real exposure. Declining can only under-sell, which is
 * recoverable and explainable. Do NOT "fix" this to 30.
 *
 * \u2500\u2500 SLICE L4: WHY liquid_edible IS MEASURED IN MILLILITRES \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * The owner found that the liquid limit allowed vastly more than 72 ounces.
 * The instinctive diagnosis \u2014 "2016 is the wrong constant" \u2014 IS WRONG, and
 * anyone changing this code must understand why before touching it.
 *
 * For an OUNCE-labelled product the grams basis was numerically EXACT, because
 * the 28 cancels:
 *
 *     2016 / (q * 28)  ==  72 / q  ==  (72 * 29.5735) / (q * 29.5735)
 *
 * So 1oz\u219272, 2oz\u219236, 16oz\u21924, 32oz\u21922 all enforced correctly. The real defect
 * was that ml / fl oz / L produced NO per-unit measure at all
 * (gramsFromVariantLabel matches only g|oz), so they fell back to
 * DEFAULT_UNIT_GRAMS["edible-liquid"] = 28 and EVERY size allowed exactly 72
 * packages: a 1.5 L bottle counted the same as a 1 oz vial (a 72x oversell),
 * while a 10 ml dropper was capped at 72 when 212 are legal (an UNDER-sell
 * that cost legal sales). The error ran both ways.
 *
 * The fix is the BASIS, not the number. Both the bucket total and the cap are
 * rescaled by the SAME ratio R = 29.5735 / 28 = 1.056196, so no
 * currently-correct verdict can move:
 *
 *     G <= 2016  <==>  G*R <= 2129.292
 *
 * Verified numerically across g = 0..4000 in 0.25 g steps: 0 mismatches, with
 * both boundaries exact (2016*R = 2129.2920 = the cap; 2016.25*R exceeds it).
 *
 * THIS IS ALSO WHAT KEEPS TOPICALS SAFE. categoryToBucket routes `topical`
 * into liquid_edible, and the owner's decision is that topicals stay on
 * WEIGHTED ounces until their own later slice. Because the ounce-count is
 * carried across as an ounce-count (never through an invented g/ml density), a
 * weight-labelled salve keeps its exact previous behaviour: 1oz\u219272, 1.7oz\u219242,
 * 2oz\u219236, 4oz\u219218, 8oz\u21929 \u2014 all identical. NO DENSITY IS ASSUMED ANYWHERE.""",
    "header rationale",
)

# ── 2. LimitUnit + bucket unit map ───────────────────────────────────────
edit(
    SL,
    'export type LimitUnit = "g" | "mg_thc" | "units";',
    'export type LimitUnit = "g" | "ml" | "mg_thc" | "units";',
    "LimitUnit",
)

edit(
    SL,
    '  liquid_edible: "g",\n  low_thc_liquid: "mg_thc",',
    """  // SLICE L4 \u2014 MILLILITRES. The statute caps this bucket at 72 FLUID ounces,
  // and a volume cap can only be enforced on a volume basis. Any formatter
  // that assumes grams here will render 2129.292 as "76.046 oz", which is
  // wrong by the ratio between a fluid ounce and a weight ounce.
  liquid_edible: "ml",
  low_thc_liquid: "mg_thc",""",
    "LIMIT_BUCKET_UNITS",
)

# ── 3. unit predicates + formatter ───────────────────────────────────────
edit(
    SL,
    """/** SLICE 17 \u2014 true when the bucket counts ITEMS rather than any measure of mass. */
export function isUnitCountBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === "units";
}""",
    """/** SLICE 17 \u2014 true when the bucket counts ITEMS rather than any measure of mass. */
export function isUnitCountBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === "units";
}

/** SLICE L4 \u2014 true when the bucket is measured in millilitres of product. */
export function isVolumeBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === "ml";
}""",
    "isVolumeBucket",
)

edit(
    SL,
    """  if (bucket === "concentrate") return `${round3(amount)} g`;
  return `${gramsToOunces(amount)} oz`;
}""",
    """  if (bucket === "concentrate") return `${round3(amount)} g`;
  // SLICE L4 \u2014 a volume bucket renders in FLUID ounces, because that is how
  // the statute states it and how the owner asked to see it. Rendering ml
  // through gramsToOunces() would report 2129.292 as "76.046 oz".
  if (isVolumeBucket(bucket)) return `${round3(amount / ML_PER_FLUID_OUNCE)} fl oz`;
  return `${gramsToOunces(amount)} oz`;
}""",
    "formatLimitAmount",
)

# ── 4. the caps ──────────────────────────────────────────────────────────
edit(
    SL,
    "  liquid_edible: 72 * GRAMS_PER_OUNCE, // 2016 g (72 oz)",
    "  liquid_edible: REC_LIQUID_ML, // 2129.292 ml (72 FLUID oz) \u2014 SLICE L4",
    "REC cap",
)

edit(
    SL,
    "  liquid_edible: 216 * GRAMS_PER_OUNCE, // 6048 g (216 oz)",
    "  liquid_edible: MED_LIQUID_ML, // 6387.876 ml (216 FLUID oz) \u2014 SLICE L4",
    "MED cap",
)

# ── 5. import the constants rather than re-deriving them ────────────────
edit(
    SL,
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";',
    'import { STATUTORY_GRAMS_PER_OUNCE } from "@/lib/compliance/grams-per-ounce";\n'
    "// SLICE L4 \u2014 the volume basis. Imported, never re-derived: a second copy of\n"
    "// 29.5735 is how the cap and the line measure drift apart.\n"
    "import {\n"
    "  ML_PER_FLUID_OUNCE,\n"
    "  REC_LIQUID_ML,\n"
    "  MED_LIQUID_ML,\n"
    '} from "@/lib/compliance/liquid-volume-core";',
    "imports",
)

# ── 6. LimitCartLine gains volumeMl ─────────────────────────────────────
edit(
    SL,
    """  /** Optional explicit grams for this whole line (overrides per-unit math). */
  grams?: number | null;""",
    """  /** Optional explicit grams for this whole line (overrides per-unit math). */
  grams?: number | null;
  /**
   * SLICE L4 \u2014 total MILLILITRES this line contributes to the liquid bucket:
   * the L3-plumbed per-package net volume times the quantity, resolved by the
   * caller. This is the field that finally makes the 72 FLUID ounce cap
   * enforceable on a bottle whose size is stated in ml, fl oz, or litres.
   *
   * null/absent means "not measured", NEVER zero \u2014 an unmeasured liquid falls
   * back to the weight-carried default below rather than becoming free.
   */
  volumeMl?: number | null;""",
    "LimitCartLine.volumeMl",
)

# ── 7. lineMl ───────────────────────────────────────────────────────────
edit(
    SL,
    """/** Grams a single cart line contributes to its bucket. */
export function lineGrams(line: LimitCartLine, overrides?: LimitOverrides): number {""",
    """/**
 * SLICE L4 \u2014 millilitres a single cart line contributes to the liquid bucket.
 *
 * Three sources, in strict priority order:
 *
 *  1. A REAL measured volume (`volumeMl`), plumbed from the product name by
 *     SLICE L3. This is the fix: it is the only source that can tell a 30 ml
 *     dropper from a 1.5 L growler.
 *
 *  2. A weight measure (`grams`, from the variant label via AN-1), carried
 *     across AT ITS OUNCE-COUNT: grams / 28 * 29.5735. This is NOT a density
 *     conversion and does not pretend to be one \u2014 it preserves "how many of
 *     the statute's 72 ounces does this package use", which is exactly what
 *     the grams basis was already computing correctly. It is what keeps
 *     ounce-labelled liquids and every weight-based TOPICAL behaving
 *     identically to before this slice.
 *
 *  3. The category default, carried across the same way, so a line nobody has
 *     measured still consumes allowance instead of being silently free.
 *
 * Returns 0 only for a genuinely zero/absent quantity.
 */
export function lineMl(line: LimitCartLine, overrides?: LimitOverrides): number {
  // 1. a real, measured volume for the whole line
  if (typeof line.volumeMl === "number" && line.volumeMl > 0) return round3(line.volumeMl);
  // 2/3. fall back to the weight basis, carried across at its ounce-count
  const grams = lineGrams(line, overrides);
  if (grams <= 0) return 0;
  return round3((grams / GRAMS_PER_OUNCE) * ML_PER_FLUID_OUNCE);
}

/** Grams a single cart line contributes to its bucket. */
export function lineGrams(line: LimitCartLine, overrides?: LimitOverrides): number {""",
    "lineMl",
)

# ── 8. evaluateCart routes the liquid bucket through lineMl ─────────────
edit(
    SL,
    """    const contribution =
      bucket === "low_thc_liquid"
        ? lineThcMg(line)
        : bucket === "otherwise_taken"
          ? lineUnits(line)
          : lineGrams(line, overrides);""",
    """    const contribution =
      bucket === "low_thc_liquid"
        ? lineThcMg(line)
        // SLICE L4 \u2014 the liquid bucket accumulates MILLILITRES against a
        // 2129.292 ml (72 fl oz) cap. Before this, it accumulated grams
        // against 2016 g, and since ml/fl oz/L labels produced no per-unit
        // weight at all, every liquid used the 28 g default and 72 packages
        // of ANY size fit.
        : bucket === "liquid_edible"
          ? lineMl(line, overrides)
          : bucket === "otherwise_taken"
            ? lineUnits(line)
            : lineGrams(line, overrides);""",
    "evaluateCart routing",
)


def main():
    for path, old, new, label in EDITS:
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        n = src.count(old)
        if n != 1:
            print(f"ABORT [{label}] {path}: anchor found {n} times, expected 1")
            sys.exit(1)
        out = src.replace(old, new, 1)
        if out == src:
            print(f"ABORT [{label}] {path}: no-op")
            sys.exit(1)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(out)
        with open(path, encoding="utf-8") as fh:
            if fh.read() != out:
                print(f"ABORT [{label}] {path}: write did not stick")
                sys.exit(1)
        print(f"OK   [{label}]")
    print(f"\n{len(EDITS)}/{len(EDITS)} edits applied and verified.")


if __name__ == "__main__":
    main()
