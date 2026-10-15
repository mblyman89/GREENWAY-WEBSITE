/**
 * src/lib/payments/ach-guide-store.ts  (R40)
 *
 * Server-only. Gathers the FACTS the ACH Guide needs (GuideSnapshot) from the
 * same reads the vault, the employee page and the operations page already
 * use, so the guide can never disagree with them. Rules live in
 * ach-guide-core.ts. The ACH calendar's "done" map lives in site_settings
 * (key ach_calendar_done), same pattern as the compliance calendar: no
 * migration, and an unreadable map fails toward "not done" (more nagging,
 * never less).
 *
 * Each read is isolated: one failing read becomes a visible problem on the
 * page, never a blank guide and never a false green.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isAtRestEncryptionConfigured } from "@/lib/security/at-rest-crypto";
import { isLlamaParseConfigured } from "@/lib/inbound-email/llamaparse-provider";
import { resolveNotifyContacts } from "@/lib/payments/ach-authorization-core";
import { opsPageView, type OpsView } from "@/lib/payments/ach-ops-store";
import { listVendorBankDetails } from "@/lib/payments/payee-banking-store";
import { readVendorAchFlags, vendorFollowUpList } from "@/lib/payments/vendor-ach-enrollment-core";
import { participationRows } from "@/lib/payments/vendor-esign-store";
import { getAchCompanySettings, getCompanyEin, listPayrollRuns } from "@/lib/payroll/payroll-store";
import { originatorReadiness } from "@/lib/payments/timberland-originator-core";
import { listEmployeeDepositPlans } from "@/lib/payroll/employee-deposit-plans-store";
import { employeeAchCard } from "@/lib/payroll/employee-ach-card-core";
import { listEmployeeBanking, listEmployees } from "@/lib/staffing/store";
import { listVendors } from "@/lib/vendors/store";
import { checkMarkDone, isTaskDoneNow, normalizeAchDoneMap, type AchDoneMap } from "@/lib/payments/ach-calendar-core";
import type { GuideEmployee, GuideSnapshot } from "@/lib/payments/ach-guide-core";
import { DUAL_NOTE_DISMISS_KEY, normalizeDualNoteDismiss, type DualNoteDismiss } from "@/lib/payments/timberland-bank-steps-core";

export const ACH_CALENDAR_KEY = "ach_calendar_done";
const ACH_CALENDAR_LABEL = "ACH calendar - completed periods (R40)";

export async function getAchDoneMap(): Promise<{ map: AchDoneMap; readError: string | null }> {
  if (!isSupabaseServiceConfigured) return { map: {}, readError: "Database is not configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("site_settings").select("value_json").eq("key", ACH_CALENDAR_KEY).maybeSingle();
    if (error) return { map: {}, readError: error.message };
    return { map: normalizeAchDoneMap(data?.value_json ?? null), readError: null };
  } catch (e) {
    return { map: {}, readError: e instanceof Error ? e.message : "read failed" };
  }
}

/** Mark the CURRENT period of a task done (or undo). Validated by the pure core. */
export async function setAchTaskDone(input: {
  taskId: string;
  periodKey: string;
  todayIso: string;
  done: boolean;
  note?: string | null;
  byEmail: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  const v = checkMarkDone({ taskId: input.taskId, periodKey: input.periodKey, todayIso: input.todayIso, note: input.note });
  if (!v.ok) return v;
  const cur = await getAchDoneMap();
  // Never overwrite a map we could not read: that could erase history.
  if (cur.readError) return { ok: false, error: `Could not read the calendar, so nothing was changed: ${cur.readError}` };
  const periods = { ...(cur.map[v.taskId] ?? {}) };
  if (input.done) periods[v.periodKey] = { doneAt: new Date().toISOString(), byEmail: input.byEmail, note: v.note };
  else delete periods[v.periodKey];
  const next: AchDoneMap = { ...cur.map, [v.taskId]: periods };
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("site_settings")
      .upsert({ key: ACH_CALENDAR_KEY, label: ACH_CALENDAR_LABEL, value_json: next as unknown as Record<string, unknown>, updated_by: null }, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM && (process.env.ORDER_STAFF_EMAILS ?? "").trim());
}

/**
 * Everything the Guide shows. `problems` lists reads that failed; the page
 * shows them in red so a failed read is never mistaken for "all clear".
 */
export async function loadGuideSnapshot(todayIso: string): Promise<{ snapshot: GuideSnapshot; problems: string[]; ops: OpsView | null }> {
  const problems: string[] = [];
  const safe = async <T,>(label: string, f: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await f();
    } catch (e) {
      problems.push(`${label}: ${e instanceof Error ? e.message.slice(0, 200) : "read failed"}`);
      return fallback;
    }
  };

  const [ops, done, settings, employees, banking, vendors, vault, participation, runs] = await Promise.all([
    safe("ACH operations", () => opsPageView(todayIso), null as OpsView | null),
    getAchDoneMap(),
    safe("My banking", () => getAchCompanySettings(), null),
    safe("Employees", () => listEmployees({ includeInactive: true }), []),
    safe("Employee banking", () => listEmployeeBanking(), []),
    safe("Vendors", () => listVendors(), []),
    safe("Vendor vault", () => listVendorBankDetails(), { tableReady: false, controlsReady: false, records: [] }),
    safe("Vendor sign-ups", () => participationRows(), { ready: false, rows: [] }),
    safe("Payroll runs", () => listPayrollRuns(1), []),
  ]);
  if (done.readError) problems.push(`ACH calendar: ${done.readError}`);
  if (ops?.ready && ops.error) problems.push(`ACH operations: ${ops.error}`);

  const activeIds = employees.filter((e) => e.active).map((e) => e.id);
  const plans = await safe("Direct-deposit plans", () => listEmployeeDepositPlans(activeIds), { tableReady: false, plans: new Map() });
  const bankingBy = new Map(banking.map((b) => [b.employee_id, b]));
  const guideEmployees: GuideEmployee[] = employees.map((e) => {
    const b = bankingBy.get(e.id);
    const card = employeeAchCard({
      tableReady: plans.tableReady,
      employeeActive: Boolean(e.active),
      employeeName: e.full_name,
      plan: plans.plans.get(e.id) ?? null,
      historyCount: 0,
      legacy: b ? { routing: b.bank_routing ?? null, accountNumber: b.bank_account_number ?? null, accountType: b.bank_account_type ?? null } : null,
    });
    return { id: e.id, name: e.full_name, active: Boolean(e.active), state: card.state, detail: card.detail, authorizationState: card.authorizationState };
  });

  const vaultBy = new Map(vault.records.map((r) => [r.vendor_id, r]));
  const follow = vendorFollowUpList(
    vendors.map((v) => {
      const rec = vaultBy.get(v.id) ?? null;
      return {
        id: v.id,
        name: v.display_name,
        flags: readVendorAchFlags(v as unknown as Record<string, unknown>),
        vault: { hasRecord: Boolean(rec), status: rec?.status ?? null, verifiedAt: rec?.verified_at ?? null },
      };
    }),
  );

  // R41 S2: the one Timberland readiness answer. A failed settings read is
  // `null` and reads as "could not be read", never as all clear.
  const ein = await safe("Company EIN", () => getCompanyEin(), "");
  const companyMissing = [...originatorReadiness(settings, ein).problems];
  const llama = isLlamaParseConfigured();
  const run = runs[0] ?? null;

  const snapshot: GuideSnapshot = {
    todayIso,
    // opsPageView reports ready=false exactly when the 0258-0263 tables are
    // missing (or the database is not configured); a real read error keeps
    // ready=true and is listed in `problems` instead.
    migrationsReady: Boolean(ops?.ready),
    migrationError: ops ? (ops.ready ? null : ops.error) : "Could not read ACH operations.",
    encryptionConfigured: isAtRestEncryptionConfigured(),
    companyAchComplete: companyMissing.length === 0,
    companyMissing,
    notifyProblems: [...resolveNotifyContacts(process.env).problems],
    emailConfigured: emailConfigured(),
    timberlandAgreementDone: isTaskDoneNow("timberland_agreement_on_file", todayIso, done.map),
    fraudProcedureAdopted: isTaskDoneNow("fraud_procedure_adopt", todayIso, done.map),
    llamaParseConfigured: llama,
    llamaParseDpaDone: isTaskDoneNow("llamaparse_dpa", todayIso, done.map),
    employees: guideEmployees,
    vendorFollowUp: follow.map((f) => ({ id: f.vendorId, name: f.name, state: f.state, nextStep: f.nextStep, warnings: f.warnings })),
    vendorsReady: participation.rows.filter((r) => r.achActive).length,
    vendorsTotal: vendors.length,
    vendorEsignInvitesOpen: participation.rows.filter((r) => r.invite && r.invite !== "signed" && !r.inviteExpired).length,
    ops: {
      notices: (ops?.notices ?? []).map((n) => ({ id: n.id, code: n.code, payee: n.payee, kind: n.notice_kind, applyBy: n.apply_by })),
      holds: (ops?.holds ?? []).map((h) => ({ id: h.id, payee: h.payee_name, employeeId: h.employee_id })),
      checksPlanned: (ops?.checks ?? []).filter((c) => c.open?.status === "planned").length,
      checksWaiting: (ops?.checks ?? []).filter((c) => c.open?.step.kind === "wait").map((c) => ({ payee: c.payee, text: c.open?.step.text ?? "" })),
      checksActionable: (ops?.checks ?? [])
        .filter((c) => !c.open || ["call", "pass_prenote", "ask_amount"].includes(c.open.step.kind))
        .map((c) => ({ payee: c.payee, text: c.open ? c.open.step.text : "No check started yet. Start a prenote or test credit." })),
      reviewsOverdue: (ops?.reviews ?? []).filter((r) => r.status === "overdue").length,
      reviewsMissing: (ops?.reviews ?? []).filter((r) => r.status === "missing_date").length,
    },
    lastPayroll: run ? { id: run.id, payDate: run.pay_date, generated: Boolean(run.nacha_filename) } : null,
  };
  return { snapshot, problems, ops };
}

// ---------------------------------------------------------------------------
// R41 S6: "Don't show again" on the grey dual-approval line. site_settings
// key ach_dual_approval_note_dismissed. An unreadable value means "show it"
// (more information, never less). The dismissal lasts for the calendar year.
// ---------------------------------------------------------------------------

export async function getDualNoteDismiss(): Promise<{ dismiss: DualNoteDismiss | null; readError: string | null }> {
  if (!isSupabaseServiceConfigured) return { dismiss: null, readError: "Database is not configured." };
  try {
    const { data, error } = await createSupabaseAdminClient().from("site_settings").select("value_json").eq("key", DUAL_NOTE_DISMISS_KEY).maybeSingle();
    if (error) return { dismiss: null, readError: error.message };
    return { dismiss: normalizeDualNoteDismiss(data?.value_json ?? null), readError: null };
  } catch (e) {
    return { dismiss: null, readError: e instanceof Error ? e.message : "read failed" };
  }
}

export async function setDualNoteDismiss(value: DualNoteDismiss): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database is not configured." };
  if (!normalizeDualNoteDismiss(value)) return { ok: false, error: "That dismissal could not be read back, so it was not saved." };
  try {
    const { error } = await createSupabaseAdminClient()
      .from("site_settings")
      .upsert(
        { key: DUAL_NOTE_DISMISS_KEY, label: "ACH: dual-approval note dismissed for the year (R41 S6)", value_json: value as unknown as Record<string, unknown>, updated_by: null },
        { onConflict: "key" },
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}
