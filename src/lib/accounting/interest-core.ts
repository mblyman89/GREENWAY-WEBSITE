/**
 * src/lib/accounting/interest-core.ts   (books-21)
 *
 * FEDERAL INTEREST, COMPUTED RATHER THAN DESCRIBED — AND THE §6699 PENALTY THE
 * SYSTEM COULD NOT SEE.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * books-16 shipped a penalty engine that was honest about its own hole. Asked
 * for interest, it pushed this caveat and stopped:
 *
 *   "Interest is NOT included in this number. Federal interest runs at the IRC
 *    §6621 underpayment rate ... and it COMPOUNDS DAILY under IRC §6622. Those
 *    quarterly rates are evidenced registry values; ask for interest separately
 *    once the quarter's rate is loaded."
 *
 * That was the right call at the time — a described rate is better than a
 * guessed one — but it left a promise outstanding for five slices. Michael then
 * supplied the rate structure and asked for the statutory text, which is the
 * evidence the caveat was waiting on. So interest is now COMPUTED.
 *
 * ---------------------------------------------------------------------------
 * FOUR THINGS THE STATUTE SAYS THAT A SUMMARY OF IT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * Michael supplied his figures from notes and said, in the same message, "never
 * guess, never assume." Standing rule 1 has no owner exception, so every figure
 * was checked against §6621, §6622, §6651 and §6699 as mirrored in
 * `docs/authorities/federal/`. Four corrections came out of that, and all four
 * are load-bearing here:
 *
 *  1. §6621(c)'s punitive extra FIVE points reaches only a C CORPORATION.
 *     Greenway is an S corporation (§1361(a)(2)), so it CANNOT apply. My own
 *     plan for this slice said the opposite. This engine therefore refuses to
 *     apply hot interest to an S corporation rather than offering it as an
 *     option — see `HOT_INTEREST_NOT_APPLICABLE_TO_S_CORP`.
 *
 *  2. Underpayment and overpayment rates are NOT symmetric, and the asymmetry
 *     runs against the taxpayer. Underpayment is short-term + 3 for everyone.
 *     Overpayment is + 3 for an individual, + 2 for a corporation, and + 0.5 on
 *     the part above $10,000. Three rates, one paragraph.
 *
 *  3. §6622 compounds DAILY, with an express carve-out for the §6654/§6655
 *     estimated-tax additions. Simple interest understates every federal
 *     balance, and understates it more the longer it runs.
 *
 *  4. §6699 — a late Form 1120-S costs $195 (as adjusted) per shareholder per
 *     month, up to twelve months, with NO reference to tax due. It was absent
 *     from this codebase. Proven consequence, measured before this file was
 *     written: asked what a year-late 1120-S costs, the shipped engine said
 *     $0.00, because §6651 is a percentage of a tax an S corporation does not
 *     show. The real floor is over $7,000 at the statutory base.
 *
 * ---------------------------------------------------------------------------
 * UNITS AND EXACTNESS
 * ---------------------------------------------------------------------------
 *
 * Money is integer cents (rule 4). Rates are integer BASIS POINTS — one
 * hundredth of one percent, so 7% is 700 — because §6621(b)(3) rounds the
 * short-term rate to a whole percent and the additions are whole or half
 * points, so basis points hold every legal value exactly with none left over.
 *
 * Daily compounding is done in BigInt with ONE rounding at the very end. The
 * tempting implementation is a floating-point `Math.pow(1 + r/365, days)`,
 * which is wrong twice: it accumulates error over thousands of days, and it
 * silently produces fractional cents that then get rounded in an unspecified
 * direction. Here the balance is carried as an exact scaled integer for the
 * whole period and rounded once, at the end, half up.
 *
 * NO CLOCK. Dates are ISO strings supplied by the caller. An engine that reads
 * the system clock cannot be tested for a date that is not today (rule 15).
 */
import type { StatementRefusal } from "@/lib/accounting/financial-statements-core";

// ---------------------------------------------------------------------------
// 1) UNITS
// ---------------------------------------------------------------------------

/** One hundred percent, in basis points. 100% = 10_000 bp. */
export const BASIS_POINTS_ONE_HUNDRED_PERCENT = 10_000;

/**
 * The additions §6621 makes to the federal short-term rate, in basis points.
 *
 * Named rather than inlined because the whole point of this slice is that these
 * four numbers are DIFFERENT from each other and the difference is easy to
 * miss. Every one is quoted verbatim in `interest-authorities.ts`.
 */
export const SECTION_6621_ADDITIONS = {
  /** §6621(a)(2)(B): "3 percentage points." No corporate variant exists. */
  underpayment: 300,
  /** §6621(a)(1)(B): "3 percentage points" — the non-corporate case. */
  overpaymentNonCorporate: 300,
  /** §6621(a)(1)(B): "(2 percentage points in the case of a corporation)". */
  overpaymentCorporate: 200,
  /** §6621(a)(1) flush text: "0.5 percentage point" above $10,000. */
  overpaymentCorporateAboveThreshold: 50,
  /** §6621(c)(1): "5 percentage points" — C CORPORATIONS ONLY. */
  largeCorporateUnderpayment: 500,
} as const;

/** §6621(a)(1) flush text: the corporate overpayment threshold, in cents. */
export const CORPORATE_OVERPAYMENT_THRESHOLD_CENTS = 10_000_00;

/** §6621(c)(3)(A): "exceeds $100,000", in cents. C corporations only. */
export const LARGE_CORPORATE_UNDERPAYMENT_THRESHOLD_CENTS = 100_000_00;

/** §6699(a): "but not to exceed 12 months". */
export const SECTION_6699_MAX_MONTHS = 12;

/**
 * §6699(b)(1): "$195, multiplied by ... the number of persons who were
 * shareholders".
 *
 * THIS IS THE STATUTORY BASE AND IT IS NOT THE OPERATIVE FIGURE. §6699(e)
 * inflates it annually and has done since 2014. It is exported so tests can
 * prove the engine REFUSES to compute with it rather than quietly falling back
 * to it.
 */
export const SECTION_6699_STATUTORY_BASE_CENTS = 195_00;

/** §6651(a) flush text: "the lesser of $435 or 100 percent of the ... tax". */
export const SECTION_6651_STATUTORY_BASE_CENTS = 435_00;

// ---------------------------------------------------------------------------
// 2) DATES
// ---------------------------------------------------------------------------

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d!
  );
}

/** Whole days from one ISO date to another. Negative if `to` precedes `from`. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Days in the year containing this date: 366 in a leap year, else 365.
 *
 * §6622 says "compounded daily" and does not name a denominator, and the IRS
 * uses the actual number of days in the year — so a leap year divides by 366.
 * Hardcoding 365 would overstate interest slightly in every leap year, which
 * is a small error that never self-corrects.
 */
export function daysInYearOf(iso: string): 365 | 366 {
  const y = Number(iso.slice(0, 4));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return leap ? 366 : 365;
}

// ---------------------------------------------------------------------------
// 3) THE RATE REGISTRY — QUARTERLY, EVIDENCED, AND IT REFUSES ON A GAP
// ---------------------------------------------------------------------------

/**
 * Which §6621 rate is being asked for.
 *
 * Five variants, not two, because §6621 really does define five and collapsing
 * them is the mistake this slice exists to prevent.
 */
export type InterestRateKind =
  | "underpayment"
  | "overpayment_non_corporate"
  | "overpayment_corporate"
  | "overpayment_corporate_above_threshold"
  | "large_corporate_underpayment";

/**
 * One quarter's federal short-term rate, as published.
 *
 * The short-term rate is stored rather than the final rate, and the additions
 * are applied by this engine. Storing the finished rates would mean storing
 * five numbers per quarter that must agree with each other, and any one of
 * them could be typed wrong without contradicting the others.
 */
export type ShortTermRateRow = {
  readonly year: number;
  /** 1, 2, 3 or 4. */
  readonly quarter: 1 | 2 | 3 | 4;
  /** §6621(b)(3), rounded to a whole percent. 7% = 700 basis points. */
  readonly shortTermRateBasisPoints: number;
  /** The revenue ruling this was read off. Rule 11: no document, no rate. */
  readonly evidenceSource: string;
};

/** Which calendar quarter an ISO date falls in. */
export function quarterOf(iso: string): 1 | 2 | 3 | 4 {
  const m = Number(iso.slice(5, 7));
  return (Math.floor((m - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export const INTEREST_REFUSAL_CODES = [
  "RATE_NOT_LOADED_FOR_QUARTER",
  "RATE_NOT_EVIDENCED",
  "RATE_MALFORMED",
  "DUPLICATE_RATE_ROW",
  "INVALID_DATE",
  "PERIOD_RUNS_BACKWARDS",
  "NOT_INTEGER_CENTS",
  "HOT_INTEREST_NOT_APPLICABLE_TO_S_CORP",
  "SECTION_6699_AMOUNT_NOT_EVIDENCED",
  "SECTION_6699_SHAREHOLDER_COUNT_MISSING",
  "SECTION_6651_MINIMUM_NOT_EVIDENCED",
] as const;

export type InterestRefusalCode = (typeof INTEREST_REFUSAL_CODES)[number];

export type InterestRefusal = Omit<StatementRefusal, "code"> & {
  code: InterestRefusalCode;
};

/**
 * A validated table of quarterly short-term rates.
 *
 * Same shape as the books-15 payroll rate registry, and for the same reason:
 * "a wrong rate gets caught, a STALE rate that still looks right does not."
 * There is deliberately no `latest()` and no fallback. A lookup for a quarter
 * that is not loaded REFUSES.
 */
export class ShortTermRateRegistry {
  private readonly rows: readonly ShortTermRateRow[];

  private constructor(rows: readonly ShortTermRateRow[]) {
    this.rows = rows;
  }

  /** Build, or explain exactly what is wrong. Never a partial registry. */
  static create(rows: readonly ShortTermRateRow[]): ShortTermRateRegistry {
    const problems: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const key = `${r.year}Q${r.quarter}`;
      if (!Number.isInteger(r.year) || r.year < 1975 || r.year > 2200) {
        problems.push(`${key}: year is not a plausible whole year`);
      }
      if (![1, 2, 3, 4].includes(r.quarter)) {
        problems.push(`${key}: quarter must be 1, 2, 3 or 4`);
      }
      if (
        !Number.isInteger(r.shortTermRateBasisPoints) ||
        r.shortTermRateBasisPoints < 0 ||
        r.shortTermRateBasisPoints > BASIS_POINTS_ONE_HUNDRED_PERCENT
      ) {
        problems.push(`${key}: short-term rate must be 0..10000 basis points`);
      }
      // §6621(b)(3) rounds to "the nearest full percent", so a stored rate that
      // is not a whole number of percent was mis-transcribed. This has caught
      // nothing yet and exists because it is free and the failure is silent.
      if (Number.isInteger(r.shortTermRateBasisPoints) && r.shortTermRateBasisPoints % 100 !== 0) {
        problems.push(
          `${key}: \u00a76621(b)(3) rounds the short-term rate to a whole percent, but ` +
            `${r.shortTermRateBasisPoints} basis points is not a multiple of 100`,
        );
      }
      if (r.evidenceSource.trim() === "") {
        problems.push(`${key}: no evidence source \u2014 a rate with no document is a memory`);
      }
      if (seen.has(key)) {
        problems.push(`${key}: duplicate row \u2014 the answer would depend on iteration order`);
      }
      seen.add(key);
    }
    if (problems.length > 0) {
      throw new Error(
        `ShortTermRateRegistry: ${problems.length} problem(s)\n  - ${problems.join("\n  - ")}`,
      );
    }
    return new ShortTermRateRegistry([...rows]);
  }

  all(): readonly ShortTermRateRow[] {
    return this.rows;
  }

  /** The row for one quarter, or undefined. Callers must handle undefined. */
  find(year: number, quarter: number): ShortTermRateRow | undefined {
    return this.rows.find((r) => r.year === year && r.quarter === quarter);
  }

  /**
   * THE FINISHED RATE for a date, in basis points, or a refusal.
   *
   * This is where the four §6621 additions are applied, and it is the only
   * place they are applied, so the C-corporation restriction on hot interest
   * cannot be bypassed by a caller assembling its own rate.
   */
  rateFor(
    iso: string,
    kind: InterestRateKind,
  ): { readonly ok: true; readonly basisPoints: number; readonly row: ShortTermRateRow }
    | { readonly ok: false; readonly refusal: InterestRefusal } {
    if (!isIsoDate(iso)) {
      return {
        ok: false,
        refusal: {
          code: "INVALID_DATE",
          message: `"${iso}" is not a valid ISO date (YYYY-MM-DD).`,
          whatToDo: "Supply the date as YYYY-MM-DD.",
          authorityIds: ["irc-6621-b-federal-short-term-rate"],
        },
      };
    }
    const year = Number(iso.slice(0, 4));
    const quarter = quarterOf(iso);
    const row = this.find(year, quarter);
    if (row === undefined) {
      return {
        ok: false,
        refusal: {
          code: "RATE_NOT_LOADED_FOR_QUARTER",
          message:
            `No federal short-term rate is on file for ${year} Q${quarter}, so interest for a ` +
            `period covering ${iso} cannot be computed.`,
          // The remedy explains WHY it will not interpolate, because "just use
          // last quarter's" is the obvious suggestion and it is the bug.
          whatToDo:
            `\u00a76621(b)(1) has the Secretary set this rate quarterly and publish it in a revenue ` +
            `ruling \u2014 it is a fact to be looked up, not a formula to be derived. Find the ruling ` +
            `for ${year} Q${quarter} and load it. This engine will not carry the previous ` +
            `quarter's rate forward: that produces arithmetic which reconciles perfectly against ` +
            `itself and is silently wrong against the IRS.`,
          authorityIds: ["irc-6621-b-federal-short-term-rate"],
        },
      };
    }
    const addition =
      kind === "underpayment"
        ? SECTION_6621_ADDITIONS.underpayment
        : kind === "overpayment_non_corporate"
          ? SECTION_6621_ADDITIONS.overpaymentNonCorporate
          : kind === "overpayment_corporate"
            ? SECTION_6621_ADDITIONS.overpaymentCorporate
            : kind === "overpayment_corporate_above_threshold"
              ? SECTION_6621_ADDITIONS.overpaymentCorporateAboveThreshold
              : SECTION_6621_ADDITIONS.largeCorporateUnderpayment;
    return { ok: true, basisPoints: row.shortTermRateBasisPoints + addition, row };
  }
}

// ---------------------------------------------------------------------------
// 4) §6622 DAILY COMPOUNDING
// ---------------------------------------------------------------------------

/**
 * Scale used to carry the compounding balance exactly.
 *
 * Twelve digits of headroom below one cent. Chosen so that thousands of daily
 * multiplications cannot accumulate a visible error, while staying far inside
 * BigInt's exact range.
 */
const COMPOUND_SCALE = BigInt("1000000000000");

/**
 * Compound one balance daily at one rate for a whole number of days.
 *
 * Returns the INTEREST, in cents, rounded half up exactly once at the end.
 *
 * Exposed on its own, rather than buried inside the period walker, because it
 * is the one piece of arithmetic here that is worth checking against an
 * independent calculation by hand.
 */
export function compoundDailyInterestCents(
  principalCents: number,
  annualRateBasisPoints: number,
  days: number,
  daysInYear: 365 | 366,
): number {
  if (!Number.isInteger(principalCents)) {
    throw new Error(`compoundDailyInterestCents: principalCents must be an integer, got ${principalCents}`);
  }
  if (!Number.isInteger(annualRateBasisPoints) || annualRateBasisPoints < 0) {
    throw new Error(
      `compoundDailyInterestCents: rate must be a non-negative integer in basis points, got ${annualRateBasisPoints}`,
    );
  }
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`compoundDailyInterestCents: days must be a non-negative integer, got ${days}`);
  }
  if (days === 0 || principalCents === 0 || annualRateBasisPoints === 0) return 0;

  const negative = principalCents < 0;
  const magnitude = BigInt(negative ? -principalCents : principalCents);

  // daily rate = annual / (10000 * daysInYear), held as a scaled numerator.
  const denominator = BigInt(BASIS_POINTS_ONE_HUNDRED_PERCENT) * BigInt(daysInYear);
  const dailyNumerator = BigInt(annualRateBasisPoints);

  let balance = magnitude * COMPOUND_SCALE;
  for (let i = 0; i < days; i += 1) {
    // balance *= (1 + dailyRate), exactly, with truncation only at the scale
    // floor — twelve digits below a cent, so it cannot reach the answer.
    balance = balance + (balance * dailyNumerator) / denominator;
  }

  const grossScaled = balance - magnitude * COMPOUND_SCALE;
  // ONE rounding, half up, at the very end.
  const cents = (grossScaled * BigInt(2) + COMPOUND_SCALE) / (COMPOUND_SCALE * BigInt(2));
  const result = Number(cents);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`compoundDailyInterestCents: result ${cents.toString()} exceeds MAX_SAFE_INTEGER`);
  }
  return negative ? -result : result;
}

// ---------------------------------------------------------------------------
// 5) INTEREST OVER A PERIOD SPANNING QUARTERS
// ---------------------------------------------------------------------------

/** Who owes, or is owed. This decides which §6621 rate applies. */
export type TaxpayerKind = "individual" | "s_corporation" | "c_corporation";

export type InterestRunInput = {
  readonly principalCents: number;
  /** Inclusive first day interest runs. */
  readonly fromDateIso: string;
  /** Exclusive last day. Interest is charged for [from, to). */
  readonly toDateIso: string;
  readonly direction: "underpayment" | "overpayment";
  readonly taxpayer: TaxpayerKind;
  /**
   * Ask for the §6621(c) "hot interest" rate. Only ever legal for a C
   * corporation, and this engine refuses rather than silently ignoring it.
   */
  readonly requestLargeCorporateRate?: boolean;
};

export type InterestSegment = {
  readonly year: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly days: number;
  readonly rateBasisPoints: number;
  readonly interestCents: number;
  readonly openingBalanceCents: number;
  readonly evidenceSource: string;
};

export type InterestRunResult =
  | { readonly ok: false; readonly refusals: readonly InterestRefusal[] }
  | {
      readonly ok: true;
      readonly interestCents: number;
      readonly endingBalanceCents: number;
      readonly segments: readonly InterestSegment[];
      /** Rule 29: the explanation is part of the deliverable. */
      readonly plainEnglish: string;
    };

/** The last day (exclusive) of the quarter containing `iso`. */
function endOfQuarterExclusive(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const q = quarterOf(iso);
  const endMonth = q * 3; // 3, 6, 9, 12
  const nextY = endMonth === 12 ? y + 1 : y;
  const nextM = endMonth === 12 ? 1 : endMonth + 1;
  return `${String(nextY).padStart(4, "0")}-${String(nextM).padStart(2, "0")}-01`;
}

/**
 * Which of the five rates applies, given who the taxpayer is and how much is
 * at stake.
 *
 * Split out and exported because it encodes corrections 1 and 2 above, and
 * those are the findings most likely to be "simplified" back into one rate by
 * somebody who has not read §6621 side by side with §1361(a)(2).
 */
export function rateKindFor(
  input: Pick<InterestRunInput, "direction" | "taxpayer" | "principalCents" | "requestLargeCorporateRate">,
): { readonly ok: true; readonly kind: InterestRateKind } | { readonly ok: false; readonly refusal: InterestRefusal } {
  const isCorporation = input.taxpayer === "s_corporation" || input.taxpayer === "c_corporation";

  if (input.direction === "underpayment") {
    if (input.requestLargeCorporateRate === true) {
      if (input.taxpayer !== "c_corporation") {
        return {
          ok: false,
          refusal: {
            code: "HOT_INTEREST_NOT_APPLICABLE_TO_S_CORP",
            message:
              `The \u00a76621(c) "large corporate underpayment" rate \u2014 five points over short-term ` +
              `instead of three \u2014 was requested for ${input.taxpayer === "s_corporation" ? "an S corporation" : "an individual"}, ` +
              `and it cannot apply.`,
            // Stated as GOOD news, because it is: this is a real benefit of the
            // election and nobody lists it among the reasons to make one.
            whatToDo:
              `Nothing to do \u2014 this is in Greenway's favour. \u00a76621(c)(3)(A) defines a large ` +
              `corporate underpayment as an underpayment "by a C corporation", and \u00a71361(a)(2) ` +
              `defines a C corporation as one that is not an S corporation for the year. Greenway ` +
              `has been an S corporation since about 2015, so the punitive rate is unavailable to ` +
              `the IRS here and the ordinary three points apply however large the assessment. The ` +
              `one caveat worth remembering: this protection lasts exactly as long as the election ` +
              `does. Break the election and the year becomes a C year retroactively, and this rate ` +
              `switches on with it.`,
            authorityIds: [
              "irc-6621-c-large-corporate-underpayment",
              "irc-1361-a-s-and-c-corporation-defined",
            ],
          },
        };
      }
      return { ok: true, kind: "large_corporate_underpayment" };
    }
    // §6621(a)(2) has no corporate variant. Same three points for everyone.
    return { ok: true, kind: "underpayment" };
  }

  // Overpayment. Three possibilities, per §6621(a)(1) and its flush text.
  if (!isCorporation) return { ok: true, kind: "overpayment_non_corporate" };
  return {
    ok: true,
    kind:
      input.principalCents > CORPORATE_OVERPAYMENT_THRESHOLD_CENTS
        ? "overpayment_corporate_above_threshold"
        : "overpayment_corporate",
  };
}

/**
 * Compute interest across a period, re-rating at every quarter boundary and
 * compounding daily throughout.
 *
 * The period is walked quarter by quarter because the rate changes quarterly
 * (§6621(b)(2)(A)) but the compounding does not pause at the boundary — the
 * closing balance of one quarter is the opening balance of the next. Getting
 * that wrong in either direction is the classic error: rate the whole period at
 * one quarter's rate, or restart the compounding each quarter.
 */
export function computeInterest(
  input: InterestRunInput,
  registry: ShortTermRateRegistry,
): InterestRunResult {
  const refusals: InterestRefusal[] = [];

  if (!Number.isInteger(input.principalCents)) {
    refusals.push({
      code: "NOT_INTEGER_CENTS",
      message: `The principal was given as ${input.principalCents}, which is not a whole number of cents.`,
      whatToDo: "Money is integer cents everywhere in this system. Convert before calling.",
      authorityIds: ["irc-6622-daily-compounding"],
    });
  }
  for (const [label, iso] of [
    ["from", input.fromDateIso],
    ["to", input.toDateIso],
  ] as const) {
    if (!isIsoDate(iso)) {
      refusals.push({
        code: "INVALID_DATE",
        message: `The ${label} date "${iso}" is not a valid ISO date (YYYY-MM-DD).`,
        whatToDo: "Supply both dates as YYYY-MM-DD.",
        authorityIds: ["irc-6622-daily-compounding"],
      });
    }
  }
  if (refusals.length > 0) return { ok: false, refusals };

  if (daysBetween(input.fromDateIso, input.toDateIso) < 0) {
    return {
      ok: false,
      refusals: [
        {
          code: "PERIOD_RUNS_BACKWARDS",
          message:
            `The period runs from ${input.fromDateIso} to ${input.toDateIso}, which ends before it ` +
            `begins.`,
          whatToDo: "Check the two dates. Interest is charged for [from, to).",
          authorityIds: ["irc-6622-daily-compounding"],
        },
      ],
    };
  }

  const kindResult = rateKindFor(input);
  if (!kindResult.ok) return { ok: false, refusals: [kindResult.refusal] };
  const kind = kindResult.kind;

  const segments: InterestSegment[] = [];
  let balance = input.principalCents;
  let cursor = input.fromDateIso;

  while (daysBetween(cursor, input.toDateIso) > 0) {
    const boundary = endOfQuarterExclusive(cursor);
    const segmentEnd = daysBetween(boundary, input.toDateIso) < 0 ? input.toDateIso : boundary;
    const days = daysBetween(cursor, segmentEnd);

    const rate = registry.rateFor(cursor, kind);
    if (!rate.ok) {
      // Collect and keep walking, so one call reports EVERY missing quarter
      // rather than sending Michael back once per quarter.
      refusals.push(rate.refusal);
      cursor = segmentEnd;
      continue;
    }

    const interest = compoundDailyInterestCents(
      balance,
      rate.basisPoints,
      days,
      daysInYearOf(cursor),
    );
    segments.push({
      year: Number(cursor.slice(0, 4)),
      quarter: quarterOf(cursor),
      days,
      rateBasisPoints: rate.basisPoints,
      interestCents: interest,
      openingBalanceCents: balance,
      evidenceSource: rate.row.evidenceSource,
    });
    balance += interest;
    cursor = segmentEnd;
  }

  if (refusals.length > 0) return { ok: false, refusals };

  const total = balance - input.principalCents;
  const pct = (n: number): string => (n / 100).toFixed(2);
  const rateList = segments
    .map((s) => `${s.year} Q${s.quarter} at ${pct(s.rateBasisPoints)}% for ${s.days} day(s)`)
    .join(", ");

  return {
    ok: true,
    interestCents: total,
    endingBalanceCents: balance,
    segments,
    plainEnglish:
      `Interest on $${(input.principalCents / 100).toFixed(2)} from ${input.fromDateIso} to ` +
      `${input.toDateIso} comes to $${(total / 100).toFixed(2)}, bringing the balance to ` +
      `$${(balance / 100).toFixed(2)}. The rate is not one number: \u00a76621(b) resets it every ` +
      `quarter, so this period was charged at ${segments.length} different rate(s) \u2014 ${rateList}. ` +
      `It compounds daily under \u00a76622, which is why the total is a little more than multiplying ` +
      `the balance by the rate would suggest, and why the gap widens the longer a balance sits.`,
  };
}

// ---------------------------------------------------------------------------
// 6) §6699 — THE PENALTY FOR A LATE FORM 1120-S
// ---------------------------------------------------------------------------

export type Section6699Input = {
  /** Months or part months late. §6699(a) caps the charge at 12. */
  readonly monthsLate: number;
  /**
   * §6699(b)(2): "the number of persons who were shareholders in the S
   * corporation during ANY PART of the taxable year." Not the number at year
   * end, and nothing to do with ownership percentages.
   */
  readonly shareholderCount: number | null;
  /**
   * The §6699(e) inflation-adjusted per-shareholder monthly amount for the
   * calendar year the return was REQUIRED to be filed, in cents.
   *
   * `null` refuses. The $195 in the statute has not been the operative figure
   * since 2014 and this engine will not fall back to it.
   */
  readonly perShareholderPerMonthCents: number | null;
  /** §6699(a): "unless it is shown that such failure is due to reasonable cause." */
  readonly reasonableCauseEstablished: boolean;
};

export type Section6699Result =
  | { readonly ok: false; readonly refusals: readonly InterestRefusal[] }
  | {
      readonly ok: true;
      readonly penaltyCents: number;
      readonly monthsCharged: number;
      readonly plainEnglish: string;
    };

/**
 * Compute the §6699 penalty for filing Form 1120-S late.
 *
 * THE REASON THIS FUNCTION EXISTS. Before books-21 nothing in this codebase
 * mentioned §6699. Asked what a year-late 1120-S cost, the penalty engine
 * applied §6651 — a percentage of the tax shown on the return — to an S
 * corporation, which normally shows no tax, and answered $0.00. Measured, not
 * assumed. A system that reports a real five-figure penalty as nothing does not
 * merely fail to warn; it recommends the behaviour it exists to prevent.
 */
export function computeSection6699Penalty(input: Section6699Input): Section6699Result {
  const refusals: InterestRefusal[] = [];

  if (input.shareholderCount === null || !Number.isInteger(input.shareholderCount) || input.shareholderCount < 1) {
    refusals.push({
      code: "SECTION_6699_SHAREHOLDER_COUNT_MISSING",
      message:
        "The \u00a76699 penalty multiplies by the number of shareholders, and that count is missing " +
        "or is not a whole number of at least one.",
      whatToDo:
        "\u00a76699(b)(2) counts \"the number of persons who were shareholders in the S corporation " +
        "during any part of the taxable year\" \u2014 ANY part. Somebody who held stock for a single " +
        "day in January counts in full, and counts for all twelve months. For Greenway the answer " +
        "is three: Michael, his mother and his grandfather. Note this has nothing to do with the " +
        "85/10/5 split; a 5% holder costs exactly as much as an 85% holder.",
      authorityIds: ["irc-6699-s-corp-failure-to-file"],
    });
  }

  if (
    input.perShareholderPerMonthCents === null ||
    !Number.isInteger(input.perShareholderPerMonthCents) ||
    input.perShareholderPerMonthCents < SECTION_6699_STATUTORY_BASE_CENTS
  ) {
    refusals.push({
      code: "SECTION_6699_AMOUNT_NOT_EVIDENCED",
      message:
        `The \u00a76699(e) inflation-adjusted amount for the year this return was due is not on file ` +
        `(got ${String(input.perShareholderPerMonthCents)}), so the penalty cannot be computed.`,
      whatToDo:
        "\u00a76699(b)(1) says $195, but \u00a76699(e) has inflated that every year since 2014 and the " +
        "adjusted figure is published in a revenue procedure. This engine will not compute from " +
        "the $195 base, because after a decade of adjustments that would understate a " +
        "twelve-month exposure by a wide margin. Look up the figure for the calendar year the " +
        "return was REQUIRED to be filed \u2014 not the tax year it covers \u2014 and load it. It will be a " +
        "multiple of $5, because \u00a76699(e)(2) rounds to the next lowest $5.",
      authorityIds: ["irc-6699-e-inflation-adjustment", "irc-6699-s-corp-failure-to-file"],
    });
  }

  if (!Number.isInteger(input.monthsLate) || input.monthsLate < 0) {
    refusals.push({
      code: "RATE_MALFORMED",
      message: `Months late must be a whole number of zero or more, got ${input.monthsLate}.`,
      whatToDo:
        "\u00a76699(a) charges "+
        "\"for each month (or fraction thereof)\", so round any part month UP to a whole month " +
        "before calling. One day late is one month.",
      authorityIds: ["irc-6699-s-corp-failure-to-file"],
    });
  }

  if (refusals.length > 0) return { ok: false, refusals };

  const shareholders = input.shareholderCount as number;
  const perMonth = input.perShareholderPerMonthCents as number;

  if (input.reasonableCauseEstablished) {
    return {
      ok: true,
      penaltyCents: 0,
      monthsCharged: 0,
      plainEnglish:
        "No \u00a76699 penalty, because reasonable cause has been established. Worth knowing that " +
        "this defence is broader here than elsewhere: \u00a76699(a) asks only for \"reasonable cause\", " +
        "where \u00a76651 requires reasonable cause AND that the failure was not due to willful " +
        "neglect. It still has to be argued and documented \u2014 it is a defence, not a plan.",
    };
  }

  const monthsCharged = Math.min(input.monthsLate, SECTION_6699_MAX_MONTHS);
  const penalty = perMonth * shareholders * monthsCharged;
  const capped = input.monthsLate > SECTION_6699_MAX_MONTHS;

  return {
    ok: true,
    penaltyCents: penalty,
    monthsCharged,
    plainEnglish:
      `Filing the 1120-S ${input.monthsLate} month(s) late costs $${(penalty / 100).toFixed(2)}: ` +
      `$${(perMonth / 100).toFixed(2)} per shareholder per month, times ${shareholders} ` +
      `shareholders, times ${monthsCharged} month(s)` +
      (capped ? ` (capped at ${SECTION_6699_MAX_MONTHS} months by \u00a76699(a))` : "") +
      `. Notice what is NOT in that sentence: the tax. \u00a76699 makes no reference to how much tax ` +
      `is due, so a return showing nothing owed carries exactly the same penalty as one showing a ` +
      `million. That is why this penalty and not \u00a76651 is the one that matters for an S ` +
      `corporation, and it is charged for each month "or fraction thereof" \u2014 so one day late is a ` +
      `full month, and there is no such thing as being slightly late.`,
  };
}

// ---------------------------------------------------------------------------
// 7) §6651(j) — THE INFLATION-ADJUSTED MINIMUM
// ---------------------------------------------------------------------------

/**
 * The §6651(a) 60-day minimum for one filing year, in cents.
 *
 * A dated registry rather than a constant, for the same reason the payroll
 * rates are: the figure changes annually and a stale one still looks right.
 * Michael supplied 2023-2026 and every figure is a multiple of $5, which is
 * what §6651(j)(2)'s next-lowest-$5 rounding requires — a cheap check that
 * could have failed and did not.
 */
export type Section6651MinimumRow = {
  /** The calendar year the return was REQUIRED to be filed. Not the tax year. */
  readonly filingYear: number;
  readonly minimumCents: number;
  readonly evidenceSource: string;
};

/**
 * Look up the minimum for a filing year.
 *
 * Refuses on a miss. It does NOT fall back to the $435 statutory base, which
 * would be the tempting default and would understate the floor by $90 in 2026.
 */
export function section6651MinimumFor(
  filingYear: number,
  rows: readonly Section6651MinimumRow[],
): { readonly ok: true; readonly minimumCents: number; readonly evidenceSource: string }
  | { readonly ok: false; readonly refusal: InterestRefusal } {
  const row = rows.find((r) => r.filingYear === filingYear);
  if (row === undefined) {
    return {
      ok: false,
      refusal: {
        code: "SECTION_6651_MINIMUM_NOT_EVIDENCED",
        message:
          `The \u00a76651(j) inflation-adjusted minimum for returns required to be filed in ` +
          `${filingYear} is not on file.`,
        whatToDo:
          `The statute says $435 and that figure is correct as the BASE \u2014 \u00a76651(j) inflates it ` +
          `annually, and the adjusted amount is published in a revenue procedure. Load the figure ` +
          `for ${filingYear} rather than using the base, which would understate the floor. It will ` +
          `be a multiple of $5. Note the year that matters is the one the return was required to ` +
          `be FILED in, not the tax year it covers.`,
        authorityIds: ["irc-6651-j-inflation-adjustment", "irc-6651-a-sixty-day-minimum"],
      },
    };
  }
  return { ok: true, minimumCents: row.minimumCents, evidenceSource: row.evidenceSource };
}

/**
 * Validate a set of §6651(j) rows against the statute's own rounding rule.
 *
 * Rule 22 applied to data rather than code: the figures came from Michael's
 * notes, and §6651(j)(2) gives a mechanical test they must pass. Returns the
 * problems, empty if clean.
 */
export function validateSection6651Rows(rows: readonly Section6651MinimumRow[]): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    if (!Number.isInteger(r.filingYear) || r.filingYear < 2021) {
      // §6651(j) applies to "any return required to be filed in a calendar year
      // beginning after 2020", so an adjusted figure before 2021 is incoherent.
      problems.push(`${r.filingYear}: \u00a76651(j) only adjusts returns due after 2020`);
    }
    if (!Number.isInteger(r.minimumCents) || r.minimumCents < SECTION_6651_STATUTORY_BASE_CENTS) {
      problems.push(
        `${r.filingYear}: the adjusted minimum cannot be below the $435 statutory base, got ${r.minimumCents}`,
      );
    }
    if (Number.isInteger(r.minimumCents) && r.minimumCents % 500 !== 0) {
      problems.push(
        `${r.filingYear}: \u00a76651(j)(2) rounds to a multiple of $5, but ${r.minimumCents} cents is not`,
      );
    }
    if (r.evidenceSource.trim() === "") {
      problems.push(`${r.filingYear}: no evidence source`);
    }
    if (seen.has(r.filingYear)) problems.push(`${r.filingYear}: duplicate row`);
    seen.add(r.filingYear);
  }
  return problems;
}
