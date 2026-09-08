#!/usr/bin/env python3
"""
T1 — a known net WEIGHT is a complete answer for a topical.

The L5 gate fires on any liquid-bucket shelf with no derivable VOLUME. That
set includes `topical`, but a balm tin states grams or weight-ounces, never
millilitres. The receiver was therefore asked a question the package cannot
answer, and converting weight-oz -> ml needs a density nobody has.

The engine already meters a weight-labelled line exactly (lineMl carries the
ounce-count across at 29.5735/28), so a known weight IS a measurement. The
gate must accept it.

Idempotent: asserts the anchor appears exactly once, then reads back from disk.
"""
import io
import sys

CORE = "src/lib/inventory/receiving-classification-core.ts"


def patch(path: str, old: str, new: str, label: str) -> None:
    t = io.open(path, encoding="utf-8").read()
    if new in t and old not in t:
        print(f"  {label}: already applied")
        return
    n = t.count(old)
    assert n == 1, f"{label}: anchor matched {n}x (expected 1)"
    io.open(path, "w", encoding="utf-8").write(t.replace(old, new, 1))
    back = io.open(path, encoding="utf-8").read()
    assert back.count(new) == 1, f"{label}: did not land on disk"
    if old not in new:
        assert old not in back, f"{label}: old text survived"
    print(f"  {label}: applied")


# ---- 1. the assessment type gains the weight fact ---------------------------
patch(
    CORE,
    """export type ReceivingVolumeAssessment = {
  /** True when this shelf's limit is measured in millilitres. */
  isVolumeMeteredShelf: boolean;
  /** The volume L3 already derived, in ml. Null = nothing was derivable. */
  derivedVolumeMl: number | null;
  /**
   * True when a human MUST supply a measured volume before this lot can be
   * onboarded: a volume-metered shelf with no derivable volume.
   */
  needsVolumePick: boolean;
};""",
    """export type ReceivingVolumeAssessment = {
  /** True when this shelf's limit is measured in millilitres. */
  isVolumeMeteredShelf: boolean;
  /** The volume L3 already derived, in ml. Null = nothing was derivable. */
  derivedVolumeMl: number | null;
  /**
   * SLICE T1 — the net weight L3 already derived, in grams. Null = nothing was
   * derivable.
   *
   * This exists because the liquid bucket is metered in ml but is NOT only
   * drinks. WAC 314-55-095(1)(d)(i)(E) puts product "applied topically to the
   * skin" in the SAME 72 ounce clause as oral liquids, so a balm shares the
   * bucket with a bottle — and a balm tin states grams or weight-ounces, never
   * millilitres.
   */
  derivedWeightGrams: number | null;
  /**
   * SLICE T1 — true when the line is already measurable WITHOUT asking anyone:
   * a derivable volume, or (on a weight-labelled shelf) a derivable weight.
   */
  hasUsableMeasure: boolean;
  /**
   * True when a human MUST supply a measured volume before this lot can be
   * onboarded: a volume-metered shelf with NO usable measure of any kind.
   */
  needsVolumePick: boolean;
};""",
    "assessment type",
)

# ---- 2. the assessment itself ----------------------------------------------
patch(
    CORE,
    """export function assessReceivingVolume(input: {
  resolvedWebsiteCategory: string | null;
  derivedVolumeMl?: number | null;
}): ReceivingVolumeAssessment {
  const resolved = input.resolvedWebsiteCategory?.trim() || null;
  const isVolumeMeteredShelf = categoryToBucket(resolved) === "liquid_edible";
  // A volume is only a volume if it is a usable positive number. 0, NaN and
  // Infinity are "unknown" wearing a number's clothes, and treating any of
  // them as measured is how an unmeasured bottle would slip through the gate.
  const raw = input.derivedVolumeMl;
  const derivedVolumeMl =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  return {
    isVolumeMeteredShelf,
    derivedVolumeMl,
    needsVolumePick: isVolumeMeteredShelf && derivedVolumeMl === null,
  };
}""",
    """export function assessReceivingVolume(input: {
  resolvedWebsiteCategory: string | null;
  derivedVolumeMl?: number | null;
  derivedWeightGrams?: number | null;
}): ReceivingVolumeAssessment {
  const resolved = input.resolvedWebsiteCategory?.trim() || null;
  const isVolumeMeteredShelf = categoryToBucket(resolved) === "liquid_edible";
  // A measure is only a measure if it is a usable positive number. 0, NaN and
  // Infinity are "unknown" wearing a number's clothes, and treating any of
  // them as measured is how an unmeasured bottle would slip through the gate.
  const raw = input.derivedVolumeMl;
  const derivedVolumeMl =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
  const rawG = input.derivedWeightGrams;
  const derivedWeightGrams =
    typeof rawG === "number" && Number.isFinite(rawG) && rawG > 0 ? rawG : null;

  // SLICE T1 — WHY A WEIGHT COUNTS AS AN ANSWER HERE.
  //
  // L5 shipped a gate that fired on any liquid-bucket shelf with no derivable
  // VOLUME. `topical` is in that bucket (the statute puts salves in the same
  // 72 ounce clause as drinks), but a balm tin is labelled "2oz" or "30g" and
  // never in millilitres. So the gate asked for a number the package does not
  // carry, and REFUSED every weight-labelled salve — measured against real
  // products: Fairwinds Flow Cream 2oz, Ceres Balm 1.7oz and Green Revolution
  // Salve 30g were all unonboardable, each with its weight plainly known.
  //
  // A weight is not a second-best guess here, it is an EXACT measure: lineMl()
  // carries an ounce-count across as an ounce-count (grams / 28 * 29.5735), so
  // a 2 oz salve meters at exactly 36 units against the 72 oz cap, the same
  // count it had before the bucket was ever expressed in ml. NO DENSITY IS
  // ASSUMED — that ratio is the statutory ounce equivalence, not a physical
  // property of the product. Verified: 1oz->72, 1.7oz->42, 2oz->36, 4oz->18,
  // 8oz->9.
  //
  // Asking anyway would be worse than useless. The honest answer to "how many
  // ml is this balm?" is unknowable without a density, so the receiver would
  // have to invent one to get past the gate — and an invented number is
  // exactly what every other rule in this file exists to prevent.
  const hasUsableMeasure = derivedVolumeMl !== null || derivedWeightGrams !== null;

  return {
    isVolumeMeteredShelf,
    derivedVolumeMl,
    derivedWeightGrams,
    hasUsableMeasure,
    needsVolumePick: isVolumeMeteredShelf && !hasUsableMeasure,
  };
}""",
    "assessReceivingVolume",
)

print("T1 core: done")
sys.exit(0)
