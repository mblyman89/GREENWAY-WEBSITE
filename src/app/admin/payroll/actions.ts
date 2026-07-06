"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { createHash } from "node:crypto";
import {
  saveEmployeeBanking,
  createPayrollRun,
  savePayrollLines,
  generatePayrollNacha,
  createPayrollSourceDocument,
  setRunSourceDocument,
} from "@/lib/payroll/payroll-store";
import { dollarsToCents, type PayrollLineInput } from "@/lib/payroll/payroll-core";

const ROOT = "/admin/payroll";

function accountType(v: FormDataEntryValue | null): "checking" | "savings" {
  return String(v ?? "checking") === "savings" ? "savings" : "checking";
}

// The originating bank / company ACH settings now live on their own Banking
// settings page (/admin/settings/banking, saveBankingSettingsAction) so they
// are shared by both payroll and vendor (AP) ACH files and can capture the
// funding account number. The old inline payroll form + saveAchSettingsAction
// were removed to keep a single write path.

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

/**
 * Upload a payroll source document AND tie it to this run in one step. The run
 * cannot generate an ACH file until it has a source document (owner's rule:
 * "block payments unless there is a source document to tie it to"). We record
 * the file's metadata + a SHA-256 content hash so the same file can be
 * recognised; the run points at the new document.
 */
export async function uploadSourceDocAction(runId: string, formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const file = formData.get("source_file");
  if (!(file instanceof File) || file.size === 0) {
    redirect(`${ROOT}/${runId}?error=${encodeURIComponent("Choose a payroll file to upload.")}`);
  }
  const f = file as File;
  const buffer = Buffer.from(await f.arrayBuffer());
  const sha = createHash("sha256").update(buffer).digest("hex");
  const label = String(formData.get("doc_label") ?? "").trim() || null;
  const periodStart = String(formData.get("period_start") ?? "").trim() || null;
  const periodEnd = String(formData.get("period_end") ?? "").trim() || null;

  const created = await createPayrollSourceDocument(
    {
      label,
      fileName: f.name,
      mimeType: f.type || null,
      byteSize: buffer.byteLength,
      storagePath: null,
      contentSha256: sha,
      periodStart,
      periodEnd,
      notes: null,
    },
    session.profile.id,
  );
  if (!created.ok) {
    redirect(`${ROOT}/${runId}?error=${encodeURIComponent(created.error)}`);
  }
  const linked = await setRunSourceDocument(runId, created.id, session.profile.id);
  await recordAudit({
    actorId: session.profile.id,
    action: "payroll.source_doc.upload",
    entityType: "payroll_run",
    entityId: runId,
    after: { file_name: f.name, bytes: buffer.byteLength, sha256: sha, document_id: created.id },
  }).catch(() => {});
  revalidatePath(`${ROOT}/${runId}`);
  redirect(
    linked.ok
      ? `${ROOT}/${runId}?msg=${encodeURIComponent("Payroll document attached. You can now generate the file.")}`
      : `${ROOT}/${runId}?error=${encodeURIComponent(linked.error)}`,
  );
}

/** Generate (or regenerate) the NACHA file for a run. Validates + enforces the
 * payroll guardrails first. Soft warnings require an explicit, recorded
 * override checkbox; hard blocks can never be bypassed. */
export async function generateRunAction(runId: string, formData: FormData): Promise<void> {
  const session = await requirePermission("settings.manage");
  const overrideWarnings = String(formData.get("override_warnings") ?? "") === "on";
  const overrideReason = String(formData.get("override_reason") ?? "").trim() || null;
  const res = await generatePayrollNacha(runId, session.profile.id, { overrideWarnings, overrideReason });
  await recordAudit({
    actorId: session.profile.id,
    action: "payroll.run.generate",
    entityType: "payroll_run",
    entityId: runId,
    after: res.ok
      ? { entryCount: res.entryCount, totalCents: res.totalCents, overrideWarnings, overrideReason }
      : { error: res.error, overrideWarnings },
  }).catch(() => {});
  revalidatePath(`${ROOT}/${runId}`);
  redirect(res.ok ? `${ROOT}/${runId}?msg=${encodeURIComponent("ACH file ready to download.")}` : `${ROOT}/${runId}?error=${encodeURIComponent(res.error)}`);
}
