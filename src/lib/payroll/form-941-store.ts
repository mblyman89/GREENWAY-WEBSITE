/**
 * src/lib/payroll/form-941-store.ts   (books-40 phase F)
 *
 * THE JOIN FOR THE QUARTERLY RETURN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS FOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `form-941-core.ts` can build a Form 941 from a list of people and their
 * quarterly wages. It is pure, it is mutation tested, and it has been proved
 * against a return the IRS actually accepted. What it cannot do is find out who
 * was paid at Greenway between 1 April and 30 June. That is this file's job.
 *
 * It reads the pay runs whose PAY DATE falls inside the quarter, pulls the
 * per-tax columns migration 0199 added to `payroll_run_lines`, works out who
 * was on the payroll for the pay period containing the 12th of the last month,
 * and hands all of it to `buildForm941`.
 *
 * It performs NO tax arithmetic of its own. Not a rate, not a cap, not a
 * rounding. If this file did its own sums they would eventually disagree with
 * the engine's, silently, on a form that goes to the federal government.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS THE PAY DATE AND NOT THE PERIOD END DATE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A pay period running 21 June to 4 July, paid on 10 July, is THIRD quarter
 * wages. Every cent of it, including the ten days that were worked in June.
 * Federal employment tax follows the date the money is constructively received,
 * not the days that earned it.
 *
 * This is the single most common way a 941 goes wrong, it is invisible once it
 * has happened, and it misstates two quarters at once - the one that is short
 * and the one that is over. So the quarter filter in this file is on
 * `payroll_runs.pay_date` and there is a test that fails if anybody changes it
 * to `end_date`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE THINGS THIS FILE REFUSES TO INVENT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   1. DEPOSITS.  There is no federal tax deposit table in this database. Not
 *      one migration creates it. So `totalDepositsCents` is passed as `null`
 *      and the engine raises DEPOSITS_UNKNOWN rather than assuming zero -
 *      because assuming zero turns a fully paid quarter into a balance due
 *      equal to the entire quarter's tax, which is a number that would make
 *      Michael reach for a chequebook he does not need.
 *
 *   2. THE 12TH-OF-THE-MONTH HEADCOUNT.  Line 1 is not "how many people work
 *      here". It is how many were on the payroll for the ONE pay period that
 *      contains the 12th of the quarter's last month. If no pay period in the
 *      calendar covers that date, this file reports `null` and the engine
 *      raises TWELFTH_DAY_UNKNOWN. It does not fall back to a headcount.
 *
 *   3. A PRE-0199 LINE'S TAX SPLIT.  The per-tax columns are nullable with no
 *      default, deliberately (standing rule 62d) - a line written before that
 *      migration genuinely does not know its own split. Those lines are counted
 *      and reported as `linesMissingTaxDetail`, never silently treated as zero.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE WRITES NOTHING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Reading and filing are separate acts. Nothing here inserts, updates or
 * transmits anything, and the screen above it says so in as many words.
 */

import "server-only";

import {
  buildForm941,
  twelfthDayFor,
  type Form941Request,
  type Form941Result,
  type Form941Subject,
} from "@/lib/payroll/form-941-core";
import { quarterDateRange, type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import type { ScheduleBPayday } from "@/lib/payroll/form-941-schedule-b-core";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

/* ═══════════════════════════════════════════════════════════════════════════
 * FAILURES - the shape the rest of the payroll layer already uses
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941StoreFailureCode = "NOT_CONFIGURED" | "READ_FAILED" | "DATA_UNUSABLE";

export type Form941StoreFailure = {
  readonly ok: false;
  readonly code: Form941StoreFailureCode;
  readonly message: string;
};

const NOT_CONFIGURED =
  "The database connection is not configured in this environment, so the quarterly return cannot be assembled. Nothing is wrong with your books - this screen simply has nothing to read from here.";

/**
 * The columns the 941 needs off a pay run line.
 *
 * Named as a constant, and used by BOTH the quarter read and the 12th-of-the
 * month read, so the two cannot drift apart. Standing rule 25.
 */
const RUN_LINE_941_COLUMNS =
  "run_id, employee_id, employee_name, gross_pay_cents, federal_income_tax_cents, oasdi_employee_cents, medicare_employee_cents, addl_medicare_employee_cents, oasdi_wages_cents, medicare_wages_cents" as const;

type RunRow = {
  readonly id: string;
  readonly pay_date: string;
  readonly status: string;
  readonly label: string | null;
};

type LineRow = {
  readonly run_id: string;
  readonly employee_id: string | null;
  readonly employee_name: string;
  readonly gross_pay_cents: number | null;
  readonly federal_income_tax_cents: number | null;
  readonly oasdi_employee_cents: number | null;
  readonly medicare_employee_cents: number | null;
  readonly addl_medicare_employee_cents: number | null;
  readonly oasdi_wages_cents: number | null;
  readonly medicare_wages_cents: number | null;
};

/* ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE SCREEN GETS BACK
 * ═══════════════════════════════════════════════════════════════════════════ */

export type Form941Loaded = {
  readonly ok: true;
  readonly quarter: QuarterRef;
  /** Whatever the engine said - a finished return, or a list of refusals. */
  readonly result: Form941Result;
  /** How many pay runs fed this quarter. Zero is a legitimate answer. */
  readonly runCount: number;
  /** The pay dates that fed it, so Michael can tick them off against his diary. */
  readonly payDates: readonly string[];
  /**
   * The same lines regrouped BY PAY DATE, for Schedule B.
   *
   * Schedule B is a daily form, so it needs the one dimension the return itself
   * throws away: which payday each figure landed on. Built from the same
   * `usableLines` the return is built from, joined run_id -> pay_date, so the
   * two cannot disagree about the quarter's totals.
   */
  readonly paydays: readonly ScheduleBPayday[];
  /**
   * Lines that predate migration 0199 and therefore do not know their own tax
   * split. Excluded from the return and reported, never treated as zero.
   */
  readonly linesMissingTaxDetail: number;
  /**
   * The date line 1 is measured on, and whether a pay period was found that
   * contains it. When `periodFound` is false every subject's line-1 answer is
   * `null` and the engine refuses - that is the intended behaviour, not a bug.
   */
  readonly twelfthDay: { readonly date: string; readonly periodFound: boolean };
  /** Runs excluded because they were voided. Shown so the count reconciles. */
  readonly voidedRunsExcluded: number;
};

export type Form941LoadResult = Form941Loaded | Form941StoreFailure;

/* ═══════════════════════════════════════════════════════════════════════════
 * SMALL HELPERS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * NOTE ON THE 12TH OF THE MONTH: the date itself comes from
 * `twelfthDayFor` in `form-941-core`, imported above. It is deliberately NOT
 * recomputed here. The rule ("the 12th of the quarter's last month") is part of
 * the return's definition, it is tested where it lives, and a second copy in a
 * store file is exactly how two answers to one question come into existence.
 */

/** A nullable bigint column that must be present for a line to be usable. */
function usable(line: LineRow): boolean {
  return (
    line.oasdi_wages_cents !== null &&
    line.medicare_wages_cents !== null &&
    line.federal_income_tax_cents !== null &&
    line.oasdi_employee_cents !== null &&
    line.medicare_employee_cents !== null
  );
}

/** Cents off a column already proved non-null by `usable`. */
function cents(v: number | null): number {
  return typeof v === "number" ? v : 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE READ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Assemble the quarter's Form 941 from what is actually in the database.
 *
 * The steps, in order, and why each one is where it is:
 *
 *   1. Find the runs whose PAY DATE lands in the quarter. Voided runs are
 *      dropped and counted - a voided run is not a correction, it is a run
 *      that never happened, and including it would overstate every line.
 *   2. Read their lines. Lines without a tax split are dropped and counted.
 *   3. Work out which pay period contains the 12th of the last month, and who
 *      was paid on that period's pay date. That, and only that, answers line 1.
 *   4. Sum per employee - the ONLY arithmetic in this file, and it is addition
 *      of stored figures, not tax computation.
 *   5. Hand it to the engine and return whatever the engine says.
 */
export async function loadForm941(quarter: QuarterRef): Promise<Form941LoadResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();
  const range = quarterDateRange(quarter);

  /* ── 1. the runs, BY PAY DATE ─────────────────────────────────────────── */

  const { data: runData, error: runError } = await admin
    .from("payroll_runs")
    .select("id, pay_date, status, label")
    .gte("pay_date", range.start)
    .lte("pay_date", range.end)
    .order("pay_date", { ascending: true });

  if (runError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pay runs for this quarter: ${runError.message}. The return cannot be assembled without them, and a partial return is worse than none.`,
    };
  }

  const allRuns = (runData ?? []) as unknown as RunRow[];
  const runs = allRuns.filter((r) => r.status !== "void");
  const voidedRunsExcluded = allRuns.length - runs.length;

  /* ── 2. the lines ─────────────────────────────────────────────────────── */

  const runIds = runs.map((r) => r.id);
  let lines: LineRow[] = [];

  if (runIds.length > 0) {
    const { data: lineData, error: lineError } = await admin
      .from("payroll_run_lines")
      .select(RUN_LINE_941_COLUMNS)
      .in("run_id", runIds);

    if (lineError) {
      return {
        ok: false,
        code: "READ_FAILED",
        message: `Could not read the pay run lines for this quarter: ${lineError.message}. The return cannot be assembled without them.`,
      };
    }
    lines = (lineData ?? []) as unknown as LineRow[];
  }

  const usableLines = lines.filter(usable);
  const linesMissingTaxDetail = lines.length - usableLines.length;

  /* ── 3. the 12th of the last month ────────────────────────────────────── */

  const twelfth = twelfthDayFor(quarter);

  const { data: periodData, error: periodError } = await admin
    .from("pay_periods")
    .select("id, pay_date, start_date, end_date")
    .lte("start_date", twelfth)
    .gte("end_date", twelfth);

  if (periodError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pay period calendar to answer line 1: ${periodError.message}. Line 1 asks how many people were on the payroll for the pay period containing ${twelfth}, and that question cannot be answered without the calendar.`,
    };
  }

  const periods = (periodData ?? []) as unknown as { pay_date: string }[];
  const periodFound = periods.length > 0;
  const twelfthPayDates = new Set(periods.map((p) => p.pay_date));

  // Which runs were paid on that period's pay date, and therefore which people
  // the line-1 count is drawn from.
  const twelfthRunIds = new Set(runs.filter((r) => twelfthPayDates.has(r.pay_date)).map((r) => r.id));
  const paidForTwelfth = new Set(
    usableLines.filter((l) => twelfthRunIds.has(l.run_id)).map((l) => l.employee_id ?? l.employee_name),
  );

  /* ── 4. sum per person ────────────────────────────────────────────────── */

  type Bucket = {
    displayName: string;
    wagesCents: number;
    oasdiTaxableWagesCents: number;
    medicareTaxableWagesCents: number;
    federalIncomeTaxWithheldCents: number;
    actualEmployeeFicaWithheldCents: number;
  };

  const buckets = new Map<string, Bucket>();

  for (const l of usableLines) {
    const key = l.employee_id ?? l.employee_name;
    const existing = buckets.get(key);
    const bucket: Bucket = existing ?? {
      displayName: l.employee_name,
      wagesCents: 0,
      oasdiTaxableWagesCents: 0,
      medicareTaxableWagesCents: 0,
      federalIncomeTaxWithheldCents: 0,
      actualEmployeeFicaWithheldCents: 0,
    };

    // Line 2 is "wages, tips and other compensation" - W-2 box 1. Gross pay is
    // the closest stored figure. When it is missing, Medicare wages are the
    // honest substitute: Medicare has no ceiling, so for everybody at Greenway
    // it equals the same base, and it is a STORED figure rather than a guess.
    bucket.wagesCents += cents(l.gross_pay_cents ?? l.medicare_wages_cents);
    bucket.oasdiTaxableWagesCents += cents(l.oasdi_wages_cents);
    bucket.medicareTaxableWagesCents += cents(l.medicare_wages_cents);
    bucket.federalIncomeTaxWithheldCents += cents(l.federal_income_tax_cents);
    // Additional Medicare is withheld from the employee and is part of what was
    // actually taken off the cheque, so it belongs in the line 7 comparison.
    bucket.actualEmployeeFicaWithheldCents +=
      cents(l.oasdi_employee_cents) +
      cents(l.medicare_employee_cents) +
      cents(l.addl_medicare_employee_cents);

    buckets.set(key, bucket);
  }

  /* ── 4b. sum per PAYDAY, for Schedule B ─────────────────────────────────── */

  const payDateOf = new Map(runs.map((r) => [r.id, r.pay_date]));
  const perPayday = new Map<string, ScheduleBPayday>();

  for (const l of usableLines) {
    const payDate = payDateOf.get(l.run_id);
    // A line whose run is not in `runs` cannot happen - the lines were read BY
    // those run ids - but a silent `?? ""` would put a whole payday on a date
    // Schedule B has no space for.
    if (payDate === undefined) continue;
    const prior = perPayday.get(payDate);
    const add: ScheduleBPayday = {
      payDate,
      federalIncomeTaxCents: cents(l.federal_income_tax_cents),
      employeeFicaWithheldCents:
        cents(l.oasdi_employee_cents) +
        cents(l.medicare_employee_cents) +
        cents(l.addl_medicare_employee_cents),
      oasdiWagesCents: cents(l.oasdi_wages_cents),
      medicareWagesCents: cents(l.medicare_wages_cents),
    };
    perPayday.set(
      payDate,
      prior === undefined
        ? add
        : {
            payDate,
            federalIncomeTaxCents: prior.federalIncomeTaxCents + add.federalIncomeTaxCents,
            employeeFicaWithheldCents:
              prior.employeeFicaWithheldCents + add.employeeFicaWithheldCents,
            oasdiWagesCents: prior.oasdiWagesCents + add.oasdiWagesCents,
            medicareWagesCents: prior.medicareWagesCents + add.medicareWagesCents,
          },
    );
  }

  const paydays = [...perPayday.values()].sort((a, b) =>
    a.payDate < b.payDate ? -1 : a.payDate > b.payDate ? 1 : 0,
  );

  const subjects: Form941Subject[] = [...buckets.entries()].map(([subjectId, b]) => ({
    subjectId,
    displayName: b.displayName,
    wagesCents: b.wagesCents,
    oasdiTaxableWagesCents: b.oasdiTaxableWagesCents,
    medicareTaxableWagesCents: b.medicareTaxableWagesCents,
    federalIncomeTaxWithheldCents: b.federalIncomeTaxWithheldCents,
    actualEmployeeFicaWithheldCents: b.actualEmployeeFicaWithheldCents,
    // `null`, not `false`, when the calendar cannot answer the question.
    onPayrollForTwelfthPayPeriod: periodFound ? paidForTwelfth.has(subjectId) : null,
  }));

  subjects.sort((a, b) => a.displayName.localeCompare(b.displayName));

  /* ── 5. the engine decides ────────────────────────────────────────────── */

  const request: Form941Request = {
    quarter,
    subjects,
    // There is no federal tax deposit table in this database. Passing `null` is
    // the honest answer and it makes the engine say so on the screen.
    totalDepositsCents: null,
    sourceLabel: `${runs.length} pay run${runs.length === 1 ? "" : "s"} with a pay date between ${range.start} and ${range.end}`,
  };

  return {
    ok: true,
    quarter,
    result: buildForm941(request),
    runCount: runs.length,
    payDates: runs.map((r) => r.pay_date),
    paydays,
    linesMissingTaxDetail,
    twelfthDay: { date: twelfth, periodFound },
    voidedRunsExcluded,
  };
}
