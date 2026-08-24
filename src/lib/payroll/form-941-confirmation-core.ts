/**
 * src/lib/payroll/form-941-confirmation-core.ts   (books-48)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SMALL STEP AT THE BOTTOM OF THE 941 SCREEN — "WHAT DID YOU ACTUALLY FILE?"
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS, VERBATIM (standing rule 1)
 *
 *   "then I want you to complete the 941 slice about the small confirmation
 *    step on the 941 screen ... if there are lessons to connect or use for the
 *    941 confirmation step, please add them and make them easy to read and
 *    understand. explain why we are doing this."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE PROBLEM THIS SOLVES, IN ONE PARAGRAPH
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Migration 0204 created `filed_form_941_totals`. `reconcileW3To941s` in
 * form-w2-core.ts reads it and compares the W-3 against the year's four 941s —
 * the exact comparison the IRS says it performs automatically. That engine is
 * built, tested, and wired into the W-2 screen.
 *
 * And it has never run, because NOTHING PUTS A ROW IN THE TABLE. The W-2 screen
 * reports the comparison as "not run" in gold, honestly, forever. A finished
 * engine reading an empty table is standing rule 50 at its most expensive: a
 * feature that looks complete from the outside and does nothing.
 *
 * This module is the missing half. It turns what Michael typed off a filed
 * return into either a storable row or a list of reasons why not.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY MICHAEL TYPES THESE FIGURES IN BY HAND, WHICH LOOKS LIKE A DESIGN FLAW
 * ───────────────────────────────────────────────────────────────────────────
 *
 * READ THIS BEFORE "IMPROVING" THIS FILE. The obvious improvement is to fill
 * these seven figures in from the return this very screen just computed. It
 * would save five minutes a quarter, it would eliminate typos, and it would
 * DESTROY THE ENTIRE VALUE OF THE FEATURE.
 *
 * The W-2 side of the reconciliation descends from `payroll_ytd_accumulators`,
 * which is fed from `payroll_run_lines`. The 941 screen's computed return
 * descends from `payroll_run_lines` too. If the "what I filed" side were
 * pre-filled from the computed side, both sides of the comparison would share
 * one ancestor. They would then agree TRIVIALLY, ALWAYS — including in the
 * quarter where the return went to the IRS with a transposed digit, or was
 * filed from Aatrix before this system existed, or was amended, or was filed
 * off a spreadsheet that had one pay run missing.
 *
 * Five green ticks, forever, on the highest-stakes screen in the payroll
 * module. That is standing rule 39 — a gate that parses nothing approves
 * everything — and it is strictly worse than having no reconciliation at all,
 * because a check that is always green teaches Michael to trust it.
 *
 * The comparison is worth something for exactly one reason: THE TWO SIDES ARE
 * INDEPENDENT. One side is what this software computes. The other side is what
 * a human being read off a piece of paper the government has already received.
 * The typing IS the feature. Keep it that way.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE MAY AND MAY NOT DO
 * ───────────────────────────────────────────────────────────────────────────
 *
 * It is PURE. No `node:fs`, no `server-only`, no Supabase, no clock. Given the
 * same draft it returns the same answer, which is what lets the gate assert the
 * wording as well as the arithmetic, and what lets the same function run in the
 * browser as a courtesy and on the server as the actual gate.
 *
 * It performs NO tax arithmetic. Not a rate, not a cap, not a rounding. It
 * parses what a human typed and checks it for internal impossibility. The one
 * place it touches a rate is `plausibleFicaTaxCents`, and §5 explains at length
 * why that is a WARNING and never a refusal.
 */

import { OASDI_COMBINED_MILLI_PCT, MEDICARE_COMBINED_MILLI_PCT } from "./form-941-core";
import { applyMilliPct } from "./payroll-withholding-core";
/*
 * `parseMoneyToCents` is IMPORTED, not reimplemented. Two money parsers in one
 * payroll module is how "1,234" becomes 1234 cents on one screen and 123400 on
 * another (standing rule 25).
 */
import { parseMoneyToCents } from "./wage-order-entry-core";

/* ═════════════════════════════════════════════════════════════════════════
 * §1  WHAT THE HUMAN TYPES
 *
 * Every money field is a STRING, exactly as typed, and is parsed rather than
 * received as a number. A `number | null` field would push parsing into the
 * component, where "1,234.56" silently becomes NaN and NaN silently becomes 0,
 * and a zero that came from a parse failure is indistinguishable from a zero
 * the human meant. Rule 62d: never invent a default.
 * ═════════════════════════════════════════════════════════════════════════ */

export type FiledForm941Draft = {
  /** Four-digit year, as typed. */
  readonly taxYearText: string;
  /** "1" | "2" | "3" | "4", as typed. */
  readonly quarterText: string;
  /** Line 3 — federal income tax withheld. */
  readonly line3Text: string;
  /** Line 5a column 1 — social security WAGES. */
  readonly line5aWagesText: string;
  /** Line 5a column 2 — social security TAX, both halves. */
  readonly line5aTaxText: string;
  /** Line 5c column 1 — Medicare WAGES. */
  readonly line5cWagesText: string;
  /**
   * Lines 5c + 5d column 2 — Medicare TAX, added together.
   *
   * ONE FIELD FOR TWO LINES, DELIBERATELY. `Form941YearTotals` carries a
   * single `medicareTaxCents`, so splitting it here would create a subtotal
   * this module owns and the engine also owns — two answers to one question
   * (rule 25). The 5d part is captured separately below because it is needed
   * for a DIFFERENT purpose, not to re-derive this total.
   */
  readonly line5cAnd5dTaxText: string;
  /**
   * Line 5d column 2 — Additional Medicare Tax, on its own.
   *
   * ═══ THE FIELD THAT PREVENTS A FALSE ALARM. ═══
   *
   * Additional Medicare Tax is the ONE FICA figure with no employer match: the
   * employee pays 0.9% on pay above $200,000 and Greenway pays nothing. Every
   * other figure on a 941 is both halves and therefore doubles against the
   * W-3.
   *
   * `reconcileW3To941s` needs this separately so it can compute
   *
   *     expected = (box6 − unmatchedAdditional) × 2 + unmatchedAdditional
   *
   * If it were folded into the 5c+5d total and doubled with the rest, a
   * perfectly correct return would report a difference exactly equal to the
   * Additional Medicare amount. That false alarm is expensive in a specific
   * way: it teaches Michael the red line is usually wrong, and the day it is
   * right he will not believe it.
   *
   * On Greenway's numbers today this is "0.00" every quarter — nobody is paid
   * over $200,000. It is still a required field, because a zero somebody typed
   * is a fact and a zero the software assumed is a guess.
   */
  readonly line5dAddlTaxText: string;
  /** ISO yyyy-mm-dd. The date the return was actually filed. */
  readonly filedOnText: string;
  /**
   * Where these figures came from, in the human's own words.
   *
   * NOT optional, and not free decoration. In eighteen months this row is
   * evidence, and "which piece of paper did this come from" is the question it
   * has to answer. "Aatrix Q1 2027, confirmation 0-053-958-352" resolves an
   * SSA letter in ten minutes. A blank field means the row is a number with no
   * provenance, which is indistinguishable from a number somebody made up.
   */
  readonly sourceNoteText: string;
};

export const EMPTY_FILED_941_DRAFT: FiledForm941Draft = {
  taxYearText: "",
  quarterText: "",
  line3Text: "",
  line5aWagesText: "",
  line5aTaxText: "",
  line5cWagesText: "",
  line5cAnd5dTaxText: "",
  line5dAddlTaxText: "",
  filedOnText: "",
  sourceNoteText: "",
};

/* ═════════════════════════════════════════════════════════════════════════
 * §2  THE REFUSALS
 *
 * Each code names ONE thing that is wrong. Codes are exported as data so the
 * gate can prove every one is both reachable and taught (rule 43), rather than
 * trusting a hand-maintained list in a test.
 * ═════════════════════════════════════════════════════════════════════════ */

export type FiledForm941RefusalCode =
  /** The year is absent, not a number, or outside the migration's own bounds. */
  | "YEAR_NOT_VALID"
  /** The quarter is absent or is not 1, 2, 3 or 4. */
  | "QUARTER_NOT_VALID"
  /** A money field could not be parsed. Never salvaged, never defaulted. */
  | "AMOUNT_NOT_A_NUMBER"
  /** A money field parsed to a negative. The column forbids it. */
  | "AMOUNT_NEGATIVE"
  /** The filing date is absent or is not a real calendar date. */
  | "FILED_ON_NOT_VALID"
  /** The filing date is before the quarter it reports even ended. */
  | "FILED_ON_BEFORE_QUARTER_END"
  /** The source note is blank. The column forbids it and so do we. */
  | "SOURCE_NOTE_MISSING"
  /** Line 5d exceeds the combined 5c+5d total it is supposed to be part of. */
  | "ADDL_MEDICARE_EXCEEDS_TOTAL"
  /** Social security wages exceed Medicare wages, which no quarter produces. */
  | "SS_WAGES_EXCEED_MEDICARE_WAGES";

export const ALL_FILED_941_REFUSAL_CODES: readonly FiledForm941RefusalCode[] = [
  "YEAR_NOT_VALID",
  "QUARTER_NOT_VALID",
  "AMOUNT_NOT_A_NUMBER",
  "AMOUNT_NEGATIVE",
  "FILED_ON_NOT_VALID",
  "FILED_ON_BEFORE_QUARTER_END",
  "SOURCE_NOTE_MISSING",
  "ADDL_MEDICARE_EXCEEDS_TOTAL",
  "SS_WAGES_EXCEED_MEDICARE_WAGES",
] as const;

export type FiledForm941Refusal = {
  readonly code: FiledForm941RefusalCode;
  /** Which field it attaches to, so the form can mark it. Null when general. */
  readonly field: keyof FiledForm941Draft | null;
  /** What is wrong, as a whole sentence safe to render on its own. */
  readonly what: string;
  /** The ONE thing that would clear it. Never "correct the data". */
  readonly fix: string;
};

/* ═════════════════════════════════════════════════════════════════════════
 * §3  WHAT A GOOD DRAFT BECOMES
 *
 * The field names deliberately MIRROR THE COLUMN NAMES in migration 0204
 * rather than being prettier. This object is written straight into the table,
 * and a rename between here and there is a silent column swap — two bigint
 * columns that both hold plausible money will not error, they will just be
 * wrong forever.
 * ═════════════════════════════════════════════════════════════════════════ */

export type ValidatedFiledForm941 = {
  readonly taxYear: number;
  readonly quarter: 1 | 2 | 3 | 4;
  readonly line3FederalIncomeTaxCents: number;
  readonly line5aSsWagesCents: number;
  readonly line5aSsTaxCents: number;
  readonly line5cMedicareWagesCents: number;
  readonly line5c5dMedicareTaxCents: number;
  readonly line5dAddlMedicareTaxCents: number;
  readonly filedOn: string;
  readonly sourceNote: string;
};

export type FiledForm941Validation =
  | { readonly ok: true; readonly value: ValidatedFiledForm941; readonly warnings: readonly FiledForm941Warning[] }
  | { readonly ok: false; readonly refusals: readonly FiledForm941Refusal[] };

/* ═════════════════════════════════════════════════════════════════════════
 * §4  PARSING — SHARED WITH THE GARNISHMENT SCREEN, NOT REIMPLEMENTED
 *
 * `parseMoneyToCents` and the ISO-date check are duplicated here in SPIRIT but
 * NOT in code: they are imported. Two money parsers in one payroll module is
 * how "1,234" becomes 1234 cents in one screen and 123400 in another.
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * A strict ISO date that really exists on the calendar.
 *
 * Deliberately rejects "8/22/2026". An ambiguous format is how 03/04 becomes
 * March the fourth in one place and the fourth of March in another, and the
 * `filed_on` column is compared as a date downstream.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map((p) => Number.parseInt(p, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  // The day bound comes from the calendar, not from a 31 everywhere. Date.UTC
  // normalises an overflow, so a mismatch means the day was not real.
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * The last day of a quarter, as an ISO string.
 *
 * Stated as a literal table rather than computed, because there are exactly
 * four answers and they never change. A computed version would need month
 * arithmetic and leap-year handling to produce four constants.
 */
const QUARTER_END_MONTH_DAY: Record<1 | 2 | 3 | 4, string> = {
  1: "03-31",
  2: "06-30",
  3: "09-30",
  4: "12-31",
};

export function quarterEndIso(taxYear: number, quarter: 1 | 2 | 3 | 4): string {
  return `${taxYear}-${QUARTER_END_MONTH_DAY[quarter]}`;
}

/**
 * The bounds migration 0204 puts on `tax_year`, restated so the form can
 * refuse before a round trip.
 *
 * These are not independent judgements. They are a deliberate MIRROR of the
 * check constraint, and `FILED_941_YEAR_BOUNDS_MATCH_MIGRATION` below exists so
 * the gate can prove the mirror still matches rather than trusting this
 * comment.
 */
export const FILED_941_MIN_YEAR = 2020;
export const FILED_941_MAX_YEAR = 2100;

/**
 * The exact constraint text in 0204, as DATA, so a gate can grep the migration
 * for it. If somebody widens the column bounds without widening these, the
 * form starts refusing rows the database would have accepted — a failure that
 * is invisible until somebody tries to enter 2019.
 */
export const FILED_941_YEAR_BOUNDS_MATCH_MIGRATION =
  "tax_year between 2020 and 2100" as const;

/* ═════════════════════════════════════════════════════════════════════════
 * §5  WARNINGS — THE THINGS WORTH SAYING THAT MUST NOT BLOCK A SAVE
 *
 * ═══ WHY THESE ARE NOT REFUSALS, WHICH IS THE MOST IMPORTANT DECISION IN
 *     THIS FILE. ═══
 *
 * A filed return is a HISTORICAL FACT. It has already gone to the IRS. If what
 * Michael filed does not match what the rate tables say it should have been,
 * the correct behaviour is to RECORD IT ANYWAY and tell him, loudly, that it
 * looks wrong.
 *
 * Refusing to store it would be catastrophic in a subtle way. The whole purpose
 * of this table is to hold the INDEPENDENT side of a reconciliation. A form
 * that only accepts figures matching its own expectations does not capture an
 * independent side at all — it captures a filtered copy of its own opinion, and
 * the reconciliation downstream would then always be green. Rule 39 again,
 * arriving through the back door.
 *
 * So: impossible things are refusals (a negative, a bad date, 5d larger than
 * 5c+5d). SUSPICIOUS things are warnings. The distinction is whether the figure
 * COULD be true, not whether it LOOKS right.
 * ═════════════════════════════════════════════════════════════════════════ */

export type FiledForm941WarningCode =
  /** 5a tax is not 12.4% of 5a wages. Usually a typo; occasionally real. */
  | "SS_TAX_NOT_TWELVE_POINT_FOUR"
  /** 5c+5d tax is not 2.9% of 5c wages plus the stated 5d. */
  | "MEDICARE_TAX_NOT_TWO_POINT_NINE"
  /** Every figure is zero. Legal, and worth a second look. */
  | "ENTIRELY_ZERO_RETURN"
  /** Filed more than a year after the quarter ended. */
  | "FILED_VERY_LATE";

export const ALL_FILED_941_WARNING_CODES: readonly FiledForm941WarningCode[] = [
  "SS_TAX_NOT_TWELVE_POINT_FOUR",
  "MEDICARE_TAX_NOT_TWO_POINT_NINE",
  "ENTIRELY_ZERO_RETURN",
  "FILED_VERY_LATE",
] as const;

export type FiledForm941Warning = {
  readonly code: FiledForm941WarningCode;
  readonly field: keyof FiledForm941Draft | null;
  /** What looks odd, and by how much. Always names the number. */
  readonly what: string;
  /** What it usually turns out to be, and what to check. */
  readonly whatItUsuallyIs: string;
};

/**
 * How far a stated FICA tax may sit from the statutory computation before it is
 * worth mentioning.
 *
 * ═══ WHY THIS IS NOT ZERO, AND WHY IT IS NOT A PERCENTAGE. ═══
 *
 * The 941 instructions say: "Don't round entries to whole dollars. Always show
 * an amount for cents, even if it is zero." So the figures are exact to the
 * cent and there is no rounding slack to allow for at the RETURN level.
 *
 * But line 5a column 2 is computed on the quarter's TOTAL wage base, while the
 * money actually withheld was rounded person by person, paycheque by paycheque.
 * The instructions acknowledge exactly this: the employee share "may differ
 * slightly from amounts actually withheld from employees' pay due to the
 * rounding of social security and Medicare taxes based on statutory rates" —
 * which is what line 7 exists to absorb.
 *
 * A tolerance of one dollar per return covers that half-cent-per-person drift
 * for a business of Greenway's size while still catching a transposed digit,
 * which is never a dollar — it is tens or thousands. A PERCENTAGE tolerance
 * would scale with the wage base and would therefore stop catching transposition
 * in exactly the years the numbers get big enough to matter.
 *
 * It is a WARNING threshold, not a validity threshold. Nothing is refused by
 * it, and nothing downstream uses it to decide anything.
 */
export const FICA_PLAUSIBILITY_TOLERANCE_CENTS = 100;

/** Days after quarter end beyond which a filing is remarked upon. */
export const FILED_VERY_LATE_DAYS = 365;

/**
 * What line 5a column 2 should be, given the wages on line 5a column 1.
 *
 * Uses the SAME `applyMilliPct` and the SAME rate constant the return engine
 * uses. If this file had its own 12.4% the two would eventually disagree and
 * the warning would start firing on correct returns.
 */
export function plausibleSsTaxCents(ssWagesCents: number): number {
  return applyMilliPct(ssWagesCents, OASDI_COMBINED_MILLI_PCT);
}

/** What lines 5c+5d should be, given 5c wages and the stated 5d amount. */
export function plausibleMedicareTaxCents(
  medicareWagesCents: number,
  addlMedicareCents: number,
): number {
  return applyMilliPct(medicareWagesCents, MEDICARE_COMBINED_MILLI_PCT) + addlMedicareCents;
}

/** Whole days between two ISO dates. Both must already be validated. */
function daysBetweenIso(fromIso: string, toIso: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_PER_DAY);
}

/* ═════════════════════════════════════════════════════════════════════════
 * §6  THE VALIDATION
 *
 * ALL refusals are collected rather than returning at the first one. A form
 * that reveals one problem per submission turns a seven-field transcription
 * into seven round trips, and the seventh is where somebody gives up and
 * decides the reconciliation is not worth doing.
 * ═════════════════════════════════════════════════════════════════════════ */

/** One money field's worth of parsing, refusing rather than salvaging. */
function money(
  raw: string,
  field: keyof FiledForm941Draft,
  label: string,
  refusals: FiledForm941Refusal[],
): number | null {
  const t = raw.trim();
  if (t.length === 0) {
    refusals.push({
      code: "AMOUNT_NOT_A_NUMBER",
      field,
      what: `${label} is blank.`,
      fix:
        `Copy ${label} off the filed return. If the box was genuinely empty on the return, type ` +
        `0.00 — a zero you typed is a fact, whereas a blank this software filled in for you ` +
        `would be a guess sitting in a table that exists to hold facts.`,
    });
    return null;
  }
  const cents = parseMoneyToCents(t);
  if (cents === null) {
    // A leading minus reaches here because parseMoneyToCents rejects it. Report
    // it as NEGATIVE rather than unparseable: that is what the human did, and
    // "not a number" would send them looking for a typo they did not make.
    if (/^-/.test(t)) {
      refusals.push({
        code: "AMOUNT_NEGATIVE",
        field,
        what: `${label} was entered as a negative amount (${t}).`,
        fix:
          `Enter ${label} as it is printed on the return, without a minus sign. Lines 3, 5a and ` +
          `5c are never negative — only the adjustment lines can be, and this form does not ` +
          `record those. If the figure really is negative, the return being recorded is a 941-X ` +
          `correction, which this table cannot represent.`,
      });
      return null;
    }
    refusals.push({
      code: "AMOUNT_NOT_A_NUMBER",
      field,
      what: `${label} could not be read as an amount of money ("${t}").`,
      fix:
        `Type ${label} as digits with at most two decimal places — "12345.67" or "$12,345.67". ` +
        `Nothing is salvaged from a partly-understood entry, because the salvage always succeeds ` +
        `and always looks plausible.`,
    });
    return null;
  }
  return cents;
}

export function validateFiledForm941Draft(draft: FiledForm941Draft): FiledForm941Validation {
  const refusals: FiledForm941Refusal[] = [];

  /* ── the year ─────────────────────────────────────────────────────────── */

  const yearText = draft.taxYearText.trim();
  let taxYear: number | null = null;
  if (!/^\d{4}$/.test(yearText)) {
    refusals.push({
      code: "YEAR_NOT_VALID",
      field: "taxYearText",
      what: `The tax year "${yearText}" is not a four-digit year.`,
      fix:
        "Enter the year printed at the top of the return, as four digits — 2027, not 27. This is " +
        "the year of the QUARTER, not the year you filed it: a Q4 2027 return filed in January " +
        "2028 is still tax year 2027.",
    });
  } else {
    const y = Number.parseInt(yearText, 10);
    if (y < FILED_941_MIN_YEAR || y > FILED_941_MAX_YEAR) {
      refusals.push({
        code: "YEAR_NOT_VALID",
        field: "taxYearText",
        what: `The tax year ${y} is outside the range this table accepts (${FILED_941_MIN_YEAR}–${FILED_941_MAX_YEAR}).`,
        fix:
          "Check the year on the return. These bounds are the same ones the database enforces, " +
          "and they exist so a four-digit typo is caught here rather than becoming a row nobody " +
          "can explain.",
      });
    } else {
      taxYear = y;
    }
  }

  /* ── the quarter ──────────────────────────────────────────────────────── */

  const quarterText = draft.quarterText.trim();
  let quarter: 1 | 2 | 3 | 4 | null = null;
  if (quarterText === "1" || quarterText === "2" || quarterText === "3" || quarterText === "4") {
    quarter = Number.parseInt(quarterText, 10) as 1 | 2 | 3 | 4;
  } else {
    refusals.push({
      code: "QUARTER_NOT_VALID",
      field: "quarterText",
      /*
       * TWO DIFFERENT SENTENCES, BECAUSE THEY ARE TWO DIFFERENT MISTAKES.
       *
       * Found by the books-48 gate, which requires every refusal to explain
       * itself in more than twenty characters. The single old message rendered
       * as `"" is not a quarter.` when nothing had been chosen - a sentence
       * about an empty string, which reads like a software fault rather than
       * like "you have not answered this yet". Not choosing a quarter is the
       * ordinary case of submitting too early; typing something that is not a
       * quarter is a genuine error. Telling them apart costs one branch.
       */
      what:
        quarterText === ""
          ? "No quarter has been chosen, so there is no way to know which return this is."
          : `"${quarterText}" is not a quarter. Form 941 has four, numbered 1 to 4.`,
      fix:
        "Enter 1, 2, 3 or 4 — whichever box is ticked in Part 1 of the return. Q1 is January to " +
        "March, Q2 April to June, Q3 July to September, Q4 October to December.",
    });
  }

  /* ── the seven figures ────────────────────────────────────────────────── */

  const line3 = money(draft.line3Text, "line3Text", "Line 3, federal income tax withheld", refusals);
  const ssWages = money(draft.line5aWagesText, "line5aWagesText", "Line 5a column 1, social security wages", refusals);
  const ssTax = money(draft.line5aTaxText, "line5aTaxText", "Line 5a column 2, social security tax", refusals);
  const medWages = money(draft.line5cWagesText, "line5cWagesText", "Line 5c column 1, Medicare wages", refusals);
  const medTax = money(draft.line5cAnd5dTaxText, "line5cAnd5dTaxText", "Lines 5c and 5d column 2, Medicare tax", refusals);
  const addlTax = money(draft.line5dAddlTaxText, "line5dAddlTaxText", "Line 5d column 2, Additional Medicare Tax", refusals);

  /* ── the filing date ──────────────────────────────────────────────────── */

  const filedOn = draft.filedOnText.trim();
  let filedOnValid = false;
  if (!isRealIsoDate(filedOn)) {
    refusals.push({
      code: "FILED_ON_NOT_VALID",
      field: "filedOnText",
      what: `"${filedOn}" is not a real calendar date in yyyy-mm-dd form.`,
      fix:
        "Enter the date you actually filed, as 2027-04-28. Not the due date, and not the date " +
        "the return was prepared — the date it went. If you filed electronically it is on the " +
        "acknowledgement; if you posted it, it is the postmark.",
    });
  } else {
    filedOnValid = true;
  }

  /* ── the date cannot precede the period it reports ────────────────────── */

  if (filedOnValid && taxYear !== null && quarter !== null) {
    const qEnd = quarterEndIso(taxYear, quarter);
    if (filedOn < qEnd) {
      refusals.push({
        code: "FILED_ON_BEFORE_QUARTER_END",
        field: "filedOnText",
        what:
          `The return is dated ${filedOn}, which is before ${qEnd} — the last day of the quarter ` +
          `it reports.`,
        fix:
          `A quarter cannot be reported before it has finished, so one of three things is typed ` +
          `wrong: the year, the quarter, or the date. The most common cause is entering Q1 of the ` +
          `wrong year in January, when last year's Q4 is the return actually in your hand.`,
      });
    }
  }

  /* ── the source note ──────────────────────────────────────────────────── */

  const sourceNote = draft.sourceNoteText.trim();
  if (sourceNote.length === 0) {
    refusals.push({
      code: "SOURCE_NOTE_MISSING",
      field: "sourceNoteText",
      what: "No note was given saying where these figures came from.",
      fix:
        "Write where you read them off — \"Aatrix Q1 2027 filed 2027-04-28, confirmation " +
        "0-053-958-352\" is ideal. This is the field that makes the row evidence rather than " +
        "just data. If the SSA writes in eighteen months asking why the W-3 and the 941s differ, " +
        "this sentence is what turns a week of searching into ten minutes.",
    });
  }

  /* ── internal impossibilities ─────────────────────────────────────────── */

  if (addlTax !== null && medTax !== null && addlTax > medTax) {
    refusals.push({
      code: "ADDL_MEDICARE_EXCEEDS_TOTAL",
      field: "line5dAddlTaxText",
      what:
        `Line 5d (${addlTax} cents) is larger than the combined lines 5c and 5d ` +
        `(${medTax} cents) that it is part of.`,
      fix:
        "Line 5d is one component of the Medicare figure, so it cannot exceed the total. Check " +
        "that the 5c+5d field holds BOTH lines added together and that 5d holds only the " +
        "Additional Medicare Tax on pay above $200,000 — which for Greenway today is 0.00.",
    });
  }

  if (ssWages !== null && medWages !== null && ssWages > medWages) {
    refusals.push({
      code: "SS_WAGES_EXCEED_MEDICARE_WAGES",
      field: "line5aWagesText",
      what:
        `Social security wages (line 5a, ${ssWages} cents) exceed Medicare wages ` +
        `(line 5c, ${medWages} cents).`,
      fix:
        "Medicare wages are never smaller than social security wages, because social security " +
        "stops at the annual wage base and Medicare has no ceiling at all. The two are equal " +
        "until somebody crosses the base, and after that Medicare is larger. Getting this " +
        "backwards nearly always means the two columns were transcribed the wrong way round.",
    });
  }

  if (refusals.length > 0) {
    return { ok: false, refusals };
  }

  /*
   * EVERY VALUE BELOW IS PROVED NON-NULL BY THE REFUSAL LIST BEING EMPTY.
   *
   * The assertions are narrowing for the type checker, not runtime checks. If
   * one ever fires it means a refusal path above stopped pushing, which is a
   * bug in this function and not in the data — so it throws rather than
   * inventing a zero and storing it.
   */
  if (
    taxYear === null ||
    quarter === null ||
    line3 === null ||
    ssWages === null ||
    ssTax === null ||
    medWages === null ||
    medTax === null ||
    addlTax === null
  ) {
    throw new Error(
      "form-941-confirmation-core: a field was null with no refusal recorded. This is a bug in " +
        "validateFiledForm941Draft, not in the entry — every null path above must push a refusal.",
    );
  }

  const value: ValidatedFiledForm941 = {
    taxYear,
    quarter,
    line3FederalIncomeTaxCents: line3,
    line5aSsWagesCents: ssWages,
    line5aSsTaxCents: ssTax,
    line5cMedicareWagesCents: medWages,
    line5c5dMedicareTaxCents: medTax,
    line5dAddlMedicareTaxCents: addlTax,
    filedOn,
    sourceNote,
  };

  return { ok: true, value, warnings: filedForm941Warnings(value) };
}

/* ═════════════════════════════════════════════════════════════════════════
 * §7  THE WARNINGS, COMPUTED OVER AN ALREADY-VALID ROW
 *
 * Separate function, exported, because it is worth running against a row that
 * is ALREADY STORED — a figure that was fine when the rate was 6.2% is worth
 * re-examining if it is still sitting there when the rate changes. Folding it
 * into the validator would make that impossible without a fake draft.
 * ═════════════════════════════════════════════════════════════════════════ */

export function filedForm941Warnings(
  row: ValidatedFiledForm941,
): readonly FiledForm941Warning[] {
  const warnings: FiledForm941Warning[] = [];

  const expectedSs = plausibleSsTaxCents(row.line5aSsWagesCents);
  const ssGap = row.line5aSsTaxCents - expectedSs;
  if (Math.abs(ssGap) > FICA_PLAUSIBILITY_TOLERANCE_CENTS) {
    warnings.push({
      code: "SS_TAX_NOT_TWELVE_POINT_FOUR",
      field: "line5aTaxText",
      what:
        `Line 5a column 2 is ${row.line5aSsTaxCents} cents, but 12.4% of the wages on line 5a ` +
        `column 1 is ${expectedSs} cents — a difference of ${Math.abs(ssGap)} cents.`,
      whatItUsuallyIs:
        "Almost always one of two things. Either a digit is transposed, or column 2 was copied " +
        "as the EMPLOYEE half only. The 941 carries both halves together — 12.4%, not 6.2% — " +
        "because Greenway matches what the employees pay. If the figure is close to exactly half " +
        "of what is expected, that is the answer. This has been recorded either way: it is what " +
        "you filed, and the point of this table is to hold what you filed rather than what the " +
        "software thinks you should have filed.",
    });
  }

  const expectedMed = plausibleMedicareTaxCents(
    row.line5cMedicareWagesCents,
    row.line5dAddlMedicareTaxCents,
  );
  const medGap = row.line5c5dMedicareTaxCents - expectedMed;
  if (Math.abs(medGap) > FICA_PLAUSIBILITY_TOLERANCE_CENTS) {
    warnings.push({
      code: "MEDICARE_TAX_NOT_TWO_POINT_NINE",
      field: "line5cAnd5dTaxText",
      what:
        `Lines 5c and 5d together are ${row.line5c5dMedicareTaxCents} cents, but 2.9% of the ` +
        `wages on line 5c plus the ${row.line5dAddlMedicareTaxCents} cents on line 5d comes to ` +
        `${expectedMed} cents — a difference of ${Math.abs(medGap)} cents.`,
      whatItUsuallyIs:
        "Usually the same two causes as social security: a transposed digit, or only the " +
        "employee's 1.45% was copied instead of the combined 2.9%. A third possibility here is " +
        "that Additional Medicare Tax was included in the 5c+5d field but left out of the 5d " +
        "field, in which case the 5d box needs the same figure entered on its own as well.",
    });
  }

  const allZero =
    row.line3FederalIncomeTaxCents === 0 &&
    row.line5aSsWagesCents === 0 &&
    row.line5aSsTaxCents === 0 &&
    row.line5cMedicareWagesCents === 0 &&
    row.line5c5dMedicareTaxCents === 0;
  if (allZero) {
    warnings.push({
      code: "ENTIRELY_ZERO_RETURN",
      field: null,
      what: "Every figure on this return is zero.",
      whatItUsuallyIs:
        "This is entirely legal and sometimes correct — once you have filed one 941 you must keep " +
        "filing every quarter whether or not you paid anybody, and a quarter with no payroll is a " +
        "zero return rather than no return. But it is worth one look, because a zero return " +
        "recorded for a quarter that DID have payroll would make the annual W-2 comparison " +
        "disagree by a full quarter of wages, and the cause would be very hard to see from the " +
        "other end.",
    });
  }

  const qEnd = quarterEndIso(row.taxYear, row.quarter);
  const lateness = daysBetweenIso(qEnd, row.filedOn);
  if (lateness > FILED_VERY_LATE_DAYS) {
    warnings.push({
      code: "FILED_VERY_LATE",
      field: "filedOnText",
      what: `This return was filed ${lateness} days after the quarter ended.`,
      whatItUsuallyIs:
        "Most often a typo in the year, because a Q4 return filed in January is only weeks late " +
        "and a mistyped year makes it look like a year. If the date really is right then the " +
        "return was genuinely very late, and the failure-to-file penalty runs at 5% of the " +
        "unpaid tax per month up to 25% — worth knowing about and reconciling against what was " +
        "actually assessed.",
    });
  }

  return warnings;
}

/* ═════════════════════════════════════════════════════════════════════════
 * §8  THE COLUMN MAP, AS DATA
 *
 * Exported so a gate can prove every field of `ValidatedFiledForm941` lands in
 * a column that migration 0204 actually defines, by reading the SQL (rule 43).
 *
 * WHY THIS IS NOT JUST A COMMENT. Two bigint columns holding plausible money
 * will never error if they are swapped. `line_5a_ss_tax_cents` and
 * `line_5c_5d_medicare_tax_cents` are both non-negative bigints; put the
 * Medicare figure in the social security column and the database accepts it,
 * the screen renders it, and the W-3 comparison then reports two disagreements
 * whose real cause is one crossed wire in an insert statement nobody re-read.
 * ═════════════════════════════════════════════════════════════════════════ */

export const FILED_941_COLUMN_MAP: readonly {
  readonly field: keyof ValidatedFiledForm941;
  readonly column: string;
}[] = [
  { field: "taxYear", column: "tax_year" },
  { field: "quarter", column: "quarter" },
  { field: "line3FederalIncomeTaxCents", column: "line_3_federal_income_tax_cents" },
  { field: "line5aSsWagesCents", column: "line_5a_ss_wages_cents" },
  { field: "line5aSsTaxCents", column: "line_5a_ss_tax_cents" },
  { field: "line5cMedicareWagesCents", column: "line_5c_medicare_wages_cents" },
  { field: "line5c5dMedicareTaxCents", column: "line_5c_5d_medicare_tax_cents" },
  { field: "line5dAddlMedicareTaxCents", column: "line_5d_addl_medicare_tax_cents" },
  { field: "filedOn", column: "filed_on" },
  { field: "sourceNote", column: "source_note" },
] as const;

/**
 * Turn a validated row into the exact object the table takes.
 *
 * Built off FILED_941_COLUMN_MAP rather than written out by hand, so the map is
 * load-bearing rather than documentation. A field added to
 * `ValidatedFiledForm941` and forgotten here cannot silently vanish from the
 * insert: the map is the only path, and the gate checks the map against the SQL.
 */
export function filedForm941Row(
  value: ValidatedFiledForm941,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const { field, column } of FILED_941_COLUMN_MAP) {
    out[column] = value[field];
  }
  return out;
}

/**
 * Self-check: the refusal and warning code lists are complete and unique.
 *
 * Throws rather than returning a boolean (standing rule 48), so a caller cannot
 * ignore the answer by forgetting to look at it.
 */
export function assertFiledForm941CodeListsAreWellFormed(): void {
  const seen = new Set<string>();
  for (const c of [...ALL_FILED_941_REFUSAL_CODES, ...ALL_FILED_941_WARNING_CODES]) {
    if (seen.has(c)) {
      throw new Error(`form-941-confirmation-core: code "${c}" appears twice in the exported lists.`);
    }
    seen.add(c);
  }
  if (FILED_941_COLUMN_MAP.length === 0) {
    throw new Error("form-941-confirmation-core: FILED_941_COLUMN_MAP is empty.");
  }
}
