/**
 * src/lib/payroll/form-940-store.ts   (books-47, slice D)
 *
 * WHAT THE DATABASE CAN HONESTLY SAY ABOUT FORM 940, AND WHAT IT CANNOT.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `form-940-core.ts` and `form-940-authorities.ts` have been 2,037 lines of
 * engine and verbatim law since books-45, and there was no page, no nav entry
 * and no way to reach a word of it. Standing rule 50: dead code wearing a
 * green check. Michael's slice-D correction named Form 940 FIRST -- "the
 * payroll forms like 940 941 l&I esd pfml wa cares etc." -- so it needed a
 * door before it needed anything else.
 *
 * A page needs data. This is the data layer, and it is deliberately the
 * smallest one that can be written truthfully.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE HALF THIS FILE REFUSES TO INVENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A Form 940 needs facts the payroll tables genuinely do not contain:
 *
 *   - what Michael actually PAID Washington in state unemployment tax, and
 *     whether each payment landed before or after the federal due date;
 *   - the experience rate Washington assigned him for the year;
 *   - the DOL credit reduction rate for the state;
 *   - FUTA already deposited;
 *   - whether any employee's wages were excluded from state unemployment tax.
 *
 * Every one of those is `null` in the engine's request type, and every one of
 * them REFUSES rather than defaulting. That design is the whole reason this
 * store can be honest: it passes the nulls straight through and lets the
 * engine produce a refusal that names the missing fact and the consequence.
 *
 * The alternative -- defaulting the experience rate to 5.4%, or the credit
 * reduction to zero, or deposits to zero -- would produce a Form 940 that
 * looks finished and is fiction. Standing rule 62d: never invent a default.
 * A zero deposit figure in particular turns a fully-deposited year into a
 * fabricated balance due, which is a number Michael might actually pay.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES COMPUTE, AND WHY THAT PART IS SAFE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Wages paid, per person, for the calendar year, BY PAY DATE. That is a
 * summation over rows the database really has, and it is the same convention
 * the 941 store uses, for the same reason: FUTA follows the date the money
 * moved, not the period it was earned for.
 *
 * It performs NO tax arithmetic. Not a rate, not the $7,000 cap, not a
 * rounding. The cap in particular is the engine's job -- `taxableFutaWages
 * ForEmployee` already implements it and is tested. If this file did its own
 * sums they would eventually disagree with the engine's, silently, on a form
 * that goes to the federal government.
 *
 * The filing test is likewise NOT derived. The engine's own comment records
 * that its first draft tried to recover wages by dividing quarterly FUTA by
 * 0.6% and that this was wrong twice over. The largest-quarter figure IS
 * computable from pay dates, so it is computed; the week count is not, so it
 * is left null.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  buildForm940,
  type Form940Employee,
  type Form940Request,
  type Form940Result,
} from "@/lib/payroll/form-940-core";

/* ═══════════════════════════════════════════════════════════════════════
 * WHAT THE SCREEN GETS BACK
 * ═══════════════════════════════════════════════════════════════════════ */

export type Form940StoreFailureCode = "NOT_CONFIGURED" | "READ_FAILED";

export type Form940StoreFailure = {
  readonly ok: false;
  readonly code: Form940StoreFailureCode;
  readonly message: string;
};

const NOT_CONFIGURED =
  "The database connection is not configured in this environment, so the annual FUTA return cannot be assembled. Nothing is wrong with your books - this screen simply has nothing to read from here.";

export type Form940Loaded = {
  readonly ok: true;
  readonly year: number;
  /** Whatever the engine said - a finished return, or a list of refusals. */
  readonly result: Form940Result;
  /** How many pay runs fed this year. Zero is a legitimate answer. */
  readonly runCount: number;
  /** The pay dates that fed it, so Michael can tick them off against his diary. */
  readonly payDates: readonly string[];
  /**
   * The facts the database cannot know, listed for the screen.
   *
   * Named rather than merely absent, because "the engine refused" is far less
   * useful than "the engine refused and here is the short list of things only
   * you can tell it".
   */
  readonly factsOnlyMichaelKnows: readonly string[];
};

export type Form940LoadResult = Form940Loaded | Form940StoreFailure;

/**
 * The columns Form 940 needs off a pay run line.
 *
 * Gross pay only. FUTA is charged on wages paid, and the engine applies the
 * $7,000 cap itself.
 */
const RUN_LINE_940_COLUMNS = "run_id, employee_id, employee_name, gross_pay_cents" as const;

type RunRow = {
  readonly id: string;
  readonly pay_date: string;
};

type LineRow = {
  readonly run_id: string;
  readonly employee_id: string | null;
  readonly employee_name: string;
  readonly gross_pay_cents: number | null;
};

/**
 * The facts no payroll table contains.
 *
 * Exported as DATA rather than typed into the page, so a test can assert the
 * list is non-empty and the screen cannot quietly drop one (standing rule 43).
 */
export const FORM_940_FACTS_ONLY_MICHAEL_KNOWS: readonly string[] = [
  "What you actually paid Washington in state unemployment tax this year, and how much of it was paid on or before the Form 940 due date. Money paid late still earns credit, but only 90 cents on the dollar; money never paid earns nothing at all.",
  "The experience rate Washington assigned you for the year, in basis points. A rate below 5.4% is worth extra federal credit, so a good experience rating saves you money twice.",
  "Your taxable state unemployment wages. This is NOT the federal figure - the federal base is $7,000 per person and Washington's is many times that.",
  "The DOL credit reduction rate for Washington. It is zero today, but 'not this year' is a fact with an expiry date, so it is asked rather than assumed.",
  "How much FUTA you have already deposited during the year.",
  "Your FUTA liability incurred in each quarter, for Part 5.",
  "Whether any employee's wages were excluded from state unemployment tax.",
  "How many different weeks had at least one employee, this year and last. The obligation is sticky: cross the threshold once and the following year is captured too.",
];

/* ═══════════════════════════════════════════════════════════════════════
 * THE READ
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Assemble what can be assembled for a calendar year.
 *
 * `known` carries whatever Michael has supplied. Everything absent from it
 * stays null and the engine refuses, which is the correct outcome and not an
 * error condition.
 */
export async function loadForm940(
  year: number,
  known?: Partial<
    Pick<Form940Request, "statePayments" | "creditReductionMilliPct" | "depositedCents" | "quarterly">
  >,
): Promise<Form940LoadResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  /* ── 1. the runs, BY PAY DATE ────────────────────────────────────────
     FUTA follows the date the money moved. Same convention as the 941. */

  const { data: runData, error: runError } = await admin
    .from("payroll_runs")
    .select("id, pay_date")
    .gte("pay_date", start)
    .lte("pay_date", end)
    .order("pay_date", { ascending: true });

  if (runError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pay runs for ${year}: ${runError.message}. The return cannot be assembled without them, and a partial return is worse than none.`,
    };
  }

  const runs = (runData ?? []) as readonly RunRow[];
  const runIds = runs.map((r) => r.id);
  const payDateOf = new Map(runs.map((r) => [r.id, r.pay_date] as const));

  /* ── 2. the lines ─────────────────────────────────────────────────── */

  let lines: readonly LineRow[] = [];
  if (runIds.length > 0) {
    const { data: lineData, error: lineError } = await admin
      .from("payroll_run_lines")
      .select(RUN_LINE_940_COLUMNS)
      .in("run_id", runIds);

    if (lineError) {
      return {
        ok: false,
        code: "READ_FAILED",
        message: `Could not read the pay run lines for ${year}: ${lineError.message}.`,
      };
    }
    lines = (lineData ?? []) as readonly LineRow[];
  }

  /* ── 3. wages per person, and the largest quarter ─────────────────────
     Both are summations over rows that exist. Neither is a tax figure. */

  const byPerson = new Map<string, { name: string; cents: number }>();
  const byQuarter = [0, 0, 0, 0];

  for (const l of lines) {
    const gross = l.gross_pay_cents ?? 0;
    const key = l.employee_id ?? `name:${l.employee_name}`;
    const prior = byPerson.get(key);
    byPerson.set(key, {
      name: l.employee_name,
      cents: (prior?.cents ?? 0) + gross,
    });

    const payDate = payDateOf.get(l.run_id);
    if (payDate !== undefined) {
      // "2027-04-15" -> month 4 -> quarter 2. Parsed off the string rather
      // than through Date, which would apply a timezone to a date that has
      // none and can move a 1 January pay date into the previous year.
      const month = Number(payDate.slice(5, 7));
      const q = Math.floor((month - 1) / 3);
      if (q >= 0 && q <= 3) byQuarter[q] += gross;
    }
  }

  const employees: readonly Form940Employee[] = [...byPerson.entries()].map(
    ([employeeId, v]): Form940Employee => ({
      employeeId,
      name: v.name,
      totalPaymentsCents: v.cents,
      // Nothing in the payroll tables records a FUTA-exempt payment type yet,
      // so this is zero as a STATEMENT rather than as a guess: no exempt
      // payments have been recorded. If a fringe-benefit or retirement code is
      // added later this is the line that must read it.
      exemptPaymentsCents: 0,
      // Nobody has recorded this. Null refuses; false would silently claim a
      // credit that may not exist.
      excludedFromStateUnemploymentTax: null,
    }),
  );

  const request: Form940Request = {
    year,
    employees,
    statePayments: known?.statePayments ?? {
      paidOnTimeCents: null,
      paidLateCents: null,
      notPaidCents: null,
      taxableStateWagesCents: null,
      experienceRateBps: null,
    },
    filingTest: {
      maxQuarterWagesThisYearCents: lines.length > 0 ? Math.max(...byQuarter) : null,
      // The prior year is a separate read this store does not perform, and a
      // zero here would answer "no" to half of a two-year test.
      maxQuarterWagesPriorYearCents: null,
      // Weeks with any employee is not derivable from pay runs: a biweekly run
      // covers two weeks and says nothing about which days had staff on hand.
      weeksWithAnyEmployeeThisYear: null,
      weeksWithAnyEmployeePriorYear: null,
    },
    creditReductionMilliPct: known?.creditReductionMilliPct ?? null,
    depositedCents: known?.depositedCents ?? null,
    quarterly: known?.quarterly ?? null,
  };

  return {
    ok: true,
    year,
    result: buildForm940(request),
    runCount: runs.length,
    payDates: runs.map((r) => r.pay_date),
    factsOnlyMichaelKnows: FORM_940_FACTS_ONLY_MICHAEL_KNOWS,
  };
}
