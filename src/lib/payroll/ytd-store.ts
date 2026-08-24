/**
 * src/lib/payroll/ytd-store.ts   (books-37)
 *
 * Server-side persistence for the year-to-date wage accumulators.
 *
 * MICHAEL'S DECISION THAT THIS FILE IMPLEMENTS, VERBATIM (standing rule 1):
 *
 *   "The 16 inactive employees are no longer working for me. I will keep their
 *    data in my sage backups, I only need the active employees I currently
 *    have."
 *
 * That is why every read in this file filters `active = true`, and why NOTHING
 * in this file deletes anything. The departed employees' rows stay exactly
 * where they are. They are simply not shown, not totalled, and never written
 * to. Michael's Sage backups remain the record for them, which is what he
 * asked for.
 *
 * A CAUTION THAT IS NOT A DISAGREEMENT. Filtering the SCREEN by active is
 * right. Filtering a FILED TAX FORM by active would not be: a W-2 is owed to
 * everyone paid during the year, including people who left in March, and the
 * 941 totals for Q1 include their wages forever. This file is the screen layer,
 * so `active = true` is correct here. When the W-2/941 slice arrives it must
 * read by TAX YEAR and not by active, and `loadYtdBoard` deliberately reports
 * `inactiveRowsNotShown` so that the number of people being left out is visible
 * rather than silently zero (standing rule 64a: detection is not explanation).
 *
 * THE DIVISION OF LABOUR, AND WHY IT IS STRICT (standing rule 25)
 *
 * `ytd-core.ts` decides what the numbers mean. This file decides nothing. It
 * reads rows, maps them into the engine's types, hands them over, and writes
 * back only what the engine returned. `applyRunToAccumulator`,
 * `unapplyRunFromAccumulator`, `reconcileAccumulator` and `rebuildAccumulator`
 * are NOT re-implemented here - a second copy of the double-post guard would
 * eventually disagree with the first, silently, on somebody's W-2.
 *
 * THE DOUBLE-POST GUARD IS ONLY REAL IF THE WRITE IS CONDITIONAL
 *
 * `applyRunToAccumulator` refuses a run id it has already seen. That guard is
 * worth nothing if this file reads the row, computes, and then writes
 * unconditionally: two concurrent requests both read `last_run_id = null`, both
 * pass the guard, and both write. The year doubles and nothing looks wrong.
 * So `applyRunToYtd` writes with a `.eq("last_run_id", ...)` precondition that
 * names the value it read, and treats "zero rows updated" as a LOST RACE rather
 * than as success. See the long comment on that function.
 *
 * THE SERVICE ROLE BYPASSES EVERY DATABASE GATE
 *
 * These functions use createSupabaseAdminClient(), which runs as the service
 * role and ignores the owner-only RLS that migration 0199 puts on
 * `payroll_ytd_accumulators`. So the SQL gate does NOT protect anything reached
 * through this file. Every caller must pass through `requireBooksAccess()`
 * first, which is `is_owner()` in application form. Stated here rather than
 * assumed, because the migration's RLS is genuinely inert on this path.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { requiredBigint } from "@/lib/supabase/pg-bigint";

import {
  applyRunToAccumulator,
  assertRowMatches,
  emptyAccumulator,
  oasdiRoomRemaining,
  reconcileAccumulator,
  unapplyRunFromAccumulator,
  type RunContribution,
  type YtdAccumulatorRow,
  type YtdDrift,
  type YtdRefusal,
} from "./ytd-core";

const NOT_CONFIGURED =
  "Supabase is not configured in this environment, so nothing could be read. This is a deployment " +
  "problem, not a data problem - no payroll totals have been lost.";

export type YtdStoreFailure = {
  readonly ok: false;
  readonly code: "NOT_CONFIGURED" | "READ_FAILED" | "WRITE_FAILED" | "REFUSED" | "LOST_RACE";
  readonly message: string;
  /** Engine refusals, when the failure was a considered "no" rather than a fault. */
  readonly refusals?: readonly YtdRefusal[];
};

export type YtdStoreOk<T> = { readonly ok: true; readonly value: T };
export type YtdStoreResult<T> = YtdStoreOk<T> | YtdStoreFailure;

/* ══════════════════════════════════════════════════════════════════════════
 * ROW SHAPES
 * ══════════════════════════════════════════════════════════════════════════ */

type AccumulatorRowRaw = {
  employee_id: string;
  tax_year: number;
  oasdi_wages_cents: number | string | null;
  medicare_wages_cents: number | string | null;
  futa_wages_cents: number | string | null;
  wa_suta_wages_cents: number | string | null;
  wa_pfml_wages_cents: number | string | null;
  wa_cares_wages_cents: number | string | null;
  lni_hundredth_hours: number | string | null;
  oasdi_employee_cents: number | string | null;
  medicare_employee_cents: number | string | null;
  addl_medicare_employee_cents: number | string | null;
  federal_income_tax_cents: number | string | null;
  last_run_id: string | null;
  last_recomputed_at: string | null;
};

type EmployeeRow = {
  id: string;
  full_name: string | null;
  active: boolean | null;
};

/**
 * Read a `not null` bigint cent column from `payroll_ytd_accumulators`.
 *
 * The conversion itself now lives in `@/lib/supabase/pg-bigint`. This wrapper
 * survives only to keep the 24 call sites below reading as they did, and to
 * pin the table name once instead of at each one.
 *
 * WHY IT MOVED. The body used to be here, and it had two defects that its own
 * comment ruled out. It guarded with `Number.isFinite(n) && Number.isInteger(n)`
 * and then explained at length that reading an unreadable wage column as zero
 * is the most dangerous possible wrong answer because zero wages looks exactly
 * like an employee who has not been paid yet. But `Number("")` is 0, so an
 * empty string produced exactly that zero and the refusal never fired. It also
 * said, correctly, that a bigint does not fit safely in a JavaScript number -
 * and then checked `isInteger`, which accepts `"9007199254740993"` as
 * 9007199254740992 without complaint. Three sibling stores had copied the same
 * guard and therefore the same two defects. The shared module validates the
 * text before converting and checks `isSafeInteger` after; being pure, it is
 * also tested directly, which none of the four copies were.
 */
function requiredBigintCents(v: number | string | null, column: string, employeeId: string): number {
  return requiredBigint(v, {
    table: "payroll_ytd_accumulators",
    column,
    context: `employee ${employeeId}`,
  });
}

/**
 * A stored row, mapped into the engine's type.
 *
 * Deliberately explicit field by field rather than a clever loop. This mapping
 * is the seam standing rule 63d warns about: a database row and an engine input
 * look similar enough that one transposed column name produces a plausible
 * number instead of an error. Spelling out all eleven makes a transposition
 * visible to a reader, and the compiler catches a missing one.
 */
function toAccumulator(row: AccumulatorRowRaw): YtdAccumulatorRow {
  const id = row.employee_id;
  return {
    employeeId: id,
    taxYear: row.tax_year,
    wages: {
      oasdiWagesCents: requiredBigintCents(row.oasdi_wages_cents, "oasdi_wages_cents", id),
      medicareWagesCents: requiredBigintCents(row.medicare_wages_cents, "medicare_wages_cents", id),
      futaWagesCents: requiredBigintCents(row.futa_wages_cents, "futa_wages_cents", id),
      waSutaWagesCents: requiredBigintCents(row.wa_suta_wages_cents, "wa_suta_wages_cents", id),
      waPfmlWagesCents: requiredBigintCents(row.wa_pfml_wages_cents, "wa_pfml_wages_cents", id),
      waCaresWagesCents: requiredBigintCents(row.wa_cares_wages_cents, "wa_cares_wages_cents", id),
      lniHundredthHours: requiredBigintCents(row.lni_hundredth_hours, "lni_hundredth_hours", id),
    },
    oasdiEmployeeCents: requiredBigintCents(row.oasdi_employee_cents, "oasdi_employee_cents", id),
    medicareEmployeeCents: requiredBigintCents(
      row.medicare_employee_cents,
      "medicare_employee_cents",
      id,
    ),
    addlMedicareEmployeeCents: requiredBigintCents(
      row.addl_medicare_employee_cents,
      "addl_medicare_employee_cents",
      id,
    ),
    federalIncomeTaxCents: requiredBigintCents(
      row.federal_income_tax_cents,
      "federal_income_tax_cents",
      id,
    ),
    lastRunId: row.last_run_id,
  };
}

/** The inverse mapping, for writes. Same field-by-field discipline. */
function toColumns(row: YtdAccumulatorRow): Record<string, unknown> {
  return {
    employee_id: row.employeeId,
    tax_year: row.taxYear,
    oasdi_wages_cents: row.wages.oasdiWagesCents,
    medicare_wages_cents: row.wages.medicareWagesCents,
    futa_wages_cents: row.wages.futaWagesCents,
    wa_suta_wages_cents: row.wages.waSutaWagesCents,
    wa_pfml_wages_cents: row.wages.waPfmlWagesCents,
    wa_cares_wages_cents: row.wages.waCaresWagesCents,
    lni_hundredth_hours: row.wages.lniHundredthHours,
    oasdi_employee_cents: row.oasdiEmployeeCents,
    medicare_employee_cents: row.medicareEmployeeCents,
    addl_medicare_employee_cents: row.addlMedicareEmployeeCents,
    federal_income_tax_cents: row.federalIncomeTaxCents,
    last_run_id: row.lastRunId,
    last_recomputed_at: new Date().toISOString(),
  };
}

/**
 * The column list, as one unbroken string literal.
 *
 * WHY IT IS NOT BUILT BY CONCATENATION. The Supabase client infers the shape of
 * `data` from the LITERAL text of the select. Hand it a variable built with
 * `+`, and the inference degrades to `GenericStringError` - at which point
 * every row cast below silently becomes a cast from an error type, and the
 * compiler stops checking the mapping entirely. tsc caught exactly that here
 * (TS2352, "neither type sufficiently overlaps"), which is the type system
 * doing its job on the seam standing rule 63d says is the dangerous one.
 *
 * `as const` keeps it a literal type. Both call sites use this same constant,
 * so the two reads cannot drift apart.
 */
const ACCUMULATOR_COLUMNS =
  "employee_id, tax_year, oasdi_wages_cents, medicare_wages_cents, futa_wages_cents, wa_suta_wages_cents, wa_pfml_wages_cents, wa_cares_wages_cents, lni_hundredth_hours, oasdi_employee_cents, medicare_employee_cents, addl_medicare_employee_cents, federal_income_tax_cents, last_run_id, last_recomputed_at" as const;

const RUN_LINE_TAX_COLUMNS =
  "run_id, oasdi_wages_cents, medicare_wages_cents, futa_wages_cents, wa_suta_wages_cents, wa_pfml_wages_cents, wa_cares_wages_cents, lni_hundredth_hours, oasdi_employee_cents, medicare_employee_cents, addl_medicare_employee_cents, federal_income_tax_cents" as const;

/* ══════════════════════════════════════════════════════════════════════════
 * READING ONE EMPLOYEE'S YEAR
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The employee's totals for a year, or a fresh zeroed accumulator.
 *
 * "NO ROW" IS NOT AN ERROR, AND IT IS NOT A GUESS. An employee who has not been
 * paid yet this calendar year genuinely has zero year-to-date wages. That is a
 * fact about the world, not a default invented to fill a hole, so returning
 * `emptyAccumulator` here does not violate standing rule 62d. The distinction
 * matters: this returns zeros for "nobody has been paid yet", and REFUSES for
 * "a column that cannot be null is null".
 *
 * This is the function the pay run calls to answer the question the whole YTD
 * layer exists for - has this employee already crossed the Social Security wage
 * base? Today that question is answered `ZERO_YTD` at the only call site in the
 * repo, which means the ceiling can never engage.
 */
export async function loadYtdForEmployee(
  employeeId: string,
  taxYear: number,
): Promise<YtdStoreResult<YtdAccumulatorRow>> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("payroll_ytd_accumulators")
    .select(ACCUMULATOR_COLUMNS)
    .eq("employee_id", employeeId)
    .eq("tax_year", taxYear)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `Could not read the ${taxYear} year-to-date totals for this employee: ${error.message}. ` +
        `No paycheque should be calculated until this reads cleanly, because the Social Security ` +
        `wage base cannot be applied without it.`,
    };
  }

  if (!data) {
    return { ok: true, value: emptyAccumulator(employeeId, taxYear) };
  }

  try {
    return { ok: true, value: toAccumulator(data as AccumulatorRowRaw) };
  } catch (e) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * WRITING - the double-post guard, made real
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Add one pay run's figures to one employee's year, idempotently.
 *
 * WHY THIS IS NOT JUST "READ, COMPUTE, WRITE".
 *
 * `applyRunToAccumulator` in the pure engine refuses a run id it has already
 * seen. That is the guard that stops a retried request or a double-clicked
 * button from doubling somebody's year. But a pure function can only refuse
 * what it is shown, and it is shown a row that was read a moment ago. Two
 * requests arriving together both read `last_run_id = null`, both ask the
 * engine, both are told "fine", and both write. The engine did its job
 * perfectly and the year still doubled.
 *
 * So the write below is CONDITIONAL on the value that was read:
 *
 *     .eq("last_run_id", previous)      (or .is("last_run_id", null))
 *
 * If another request got there first, `last_run_id` no longer equals what we
 * read, zero rows update, and we return LOST_RACE instead of pretending to have
 * succeeded. The loser is told to re-read and try again - and on the re-read
 * the engine's own guard fires, because now the run id IS visible. The two
 * guards cover each other: the engine catches the sequential retry, the
 * precondition catches the concurrent one.
 *
 * WHY NOT UPSERT. An upsert would resolve the conflict by overwriting, which is
 * exactly the outcome we are trying to prevent. Losing the race must be loud.
 *
 * THE INSERT PATH HAS THE SAME PROTECTION FOR FREE. Migration 0199 declares
 * `payroll_ytd_one_row_per_employee_year unique (employee_id, tax_year)`, so
 * two concurrent inserts cannot both land; the loser gets a unique-violation,
 * which is reported as LOST_RACE for the same reason and with the same advice.
 */
export async function applyRunToYtd(args: {
  readonly employeeId: string;
  readonly taxYear: number;
  readonly contribution: RunContribution;
}): Promise<YtdStoreResult<YtdAccumulatorRow>> {
  const { employeeId, taxYear, contribution } = args;

  const current = await loadYtdForEmployee(employeeId, taxYear);
  if (!current.ok) return current;

  const mismatch = assertRowMatches(current.value, employeeId, taxYear);
  if (mismatch) {
    return { ok: false, code: "REFUSED", message: mismatch.message, refusals: [mismatch] };
  }

  const applied = applyRunToAccumulator(current.value, contribution);
  if (!applied.ok) {
    return { ok: false, code: "REFUSED", message: applied.message, refusals: [applied] };
  }

  const supabase = createSupabaseAdminClient();
  const previousRunId = current.value.lastRunId;
  const isFirstRunOfYear = previousRunId === null;

  // An accumulator that has never been written has no row at all: `lastRunId`
  // null AND nothing on disk. Distinguish the two by asking, because inserting
  // over an existing zero row would violate the unique constraint and reporting
  // that as a lost race would be misleading.
  const { data: existing, error: existsError } = await supabase
    .from("payroll_ytd_accumulators")
    .select("employee_id")
    .eq("employee_id", employeeId)
    .eq("tax_year", taxYear)
    .maybeSingle();

  if (existsError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not confirm whether ${taxYear} totals already exist for this employee: ${existsError.message}. Nothing was written.`,
    };
  }

  if (!existing) {
    const { error: insertError } = await supabase
      .from("payroll_ytd_accumulators")
      .insert(toColumns(applied.value));
    if (insertError) {
      return {
        ok: false,
        code: "LOST_RACE",
        message:
          `Could not create the ${taxYear} totals for this employee: ${insertError.message}. ` +
          `If this says a duplicate key, another pay run created the row at the same moment - ` +
          `nothing was doubled, and the fix is to run this again, which will add to the row that ` +
          `now exists.`,
      };
    }
    return { ok: true, value: applied.value };
  }

  const update = supabase
    .from("payroll_ytd_accumulators")
    .update(toColumns(applied.value))
    .eq("employee_id", employeeId)
    .eq("tax_year", taxYear);

  const { data: updated, error: updateError } = await (
    isFirstRunOfYear ? update.is("last_run_id", null) : update.eq("last_run_id", previousRunId)
  ).select("employee_id");

  if (updateError) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message: `Could not save the ${taxYear} totals for this employee: ${updateError.message}. Nothing was changed.`,
    };
  }

  if (!updated || updated.length === 0) {
    return {
      ok: false,
      code: "LOST_RACE",
      message:
        `These totals changed while this pay run was being calculated, so nothing was written. ` +
        `That is the protection working, not a fault: another posting reached this employee's ` +
        `${taxYear} totals first, and writing anyway would have added the same run twice. ` +
        `Re-open the pay run and post it again - if it really was already posted, you will be ` +
        `told so plainly rather than having the year quietly doubled.`,
    };
  }

  return { ok: true, value: applied.value };
}

/**
 * Remove one pay run's figures from an employee's year, for a void.
 *
 * Same conditional-write discipline, with the precondition inverted: unwinding
 * is only valid against the row that says this run was the last one applied. If
 * `last_run_id` is not this run, either the run was never applied or a later
 * run has been applied on top of it, and in both cases silently subtracting
 * would produce a total that matches no set of paycheques.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not restore the PREVIOUS
 * `last_run_id`, because the accumulator does not store a history and inventing
 * one here would be a guess (standing rule 62d). It sets it to null, which is
 * honest: "no run is currently the most recent contributor to this row". The
 * consequence is that the run just unwound could be applied again, which is the
 * correct behaviour for a void-then-repost.
 */
export async function unapplyRunFromYtd(args: {
  readonly employeeId: string;
  readonly taxYear: number;
  readonly contribution: RunContribution;
}): Promise<YtdStoreResult<YtdAccumulatorRow>> {
  const { employeeId, taxYear, contribution } = args;

  const current = await loadYtdForEmployee(employeeId, taxYear);
  if (!current.ok) return current;

  if (current.value.lastRunId !== contribution.runId) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        `This employee's ${taxYear} totals do not show pay run ${contribution.runId} as the most ` +
        `recent posting` +
        (current.value.lastRunId === null
          ? `, they show no posting at all.`
          : `, they show ${current.value.lastRunId}.`) +
        ` Unwinding it anyway would subtract figures that either were never added, or were added ` +
        `before a later run that is still posted - and the result would be a year-to-date total ` +
        `that matches no set of paycheques. Nothing was changed. Void the later run first, or ` +
        `rebuild this employee's year from the run lines.`,
    };
  }

  const unapplied = unapplyRunFromAccumulator(current.value, contribution);
  if (!unapplied.ok) {
    return { ok: false, code: "REFUSED", message: unapplied.message, refusals: [unapplied] };
  }

  const cleared: YtdAccumulatorRow = { ...unapplied.value, lastRunId: null };

  const supabase = createSupabaseAdminClient();
  const { data: updated, error } = await supabase
    .from("payroll_ytd_accumulators")
    .update(toColumns(cleared))
    .eq("employee_id", employeeId)
    .eq("tax_year", taxYear)
    .eq("last_run_id", contribution.runId)
    .select("employee_id");

  if (error) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message: `Could not unwind pay run ${contribution.runId} from the ${taxYear} totals: ${error.message}. Nothing was changed.`,
    };
  }
  if (!updated || updated.length === 0) {
    return {
      ok: false,
      code: "LOST_RACE",
      message:
        `These totals changed while the void was being processed, so nothing was written. ` +
        `Re-open the void and try again - the totals will be re-read first.`,
    };
  }

  return { ok: true, value: cleared };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE BOARD - what the screen shows
 * ══════════════════════════════════════════════════════════════════════════ */

/** One active employee's year, with the two figures Michael actually asks about. */
export type YtdBoardLine = {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly row: YtdAccumulatorRow;
  /** Remaining room under the Social Security wage base, in cents. */
  readonly oasdiRoomCents: number;
  readonly oasdiCeilingReached: boolean;
  /**
   * True when this employee has no stored row for the year at all, as opposed
   * to a stored row that happens to be zero. The screen says so, because the
   * two look identical on a page of numbers and mean very different things.
   */
  readonly neverPaidThisYear: boolean;
};

export type YtdBoard = {
  readonly taxYear: number;
  readonly lines: readonly YtdBoardLine[];
  /**
   * How many stored rows for this year belong to employees who are NOT active.
   *
   * Michael asked to see only current staff, and that is what `lines` contains.
   * But "the screen shows 8 people and the 941 shows 11" is a frightening thing
   * to discover in April, so the number that was left out is reported rather
   * than hidden. Zero is the normal answer at Greenway now that the sixteen
   * departed employees pre-date the 1 January 2027 cutover and have no 2027
   * wages at all.
   */
  readonly inactiveRowsNotShown: number;
  /**
   * Populated only when the wage-base year and the requested year differ. The
   * OASDI figures on this board are computed against the 2026 base, which is
   * the year the mirrored authorities were verified against. Reporting a 2027
   * board against a 2026 base without saying so is exactly the silent drift
   * this codebase refuses to ship.
   */
  readonly wageBaseCaveat: string | null;
};

/**
 * The whole board, for the screen.
 *
 * ACTIVE EMPLOYEES ONLY - Michael's instruction, quoted at the top of this
 * file. One batched read for the accumulators rather than one per employee,
 * because N+1 reads on a payroll screen are how a page becomes unusable at
 * exactly the moment it matters (the day before a filing deadline).
 */
export async function loadYtdBoard(
  taxYear: number,
  wageBaseYear = 2026,
): Promise<YtdStoreResult<YtdBoard>> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }
  const supabase = createSupabaseAdminClient();

  const { data: employees, error: employeeError } = await supabase
    .from("employees")
    .select("id, full_name, active")
    .eq("active", true)
    .order("full_name", { ascending: true });

  if (employeeError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the employee list: ${employeeError.message}. The year-to-date board cannot be shown without it.`,
    };
  }

  const staff = (employees ?? []) as EmployeeRow[];

  // Read every accumulator row for the year - including inactive employees'
  // rows, which are counted and then excluded. Counting them requires reading
  // them; that is the whole reason this is not filtered in SQL.
  const { data: rowsRaw, error: rowsError } = await supabase
    .from("payroll_ytd_accumulators")
    .select(ACCUMULATOR_COLUMNS)
    .eq("tax_year", taxYear);

  if (rowsError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `Could not read the ${taxYear} year-to-date totals: ${rowsError.message}. ` +
        `This is a read failure, not an empty year - do not read the blank screen as "nobody has been paid".`,
    };
  }

  const activeIds = new Set(staff.map((e) => e.id));
  const byEmployee = new Map<string, YtdAccumulatorRow>();
  let inactiveRowsNotShown = 0;

  try {
    for (const raw of (rowsRaw ?? []) as AccumulatorRowRaw[]) {
      if (!activeIds.has(raw.employee_id)) {
        inactiveRowsNotShown += 1;
        continue;
      }
      byEmployee.set(raw.employee_id, toAccumulator(raw));
    }
  } catch (e) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const lines: YtdBoardLine[] = staff.map((e) => {
    const stored = byEmployee.get(e.id);
    const row = stored ?? emptyAccumulator(e.id, taxYear);
    const room = oasdiRoomRemaining(row);
    return {
      employeeId: e.id,
      // A missing name is reported as missing, not blanked or guessed at.
      employeeName: e.full_name ?? `(employee ${e.id} has no name on file)`,
      row,
      oasdiRoomCents: room.roomCents,
      oasdiCeilingReached: room.ceilingReached,
      neverPaidThisYear: stored === undefined,
    };
  });

  return {
    ok: true,
    value: {
      taxYear,
      lines,
      inactiveRowsNotShown,
      wageBaseCaveat:
        taxYear === wageBaseYear
          ? null
          : `The Social Security wage base used on this page is the ${wageBaseYear} figure, but you are ` +
            `looking at ${taxYear}. The base is indexed and moves most years, so the "room remaining" ` +
            `column is indicative only until the ${taxYear} figure is loaded from the Social Security ` +
            `Administration's announcement. Every other number on this page is exact.`,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * RECONCILIATION - the totals versus the lines beneath them
 * ══════════════════════════════════════════════════════════════════════════ */

export type YtdReconciliation = {
  readonly employeeId: string;
  readonly taxYear: number;
  readonly inAgreement: boolean;
  readonly drifts: readonly YtdDrift[];
  /** How many posted run lines the stored total was compared against. */
  readonly linesCompared: number;
};

/**
 * Compare an employee's stored totals against the pay run lines beneath them.
 *
 * DELIBERATELY DOES NOT REPAIR. `reconcileAccumulator` reports; it does not
 * overwrite, and neither does this. A total that silently corrects itself hides
 * the defect that caused the drift, and the next occurrence is just as
 * invisible. Michael gets both figures and the difference, and decides.
 *
 * A VACUOUS AGREEMENT IS REPORTED AS ONE (standing rule 39). If there are no
 * posted run lines, every field trivially agrees with a sum of nothing, and
 * "in agreement" would be a green tick that means nothing. `linesCompared` is
 * returned so the screen can say "compared against 0 lines" instead of
 * "reconciled".
 */
export async function reconcileEmployeeYtd(
  employeeId: string,
  taxYear: number,
): Promise<YtdStoreResult<YtdReconciliation>> {
  const stored = await loadYtdForEmployee(employeeId, taxYear);
  if (!stored.ok) return stored;

  const supabase = createSupabaseAdminClient();

  // The per-tax columns migration 0199 added to payroll_run_lines are all
  // NULLABLE with no default, deliberately (standing rule 62d): a line written
  // before that migration genuinely does not know its own split. Those lines
  // cannot be reconciled against, and pretending they contribute zero would
  // manufacture a drift that is really a gap in history. So they are counted
  // and excluded, and the count is returned.
  const { data: lines, error } = await supabase
    .from("payroll_run_lines")
    .select(RUN_LINE_TAX_COLUMNS)
    .eq("employee_id", employeeId)
    .not("oasdi_wages_cents", "is", null);

  if (error) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read this employee's pay run lines to reconcile against: ${error.message}.`,
    };
  }

  const contributions: RunContribution[] = [];
  try {
    for (const l of (lines ?? []) as Record<string, number | string | null>[]) {
      contributions.push({
        runId: String(l.run_id),
        oasdiWagesCents: requiredBigintCents(l.oasdi_wages_cents, "oasdi_wages_cents", employeeId),
        medicareWagesCents: requiredBigintCents(
          l.medicare_wages_cents,
          "medicare_wages_cents",
          employeeId,
        ),
        futaWagesCents: requiredBigintCents(l.futa_wages_cents, "futa_wages_cents", employeeId),
        waSutaWagesCents: requiredBigintCents(
          l.wa_suta_wages_cents,
          "wa_suta_wages_cents",
          employeeId,
        ),
        waPfmlWagesCents: requiredBigintCents(
          l.wa_pfml_wages_cents,
          "wa_pfml_wages_cents",
          employeeId,
        ),
        waCaresWagesCents: requiredBigintCents(
          l.wa_cares_wages_cents,
          "wa_cares_wages_cents",
          employeeId,
        ),
        lniHundredthHours: requiredBigintCents(
          l.lni_hundredth_hours,
          "lni_hundredth_hours",
          employeeId,
        ),
        oasdiEmployeeCents: requiredBigintCents(
          l.oasdi_employee_cents,
          "oasdi_employee_cents",
          employeeId,
        ),
        medicareEmployeeCents: requiredBigintCents(
          l.medicare_employee_cents,
          "medicare_employee_cents",
          employeeId,
        ),
        addlMedicareEmployeeCents: requiredBigintCents(
          l.addl_medicare_employee_cents,
          "addl_medicare_employee_cents",
          employeeId,
        ),
        federalIncomeTaxCents: requiredBigintCents(
          l.federal_income_tax_cents,
          "federal_income_tax_cents",
          employeeId,
        ),
      });
    }
  } catch (e) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const result = reconcileAccumulator(stored.value, contributions);

  return {
    ok: true,
    value: {
      employeeId,
      taxYear,
      inAgreement: result.inAgreement,
      drifts: result.drifts,
      linesCompared: contributions.length,
    },
  };
}
