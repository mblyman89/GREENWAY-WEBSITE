/**
 * Employee product loans (Register S5) — database access.
 * Table employee_product_loans (0302); N-day policy in site_settings.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn } from "@/lib/supabase/chunked-in";
import { DEFAULT_LOAN_DEDUCT_DAYS, canSettle, type LoanStatus } from "@/lib/pos/employee-loan-core";

export const LOAN_POLICY_KEY = "employee_loan_policy";

export async function getLoanDeductDays(): Promise<number> {
  if (!isSupabaseServiceConfigured) return DEFAULT_LOAN_DEDUCT_DAYS;
  try {
    const { data } = await createSupabaseAdminClient()
      .from("site_settings")
      .select("value_json")
      .eq("key", LOAN_POLICY_KEY)
      .maybeSingle();
    const n = (data?.value_json as { deductDays?: unknown } | null)?.deductDays;
    return Number.isInteger(n) && (n as number) > 0 ? (n as number) : DEFAULT_LOAN_DEDUCT_DAYS;
  } catch {
    return DEFAULT_LOAN_DEDUCT_DAYS;
  }
}

export async function setLoanDeductDays(days: number, byId: string | null): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return "Database is not configured.";
  const { error } = await createSupabaseAdminClient()
    .from("site_settings")
    .upsert(
      {
        key: LOAN_POLICY_KEY,
        label: "Employee tabs: deduct unpaid product loans from pay after N days (Register S5)",
        value_json: { deductDays: days },
        updated_by: byId,
      },
      { onConflict: "key" },
    );
  return error ? error.message : null;
}

export type OpenLoanInput = {
  clientUuid: string;
  orderId: string;
  employeeId: string;
  cashierId: string | null;
  witnessId: string | null;
  registerId: string | null;
  amountMinor: number;
  ackText: string;
  takenAtIso: string;
};

/** Idempotent on client_uuid (a sync retry never opens a second loan). */
export async function openEmployeeLoan(i: OpenLoanInput): Promise<string | null> {
  const { error } = await createSupabaseAdminClient()
    .from("employee_product_loans")
    .upsert(
      {
        client_uuid: i.clientUuid,
        order_id: i.orderId,
        employee_id: i.employeeId,
        cashier_id: i.cashierId,
        witness_id: i.witnessId,
        register_id: i.registerId,
        amount_minor: i.amountMinor,
        ack_text: i.ackText,
        taken_at: i.takenAtIso,
      },
      { onConflict: "client_uuid", ignoreDuplicates: true },
    );
  if (!error) return null;
  return /relation .*employee_product_loans.* does not exist|42P01/i.test(`${error.code} ${error.message}`)
    ? "employee_product_loans table missing — apply migration 0302."
    : error.message;
}

export type LoanListRow = {
  id: string;
  employee_id: string;
  order_id: string | null;
  amount_minor: number;
  status: LoanStatus;
  taken_at: string;
  settled_at: string | null;
  settle_note: string | null;
  witness_id: string | null;
};

export async function listEmployeeLoans(): Promise<{ rows: LoanListRow[]; migrationMissing: boolean }> {
  if (!isSupabaseServiceConfigured) return { rows: [], migrationMissing: false };
  const { data, error } = await createSupabaseAdminClient()
    .from("employee_product_loans")
    .select("id, employee_id, order_id, amount_minor, status, taken_at, settled_at, settle_note, witness_id")
    .order("taken_at", { ascending: false })
    .limit(2000);
  if (error) return { rows: [], migrationMissing: /does not exist|42P01/i.test(`${error.code} ${error.message}`) };
  return { rows: (data ?? []) as LoanListRow[], migrationMissing: false };
}

export async function settleEmployeeLoan(
  id: string,
  to: LoanStatus,
  byId: string | null,
  note: string | null,
): Promise<{ ok: true; before: LoanListRow } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from("employee_product_loans")
    .select("id, employee_id, order_id, amount_minor, status, taken_at, settled_at, settle_note, witness_id")
    .eq("id", id)
    .maybeSingle<LoanListRow>();
  if (!row) return { ok: false, error: "Loan not found." };
  if (!canSettle(row.status, to)) return { ok: false, error: `A ${row.status} loan cannot be marked ${to}.` };
  const { error } = await admin
    .from("employee_product_loans")
    .update({ status: to, settled_at: new Date().toISOString(), settled_by: byId, settle_note: note })
    .eq("id", id)
    .eq("status", "open");
  return error ? { ok: false, error: error.message } : { ok: true, before: row };
}

export async function employeeNames(ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length || !isSupabaseServiceConfigured) return out;
  const found = await chunkedIn(uniq, async (chunk) => {
    const { data } = await createSupabaseAdminClient().from("employees").select("id, full_name").in("id", chunk);
    return (data as { id: string; full_name: string | null }[] | null) ?? [];
  });
  for (const r of found) out[r.id] = r.full_name?.trim() || "Employee";
  return out;
}
