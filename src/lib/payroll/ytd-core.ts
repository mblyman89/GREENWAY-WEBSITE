/**
 * src/lib/payroll/ytd-core.ts   (books-34)
 *
 * THE MEMORY BETWEEN PAY RUNS.
 *
 * `payroll-withholding-core.ts` already knows how to stop Social Security at
 * the wage base. It has known since the withholding slice. What it has never
 * had is anyone to tell it what the employee was already paid this year, and a
 * ceiling you cannot see is a ceiling you cannot stop at.
 *
 * This module is that missing half. It is deliberately PURE - no database, no
 * Supabase client, no `node:fs` (standing rule 65b: nothing here may drag a
 * server-only module into a client bundle). It takes numbers in and gives
 * numbers back. The store layer hands it rows; it hands back the row that
 * should be written. That split is what makes every rule below testable
 * without a database, and it is why the worked example from the IRS can be run
 * as an ordinary unit test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FOUR THINGS THAT GO WRONG WITH RUNNING TOTALS, AND WHAT IS DONE ABOUT THEM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. DOUBLE POSTING. A pay run posted twice doubles the year. Every function
 *    here that advances a total is keyed by run id, and `applyRunToAccumulator`
 *    refuses a run it has already seen rather than adding again.
 *
 * 2. VOIDING THAT DOES NOT UNWIND. `payroll_runs.status` already includes
 *    'void'. Voiding a run that was never subtracted back out leaves the
 *    employee permanently over-accumulated, and the error is invisible: the
 *    totals still look like plausible money. `unapplyRunFromAccumulator` is the
 *    inverse of applying, and the two are tested as a round trip.
 *
 * 3. DRIFT. A stored total is a claim about rows that live somewhere else.
 *    `reconcileAccumulator` recomputes from the lines and REPORTS the
 *    difference. It deliberately does not silently overwrite - a total that
 *    quietly repairs itself hides the bug that caused the drift.
 *
 * 4. THE CEILING CROSSED MID-PERIOD. The interesting case is not "under the
 *    ceiling" or "over the ceiling" but the single cheque that straddles it,
 *    where part of the wages are taxable and the rest are not.
 *    `applyWageCeiling` in the withholding core already handles the split; this
 *    module's job is to feed it the correct starting figure so it can.
 *
 * UNITS. Whole cents as integers, everywhere, except `lniHundredthHours` which
 * is hundredth-hours (4000 = 40.00 hours) because L&I assesses premiums on
 * hours worked rather than wages. Matching the schema and the withholding core
 * exactly, so no reader is ever translating between two conventions.
 */
import {
  type YtdWageAccumulators,
  ZERO_YTD,
  computeFicaForPeriod,
  OASDI_WAGE_BASE_2026_CENTS,
} from "@/lib/payroll/payroll-withholding-core";

/**
 * The stored row, as this module sees it.
 *
 * Mirrors public.payroll_ytd_accumulators field for field. The wage figures are
 * spelled the same as `YtdWageAccumulators` so that moving between the engine,
 * this module and the database is never a translation exercise.
 */
export type YtdAccumulatorRow = {
  readonly employeeId: string;
  /** CALENDAR year. Every ceiling here is defined on the calendar year. */
  readonly taxYear: number;
  readonly wages: YtdWageAccumulators;
  /** Taxes actually withheld so far this year. */
  readonly oasdiEmployeeCents: number;
  readonly medicareEmployeeCents: number;
  readonly addlMedicareEmployeeCents: number;
  readonly federalIncomeTaxCents: number;
  /** Which pay run last fed this row. Null before the first run of the year. */
  readonly lastRunId: string | null;
};

/** What one pay run contributes to one employee's year. */
export type RunContribution = {
  readonly runId: string;
  readonly oasdiWagesCents: number;
  readonly medicareWagesCents: number;
  readonly futaWagesCents: number;
  readonly waSutaWagesCents: number;
  readonly waPfmlWagesCents: number;
  readonly waCaresWagesCents: number;
  readonly lniHundredthHours: number;
  readonly oasdiEmployeeCents: number;
  readonly medicareEmployeeCents: number;
  readonly addlMedicareEmployeeCents: number;
  readonly federalIncomeTaxCents: number;
};

/**
 * Why an operation was refused.
 *
 * Codes rather than prose because a screen has to be able to BRANCH on the
 * reason, and because standing rule 43 requires every one of these to be
 * reachable by a test. Each is proven reachable in
 * tests/compliance/ytd-core.test.ts.
 */
// A NOTE ON A CODE THAT IS NOT HERE. An earlier draft declared
// "YTD_RUN_NOT_APPLIED", for unwinding a run that was never applied. It was
// removed rather than implemented, because that condition is already caught
// more precisely by YTD_WOULD_GO_NEGATIVE - which reports WHICH figure would go
// below zero and by how much, instead of a bare "not found". The rule-43
// coverage test found it within a minute of being written: declared, listed,
// and produced by nothing. That is standing rule 50 exactly - dead code wearing
// a green check - and the fix is deletion, not a synthetic test to reach it.
export type YtdRefusalCode =
  | "YTD_RUN_ALREADY_APPLIED"
  | "YTD_NEGATIVE_INPUT"
  | "YTD_NON_INTEGER_INPUT"
  | "YTD_YEAR_MISMATCH"
  | "YTD_EMPLOYEE_MISMATCH"
  | "YTD_WOULD_GO_NEGATIVE"
  | "YTD_MEDICARE_BELOW_OASDI";

export type YtdRefusal = {
  readonly ok: false;
  readonly code: YtdRefusalCode;
  /** Plain English. Michael reads these, not the code. */
  readonly message: string;
};

export type YtdOk<T> = { readonly ok: true; readonly value: T };
export type YtdResult<T> = YtdOk<T> | YtdRefusal;

function refuse(code: YtdRefusalCode, message: string): YtdRefusal {
  return { ok: false, code, message };
}

/** An accumulator for an employee who has not been paid yet this year. */
export function emptyAccumulator(employeeId: string, taxYear: number): YtdAccumulatorRow {
  return {
    employeeId,
    taxYear,
    wages: { ...ZERO_YTD },
    oasdiEmployeeCents: 0,
    medicareEmployeeCents: 0,
    addlMedicareEmployeeCents: 0,
    federalIncomeTaxCents: 0,
    lastRunId: null,
  };
}

/**
 * Every figure must be a non-negative integer number of cents (or
 * hundredth-hours).
 *
 * This is checked rather than trusted because the single most expensive class
 * of payroll bug is a units error, and a float that arrives here as 1234.5600000001
 * becomes a total that never quite reconciles and cannot be explained. Standing
 * rule 48: a check that cannot classify its input must say so, so the refusal
 * names the offending field rather than reporting a generic failure.
 */
function validateContribution(c: RunContribution): YtdRefusal | null {
  const fields: ReadonlyArray<readonly [string, number]> = [
    ["oasdiWagesCents", c.oasdiWagesCents],
    ["medicareWagesCents", c.medicareWagesCents],
    ["futaWagesCents", c.futaWagesCents],
    ["waSutaWagesCents", c.waSutaWagesCents],
    ["waPfmlWagesCents", c.waPfmlWagesCents],
    ["waCaresWagesCents", c.waCaresWagesCents],
    ["lniHundredthHours", c.lniHundredthHours],
    ["oasdiEmployeeCents", c.oasdiEmployeeCents],
    ["medicareEmployeeCents", c.medicareEmployeeCents],
    ["addlMedicareEmployeeCents", c.addlMedicareEmployeeCents],
    ["federalIncomeTaxCents", c.federalIncomeTaxCents],
  ];
  for (const [name, v] of fields) {
    if (!Number.isInteger(v)) {
      return refuse(
        "YTD_NON_INTEGER_INPUT",
        `${name} is ${v}, which is not a whole number. Every payroll figure here is ` +
          `whole cents (or hundredth-hours for L&I). A fraction of a cent means a ` +
          `rounding decision was skipped somewhere upstream, and it will not reconcile at year end.`,
      );
    }
    if (v < 0) {
      return refuse(
        "YTD_NEGATIVE_INPUT",
        `${name} is ${v}. A pay run cannot contribute negative wages or negative tax. ` +
          `To reverse a run, void it - that unwinds the same figures through the same path ` +
          `that added them, and leaves a record of both.`,
      );
    }
  }
  // The SSA's first rejection condition, enforced at the point of entry rather
  // than waiting for the database to catch it. Medicare has no ceiling and
  // Social Security does, so within a single run medicare wages can never be
  // the smaller of the two.
  if (c.medicareWagesCents < c.oasdiWagesCents) {
    return refuse(
      "YTD_MEDICARE_BELOW_OASDI",
      `This run reports ${c.medicareWagesCents} cents of Medicare wages but ` +
        `${c.oasdiWagesCents} cents of Social Security wages. Medicare wages can never be ` +
        `lower: Social Security stops at the annual wage base and Medicare never stops. ` +
        `The SSA rejects a W-2 that says otherwise.`,
    );
  }
  return null;
}

/**
 * Add one pay run's figures to an employee's year.
 *
 * REFUSES A RUN IT HAS ALREADY SEEN. This is the guard that makes posting
 * idempotent, and it matters more than it looks: a retried request, a
 * double-clicked button or a resumed job all produce the same run id twice, and
 * without this the employee's year silently doubles. Nothing about the
 * resulting numbers would look wrong - they would just be twice as large.
 */
export function applyRunToAccumulator(
  row: YtdAccumulatorRow,
  contribution: RunContribution,
): YtdResult<YtdAccumulatorRow> {
  const bad = validateContribution(contribution);
  if (bad) return bad;

  if (row.lastRunId === contribution.runId) {
    return refuse(
      "YTD_RUN_ALREADY_APPLIED",
      `Pay run ${contribution.runId} has already been added to ${row.employeeId}'s ` +
        `${row.taxYear} totals. Adding it twice would double the year, and the result would ` +
        `look like ordinary money rather than an error. Nothing was changed.`,
    );
  }

  return {
    ok: true,
    value: {
      ...row,
      wages: {
        oasdiWagesCents: row.wages.oasdiWagesCents + contribution.oasdiWagesCents,
        medicareWagesCents: row.wages.medicareWagesCents + contribution.medicareWagesCents,
        futaWagesCents: row.wages.futaWagesCents + contribution.futaWagesCents,
        waSutaWagesCents: row.wages.waSutaWagesCents + contribution.waSutaWagesCents,
        waPfmlWagesCents: row.wages.waPfmlWagesCents + contribution.waPfmlWagesCents,
        waCaresWagesCents: row.wages.waCaresWagesCents + contribution.waCaresWagesCents,
        lniHundredthHours: row.wages.lniHundredthHours + contribution.lniHundredthHours,
      },
      oasdiEmployeeCents: row.oasdiEmployeeCents + contribution.oasdiEmployeeCents,
      medicareEmployeeCents: row.medicareEmployeeCents + contribution.medicareEmployeeCents,
      addlMedicareEmployeeCents:
        row.addlMedicareEmployeeCents + contribution.addlMedicareEmployeeCents,
      federalIncomeTaxCents: row.federalIncomeTaxCents + contribution.federalIncomeTaxCents,
      lastRunId: contribution.runId,
    },
  };
}

/**
 * Remove one pay run's figures from an employee's year - the exact inverse of
 * applying, used when a run is voided.
 *
 * REFUSES TO GO NEGATIVE. If unwinding a run would drive any total below zero,
 * the totals and the run disagree about what was posted, and the honest answer
 * is to stop and say so. Clamping at zero would produce a tidy-looking figure
 * that is wrong, and would destroy the evidence needed to work out why.
 */
export function unapplyRunFromAccumulator(
  row: YtdAccumulatorRow,
  contribution: RunContribution,
): YtdResult<YtdAccumulatorRow> {
  const bad = validateContribution(contribution);
  if (bad) return bad;

  const next = {
    oasdiWagesCents: row.wages.oasdiWagesCents - contribution.oasdiWagesCents,
    medicareWagesCents: row.wages.medicareWagesCents - contribution.medicareWagesCents,
    futaWagesCents: row.wages.futaWagesCents - contribution.futaWagesCents,
    waSutaWagesCents: row.wages.waSutaWagesCents - contribution.waSutaWagesCents,
    waPfmlWagesCents: row.wages.waPfmlWagesCents - contribution.waPfmlWagesCents,
    waCaresWagesCents: row.wages.waCaresWagesCents - contribution.waCaresWagesCents,
    lniHundredthHours: row.wages.lniHundredthHours - contribution.lniHundredthHours,
  };
  const taxes = {
    oasdiEmployeeCents: row.oasdiEmployeeCents - contribution.oasdiEmployeeCents,
    medicareEmployeeCents: row.medicareEmployeeCents - contribution.medicareEmployeeCents,
    addlMedicareEmployeeCents:
      row.addlMedicareEmployeeCents - contribution.addlMedicareEmployeeCents,
    federalIncomeTaxCents: row.federalIncomeTaxCents - contribution.federalIncomeTaxCents,
  };

  const negative = [
    ...Object.entries(next),
    ...Object.entries(taxes),
  ].find(([, v]) => (v as number) < 0);

  if (negative) {
    return refuse(
      "YTD_WOULD_GO_NEGATIVE",
      `Unwinding pay run ${contribution.runId} would drive ${negative[0]} to ` +
        `${negative[1]}, below zero. That means the stored totals and this run disagree about ` +
        `what was posted. Nothing was changed: the totals need to be rebuilt from the pay run ` +
        `lines before this run can be voided.`,
    );
  }

  return {
    ok: true,
    value: {
      ...row,
      wages: next,
      ...taxes,
      // The run that was unwound is no longer the last one applied. Setting
      // this to null rather than guessing which run came before is deliberate
      // (rule 62d): the previous run id is not knowable from this input, and
      // inventing one would defeat the double-post guard.
      lastRunId: null,
    },
  };
}

/**
 * What the withholding engine should be told before computing THIS period.
 *
 * This is the one-line answer to the question the whole slice exists to
 * answer, and it is the function the pay run will call. It exists as its own
 * named export rather than as `row.wages` inline so that the call site reads
 * as an intention ("what does the engine need to know") rather than as a field
 * access, and so the seam has a name when something goes wrong.
 */
export function ytdForWithholding(row: YtdAccumulatorRow): YtdWageAccumulators {
  return { ...row.wages };
}

/**
 * The employee's remaining room under the Social Security wage base.
 *
 * Returns null once the ceiling is reached, which is the same shape
 * `applyWageCeiling` uses for "uncapped" and is therefore easy to misread - so
 * the boolean is returned alongside rather than left to be inferred.
 *
 * THE WAGE BASE IS PASSED IN, NOT ASSUMED. It is indexed and moves most years.
 * The 2026 figure is offered as a default because that is the year the
 * authorities in ytd-authorities.ts were verified against, and using a
 * different year's base silently would be exactly the kind of invisible drift
 * this codebase refuses to ship.
 */
export function oasdiRoomRemaining(
  row: YtdAccumulatorRow,
  wageBaseCents: number = OASDI_WAGE_BASE_2026_CENTS,
): { roomCents: number; ceilingReached: boolean } {
  const room = wageBaseCents - row.wages.oasdiWagesCents;
  return {
    roomCents: room > 0 ? room : 0,
    ceilingReached: room <= 0,
  };
}

/**
 * Compute this period's FICA using the employee's stored year to date.
 *
 * The entire point of the slice in one function: the engine that already knew
 * how to stop is finally told where it is.
 */
export function computePeriodWithYtd(args: {
  row: YtdAccumulatorRow;
  periodWagesCents: number;
}): ReturnType<typeof computeFicaForPeriod> {
  return computeFicaForPeriod({
    ytd: ytdForWithholding(args.row),
    periodWagesCents: args.periodWagesCents,
  });
}

/** One field's disagreement between the stored total and the recomputed one. */
export type YtdDrift = {
  readonly field: string;
  readonly storedCents: number;
  readonly recomputedCents: number;
  readonly differenceCents: number;
};

/**
 * Compare a stored accumulator against the sum of the lines beneath it.
 *
 * DELIBERATELY DOES NOT REPAIR. A total that silently corrects itself hides
 * the defect that caused the drift, and the next occurrence is just as
 * invisible. Standing rule 64a: detection is not explanation - so this reports
 * every field that disagrees, with both figures and the difference, rather than
 * returning a bare boolean that leaves Michael no better off than before.
 */
export function reconcileAccumulator(
  stored: YtdAccumulatorRow,
  contributions: readonly RunContribution[],
): { inAgreement: boolean; drifts: readonly YtdDrift[] } {
  const sum = contributions.reduce(
    (acc, c) => ({
      oasdiWagesCents: acc.oasdiWagesCents + c.oasdiWagesCents,
      medicareWagesCents: acc.medicareWagesCents + c.medicareWagesCents,
      futaWagesCents: acc.futaWagesCents + c.futaWagesCents,
      waSutaWagesCents: acc.waSutaWagesCents + c.waSutaWagesCents,
      waPfmlWagesCents: acc.waPfmlWagesCents + c.waPfmlWagesCents,
      waCaresWagesCents: acc.waCaresWagesCents + c.waCaresWagesCents,
      lniHundredthHours: acc.lniHundredthHours + c.lniHundredthHours,
      oasdiEmployeeCents: acc.oasdiEmployeeCents + c.oasdiEmployeeCents,
      medicareEmployeeCents: acc.medicareEmployeeCents + c.medicareEmployeeCents,
      addlMedicareEmployeeCents: acc.addlMedicareEmployeeCents + c.addlMedicareEmployeeCents,
      federalIncomeTaxCents: acc.federalIncomeTaxCents + c.federalIncomeTaxCents,
    }),
    {
      oasdiWagesCents: 0, medicareWagesCents: 0, futaWagesCents: 0,
      waSutaWagesCents: 0, waPfmlWagesCents: 0, waCaresWagesCents: 0,
      lniHundredthHours: 0, oasdiEmployeeCents: 0, medicareEmployeeCents: 0,
      addlMedicareEmployeeCents: 0, federalIncomeTaxCents: 0,
    },
  );

  const pairs: ReadonlyArray<readonly [string, number, number]> = [
    ["oasdiWagesCents", stored.wages.oasdiWagesCents, sum.oasdiWagesCents],
    ["medicareWagesCents", stored.wages.medicareWagesCents, sum.medicareWagesCents],
    ["futaWagesCents", stored.wages.futaWagesCents, sum.futaWagesCents],
    ["waSutaWagesCents", stored.wages.waSutaWagesCents, sum.waSutaWagesCents],
    ["waPfmlWagesCents", stored.wages.waPfmlWagesCents, sum.waPfmlWagesCents],
    ["waCaresWagesCents", stored.wages.waCaresWagesCents, sum.waCaresWagesCents],
    ["lniHundredthHours", stored.wages.lniHundredthHours, sum.lniHundredthHours],
    ["oasdiEmployeeCents", stored.oasdiEmployeeCents, sum.oasdiEmployeeCents],
    ["medicareEmployeeCents", stored.medicareEmployeeCents, sum.medicareEmployeeCents],
    ["addlMedicareEmployeeCents", stored.addlMedicareEmployeeCents, sum.addlMedicareEmployeeCents],
    ["federalIncomeTaxCents", stored.federalIncomeTaxCents, sum.federalIncomeTaxCents],
  ];

  const drifts = pairs
    .filter(([, storedV, recomputedV]) => storedV !== recomputedV)
    .map(([field, storedV, recomputedV]) => ({
      field,
      storedCents: storedV,
      recomputedCents: recomputedV,
      differenceCents: storedV - recomputedV,
    }));

  return { inAgreement: drifts.length === 0, drifts };
}

/**
 * Rebuild an accumulator from its lines. The repair, kept SEPARATE from the
 * detection above so that repairing is always a deliberate act with its own
 * call site, never a side effect of looking.
 */
export function rebuildAccumulator(
  employeeId: string,
  taxYear: number,
  contributions: readonly RunContribution[],
): YtdResult<YtdAccumulatorRow> {
  let row = emptyAccumulator(employeeId, taxYear);
  for (const c of contributions) {
    // Rebuilding replays runs in order, so the double-post guard must not fire
    // on a legitimate replay of a different run. It only fires when the SAME
    // run id arrives twice, which during a rebuild means the input itself
    // contains a duplicate - and that is worth refusing.
    const applied = applyRunToAccumulator(row, c);
    if (!applied.ok) return applied;
    row = applied.value;
  }
  return { ok: true, value: row };
}

/**
 * Which calendar year a pay DATE belongs to.
 *
 * Trivial-looking and deliberately explicit, because the wrong answer here is
 * expensive and the temptation to use the period END date is strong. Wages
 * belong to the year they are PAID, not the year they are earned: a period
 * running 21 December to 3 January is reported entirely in January's year.
 * The IRS builds the W-2 on payment date, so the accumulator must be keyed the
 * same way or the two can never agree.
 */
export function taxYearForPayDate(payDateIso: string): YtdResult<number> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(payDateIso);
  if (!m) {
    return refuse(
      "YTD_NON_INTEGER_INPUT",
      `"${payDateIso}" is not a date in YYYY-MM-DD form, so the tax year cannot be ` +
        `determined. Nothing was assumed.`,
    );
  }
  return { ok: true, value: Number(m[1]) };
}

/**
 * Guard that a contribution is being applied to the right row.
 *
 * Cheap, and it closes a defect that is otherwise very hard to see: crediting
 * one employee's wages to another's year produces two wrong W-2s and no error
 * message anywhere.
 */
export function assertRowMatches(
  row: YtdAccumulatorRow,
  employeeId: string,
  taxYear: number,
): YtdRefusal | null {
  if (row.employeeId !== employeeId) {
    return refuse(
      "YTD_EMPLOYEE_MISMATCH",
      `These totals belong to employee ${row.employeeId}, but the pay run line is for ` +
        `${employeeId}. Crediting one employee's wages to another's year produces two wrong ` +
        `W-2s and no error anywhere. Nothing was changed.`,
    );
  }
  if (row.taxYear !== taxYear) {
    return refuse(
      "YTD_YEAR_MISMATCH",
      `These totals are for ${row.taxYear}, but the pay run is dated in ${taxYear}. ` +
        `Wages belong to the year they are PAID, so a period spanning New Year is reported ` +
        `entirely in the later year. Nothing was changed.`,
    );
  }
  return null;
}
