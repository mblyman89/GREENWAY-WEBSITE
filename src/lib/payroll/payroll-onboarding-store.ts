/**
 * src/lib/payroll/payroll-onboarding-store.ts  (books-25)
 *
 * Server-side persistence for employee payroll setup: the W-4, the I-9, the pay
 * agreement, and the full SSN.
 *
 * THE DIVISION OF LABOUR, AND WHY IT IS STRICT
 *
 * payroll-onboarding-core.ts decides what is valid. This file decides nothing.
 * It reads, it writes, and before it writes it asks the core whether it may. If
 * the core says no, this file REFUSES with a named code and writes nothing at
 * all - not a partial row, not a draft, nothing.
 *
 * That refusal is the feature Michael asked for:
 *
 *   "It should have a check list of task to be completed before it lets you
 *    save them to the system, and if a field is missing, it should highlight it
 *    so something can't silently fail me in some way."
 *   "Sage has no safety nets."
 *
 * A warning is not a safety net, because a warning is something you click past
 * at 6pm on a Friday. So there is no "save anyway" parameter in this file. If
 * you find yourself wanting one, the checklist is wrong, not the gate.
 *
 * THE SERVICE ROLE BYPASSES EVERY DATABASE GATE
 *
 * These functions use createSupabaseAdminClient(), which runs as the service
 * role. The service role ignores RLS and ignores column privileges. So the
 * owner-only gate on employee_w4, and the column revoke on employees.ssn_full,
 * do NOT protect anything reached through this file. The gate here is code, and
 * it has to be as good as the one in SQL - which is why revealing an SSN
 * requires an explicit role argument and writes the audit row FIRST.
 *
 * Money is INTEGER CENTS. Hourly rates are MILLI-CENTS (thousandths of a cent),
 * because $0.16445/hour is a real rate and cents cannot hold it.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  evaluateOnboarding,
  canRevealSsn,
  normalizeSsn,
  ssnProblems,
  maskSsn,
  type OnboardingCandidate,
  type OnboardingEvaluation,
  type OnboardingRefusalCode,
  i9RetainUntilYmd,
  type I9Record,
  type PayRecord,
} from "@/lib/payroll/payroll-onboarding-core";
// W4Record is declared in payroll-w4-core and REUSED by the onboarding core
// rather than redeclared (standing rule 25), so it is imported from its home.
import type { W4Record } from "@/lib/payroll/payroll-w4-core";

// ---------------------------------------------------------------------------
// Result types
//
// Every write returns a discriminated union rather than throwing. A thrown
// error in a server action becomes a generic "something went wrong" in the
// browser, which is precisely the silent failure this slice exists to prevent.
// The caller gets the refusal CODE and the field paths, so the screen can
// highlight the exact boxes that are wrong.
// ---------------------------------------------------------------------------

export type SaveRefusal = {
  ok: false;
  /** A named code, so the UI can react to the KIND of problem, not a string. */
  refusalCode: OnboardingRefusalCode | "not_configured" | "migration_missing" | "write_failed";
  /** One plain-English sentence, addressed to Michael. */
  message: string;
  /**
   * Dotted paths of the fields that are wrong, for highlighting. Empty only
   * when the problem is not about a field (a missing migration, say).
   */
  fields: readonly string[];
  /** The full evaluation, when we got far enough to have one. */
  evaluation?: OnboardingEvaluation;
};

export type SaveSuccess = {
  ok: true;
  employeeId: string;
  /**
   * How many rows were actually written. Standing rule 51: a write that reports
   * success without counting what it wrote is a write nobody has verified.
   */
  rowsWritten: number;
  evaluation: OnboardingEvaluation;
};

export type SaveResult = SaveSuccess | SaveRefusal;

const NOT_CONFIGURED: SaveRefusal = {
  ok: false,
  refusalCode: "not_configured",
  message:
    "The database connection is not configured on this server, so nothing was saved. " +
    "No partial record was created.",
  fields: [],
};

// ---------------------------------------------------------------------------
// Does the migration exist yet?
//
// Every read in this file degrades gracefully, because the owner applies
// migrations by hand (standing rule 6) and the app must not white-screen in the
// window between deploy and apply. But it degrades LOUDLY on write: refusing to
// save is safe, whereas pretending to save is not.
// ---------------------------------------------------------------------------
export async function payrollSetupMigrationApplied(): Promise<boolean> {
  if (!isSupabaseServiceConfigured) return false;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("employee_pay").select("id").limit(1);
  return !error;
}

// ---------------------------------------------------------------------------
// READS
// ---------------------------------------------------------------------------

export type EmployeeSetupRow = {
  employeeId: string;
  fullName: string;
  /** Last four only. The full value never travels on this type. */
  ssnLastFour: string | null;
  hasW4: boolean;
  hasI9: boolean;
  hasPay: boolean;
};

/**
 * The roster view for the setup screen.
 *
 * Deliberately selects NAMED COLUMNS rather than `*`. The rest of this codebase
 * uses `select("*")` for graceful degradation, and that is defensible - but not
 * on a table that now holds a full SSN. Naming the columns means the SSN cannot
 * arrive here by accident, which is a stronger guarantee than remembering to
 * delete it afterwards.
 */
export async function listEmployeeSetup(): Promise<{
  rows: EmployeeSetupRow[];
  migrationApplied: boolean;
}> {
  if (!isSupabaseServiceConfigured) return { rows: [], migrationApplied: false };
  const admin = createSupabaseAdminClient();

  const { data: emps, error } = await admin
    .from("employees")
    .select("id, full_name, ssn_last_four")
    .order("full_name", { ascending: true });

  if (error) {
    // ssn_last_four does not exist yet => 0195 has not been applied.
    return { rows: [], migrationApplied: false };
  }

  const employees = (emps as { id: string; full_name: string; ssn_last_four: string | null }[]) ?? [];
  if (employees.length === 0) return { rows: [], migrationApplied: true };

  const ids = employees.map((e) => e.id);
  const [w4, i9, pay] = await Promise.all([
    admin.from("employee_w4").select("employee_id").in("employee_id", ids).eq("is_current", true),
    admin.from("employee_i9").select("employee_id").in("employee_id", ids),
    admin.from("employee_pay").select("employee_id").in("employee_id", ids).eq("is_current", true),
  ]);

  const w4Set = new Set(((w4.data as { employee_id: string }[]) ?? []).map((r) => r.employee_id));
  const i9Set = new Set(((i9.data as { employee_id: string }[]) ?? []).map((r) => r.employee_id));
  const paySet = new Set(((pay.data as { employee_id: string }[]) ?? []).map((r) => r.employee_id));

  return {
    migrationApplied: true,
    rows: employees.map((e) => ({
      employeeId: e.id,
      fullName: e.full_name,
      ssnLastFour: e.ssn_last_four ?? null,
      hasW4: w4Set.has(e.id),
      hasI9: i9Set.has(e.id),
      hasPay: paySet.has(e.id),
    })),
  };
}

// ---------------------------------------------------------------------------
// THE SSN REVEAL
//
// Michael asked for a Sage-style reveal toggle. Sage shows the number; it does
// not record that it did. That difference is the whole control.
//
// The ordering below is load-bearing and is the reason this is not a one-liner:
//
//   1) check the role IN CODE (the service role has already bypassed SQL)
//   2) write the audit row
//   3) only if that write succeeded, read and return the number
//
// If step 2 fails, step 3 never happens. An audit log you can skip when the
// insert is inconvenient is not an audit log.
// ---------------------------------------------------------------------------

export type RevealResult =
  | { ok: true; ssn: string; masked: string }
  | { ok: false; reason: "not_permitted" | "no_reason_given" | "audit_write_failed" | "not_found"; message: string };

export async function revealSsn(input: {
  employeeId: string;
  /** The role of the human asking, resolved by the caller from the session. */
  role: string;
  /** The auth user id of the human asking, for the log. */
  actorId?: string | null;
  /** Why they are looking. Required, and not allowed to be noise. */
  reason: string;
}): Promise<RevealResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, reason: "not_found", message: "The database is not configured." };
  }

  // (1) The role check, in code. This is the ONLY gate on this path, because
  // the service role ignores the column privilege that stops everyone else.
  if (!canRevealSsn(input.role)) {
    return {
      ok: false,
      reason: "not_permitted",
      message:
        `The role "${input.role}" cannot view a full Social Security number. ` +
        `Only the owner can, and the attempt was not logged as a reveal because ` +
        `nothing was revealed.`,
    };
  }

  if (input.reason.trim().length < 3) {
    return {
      ok: false,
      reason: "no_reason_given",
      message:
        "A reason is required before a Social Security number is shown. This is not " +
        "bureaucracy: the reason is what makes the log worth reading later.",
    };
  }

  const admin = createSupabaseAdminClient();

  // (2) The audit row goes in FIRST.
  const { error: auditError } = await admin.from("employee_ssn_reveals").insert({
    employee_id: input.employeeId,
    revealed_by: input.actorId ?? null,
    revealed_by_role: input.role,
    reason: input.reason.trim(),
  });

  if (auditError) {
    return {
      ok: false,
      reason: "audit_write_failed",
      message:
        "The disclosure could not be recorded, so the number was not shown. " +
        "This is deliberate: if the log fails, the reveal fails.",
    };
  }

  // (3) Only now do we read the value.
  const { data, error } = await admin
    .from("employees")
    .select("ssn_full")
    .eq("id", input.employeeId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, reason: "not_found", message: "That employee was not found." };
  }

  const raw = (data as { ssn_full: string | null }).ssn_full;
  if (!raw) {
    return {
      ok: false,
      reason: "not_found",
      message: "No Social Security number is on file for this employee yet.",
    };
  }

  return { ok: true, ssn: raw, masked: maskSsn(raw) };
}

/**
 * The reveal history for one employee, so the log is readable rather than
 * merely written. A log nobody can read is the same as no log.
 */
export async function listSsnReveals(employeeId: string): Promise<
  { revealedAt: string; role: string; reason: string }[]
> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("employee_ssn_reveals")
    .select("revealed_at, revealed_by_role, reason")
    .eq("employee_id", employeeId)
    .order("revealed_at", { ascending: false })
    .limit(200);
  if (error || !data) return [];
  return (data as { revealed_at: string; revealed_by_role: string; reason: string }[]).map((r) => ({
    revealedAt: r.revealed_at,
    role: r.revealed_by_role,
    reason: r.reason,
  }));
}

// ---------------------------------------------------------------------------
// THE WRITE — GATED ON THE CHECKLIST
// ---------------------------------------------------------------------------

/**
 * Save a complete payroll setup for one employee, or refuse.
 *
 * There is no partial mode. Either every blocking step passes and all three
 * records are written, or nothing is written and the caller is told which
 * fields to highlight.
 */
export async function saveEmployeePayrollSetup(input: {
  candidate: OnboardingCandidate;
  /** Nine digits, with or without dashes. Optional only so the type is honest. */
  ssn?: string | null;
}): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) return NOT_CONFIGURED;

  // (1) Ask the core. This file does not re-implement any rule, because a
  // second copy of a rule eventually disagrees with the first, silently.
  const evaluation = evaluateOnboarding(input.candidate);

  if (!evaluation.canSaveToPayroll) {
    return {
      ok: false,
      refusalCode: evaluation.refusalCode ?? "missing_required_steps",
      message: refusalSentence(evaluation),
      fields: evaluation.blockingProblems.map((p) => p.field),
      evaluation,
    };
  }

  // (2) The SSN is validated here rather than in the checklist, because it is
  // stored on `employees` and not on any of the three forms. It is still a
  // BLOCKING problem: a W-2 without a valid SSN is rejected by the SSA.
  let normalizedSsn: string | null = null;
  if (input.ssn != null && input.ssn.trim() !== "") {
    const problems = ssnProblems(input.ssn);
    if (problems.length > 0) {
      return {
        ok: false,
        refusalCode: "identity_defective",
        message:
          `That Social Security number cannot be right: ${problems[0]} ` +
          `Nothing was saved. The SSA rejects a W-2 filed with an invalid number, ` +
          `so catching it now costs a minute and catching it in January costs a filing.`,
        fields: ["identity.ssn"],
        evaluation,
      };
    }
    normalizedSsn = normalizeSsn(input.ssn);
  }

  const admin = createSupabaseAdminClient();

  if (!(await payrollSetupMigrationApplied())) {
    return {
      ok: false,
      refusalCode: "migration_missing",
      message:
        "Migration 0195 has not been applied yet, so there is nowhere to put this. " +
        "Nothing was saved. Apply it in the Supabase SQL editor, then try again.",
      fields: [],
      evaluation,
    };
  }

  const employeeId = input.candidate.employeeId;
  let rowsWritten = 0;

  // (3) Supersede any current rows before inserting new ones. The partial
  // unique indexes in 0195 enforce one-current-per-employee, so skipping this
  // would produce a constraint violation rather than a silent duplicate --
  // which is the right failure, but a confusing one to read.
  const w4Superseded = await admin
    .from("employee_w4")
    .update({ is_current: false })
    .eq("employee_id", employeeId)
    .eq("is_current", true);
  if (w4Superseded.error) return writeFailed(w4Superseded.error.message, evaluation);

  const paySuperseded = await admin
    .from("employee_pay")
    .update({ is_current: false })
    .eq("employee_id", employeeId)
    .eq("is_current", true);
  if (paySuperseded.error) return writeFailed(paySuperseded.error.message, evaluation);

  // (4) The three records.
  const w4Insert = await admin.from("employee_w4").insert(w4ToRow(employeeId, input.candidate.w4!)).select("id");
  if (w4Insert.error) return writeFailed(w4Insert.error.message, evaluation);
  rowsWritten += (w4Insert.data ?? []).length;

  const i9Row = i9ToRow(employeeId, input.candidate.i9!);
  const i9Upsert = await admin
    .from("employee_i9")
    .upsert(i9Row, { onConflict: "employee_id" })
    .select("id");
  if (i9Upsert.error) return writeFailed(i9Upsert.error.message, evaluation);
  rowsWritten += (i9Upsert.data ?? []).length;

  const payInsert = await admin
    .from("employee_pay")
    .insert(payToRow(employeeId, input.candidate.pay!))
    .select("id");
  if (payInsert.error) return writeFailed(payInsert.error.message, evaluation);
  rowsWritten += (payInsert.data ?? []).length;

  if (normalizedSsn) {
    const ssnUpdate = await admin
      .from("employees")
      .update({ ssn_full: normalizedSsn })
      .eq("id", employeeId)
      .select("id");
    if (ssnUpdate.error) return writeFailed(ssnUpdate.error.message, evaluation);
    rowsWritten += (ssnUpdate.data ?? []).length;
  }

  // (5) Standing rule 51: count the write. If the database accepted the
  // statements but wrote nothing (a silently filtered update, a missing row),
  // reporting success would be a lie.
  if (rowsWritten === 0) {
    return {
      ok: false,
      refusalCode: "write_failed",
      message:
        "The database reported no error but also wrote no rows, so this is being " +
        "treated as a failure rather than a success. Nothing can be relied on here.",
      fields: [],
      evaluation,
    };
  }

  return { ok: true, employeeId, rowsWritten, evaluation };
}

// ---------------------------------------------------------------------------
// Row mappers
//
// Kept separate from the write so the shape of a row is readable in one place,
// and so a column rename is a one-line change instead of a hunt.
// ---------------------------------------------------------------------------

function w4ToRow(employeeId: string, w4: W4Record) {
  /*
   * W4Record carries `signedAt` and nothing else about signing. The table has
   * three date/flag columns, and the mapping between them is a decision, so it
   * is written down rather than left to look obvious:
   *
   *   signed_on       = the date on the signature line.
   *   effective_from  = the same date. A W-4 takes effect when furnished; there
   *                     is no separate "effective" box on the form, and
   *                     inventing one would create a field with no source.
   *   employee_signed = whether signedAt exists at all. An unsigned W-4 is not
   *                     a W-4 (31 CFR 31.3402(f)(2)-1(f)(3)(i)), so a null
   *                     signature date IS the "not signed" fact.
   *
   * The core's validateW4() already blocks an unsigned form, so `signedAt`
   * cannot be null on a record that reached this function. The `??` below is
   * therefore unreachable in the normal path and exists only so a future caller
   * that skips the gate gets a constraint violation from the database instead of
   * the string "undefined" in a date column.
   */
  const signed = w4.signedAt;
  return {
    employee_id: employeeId,
    form_year: w4.formYear,
    filing_status: w4.filingStatus,
    step2_multiple_jobs: w4.step2MultipleJobs,
    step3_annual_credit_cents: w4.step3AnnualCreditCents,
    step4a_other_income_cents: w4.step4aOtherIncomeAnnualCents,
    step4b_deductions_cents: w4.step4bDeductionsAnnualCents,
    step4c_extra_per_period_cents: w4.step4cExtraPerPeriodCents,
    exempt_from_federal_income_tax: w4.exemptFromFederalIncomeTax,
    legacy_allowances: w4.formYear < 2020 ? (w4.legacyAllowances ?? null) : null,
    signed_on: signed,
    effective_from: signed,
    employee_signed: signed !== null,
    is_current: true,
  };
}

function i9ToRow(employeeId: string, i9: I9Record) {
  /*
   * Two columns are DERIVED here rather than carried on I9Record, and both
   * choices are deliberate:
   *
   *   all_documents_unexpired - computed from the documents themselves. A
   *     stored boolean beside the documents is a second copy of a fact that can
   *     disagree with the first; a document list with an expired entry and a
   *     TRUE flag is exactly the silent contradiction this system exists to
   *     prevent. Note that a null expirationYmd means "does not expire" (a
   *     Social Security card, for instance), which is unexpired, not unknown.
   *
   *   retain_until - computed with i9RetainUntilYmd(), the same function the
   *     checklist uses. Termination is not known at setup time, so this is the
   *     hire+3-years figure and gets recomputed if someone leaves. Re-deriving
   *     it here rather than storing whatever the caller passed means the two
   *     answers cannot drift apart.
   *
   * citizenship_status is intentionally NOT written. I9Record does not carry it,
   * and this store will not invent a value for a column whose whole risk profile
   * is that it must never influence anything (8 CFR 274a.2(b)(4)). The column
   * exists for form completion; it stays null until there is a real source.
   */
  const hire = i9.firstDayOfEmploymentYmd;
  return {
    employee_id: employeeId,
    section1_completed_on: i9.section1SignedYmd,
    work_authorization_expires_on: null,
    section2_completed_on: i9.section2CompletedYmd,
    first_day_of_work: hire,
    documents_examined: i9.documents,
    all_documents_unexpired: i9.documents.every((d) => d.expirationYmd === null || d.expirationYmd >= (i9.section2CompletedYmd ?? hire ?? "0000-00-00")),
    documents_copied: i9.copiesRetained,
    reverified_on: null,
    retain_until: hire === null ? null : i9RetainUntilYmd(hire, null),
  };
}

function payToRow(employeeId: string, pay: PayRecord) {
  return {
    employee_id: employeeId,
    basis: pay.basis,
    hourly_rate_milli_cents: pay.basis === "hourly" ? pay.hourlyRateMilliCents : null,
    annual_salary_cents: pay.basis === "salary" ? pay.annualSalaryCents : null,
    pay_frequency: pay.payFrequency,
    labor_role_code: pay.laborRoleCode,
    cogs_split_basis_points: pay.cogsSplitBasisPoints,
    effective_from: pay.hireYmd,
    minimum_wage_milli_cents_at_hire: pay.minimumWageMilliCentsAtHire ?? null,
    is_current: true,
  };
}

// ---------------------------------------------------------------------------
// Refusal prose
//
// The message a refusal carries is the only part of this file Michael will
// actually read, so it says what is wrong, how many things are wrong, and what
// happens next -- in that order, in plain English.
// ---------------------------------------------------------------------------
function refusalSentence(evaluation: OnboardingEvaluation): string {
  const n = evaluation.blockingProblems.length;
  const first = evaluation.blockingProblems[0]?.message ?? "A required step is not finished.";
  if (n === 1) {
    return `${first} Nothing was saved, and the field is highlighted above.`;
  }
  return (
    `${first} There ${n === 2 ? "is 1 other problem" : `are ${n - 1} other problems`} as ` +
    `well. Nothing was saved, and every field involved is highlighted above.`
  );
}

function writeFailed(detail: string, evaluation: OnboardingEvaluation): SaveRefusal {
  return {
    ok: false,
    refusalCode: "write_failed",
    message:
      `The database refused the write: ${detail}. Nothing was saved. This is the ` +
      `second line of defence catching something the checklist did not, which ` +
      `means the checklist has a gap worth reporting.`,
    fields: [],
    evaluation,
  };
}
