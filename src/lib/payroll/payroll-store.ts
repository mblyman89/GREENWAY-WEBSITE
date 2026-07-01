/**
 * src/lib/payroll/payroll-store.ts  (Slice B)
 *
 * Server-side persistence for manual-entry payroll → ACH. Reads/writes the
 * ach_company_settings singleton, the employees' stored banking, and
 * payroll_runs / payroll_run_lines. Uses the PURE payroll-core + nacha-core
 * for all math and file generation. All reads degrade gracefully pre-migration.
 *
 * Money is CENTS everywhere.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  validatePayrollRun,
  linesToAchEntries,
  type PayrollLineInput,
} from "@/lib/payroll/payroll-core";
import { buildNachaFile, type AchOriginator } from "@/lib/payments/nacha-core";

export type AchCompanySettings = {
  destination_routing: string;
  destination_name: string;
  immediate_origin: string;
  company_name: string;
  company_id: string;
  originating_dfi: string;
  entry_description: string;
};

const EMPTY_SETTINGS: AchCompanySettings = {
  destination_routing: "",
  destination_name: "",
  immediate_origin: "",
  company_name: "",
  company_id: "",
  originating_dfi: "",
  entry_description: "PAYROLL",
};

/** Read the ACH originating-company settings singleton (best-effort). */
export async function getAchCompanySettings(): Promise<AchCompanySettings> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_SETTINGS };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ach_company_settings")
      .select("destination_routing,destination_name,immediate_origin,company_name,company_id,originating_dfi,entry_description")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return { ...EMPTY_SETTINGS };
    return { ...EMPTY_SETTINGS, ...(data as Partial<AchCompanySettings>) };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

export async function saveAchCompanySettings(
  input: AchCompanySettings,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("ach_company_settings")
    .update({ ...input, updated_by: actorId })
    .eq("id", true);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Save (reuse) an employee's banking so it prefills next run. */
export async function saveEmployeeBanking(
  employeeId: string,
  banking: { routing: string; accountNumber: string; accountType: "checking" | "savings" },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("employees")
    .update({
      bank_routing: banking.routing || null,
      bank_account_number: banking.accountNumber || null,
      bank_account_type: banking.accountType,
    })
    .eq("id", employeeId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export type PayrollRunRow = {
  id: string;
  label: string | null;
  pay_date: string;
  status: string;
  total_net_cents: number;
  entry_count: number;
  nacha_filename: string | null;
  generated_at: string | null;
  created_at: string;
};

export async function listPayrollRuns(limit = 100): Promise<PayrollRunRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("payroll_runs")
      .select("id,label,pay_date,status,total_net_cents,entry_count,nacha_filename,generated_at,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as PayrollRunRow[];
  } catch {
    return [];
  }
}

export type PayrollRunFull = {
  id: string;
  label: string | null;
  pay_date: string;
  status: string;
  total_net_cents: number;
  total_gross_cents: number;
  total_taxes_cents: number;
  total_deductions_cents: number;
  entry_count: number;
  nacha_filename: string | null;
  file_id_modifier: string;
  generated_at: string | null;
  notes: string | null;
};

export type PayrollLineRow = {
  id: string;
  employee_id: string | null;
  employee_name: string;
  net_pay_cents: number;
  gross_pay_cents: number | null;
  taxes_cents: number | null;
  deductions_cents: number | null;
  bank_routing: string | null;
  bank_account_number: string | null;
  bank_account_type: "checking" | "savings" | null;
};

export type PayrollRunDetail = { run: PayrollRunFull; lines: PayrollLineRow[] } | null;

export async function getPayrollRun(runId: string): Promise<PayrollRunDetail> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data: run } = await admin
    .from("payroll_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (!run) return null;
  const { data: lines } = await admin
    .from("payroll_run_lines")
    .select("id,employee_id,employee_name,net_pay_cents,gross_pay_cents,taxes_cents,deductions_cents,bank_routing,bank_account_number,bank_account_type")
    .eq("run_id", runId)
    .order("employee_name", { ascending: true });
  return {
    run: run as PayrollRunFull,
    lines: (lines ?? []) as PayrollLineRow[],
  };
}

/** Create an empty draft run. */
export async function createPayrollRun(
  input: { label: string | null; payDate: string },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("payroll_runs")
    .insert({ label: input.label, pay_date: input.payDate, status: "draft", created_by: actorId, updated_by: actorId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to create run." };
  return { ok: true, id: (data as { id: string }).id };
}

/** Replace a run's lines with the freshly-typed values and refresh totals. */
export async function savePayrollLines(
  runId: string,
  lines: PayrollLineInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  // Wipe + reinsert (a run's line set is small; simplest correct approach).
  await admin.from("payroll_run_lines").delete().eq("run_id", runId);
  if (lines.length) {
    const rows = lines.map((l) => ({
      run_id: runId,
      employee_id: l.employeeId,
      employee_name: l.employeeName,
      net_pay_cents: l.netPayCents,
      gross_pay_cents: l.grossPayCents ?? null,
      taxes_cents: l.taxesCents ?? null,
      deductions_cents: l.deductionsCents ?? null,
      bank_routing: l.routing || null,
      bank_account_number: l.accountNumber || null,
      bank_account_type: l.accountType,
    }));
    const { error } = await admin.from("payroll_run_lines").insert(rows);
    if (error) return { ok: false, error: error.message };
  }
  const v = validatePayrollRun(lines);
  await admin
    .from("payroll_runs")
    .update({
      total_net_cents: v.totals.net,
      total_gross_cents: v.totals.gross,
      total_taxes_cents: v.totals.taxes,
      total_deductions_cents: v.totals.deductions,
      entry_count: v.totals.count,
    })
    .eq("id", runId);
  return { ok: true };
}

export type GenerateResult =
  | { ok: true; filename: string; file: string; totalCents: number; entryCount: number }
  | { ok: false; error: string };

/**
 * Build the NACHA file for a run from its saved lines + company settings.
 * Validates first; on success stamps the run status/filename. Returns the file
 * text so the download route can serve it.
 */
export async function generatePayrollNacha(
  runId: string,
  actorId: string | null,
): Promise<GenerateResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const detail = await getPayrollRun(runId);
  if (!detail) return { ok: false, error: "Payroll run not found." };
  const settings = await getAchCompanySettings();

  const lines: PayrollLineInput[] = detail.lines.map((l) => ({
    employeeId: l.employee_id ?? l.id,
    employeeName: l.employee_name,
    netPayCents: l.net_pay_cents,
    grossPayCents: l.gross_pay_cents,
    taxesCents: l.taxes_cents,
    deductionsCents: l.deductions_cents,
    accountType: (l.bank_account_type ?? "checking") as "checking" | "savings",
    routing: l.bank_routing ?? "",
    accountNumber: l.bank_account_number ?? "",
  }));

  const validation = validatePayrollRun(lines);
  if (!validation.ok) {
    const first = validation.errors[0] ?? validation.lines.flatMap((l) => l.errors)[0];
    return { ok: false, error: first ?? "Payroll run has validation errors." };
  }

  const originator: AchOriginator = {
    destinationRouting: settings.destination_routing,
    destinationName: settings.destination_name,
    immediateOrigin: settings.immediate_origin,
    companyName: settings.company_name,
    companyId: settings.company_id,
    originatingDfi: settings.originating_dfi,
  };

  const effectiveDate = new Date(`${detail.run.pay_date}T00:00:00Z`);
  const built = buildNachaFile({
    originator,
    entries: linesToAchEntries(lines),
    secCode: "PPD",
    companyEntryDescription: settings.entry_description || "PAYROLL",
    effectiveDate,
    createdAt: new Date(),
    fileIdModifier: detail.run.file_id_modifier || "A",
  });
  if (!built.ok) return { ok: false, error: built.error };

  const filename = `payroll_${detail.run.pay_date}_${runId.slice(0, 8)}.ach`;
  const admin = createSupabaseAdminClient();
  await admin
    .from("payroll_runs")
    .update({
      status: "file_generated",
      nacha_filename: filename,
      generated_at: new Date().toISOString(),
      updated_by: actorId,
    })
    .eq("id", runId);

  return { ok: true, filename, file: built.file, totalCents: built.totalCents, entryCount: built.entryCount };
}
