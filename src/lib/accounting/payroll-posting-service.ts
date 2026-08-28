/**
 * src/lib/accounting/payroll-posting-service.ts   (slice books-86)
 *
 * THE DOOR PAYROLL WALKS THROUGH TO REACH THE LEDGER. Closes D-38.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY EVERY CALL HERE USES createBooksClient()
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `gl_post_payroll_run` is `security definer` and its FIRST statement is
 * `if not public.is_owner()`. `is_owner()` resolves through `auth.uid()`, and
 * `auth.uid()` is null under the service-role key because that key carries no
 * `sub` claim. So calling this RPC with `createSupabaseAdminClient()` does not
 * grant more access — it grants NONE, and the refusal reads like a permissions
 * bug rather than a missing session. That exact mistake is a shipped defect
 * this repository has already paid for once; books-client.ts warns about it in
 * capitals.
 *
 * It matters twice over here. Posting writes `created_by = auth.uid()` into
 * permanent accounting history. A null actor is history with nobody attached to
 * it, which is the same as no control at all.
 *
 * The one exception is READS of reference data — the labor roles and allocation
 * rows — which go through the admin client because they are the same rows for
 * everybody and the surrounding page is already owner-gated. That is stated
 * rather than assumed, and the WRITE never travels that way.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE ACTIVITY LIST IS READ AND NOT DEFAULTED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `activityCodes` drives the reseller-or-producer finding, which decides
 * whether ANY labor may reach inventory. Hard-coding it would mean the most
 * consequential input to a §280E determination was a literal in a service file
 * that nobody would ever think to revisit — and if Michael ever added a
 * producer licence, the books would go on quietly applying the reseller answer.
 *
 * There is no activity table today. Rather than invent one or fabricate a
 * default, this service reads the roles actually in use on the run and derives
 * the activities from the labor taxonomy, which is the same source of truth the
 * §280E engine uses. If that ever becomes insufficient the engine says so out
 * loud through PAY_UNKNOWN_ACTIVITY rather than failing silently.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE REFUSES TO DECIDE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * All of it. Every judgement — whether the run may post, what the lines are,
 * which refusal applies — is made by `payroll-posting-core.ts`, which is pure
 * and mutation-tested. This file reads, calls, and translates database errors
 * into sentences. If a rule appeared in this file it would be a rule nothing
 * checks, because a service that touches Supabase cannot be unit tested here.
 */

import "server-only";

import { createBooksClient } from "@/lib/supabase/books-client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireStaff } from "@/lib/auth/session";
import { canReadBooks } from "./books-view-core";
import { explainGlRefusal } from "./gl-refusal-core";
import { findLaborRole, LABOR_ROLES } from "./payroll-cogs-core";
import {
  planPayrollPosting,
  type AllocationFacts,
  type EmployeeRoleFacts,
  type PaycheckFacts,
  type PayRunFacts,
  type PayrollPostingPlan,
  type PayrollPostingRefusal,
} from "./payroll-posting-core";
import { loadPayRun } from "@/lib/payroll/pay-run-store";

/* ═════════════════════════════════════════════════════════════════════════
 * WHAT THE SCREEN GETS BACK
 * ═════════════════════════════════════════════════════════════════════════ */

export type PayrollPostOutcome =
  | {
      readonly ok: true;
      readonly journalId: string | null;
      readonly journalNo: number | null;
      readonly status: string | null;
      /** True when the ledger recognised this run as already recorded. */
      readonly duplicate: boolean;
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly whatToDo: string;
      /** Present when the pure core refused before any database call. */
      readonly refusals: readonly PayrollPostingRefusal[];
    };

/* ═════════════════════════════════════════════════════════════════════════
 * THE OWNER GATE
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Returns the session when the actor may read the books, otherwise null.
 *
 * Returns rather than redirects, deliberately, and for the same reason
 * approval-service.ts does: these run inside server actions, where a redirect
 * replaces a readable sentence with a blank screen. Same pattern for the same
 * rule, one shape across the codebase.
 */
async function ownerSession() {
  const session = await requireStaff();
  if (!canReadBooks(session.profile.role)) return null;
  return session;
}

/* ═════════════════════════════════════════════════════════════════════════
 * READING THE FACTS
 * ═════════════════════════════════════════════════════════════════════════ */

type AllocationRow = {
  employee_id: string;
  labor_role_code: string;
  share_milli_pct: number;
  document_ref: string | null;
  basis_note: string | null;
};

type PayRow = {
  employee_id: string;
  labor_role_code: string | null;
  cogs_split_basis_points: number | null;
};

/**
 * The documented time splits in force on the pay date.
 *
 * Effective-dated on purpose: an allocation that ended in June must not classify
 * a November payroll. A FAILED READ IS NOT AN EMPTY RESULT (standing rule 46) —
 * returning `[]` on error would silently fall back to the single role on each
 * pay record and quietly change how wages are classified for tax. So the error
 * is carried back and the whole post refuses.
 */
async function readAllocations(
  payDateIso: string,
): Promise<{ rows: AllocationFacts[]; error: string | null }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("gl_payroll_allocations")
    .select("employee_id, labor_role_code, share_milli_pct, document_ref, basis_note")
    .eq("active", true)
    .lte("effective_from", payDateIso)
    .or(`effective_to.is.null,effective_to.gte.${payDateIso}`);

  if (error) return { rows: [], error: error.message };

  const rows = ((data ?? []) as unknown as AllocationRow[]).map((r) => ({
    employeeId: r.employee_id,
    roleCode: r.labor_role_code,
    shareMilliPct: r.share_milli_pct,
    documentRef: r.document_ref,
    basisNote: r.basis_note,
  }));
  return { rows, error: null };
}

/** The single labor role on each current pay record. */
async function readRolesOnFile(): Promise<{
  rows: EmployeeRoleFacts[];
  error: string | null;
}> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("employee_pay")
    .select("employee_id, labor_role_code, cogs_split_basis_points")
    .eq("is_current", true);

  if (error) return { rows: [], error: error.message };

  const rows = ((data ?? []) as unknown as PayRow[])
    .filter((r) => r.labor_role_code !== null)
    .map((r) => ({
      employeeId: r.employee_id,
      laborRoleCode: r.labor_role_code as string,
      cogsSplitBasisPoints: r.cogs_split_basis_points ?? 0,
    }));
  return { rows, error: null };
}

/**
 * The activities implied by the roles actually being paid.
 *
 * Derived from the labor taxonomy rather than typed out here, so the two cannot
 * drift. A role whose treatment is "acquisition" means somebody received a
 * delivery; every retail payroll also involves selling. Both codes are members
 * of PRODUCTION_ACTIVITIES, and neither makes Greenway a producer — which is
 * the correct answer for an I-502 retailer and the one the case law supports.
 */
function activitiesFor(roleCodes: readonly string[]): readonly string[] {
  const codes = new Set<string>(["display_sell"]);
  for (const rc of roleCodes) {
    const role = findLaborRole(rc);
    if (role && role.treatment === "acquisition") codes.add("receive_manifest");
  }
  return [...codes];
}

/* ═════════════════════════════════════════════════════════════════════════
 * THE PLAN, WITHOUT WRITING ANYTHING
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Work out what posting this pay period WOULD do, and write nothing.
 *
 * The screen calls this to decide what the button says and what warnings to
 * show. Separating it from the write is the whole reason a preview is
 * trustworthy: the same pure function produces both answers, so the preview
 * cannot disagree with what happens when the button is pressed.
 */
export async function previewPayrollPosting(
  periodId: string,
): Promise<
  | { readonly ok: true; readonly plan: PayrollPostingPlan; readonly periodLabel: string }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly whatToDo: string }
> {
  const session = await ownerSession();

  const run = await loadPayRun(periodId);
  if (!run.ok) {
    return {
      ok: false,
      code: run.code,
      message: run.message,
      whatToDo: run.whatToDo,
    };
  }

  const [allocations, roles] = await Promise.all([
    readAllocations(run.payDateIso),
    readRolesOnFile(),
  ]);

  if (allocations.error !== null || roles.error !== null) {
    return {
      ok: false,
      code: "PAYROLL_READ_FAILED",
      message:
        "The labour classifications behind this payroll could not be read, so nothing was " +
        `worked out and nothing was written: ${allocations.error ?? roles.error}`,
      whatToDo:
        "This is a database problem rather than a payroll one. Nothing has been posted. Try " +
        "again, and if it persists it is worth reporting rather than working around — the " +
        "system deliberately will not fall back to a default classification.",
    };
  }

  const plan = buildPlan(run, allocations.rows, roles.rows, session !== null);
  return { ok: true, plan, periodLabel: run.periodLabel };
}

/** Shared by preview and post so the two cannot diverge. */
function buildPlan(
  run: Awaited<ReturnType<typeof loadPayRun>> & { ok: true },
  allocations: readonly AllocationFacts[],
  roles: readonly EmployeeRoleFacts[],
  isOwner: boolean,
): PayrollPostingPlan {
  const lines: PaycheckFacts[] = run.result.lines.map((l) => ({
    employeeId: l.employeeId,
    employeeName: l.employeeName,
    computed: l.status !== "blocked" && l.breakdown !== null && l.taxes !== null,
    grossWagesCents: l.grossWagesCents,
    // WHAT WAS ACTUALLY WITHHELD, not what the tax tables computed. On a cheque
    // too small to carry its own withholding these differ, and only the actual
    // figure ties to net pay. requiredByLaw.totalCents IS
    // taxes.totalEmployeeWithheldCents (net-pay-core.ts:217).
    employeeWithholdingCents: l.breakdown?.requiredByLaw.totalCents ?? null,
    employerTaxCents: l.taxes?.totalEmployerTaxCents ?? null,
    garnishmentCents: l.totalGarnishedCents,
    voluntaryDeductionCents: l.breakdown?.totalVoluntaryCents ?? 0,
    netPayCents: l.netPayCents,
    hundredthHours: l.taxes?.lni.ok ? l.taxes.lni.value.hundredthHours : null,
  }));

  const facts: PayRunFacts = {
    // Payroll belongs to the operating company. The other three sets of books
    // have no employees: the ATM and the landholding entity are separate
    // businesses whose labour, if it ever exists, is classified as such by the
    // taxonomy itself rather than by posting it to a different ledger.
    entityCode: "greenway",
    periodStartDate: run.periodStartDate,
    periodEndDate: run.periodEndDate,
    payDateIso: run.payDateIso,
    canPay: run.result.canPay,
    lines,
  };

  const roleCodes = [
    ...allocations.map((a) => a.roleCode),
    ...roles.map((r) => r.laborRoleCode),
  ];

  return planPayrollPosting(
    facts,
    allocations,
    roles,
    activitiesFor(roleCodes),
    isOwner,
    // The minimum wage is not in this codebase and this file is not going to be
    // the first place that invents one. Null means "cannot check", and the
    // §280E engine skips the wage-floor test rather than comparing against a
    // fabricated figure (standing rule 62d).
    null,
  );
}

/* ═════════════════════════════════════════════════════════════════════════
 * THE WRITE
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Post a pay period to the general ledger.
 *
 * Re-reads and re-plans from scratch rather than trusting anything the screen
 * sends. The alternative — accepting a plan built when the page was rendered —
 * would post figures that were correct minutes ago, which is exactly how a
 * corrected payroll gets booked at its old numbers.
 *
 * Lands as a DRAFT. Payroll is never auto-posted: it is excluded from
 * gl_posting_templates on purpose, because the §280E labour split is a human
 * judgement every period. It then goes through the same approve-and-post path
 * as everything else (books-85), which is where the second pair of eyes lives.
 */
export async function postPayrollRun(periodId: string): Promise<PayrollPostOutcome> {
  const session = await ownerSession();
  if (session === null) {
    return {
      ok: false,
      code: "PAYROLL_NOT_OWNER",
      message: "Only the owner can post payroll to the books.",
      whatToDo:
        "Paying people and recording what it means for tax are two different jobs. Ask the " +
        "owner to post this run.",
      refusals: [],
    };
  }

  const run = await loadPayRun(periodId);
  if (!run.ok) {
    return {
      ok: false,
      code: run.code,
      message: run.message,
      whatToDo: run.whatToDo,
      refusals: [],
    };
  }

  const [allocations, roles] = await Promise.all([
    readAllocations(run.payDateIso),
    readRolesOnFile(),
  ]);

  if (allocations.error !== null || roles.error !== null) {
    return {
      ok: false,
      code: "PAYROLL_READ_FAILED",
      message:
        "The labour classifications behind this payroll could not be read, so nothing was " +
        `posted: ${allocations.error ?? roles.error}`,
      whatToDo:
        "Nothing has been written. This is a database problem rather than a payroll one — the " +
        "system refuses rather than falling back to a default classification, because a " +
        "defaulted §280E label produces a journal that balances and is still wrong.",
      refusals: [],
    };
  }

  const plan = buildPlan(run, allocations.rows, roles.rows, true);

  if (plan.kind === "refuse") {
    const first = plan.refusals[0];
    return {
      ok: false,
      code: first?.code ?? "PAYROLL_REFUSED",
      message: first?.message ?? "This payroll cannot be posted.",
      whatToDo: first?.whatToDo ?? "",
      refusals: plan.refusals,
    };
  }

  // THE SESSION CLIENT. See the header — the admin client would make
  // auth.uid() null and is_owner() false, and the RPC would refuse.
  const supabase = await createBooksClient();

  const { data, error } = await supabase.rpc("gl_post_payroll_run", {
    p_entity_code: plan.entityCode,
    p_pay_date: plan.payDate,
    p_source_ref: plan.sourceRef,
    p_memo: plan.memo,
    p_lines: plan.lines,
    p_expected_cents: plan.expectedCents,
    p_assumption_note: assumptionNote(plan.contentFingerprint),
    // No run id: nothing links a pay PERIOD to a payroll_runs row today, so
    // there is no id to send. Written as an explicit null rather than omitted,
    // because the consequence is real and is recorded as a defect: without it
    // the database cannot detect that an already-posted run has CHANGED. The
    // fingerprint travels in the assumption note so the change is at least
    // visible on the entry itself.
    p_run_id: null,
    p_content_fingerprint: plan.contentFingerprint,
  });

  if (error) {
    const explained = explainGlRefusal(error);
    return {
      ok: false,
      code: explained.code,
      message: explained.title,
      whatToDo: explained.whatToDo,
      refusals: [],
    };
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const duplicate = row.outcome === "duplicate";

  return {
    ok: true,
    journalId: (row.journal_id as string) ?? null,
    journalNo:
      row.journal_no === null || row.journal_no === undefined
        ? null
        : Number(row.journal_no),
    status: (row.status as string) ?? null,
    duplicate,
    message: duplicate
      ? "This payroll was already in the books. Nothing was posted twice — the original entry " +
        "is unchanged."
      : "Payroll is recorded as a draft entry, with every line carrying its §280E label. It " +
        "will appear under Waiting to Post for you to approve.",
  };
}

/**
 * The sentence stored on the entry saying what it rests on.
 *
 * The fingerprint is included because there is no run id to stamp: it is the
 * only durable record on the journal itself of WHICH version of the payroll
 * figures produced it. Without it, a corrected payroll re-posted under the same
 * source reference would be silently treated as a duplicate.
 */
function assumptionNote(fingerprint: string): string {
  return (
    "Posted from the pay run screen. Wages are classified by labor role under the §280E " +
    "taxonomy in payroll-cogs-core.ts; only roles whose treatment is acquisition reach " +
    `inventory, and only on a documented allocation. Content fingerprint ${fingerprint}.`
  );
}

/**
 * Every labor role, for the screen's explanation panel.
 *
 * Exported so the page does not import the tax engine directly to render a
 * list, which would make the boundary between "what the books decide" and
 * "what the screen draws" harder to see than it needs to be.
 */
export function laborRoleSummary(): readonly {
  code: string;
  label: string;
  accountCode: string;
  costClass: string;
}[] {
  return LABOR_ROLES.map((r) => ({
    code: r.code,
    label: r.label,
    accountCode: r.accountCode,
    costClass: r.costClass,
  }));
}
