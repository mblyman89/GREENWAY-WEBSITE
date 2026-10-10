/**
 * R39 S3 — read employees' split-deposit plans (ach_authorizations +
 * ach_authorization_accounts, migration 0258) for payroll.
 *
 * Server-only: decrypts account numbers. Returns:
 *   - tableReady: false before 0258 is applied (payroll then uses the single
 *     account on each employee record and SAYS so — planPayrollEntries notes).
 *   - plans: the ONE open authorization per employee (0258 enforces one open
 *     per employee: ach_auth_one_open_per_employee) with its live accounts.
 *
 * Revoked / archived authorizations are ignored (they are history). A draft,
 * signed, verifying or on-hold authorization IS returned, so payroll blocks
 * that employee with the reason instead of quietly paying the old account.
 * Any read error other than "table missing" throws (rule 48: a check that
 * cannot run must fail, not pass).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { decryptSecret } from "@/lib/security/at-rest-crypto";
import { rowsToDepositPlans, type DepositAuthRow, type DepositAcctRow, type EmployeeDepositPlan } from "@/lib/payroll/payroll-core";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist|could not find the table/i.test(error.message ?? "")
  );
}

export async function listEmployeeDepositPlans(
  employeeIds: readonly string[],
): Promise<{ tableReady: boolean; plans: Map<string, EmployeeDepositPlan> }> {
  const ids = Array.from(new Set(employeeIds.filter(Boolean)));
  if (!isSupabaseServiceConfigured || ids.length === 0) return { tableReady: false, plans: new Map() };
  const admin = createSupabaseAdminClient();
  const auths = await admin
    .from("ach_authorizations")
    .select("id,employee_id,state")
    .eq("payee_type", "employee")
    .in("employee_id", ids)
    .not("state", "in", "(revoked,archived)");
  if (auths.error) {
    if (isMissingTable(auths.error)) return { tableReady: false, plans: new Map() };
    throw new Error(`ach_authorizations read failed: ${auths.error.message}`);
  }
  const authRows = (auths.data as DepositAuthRow[] | null) ?? [];
  if (authRows.length === 0) return { tableReady: true, plans: new Map() };
  const accts = await admin
    .from("ach_authorization_accounts")
    .select("authorization_id,priority,rule_kind,fixed_cents,basis_points,routing_enc,account_enc,account_type,verification_status")
    .in("authorization_id", authRows.map((a) => a.id))
    .is("archived_at", null);
  if (accts.error) throw new Error(`ach_authorization_accounts read failed: ${accts.error.message}`);
  return { tableReady: true, plans: rowsToDepositPlans(authRows, (accts.data as DepositAcctRow[] | null) ?? [], (s) => decryptSecret(s)) };
}

export type EmployeeAuthHistoryRow = {
  id: string;
  state: string;
  signed_on: string | null;
  ended_on: string | null;
  ended_reason: string | null;
  signature_method: string | null;
};

/**
 * R39 S4 — one employee's ACH picture for their file page: the open plan (same
 * read as payroll) and the revoked / archived authorizations kept for the
 * record (owner Q11: shown behind a button). Throws on real read errors.
 */
export async function getEmployeeAchOverview(
  employeeId: string,
): Promise<{ tableReady: boolean; plan: EmployeeDepositPlan | null; history: EmployeeAuthHistoryRow[] }> {
  const open = await listEmployeeDepositPlans([employeeId]);
  if (!open.tableReady) return { tableReady: false, plan: null, history: [] };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("ach_authorizations")
    .select("id,state,signed_on,ended_on,ended_reason,signature_method")
    .eq("payee_type", "employee")
    .eq("employee_id", employeeId)
    .in("state", ["revoked", "archived"])
    .order("ended_on", { ascending: false, nullsFirst: false });
  if (error) throw new Error(`ach_authorizations history read failed: ${error.message}`);
  return { tableReady: true, plan: open.plans.get(employeeId) ?? null, history: (data as EmployeeAuthHistoryRow[] | null) ?? [] };
}
