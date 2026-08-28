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
import { recordAudit } from "@/lib/auth/audit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { requiredBigint } from "@/lib/supabase/pg-bigint";
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
import type { W4Record, PayFrequency } from "@/lib/payroll/payroll-w4-core";
// The list of pay frequencies is the CORE's list. Reading it from there rather
// than re-typing the eight strings means a frequency added to the core is
// understood by the read-back below without a second edit nobody remembers.
import { ALL_PAY_FREQUENCIES } from "@/lib/payroll/payroll-w4-core";
// books-65. The one place that decides how a work code is spelled on disk.
import { socCodeCanonical } from "@/lib/payroll/esd-eams-csv-core";

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
  /**
   * The ESD work code on file, or "" when there is none. books-65.
   *
   * Empty string rather than null so the roster and the form speak one
   * vocabulary for absent; `OnboardingCandidate.socCode` is the same shape.
   */
  socCode: string;
};

/**
 * The roster view for the setup screen.
 *
 * Deliberately selects NAMED COLUMNS rather than `*`. The rest of this codebase
 * uses `select("*")` for graceful degradation, and that is defensible - but not
 * on a table that now holds a full SSN. Naming the columns means the SSN cannot
 * arrive here by accident, which is a stronger guarantee than remembering to
 * delete it afterwards.
 *
 * WHO APPEARS HERE, AND WHY IT CHANGED IN books-87
 *
 * This screen asks one question: who do we need payroll paperwork for? Until
 * books-87 it answered with EVERY row in `employees`, which was the least
 * filtered view of the roster anywhere in the app - `listEmployees` defaults to
 * `active = true` and `rosterOverview` drops `terminated`, but this did neither.
 * So people who had left still appeared, badged red for a missing W-4 they were
 * never going to file.
 *
 * Worse, `employees` had been seeded from back-office LOGINS by migration 0037,
 * so an outside accountant with a read-only account showed up as somebody to
 * pay. Michael: "I would rather users be people who have access to the system,
 * and be separate from employees."
 *
 * Migration 0210 retires those seeded rows and states the definition once, as
 * `employees_on_payroll`. The filter here is written out in full rather than
 * reading that view, for a measured reason: this function must keep working on
 * a database where 0210 has not been applied yet, and selecting from a missing
 * view fails the whole read. The two definitions are pinned to each other by a
 * test, so they cannot drift.
 */
export async function listEmployeeSetup(): Promise<{
  rows: EmployeeSetupRow[];
  migrationApplied: boolean;
}> {
  if (!isSupabaseServiceConfigured) return { rows: [], migrationApplied: false };
  const admin = createSupabaseAdminClient();

  const { data: emps, error } = await admin
    .from("employees")
    .select("id, full_name, ssn_last_four, soc_code")
    // Currently employed, and not somebody who has left. Matches
    // public.employees_on_payroll (migration 0210 §3) exactly.
    .eq("active", true)
    .neq("employment_status", "terminated")
    .order("full_name", { ascending: true });

  if (error) {
    // ssn_last_four does not exist yet => 0195 has not been applied.
    return { rows: [], migrationApplied: false };
  }

  const employees =
    (emps as {
      id: string;
      full_name: string;
      ssn_last_four: string | null;
      soc_code: string | null;
    }[]) ?? [];
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
      socCode: (e.soc_code ?? "").trim(),
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

  /*
   * The two columns that live on `employees` rather than on one of the three
   * forms: the full SSN, and the ESD work code (books-65).
   *
   * ONE UPDATE, NOT TWO. An earlier shape did the SSN here and the SOC code in
   * a second statement, and that is two chances to half-succeed - a saved code
   * against an unsaved number, with `rowsWritten` counting both. Building the
   * patch object first means the row is either updated or it is not.
   *
   * A field the caller did not supply is OMITTED from the patch rather than
   * written as null. Sending null would erase a code that is already on file
   * because this particular save happened not to mention it, which is how a
   * quarterly wage report quietly loses a column between one save and the next.
   */
  const employeePatch: Record<string, string> = {};
  if (normalizedSsn) employeePatch.ssn_full = normalizedSsn;

  // Canonical spelling, chosen to satisfy the CHECK in migration 0207 by
  // construction. `socCodeProblems` has already blocked anything malformed, so
  // a non-empty candidate value canonicalises rather than vanishing.
  const canonicalSoc = socCodeCanonical(input.candidate.socCode);
  if (canonicalSoc !== "") employeePatch.soc_code = canonicalSoc;

  if (Object.keys(employeePatch).length > 0) {
    const employeeUpdate = await admin
      .from("employees")
      .update(employeePatch)
      .eq("id", employeeId)
      .select("id");
    if (employeeUpdate.error) return writeFailed(employeeUpdate.error.message, evaluation);
    rowsWritten += (employeeUpdate.data ?? []).length;
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

/* ═══════════════════════════════════════════════════════════════════════════
 * THE READ-BACK  (books-39)
 *
 * WHAT WAS MISSING, AND WHY IT WAS THE WHOLE BLOCKER
 *
 * `w4ToRow` above has existed since books-30. It writes eleven columns of a
 * federal withholding certificate into `employee_w4`. Until this moment NOTHING
 * IN THE APPLICATION EVER READ THEM BACK. Every read of that table in src/ was
 * this one, at listEmployeeSetup:
 *
 *     admin.from("employee_w4").select("employee_id")
 *
 * an EXISTENCE CHECK. It answers "did somebody fill in a W-4?" and nothing else.
 *
 * That is why no real employee could be paid. `computePaycheckTaxes`
 * (payroll-withholding-core.ts:1906) takes a full `W4Record` - filing status,
 * Step 2 checkbox, Steps 3/4a/4b/4c, legacy allowances, signature. The engine
 * was finished, tested and correct, and it could not be called on a real person
 * because the data went INTO the database and never came out. A write-only
 * column is not a stored fact; it is a fact we threw away politely.
 *
 * WHY THE INVERSE IS NOT MECHANICAL, AND THE TRAP IN IT
 *
 * The obvious inverse of `signed_on: signed` is `signedAt: row.signed_on`.
 * THAT IS WRONG, and it is wrong in the direction that costs money.
 *
 * Look at the DDL (migration 0195, §1):  signed_on date NOT NULL.
 * The column CANNOT be null. So `row.signed_on` is ALWAYS a date, even for a
 * certificate nobody signed. Mapping it straight across would give every
 * unsigned W-4 a non-null `signedAt`, and `signedAt !== null` is precisely how
 * the rest of this codebase asks "is this form valid?".
 *
 * The fact of signature lives in a DIFFERENT column. `w4ToRow` wrote it:
 *
 *     employee_signed: signed !== null
 *
 * so the honest inverse must consult `employee_signed` FIRST and only then use
 * the date. An unsigned certificate reads back with `signedAt: null`, which is
 * what `chooseW4` in pay-run-core.ts needs in order to disregard it and apply
 * the statutory default instead:
 *
 *   26 CFR 31.3402(f)(2)-1(e)(1)(ii): "the employer shall disregard the
 *   withholding certificate"
 *
 * Get this one line backwards and the system honours withholding elections the
 * employee never agreed to, under-withholds, and hands them a surprise bill in
 * April. There is a test that fails if anyone ever "simplifies" it back.
 *
 * WHY THIS LIVES HERE AND NOT IN A NEW FILE
 *
 * Standing rule 25: extend, do not duplicate. A converter's whole job is to
 * agree with its opposite. Put the two of them in one file, forty lines apart,
 * and a column rename is one visible edit. Put them in two files and the day
 * somebody adds a Step 4(d) the writer learns about it and the reader does not.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Exactly the columns `w4ToRow` writes. Never `select("*")` and never a subset. */
export const W4_COLUMNS =
  "employee_id, form_year, filing_status, step2_multiple_jobs, " +
  "step3_annual_credit_cents, step4a_other_income_cents, step4b_deductions_cents, " +
  "step4c_extra_per_period_cents, exempt_from_federal_income_tax, legacy_allowances, " +
  "signed_on, employee_signed";

export type W4Row = {
  readonly employee_id: string;
  readonly form_year: number;
  readonly filing_status: string;
  readonly step2_multiple_jobs: boolean;
  /** bigint columns arrive from PostgREST as strings. */
  readonly step3_annual_credit_cents: number | string | null;
  readonly step4a_other_income_cents: number | string | null;
  readonly step4b_deductions_cents: number | string | null;
  readonly step4c_extra_per_period_cents: number | string | null;
  readonly exempt_from_federal_income_tax: boolean;
  readonly legacy_allowances: number | null;
  readonly signed_on: string | null;
  readonly employee_signed: boolean;
};

/**
 * Read a nullable bigint cent column from `employee_w4`.
 *
 * The conversion lives in `@/lib/supabase/pg-bigint`; this wrapper pins the
 * table and keeps the four call sites below unchanged.
 *
 * WHY IT MOVED, AND WHAT CHANGED. The note that used to sit here invoked
 * standing rule 62d correctly - "a value that is null or unparseable returns
 * null, NOT zero... Zero is a real Step 3 answer meaning no credits; using it
 * for we could not read the column makes an unreadable row indistinguishable
 * from a deliberate election." That reasoning is exactly right, and the code
 * under it did not achieve it. `Number("")` is 0, and the guard tested the
 * RESULT of the conversion rather than the text going in, so an empty
 * `step3_annual_credit_cents` returned 0 - a deliberate election of "no
 * credits" - which is the precise confusion the comment forbade. It also
 * accepted `"9007199254740993"` as an off-by-one integer, because `isFinite`
 * says nothing about whether the digits survived.
 *
 * ═══ AND THEN books-46 CORRECTED THIS COMMENT, WHICH WAS WRONG. ═══
 *
 * The paragraph that used to sit here argued for `optionalBigint` on the ground
 * that "`null` here means the employee left Step 3 blank - itself a real W-4
 * answer". That is a plausible sentence and it is false. All four of these
 * columns are NOT NULL, verified against the live schema:
 *
 *   step3_annual_credit_cents      bigint  NOT NULL
 *   step4a_other_income_cents      bigint  NOT NULL
 *   step4b_deductions_cents        bigint  NOT NULL
 *   step4c_extra_per_period_cents  bigint  NOT NULL
 *
 * A W-4 with Step 3 left blank is therefore stored as ZERO, not as null. Null
 * cannot mean "blank" because null cannot occur. If one ever arrives - from a
 * restored backup, a hand-run statement, or a `select` that outer-joined - it
 * is not an election, it is a broken row. So this reads `requiredBigint`: the
 * ONLY correct reading of a null in a NOT NULL column is a refusal.
 *
 * (`W4Row` still declares these `number | string | null`, and that is honest:
 * it describes what PostgREST may hand us over the wire, not what the
 * constraint permits. The type is the pessimist and the constraint is the fact.
 * Reconciling them by tightening the type would be inventing a guarantee the
 * transport does not make.)
 *
 * ═══ WHY THIS CATCHES INSTEAD OF LETTING THE ERROR FLY. ═══
 *
 * `requiredBigint` THROWS, and that is right for its own contract - it is used
 * by screens where an unreadable wage column must stop the page. Here it would
 * be wrong to let it fly, and the full suite is what proved it: this function's
 * caller, `foldW4Rows`, returns `{ byEmployeeId, unreadable }` and deliberately
 * isolates damage PER EMPLOYEE. One corrupt W-4 names one person and the other
 * employees still get paid.
 *
 * An uncaught throw would convert that into a batch failure: a single bad row
 * takes down the entire payroll load, and the message names the column but not
 * the employee - so Michael would be told a step4a somewhere is unreadable,
 * with no way to find whose. Strictness that destroys the ability to act on it
 * is not strictness, it is a worse outage.
 *
 * So the refusal is CAUGHT and turned into the null this caller's contract is
 * built on. Nothing is guessed: null here still means "this row cannot be read
 * honestly", the row is still refused, and the employee is still named upstream
 * by `foldW4Rows`. The message is preserved on the returned marker so the
 * detail is not thrown away either.
 */
function centsFromColumn(v: number | string | null, column: string): number | null {
  try {
    return requiredBigint(v, { table: "employee_w4", column, context: "an employee W-4" });
  } catch {
    // The shared reader has already decided this column is unreadable. This
    // caller's contract expresses that as null, per the note above. The
    // employee is named by `foldW4Rows`, which is the layer that knows who
    // this row belongs to.
    return null;
  }
}

/**
 * Is this string one of the three filing statuses the IRS actually prints?
 *
 * Written as a narrowing guard rather than a cast. `filing_status` is `text`
 * with a CHECK constraint, so Postgres already refuses anything else - but the
 * CHECK protects the DATABASE, and TypeScript casting a `string` to
 * `W4FilingStatus` protects NOTHING. If a row ever arrives from a restored
 * backup or a hand-run SQL statement that predates the constraint, a cast
 * silently produces a `W4FilingStatus` that is not one, and the withholding
 * tables look up a bracket set that does not exist.
 */
function isW4FilingStatus(v: string): v is W4Record["filingStatus"] {
  return (
    v === "married_filing_jointly" ||
    v === "single_or_married_filing_separately" ||
    v === "head_of_household"
  );
}

/**
 * A stored row, back into the record the withholding engine consumes.
 *
 * THE EXACT INVERSE of `w4ToRow`, with the signature trap handled above.
 *
 * Returns null - never a partial or defaulted record - when the row cannot be
 * read honestly. The caller turns that null into a REFUSAL that names the
 * employee. Refusing is safe; guessing a filing status is not.
 */
export function rowToW4(row: W4Row): W4Record | null {
  if (!isW4FilingStatus(row.filing_status)) return null;

  const step3 = centsFromColumn(row.step3_annual_credit_cents, "step3_annual_credit_cents");
  const step4a = centsFromColumn(row.step4a_other_income_cents, "step4a_other_income_cents");
  const step4b = centsFromColumn(row.step4b_deductions_cents, "step4b_deductions_cents");
  const step4c = centsFromColumn(row.step4c_extra_per_period_cents, "step4c_extra_per_period_cents");
  if (step3 === null || step4a === null || step4b === null || step4c === null) return null;

  /*
   * THE SIGNATURE, and the reason this is two lines instead of one.
   *
   * `signed_on` is NOT NULL in 0195, so it is never absent. The question "is
   * this certificate signed?" is answered by `employee_signed`, which is the
   * column w4ToRow computed from `signedAt !== null`. Reading the date without
   * checking the flag would make every unsigned form look signed.
   */
  const signedAt = row.employee_signed ? row.signed_on : null;

  return {
    employeeId: row.employee_id,
    formYear: row.form_year,
    filingStatus: row.filing_status,
    step2MultipleJobs: row.step2_multiple_jobs,
    step3AnnualCreditCents: step3,
    step4aOtherIncomeAnnualCents: step4a,
    step4bDeductionsAnnualCents: step4b,
    step4cExtraPerPeriodCents: step4c,
    // Mirrors w4ToRow, which stores null on a 2020-or-later form. The
    // employee_w4_redesign_shape_chk constraint enforces the same pairing.
    legacyAllowances: row.form_year < 2020 ? row.legacy_allowances : null,
    exemptFromFederalIncomeTax: row.exempt_from_federal_income_tax,
    signedAt,
  };
}

/**
 * The CURRENT W-4 for each of these employees, as engine-ready records.
 *
 * An employee missing from the returned map has no readable current W-4. That
 * is not an error here: 31.3402(f)(2)-1(a)(4) tells the employer exactly what
 * to do about it (withhold as single with no adjustments), and `chooseW4` in
 * pay-run-core.ts applies that rule and STAMPS the result so the screen can say
 * out loud that the law chose, not the employee.
 *
 * A row that EXISTS but cannot be converted is a different animal, and it is
 * reported separately in `unreadable` rather than folded in with "absent". If
 * those two were merged, a corrupted row would silently receive the statutory
 * default and look like a normal new hire.
 */
export async function loadCurrentW4s(employeeIds: readonly string[]): Promise<{
  readonly byEmployeeId: ReadonlyMap<string, W4Record>;
  readonly unreadable: readonly string[];
  readonly readFailed: string | null;
}> {
  const empty = { byEmployeeId: new Map<string, W4Record>(), unreadable: [], readFailed: null };
  /*
   * The empty-list case is answered BEFORE the configuration check, and the
   * order is deliberate. "Give me the W-4s for these zero employees" has a
   * complete, correct answer - zero W-4s - that does not depend on a database
   * being reachable. Reporting a connection failure instead would hand a caller
   * with an empty roster a frightening error about a read that never needed to
   * happen. Nothing can be computed wrongly from it, because there is nobody to
   * pay.
   */
  if (employeeIds.length === 0) return empty;
  if (!isSupabaseServiceConfigured) {
    return { ...empty, readFailed: "The database connection is not configured on this server." };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("employee_w4")
    .select(W4_COLUMNS)
    .in("employee_id", employeeIds)
    .eq("is_current", true);

  if (error) {
    /*
     * A read failure is NOT an empty result. Returning an empty map here would
     * send every employee down the no-W-4 statutory-default path and produce a
     * full run of confident, wrong paycheques (standing rule 46). The caller
     * must surface this and refuse.
     */
    return { ...empty, readFailed: `Could not read the W-4 records: ${error.message}` };
  }

  return { ...foldW4Rows((data ?? []) as unknown as W4Row[]), readFailed: null };
}

/**
 * Rows into a map, keeping the unreadable ones NAMED.
 *
 * Split out of the loader as a pure function so it can be tested by running it
 * rather than by reading the loader's source text. That distinction earned its
 * keep: the first version of this slice tested the folding by asserting the
 * loader's source contained the word "unreadable", and a mutation that deleted
 * the `unreadable.push(...)` line still passed, because the word survived in
 * the return type. A behavioural test cannot be fooled that way.
 */
export function foldW4Rows(rows: readonly W4Row[]): {
  readonly byEmployeeId: ReadonlyMap<string, W4Record>;
  readonly unreadable: readonly string[];
} {
  const byEmployeeId = new Map<string, W4Record>();
  const unreadable: string[] = [];
  for (const row of rows) {
    const record = rowToW4(row);
    if (record === null) unreadable.push(row.employee_id);
    else byEmployeeId.set(row.employee_id, record);
  }
  return { byEmployeeId, unreadable };
}

/**
 * Each employee's pay frequency, from their CURRENT pay record.
 *
 * Why this is read at all: the number of pay periods in a year is a DIVISOR in
 * the percentage method. Pub. 15-T annualises wages, finds the bracket, then
 * divides back down. Pay somebody biweekly while the engine believes they are
 * semimonthly (26 vs 24) and every federal withholding figure is off by about
 * eight percent, every period, in a way that still looks like a plausible
 * paycheque and does not tie out until the W-2.
 *
 * `timesheet-store.toEmployeePayFacts` already reads `employee_pay`, but it
 * maps to `EmployeePayFacts`, which carries basis and rate and NOT frequency -
 * the timesheet engine counts hours and has no opinion about how often they are
 * paid. So this is a genuinely different fact, not a duplicate read.
 *
 * An employee absent from the map has no current pay record, or one with an
 * unrecognised frequency. Both are refusals upstream. Nothing is defaulted:
 * "biweekly" is right for Greenway today and would be a silent wrong answer the
 * first time somebody is set up differently (standing rule 62d).
 */
export async function loadPayFrequencies(employeeIds: readonly string[]): Promise<{
  readonly byEmployeeId: ReadonlyMap<string, PayFrequency>;
  readonly readFailed: string | null;
}> {
  const empty = { byEmployeeId: new Map<string, PayFrequency>(), readFailed: null };
  // Same ordering as loadCurrentW4s above, and for the same reason: zero
  // employees has a correct answer that needs no database.
  if (employeeIds.length === 0) return empty;
  if (!isSupabaseServiceConfigured) {
    return { ...empty, readFailed: "The database connection is not configured on this server." };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("employee_pay")
    .select(PAY_FREQUENCY_COLUMNS)
    .in("employee_id", employeeIds)
    .eq("is_current", true);

  if (error) {
    return { ...empty, readFailed: `Could not read the pay records: ${error.message}` };
  }

  return {
    byEmployeeId: foldPayFrequencyRows((data ?? []) as unknown as PayFrequencyRow[]),
    readFailed: null,
  };
}

/** Exactly the two columns `loadPayFrequencies` selects. */
export type PayFrequencyRow = {
  readonly employee_id: string;
  readonly pay_frequency: string | null;
};

/**
 * The columns `loadPayFrequencies` asks for, as a named constant.
 *
 * A constant rather than a literal inside the query for the same reason
 * W4_COLUMNS is one: a SELECT that quietly stops asking for `pay_frequency`
 * does not crash. Every row comes back with the column undefined, the fold
 * recognises none of them, every employee drops out of the map, and the pay run
 * refuses everybody with a message about missing pay records - a confusing
 * symptom three layers away from the deleted word. Naming it gives the test
 * something it can actually check.
 */
export const PAY_FREQUENCY_COLUMNS = "employee_id, pay_frequency";

/**
 * Pay-frequency rows into a map, dropping any cadence the engine cannot compute.
 *
 * Pure, and separate from the loader, for the same reason as `foldW4Rows`: so
 * the rule below is proved by RUNNING it. An employee whose stored cadence is
 * unrecognised is simply ABSENT from the map - never defaulted to "biweekly".
 * Biweekly is right for Greenway's staff today and would be a silent wrong
 * answer the first time somebody is set up differently, and the number of pay
 * periods is a DIVISOR in the percentage method: believe 24 where the truth is
 * 26 and every federal withholding figure is off by about eight percent, every
 * period, in a way that still looks like a plausible paycheque (rule 62d).
 */
export function foldPayFrequencyRows(
  rows: readonly PayFrequencyRow[],
): ReadonlyMap<string, PayFrequency> {
  const byEmployeeId = new Map<string, PayFrequency>();
  for (const row of rows) {
    // Membership test against the core's own list, so a new frequency added to
    // payroll-w4-core is understood here without a second list to update.
    const match = ALL_PAY_FREQUENCIES.find((f) => f === row.pay_frequency);
    if (match !== undefined) byEmployeeId.set(row.employee_id, match);
  }
  return byEmployeeId;
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

// ---------------------------------------------------------------------------
// ADDING A PERSON, FROM THE PAYROLL SCREEN (books-87)
//
// Michael: "I want to create the employee in payroll/ W-4 setup, then I will
// give them access to the back office if they need access to it."
//
// Until books-87 this screen refused and sent him to Staffing: "this screen
// sets up their payroll, it does not create people." That was a defensible
// separation of concerns and it was the wrong order of work. Payroll setup is
// where a new hire's paperwork actually gets done, so it is where the person
// should come into existence.
//
// THE ONE THING THIS FUNCTION MUST NEVER DO is set `staff_id`. That column is
// what links an employee row to a back-office LOGIN, and migration 0037 filling
// it in automatically is the entire reason this slice exists. A person created
// here can work here and be paid; whether they can also sign into the admin app
// is a separate decision, made separately, in Users.
// ---------------------------------------------------------------------------

export type AddPersonResult =
  | { ok: true; employeeId: string }
  | { ok: false; code: "no_name" | "duplicate" | "not_configured" | "write_failed"; message: string };

/**
 * The name rule, pure so it can be tested without a database.
 *
 * Deliberately permissive about SHAPE and strict about EMPTINESS. Requiring a
 * surname, or two words, or letters only, would refuse real people - mononyms
 * exist, hyphens and apostrophes and accents are ordinary, and a payroll system
 * that will not spell somebody's name correctly is a payroll system that gets
 * their W-2 wrong. The only thing genuinely disqualifying is nothing at all.
 */
export function normalisePersonName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * Create a person who works here, with no back-office login attached.
 *
 * Returns the new id so the caller can open the W-4 form on them immediately,
 * which is the whole point: add the person, then do their paperwork, without
 * leaving the screen.
 */
export async function addPersonToPayroll(input: {
  fullName: string;
  actorId?: string | null;
}): Promise<AddPersonResult> {
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      code: "not_configured",
      message: "The database is not configured, so nobody was added.",
    };
  }

  const fullName = normalisePersonName(input.fullName);
  if (fullName.length === 0) {
    return {
      ok: false,
      code: "no_name",
      message: "A name is required. Nobody was added.",
    };
  }

  const admin = createSupabaseAdminClient();

  // A soft duplicate check, because two people CAN share a name and the system
  // must not pretend otherwise. This refuses only an exact match among people
  // currently on payroll, and says how to proceed - it does not silently merge.
  const { data: existing } = await admin
    .from("employees")
    .select("id, full_name")
    .eq("active", true)
    .neq("employment_status", "terminated")
    .ilike("full_name", fullName);

  if (((existing as { id: string }[]) ?? []).length > 0) {
    return {
      ok: false,
      code: "duplicate",
      message:
        `${fullName} is already on the payroll list, so nobody was added. If this is a ` +
        `genuinely different person with the same name, add a middle initial or suffix ` +
        `so the two can be told apart on a W-2.`,
    };
  }

  // staff_id is ABSENT on purpose. See the header above.
  const { data, error } = await admin
    .from("employees")
    .insert({
      full_name: fullName,
      active: true,
      employment_status: "active",
      job_role: "sales",
    })
    .select("id")
    .single();

  if (error || !data) {
    return {
      ok: false,
      code: "write_failed",
      message: `The database refused to add this person: ${error?.message ?? "unknown error"}. Nothing was saved.`,
    };
  }

  const employeeId = (data as { id: string }).id;

  await recordAudit({
    actorId: input.actorId ?? null,
    actorEmail: null,
    action: "employee.created.from_payroll_setup",
    entityType: "employee",
    entityId: employeeId,
  });

  return { ok: true, employeeId };
}
