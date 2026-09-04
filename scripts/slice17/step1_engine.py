#!/usr/bin/env python3
"""SLICE 17 step 1 — the sixth bucket in the pure engine.

Verified-anchor discipline: every anchor must match EXACTLY once. Nothing is
written unless ALL anchors match. Source uses literal UTF-8 em dashes.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if not (ROOT / "package.json").is_file():
    raise SystemExit(f"repo root wrong: {ROOT}")

CORE = ROOT / "src/lib/compliance/sales-limits-core.ts"

EDITS: list[tuple[str, str]] = []


def edit(find: str, replace: str) -> None:
    EDITS.append((find, replace))


# ---------------------------------------------------------------- header ----
edit(
    """ *   - liquid_edible   : 72 ounces liquid infused           = 2016 g  (72 × 28, ≈ ml)
 *   - low_thc_liquid  : 200 MILLIGRAMS of active delta-9 THC  — SLICE 16
 *""",
    """ *   - liquid_edible   : 72 ounces liquid infused           = 2016 g  (72 × 28, ≈ ml)
 *   - low_thc_liquid  : 200 MILLIGRAMS of active delta-9 THC  — SLICE 16
 *   - otherwise_taken : 10 UNITS (a COUNT OF ITEMS)           — SLICE 17
 *""",
)

edit(
    """ * Medical patients in the DOH database get the higher maximums:
 *   3 oz usable, 48 oz solid, 21 g concentrate, 216 oz liquid — but the
 *   low_thc_liquid cap stays 200 mg (it does NOT scale; see MEDICAL_LIMITS).
 *""",
    """ * Medical patients in the DOH database get the higher maximums:
 *   3 oz usable, 48 oz solid, 21 g concentrate, 216 oz liquid — but the
 *   low_thc_liquid cap stays 200 mg (it does NOT scale; see MEDICAL_LIMITS),
 *   and the otherwise_taken cap stays 10 units for the same kind of reason:
 *   WAC 314-55-095(2)(d) simply does not list the category. See SLICE 17.
 *
 * ── SLICE 17: THE "OTHERWISE TAKEN INTO THE BODY" BUCKET ────────────────────
 * WAC 314-55-095(1)(d)(i)(D), verbatim:
 *   (D) Ten units of a cannabis-infused product otherwise taken into the body;
 *
 * WAC 314-55-010(40) defines the category, verbatim:
 *   "Product(s) otherwise taken into the body" means a cannabis-infused product
 *   for human consumption or ingestion intended for uses other than inhalation,
 *   oral ingestion, or external application to the skin.
 *
 * Three exclusions — inhaled, swallowed, rubbed on skin. What remains, among
 * products a Washington retailer can actually stock, is the SUPPOSITORY.
 * Transdermal patches are EXCLUDED (skin). Sublingual tinctures are EXCLUDED
 * (oral ingestion). Both are routinely mis-filed here; they must not be.
 *
 * THIS IS THE ONLY BUCKET THAT COUNTS ITEMS. Not grams, not milligrams of THC
 * — a count of individual consumable items. RCW 69.50.101: "'Unit' means an
 * individual consumable item within a package of one or more consumable items";
 * "'Package' means a container that has a single unit or group of units." So a
 * box of six suppositories is ONE package of SIX units and consumes six of the
 * ten. It is not one unit merely because it is one box.
 *
 * MEDICAL DOES NOT INCREASE. WAC 314-55-095(2)(d) enumerates five categories
 * (usable, solid, concentrate, liquid, low-THC liquid) and this is not among
 * them. The rule grants no enhancement, so we do not invent one. Tripling by
 * analogy would authorize a sale the rule nowhere permits — the one direction
 * that creates real exposure. Declining can only under-sell, which is
 * recoverable and explainable. Do NOT "fix" this to 30.
 *
 * FAIL-SAFE RUNS THE OPPOSITE WAY HERE — READ THIS BEFORE CHANGING ANYTHING.
 * For low_thc_liquid, an unflagged product falls back to the 72 oz bucket,
 * which is STRICTER for a bulky low-dose drink. Falling back is safe.
 * For otherwise_taken the arithmetic inverts: an unflagged suppository falls
 * into liquid_edible, where a few grams against a 2016 g cap is effectively
 * unlimited. Falling back is the PERMISSIVE direction. That is why this slice
 * ships suspectsOtherwiseTaken() and emits a WARNING on an unclassified
 * suspicious line, instead of trusting a silent default the way SLICE 16 could.
 *""",
)

# ------------------------------------------------------------ bucket list ---
edit(
    """/** The five statutory limit buckets (SLICE 16 added low_thc_liquid). */""",
    """/** The six statutory limit buckets (16 added low_thc_liquid, 17 otherwise_taken). */""",
)

edit(
    """  | \"liquid_edible\"
  | \"low_thc_liquid\";""",
    """  | \"liquid_edible\"
  | \"low_thc_liquid\"
  | \"otherwise_taken\";""",
)

edit(
    """  \"liquid_edible\",
  \"low_thc_liquid\",
] as const;""",
    """  \"liquid_edible\",
  \"low_thc_liquid\",
  \"otherwise_taken\",
] as const;""",
)

edit(
    """  low_thc_liquid: \"Low-THC beverages (\\u2264 4 mg THC per unit)\",
};""",
    """  low_thc_liquid: \"Low-THC beverages (\\u2264 4 mg THC per unit)\",
  otherwise_taken: \"Products otherwise taken into the body (suppositories)\",
};""",
)

# ------------------------------------------------------------- unit type ----
edit(
    """export type LimitUnit = \"g\" | \"mg_thc\";

export const LIMIT_BUCKET_UNITS: Record<LimitBucket, LimitUnit> = {
  usable: \"g\",
  solid_edible: \"g\",
  concentrate: \"g\",
  liquid_edible: \"g\",
  low_thc_liquid: \"mg_thc\",
};

/** True when the bucket is measured in mg of THC rather than grams of product. */
export function isThcBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === \"mg_thc\";
}""",
    """export type LimitUnit = \"g\" | \"mg_thc\" | \"units\";

export const LIMIT_BUCKET_UNITS: Record<LimitBucket, LimitUnit> = {
  usable: \"g\",
  solid_edible: \"g\",
  concentrate: \"g\",
  liquid_edible: \"g\",
  low_thc_liquid: \"mg_thc\",
  // SLICE 17 — a COUNT OF ITEMS. Not convertible to grams or mg. Any formatter
  // that assumes a weight will render \"10 units\" as \"0.357 oz\", which is both
  // meaningless and dangerously wrong.
  otherwise_taken: \"units\",
};

/** True when the bucket is measured in mg of THC rather than grams of product. */
export function isThcBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === \"mg_thc\";
}

/** SLICE 17 — true when the bucket counts ITEMS rather than any measure of mass. */
export function isUnitCountBucket(bucket: LimitBucket): boolean {
  return LIMIT_BUCKET_UNITS[bucket] === \"units\";
}""",
)

# ------------------------------------------------------------- formatter ----
edit(
    """export function formatLimitAmount(bucket: LimitBucket, amount: number): string {
  if (isThcBucket(bucket)) return `${round3(amount)} mg THC`;
  if (bucket === \"concentrate\") return `${round3(amount)} g`;
  return `${gramsToOunces(amount)} oz`;
}""",
    """export function formatLimitAmount(bucket: LimitBucket, amount: number): string {
  if (isThcBucket(bucket)) return `${round3(amount)} mg THC`;
  // SLICE 17 — a count of items. Singular reads \"1 unit\", everything else
  // \"N units\". MUST come before the gramsToOunces fallthrough.
  if (isUnitCountBucket(bucket)) {
    const n = round3(amount);
    return `${n} ${n === 1 ? \"unit\" : \"units\"}`;
  }
  if (bucket === \"concentrate\") return `${round3(amount)} g`;
  return `${gramsToOunces(amount)} oz`;
}""",
)

# --------------------------------------------------------------- profile ----
edit(
    """  /** MILLIGRAMS of active delta-9 THC — NOT grams. WAC 314-55-095(1)(d)(i)(F). */
  low_thc_liquid: number;
};""",
    """  /** MILLIGRAMS of active delta-9 THC — NOT grams. WAC 314-55-095(1)(d)(i)(F). */
  low_thc_liquid: number;
  /** A COUNT OF ITEMS — not grams, not mg. WAC 314-55-095(1)(d)(i)(D). */
  otherwise_taken: number;
};""",
)

edit(
    """  low_thc_liquid: 200, // 200 mg THC — WAC 314-55-095(1)(d)(i)(F)""",
    """  low_thc_liquid: 200, // 200 mg THC — WAC 314-55-095(1)(d)(i)(F)
  otherwise_taken: 10, // 10 UNITS — WAC 314-55-095(1)(d)(i)(D)""",
)

edit(
    """  low_thc_liquid: 200, // 200 mg THC — NOT tripled. See the note above.""",
    """  low_thc_liquid: 200, // 200 mg THC — NOT tripled. See the note above.
  // SLICE 17 — 10 UNITS, NOT tripled, and for a different reason than
  // low_thc_liquid: WAC 314-55-095(2)(d) does not list this category AT ALL.
  // It enumerates usable / solid / concentrate / liquid / low-THC liquid. The
  // rule grants no medical enhancement here, so we grant none. Do NOT set 30.
  otherwise_taken: 10,""",
)

# -------------------------------------------------- qualification + units ---
edit(
    """/**
 * SLICE 16 — which bucket does this LINE actually count against?""",
    """/**
 * SLICE 17 — does this line count against the ten-unit \"otherwise taken into
 * the body\" allowance? WAC 314-55-095(1)(d)(i)(D) + WAC 314-55-010(40).
 *
 * BOTH must hold:
 *   1. the owner has EXPLICITLY flagged the product at intake, and
 *   2. the product's category is one that could plausibly be administered this
 *      way — in Greenway's taxonomy that is `topical`, which is where the CCRS
 *      \"Suppository\" end-product type already resolves.
 *
 * Requirement 2 is a guard rail, not the classification. It exists so that a
 * mis-set flag on a flower or gummy line cannot silently move that line out of
 * the bucket the statute actually assigns it to. The flag alone never decides.
 *
 * The flag must be LITERALLY `true`. A string \"true\", a 1, or any other truthy
 * value returns false — an intake bug must never widen an allowance.
 */
export function qualifiesAsOtherwiseTaken(line: LimitCartLine): boolean {
  if (line.otherwiseTaken !== true) return false;
  return categoryToBucket(line.category) === \"liquid_edible\";
}

/**
 * SLICE 17 — how many UNITS this line contributes to the ten-unit bucket.
 *
 * units = quantity × unitsPerPackage
 *
 * RCW 69.50.101 defines a \"unit\" as an individual consumable item and a
 * \"package\" as a container holding one or more units. So the sellable thing on
 * the shelf may be a package of six, and it consumes six of the ten. When
 * `unitsPerPackage` is absent the package IS the unit and the multiplier is 1.
 *
 * Both factors are floored to integers: you cannot sell a fraction of a
 * suppository, and a fractional count would make the ten-unit boundary
 * ambiguous. A zero/negative/NaN multiplier falls back to 1 rather than 0 —
 * falling back to zero would silently erase the line from the limit entirely,
 * which is the one outcome we can never allow.
 */
export function lineUnits(line: LimitCartLine): number {
  if (!qualifiesAsOtherwiseTaken(line)) return 0;
  const qtyRaw = Number.isFinite(line.quantity) ? line.quantity : 0;
  const qty = Math.max(0, Math.floor(qtyRaw));
  const perRaw = typeof line.unitsPerPackage === \"number\" ? line.unitsPerPackage : NaN;
  const per = Number.isFinite(perRaw) && perRaw >= 1 ? Math.floor(perRaw) : 1;
  return qty * per;
}

/**
 * SLICE 17 — does this product LOOK like something otherwise taken into the
 * body, judged only by its name and CCRS inventory type?
 *
 * This is a DETECTOR, never a classifier. It exists because of the inverted
 * fail-safe documented in the header: an unflagged suppository lands in the
 * 72 oz liquid bucket where it is effectively unlimited, so \"nobody classified
 * it\" must be made VISIBLE rather than silently permissive. evaluateCart turns
 * a hit on an unclassified line into a warning; it never blocks on this.
 *
 * Deliberately narrow. It matches suppository/suppositories and the two CCRS
 * spellings, and NOTHING else. It specifically must NOT match:
 *   - transdermal patches — WAC 314-55-010(40) excludes external application
 *     to the skin, so a patch belongs in the 72 oz bucket;
 *   - sublingual tinctures — 010(40) excludes oral ingestion.
 * Both are commonly assumed to belong here. They do not.
 */
export function suspectsOtherwiseTaken(input: {
  name?: string | null;
  inventoryType?: string | null;
}): boolean {
  const hay = `${input.name ?? \"\"} ${input.inventoryType ?? \"\"}`.toLowerCase();
  if (!hay.trim()) return false;
  return /suppositor(?:y|ies)|\\bsupp\\b/.test(hay);
}

/**
 * SLICE 16 — which bucket does this LINE actually count against?""",
)

edit(
    """export function lineBucket(line: LimitCartLine): LimitBucket | null {
  if (qualifiesAsLowThcLiquid(line)) return \"low_thc_liquid\";
  return categoryToBucket(line.category);
}""",
    """export function lineBucket(line: LimitCartLine): LimitBucket | null {
  // SLICE 17 first: a flagged suppository leaves liquid_edible entirely.
  // Checked BEFORE the low-THC carve-out because the two flags are about
  // different products and a line carrying both is a data error; routing it to
  // the ITEM-COUNTED bucket is the conservative resolution (ten units is a far
  // tighter cap than 200 mg of THC).
  if (qualifiesAsOtherwiseTaken(line)) return \"otherwise_taken\";
  if (qualifiesAsLowThcLiquid(line)) return \"low_thc_liquid\";
  return categoryToBucket(line.category);
}""",
)

# ------------------------------------------------------------- cart line ----
edit(
    """  unitThcMg?: number | null;
};

export type BucketUsage = {""",
    """  unitThcMg?: number | null;
  /**
   * SLICE 17 — WAC 314-55-095(1)(d)(i)(D). True when this product is
   * administered by a route that is not inhalation, not oral ingestion, and not
   * external application to the skin — in practice, a suppository.
   *
   * Explicit, set at intake. Absent/null/false → the product stays in whatever
   * bucket its category assigns. NOTE that unlike the low-THC flag, falling
   * back here is the PERMISSIVE direction, which is why `name` below exists.
   */
  otherwiseTaken?: boolean | null;
  /**
   * SLICE 17 — how many individual consumable items are inside ONE sellable
   * package (RCW 69.50.101). A box of six suppositories is 6. Absent → 1.
   */
  unitsPerPackage?: number | null;
  /**
   * SLICE 17 — product name, read ONLY by suspectsOtherwiseTaken() to warn
   * about an unclassified suppository. Never used to block and never used to
   * decide a bucket. Optional; absence simply means no warning is possible.
   */
  name?: string | null;
  /** SLICE 17 — CCRS inventory type, same warning-only purpose as `name`. */
  inventoryType?: string | null;
};

export type BucketUsage = {""",
)

# ------------------------------------------------------------ evaluation ----
edit(
    """    liquid_edible: 0,
    low_thc_liquid: 0,
  };
  let untrackedLines = 0;""",
    """    liquid_edible: 0,
    low_thc_liquid: 0,
    otherwise_taken: 0,
  };
  let untrackedLines = 0;
  // SLICE 17 — lines that look like a suppository but were never classified.
  const unclassifiedSuspects: string[] = [];""",
)

edit(
    """    const contribution = bucket === \"low_thc_liquid\" ? lineThcMg(line) : lineGrams(line, overrides);
    totals[bucket] = round3(totals[bucket] + contribution);
  }""",
    """    const contribution =
      bucket === \"low_thc_liquid\"
        ? lineThcMg(line)
        : bucket === \"otherwise_taken\"
          ? lineUnits(line)
          : lineGrams(line, overrides);
    totals[bucket] = round3(totals[bucket] + contribution);

    // SLICE 17 — the inverted fail-safe. A line that LOOKS like a suppository
    // but carries no classification at all (null/undefined — NOT an explicit
    // false, which means a human already answered the question) is surfaced as
    // a warning. It is not blocked: a name regex is evidence, not a fact.
    if (
      line.otherwiseTaken === undefined ||
      line.otherwiseTaken === null
    ) {
      if (suspectsOtherwiseTaken({ name: line.name, inventoryType: line.inventoryType })) {
        unclassifiedSuspects.push((line.name ?? \"unnamed product\").trim());
      }
    }
  }""",
)

edit(
    """  const exceeded = buckets.filter((b) => b.exceeded);""",
    """  // SLICE 17 — warn (never block) about unclassified suppository suspects.
  const warnings: string[] = unclassifiedSuspects.map(
    (n) =>
      `\"${n}\" looks like a suppository but has not been classified. Products otherwise taken ` +
      `into the body are limited to ${formatLimitAmount(\"otherwise_taken\", RECREATIONAL_LIMITS.otherwise_taken)} ` +
      `per transaction (WAC 314-55-095(1)(d)(i)(D)). Until it is classified it counts toward the ` +
      `liquid allowance instead. Classify it on the menu-import facts screen.`,
  );

  const exceeded = buckets.filter((b) => b.exceeded);""",
)

BUFFER: list[tuple[Path, str]] = []
text = CORE.read_text(encoding="utf-8")
for find, replace in EDITS:
    n = text.count(find)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL ({n}x): {find[:90]!r}")
    text = text.replace(find, replace)
BUFFER.append((CORE, text))

for path, out in BUFFER:
    path.write_text(out, encoding="utf-8")
print(f"OK: {len(EDITS)} anchors applied to {CORE.name}")
