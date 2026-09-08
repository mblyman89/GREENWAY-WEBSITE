/**
 * src/lib/inventory/receiving-classification-core.ts  (SLICE 18-0)
 *
 * THE COMPLIANCE CLASSIFICATION GATE FOR GOODS THAT ARRIVE BY RECEIVING.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * SLICE 16 and SLICE 17 added two per-product compliance flags that change
 * which statutory bucket a sale counts against:
 *
 *   low_thc_liquid  — WAC 314-55-095(1)(d)(i)(E)+(F), the 200 mg carve-out
 *   otherwise_taken — WAC 314-55-095(1)(d)(i)(D), the ten-UNIT allowance
 *
 * Both were wired into FACT REVIEW, which is the screen that reviews the
 * one-time Cultivera import. Fact review is scoped to an `import_id`
 * (fact-review-store.ts keys every read and write on it, and upserts on
 * `import_id,source_item_id`). A lot that arrives on a vendor manifest has a
 * MANIFEST id and no import id, so it can never appear on that screen — not as
 * a bug, but by construction.
 *
 * After the Cultivera cutover every product enters through receiving. So the
 * only classification step in the building was permanently unreachable for
 * every future product. This module is the step that replaces it.
 *
 * WHY THIS IS URGENT RATHER THAN TIDY
 * -----------------------------------
 * Migration 0217 spells out the asymmetry in capitals, and it is the reason
 * this gate blocks rather than nags:
 *
 *   An unflagged suppository is categorised `topical`. `topical` maps to the
 *   liquid_edible bucket. That bucket is 2016 g. A box of suppositories
 *   weighs almost nothing against 2016 g, so the product is effectively
 *   UNLIMITED and the ten-unit maximum never engages.
 *
 * Silence therefore does not fail closed. Silence disables a statutory limit.
 * That is the one thing an unattended default must never be allowed to do.
 *
 * WHY THE GATE IS TARGETED AND NOT UNIVERSAL
 * ------------------------------------------
 * Owner decision, verbatim: *"I like your recommendation about the targeted
 * gate, let's build it that way please."*
 *
 * `qualifiesAsOtherwiseTaken()` refuses to move any line out of its statutory
 * bucket unless the category already maps to liquid_edible. So on a flower or
 * cartridge lot the answer to "is this taken into the body another way?" cannot
 * change any limit, in either direction, ever. Asking anyway would train staff
 * to click through a compliance question during every single delivery — which
 * is precisely how a gate stops working. The gate fires only where an answer
 * could matter:
 *
 *   REQUIRED when the resolved website category maps to liquid_edible
 *             (edible-liquid, tincture, topical)
 *          or when suspectsOtherwiseTaken() fires on the name / CCRS type
 *   otherwise NOT required, and machine-defaulted to "no"
 *
 * The detector clause is what catches a MIS-CATEGORISED suppository, which is
 * the exact failure the limit exists to prevent. Without it the gate could be
 * evaded by putting a suppository on the wrong shelf.
 *
 * THE ASYMMETRY BETWEEN THE TWO FLAGS IS DELIBERATE
 * -------------------------------------------------
 * otherwise_taken is GATED. low_thc_liquid is only PROMPTED. This is not an
 * unfinished job:
 *
 *   otherwise_taken fails PERMISSIVELY — an unanswered suppository is
 *     effectively unlimited. Worst case: an unlawful over-sale. Blocking a
 *     human is proportionate to that.
 *
 *   low_thc_liquid fails CONSERVATIVELY — an unanswered beverage stays in the
 *     2016 g liquid bucket, which for a bulky low-dose drink is TIGHTER than
 *     the 200 mg carve-out (see qualifiesAsLowThcLiquid's own comment). Worst
 *     case: a lawful sale we declined to make. Blocking a delivery over that
 *     would be disproportionate.
 *
 * A test in tests/compliance/otherwise-taken-receiving.test.ts states this
 * reasoning so the asymmetry can never be mistaken for an oversight.
 *
 * PROVENANCE HONESTY
 * ------------------
 * When the gate does not ask, the stored value is a MACHINE decision. It is
 * recorded as such, never as a human-looking `false` that nobody asserted.
 * The store already carries `fact_provenance` (migration 0138) for exactly
 * this reason, and the unclassified worklist planned for 18A depends on being
 * able to tell "a person said no" apart from "nobody was asked".
 *
 * PURE: no I/O, no React, no server-only imports. The ONLY import is the
 * compliance core, which is itself pure (its only import is grams-per-ounce).
 * The detector and the mg ceiling are taken from there rather than re-declared,
 * so there is exactly ONE definition of each in the codebase.
 */
import {
  categoryToBucket,
  suspectsOtherwiseTaken,
  LOW_THC_UNIT_MAX_MG,
} from "@/lib/compliance/sales-limits-core";
// SLICE L5 — the volume gate reuses the SAME unit conversions the sales-limit
// engine measures against, so a receiver's answer and the register's cap can
// never be denominated differently. toMl() is the only conversion in the
// building; nothing here re-declares 29.5735.
import { toMl, type VolumeUnit } from "@/lib/compliance/liquid-volume-core";

/**
 * How a stored classification value came to exist. Mirrors the vocabulary
 * already used by `fact_provenance` on menu_items / inventory_lots (0138).
 */
export const RECEIVING_CLASSIFICATION_PROVENANCE = {
  /** A person was asked and answered. */
  human: "human",
  /** Nobody was asked; the machine applied the safe default. */
  machine: "machine_default",
  /** Nobody was asked and no default is safe to invent — the value stays null. */
  unanswered: "unanswered",
} as const;

export type ReceivingClassificationProvenance =
  (typeof RECEIVING_CLASSIFICATION_PROVENANCE)[keyof typeof RECEIVING_CLASSIFICATION_PROVENANCE];

export type ReceivingClassificationAssessment = {
  /** The resolver's website category (null = unmapped). */
  resolvedWebsiteCategory: string | null;
  /** True when the category maps to the liquid_edible bucket. */
  isLiquidShelf: boolean;
  /** True when suspectsOtherwiseTaken() fired on the name / CCRS type. */
  suspected: boolean;
  /**
   * True when approval MUST carry an explicit yes/no. Fires on the liquid
   * shelves (where the answer changes a bucket) and on a detector hit (where a
   * mis-categorised suppository would otherwise slip past the shelf test).
   */
  needsOtherwiseTakenPick: boolean;
  /**
   * True when the low-THC question should be SHOWN. Never required — see the
   * asymmetry note in the file header. Deliberately named `prompts…` rather
   * than `needs…` so the difference is visible at every call site.
   */
  promptsLowThcLiquid: boolean;
};

/**
 * Decide what a human must answer before this received lot can be onboarded.
 * The website-category resolver runs server-side (it needs the database), so
 * its verdict is passed in and this stays pure — the same shape SLICE 64's
 * assessDraftClassification() uses.
 */
export function assessReceivingClassification(input: {
  productName?: string | null;
  inventoryType?: string | null;
  resolvedWebsiteCategory: string | null;
}): ReceivingClassificationAssessment {
  const resolved = input.resolvedWebsiteCategory?.trim() || null;
  const isLiquidShelf = categoryToBucket(resolved) === "liquid_edible";
  const suspected = suspectsOtherwiseTaken({
    name: input.productName ?? null,
    inventoryType: input.inventoryType ?? null,
  });
  return {
    resolvedWebsiteCategory: resolved,
    isLiquidShelf,
    suspected,
    needsOtherwiseTakenPick: isLiquidShelf || suspected,
    // Only the shelf drives this one: a suspected suppository on a solid-edible
    // shelf is not a beverage question, and asking would be noise.
    promptsLowThcLiquid: isLiquidShelf,
  };
}

/**
 * SLICE L5 — THE RECEIVING VOLUME GATE.
 *
 * WHY A THIRD GATE, AND WHY IT BLOCKS
 * -----------------------------------
 * SLICE L3 already derives a package volume from the product name at receiving
 * (draft-injection-core.ts) and writes `net_volume_ml`. When that derivation
 * finds nothing it pushes a `net_volume_missing` diagnostic at severity
 * "warning" — and nothing in the building gates on it. Verified by grepping
 * every caller before this was written.
 *
 * So an unmeasured liquid onboards anyway. The limit engine then has no volume
 * to measure, falls back to DEFAULT_UNIT_GRAMS["edible-liquid"] = 28 g, and
 * EXACTLY 72 packages of any size fit the 72 fl oz cap — a 1.5 L bottle counts
 * the same as a 30 ml tincture. That is the owner's original bug, arriving
 * through the door that every future product now uses.
 *
 * Silence therefore does not fail closed. Silence DISABLES a statutory limit.
 * That is the same test migration 0217 applied to otherwise_taken, and it is
 * why this gate BLOCKS rather than prompts — while `promptsLowThcLiquid`, whose
 * silence only ever costs us a lawful sale, still merely asks. The asymmetry is
 * applied consistently, not case by case.
 *
 * WHY IT IS NARROW
 * ----------------
 * It fires ONLY when the shelf is metered by volume AND no volume was derived.
 * A liquid whose name already stated its size is not re-asked; neither is any
 * non-liquid shelf, where the answer could not change a limit in either
 * direction. Gates that ask when the answer cannot matter are the gates staff
 * learn to click through.
 */
export type ReceivingVolumeAssessment = {
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
};

/**
 * Decide whether a received lot must be measured before it can be onboarded.
 *
 * Pure, and deliberately given the ALREADY-DERIVED volume rather than deriving
 * one itself — L3 owns that derivation, and two derivations that could drift
 * apart is precisely the failure this codebase keeps designing out.
 */
export function assessReceivingVolume(input: {
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
}

export type ReceivingVolumeChoiceResult =
  | {
      ok: true;
      /** Millilitres in ONE package. Null only when the gate did not fire. */
      netVolumeMl: number | null;
      /** How the value came to exist, for `fact_provenance.net_volume_ml`. */
      provenance: ReceivingClassificationProvenance;
    }
  | {
      ok: false;
      code:
        | "volume_required"
        | "volume_invalid"
        | "volume_unit_required"
        | "volume_unit_ambiguous";
      error: string;
    };

/**
 * Validate the receiver's measured volume.
 *
 * REFUSES rather than coerces, every time. Each rejection below is a way a
 * receiver could otherwise have silently disabled or mis-scaled the 72 fl oz
 * cap: a blank that defaults to "unlimited", a typo that parses as a number, a
 * bare "oz" that is a fluid ounce on a soda and a weight ounce on a salve.
 *
 * The bare-ounce refusal is the one worth stating plainly: this module does not
 * know a liquid's density and will not invent one, so it asks the receiver to
 * say which ounce they mean instead of guessing and being wrong by ~4%.
 */
export function validateReceivingVolumeChoice(input: {
  assessment: Pick<ReceivingVolumeAssessment, "needsVolumePick">;
  volumeQuantity?: string | null;
  volumeUnit?: string | null;
}): ReceivingVolumeChoiceResult {
  const qtyRaw = raw(input.volumeQuantity);
  const unitRaw = raw(input.volumeUnit).toLowerCase();

  // The gate did not fire: nothing to store, and no answer is invented.
  if (!input.assessment.needsVolumePick) {
    if (qtyRaw === "" && unitRaw === "") {
      return {
        ok: true,
        netVolumeMl: null,
        provenance: RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
      };
    }
    // A volunteered measurement is still a human assertion and is kept — but it
    // must survive exactly the same validation as a required one.
  } else if (qtyRaw === "" || unitRaw === "") {
    return {
      ok: false,
      code: "volume_required",
      error:
        "This liquid has no package volume, so the 72 fluid ounce limit cannot be measured. " +
        "Enter the volume printed on the package (and its unit) before onboarding it.",
    };
  }

  if (qtyRaw === "" && unitRaw === "") {
    return {
      ok: true,
      netVolumeMl: null,
      provenance: RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
    };
  }

  if (unitRaw === "") {
    return {
      ok: false,
      code: "volume_unit_required",
      error: "Pick the unit the volume is measured in (ml, L, or fl oz).",
    };
  }

  // A bare ounce is genuinely ambiguous on a liquid shelf; refuse it by name so
  // the receiver knows WHY, rather than seeing a generic validation error.
  if (unitRaw === "oz" || unitRaw === "ounce" || unitRaw === "ounces") {
    return {
      ok: false,
      code: "volume_unit_ambiguous",
      error:
        'A bare "oz" is ambiguous on a liquid — it is a FLUID ounce on a drink and a ' +
        "WEIGHT ounce on a salve, and the two are not the same amount. Pick fl oz for a " +
        "fluid ounce, or enter the volume in ml.",
    };
  }

  const unit: VolumeUnit | null =
    unitRaw === "ml"
      ? "ml"
      : unitRaw === "l"
        ? "l"
        : unitRaw === "floz" || unitRaw === "fl oz"
          ? "floz"
          : null;
  if (unit === null) {
    return {
      ok: false,
      code: "volume_unit_required",
      error: "Unit must be ml, L, or fl oz.",
    };
  }

  // Number() would read "" as 0 and " 12 " as 12; neither is a measurement a
  // person typed on purpose, so the shape is checked before the value.
  if (!/^\d+(\.\d+)?$/.test(qtyRaw)) {
    return {
      ok: false,
      code: "volume_invalid",
      error: "Volume must be a positive number, for example 750 or 1.5.",
    };
  }
  const qty = Number(qtyRaw);
  // toMl() itself refuses <= 0 and non-finite values, so this delegates rather
  // than re-implementing the rule in a second place that could drift.
  const ml = toMl(qty, unit);
  if (ml === null) {
    return {
      ok: false,
      code: "volume_invalid",
      error: "Volume must be a positive number, for example 750 or 1.5.",
    };
  }

  return {
    ok: true,
    netVolumeMl: ml,
    provenance: RECEIVING_CLASSIFICATION_PROVENANCE.human,
  };
}

/**
 * Label for the volume field. States what leaving it alone MEANS (the SLICE 91
 * rule): when the gate fires there is no safe default to fall back to, and the
 * label has to say so rather than imply an answer.
 */
export function volumePickerPlaceholder(input: { needsVolumePick: boolean }): string {
  if (input.needsVolumePick) return "Measure the package \u2014 required";
  return "Volume already known";
}

export type ReceivingClassificationChoiceResult =
  | {
      ok: true;
      /** Explicit true/false. Never null: an ungated line is machine-defaulted. */
      otherwiseTaken: boolean;
      /** Units inside one sellable package (RCW 69.50.101). Null = not stated. */
      unitsPerPackage: number | null;
      /** Null when nobody answered — we never invent a beverage classification. */
      lowThcLiquid: boolean | null;
      /** mg of active delta-9 THC in ONE SEALED CONTAINER. Null = not stated. */
      unitThcMg: number | null;
      /** How each value came to exist. Written alongside the values. */
      provenance: {
        otherwiseTaken: ReceivingClassificationProvenance;
        lowThcLiquid: ReceivingClassificationProvenance;
      };
    }
  | {
      ok: false;
      code:
        | "otherwise_taken_required"
        | "otherwise_taken_invalid"
        | "units_per_package_required"
        | "units_per_package_invalid"
        | "low_thc_required"
        | "low_thc_invalid"
        | "mutually_exclusive";
      error: string;
    };

/** Normalize a raw form value to a trimmed string, treating whitespace as absent. */
function raw(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * Validate the onboarding form's compliance picks against the assessment.
 *
 * NEVER trusts the form: the assessment is re-derived server-side by the
 * caller, values must be exactly "yes" / "no" / absent, and every number is
 * REFUSED rather than coerced. Refusing is the whole design — each rejection
 * below is a way a receiver could otherwise have silently disabled, or
 * silently mis-scaled, a statutory limit.
 *
 * Kept deliberately parallel to parseOtherwiseTakenClassification() and
 * parseLowThcClassification() in fact-review-core, because the two doors into
 * this store must agree exactly; tests/compliance/receiving-classification-
 * parity.test.ts pins that agreement.
 */
export function validateReceivingClassificationChoice(input: {
  assessment: Pick<
    ReceivingClassificationAssessment,
    "needsOtherwiseTakenPick" | "promptsLowThcLiquid"
  >;
  otherwiseTaken?: string | null;
  unitsPerPackage?: string | null;
  lowThcLiquid?: string | null;
  unitThcMg?: string | null;
}): ReceivingClassificationChoiceResult {
  const otFlag = raw(input.otherwiseTaken);
  const countRaw = raw(input.unitsPerPackage);
  const lowFlag = raw(input.lowThcLiquid);
  const mgRaw = raw(input.unitThcMg);

  if (otFlag !== "" && otFlag !== "yes" && otFlag !== "no") {
    return {
      ok: false,
      code: "otherwise_taken_invalid",
      error: "Otherwise taken into the body must be yes, no, or left blank.",
    };
  }
  if (lowFlag !== "" && lowFlag !== "yes" && lowFlag !== "no") {
    return {
      ok: false,
      code: "low_thc_invalid",
      error: "Low-THC beverage must be yes, no, or left blank.",
    };
  }

  // ------------------------------------------------------------- the gate --
  if (input.assessment.needsOtherwiseTakenPick && otFlag === "") {
    return {
      ok: false,
      code: "otherwise_taken_required",
      error:
        "Tell us whether this product is taken into the body another way (a suppository). " +
        "We have to ask because an unanswered suppository is filed as an ordinary topical, " +
        "where the ten-unit limit never applies — answer no and it stays a normal topical.",
    };
  }

  // ------------------------------------------------------ units per package --
  let unitsPerPackage: number | null = null;
  if (countRaw !== "") {
    const n = Number(countRaw);
    if (!Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        code: "units_per_package_invalid",
        error: `"${countRaw}" is not a valid units-per-package count.`,
      };
    }
    if (!Number.isInteger(n)) {
      return {
        ok: false,
        code: "units_per_package_invalid",
        error:
          `Units per package must be a whole number — "${countRaw}" is not. A unit is ` +
          `"an individual consumable item" (RCW 69.50.101); half an item is not a unit.`,
      };
    }
    unitsPerPackage = n;
  }

  if (otFlag === "yes" && unitsPerPackage === null) {
    // Without the count we would store the flag and multiply by the default of
    // 1, counting a box of six as ONE unit — a 6x under-count of a statutory
    // maximum, which is worse than not classifying at all.
    return {
      ok: false,
      code: "units_per_package_required",
      error:
        "To flag a product as otherwise taken into the body you must also enter how many " +
        "individual units are in one package (a box of six suppositories is 6).",
    };
  }

  // ------------------------------------------------------------- low-THC --
  let unitThcMg: number | null = null;
  if (mgRaw !== "") {
    const mg = Number(mgRaw);
    if (!Number.isFinite(mg) || mg <= 0) {
      return {
        ok: false,
        code: "low_thc_invalid",
        error: `"${mgRaw}" is not a valid THC-per-container figure.`,
      };
    }
    unitThcMg = mg;
  }

  let lowThcLiquid: boolean | null = null;
  if (lowFlag === "yes") {
    if (unitThcMg === null) {
      return {
        ok: false,
        code: "low_thc_required",
        error:
          "To flag a low-THC beverage you must also enter the THC milligrams in ONE SEALED CONTAINER.",
      };
    }
    if (unitThcMg > LOW_THC_UNIT_MAX_MG) {
      return {
        ok: false,
        code: "low_thc_invalid",
        error:
          `${unitThcMg} mg per container is above the ${LOW_THC_UNIT_MAX_MG} mg limit, so this product does NOT ` +
          `qualify for the low-THC beverage allowance. Enter the milligrams in the whole sealed ` +
          `container, not one serving — a 16 mg bottle labelled "4 servings x 4 mg" is 16 mg and ` +
          `stays under the regular 72 oz liquid limit.`,
      };
    }
    lowThcLiquid = true;
  } else if (lowFlag === "no") {
    lowThcLiquid = false;
  }

  // ------------------------------------------------------ mutual exclusion --
  // lineBucket() checks otherwise_taken FIRST, so a product flagged both ways
  // would silently contribute nothing to the low-THC bucket and the receiver's
  // second answer would vanish. Refusing is honest; discarding an answer a
  // human actually gave is not.
  if (otFlag === "yes" && lowThcLiquid === true) {
    return {
      ok: false,
      code: "mutually_exclusive",
      error:
        "A product cannot be both a low-THC beverage and taken into the body another way — " +
        "those are two different limits and a product counts against exactly one. Pick the one " +
        "that describes how it is used.",
    };
  }

  // ------------------------------------------------------------ provenance --
  const otherwiseTaken = otFlag === "yes";
  return {
    ok: true,
    otherwiseTaken,
    unitsPerPackage,
    lowThcLiquid,
    unitThcMg,
    provenance: {
      // "no" is a human assertion just as much as "yes" is. Only the untouched
      // ungated case is the machine's own doing.
      otherwiseTaken:
        otFlag === ""
          ? RECEIVING_CLASSIFICATION_PROVENANCE.machine
          : RECEIVING_CLASSIFICATION_PROVENANCE.human,
      lowThcLiquid:
        lowFlag === ""
          ? RECEIVING_CLASSIFICATION_PROVENANCE.unanswered
          : RECEIVING_CLASSIFICATION_PROVENANCE.human,
    },
  };
}

/**
 * Label for the otherwise-taken picker's empty option. It must tell the truth
 * about what leaving it alone MEANS — the SLICE 91 rule. When an answer is
 * required the empty option cannot be a silent default; when it is not
 * required, the label states the assumption the machine is about to make.
 */
export function otherwiseTakenPickerPlaceholder(input: {
  needsOtherwiseTakenPick: boolean;
}): string {
  if (input.needsOtherwiseTakenPick) return "Pick yes or no\u2026";
  return "No \u2014 ordinary product";
}

/** Label for the low-THC picker's empty option (never a required pick). */
export function lowThcPickerPlaceholder(): string {
  return "Not a low-THC beverage";
}

// ---------------------------------------------------------------------------
// Embedded self-tests (house pattern; run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runReceivingClassificationTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL receiving-classification-core: " + msg);
    passed += 1;
  };

  // ── SLICE L5: the receiving VOLUME gate ─────────────────────────────────
  // Fires only where an answer can change a limit.
  ok(
    assessReceivingVolume({ resolvedWebsiteCategory: "edible-liquid", derivedVolumeMl: null })
      .needsVolumePick,
    "an unmeasured liquid MUST be measured before onboarding",
  );
  ok(
    assessReceivingVolume({ resolvedWebsiteCategory: "tincture", derivedVolumeMl: null })
      .needsVolumePick,
    "tinctures are metered by volume too",
  );
  ok(
    !assessReceivingVolume({ resolvedWebsiteCategory: "edible-liquid", derivedVolumeMl: 750 })
      .needsVolumePick,
    "a liquid L3 already measured is NOT re-asked",
  );
  ok(
    !assessReceivingVolume({ resolvedWebsiteCategory: "flower", derivedVolumeMl: null })
      .needsVolumePick,
    "flower is not metered by volume, so the gate stays silent",
  );
  ok(
    !assessReceivingVolume({ resolvedWebsiteCategory: null, derivedVolumeMl: null })
      .needsVolumePick,
    "an unmapped category cannot be volume-metered",
  );
  // Zero/NaN/Infinity are "unknown" wearing a number's clothes.
  for (const junk of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    ok(
      assessReceivingVolume({ resolvedWebsiteCategory: "edible-liquid", derivedVolumeMl: junk })
        .needsVolumePick,
      `a derived volume of ${String(junk)} is NOT a measurement`,
    );
  }

  const gated = { needsVolumePick: true };
  const ungated = { needsVolumePick: false };

  // Refuses rather than coerces.
  ok(
    validateReceivingVolumeChoice({ assessment: gated }).ok === false,
    "a required volume cannot be skipped",
  );
  {
    const r = validateReceivingVolumeChoice({ assessment: gated });
    ok(!r.ok && r.code === "volume_required", "skipping is reported as volume_required");
  }
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "12",
      volumeUnit: "oz",
    });
    ok(
      !r.ok && r.code === "volume_unit_ambiguous",
      "a bare ounce is REFUSED, never guessed at a density",
    );
  }
  for (const bad of ["abc", "", "  ", "12abc", "-5", "1e3", "1,5", "."]) {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: bad,
      volumeUnit: "ml",
    });
    ok(!r.ok, `"${bad}" is refused, not coerced`);
  }
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "0",
      volumeUnit: "ml",
    });
    ok(!r.ok && r.code === "volume_invalid", "zero ml is not a volume");
  }
  // Accepts, and converts through the ONE conversion in the building.
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "750",
      volumeUnit: "ml",
    });
    ok(r.ok && r.netVolumeMl === 750, "750 ml is stored as 750 ml");
    ok(
      r.ok && r.provenance === RECEIVING_CLASSIFICATION_PROVENANCE.human,
      "a measured volume is a HUMAN assertion",
    );
  }
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "1.5",
      volumeUnit: "l",
    });
    ok(r.ok && r.netVolumeMl === 1500, "1.5 L becomes 1500 ml");
  }
  {
    const r = validateReceivingVolumeChoice({
      assessment: gated,
      volumeQuantity: "12",
      volumeUnit: "floz",
    });
    ok(
      r.ok && r.netVolumeMl !== null && Math.abs(r.netVolumeMl - 354.882) < 1e-6,
      "12 fl oz becomes 354.882 ml (the statutory conversion, not 12 x 28)",
    );
  }
  // The ungated path invents nothing.
  {
    const r = validateReceivingVolumeChoice({ assessment: ungated });
    ok(r.ok && r.netVolumeMl === null, "an ungated lot stores no volume");
    ok(
      r.ok && r.provenance === RECEIVING_CLASSIFICATION_PROVENANCE.unanswered,
      "and says plainly that nobody was asked",
    );
  }
  {
    // A volunteered measurement is still kept, and still validated.
    const r = validateReceivingVolumeChoice({
      assessment: ungated,
      volumeQuantity: "30",
      volumeUnit: "ml",
    });
    ok(r.ok && r.netVolumeMl === 30, "a volunteered volume is honoured");
    const bad = validateReceivingVolumeChoice({
      assessment: ungated,
      volumeQuantity: "30",
      volumeUnit: "oz",
    });
    ok(!bad.ok, "...and is held to the SAME rules as a required one");
  }
  ok(
    volumePickerPlaceholder({ needsVolumePick: true }).includes("required"),
    "the placeholder tells the truth about a required pick",
  );

  // 1) The gate fires on every liquid_edible shelf and nowhere else.
  for (const c of ["edible-liquid", "tincture", "topical"]) {
    const a = assessReceivingClassification({
      productName: "Something",
      inventoryType: null,
      resolvedWebsiteCategory: c,
    });
    ok(a.needsOtherwiseTakenPick, `liquid shelf ${c} is gated`);
    ok(a.promptsLowThcLiquid, `liquid shelf ${c} prompts low-THC`);
  }
  for (const c of ["flower", "cartridge", "edible-solid", "concentrate"]) {
    const a = assessReceivingClassification({
      productName: "Blue Dream 3.5g",
      inventoryType: "Usable Marijuana",
      resolvedWebsiteCategory: c,
    });
    ok(!a.needsOtherwiseTakenPick, `${c} is not gated`);
    ok(!a.promptsLowThcLiquid, `${c} does not prompt low-THC`);
  }

  // 2) The detector catches a mis-categorised suppository the shelf test misses.
  {
    const a = assessReceivingClassification({
      productName: "Relief Suppositories 6ct",
      inventoryType: "Suppository",
      resolvedWebsiteCategory: "edible-solid",
    });
    ok(a.suspected && a.needsOtherwiseTakenPick, "detector gates a mis-shelved suppository");
    ok(!a.promptsLowThcLiquid, "a suspected suppository is not a beverage question");
  }

  // 3) The two commonly-mistaken products are NOT suspected.
  {
    const patch = assessReceivingClassification({
      productName: "Transdermal Patch 20mg",
      inventoryType: "Topical",
      resolvedWebsiteCategory: "topical",
    });
    ok(!patch.suspected, "patch is not suspected (010(40) excludes skin)");
    const tinc = assessReceivingClassification({
      productName: "Sublingual Tincture 1oz",
      inventoryType: "Tincture",
      resolvedWebsiteCategory: "tincture",
    });
    ok(!tinc.suspected, "tincture is not suspected (010(40) excludes oral)");
  }

  // 4) Gate refuses silence, accepts an answer.
  {
    const gated = { needsOtherwiseTakenPick: true, promptsLowThcLiquid: true };
    let r = validateReceivingClassificationChoice({ assessment: gated });
    ok(!r.ok && r.code === "otherwise_taken_required", "silence refused on a gated line");

    r = validateReceivingClassificationChoice({ assessment: gated, otherwiseTaken: "yes" });
    ok(!r.ok && r.code === "units_per_package_required", "yes without a count refused");

    r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "yes",
      unitsPerPackage: "2.5",
    });
    ok(!r.ok && r.code === "units_per_package_invalid", "fractional count refused");

    r = validateReceivingClassificationChoice({
      assessment: gated,
      otherwiseTaken: "yes",
      unitsPerPackage: "6",
    });
    ok(r.ok && r.otherwiseTaken === true && r.unitsPerPackage === 6, "valid yes accepted");
    ok(
      r.ok && r.provenance.otherwiseTaken === RECEIVING_CLASSIFICATION_PROVENANCE.human,
      "an answer is recorded as human",
    );
  }

  // 5) Provenance honesty: an ungated line is machine-defaulted, not human.
  {
    const open = { needsOtherwiseTakenPick: false, promptsLowThcLiquid: false };
    const r = validateReceivingClassificationChoice({ assessment: open });
    ok(r.ok && r.otherwiseTaken === false, "ungated line defaults to false");
    ok(
      r.ok && r.provenance.otherwiseTaken === RECEIVING_CLASSIFICATION_PROVENANCE.machine,
      "machine default is labelled as such",
    );
    ok(
      r.ok && r.lowThcLiquid === null,
      "an unanswered low-THC question stays null, never invented",
    );
  }

  // 6) Low-THC: never blocks, but refuses a bad claim.
  {
    const gated = { needsOtherwiseTakenPick: false, promptsLowThcLiquid: true };
    let r = validateReceivingClassificationChoice({ assessment: gated });
    ok(r.ok, "a missing low-THC answer never blocks");

    r = validateReceivingClassificationChoice({ assessment: gated, lowThcLiquid: "yes" });
    ok(!r.ok && r.code === "low_thc_required", "low-THC yes needs the mg figure");

    r = validateReceivingClassificationChoice({
      assessment: gated,
      lowThcLiquid: "yes",
      unitThcMg: "16",
    });
    ok(!r.ok && r.code === "low_thc_invalid", "16 mg container refused");

    r = validateReceivingClassificationChoice({
      assessment: gated,
      lowThcLiquid: "yes",
      unitThcMg: "4",
    });
    ok(r.ok && r.lowThcLiquid === true && r.unitThcMg === 4, "4 mg container accepted");
  }

  // 7) The two flags are mutually exclusive.
  {
    const r = validateReceivingClassificationChoice({
      assessment: { needsOtherwiseTakenPick: true, promptsLowThcLiquid: true },
      otherwiseTaken: "yes",
      unitsPerPackage: "6",
      lowThcLiquid: "yes",
      unitThcMg: "4",
    });
    ok(!r.ok && r.code === "mutually_exclusive", "both flags at once refused");
  }

  // 8) Placeholders tell the truth.
  ok(
    otherwiseTakenPickerPlaceholder({ needsOtherwiseTakenPick: true }) === "Pick yes or no\u2026",
    "required pick prompts",
  );
  ok(
    otherwiseTakenPickerPlaceholder({ needsOtherwiseTakenPick: false }) === "No \u2014 ordinary product",
    "optional pick states the assumption",
  );

  return { passed };
}
