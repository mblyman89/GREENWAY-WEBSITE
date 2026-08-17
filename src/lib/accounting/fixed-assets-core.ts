/**
 * src/lib/accounting/fixed-assets-core.ts — Fixed assets & MACRS depreciation
 * (PURE core, slice F5-L).
 *
 * No I/O, no network, no server-only imports. Registered in
 * scripts/compliance/run-pure-selftests.ts.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this slice the chart of accounts had NO fixed-asset accounts at all.
 * Block 2 ran 20000-20890 and every single account in it was inventory. There
 * was no Land account, no Building account, and no Accumulated Depreciation.
 * The Geiger property — a real building the business has owned since 2016 —
 * literally could not be recorded. Depreciation EXPENSE accounts existed
 * (78000/78010/78020) with nothing to depreciate.
 *
 * That gap matters more than it looks. Depreciation is not optional. Basis is
 * reduced by depreciation "allowed or allowable", which means the IRS reduces
 * basis on sale by the depreciation a taxpayer COULD have claimed even if he
 * never claimed it. Failing to record a building does not defer the deduction;
 * it destroys it while still costing the basis on the way out.
 *
 * WHAT THIS MODULE REFUSES TO DO
 * ------------------------------
 * Standing rule 14 says choose refusal over a confident wrong answer. This
 * module therefore throws, loudly and by name, rather than guessing:
 *
 *   FA_LAND_NOT_DEPRECIABLE   — any attempt to depreciate land.
 *   FA_UNSUPPORTED_CLASS      — a property class whose table is not shipped.
 *   FA_ACCUM_EXCEEDS_BASIS    — accumulated depreciation over depreciable basis.
 *   FA_BAD_BASIS              — non-integer, negative or unsafe basis.
 *   FA_BAD_MONTH / FA_BAD_YEAR / FA_BAD_DISPOSAL — impossible dates.
 *   FA_ALLOCATION_MISMATCH    — a purchase-price split that loses a cent.
 *
 * LEGAL GROUND (quoted, not paraphrased)
 * --------------------------------------
 * IRS Publication 946 (2025), "Land":
 *   "You cannot depreciate the cost of land because land does not wear out,
 *    become obsolete, or get used up. The cost of land generally includes the
 *    cost of clearing, grading, planting, and landscaping."
 *
 * Pub. 946, "The mid-month convention":
 *   "Use this convention for nonresidential real property, residential rental
 *    property, and any railroad grading or tunnel bore. Under this convention,
 *    you treat all property placed in service or disposed of during a month as
 *    placed in service or disposed of at the midpoint of the month."
 *
 * Pub. 946, GDS recovery periods: nonresidential real property is 39 years
 * (31.5 years if placed in service before May 13, 1993).
 *
 * Pub. 946, "Rules Covering the Use of the Tables":
 *   "You must apply the rates in the percentage tables to your property's
 *    unadjusted basis."
 * Unadjusted basis is NOT reduced by prior depreciation — every year's rate is
 * applied to the original figure. Getting that backwards silently under-
 * depreciates every year after the first, which is why it is stated here.
 *
 * Pub. 946, "Mid-month convention used" (disposals):
 *   "If you dispose of residential rental or nonresidential real property,
 *    figure your depreciation deduction for the year of the disposition by
 *    multiplying a full year of depreciation by a fraction. The numerator of
 *    the fraction is the number of months (including partial months) in the
 *    year that the property is considered in service. The denominator is 12."
 *
 * MONEY RULE (standing rule 13e): integer CENTS, never a float. Every product
 * and quotient below is computed in BigInt and only crosses back to `number`
 * after the division, so a $525,000 basis times a rate can never lose a cent to
 * IEEE-754. (tsconfig targets ES2017 — BigInt literals like 0n do not compile,
 * so BigInt(0) is used throughout, matching posting-core.ts:265.)
 *
 * RATE RULE (standing): integer MILLI-PERCENT. 100% = 100000, so the published
 * 2.461% is carried as 2461 with no decimal anywhere in the money path.
 */

import type { EntityCode } from "./ledger-core";

// ---------------------------------------------------------------------------
// 0) Rate scale
// ---------------------------------------------------------------------------

/** 100% expressed in milli-percent. Mirrors the house rate rule (85% = 85000). */
export const RATE_SCALE = 100000;

// ---------------------------------------------------------------------------
// 1) Property classes
// ---------------------------------------------------------------------------

/**
 * The property classes this module will compute. Anything not listed REFUSES
 * rather than falling back to a plausible-looking default.
 *
 * `land` is present deliberately. Land must be RECORDED (it carries basis and
 * it is half of every building purchase) while never being DEPRECIATED, and the
 * only way to enforce that is to make it a first-class value the guards can see.
 */
export type PropertyClass =
  | "land"
  | "land_improvement"
  | "nonresidential_real"
  | "nonresidential_real_315"
  | "residential_rental"
  | "construction_in_progress"
  | "furniture_fixtures_equipment"
  | "vehicle";

export interface PropertyClassInfo {
  readonly slug: PropertyClass;
  readonly label: string;
  /** False = never depreciated, at any time, for any reason. */
  readonly depreciable: boolean;
  /** GDS recovery period in years. Null when not depreciable. */
  readonly recoveryYears: number | null;
  /** Averaging convention. Null when not depreciable. */
  readonly convention: "MM" | "HY" | "MQ" | null;
  /** True when this module ships a verified percentage table for the class. */
  readonly computable: boolean;
  readonly note: string;
}

/**
 * Pub. 946 assigns the mid-month convention to real property ONLY. Half-year
 * and mid-quarter never apply to it, and mid-month never applies to personal
 * property. The `convention` field records that so nobody has to remember it.
 */
export const PROPERTY_CLASSES: readonly PropertyClassInfo[] = [
  {
    slug: "land",
    label: "Land",
    depreciable: false,
    recoveryYears: null,
    convention: null,
    computable: true,
    note:
      'Pub. 946: "You cannot depreciate the cost of land because land does not wear out, become obsolete, or get used up." Land holds basis forever and is recovered only on sale. The Geiger parcel sits here.',
  },
  {
    slug: "construction_in_progress",
    label: "Construction in Progress",
    depreciable: false,
    recoveryYears: null,
    convention: null,
    computable: true,
    note:
      "Not depreciable because it is not yet PLACED IN SERVICE. Depreciation begins when the asset is ready and available for its assigned use, not when it is paid for. Reclassify to the finished class on the in-service date.",
  },
  {
    slug: "nonresidential_real",
    label: "Nonresidential real property (39-year)",
    depreciable: true,
    recoveryYears: 39,
    convention: "MM",
    computable: true,
    note:
      "GDS straight line, 39 years, mid-month. Applies to property placed in service after May 12, 1993. This is the Greenway building and the Geiger improvements.",
  },
  {
    slug: "nonresidential_real_315",
    label: "Nonresidential real property (31.5-year, pre-5/13/1993)",
    depreciable: true,
    recoveryYears: 31.5,
    convention: "MM",
    computable: false,
    note:
      "GDS straight line, 31.5 years, mid-month, for property placed in service before May 13, 1993. Recognised so it cannot be silently treated as 39-year, but no table is shipped: nothing Michael owns is this old, and an unused table is an untested table.",
  },
  {
    slug: "residential_rental",
    label: "Residential rental property (27.5-year)",
    depreciable: true,
    recoveryYears: 27.5,
    convention: "MM",
    computable: false,
    note:
      "GDS straight line, 27.5 years, mid-month. Recognised but not computed in this slice. If a residential rental ever appears, ship Table A-6 and its tests rather than reusing the 39-year table.",
  },
  {
    slug: "land_improvement",
    label: "Land improvements (15-year)",
    depreciable: true,
    recoveryYears: 15,
    convention: "HY",
    computable: false,
    note:
      "Parking, fencing, site lighting: 15-year, 150% declining balance, half-year (or mid-quarter). NOT mid-month — it is not real property for convention purposes. Not computed in this slice.",
  },
  {
    slug: "furniture_fixtures_equipment",
    label: "Furniture, fixtures & equipment (7-year)",
    depreciable: true,
    recoveryYears: 7,
    convention: "HY",
    computable: false,
    note:
      "200% declining balance, half-year or mid-quarter. Mid-quarter turns on when >40% of the year's basis lands in the last 3 months, which is a whole-year test across ALL assets — a later slice, not a one-asset calculation.",
  },
  {
    slug: "vehicle",
    label: "Vehicles (5-year)",
    depreciable: true,
    recoveryYears: 5,
    convention: "HY",
    computable: false,
    note:
      "5-year property, and usually LISTED property under section 280F with its own caps and substantiation rules. Deliberately not computed here: getting a vehicle wrong is a section 274(d) problem where Cohan estimates are switched off entirely.",
  },
] as const;

const CLASS_BY_SLUG = new Map<PropertyClass, PropertyClassInfo>(
  PROPERTY_CLASSES.map((c) => [c.slug, c]),
);

export function propertyClassInfo(slug: PropertyClass): PropertyClassInfo {
  const info = CLASS_BY_SLUG.get(slug);
  if (!info) throw new Error(`FA_UNSUPPORTED_CLASS: unknown property class ${String(slug)}.`);
  return info;
}

/** True only for classes that may ever carry depreciation. Land is always false. */
export function isDepreciable(slug: PropertyClass): boolean {
  return propertyClassInfo(slug).depreciable;
}

/**
 * THE LAND GUARD. Throws for land and for anything else that must never be
 * depreciated. Called at the top of every computation path so there is exactly
 * one place to break.
 */
export function assertDepreciable(slug: PropertyClass): PropertyClassInfo {
  const info = propertyClassInfo(slug);
  if (!info.depreciable) {
    throw new Error(
      `FA_LAND_NOT_DEPRECIABLE: ${info.label} is never depreciated. ${info.note}`,
    );
  }
  if (!info.computable) {
    throw new Error(
      `FA_UNSUPPORTED_CLASS: ${info.label} is depreciable but no verified percentage table ships in this slice. Refusing to guess. ${info.note}`,
    );
  }
  return info;
}

// ---------------------------------------------------------------------------
// 2) The MACRS table — transcribed verbatim from IRS Pub. 946 (2025)
// ---------------------------------------------------------------------------

/**
 * Table A-7a, "Nonresidential Real Property / Mid-Month Convention /
 * Straight Line — 39 Years", transcribed from Publication 946 (2025) page 74.
 * Values are the published percentages carried as milli-percent.
 *
 * Published year 1 row:
 *   2.461% 2.247% 2.033% 1.819% 1.605% 1.391% 1.177% 0.963% 0.749% 0.535% 0.321% 0.107%
 * Published years 2-39 row: 2.564 in every month.
 * Published year 40 row:
 *   0.107 0.321 0.535 0.749 0.963 1.177 1.391 1.605 1.819 2.033 2.247 2.461
 *
 * These are the IRS's own numbers, not a derivation. That distinction matters:
 * computing (1/39) x (11.5/12) gives 2.4573%, and Pub. 946's own worked example
 * without the tables produces $2,456 on a $100,000 building — while the TABLE
 * produces $2,461. Both are lawful; they are different published methods. This
 * module uses the tables, because that is what tax software uses and therefore
 * what Michael's filed returns will have used, and being able to tie out to the
 * return is the entire point.
 */
const A7A_YEAR_1: readonly number[] = [
  2461, 2247, 2033, 1819, 1605, 1391, 1177, 963, 749, 535, 321, 107,
];
const A7A_YEARS_2_TO_39 = 2564;
const A7A_YEAR_40: readonly number[] = [
  107, 321, 535, 749, 963, 1177, 1391, 1605, 1819, 2033, 2247, 2461,
];

/** Number of table rows (recovery years) for 39-year mid-month property. */
export const NONRES_REAL_TABLE_YEARS = 40;

/**
 * The published rate, in milli-percent, for a given recovery year (1-based) and
 * month placed in service (1-12). Returns 0 outside the recovery period, which
 * is a fact rather than an error: a 41st year simply has no depreciation.
 */
export function macrsRateMilliPct(
  slug: PropertyClass,
  recoveryYear: number,
  placedInServiceMonth: number,
): number {
  assertDepreciable(slug);
  assertMonth(placedInServiceMonth);
  if (!Number.isInteger(recoveryYear)) {
    throw new Error(`FA_BAD_YEAR: recovery year must be a whole number, got ${recoveryYear}.`);
  }
  if (recoveryYear < 1) return 0;
  if (recoveryYear > NONRES_REAL_TABLE_YEARS) return 0;
  const m = placedInServiceMonth - 1;
  if (recoveryYear === 1) return A7A_YEAR_1[m];
  if (recoveryYear === NONRES_REAL_TABLE_YEARS) return A7A_YEAR_40[m];
  return A7A_YEARS_2_TO_39;
}

// ---------------------------------------------------------------------------
// 3) Integer money helpers
// ---------------------------------------------------------------------------

function assertMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`FA_BAD_MONTH: month must be an integer 1-12, got ${String(month)}.`);
  }
}

function assertYear(year: number, field: string): void {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw new Error(`FA_BAD_YEAR: ${field} must be a plausible 4-digit year, got ${String(year)}.`);
  }
}

/** Basis must be a whole, non-negative, exactly representable number of cents. */
export function assertBasisCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(
      `FA_BAD_BASIS: basis must be a safe integer number of CENTS, got ${String(cents)}. Dollars-with-decimals are a float and are forbidden in money paths.`,
    );
  }
  if (cents < 0) {
    throw new Error(`FA_BAD_BASIS: basis cannot be negative, got ${cents} cents.`);
  }
}

/**
 * (value * num) / den with half-up rounding, computed entirely in BigInt.
 *
 * Half-up matches the way the IRS worked examples round ($2,564 from
 * $100,000 x 0.02564) and, more importantly, is deterministic. Banker's
 * rounding would be defensible too, but only one of them can be the house rule
 * and an undocumented mixture is how cents go missing.
 */
export function mulDivRoundHalfUp(value: bigint, num: bigint, den: bigint): bigint {
  if (den <= BigInt(0)) throw new Error("FA_BAD_BASIS: denominator must be positive.");
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const scaled = abs * num;
  const half = den / BigInt(2);
  const q = (scaled + half) / den;
  return negative ? -q : q;
}

/** Apply a milli-percent rate to an integer-cent basis. */
export function applyRateCents(basisCents: number, rateMilliPct: number): number {
  assertBasisCents(basisCents);
  if (!Number.isInteger(rateMilliPct) || rateMilliPct < 0) {
    throw new Error(`FA_BAD_BASIS: rate must be a non-negative integer milli-percent, got ${String(rateMilliPct)}.`);
  }
  const out = mulDivRoundHalfUp(
    BigInt(basisCents),
    BigInt(rateMilliPct),
    BigInt(RATE_SCALE),
  );
  return Number(out);
}

// ---------------------------------------------------------------------------
// 4) The asset record
// ---------------------------------------------------------------------------

export interface FixedAssetInput {
  /** Human tag, e.g. "GEIGER-BLDG". Used in messages, never in arithmetic. */
  readonly assetTag: string;
  readonly description: string;
  readonly entityCode: EntityCode;
  readonly propertyClass: PropertyClass;
  /**
   * UNADJUSTED depreciable basis in cents — the building only, never including
   * land. Pub. 946: the table rates are applied to unadjusted basis every year.
   */
  readonly depreciableBasisCents: number;
  readonly placedInServiceYear: number;
  /** 1-12. Mid-month means the day never matters, only the month. */
  readonly placedInServiceMonth: number;
  /** Year of sale/abandonment, or null while still held. */
  readonly disposedYear?: number | null;
  /** 1-12, required when disposedYear is set. */
  readonly disposedMonth?: number | null;
}

export interface DepreciationYearRow {
  readonly taxYear: number;
  readonly recoveryYear: number;
  readonly rateMilliPct: number;
  /** Deduction for this tax year, in cents, after every cap and proration. */
  readonly depreciationCents: number;
  /** Running total INCLUDING this year. Never exceeds depreciable basis. */
  readonly accumulatedCents: number;
  /** Basis not yet recovered at the END of this year. Never negative. */
  readonly remainingBasisCents: number;
  /** Set when the year was shortened or capped, so the reason is visible. */
  readonly note: string | null;
}

// ---------------------------------------------------------------------------
// 5) Schedule construction
// ---------------------------------------------------------------------------

function validateAssetShape(a: FixedAssetInput): void {
  if (!a.assetTag || a.assetTag.trim().length < 2) {
    throw new Error("FA_BAD_BASIS: every asset needs a tag at least 2 characters long.");
  }
  assertBasisCents(a.depreciableBasisCents);
  assertYear(a.placedInServiceYear, "placedInServiceYear");
  assertMonth(a.placedInServiceMonth);

  const dy = a.disposedYear ?? null;
  const dm = a.disposedMonth ?? null;
  if (dy !== null || dm !== null) {
    if (dy === null || dm === null) {
      throw new Error("FA_BAD_DISPOSAL: a disposal needs BOTH a year and a month.");
    }
    assertYear(dy, "disposedYear");
    assertMonth(dm);
    const pis = a.placedInServiceYear * 12 + a.placedInServiceMonth;
    const dis = dy * 12 + dm;
    if (dis < pis) {
      throw new Error(
        `FA_BAD_DISPOSAL: ${a.assetTag} cannot be disposed of in ${dy}-${String(dm).padStart(2, "0")}, before it was placed in service in ${a.placedInServiceYear}-${String(a.placedInServiceMonth).padStart(2, "0")}.`,
      );
    }
  }
}

/**
 * Half-months of service in the disposal year, out of 24.
 *
 * Pub. 946 treats the month of disposition as one-half month of use, so a March
 * disposal is 2.5 months = 5 half-months. Kept in half-months to stay integral:
 * 2.5/12 has no exact binary representation and this is a money path.
 */
export function disposalHalfMonths(disposedMonth: number): number {
  assertMonth(disposedMonth);
  return 2 * disposedMonth - 1;
}

/**
 * The full depreciation schedule, one row per tax year, from the year placed in
 * service through the end of recovery or the year of disposal.
 *
 * THE TWO HARD CAPS, both enforced here and both tested by mutation:
 *   1. Land (and anything else non-depreciable) never gets here at all.
 *   2. Accumulated depreciation can never exceed the depreciable basis. The
 *      final year takes exactly the unrecovered remainder, which is also what
 *      Pub. 946 prescribes: "your depreciation deduction for the year that
 *      includes the final month of the recovery period is the amount of your
 *      unrecovered basis in the property."
 */
export function buildDepreciationSchedule(a: FixedAssetInput): DepreciationYearRow[] {
  validateAssetShape(a);
  assertDepreciable(a.propertyClass);

  const rows: DepreciationYearRow[] = [];
  const basis = a.depreciableBasisCents;
  if (basis === 0) return rows;

  let accumulated = 0;
  const lastRecoveryYear = NONRES_REAL_TABLE_YEARS;

  for (let ry = 1; ry <= lastRecoveryYear; ry++) {
    const taxYear = a.placedInServiceYear + ry - 1;

    // NOTE: there is deliberately no "taxYear > disposedYear" guard here. The
    // loop already breaks at the BOTTOM on the disposal year, so such a guard
    // is unreachable — mutation testing proved it (M20 survived because no
    // input can reach it). Unreachable defensive code is untestable code, and
    // untestable code is where bugs hide, so it was removed rather than
    // covered by a contrived test. Disposal terminates in exactly one place.
    const rate = macrsRateMilliPct(a.propertyClass, ry, a.placedInServiceMonth);
    let amount = applyRateCents(basis, rate);
    let note: string | null = null;

    // FINAL-YEAR SWEEP. Pub. 946 (2025), "Mid-quarter convention" paragraph,
    // stating the rule that applies whenever the property is held for the whole
    // recovery period: "If you hold the property for the entire recovery
    // period, your depreciation deduction for the year that includes the final
    // month of the recovery period is the amount of your unrecovered basis in
    // the property."
    //
    // The published table percentages are rounded to three decimal places, so
    // applying them literally for all 40 years does NOT always recover exactly
    // 100% of basis. On a $1,234,567.89 building the table leaves 2-3 cents
    // stranded; on very small bases it can strand the entire amount (a 1-cent
    // basis rounds to zero in every one of the 40 years and would recover
    // NOTHING). Stranded basis is real money that is never deducted and never
    // explained, and it also breaks the reconciliation between the fixed-asset
    // schedule and the balance sheet.
    //
    // So the last year of the recovery period takes the remainder, exactly as
    // the IRS prescribes, instead of the table rate. This runs BEFORE the
    // disposal branch because a disposal in the final year is prorated (the
    // asset left mid-year, so the remainder is NOT all deductible — what is
    // left over is recovered through gain or loss on the sale instead).
    const isFinalRecoveryYear = ry === lastRecoveryYear;
    const notDisposedThisYear = !(a.disposedYear != null && taxYear === a.disposedYear);
    if (isFinalRecoveryYear && notDisposedThisYear) {
      const remainder = basis - accumulated;
      if (remainder !== amount) {
        amount = remainder;
        note =
          "Final year of the recovery period: the deduction is the remaining unrecovered basis, not the table percentage. IRS Pub. 946: \"If you hold the property for the entire recovery period, your depreciation deduction for the year that includes the final month of the recovery period is the amount of your unrecovered basis in the property.\" This sweeps up the few cents the published percentages leave behind, so the whole cost is recovered and the schedule ties to the balance sheet.";
      }
    }

    // Disposal year: prorate the full-year amount by half-months of service.
    if (a.disposedYear != null && taxYear === a.disposedYear) {
      const hm = disposalHalfMonths(a.disposedMonth as number);
      const prorated = mulDivRoundHalfUp(BigInt(amount), BigInt(hm), BigInt(24));
      amount = Number(prorated);
      note =
        `Disposal year: full-year depreciation prorated to ${hm}/24 half-months under the mid-month convention (the month of disposition counts as half a month).`;
    }

    // CAP: accumulated depreciation may never exceed depreciable basis.
    const remainingBefore = basis - accumulated;
    if (amount > remainingBefore) {
      amount = remainingBefore;
      note =
        (note ? note + " " : "") +
        "Capped at unrecovered basis: prior plus current depreciation can never exceed the depreciable basis.";
    }

    accumulated += amount;
    const remainingAfter = basis - accumulated;

    if (amount !== 0 || note !== null) {
      rows.push({
        taxYear,
        recoveryYear: ry,
        rateMilliPct: rate,
        depreciationCents: amount,
        accumulatedCents: accumulated,
        remainingBasisCents: remainingAfter,
        note,
      });
    }

    // The two ways a schedule ends: the asset left, or the basis ran out.
    if (a.disposedYear != null && taxYear === a.disposedYear) break;
    if (remainingAfter === 0) break;
  }

  // Belt and braces. If this ever fires, the cap above was edited wrongly.
  if (accumulated > basis) {
    throw new Error(
      `FA_ACCUM_EXCEEDS_BASIS: ${a.assetTag} accumulated ${accumulated} cents against a basis of ${basis} cents.`,
    );
  }
  return rows;
}

/** Depreciation for one specific tax year. Zero outside the recovery period. */
export function depreciationForYearCents(a: FixedAssetInput, taxYear: number): number {
  assertYear(taxYear, "taxYear");
  const row = buildDepreciationSchedule(a).find((r) => r.taxYear === taxYear);
  return row ? row.depreciationCents : 0;
}

/** Accumulated depreciation at the END of the given tax year. */
export function accumulatedThroughCents(a: FixedAssetInput, taxYear: number): number {
  assertYear(taxYear, "taxYear");
  const rows = buildDepreciationSchedule(a);
  let acc = 0;
  for (const r of rows) {
    if (r.taxYear > taxYear) break;
    acc = r.accumulatedCents;
  }
  return acc;
}

/** Adjusted basis = unadjusted basis less depreciation allowed or allowable. */
export function adjustedBasisCents(a: FixedAssetInput, taxYear: number): number {
  return a.depreciableBasisCents - accumulatedThroughCents(a, taxYear);
}

/**
 * Independent guard usable by callers that track accumulated depreciation
 * themselves (an imported prior-year figure, say). Deliberately NOT the same
 * code path as the schedule cap, so a bug in one does not disarm the other.
 */
export function assertAccumulatedWithinBasis(
  assetTag: string,
  accumulatedCents: number,
  depreciableBasisCents: number,
): void {
  assertBasisCents(depreciableBasisCents);
  if (!Number.isSafeInteger(accumulatedCents) || accumulatedCents < 0) {
    throw new Error(
      `FA_ACCUM_EXCEEDS_BASIS: accumulated depreciation for ${assetTag} must be a non-negative safe integer of cents, got ${String(accumulatedCents)}.`,
    );
  }
  if (accumulatedCents > depreciableBasisCents) {
    throw new Error(
      `FA_ACCUM_EXCEEDS_BASIS: ${assetTag} has accumulated depreciation of ${accumulatedCents} cents against a depreciable basis of ${depreciableBasisCents} cents. Prior years' depreciation plus the current year's can never exceed the depreciable basis.`,
    );
  }
}

// ---------------------------------------------------------------------------
// 6) Splitting a purchase price between land and building
// ---------------------------------------------------------------------------

export interface BasisAllocation {
  readonly landCents: number;
  readonly improvementCents: number;
  readonly landMilliPct: number;
  readonly basisNote: string;
}

/**
 * Split ONE purchase price into non-depreciable land and depreciable building.
 *
 * This is the single most consequential number on the Geiger property: every
 * cent put on land is a cent that is never deducted, and every cent put on the
 * building is a cent the IRS will want justified. Pub. 946's own worked example
 * takes the split straight from the sales contract, which is why an evidence
 * reference is REQUIRED rather than optional.
 *
 * The odd cent goes to LAND. That is the conservative direction — it lowers the
 * depreciable base and therefore the deduction — and being deterministic it is
 * reproducible on audit. One cent never matters; an unexplained rounding rule
 * does.
 */
export function allocatePurchasePrice(
  totalPriceCents: number,
  landValueCents: number,
  improvementValueCents: number,
  evidenceRef: string,
): BasisAllocation {
  assertBasisCents(totalPriceCents);
  assertBasisCents(landValueCents);
  assertBasisCents(improvementValueCents);
  if (!evidenceRef || evidenceRef.trim().length < 3) {
    throw new Error(
      "FA_ALLOCATION_MISMATCH: a land/building split requires an evidence reference (closing statement, assessor roll, appraisal). Standing rule 11: opening figures come from evidence, never from a convenient assumption.",
    );
  }
  const denom = landValueCents + improvementValueCents;
  if (denom <= 0) {
    throw new Error(
      "FA_ALLOCATION_MISMATCH: the land and improvement reference values sum to zero, so no ratio can be formed.",
    );
  }

  const land = Number(
    mulDivRoundHalfUp(BigInt(totalPriceCents), BigInt(landValueCents), BigInt(denom)),
  );
  const improvement = totalPriceCents - land;

  if (land + improvement !== totalPriceCents) {
    throw new Error(
      `FA_ALLOCATION_MISMATCH: split lost a cent (${land} + ${improvement} <> ${totalPriceCents}).`,
    );
  }
  if (land < 0 || improvement < 0) {
    throw new Error("FA_ALLOCATION_MISMATCH: neither side of the split may be negative.");
  }

  const landMilliPct = Number(
    mulDivRoundHalfUp(BigInt(landValueCents) * BigInt(RATE_SCALE), BigInt(1), BigInt(denom)),
  );

  return {
    landCents: land,
    improvementCents: improvement,
    landMilliPct,
    basisNote:
      `Land/building split derived from ${evidenceRef.trim()}: land ${landValueCents} and improvements ${improvementValueCents} reference cents, applied to an actual cost of ${totalPriceCents} cents. Any odd cent is assigned to LAND, which is the conservative direction because land is never depreciated.`,
  };
}

// ---------------------------------------------------------------------------
// 7) Account codes seeded by migration 0178
// ---------------------------------------------------------------------------

/**
 * Mirrors 0178_fixed_assets.sql exactly. Kept here so the TypeScript side can
 * be tested without a database, and so a drift between the two is a test
 * failure rather than a production surprise.
 */
export const FIXED_ASSET_ACCOUNTS = {
  parent: "21000",
  land: "21100",
  landImprovements: "21200",
  buildings: "21300",
  buildingImprovements: "21400",
  leaseholdImprovements: "21500",
  furnitureFixturesEquipment: "21600",
  vehicles: "21700",
  constructionInProgress: "21800",
  accumulatedDepreciation: "21900",
} as const;

/** The one contra account in the block. Everything else is debit-normal. */
export const ACCUMULATED_DEPRECIATION_IS_CONTRA = true;

/**
 * Which GL account a property class lands in. Returned as a code so callers
 * cannot invent one. Throws for an unknown class rather than defaulting.
 */
export function accountCodeForClass(slug: PropertyClass): string {
  switch (slug) {
    case "land":
      return FIXED_ASSET_ACCOUNTS.land;
    case "land_improvement":
      return FIXED_ASSET_ACCOUNTS.landImprovements;
    case "nonresidential_real":
    case "nonresidential_real_315":
    case "residential_rental":
      return FIXED_ASSET_ACCOUNTS.buildings;
    case "construction_in_progress":
      return FIXED_ASSET_ACCOUNTS.constructionInProgress;
    case "furniture_fixtures_equipment":
      return FIXED_ASSET_ACCOUNTS.furnitureFixturesEquipment;
    case "vehicle":
      return FIXED_ASSET_ACCOUNTS.vehicles;
    default: {
      const never: never = slug;
      throw new Error(`FA_UNSUPPORTED_CLASS: no account mapping for ${String(never)}.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 8) Plain-English explanation (the "mentor" surface)
// ---------------------------------------------------------------------------

/**
 * Michael has a master's in accounting and has not opened an accounting book in
 * thirteen years. Every refusal above is useless to him unless it also says what
 * to do next, so the schedule can explain itself in sentences.
 */
export function explainSchedule(a: FixedAssetInput): string {
  const info = propertyClassInfo(a.propertyClass);
  if (!info.depreciable) {
    return `${a.description} is recorded as ${info.label} and is never depreciated. ${info.note} Its cost stays on the balance sheet at full value until the day it is sold, and only then does it affect the tax return.`;
  }
  if (!info.computable) {
    return `${a.description} is ${info.label}, which IS depreciable, but this system does not yet compute that class and will not guess at it. ${info.note}`;
  }
  const rows = buildDepreciationSchedule(a);
  if (rows.length === 0) {
    return `${a.description} has no depreciable basis recorded, so there is nothing to depreciate yet.`;
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  return [
    `${a.description} is ${info.label}: the cost is spread evenly over ${String(info.recoveryYears)} years using the mid-month convention, which treats it as going into service in the middle of the month regardless of the day.`,
    `Because it was placed in service in month ${a.placedInServiceMonth}, the first year gets a part-year deduction of ${money(first.depreciationCents)} rather than a full year.`,
    `Full years after that are ${money(applyRateCents(a.depreciableBasisCents, A7A_YEARS_2_TO_39))} each.`,
    `The schedule runs through ${String(last.taxYear)}, by which point the entire ${money(a.depreciableBasisCents)} of depreciable cost has been deducted and no more is available.`,
    `Land is deliberately excluded from that figure — land is never depreciated, so it is carried separately and forever.`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// 9) Self-tests
// ---------------------------------------------------------------------------

function expect(label: string, cond: boolean): void {
  if (!cond) throw new Error(`fixed-assets-core self-test FAILED: ${label}`);
}
function eq<T>(actual: T, want: T, label: string): void {
  if (actual !== want) {
    throw new Error(
      `fixed-assets-core self-test FAILED: ${label} — expected ${String(want)}, got ${String(actual)}`,
    );
  }
}
function throws(label: string, fn: () => unknown, expectedCode: string): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.startsWith(expectedCode)) {
      throw new Error(
        `fixed-assets-core self-test FAILED: ${label} — threw the wrong error. Expected ${expectedCode}, got: ${msg}`,
      );
    }
  }
  if (!threw) {
    throw new Error(
      `fixed-assets-core self-test FAILED: ${label} — expected ${expectedCode} but nothing was thrown.`,
    );
  }
}

export function __runFixedAssetsCoreTests(): void {
  // --- A) The published table is intact ----------------------------------
  eq(A7A_YEAR_1.length, 12, "Table A-7a year 1 has twelve months");
  eq(A7A_YEAR_40.length, 12, "Table A-7a year 40 has twelve months");

  // Every month column must total exactly 100.000%. If a digit were mistyped
  // during transcription this is the test that catches it.
  for (let m = 1; m <= 12; m++) {
    let total = 0;
    for (let ry = 1; ry <= NONRES_REAL_TABLE_YEARS; ry++) {
      total += macrsRateMilliPct("nonresidential_real", ry, m);
    }
    eq(total, RATE_SCALE, `Table A-7a month ${m} column sums to exactly 100%`);
  }

  // Spot-check published values, month by month, against Pub. 946 page 74.
  eq(macrsRateMilliPct("nonresidential_real", 1, 1), 2461, "year 1 January = 2.461%");
  eq(macrsRateMilliPct("nonresidential_real", 1, 3), 2033, "year 1 March = 2.033%");
  eq(macrsRateMilliPct("nonresidential_real", 1, 7), 1177, "year 1 July = 1.177%");
  eq(macrsRateMilliPct("nonresidential_real", 1, 12), 107, "year 1 December = 0.107%");
  eq(macrsRateMilliPct("nonresidential_real", 2, 3), 2564, "year 2 = 2.564%");
  eq(macrsRateMilliPct("nonresidential_real", 39, 3), 2564, "year 39 = 2.564%");
  eq(macrsRateMilliPct("nonresidential_real", 40, 3), 535, "year 40 March = 0.535%");
  eq(macrsRateMilliPct("nonresidential_real", 41, 3), 0, "year 41 is outside the table");
  eq(macrsRateMilliPct("nonresidential_real", 0, 3), 0, "year 0 is outside the table");

  // The year-1 and year-40 rows are mirror images in the published table.
  for (let m = 1; m <= 12; m++) {
    eq(
      A7A_YEAR_1[m - 1] + A7A_YEAR_40[m - 1],
      2568,
      `year 1 and year 40 for month ${m} sum to the same 2.568%`,
    );
  }

  // --- B) The IRS's own worked example, reproduced exactly ---------------
  // Pub. 946: "You bought a building and land for $120,000 and placed it in
  // service on March 8. The sales contract showed that the building cost
  // $100,000 and the land cost $20,000... Your depreciation deduction for each
  // of the first 3 years is as follows: 2,033 / 2,564 / 2,564."
  const irsExample: FixedAssetInput = {
    assetTag: "PUB946-EXAMPLE-1",
    description: "Pub. 946 Example 1 building",
    entityCode: "greenway",
    propertyClass: "nonresidential_real",
    depreciableBasisCents: 100_000_00,
    placedInServiceYear: 2020,
    placedInServiceMonth: 3,
  };
  const ex = buildDepreciationSchedule(irsExample);
  eq(ex[0].depreciationCents, 2_033_00, "IRS example year 1 = $2,033");
  eq(ex[1].depreciationCents, 2_564_00, "IRS example year 2 = $2,564");
  eq(ex[2].depreciationCents, 2_564_00, "IRS example year 3 = $2,564");
  eq(ex[0].taxYear, 2020, "IRS example year 1 is the placed-in-service year");

  // Pub. 946 Example 2: a $100,000 building placed in service in January.
  // The TABLE gives 2.461% = $2,461. (The publication's without-tables walk
  // through gives $2,456; both are lawful, and this module uses the tables.)
  const janBuilding: FixedAssetInput = { ...irsExample, placedInServiceMonth: 1 };
  eq(
    buildDepreciationSchedule(janBuilding)[0].depreciationCents,
    2_461_00,
    "January building first year = $2,461 under Table A-7a",
  );

  // --- C) The land guard --------------------------------------------------
  expect("land is not depreciable", !isDepreciable("land"));
  expect("construction in progress is not depreciable", !isDepreciable("construction_in_progress"));
  expect("a 39-year building is depreciable", isDepreciable("nonresidential_real"));

  throws("land cannot be asserted depreciable", () => assertDepreciable("land"), "FA_LAND_NOT_DEPRECIABLE");
  throws(
    "CIP cannot be asserted depreciable",
    () => assertDepreciable("construction_in_progress"),
    "FA_LAND_NOT_DEPRECIABLE",
  );
  throws(
    "a land schedule is refused",
    () =>
      buildDepreciationSchedule({
        assetTag: "GEIGER-LAND",
        description: "Geiger parcel land",
        entityCode: "landholding",
        propertyClass: "land",
        depreciableBasisCents: 300_000_00,
        placedInServiceYear: 2016,
        placedInServiceMonth: 7,
      }),
    "FA_LAND_NOT_DEPRECIABLE",
  );
  throws(
    "a rate cannot be pulled for land",
    () => macrsRateMilliPct("land", 1, 1),
    "FA_LAND_NOT_DEPRECIABLE",
  );

  // --- D) Classes that are depreciable but not computed here --------------
  throws(
    "27.5-year residential rental refuses rather than reusing the 39-year table",
    () => assertDepreciable("residential_rental"),
    "FA_UNSUPPORTED_CLASS",
  );
  throws(
    "vehicles refuse (listed property, section 280F)",
    () => assertDepreciable("vehicle"),
    "FA_UNSUPPORTED_CLASS",
  );
  throws(
    "7-year FF&E refuses (mid-quarter is a whole-year test)",
    () => assertDepreciable("furniture_fixtures_equipment"),
    "FA_UNSUPPORTED_CLASS",
  );
  throws(
    "31.5-year property refuses rather than being treated as 39-year",
    () => assertDepreciable("nonresidential_real_315"),
    "FA_UNSUPPORTED_CLASS",
  );

  // Every class must be either non-depreciable or carry a recovery period.
  for (const c of PROPERTY_CLASSES) {
    expect(
      `${c.slug} is coherent: depreciable implies a recovery period and a convention`,
      c.depreciable ? c.recoveryYears !== null && c.convention !== null : c.recoveryYears === null,
    );
    expect(
      `${c.slug} has a real explanation attached`,
      c.note.length > 40,
    );
  }
  // Mid-month must appear ONLY on real property. Pub. 946 is explicit that the
  // convention follows the property type, not the other way round.
  for (const c of PROPERTY_CLASSES) {
    if (c.convention === "MM") {
      expect(
        `${c.slug} using mid-month is real property`,
        c.slug === "nonresidential_real" ||
          c.slug === "nonresidential_real_315" ||
          c.slug === "residential_rental",
      );
    }
  }
  expect(
    "land improvements do NOT use mid-month",
    propertyClassInfo("land_improvement").convention === "HY",
  );
  expect("vehicles do NOT use mid-month", propertyClassInfo("vehicle").convention === "HY");

  // --- E) Accumulated depreciation can never exceed basis -----------------
  const geiger: FixedAssetInput = {
    assetTag: "GEIGER-BLDG",
    description: "Geiger property building",
    entityCode: "landholding",
    propertyClass: "nonresidential_real",
    depreciableBasisCents: 170_000_00,
    placedInServiceYear: 2016,
    placedInServiceMonth: 7,
  };
  const full = buildDepreciationSchedule(geiger);
  const totalDep = full.reduce((s, r) => s + r.depreciationCents, 0);
  eq(totalDep, 170_000_00, "the whole depreciable basis is recovered and not a cent more");
  eq(
    full[full.length - 1].accumulatedCents,
    geiger.depreciableBasisCents,
    "final accumulated equals basis exactly",
  );
  eq(full[full.length - 1].remainingBasisCents, 0, "nothing is left unrecovered");
  expect(
    "every row's remaining basis is non-negative",
    full.every((r) => r.remainingBasisCents >= 0),
  );
  expect(
    "accumulated never exceeds basis on any row",
    full.every((r) => r.accumulatedCents <= geiger.depreciableBasisCents),
  );
  expect(
    "accumulated is monotonically non-decreasing",
    full.every((r, i) => i === 0 || r.accumulatedCents >= full[i - 1].accumulatedCents),
  );
  eq(full[0].taxYear, 2016, "first tax year is the placed-in-service year");

  // THE CAP MUST ACTUALLY BIND, not merely exist.
  //
  // Mutation testing caught this: deleting the cap left every test green,
  // because on a $170,000 basis the rounded percentages happen to land exactly.
  // They do not always. Table A-7a's twelve columns each sum to exactly 100%,
  // but each YEAR is rounded half-up independently, so on some bases the rounded
  // amounts sum to MORE than the basis. Measured, not assumed: a $1.00 basis
  // placed in service in January sums to 116 cents uncapped — 16% too much.
  // Without the cap the books would depreciate more than the asset ever cost.
  const overshoot: FixedAssetInput = {
    assetTag: "ROUNDING-OVERSHOOT",
    description: "A basis where per-year rounding overshoots",
    entityCode: "greenway",
    propertyClass: "nonresidential_real",
    depreciableBasisCents: 100,
    placedInServiceYear: 2020,
    placedInServiceMonth: 1,
  };
  const overRows = buildDepreciationSchedule(overshoot);
  eq(
    overRows.reduce((s, r) => s + r.depreciationCents, 0),
    100,
    "rounding overshoot is capped: total depreciation equals basis exactly",
  );
  eq(
    overRows[overRows.length - 1].accumulatedCents,
    100,
    "capped schedule ends with accumulated exactly equal to basis",
  );
  eq(overRows[overRows.length - 1].remainingBasisCents, 0, "capped schedule fully recovers basis");
  expect(
    "the cap explains itself in the row note",
    (overRows[overRows.length - 1].note ?? "").includes("Capped at unrecovered basis"),
  );
  // The schedule must STOP the moment basis is exhausted. Mutation testing
  // caught this too: without the early break the loop kept emitting tax years
  // with $0 of depreciation and a leftover "capped" note attached. A row that
  // claims nothing is not harmless — it is a line on a depreciation schedule
  // asserting the asset was still being written off in a year when it was not,
  // and it is exactly the kind of noise that makes a workpaper unreviewable.
  eq(overRows.length, 34, "the capped schedule stops at the year basis runs out, not year 40");
  expect(
    "the capped schedule STOPS EARLY rather than running all 40 years",
    overRows.length < NONRES_REAL_TABLE_YEARS,
  );
  expect(
    "no row in a capped schedule ever exceeds the basis",
    overRows.every((r) => r.accumulatedCents <= 100),
  );
  expect(
    "a schedule NEVER contains a zero-depreciation year",
    overRows.every((r) => r.depreciationCents > 0),
  );

  // The same effect on a realistic building basis, found by search rather than
  // by picking a convenient number: $100,001.00 placed in service in January.
  const realistic: FixedAssetInput = {
    ...overshoot,
    assetTag: "REALISTIC-CAP",
    depreciableBasisCents: 100_001_00,
  };
  const realRows = buildDepreciationSchedule(realistic);
  eq(
    realRows.reduce((s, r) => s + r.depreciationCents, 0),
    100_001_00,
    "a realistic $100,001 building also recovers exactly its basis",
  );
  // The final year must EXPLAIN why it differs from the table percentage. It
  // reaches that point by one of two lawful routes: the Pub. 946 final-year
  // sweep (deduct the unrecovered remainder) or the hard cap (never deduct more
  // than basis). Which one fires depends on whether the rounded percentages
  // undershoot or overshoot for this particular basis, so the assertion is on
  // the guarantee — the year is reasoned about and says so — not on which
  // branch happened to produce it.
  const realLastNote = realRows[realRows.length - 1].note ?? "";
  expect(
    "the realistic case explains its final year",
    realLastNote.includes("Final year of the recovery period") ||
      realLastNote.includes("Capped at unrecovered basis"),
  );
  // The cap branch must stay REACHABLE. If the sweep above were ever written so
  // that it swallowed every case, the cap would become dead code and the
  // "never exceed basis" guarantee would rest on nothing. $0.59 placed in
  // service in September is a basis found by search, not chosen for
  // convenience, where the rounded percentages overshoot and the cap bites in
  // recovery year 31 — long before the final-year sweep could apply.
  const capProbe = buildDepreciationSchedule({
    ...overshoot,
    assetTag: "CAP-REACHABLE",
    depreciableBasisCents: 59,
    placedInServiceMonth: 9,
  });
  expect(
    "the cap branch is still reachable before the final year",
    capProbe.some(
      (r) =>
        r.recoveryYear < NONRES_REAL_TABLE_YEARS &&
        (r.note ?? "").includes("Capped at unrecovered basis"),
    ),
  );
  eq(
    capProbe.reduce((s, r) => s + r.depreciationCents, 0),
    59,
    "the capped probe still recovers exactly its basis",
  );

  // PUB. 946 FINAL-YEAR SWEEP (regression guard for defect D7).
  // The published table percentages are rounded to three decimals, so applying
  // them literally can strand basis: a 1-cent asset rounded to zero in all 40
  // years and recovered NOTHING, and a $1,234,567.89 building stranded 2-3
  // cents. Stranded basis is money never deducted and never explained. Every
  // basis must now recover in full, in every month.
  for (const b of [1, 2, 3, 7, 50, 100_00, 123_456_789]) {
    for (let m = 1; m <= 12; m++) {
      const rr = buildDepreciationSchedule({
        ...overshoot,
        assetTag: "SWEEP",
        depreciableBasisCents: b,
        placedInServiceMonth: m,
      });
      eq(
        rr.reduce((s, r) => s + r.depreciationCents, 0),
        b,
        `basis ${b} placed in month ${m} recovers in full`,
      );
    }
  }
  // A disposal must NOT trigger the sweep: the asset left mid-year, so the
  // remaining basis is recovered through gain or loss on the sale, not as a
  // final-year deduction. Deducting the remainder here would overstate the
  // deduction in the year of sale.
  // Derived, not hardcoded: the final recovery year for an asset placed in
  // service in `placedInServiceYear` is that year + 39.
  const dispFinalYear = overshoot.placedInServiceYear + NONRES_REAL_TABLE_YEARS - 1;
  const dispFinal = buildDepreciationSchedule({
    ...overshoot,
    assetTag: "DISPOSED-FINAL-YEAR",
    depreciableBasisCents: 100_000_00,
    placedInServiceMonth: 3,
    disposedYear: dispFinalYear,
    disposedMonth: 6,
  });
  const dispLast = dispFinal[dispFinal.length - 1];
  expect(
    "a disposal in the final recovery year still prorates rather than sweeping",
    (dispLast.note ?? "").includes("Disposal year") &&
      !(dispLast.note ?? "").includes("Final year of the recovery period"),
  );
  expect(
    "a disposal leaves basis unrecovered, to be settled on the sale",
    dispLast.remainingBasisCents > 0,
  );
  // ...and the AMOUNT must be the prorated TABLE rate, not the prorated
  // remainder. Asserting only on the note above was not enough: a mutation that
  // let the sweep fire on a disposal survived, because the disposal branch runs
  // afterwards and overwrites the note — the explanation looked right while the
  // number was wrong. Distinguishing case found by search: a 2-cent basis where
  // the year-40 table rate rounds to 0 but the remainder is 2 cents.
  for (let m = 1; m <= 12; m++) {
    const tinyDisposed = buildDepreciationSchedule({
      ...overshoot,
      assetTag: "DISPOSAL-AMOUNT",
      depreciableBasisCents: 2,
      placedInServiceMonth: m,
      disposedYear: dispFinalYear,
      disposedMonth: 6,
    });
    const finalRow = tinyDisposed.find((r) => r.recoveryYear === NONRES_REAL_TABLE_YEARS);
    if (!finalRow) continue;
    const tableAmount = applyRateCents(
      2,
      macrsRateMilliPct("nonresidential_real", NONRES_REAL_TABLE_YEARS, m),
    );
    const wanted = Number(mulDivRoundHalfUp(BigInt(tableAmount), BigInt(11), BigInt(24)));
    eq(
      finalRow.depreciationCents,
      wanted,
      `disposal in month ${m} prorates the table rate, not the remainder`,
    );
  }

  // The independent guard.
  assertAccumulatedWithinBasis("OK", 100, 100);
  assertAccumulatedWithinBasis("OK-ZERO", 0, 0);
  throws(
    "accumulated one cent over basis is refused",
    () => assertAccumulatedWithinBasis("OVER", 101, 100),
    "FA_ACCUM_EXCEEDS_BASIS",
  );
  throws(
    "negative accumulated is refused",
    () => assertAccumulatedWithinBasis("NEG", -1, 100),
    "FA_ACCUM_EXCEEDS_BASIS",
  );

  // --- F) Disposal proration ----------------------------------------------
  eq(disposalHalfMonths(1), 1, "January disposal = half a month = 1/24");
  eq(disposalHalfMonths(3), 5, "March disposal = 2.5 months = 5/24");
  eq(disposalHalfMonths(12), 23, "December disposal = 11.5 months = 23/24");

  const sold: FixedAssetInput = { ...geiger, disposedYear: 2020, disposedMonth: 3 };
  const soldRows = buildDepreciationSchedule(sold);
  eq(soldRows[soldRows.length - 1].taxYear, 2020, "schedule stops in the disposal year");
  const fullYear2020 = applyRateCents(geiger.depreciableBasisCents, 2564);
  eq(
    soldRows[soldRows.length - 1].depreciationCents,
    Number(mulDivRoundHalfUp(BigInt(fullYear2020), BigInt(5), BigInt(24))),
    "disposal year is the full year times 5/24",
  );
  expect(
    "the disposal year explains itself",
    (soldRows[soldRows.length - 1].note ?? "").includes("mid-month"),
  );
  eq(depreciationForYearCents(sold, 2021), 0, "no depreciation after disposal");

  throws(
    "disposal before placed-in-service is refused",
    () => buildDepreciationSchedule({ ...geiger, disposedYear: 2015, disposedMonth: 1 }),
    "FA_BAD_DISPOSAL",
  );
  throws(
    "a disposal year without a month is refused",
    () => buildDepreciationSchedule({ ...geiger, disposedYear: 2020 }),
    "FA_BAD_DISPOSAL",
  );
  // Same month as placed in service is legal (bought and sold in one month).
  expect(
    "same-month acquisition and disposal is allowed",
    buildDepreciationSchedule({ ...geiger, disposedYear: 2016, disposedMonth: 7 }).length === 1,
  );

  // --- G) Money discipline -------------------------------------------------
  throws("float basis refused", () => assertBasisCents(1234.56), "FA_BAD_BASIS");
  throws("negative basis refused", () => assertBasisCents(-1), "FA_BAD_BASIS");
  throws("NaN basis refused", () => assertBasisCents(Number.NaN), "FA_BAD_BASIS");
  throws("unsafe basis refused", () => assertBasisCents(Number.MAX_SAFE_INTEGER + 2), "FA_BAD_BASIS");
  assertBasisCents(0);

  eq(applyRateCents(100_000_00, 2564), 2_564_00, "$100,000 at 2.564% = $2,564.00");
  eq(applyRateCents(0, 2564), 0, "zero basis yields zero depreciation");
  eq(applyRateCents(100, 500), 1, "half-up rounding: 0.5 cents rounds to 1");
  eq(applyRateCents(100, 499), 0, "just under a half cent rounds to 0");
  throws("a negative rate is refused", () => applyRateCents(100, -1), "FA_BAD_BASIS");

  // A basis large enough that float multiplication would drift. 
  const bigBasis = 9_007_199_254_740_00 % 1_000_000_000_00; // stays a safe integer
  eq(
    applyRateCents(bigBasis, 2564),
    Number(mulDivRoundHalfUp(BigInt(bigBasis), BigInt(2564), BigInt(RATE_SCALE))),
    "large-basis arithmetic matches the BigInt path exactly",
  );

  eq(Number(mulDivRoundHalfUp(BigInt(-100), BigInt(1), BigInt(3))), -33, "negative half-up");
  throws(
    "a zero denominator is refused",
    () => mulDivRoundHalfUp(BigInt(1), BigInt(1), BigInt(0)),
    "FA_BAD_BASIS",
  );

  // --- H) Month and year validation ---------------------------------------
  throws("month 0 refused", () => macrsRateMilliPct("nonresidential_real", 1, 0), "FA_BAD_MONTH");
  throws("month 13 refused", () => macrsRateMilliPct("nonresidential_real", 1, 13), "FA_BAD_MONTH");
  throws(
    "fractional month refused",
    () => macrsRateMilliPct("nonresidential_real", 1, 6.5),
    "FA_BAD_MONTH",
  );
  throws(
    "fractional recovery year refused",
    () => macrsRateMilliPct("nonresidential_real", 1.5, 6),
    "FA_BAD_YEAR",
  );
  throws(
    "an implausible in-service year is refused",
    () => buildDepreciationSchedule({ ...geiger, placedInServiceYear: 216 }),
    "FA_BAD_YEAR",
  );

  // --- I) Purchase-price allocation ---------------------------------------
  // Kitsap assessor 2026 for the Geiger parcel: land 907,240 / building 436,480.
  // Used here ONLY as a ratio shape; the real split needs 2016 evidence.
  const alloc = allocatePurchasePrice(
    525_000_00,
    907_240_00,
    436_480_00,
    "Kitsap County assessed values (illustrative ratio only)",
  );
  eq(
    alloc.landCents + alloc.improvementCents,
    525_000_00,
    "the split reconstitutes the purchase price exactly",
  );
  expect("land takes the larger share on this ratio", alloc.landCents > alloc.improvementCents);
  expect("the allocation records its evidence", alloc.basisNote.includes("Kitsap"));
  expect(
    "land percentage is expressed in milli-percent below 100%",
    alloc.landMilliPct > 0 && alloc.landMilliPct < RATE_SCALE,
  );

  // An odd cent must land on LAND, never vanish.
  const odd = allocatePurchasePrice(1, 1, 1, "even split of a single cent");
  eq(odd.landCents, 1, "the odd cent goes to land");
  eq(odd.improvementCents, 0, "and the building gets nothing rather than half a cent");
  eq(odd.landCents + odd.improvementCents, 1, "still totals one cent");

  throws(
    "an allocation without evidence is refused",
    () => allocatePurchasePrice(100, 50, 50, ""),
    "FA_ALLOCATION_MISMATCH",
  );
  throws(
    "an allocation with a two-character evidence ref is refused",
    () => allocatePurchasePrice(100, 50, 50, "ab"),
    "FA_ALLOCATION_MISMATCH",
  );
  throws(
    "a zero-sum ratio is refused",
    () => allocatePurchasePrice(100, 0, 0, "no reference values"),
    "FA_ALLOCATION_MISMATCH",
  );

  // --- J) Account mapping --------------------------------------------------
  eq(accountCodeForClass("land"), "21100", "land maps to 21100");
  eq(accountCodeForClass("nonresidential_real"), "21300", "a building maps to 21300");
  eq(accountCodeForClass("construction_in_progress"), "21800", "CIP maps to 21800");
  eq(accountCodeForClass("vehicle"), "21700", "vehicles map to 21700");
  expect("accumulated depreciation is the contra account", ACCUMULATED_DEPRECIATION_IS_CONTRA);

  const codes = Object.values(FIXED_ASSET_ACCOUNTS);
  eq(new Set(codes).size, codes.length, "no duplicate fixed-asset account codes");
  expect(
    "every fixed-asset code is a bare 5-digit code in block 2",
    codes.every((c) => /^2[0-9]{4}$/.test(c)),
  );
  expect(
    "every fixed-asset code sits above the inventory range 20000-20890",
    codes.every((c) => Number(c) >= 21000),
  );

  // --- K) The mentor text --------------------------------------------------
  const landText = explainSchedule({
    assetTag: "GEIGER-LAND",
    description: "The Geiger land",
    entityCode: "landholding",
    propertyClass: "land",
    depreciableBasisCents: 0,
    placedInServiceYear: 2016,
    placedInServiceMonth: 7,
  });
  expect("land explanation says it is never depreciated", landText.includes("never depreciated"));
  expect("land explanation mentions the sale", landText.includes("sold"));

  const bldgText = explainSchedule(geiger);
  expect("building explanation names the convention", bldgText.includes("mid-month"));
  expect("building explanation gives the first-year figure", bldgText.includes("$"));
  expect("building explanation warns land is excluded", bldgText.includes("Land is deliberately excluded"));

  const vehicleText = explainSchedule({
    ...geiger,
    propertyClass: "vehicle",
    description: "A delivery van",
  });
  expect("an uncomputed class explains itself instead of throwing", vehicleText.includes("will not guess"));

  // --- L) Derived helpers --------------------------------------------------
  eq(accumulatedThroughCents(geiger, 2015), 0, "nothing accumulated before service");
  eq(accumulatedThroughCents(geiger, 2016), full[0].accumulatedCents, "year one accumulates row one");
  eq(
    adjustedBasisCents(geiger, 2016),
    geiger.depreciableBasisCents - full[0].depreciationCents,
    "adjusted basis is cost less depreciation taken",
  );
  eq(
    adjustedBasisCents(geiger, 2100),
    0,
    "adjusted basis reaches exactly zero, never below",
  );
  // $170,000.00 x 2.564% = $4,358.80. Written as a literal rather than computed
  // with `/`, because a float divide has no business in a money assertion even
  // when it happens to land on an integer.
  eq(depreciationForYearCents(geiger, 2017), 4_358_80, "a full middle year is $4,358.80");

  // A zero-basis asset produces no schedule rather than an error.
  eq(
    buildDepreciationSchedule({ ...geiger, depreciableBasisCents: 0 }).length,
    0,
    "a zero-basis asset has an empty schedule",
  );

  // --- M) Structural sanity ------------------------------------------------
  eq(PROPERTY_CLASSES.length, 8, "eight property classes are declared");
  eq(
    PROPERTY_CLASSES.filter((c) => !c.depreciable).length,
    2,
    "exactly two classes are never depreciable: land and construction in progress",
  );
  eq(
    PROPERTY_CLASSES.filter((c) => c.depreciable && c.computable).length,
    1,
    "exactly one depreciable class is computable in this slice",
  );
  throws(
    "an unknown class is refused rather than defaulted",
    () => propertyClassInfo("made_up" as PropertyClass),
    "FA_UNSUPPORTED_CLASS",
  );
}
