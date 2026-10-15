/**
 * src/lib/reports/ach-payments-report-store.ts — reads for the ACH Payments
 * report (owner and admin only). R41 round 9.
 *
 * Every read is checked. Unlike the older list helpers (which return [] on a
 * database error), a failed read here is REPORTED to the page as a problem:
 * an empty list after an error would look like "nothing owed / nothing
 * missing", and silence is never "all clear" (AGENTS.md rule 46). The page
 * still renders what did load, with the problems on top.
 *
 * Never reads ach_files.body_enc (the bytes) or any bank account number: the
 * report needs amounts, dates, names and statuses only.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey } from "@/lib/reports/timezone";
import { creditEffectiveDateFor } from "@/lib/payments/timberland-deadline-core";
import { toBankWithdrawals, type BankWithdrawal } from "@/lib/payroll/payroll-reconcile-core";
import type { VendorPaymentMethod } from "@/lib/payments/vendor-reconcile-core";
import { PAYABLE_MANIFEST_STATUSES } from "@/lib/payments/vendor-ach-core";
import { NOT_MIGRATION_OR, PAYLOAD_KIND_SELECT, withoutMigrationManifests } from "@/lib/accounting/migration-stock-core";
import type {
  AchReportInput,
  ReportFile,
  ReportFileKind,
  ReportFileStatus,
  ReportPayable,
  ReportPayrollLine,
  ReportPayrollRun,
  ReportVendorPayment,
} from "@/lib/reports/ach-payments-report-core";

/** Row caps: big enough for years of a small shop; hitting one is reported. */
export const REPORT_CAPS = { files: 1000, runs: 500, lines: 5000, payments: 3000, manifests: 1000, invoices: 1000, txnsPerAccount: 2000 } as const;

const FILE_KINDS: ReadonlySet<string> = new Set(["payroll", "vendor", "prenote", "micro_entry"]);
const FILE_STATUSES: ReadonlySet<string> = new Set(["released", "uploaded", "bank_approved", "voided"]);
const METHODS: ReadonlySet<string> = new Set(["ach", "check", "cash", "wire", "other"]);

function method(raw: unknown): VendorPaymentMethod {
  const m = String(raw ?? "ach").trim().toLowerCase();
  return (METHODS.has(m) ? m : "other") as VendorPaymentMethod;
}

function bankDate(payDate: string): string {
  try {
    return creditEffectiveDateFor(payDate);
  } catch {
    return payDate;
  }
}

function cents(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export type AchReportLoad = { input: Omit<AchReportInput, "todayIso" | "fromDate" | "toDate">; problems: string[]; mainAccountNames: string[]; tableReady: boolean };

export async function loadAchReportInputs(): Promise<AchReportLoad> {
  const empty: AchReportLoad = {
    input: { files: [], runs: [], lines: [], payments: [], payables: [], withdrawals: [], hasMainAccount: false, mainAvailableCents: null },
    problems: [],
    mainAccountNames: [],
    tableReady: false,
  };
  if (!isSupabaseServiceConfigured) return { ...empty, problems: ["The database is not connected."] };
  const db = createSupabaseAdminClient();
  const problems: string[] = [];
  const capHit = (what: string, n: number, cap: number) => {
    if (n > cap) problems.push(`More than ${cap} ${what} were found; only the newest ${cap} are shown, so older totals may be short.`);
  };

  const [filesQ, runsQ, paysQ, manQ, invQ, acctQ] = await Promise.all([
    db
      .from("ach_files")
      .select("id, kind, source_id, filename, effective_date, entry_count, total_cents, status, released_at, uploaded_at, approved_at_bank_at, voided_at, voided_reason")
      .order("effective_date", { ascending: false })
      .limit(REPORT_CAPS.files + 1),
    db.from("payroll_runs").select("id, label, pay_date, status, total_net_cents, entry_count").order("pay_date", { ascending: false }).limit(REPORT_CAPS.runs + 1),
    db
      .from("vendor_manifest_payments")
      .select("id, vendor_name, manifest_number, amount_minor_units, payment_method, ach_batch_ref, reference, created_at")
      .order("created_at", { ascending: false })
      .limit(REPORT_CAPS.payments + 1),
    db
      .from("inbound_manifests")
      .select(`id, manifest_number, vendor_id, vendor_label, status, accepted_at, ${PAYLOAD_KIND_SELECT}`)
      .in("status", Array.from(PAYABLE_MANIFEST_STATUSES))
      .or(NOT_MIGRATION_OR)
      .order("accepted_at", { ascending: false, nullsFirst: false })
      .limit(REPORT_CAPS.manifests + 1),
    db.from("noncannabis_invoices").select("id, invoice_number, vendor_name, invoice_date, total_minor_units, status").eq("status", "open").limit(REPORT_CAPS.invoices + 1),
    db.from("plaid_accounts").select("account_id, name, official_name, custom_name, role, active, available_balance_cents"),
  ]);

  // ---- files
  let tableReady = true;
  const files: ReportFile[] = [];
  if (filesQ.error) {
    const msg = filesQ.error.message ?? "";
    if (/ach_files/.test(msg) && /does not exist|schema cache/.test(msg)) tableReady = false;
    else problems.push("The ACH file list could not be read, so files in process are not shown.");
  } else {
    const rows = (filesQ.data ?? []) as Record<string, unknown>[];
    capHit("ACH files", rows.length, REPORT_CAPS.files);
    let bad = 0;
    for (const r of rows.slice(0, REPORT_CAPS.files)) {
      if (typeof r.id !== "string" || !FILE_KINDS.has(String(r.kind)) || !FILE_STATUSES.has(String(r.status)) || typeof r.effective_date !== "string") {
        bad++;
        continue;
      }
      files.push({
        id: r.id,
        kind: r.kind as ReportFileKind,
        sourceId: String(r.source_id ?? ""),
        filename: String(r.filename ?? ""),
        effectiveDate: r.effective_date,
        entryCount: cents(r.entry_count),
        totalCents: cents(r.total_cents),
        status: r.status as ReportFileStatus,
        releasedAt: String(r.released_at ?? ""),
        uploadedAt: (r.uploaded_at as string | null) ?? null,
        bankApprovedAt: (r.approved_at_bank_at as string | null) ?? null,
        voidedAt: (r.voided_at as string | null) ?? null,
        voidedReason: (r.voided_reason as string | null) ?? null,
      });
    }
    if (bad > 0) problems.push(`${bad} ACH file row(s) could not be read and are left out.`);
  }

  // ---- payroll runs and their lines (names and net pay only)
  const runs: ReportPayrollRun[] = [];
  const lines: ReportPayrollLine[] = [];
  if (runsQ.error) {
    problems.push("Payroll runs could not be read, so employee payments are not shown.");
  } else {
    const rows = (runsQ.data ?? []) as Record<string, unknown>[];
    capHit("payroll runs", rows.length, REPORT_CAPS.runs);
    for (const r of rows.slice(0, REPORT_CAPS.runs)) {
      if (typeof r.id !== "string" || typeof r.pay_date !== "string") continue;
      runs.push({
        runId: r.id,
        label: (r.label as string | null) ?? null,
        payDate: r.pay_date,
        bankDate: bankDate(r.pay_date),
        status: String(r.status ?? ""),
        totalNetCents: cents(r.total_net_cents),
        entryCount: cents(r.entry_count),
      });
    }
    const paidIds = runs.filter((r) => r.status === "file_generated" || r.status === "submitted").map((r) => r.runId);
    if (paidIds.length > 0) {
      const lq = await db.from("payroll_run_lines").select("run_id, employee_name, net_pay_cents").in("run_id", paidIds).limit(REPORT_CAPS.lines + 1);
      if (lq.error) problems.push("Payroll lines could not be read, so who was paid in each run is not shown.");
      else {
        const lrows = (lq.data ?? []) as Record<string, unknown>[];
        capHit("payroll lines", lrows.length, REPORT_CAPS.lines);
        for (const l of lrows.slice(0, REPORT_CAPS.lines)) {
          if (typeof l.run_id !== "string") continue;
          lines.push({ runId: l.run_id, employeeName: String(l.employee_name ?? "Employee"), netPayCents: cents(l.net_pay_cents) });
        }
      }
    }
  }

  // ---- vendor payments
  const payments: ReportVendorPayment[] = [];
  if (paysQ.error) {
    problems.push("Vendor payments could not be read, so vendor payments are not shown.");
  } else {
    const rows = (paysQ.data ?? []) as Record<string, unknown>[];
    capHit("vendor payments", rows.length, REPORT_CAPS.payments);
    for (const p of rows.slice(0, REPORT_CAPS.payments)) {
      if (typeof p.id !== "string" || typeof p.created_at !== "string") continue;
      payments.push({
        paymentId: p.id,
        vendorName: String(p.vendor_name ?? "") || "Unknown vendor",
        documentNumber: String(p.manifest_number ?? ""),
        amountCents: cents(p.amount_minor_units),
        recordedDate: pacificDayKey(p.created_at),
        method: method(p.payment_method),
        achBatchRef: (p.ach_batch_ref as string | null) ?? null,
        reference: (p.reference as string | null) ?? null,
      });
    }
  }

  // ---- outstanding bills (manifests: owed from lots; invoices: total), minus paid
  const payables: ReportPayable[] = [];
  if (manQ.error) {
    problems.push("Vendor manifests could not be read, so what is still owed is not complete.");
  } else {
    const mrowsAll = (manQ.data ?? []) as { id: string; manifest_number: string | null; vendor_id: string | null; vendor_label: string | null; status: string; accepted_at: string | null; payload_kind?: string | null }[];
    capHit("open manifests", mrowsAll.length, REPORT_CAPS.manifests);
    const mrows = withoutMigrationManifests(mrowsAll.slice(0, REPORT_CAPS.manifests));
    if (mrows.length > 0) {
      const ids = mrows.map((m) => m.id);
      const [lotsQ, mpQ, vQ] = await Promise.all([
        db.from("inventory_lots").select("manifest_id, received_qty, unit_cost_minor_units, status").in("manifest_id", ids),
        db.from("vendor_manifest_payments").select("manifest_id, amount_minor_units").in("manifest_id", ids),
        db.from("vendors").select("id, display_name").in("id", Array.from(new Set(mrows.map((m) => m.vendor_id).filter(Boolean))) as string[]),
      ]);
      if (lotsQ.error || mpQ.error) {
        problems.push("Lot costs or payments for manifests could not be read, so what is still owed is not shown for manifests.");
      } else {
        const owed = new Map<string, number>();
        for (const l of (lotsQ.data ?? []) as Record<string, unknown>[]) {
          if (typeof l.manifest_id !== "string" || l.status === "rejected") continue;
          const qty = Number(l.received_qty);
          const unit = Number(l.unit_cost_minor_units);
          if (!Number.isFinite(qty) || !Number.isFinite(unit)) continue;
          owed.set(l.manifest_id, (owed.get(l.manifest_id) ?? 0) + Math.round(qty * unit));
        }
        const paid = new Map<string, number>();
        for (const p of (mpQ.data ?? []) as Record<string, unknown>[]) {
          if (typeof p.manifest_id !== "string") continue;
          paid.set(p.manifest_id, (paid.get(p.manifest_id) ?? 0) + cents(p.amount_minor_units));
        }
        const names = new Map<string, string>();
        if (!vQ.error) for (const v of (vQ.data ?? []) as { id: string; display_name: string | null }[]) if (v.display_name) names.set(v.id, v.display_name);
        for (const m of mrows) {
          payables.push({
            key: `manifest:${m.id}`,
            source: "manifest",
            vendorName: (m.vendor_id ? names.get(m.vendor_id) : null) || m.vendor_label || "Unknown vendor",
            documentNumber: m.manifest_number || m.id,
            owedCents: owed.get(m.id) ?? 0,
            paidCents: paid.get(m.id) ?? 0,
            sinceDate: m.accepted_at ? pacificDayKey(m.accepted_at) : null,
          });
        }
      }
    }
  }
  if (invQ.error) {
    const msg = invQ.error.message ?? "";
    if (!(/noncannabis_invoices/.test(msg) && /does not exist|schema cache/.test(msg))) problems.push("Paper invoices could not be read, so what is still owed is not complete.");
  } else {
    const irows = (invQ.data ?? []) as Record<string, unknown>[];
    capHit("open paper invoices", irows.length, REPORT_CAPS.invoices);
    const kept = irows.slice(0, REPORT_CAPS.invoices).filter((i) => typeof i.id === "string");
    if (kept.length > 0) {
      const ipQ = await db.from("vendor_manifest_payments").select("noncannabis_invoice_id, amount_minor_units").in("noncannabis_invoice_id", kept.map((i) => i.id as string));
      if (ipQ.error) problems.push("Payments on paper invoices could not be read, so what is still owed is not shown for them.");
      else {
        const paid = new Map<string, number>();
        for (const p of (ipQ.data ?? []) as Record<string, unknown>[]) {
          if (typeof p.noncannabis_invoice_id !== "string") continue;
          paid.set(p.noncannabis_invoice_id, (paid.get(p.noncannabis_invoice_id) ?? 0) + cents(p.amount_minor_units));
        }
        for (const i of kept) {
          payables.push({
            key: `ncinv:${i.id as string}`,
            source: "noncannabis_invoice",
            vendorName: String(i.vendor_name ?? "") || "Unknown vendor",
            documentNumber: String(i.invoice_number ?? ""),
            owedCents: cents(i.total_minor_units),
            paidCents: paid.get(i.id as string) ?? 0,
            sinceDate: typeof i.invoice_date === "string" ? i.invoice_date.slice(0, 10) : null,
          });
        }
      }
    }
  }

  // ---- Plaid: Main account(s) money out
  const withdrawals: BankWithdrawal[] = [];
  const mainAccountNames: string[] = [];
  let hasMainAccount = false;
  let mainAvailableCents: number | null = null;
  if (acctQ.error) {
    problems.push("The bank accounts (Plaid) could not be read, so nothing is matched to the bank.");
  } else {
    const mains = ((acctQ.data ?? []) as Record<string, unknown>[]).filter((a) => a.role === "main" && a.active !== false && typeof a.account_id === "string");
    hasMainAccount = mains.length > 0;
    let avail = 0;
    let availKnown = mains.length > 0;
    for (const a of mains) {
      mainAccountNames.push(String(a.custom_name ?? a.official_name ?? a.name ?? "Main account"));
      if (a.available_balance_cents === null || a.available_balance_cents === undefined) availKnown = false;
      else avail += cents(a.available_balance_cents);
      const tq = await db
        .from("plaid_transactions")
        .select("transaction_id, amount_cents, date, name, merchant_name, pending")
        .eq("account_id", a.account_id as string)
        .eq("removed", false)
        .order("date", { ascending: false })
        .limit(REPORT_CAPS.txnsPerAccount + 1);
      if (tq.error) {
        problems.push(`Bank transactions for ${mainAccountNames[mainAccountNames.length - 1]} could not be read, so matches may be missing.`);
        continue;
      }
      const trows = (tq.data ?? []) as Record<string, unknown>[];
      capHit("bank transactions", trows.length, REPORT_CAPS.txnsPerAccount);
      withdrawals.push(
        ...toBankWithdrawals(
          trows.slice(0, REPORT_CAPS.txnsPerAccount).map((t) => ({
            transactionId: String(t.transaction_id),
            amountCents: cents(t.amount_cents),
            date: String(t.date),
            name: (t.name as string | null) ?? null,
            merchantName: (t.merchant_name as string | null) ?? null,
            pending: !!t.pending,
          })),
        ),
      );
    }
    mainAvailableCents = availKnown ? avail : null;
  }

  return { input: { files, runs, lines, payments, payables, withdrawals, hasMainAccount, mainAvailableCents }, problems, mainAccountNames, tableReady };
}
