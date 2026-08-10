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
import {
  evaluatePayrollGuardrails,
  guardrailsPermitGeneration,
  type EmployeePaymentHistory,
  type GuardrailReport,
} from "@/lib/payroll/payroll-guardrails-core";
import { decryptSecret, encryptSecret } from "@/lib/security/at-rest-crypto";
import { listPlaidAccounts, listPlaidTransactions } from "@/lib/plaid/store";
import {
  toBankWithdrawals,
  type BankWithdrawal,
  type ReconcileRun,
} from "@/lib/payroll/payroll-reconcile-core";

export type AchCompanySettings = {
  destination_routing: string;
  destination_name: string;
  immediate_origin: string;
  company_name: string;
  company_id: string;
  originating_dfi: string;
  entry_description: string;
  /** Your OWN funding account at the ODFI (not written to the NACHA header). */
  company_account_number: string;
  company_account_type: "checking" | "savings";
};

const EMPTY_SETTINGS: AchCompanySettings = {
  destination_routing: "",
  destination_name: "",
  immediate_origin: "",
  company_name: "",
  company_id: "",
  originating_dfi: "",
  entry_description: "PAYROLL",
  company_account_number: "",
  company_account_type: "checking",
};

/** Read the ACH originating-company settings singleton (best-effort). */
export async function getAchCompanySettings(): Promise<AchCompanySettings> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_SETTINGS };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("ach_company_settings")
      .select("destination_routing,destination_name,immediate_origin,company_name,company_id,originating_dfi,entry_description,company_account_number,company_account_type")
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return { ...EMPTY_SETTINGS };
    const merged = { ...EMPTY_SETTINGS, ...(data as Partial<AchCompanySettings>) };
    // S-10: the funding account number is envelope-encrypted at rest (encv1:);
    // legacy plaintext passes through unchanged.
    merged.company_account_number = decryptSecret(merged.company_account_number);
    return merged;
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
  // S-10: encrypt the funding account number at rest (no-op until
  // DATA_ENCRYPTION_KEY is set; already-encrypted values pass through).
  const toStore = {
    ...input,
    company_account_number: encryptSecret(input.company_account_number),
  };
  const { error } = await admin
    .from("ach_company_settings")
    .update({ ...toStore, updated_by: actorId })
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
  // S-10: employee banking is envelope-encrypted at rest (no-op until
  // DATA_ENCRYPTION_KEY is set). Reads go through listEmployeeBanking(), the
  // dedicated payroll-only path, which decrypts.
  const { error } = await admin
    .from("employees")
    .update({
      bank_routing: banking.routing ? encryptSecret(banking.routing) : null,
      bank_account_number: banking.accountNumber ? encryptSecret(banking.accountNumber) : null,
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
  /** Guardrail columns (migration 0094). Optional so reads degrade pre-migration. */
  source_document_id?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  guardrail_override?: boolean | null;
  guardrail_override_reason?: string | null;
  created_by?: string | null;
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
  // S-10: line banking snapshots are envelope-encrypted at rest; decrypt for
  // the payroll editor + NACHA generation (legacy plaintext passes through).
  const decrypted = ((lines ?? []) as PayrollLineRow[]).map((l) => ({
    ...l,
    bank_routing: l.bank_routing ? decryptSecret(l.bank_routing) || null : null,
    bank_account_number: l.bank_account_number
      ? decryptSecret(l.bank_account_number) || null
      : null,
  }));
  return {
    run: run as PayrollRunFull,
    lines: decrypted,
  };
}

// ---------------------------------------------------------------------------
// Source documents (the uploaded payroll data a run must be tied to)
// ---------------------------------------------------------------------------
export type PayrollSourceDocRow = {
  id: string;
  label: string | null;
  file_name: string;
  mime_type: string | null;
  byte_size: number | null;
  storage_path: string | null;
  content_sha256: string | null;
  period_start: string | null;
  period_end: string | null;
  notes: string | null;
  created_at: string;
};

export async function listPayrollSourceDocuments(limit = 100): Promise<PayrollSourceDocRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("payroll_source_documents")
      .select("id,label,file_name,mime_type,byte_size,storage_path,content_sha256,period_start,period_end,notes,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as PayrollSourceDocRow[];
  } catch {
    return [];
  }
}

/** Record an uploaded payroll source document (metadata + content hash). */
export async function createPayrollSourceDocument(
  input: {
    label: string | null;
    fileName: string;
    mimeType: string | null;
    byteSize: number | null;
    storagePath: string | null;
    contentSha256: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    notes: string | null;
  },
  actorId: string | null,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("payroll_source_documents")
    .insert({
      label: input.label,
      file_name: input.fileName,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      storage_path: input.storagePath,
      content_sha256: input.contentSha256,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      notes: input.notes,
      uploaded_by: actorId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Failed to save document." };
  return { ok: true, id: (data as { id: string }).id };
}

/** Tie (or untie) a source document to a run. */
export async function setRunSourceDocument(
  runId: string,
  sourceDocumentId: string | null,
  actorId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not connected." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("payroll_runs")
    .update({ source_document_id: sourceDocumentId, updated_by: actorId })
    .eq("id", runId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
      // S-10: encrypt banking snapshots at rest (no-op until the key is set).
      bank_routing: l.routing ? encryptSecret(l.routing) : null,
      bank_account_number: l.accountNumber ? encryptSecret(l.accountNumber) : null,
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

// ---------------------------------------------------------------------------
// Guardrail fact gathering + evaluation
// ---------------------------------------------------------------------------
/**
 * Gather the recent-history facts the PURE guardrail evaluator needs, then run
 * it. Used both by the UI (to preview findings) and by generatePayrollNacha (to
 * enforce them). Degrades to "no history" if the guardrail migration/tables are
 * absent, so nothing breaks pre-migration.
 */
export async function evaluateRunGuardrails(
  runId: string,
  opts: { releaserId?: string | null } = {},
): Promise<{ report: GuardrailReport } | null> {
  if (!isSupabaseServiceConfigured) return null;
  const detail = await getPayrollRun(runId);
  if (!detail) return null;
  const admin = createSupabaseAdminClient();

  // Employees on this run.
  const empIds = Array.from(
    new Set(detail.lines.map((l) => l.employee_id).filter((x): x is string => !!x)),
  );

  // Per-employee last generated payment (from other runs' lines whose run is
  // file_generated/submitted). Best-effort — falls back to empty history.
  const history: EmployeePaymentHistory[] = [];
  try {
    for (const empId of empIds) {
      const { data } = await admin
        .from("payroll_run_lines")
        .select("net_pay_cents,bank_routing,bank_account_number,run_id,payroll_runs!inner(pay_date,status,id)")
        .eq("employee_id", empId)
        .neq("run_id", runId)
        .in("payroll_runs.status", ["file_generated", "submitted"])
        .order("payroll_runs(pay_date)", { ascending: false })
        .limit(1);
      const row = (data ?? [])[0] as
        | {
            net_pay_cents: number;
            bank_routing: string | null;
            bank_account_number: string | null;
            payroll_runs: { pay_date: string } | { pay_date: string }[];
          }
        | undefined;
      if (row) {
        const pr = Array.isArray(row.payroll_runs) ? row.payroll_runs[0] : row.payroll_runs;
        history.push({
          employeeId: empId,
          lastPaidDate: pr?.pay_date ?? null,
          lastPaidNetCents: row.net_pay_cents ?? null,
          // S-10: stored snapshots may be encrypted — decrypt so the
          // banking-change guardrail compares real values, not ciphertexts.
          lastRouting: row.bank_routing ? decryptSecret(row.bank_routing) || null : null,
          lastAccountNumber: row.bank_account_number
            ? decryptSecret(row.bank_account_number) || null
            : null,
        });
      }
    }
  } catch {
    // No guardrail history available — evaluator will treat as first payment.
  }

  // Other generated runs' pay dates (for the period-cadence block).
  let otherGeneratedRunDates: string[] = [];
  try {
    const { data } = await admin
      .from("payroll_runs")
      .select("pay_date,status,id")
      .neq("id", runId)
      .in("status", ["file_generated", "submitted"]);
    otherGeneratedRunDates = ((data ?? []) as { pay_date: string }[]).map((r) => r.pay_date);
  } catch {
    otherGeneratedRunDates = [];
  }

  const report = evaluatePayrollGuardrails({
    payDate: detail.run.pay_date,
    lines: detail.lines.map((l) => ({
      employeeId: l.employee_id ?? l.id,
      employeeName: l.employee_name,
      netPayCents: l.net_pay_cents,
      routing: l.bank_routing ?? "",
      accountNumber: l.bank_account_number ?? "",
    })),
    hasSourceDocument: !!detail.run.source_document_id,
    otherGeneratedRunDates,
    history,
    releaserIsCreator:
      !!opts.releaserId && !!detail.run.created_by && opts.releaserId === detail.run.created_by,
  });

  return { report };
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
  opts: { overrideWarnings?: boolean; overrideReason?: string | null } = {},
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

  // GUARDRAILS — the compliance gate. This enforces the owner's rules (source
  // document required; one payment per employee per two weeks; one file per
  // two-week period) plus the research-backed fraud red flags. Hard blocks can
  // never be bypassed; soft warnings require an explicit, recorded override.
  const guard = await evaluateRunGuardrails(runId, { releaserId: actorId });
  if (guard) {
    const { report } = guard;
    if (!guardrailsPermitGeneration(report, !!opts.overrideWarnings)) {
      const block = report.findings.find((f) => f.severity === "block" && !f.overridable);
      const warn = report.findings.find((f) => f.severity === "warn");
      const msg = block
        ? block.message
        : warn
          ? `${warn.message} Review the warnings and confirm the override to continue.`
          : "Payroll guardrails blocked this file.";
      return { ok: false, error: msg };
    }
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
  const nowIso = new Date().toISOString();
  await admin
    .from("payroll_runs")
    .update({
      status: "file_generated",
      nacha_filename: filename,
      generated_at: nowIso,
      // Dual control: the actor who released the file (self-approval logged).
      approved_by: actorId,
      approved_at: nowIso,
      // Record any conscious override of soft warnings.
      guardrail_override: !!opts.overrideWarnings,
      guardrail_override_reason: opts.overrideWarnings ? (opts.overrideReason ?? null) : null,
      guardrail_override_by: opts.overrideWarnings ? actorId : null,
      updated_by: actorId,
    })
    .eq("id", runId);

  return { ok: true, filename, file: built.file, totalCents: built.totalCents, entryCount: built.entryCount };
}

// ---------------------------------------------------------------------------
// P6b — payroll bank reconciliation inputs
// ---------------------------------------------------------------------------

export type PayrollReconcileInputs = {
  runs: ReconcileRun[];
  withdrawals: BankWithdrawal[];
  /** True when at least one bank account is tagged as the Main operating account. */
  hasMainAccount: boolean;
  /** Display names of the Main-role account(s), for the UI header. */
  mainAccountNames: string[];
};

/**
 * Gather everything the payroll reconciliation engine needs. Only COMPLETED
 * runs (file_generated | submitted) are reconcilable — a draft has no ACH file
 * and therefore no bank debit to match. Withdrawals come from every account
 * tagged role="main" (Michael's operating account; we support more than one
 * defensively). Returns empty/flagged inputs when the DB isn't configured or no
 * Main account is tagged, so the page shows guidance instead of crashing.
 */
export async function getPayrollReconcileInputs(
  runLimit = 200,
): Promise<PayrollReconcileInputs> {
  if (!isSupabaseServiceConfigured) {
    return { runs: [], withdrawals: [], hasMainAccount: false, mainAccountNames: [] };
  }

  const runRows = await listPayrollRuns(runLimit);
  const runs: ReconcileRun[] = runRows
    .filter((r) => r.status === "file_generated" || r.status === "submitted")
    .map((r) => ({
      runId: r.id,
      label: r.label,
      payDate: r.pay_date,
      totalNetCents: r.total_net_cents,
      status: r.status,
      entryCount: r.entry_count,
    }));

  const accounts = await listPlaidAccounts();
  const mainAccounts = accounts.filter((a) => a.role === "main" && a.active);
  const mainAccountNames = mainAccounts.map(
    (a) => a.customName ?? a.officialName ?? a.name ?? "Main account",
  );

  const withdrawals: BankWithdrawal[] = [];
  for (const acct of mainAccounts) {
    const txns = await listPlaidTransactions(acct.accountId);
    const asWithdrawals = toBankWithdrawals(
      txns.map((t) => ({
        transactionId: t.transactionId,
        amountCents: t.amountCents,
        date: t.date,
        name: t.name,
        merchantName: t.merchantName,
        pending: t.pending,
      })),
    );
    withdrawals.push(...asWithdrawals);
  }

  return {
    runs,
    withdrawals,
    hasMainAccount: mainAccounts.length > 0,
    mainAccountNames,
  };
}
