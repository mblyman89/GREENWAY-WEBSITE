/**
 * src/lib/payroll/form-w2-store.ts   (books-46 slice A)
 *
 * THE JOIN FOR THE ANNUAL WAGE REPORT.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `form-w2-core.ts` can build a W-2, total a W-3, and compare that W-3 against
 * the four quarterly 941s. It is pure, it is mutation tested, and its figures
 * are re-derived from the arithmetic the IRS itself printed. What it cannot do
 * is find out who Greenway paid in 2027, what their legal names are, which of
 * them is a shareholder, or what was actually filed in July. That is this
 * file's job.
 *
 * It performs NO tax arithmetic. Not a rate, not a cap, not a rounding, not a
 * subtotal that the engine also computes. If this file did its own sums they
 * would eventually disagree with the engine's, silently, on a form that goes to
 * the Social Security Administration. The only addition it performs is summing
 * box 14's Washington withholding across pay runs, and §4 explains why that
 * particular addition has nowhere else to live.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THIS FILE WRITES NOTHING, AND TRANSMITS NOTHING
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Reading and filing are separate acts. Nothing here inserts, updates, or sends
 * anything to the SSA or the IRS. Michael files every return himself; this
 * system replaces the data-preparation half of the job and is not a filing
 * agent. The screen above this file says so in as many words, in every state,
 * including the states where the button is disabled.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * THE SEVEN THINGS THIS FILE REFUSES TO INVENT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   1. A LEGAL NAME SPLIT.  `employees.full_name` is a DISPLAY name for the
 *      timeclock. Splitting it on the last space is a guess (standing rule 1)
 *      and it is wrong for compound surnames, surnames recorded first, suffixes
 *      and single-word legal names. It is also not necessarily the legal name at
 *      all - a person who is "Mike" on the schedule is "Michael" on the card. So
 *      this file reads the separate `w2_first_name_and_initial` / `w2_last_name`
 *      columns migration 0203 added, passes whatever is there (empty string when
 *      absent), and lets the engine raise W2_NAME_INCOMPLETE. The cost of the
 *      guess would be an SSA name/SSN mismatch: a per-form penalty under IRC
 *      6721 plus a W-2c.
 *
 *   2. SHAREHOLDER STATUS.  Answered by `employees.gl_shareholder_id is not
 *      null` and by nothing else. Never by matching names against
 *      gl_shareholders, never by "is this person the owner". Michael's mother
 *      is a 5% shareholder (books-50: the filed 1120-S shows four holders at
 *      85/5/5/5) who is allocated income and is NOT an employee; being an owner
 *      does not make someone a shareholder-EMPLOYEE.
 *
 *   3. A HEALTH PREMIUM.  Read from `employee_scorp_health_premiums` for that
 *      exact (employee, year). No row means no premium was recorded, which the
 *      engine treats as zero - and zero is correct, because a premium that was
 *      paid but not recorded is invisible to every system, not just this one.
 *      What this file will NOT do is carry last year's figure forward.
 *
 *   4. STATE INCOME TAX.  Passed as 0, always, because Washington levies none.
 *      This is not a default standing in for an unknown; it is the value the
 *      form carries. The engine refuses anything else with
 *      W2_BOX_17_MUST_BE_BLANK_IN_WA, and that refusal is the reason the
 *      constant is safe to state here.
 *
 *   5. BOX 12 ENTRIES.  Passed as an empty array. Migration 0203 §7 records
 *      that Greenway operates no elective deferral plan, no employer-sponsored
 *      health coverage arrangement and no HSA, so no table exists to read. When
 *      one does, this is the seam that changes - and until then an empty array
 *      is a statement about the world, not a hole.
 *
 *   6. A DEPOSIT OR A FILED FIGURE.  The four-quarter comparison reads
 *      `filed_form_941_totals`, which contains only what Michael typed in from
 *      the returns he actually filed. When fewer than four quarters are
 *      recorded, this file reports the shortfall and the engine says the
 *      comparison is incomplete. It never recomputes the "filed" side. §3
 *      explains at length why recomputing it would destroy the check.
 *
 *   7. A TAX SPLIT ON A PRE-0199 PAY LINE.  Those columns are nullable with no
 *      default, deliberately (rule 62d): a line written before that migration
 *      genuinely does not know its own split. Such lines are counted and
 *      reported, never treated as zero.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AT ALL: A NOTE ON WHAT WAS FOUND WHILE WRITING IT
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * `reconcileW3To941s` had no caller in src/. Two in tests, none in the
 * application. The most important function on the screen was unreachable from
 * the running program, and the tests were green because the tests supplied the
 * input the program could not (standing rule 50). Writing this file is what
 * exposed that; migration 0204 is what fixed it. The lesson is recorded here
 * because it will recur: a pure engine with a rich test suite can be complete,
 * correct, and connected to nothing.
 */

import "server-only";

import {
  buildW2,
  buildW3,
  reconcileW3To941s,
  type Form941YearTotals,
  type ReconciliationResult,
  type W2Form,
  type W2Refusal,
  type W2Request,
  type W3Form,
} from "@/lib/payroll/form-w2-core";
import { emptyAccumulator, type YtdAccumulatorRow } from "@/lib/payroll/ytd-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requiredBigint as readRequiredBigint } from "@/lib/supabase/pg-bigint";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

/* ═════════════════════════════════════════════════════════════════════════════
 * §1  FAILURES - the shape the rest of the payroll layer already uses
 *
 * Deliberately the same three codes as `form-941-store.ts` and the same
 * discriminated shape as `ytd-store.ts`, so the page above can handle a failure
 * from any of the three identically. A fourth vocabulary for the same three
 * situations would be standing rule 25 violated for no gain.
 * ═════════════════════════════════════════════════════════════════════════════ */

export type W2StoreFailureCode = "NOT_CONFIGURED" | "READ_FAILED" | "DATA_UNUSABLE";

export type W2StoreFailure = {
  readonly ok: false;
  readonly code: W2StoreFailureCode;
  readonly message: string;
};

const NOT_CONFIGURED =
  "The database connection is not configured in this environment, so the W-2s cannot be assembled. Nothing is wrong with your books - this screen simply has nothing to read from here.";

/* ═════════════════════════════════════════════════════════════════════════════
 * §2  THE COLUMNS, NAMED ONCE
 *
 * Named constants rather than inline strings, because each list is read by more
 * than one query below and two copies of a column list are two chances for one
 * to fall behind (standing rule 25).
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * The employee facts a W-2 needs.
 *
 * `ssn_full` IS IN THIS LIST, AND THAT IS DELIBERATE AND NARROW. The engine
 * validates nine digits and refuses W2_SSN_NOT_NINE_DIGITS otherwise, so it
 * genuinely needs the digits. They are handed to a pure function and dropped;
 * `W2Form` carries only `ssnMasked` (XXX-XX-1234), and nothing in this file's
 * return type can carry the full number - see §6.
 *
 * WHY NO REVEAL ROW IS WRITTEN. `payroll-onboarding-store.ts` writes to
 * `employee_ssn_reveals` before returning an SSN, and refuses if that write
 * fails. That path exists to show a HUMAN the number. This path shows nobody:
 * the digits never leave this module and never reach a screen. Writing a reveal
 * row here would log a disclosure that did not happen, which makes the log less
 * trustworthy, not more - and a log with false entries in it is worse than a
 * shorter honest one.
 */
const EMPLOYEE_W2_COLUMNS =
  "id, full_name, active, w2_first_name_and_initial, w2_last_name, w2_name_suffix, gl_shareholder_id, w2_void, ssn_full" as const;

/** Matches `ACCUMULATOR_COLUMNS` in ytd-store.ts, which owns the canonical read. */
const ACCUMULATOR_COLUMNS =
  "employee_id, tax_year, oasdi_wages_cents, medicare_wages_cents, futa_wages_cents, wa_suta_wages_cents, wa_pfml_wages_cents, wa_cares_wages_cents, lni_hundredth_hours, oasdi_employee_cents, medicare_employee_cents, addl_medicare_employee_cents, federal_income_tax_cents, last_run_id" as const;

/** The five figures `Form941YearTotals` needs, plus the 5d part that must not double. */
const FILED_941_COLUMNS =
  "tax_year, quarter, line_3_federal_income_tax_cents, line_5a_ss_wages_cents, line_5a_ss_tax_cents, line_5c_medicare_wages_cents, line_5c_5d_medicare_tax_cents, line_5d_addl_medicare_tax_cents, filed_on, source_note" as const;

/** Box 14's Washington figures live only on the pay lines. See §4. */
const RUN_LINE_BOX_14_COLUMNS =
  "run_id, employee_id, wa_pfml_employee_cents, wa_cares_employee_cents" as const;

type EmployeeRow = {
  readonly id: string;
  readonly full_name: string | null;
  readonly active: boolean | null;
  readonly w2_first_name_and_initial: string | null;
  readonly w2_last_name: string | null;
  readonly w2_name_suffix: string | null;
  readonly gl_shareholder_id: string | null;
  readonly w2_void: boolean | null;
  readonly ssn_full: string | null;
};

export type AccumulatorRow = {
  readonly employee_id: string;
  readonly tax_year: number;
  readonly oasdi_wages_cents: number | string | null;
  readonly medicare_wages_cents: number | string | null;
  readonly futa_wages_cents: number | string | null;
  readonly wa_suta_wages_cents: number | string | null;
  readonly wa_pfml_wages_cents: number | string | null;
  readonly wa_cares_wages_cents: number | string | null;
  readonly lni_hundredth_hours: number | string | null;
  readonly oasdi_employee_cents: number | string | null;
  readonly medicare_employee_cents: number | string | null;
  readonly addl_medicare_employee_cents: number | string | null;
  readonly federal_income_tax_cents: number | string | null;
  readonly last_run_id: string | null;
};

type PremiumRow = {
  readonly employee_id: string;
  readonly tax_year: number;
  readonly premium_cents: number | string | null;
  readonly source_note: string | null;
};

export type FiledRow = {
  readonly tax_year: number;
  readonly quarter: number;
  readonly line_3_federal_income_tax_cents: number | string | null;
  readonly line_5a_ss_wages_cents: number | string | null;
  readonly line_5a_ss_tax_cents: number | string | null;
  readonly line_5c_medicare_wages_cents: number | string | null;
  readonly line_5c_5d_medicare_tax_cents: number | string | null;
  readonly line_5d_addl_medicare_tax_cents: number | string | null;
  readonly filed_on: string;
  readonly source_note: string;
};

type BoxFourteenRow = {
  readonly run_id: string;
  readonly employee_id: string | null;
  readonly wa_pfml_employee_cents: number | string | null;
  readonly wa_cares_employee_cents: number | string | null;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  READING A BIGINT WITHOUT LYING ABOUT IT
 *
 * This section used to contain its own `requiredBigint`. It no longer does, and
 * the reason is worth recording because the note it replaces was WRONG in a way
 * that is easy to be wrong.
 *
 * That note said: "It is NOT shared with `ytd-store.ts`'s copy... The trigger
 * for extraction is a THIRD caller, not a second." The principle is sound. The
 * fact was not: there were already FOUR. `ytd-store.ts`, `garnishment-store.ts`
 * and `payroll-onboarding-store.ts` had each written the same conversion, and
 * this file made a fifth. The note declined to extract on the strength of a
 * count nobody had taken - standing rule 1, in the middle of a comment
 * explaining a careful decision.
 *
 * Worse, all four copies shared two defects, and the duplication is what let
 * them survive. Each guarded with `Number.isFinite(n) && Number.isInteger(n)`,
 * which accepts `""` as 0, `"0x1F"` as 31 and `"9007199254740993"` as
 * 9007199254740992. Each carried a comment explaining that reading an
 * unreadable wage column as zero is the most dangerous possible wrong answer,
 * and then did precisely that for an empty string. Four careful authors, four
 * reviews, one wrong idea about `Number()`.
 *
 * The conversion now lives in `@/lib/supabase/pg-bigint`, which validates the
 * TEXT before converting it and checks `isSafeInteger` after, and whose header
 * records both defects with the measurements. It is a PURE module, so unlike
 * any of the four copies it is directly testable and its self-tests run in
 * `run-pure-selftests.ts`. It offers `requiredBigint` for `not null` columns
 * and `optionalBigint` for genuinely nullable ones, split by nullability alone.
 *
 * This file re-exports `requiredBigint` under its own name because
 * `tests/compliance/form-w2-store.test.ts` imports it from here and because a
 * reader tracing a W-2 box back to a column should be able to see the reader it
 * went through without leaving the file. The re-export is a name, not a second
 * implementation (standing rule 25).
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read a `not null` bigint column for this year's W-2s.
 *
 * A thin adapter over the shared reader, kept because every call site in this
 * file already passes `(value, table, column, context)` positionally and
 * because that argument order reads well at 30-odd call sites. It performs no
 * validation of its own - all of that is in `pg-bigint`, tested there once,
 * rather than here for a fifth time.
 */
export function requiredBigint(
  v: number | string | null,
  table: string,
  column: string,
  context: string,
): number {
  return readRequiredBigint(v, { table, column, context });
}

/**
 * A stored accumulator row, mapped into the engine's type.
 *
 * Spelled out field by field rather than looped. This mapping is the seam
 * standing rule 63d warns about: a database row and an engine input look
 * similar enough that one transposed column name yields a plausible number
 * instead of an error. Writing all eleven out makes a transposition visible to
 * a reader, and the compiler catches an omission.
 */
export function toAccumulator(row: AccumulatorRow): YtdAccumulatorRow {
  const t = "payroll_ytd_accumulators";
  const who = `employee ${row.employee_id}`;
  const n = (v: number | string | null, c: string) => requiredBigint(v, t, c, who);
  return {
    employeeId: row.employee_id,
    taxYear: row.tax_year,
    wages: {
      oasdiWagesCents: n(row.oasdi_wages_cents, "oasdi_wages_cents"),
      medicareWagesCents: n(row.medicare_wages_cents, "medicare_wages_cents"),
      futaWagesCents: n(row.futa_wages_cents, "futa_wages_cents"),
      waSutaWagesCents: n(row.wa_suta_wages_cents, "wa_suta_wages_cents"),
      waPfmlWagesCents: n(row.wa_pfml_wages_cents, "wa_pfml_wages_cents"),
      waCaresWagesCents: n(row.wa_cares_wages_cents, "wa_cares_wages_cents"),
      lniHundredthHours: n(row.lni_hundredth_hours, "lni_hundredth_hours"),
    },
    oasdiEmployeeCents: n(row.oasdi_employee_cents, "oasdi_employee_cents"),
    medicareEmployeeCents: n(row.medicare_employee_cents, "medicare_employee_cents"),
    addlMedicareEmployeeCents: n(row.addl_medicare_employee_cents, "addl_medicare_employee_cents"),
    federalIncomeTaxCents: n(row.federal_income_tax_cents, "federal_income_tax_cents"),
    lastRunId: row.last_run_id,
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §4  BOX 14, AND WHY THIS FILE HAS TO ADD SOMETHING UP
 *
 * Box 14 is "Other", and it is where Washington's Paid Family and Medical Leave
 * (RCW 50A) and WA Cares (RCW 50B) withholding belongs. It emphatically does
 * NOT belong in box 17 - that is trap 2, documented at length in
 * form-w2-authorities.ts. The trap is not ignorance, it is diligence
 * misapplied: state money really was withheld, box 17 really is labelled "state
 * income tax", and a conscientious person joins the two. That reports state
 * income tax to a state that levies none, and the figure then matches no state
 * return because no such return exists.
 *
 * MEASURED PROBLEM: `payroll_ytd_accumulators` carries PFML and WA Cares as
 * WAGES (`wa_pfml_wages_cents`, `wa_cares_wages_cents`) and does not carry the
 * amounts WITHHELD at all. Those exist only on `payroll_run_lines`
 * (`wa_pfml_employee_cents`, `wa_cares_employee_cents`, both added by 0199,
 * both nullable with no default).
 *
 * So the year's box 14 figures cannot be read; they have to be summed. This is
 * the one piece of addition in this file, it is addition of stored figures
 * rather than tax computation, and lines that cannot state their own split are
 * COUNTED AND EXCLUDED rather than treated as zero - because treating a null as
 * zero here would understate box 14 silently, and box 14 is the box Michael
 * will check against his own PFML remittances.
 *
 * WHY NOT ADD THE COLUMNS TO THE ACCUMULATOR INSTEAD? Because that would change
 * what the pay run writes, in a commit about W-2s, and the accumulator is
 * rebuilt from pay runs by `applyRunToYtd`. Widening it correctly means
 * revisiting that write path and its reconciliation. That is a real piece of
 * work with its own risks, it belongs in its own change, and it is recorded in
 * the roadmap rather than smuggled in here.
 * ═════════════════════════════════════════════════════════════════════════════ */

export type BoxFourteenTotals = {
  readonly pfmlEmployeeCents: number;
  readonly caresEmployeeCents: number;
  /** Pay lines that predate 0199 and cannot state their own split. */
  readonly linesMissingWaDetail: number;
};

const ZERO_BOX_14: BoxFourteenTotals = {
  pfmlEmployeeCents: 0,
  caresEmployeeCents: 0,
  linesMissingWaDetail: 0,
};

/**
 * Turn the summed figures into the engine's box 14 entries.
 *
 * A ZERO FIGURE PRODUCES NO ENTRY, and that is a decision rather than an
 * oversight. Box 14 is free text with limited room; a line reading "WA PFML
 * $0.00" invites the question "why is this zero" on a form where the honest
 * answer is "because nothing was withheld", which is better conveyed by the
 * box's absence. Every non-zero figure DOES appear, because a withheld amount
 * that Michael cannot see on the form is one he cannot check.
 */
export function boxFourteenEntries(
  t: BoxFourteenTotals,
): readonly { readonly label: string; readonly amountCents: number }[] {
  const out: { label: string; amountCents: number }[] = [];
  if (t.pfmlEmployeeCents > 0) {
    out.push({ label: "WA PFML", amountCents: t.pfmlEmployeeCents });
  }
  if (t.caresEmployeeCents > 0) {
    out.push({ label: "WA CARES", amountCents: t.caresEmployeeCents });
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §5  THE FILED 941s - THE INDEPENDENT SIDE OF THE COMPARISON
 *
 * READ THIS BEFORE CHANGING ANYTHING IN THIS SECTION.
 *
 * A W-2 is an INFORMATION return. The engine already guarantees its internal
 * arithmetic, so "is it correct" is not the interesting question. The
 * interesting question - the only one that can still go wrong - is whether it
 * AGREES with what was already reported quarterly. The IRS is explicit:
 *
 *     "You may be contacted by the IRS and SSA if your Forms W-2 do not
 *      reconcile with the totals reported on your Forms 941."
 *
 * The figures below come from `filed_form_941_totals`, which contains nothing
 * but what Michael transcribed from the returns he actually filed.
 *
 * IT WOULD BE EASY, AND FATAL, TO COMPUTE THIS SIDE INSTEAD. The W-2 side of
 * the comparison descends from `payroll_ytd_accumulators`, which is fed from
 * `payroll_run_lines`. If the "941 side" were also summed from pay runs, both
 * sides would share one ancestor and would agree TRIVIALLY, ALWAYS - including
 * in the quarter where a 941 went out with a transposed digit. Five green ticks
 * forever. That is standing rule 39 (a gate that parses nothing approves
 * everything) applied to the highest-stakes screen in the payroll module, and
 * it is worse than having no comparison at all, because a check that is always
 * green teaches Michael to trust it.
 *
 * The comparison is worth something for exactly one reason: THE TWO SIDES ARE
 * INDEPENDENT. Keep them that way.
 *
 * ON THE FOURTH ARGUMENT. `reconcileW3To941s` needs
 * `unmatchedAdditionalMedicareCents` separately because Additional Medicare Tax
 * is the one FICA figure with no employer match: the employee pays 0.9% above
 * the threshold and Greenway pays nothing. Every other figure doubles between
 * the W-3 and the 941. So the engine counts that part once and the rest twice.
 * Fold it in and a perfectly correct return shows a difference equal to the
 * Additional Medicare amount - a false alarm, which is expensive in a specific
 * way: it teaches Michael the red line is usually wrong, and the day it is
 * right he will not believe it.
 * ═════════════════════════════════════════════════════════════════════════════ */

export type FiledQuarterSummary = {
  readonly quarter: number;
  readonly filedOn: string;
  readonly sourceNote: string;
};

export type FiledNineFortyOnes = {
  readonly totals: Form941YearTotals;
  /** The 5d part, which must be counted once rather than twice. */
  readonly unmatchedAdditionalMedicareCents: number;
  /** Which quarters were found, so the screen can name the missing ones. */
  readonly quartersFound: readonly FiledQuarterSummary[];
  readonly quartersMissing: readonly number[];
};

/** The four quarters of a calendar year, named once so no loop invents them. */
const ALL_QUARTERS: readonly number[] = [1, 2, 3, 4];

export function summariseFiled(
  rows: readonly FiledRow[],
  taxYear: number,
): FiledNineFortyOnes {
  const t = "filed_form_941_totals";
  let fit = 0;
  let ssWages = 0;
  let ssTax = 0;
  let medWages = 0;
  let medTax = 0;
  let addl = 0;

  const found: FiledQuarterSummary[] = [];

  for (const r of rows) {
    const who = `${taxYear} Q${r.quarter}`;
    fit += requiredBigint(r.line_3_federal_income_tax_cents, t, "line_3_federal_income_tax_cents", who);
    ssWages += requiredBigint(r.line_5a_ss_wages_cents, t, "line_5a_ss_wages_cents", who);
    ssTax += requiredBigint(r.line_5a_ss_tax_cents, t, "line_5a_ss_tax_cents", who);
    medWages += requiredBigint(r.line_5c_medicare_wages_cents, t, "line_5c_medicare_wages_cents", who);
    medTax += requiredBigint(r.line_5c_5d_medicare_tax_cents, t, "line_5c_5d_medicare_tax_cents", who);
    addl += requiredBigint(
      r.line_5d_addl_medicare_tax_cents,
      t,
      "line_5d_addl_medicare_tax_cents",
      who,
    );
    found.push({ quarter: r.quarter, filedOn: r.filed_on, sourceNote: r.source_note });
  }

  found.sort((a, b) => a.quarter - b.quarter);
  const seen = new Set(found.map((f) => f.quarter));

  return {
    totals: {
      federalIncomeTaxWithheldCents: fit,
      socialSecurityWagesCents: ssWages,
      medicareWagesCents: medWages,
      socialSecurityTaxCents: ssTax,
      medicareTaxCents: medTax,
      // NOT `4`, and not `found.length` rounded up to 4. The engine uses this
      // to decide whether the comparison is COMPLETE, and telling it four when
      // two were supplied would turn "incomplete" into a confident wrong
      // answer - which is the failure mode this whole file is written against.
      quartersIncluded: found.length,
    },
    unmatchedAdditionalMedicareCents: addl,
    quartersFound: found,
    quartersMissing: ALL_QUARTERS.filter((q) => !seen.has(q)),
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §6  WHAT THE PAGE GETS BACK
 *
 * NOTE WHAT IS ABSENT FROM THIS TYPE: there is no field anywhere in it that can
 * carry a full Social Security number. The digits are read in §7, handed to
 * `buildW2`, and go out of scope. `W2Form` carries `ssnMasked` only. A store
 * whose return type cannot express a secret cannot leak one by accident, which
 * is a stronger guarantee than remembering not to.
 * ═════════════════════════════════════════════════════════════════════════════ */

export type W2PersonRefusal = {
  readonly employeeId: string;
  /** The DISPLAY name, so Michael can tell who this is. Never the legal name. */
  readonly displayName: string;
  readonly refusals: readonly W2Refusal[];
};

export type W2Loaded = {
  readonly ok: true;
  readonly taxYear: number;
  /** Every form the engine agreed to build, voided ones included. */
  readonly forms: readonly W2Form[];
  /** The W-3, which excludes voided forms. Null when no form was built. */
  readonly w3: W3Form | null;
  /** People the engine refused to build a form for, and why. */
  readonly refusedPeople: readonly W2PersonRefusal[];
  /**
   * The comparison against the four filed 941s.
   *
   * `null` means NOT RUN, which is different from "ran and agreed" and must
   * stay different. It is null when no 941 has been recorded for the year at
   * all. The UI renders null as gold - an opinion, not a shrug - because
   * "nobody has checked" is a state Michael needs to act on, whereas green
   * would tell him he is finished.
   */
  readonly reconciliation: ReconciliationResult | null;
  readonly filed: FiledNineFortyOnes | null;
  /** Box 14 lines that could not state their own Washington split. */
  readonly linesMissingWaDetail: number;
  /** Employees with no accumulator row for the year: nobody paid them. */
  readonly employeesWithNoWages: number;
  /** Inactive employees who nevertheless have wages, so still need a W-2. */
  readonly inactiveWithWages: number;
};

export type W2LoadResult = W2Loaded | W2StoreFailure;

/* ═════════════════════════════════════════════════════════════════════════════
 * §7  THE READ
 * ═════════════════════════════════════════════════════════════════════════════ */

/**
 * Assemble the year's W-2s, the W-3, and the comparison against the four 941s.
 *
 * The steps, in order, and why each one is where it is:
 *
 *   1. Read the employees. ALL of them, active or not - somebody who left in
 *      March is still owed a W-2 for the wages they were paid, and filtering on
 *      `active` is the single easiest way to forget an entire form. Employees
 *      with no wages at all are counted and skipped, because a W-2 reporting
 *      nothing is not a form, it is a filing penalty waiting to be assessed.
 *   2. Read the year's accumulators. This is the W-2 side of the comparison.
 *   3. Read the recorded premiums. Only a shareholder-employee can have one,
 *      and the engine refuses a premium against anyone else.
 *   4. Sum box 14's Washington withholding from the pay lines. §4.
 *   5. Read the employer's own identity - state code and state ID.
 *   6. Build each form through the engine. Nothing here computes a box.
 *   7. Total the W-3 through the engine, which excludes voids itself.
 *   8. Read the filed 941s and hand the comparison to the engine. §5.
 */
export async function loadW2s(taxYear: number): Promise<W2LoadResult> {
  if (!Number.isInteger(taxYear) || taxYear < 2020 || taxYear > 2100) {
    return {
      ok: false,
      code: "DATA_UNUSABLE",
      message:
        `${taxYear} is not a tax year this system will assemble W-2s for. The bounds match the ` +
        `CHECK constraints in the migrations, so a four-digit typo is caught here rather than ` +
        `producing a year's worth of forms nobody asked for.`,
    };
  }

  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();

  /* ── 1. the people ─────────────────────────────────────────────────────── */

  const { data: empData, error: empError } = await admin
    .from("employees")
    .select(EMPLOYEE_W2_COLUMNS);

  if (empError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `Could not read the employee list: ${empError.message}. No W-2 can be prepared without ` +
        `it, and a partial set of W-2s is worse than none - the W-3 would total to a figure that ` +
        `matches nothing.`,
    };
  }

  const employees = (empData ?? []) as unknown as EmployeeRow[];

  /* ── 2. the year's wages ───────────────────────────────────────────────── */

  const { data: accData, error: accError } = await admin
    .from("payroll_ytd_accumulators")
    .select(ACCUMULATOR_COLUMNS)
    .eq("tax_year", taxYear);

  if (accError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the ${taxYear} year-to-date totals: ${accError.message}. Every box on every W-2 comes from these figures.`,
    };
  }

  const accumulators = new Map<string, YtdAccumulatorRow>();
  try {
    for (const row of (accData ?? []) as unknown as AccumulatorRow[]) {
      accumulators.set(row.employee_id, toAccumulator(row));
    }
  } catch (e) {
    return {
      ok: false,
      code: "DATA_UNUSABLE",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  /* ── 3. the recorded premiums ──────────────────────────────────────────── */

  const { data: premData, error: premError } = await admin
    .from("employee_scorp_health_premiums")
    .select("employee_id, tax_year, premium_cents, source_note")
    .eq("tax_year", taxYear);

  if (premError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `Could not read the ${taxYear} shareholder health premiums: ${premError.message}. ` +
        `These belong in box 1 and not in boxes 3 and 5, so a W-2 built without them would ` +
        `understate the shareholder's taxable pay.`,
    };
  }

  const premiums = new Map<string, number>();
  try {
    for (const row of (premData ?? []) as unknown as PremiumRow[]) {
      premiums.set(
        row.employee_id,
        requiredBigint(
          row.premium_cents,
          "employee_scorp_health_premiums",
          "premium_cents",
          `employee ${row.employee_id} in ${row.tax_year}`,
        ),
      );
    }
  } catch (e) {
    return { ok: false, code: "DATA_UNUSABLE", message: e instanceof Error ? e.message : String(e) };
  }

  /* ── 4. box 14, summed from the pay lines ──────────────────────────────── */

  const boxFourteen = new Map<string, BoxFourteenTotals>();
  let linesMissingWaDetail = 0;

  const { data: runData, error: runError } = await admin
    .from("payroll_runs")
    .select("id, pay_date, status")
    .gte("pay_date", `${taxYear}-01-01`)
    .lte("pay_date", `${taxYear}-12-31`);

  if (runError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the ${taxYear} pay runs, which is where box 14's Washington figures come from: ${runError.message}.`,
    };
  }

  // A VOIDED RUN IS NOT A CORRECTION, IT IS A RUN THAT NEVER HAPPENED. Same
  // filter `form-941-store.ts` applies, and for the same reason: including it
  // would overstate every figure derived from it.
  const runIds = ((runData ?? []) as unknown as { id: string; status: string }[])
    .filter((r) => r.status !== "void")
    .map((r) => r.id);

  if (runIds.length > 0) {
    const { data: lineData, error: lineError } = await admin
      .from("payroll_run_lines")
      .select(RUN_LINE_BOX_14_COLUMNS)
      .in("run_id", runIds);

    if (lineError) {
      return {
        ok: false,
        code: "READ_FAILED",
        message: `Could not read the pay run lines for box 14: ${lineError.message}.`,
      };
    }

    for (const l of (lineData ?? []) as unknown as BoxFourteenRow[]) {
      if (l.employee_id === null) continue;
      // Nullable with no default, deliberately (rule 62d): a line written before
      // migration 0199 genuinely does not know its own Washington split.
      // Counting it as zero would silently understate box 14, and box 14 is
      // exactly what Michael will check against his PFML remittances.
      if (l.wa_pfml_employee_cents === null || l.wa_cares_employee_cents === null) {
        linesMissingWaDetail += 1;
        continue;
      }
      const prior = boxFourteen.get(l.employee_id) ?? ZERO_BOX_14;
      try {
        boxFourteen.set(l.employee_id, {
          pfmlEmployeeCents:
            prior.pfmlEmployeeCents +
            requiredBigint(
              l.wa_pfml_employee_cents,
              "payroll_run_lines",
              "wa_pfml_employee_cents",
              `employee ${l.employee_id}`,
            ),
          caresEmployeeCents:
            prior.caresEmployeeCents +
            requiredBigint(
              l.wa_cares_employee_cents,
              "payroll_run_lines",
              "wa_cares_employee_cents",
              `employee ${l.employee_id}`,
            ),
          linesMissingWaDetail: 0,
        });
      } catch (e) {
        return {
          ok: false,
          code: "DATA_UNUSABLE",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    }
  }

  /* ── 5. the employer's own identity ────────────────────────────────────── */

  const { data: profileData, error: profileError } = await admin
    .from("company_profile")
    .select("suta_state_code, esd_account_number")
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the company profile, which supplies boxes 15 to 17: ${profileError.message}.`,
    };
  }

  const profile = (profileData ?? null) as {
    suta_state_code: string | null;
    esd_account_number: string | null;
  } | null;

  /*
   * WHY `suta_state_code` AND NOT `state_code`.
   *
   * `company_profile` has both, and they are deliberately different fields
   * (0196:373 says so explicitly). `state_code` is the MAILING address - it
   * feeds box c, the employer's address. `suta_state_code` is the state whose
   * unemployment tax Greenway is required to pay, which is the state whose
   * wages boxes 15-17 report. A business can be headquartered in one state and
   * pay unemployment tax in another, and conflating the two is how a wrong
   * Form 940 line 1a happens - and would be how a wrong box 15 happens here.
   *
   * When the profile row is absent entirely there is no state to report, and
   * this passes the empty string rather than inventing "WA". Greenway is in
   * Washington, everyone involved knows that, and writing it in as a fallback
   * would still be this file stating a fact nobody entered (rule 62d). An empty
   * state code produces a visibly incomplete box 15, which is a bookkeeping
   * task; a hard-coded "WA" produces a form that looks finished.
   */
  const stateCode = (profile?.suta_state_code ?? "").trim();
  const employerStateId = (profile?.esd_account_number ?? "").trim();

  /* ── 6. build each form ────────────────────────────────────────────────── */

  const forms: W2Form[] = [];
  const refusedPeople: W2PersonRefusal[] = [];
  let employeesWithNoWages = 0;
  let inactiveWithWages = 0;

  for (const e of employees) {
    const ytd = accumulators.get(e.id);

    /*
     * NO WAGES MEANS NO W-2, AND THAT IS THE LAW RATHER THAN A CONVENIENCE.
     * A W-2 is required for wages PAID. Somebody on the roster who was never
     * paid this year has no W-2 to file, and filing one reporting zeros invites
     * the SSA to reconcile a form against nothing. Counted so the screen can
     * account for the difference between the headcount and the form count -
     * because an unexplained gap between those two numbers is exactly what
     * makes Michael wonder whether somebody was missed.
     */
    if (!ytd) {
      employeesWithNoWages += 1;
      continue;
    }

    // Note what is NOT here: a filter on `active`. Somebody who left in March
    // is still owed a W-2 for the wages they were paid, and filtering them out
    // is the easiest possible way to forget an entire form.
    if (e.active === false) inactiveWithWages += 1;

    const b14 = boxFourteen.get(e.id) ?? ZERO_BOX_14;

    const request: W2Request = {
      taxYear,
      employee: {
        employeeId: e.id,
        // Whatever is stored, including the empty string. The engine raises
        // W2_NAME_INCOMPLETE, which names the person and says what to do. It
        // does NOT fall back to `full_name`: that is the timeclock display
        // name, it may be a nickname, and the SSA matches on name and SSN
        // together.
        firstNameAndInitial: (e.w2_first_name_and_initial ?? "").trim(),
        lastName: (e.w2_last_name ?? "").trim(),
        suffix: e.w2_name_suffix?.trim() || null,
        // Empty string when absent, so the engine raises
        // W2_SSN_NOT_NINE_DIGITS rather than this file deciding what to do.
        ssn: (e.ssn_full ?? "").trim(),
        // A LINK, NOT A GUESS. Never a name match against gl_shareholders.
        isTwoPercentShareholder: e.gl_shareholder_id !== null,
        scorpHealthPremiumCents: premiums.get(e.id) ?? 0,
        // 0203 §7: Greenway operates no deferral, health-coverage or HSA
        // arrangement, so there is no table to read. An empty array is a
        // statement about the world, not a hole.
        box12: [],
        box14: boxFourteenEntries(b14),
        // Box 13. All three are false because Greenway has no retirement plan,
        // no statutory employees and no third-party sick pay arrangement, and
        // nothing in this schema records any of the three. When one becomes
        // real it needs a column and a migration, not a shrug here.
        retirementPlan: false,
        statutoryEmployee: false,
        thirdPartySickPay: false,
        isVoid: e.w2_void === true,
      },
      ytd,
      state: {
        stateCode,
        employerStateIdNumber: employerStateId === "" ? null : employerStateId,
        // ZERO, NOT A GUESS. Washington has no income tax, so there are no
        // state wages to report and no state income tax to report. The engine
        // refuses a non-zero box 17 outright
        // (W2_BOX_17_MUST_BE_BLANK_IN_WA), which is what makes stating these
        // constants here safe rather than presumptuous.
        stateWagesCents: 0,
        stateIncomeTaxCents: 0,
      },
    };

    const result = buildW2(request);
    if (result.ok) {
      forms.push(result);
    } else {
      refusedPeople.push({
        employeeId: e.id,
        // The display name, deliberately. This is the label on a refusal, and
        // the refusal frequently IS that the legal name is missing - so the
        // legal name cannot be what identifies the person in the message.
        displayName: e.full_name ?? e.id,
        refusals: result.refusals,
      });
    }
  }

  // Stable, human order. Sorted by what is PRINTED on the form, so the list on
  // the screen matches the stack of paper in Michael's hand.
  forms.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  refusedPeople.sort((a, b) => a.displayName.localeCompare(b.displayName));

  /* ── 7. the W-3 ────────────────────────────────────────────────────────── */

  // The engine excludes voided forms itself. This file does not pre-filter,
  // because then the exclusion would live in two places and could disagree.
  const w3 = forms.length > 0 ? buildW3(forms, taxYear) : null;

  /* ── 8. the comparison ─────────────────────────────────────────────────── */

  const { data: filedData, error: filedError } = await admin
    .from("filed_form_941_totals")
    .select(FILED_941_COLUMNS)
    .eq("tax_year", taxYear);

  if (filedError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `Could not read the filed ${taxYear} Form 941 figures: ${filedError.message}. Without ` +
        `them the W-2s can still be prepared, but the one check that matters - do they agree ` +
        `with what was already reported - cannot be run.`,
    };
  }

  const filedRows = (filedData ?? []) as unknown as FiledRow[];

  let filed: FiledNineFortyOnes | null = null;
  try {
    filed = filedRows.length > 0 ? summariseFiled(filedRows, taxYear) : null;
  } catch (e) {
    return { ok: false, code: "DATA_UNUSABLE", message: e instanceof Error ? e.message : String(e) };
  }

  /*
   * NULL MEANS NOT RUN, AND NOT-RUN IS NOT AGREEMENT.
   *
   * When no 941 has been recorded, this stays null and the screen says so in
   * gold. It would be easy to pass zeros to the engine instead and get a
   * comparison back; that comparison would show the W-3 disagreeing with zero
   * by the entire year's payroll, which is a five-line red alarm describing
   * nothing but the absence of data. Worse still, on a year with no wages at
   * all, zeros against zeros would come back ALL GREEN - a vacuous agreement
   * presented as a clean bill of health (standing rule 39).
   */
  const reconciliation =
    filed === null || w3 === null
      ? null
      : reconcileW3To941s({
          taxYear,
          w3,
          form941: filed.totals,
          unmatchedAdditionalMedicareCents: filed.unmatchedAdditionalMedicareCents,
        });

  return {
    ok: true,
    taxYear,
    forms,
    w3,
    refusedPeople,
    reconciliation,
    filed,
    linesMissingWaDetail,
    employeesWithNoWages,
    inactiveWithWages,
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §8  A SINGLE EMPLOYEE, FOR THE ONE-FORM VIEW
 *
 * Built on the same path as the whole year rather than beside it. A second
 * assembly routine for one person would be a second set of decisions about
 * names, premiums and box 14, and the two would eventually give different
 * answers for the same person - which is the exact failure this file's header
 * warns about (rule 25).
 *
 * The cost is that this reads the year to return one form. That is the right
 * trade: Greenway has a handful of employees, and correctness that cannot drift
 * is worth more than a query saved.
 * ═════════════════════════════════════════════════════════════════════════════ */

export async function loadW2ForEmployee(
  employeeId: string,
  taxYear: number,
): Promise<W2LoadResult> {
  const all = await loadW2s(taxYear);
  if (!all.ok) return all;

  const form = all.forms.find((f) => f.employeeId === employeeId) ?? null;
  const refused = all.refusedPeople.filter((r) => r.employeeId === employeeId);

  /*
   * NEITHER A FORM NOR A REFUSAL IS ITS OWN ANSWER, AND IT IS NOT AN ERROR.
   * It means this employee had no wages in this year, so there is no W-2 to
   * show. Returning an empty set with the counts intact lets the screen say
   * that plainly. Returning READ_FAILED would tell Michael something is broken
   * when nothing is.
   */
  return {
    ...all,
    forms: form ? [form] : [],
    refusedPeople: refused,
    // The W-3 is a total of ALL forms and is meaningless for one person. Null
    // rather than a one-form W-3, which would look like a filing document and
    // is not one.
    w3: null,
    // Likewise the comparison: it compares the YEAR against the year's returns.
    // A single form cannot be reconciled against four quarterly returns that
    // cover everybody, and showing the whole-company comparison next to one
    // person's form would invite reading it as that person's.
    reconciliation: null,
  };
}

/* ═════════════════════════════════════════════════════════════════════════════
 * §9  IS THE COMPARISON EVEN POSSIBLE YET
 *
 * Exported so the screen can distinguish "the check failed" from "the check
 * cannot be run yet", which are different sentences and prompt different
 * actions. A screen that renders both as a red X sends Michael looking for a
 * bookkeeping error when the real answer is "type in the four returns you
 * already filed".
 * ═════════════════════════════════════════════════════════════════════════════ */

export type ReconciliationReadiness = {
  readonly canRun: boolean;
  readonly quartersRecorded: number;
  readonly quartersMissing: readonly number[];
  readonly plain: string;
};

export function reconciliationReadiness(
  filed: FiledNineFortyOnes | null,
): ReconciliationReadiness {
  if (filed === null) {
    return {
      canRun: false,
      quartersRecorded: 0,
      quartersMissing: ALL_QUARTERS,
      plain:
        "No filed Form 941 figures have been recorded for this year, so the W-2s cannot be " +
        "compared against them yet. Enter what you actually filed for each of the four " +
        "quarters, from the returns themselves. Typing them in by hand is the point: the " +
        "comparison only means something because the two sides come from different places.",
    };
  }

  const n = filed.quartersFound.length;
  if (n === 4) {
    return {
      canRun: true,
      quartersRecorded: 4,
      quartersMissing: [],
      plain:
        "All four quarters are recorded, so the comparison below is complete. This is the " +
        "check the IRS says it runs, and it is far cheaper to fail it here in January than to " +
        "answer a letter about it in eighteen months.",
    };
  }

  const missing = filed.quartersMissing;
  return {
    canRun: false,
    quartersRecorded: n,
    quartersMissing: missing,
    plain:
      `${n} of the 4 quarters are recorded. ` +
      `${missing.map((q) => `Q${q}`).join(" and ")} ${missing.length === 1 ? "is" : "are"} ` +
      `missing, so any comparison would be short by ${missing.length === 1 ? "a quarter" : "those quarters"} ` +
      `of wages and would report a difference that is really just absent data. Enter the ` +
      `missing ${missing.length === 1 ? "return" : "returns"} before relying on the result.`,
  };
}

/**
 * The year's zeroed accumulator, for an employee with no row yet.
 *
 * Re-exported deliberately rather than reimplemented. `ytd-core.ts` owns what
 * "no wages yet" looks like, and a second definition here would be a second
 * answer to one question (rule 25). It is exported because a caller building a
 * preview for a not-yet-paid employee needs it, and because leaving it
 * unexported would invite that caller to write `wages: {}` by hand.
 */
export { emptyAccumulator };
