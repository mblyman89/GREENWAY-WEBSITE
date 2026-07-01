"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  saveAchCompanySettings,
  saveEmployeeBanking,
  createPayrollRun,
  savePayrollLines,
  generatePayrollNacha,
  type AchCompanySettings,
} from "@/lib/payroll/payroll-store";
import { dollarsToCents, type PayrollLineInput } from "@/lib/payroll/payroll-core";

const ROOT = "/admin/payroll";

function accountType(v: FormDataEntryValue | null): "checking" | "savings" {
  return String(v ?? "checking") === "savings" ? "savings" : "checking";
}

/** Save the originating bank / company settings (Timberland via Jack Henry). */
export async function saveAchSettingsAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const input: AchCompanySettings = {
    destination_routing: String(formData.get("destination_routing") ?? "").trim(),
    destination_name: String(formData.get("destination_name") ?? "").trim(),
    immediate_origin: String(formData.get("immediate_origin") ?? "").trim(),
    company_name: String(formData.get("company_name") ?? "").trim(),
    company_id: String(formData.get("company_id") ?? "").trim(),
    originating_dfi: String(formData.get("originating_dfi") ?? "").trim(),
    entry_description: String(formData.get("entry_description") ?? "PAYROLL").trim() || "PAYROLL",
  };
  const res = await saveAchCompanySettings(input, session.profile.id);
  await recordAudit({ actorId: session.profile.id, action: "payroll.settings.save", entityType: "ach_company_settings" }).catch(() => {});
  revalidatePath(ROOT);
  redirect(res.ok ? `${ROOT}?msg=${encodeURIComponent("Bank settings saved.")}` : `${ROOT}?error=${encodeURIComponent(res.error)}`);
}

/** Create a new draft payroll run and open it. */
export async function createRunAction(formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const label = String(formData.get("label") ?? "").trim() || null;
  const payDate = String(formData.get("pay_date") ?? "").trim();
  if (!payDate) redirect(`${ROOT}?error=${encodeURIComponent("Pick a pay date.")}`);
  const res = await createPayrollRun({ label, payDate }, session.profile.id);
  if (!res.ok) redirect(`${ROOT}?error=${encodeURIComponent(res.error)}`);
  await recordAudit({ actorId: session.profile.id, action: "payroll.run.create", entityType: "payroll_run", entityId: res.id }).catch(() => {});
  redirect(`${ROOT}/${res.id}`);
}

/**
 * Save all the manually-typed lines for a run. Form fields are indexed arrays
 * keyed by employee id, e.g. net_<id>, gross_<id>, routing_<id>, etc.
 * `emp_ids` is a hidden comma-separated list of the employees on this run.
 */
export async function saveRunLinesAction(runId: string, formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const ids = String(formData.get("emp_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const lines: PayrollLineInput[] = [];
  for (const id of ids) {
    const net = dollarsToCents(String(formData.get(`net_${id}`) ?? ""));
    // Skip employees left entirely blank (no net pay typed).
    if (net == null) continue;
    const line: PayrollLineInput = {
      employeeId: id,
      employeeName: String(formData.get(`name_${id}`) ?? "").trim(),
      netPayCents: net,
      grossPayCents: dollarsToCents(String(formData.get(`gross_${id}`) ?? "")),
      taxesCents: dollarsToCents(String(formData.get(`taxes_${id}`) ?? "")),
      deductionsCents: dollarsToCents(String(formData.get(`deductions_${id}`) ?? "")),
      accountType: accountType(formData.get(`acct_type_${id}`)),
      routing: String(formData.get(`routing_${id}`) ?? "").replace(/\D/g, ""),
      accountNumber: String(formData.get(`account_${id}`) ?? "").trim(),
    };
    lines.push(line);

    // Reuse: persist this employee's banking so it prefills next time.
    if (line.routing || line.accountNumber) {
      await saveEmployeeBanking(id, {
        routing: line.routing,
        accountNumber: line.accountNumber,
        accountType: line.accountType,
      }).catch(() => {});
    }
  }

  const res = await savePayrollLines(runId, lines);
  await recordAudit({ actorId: session.profile.id, action: "payroll.run.save_lines", entityType: "payroll_run", entityId: runId, after: { lines: lines.length } }).catch(() => {});
  revalidatePath(`${ROOT}/${runId}`);
  redirect(res.ok ? `${ROOT}/${runId}?msg=${encodeURIComponent("Payroll entries saved.")}` : `${ROOT}/${runId}?error=${encodeURIComponent(res.error)}`);
}

/** Generate (or regenerate) the NACHA file for a run. Validates first. */
export async function generateRunAction(runId: string): Promise<void> {
  const session = await requirePermission("settings.manage");
  const res = await generatePayrollNacha(runId, session.profile.id);
  await recordAudit({ actorId: session.profile.id, action: "payroll.run.generate", entityType: "payroll_run", entityId: runId, after: res.ok ? { entryCount: res.entryCount, totalCents: res.totalCents } : { error: res.error } }).catch(() => {});
  revalidatePath(`${ROOT}/${runId}`);
  redirect(res.ok ? `${ROOT}/${runId}?msg=${encodeURIComponent("ACH file ready to download.")}` : `${ROOT}/${runId}?error=${encodeURIComponent(res.error)}`);
}
