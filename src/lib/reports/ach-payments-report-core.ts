/**
 * src/lib/reports/ach-payments-report-core.ts — PURE "ACH Payments" report
 * (Reports tab, owner and admin only). R41 round 9.
 *
 * WHAT MICHAEL ASKED FOR
 * One place that shows everything ACH: who was paid, when and how much; what
 * is still owed; what is still being processed at Timberland; and the exact
 * bank transactions (from the Plaid feed of the Timberland Main account) each
 * payment was matched to.
 *
 * HOW THE BANK MATCHING WORKS (no guessing about how Timberland posts)
 * The signed agreement, section 16 (mirror
 * docs/authorities/ach/timberland-ach-agreement-2026-10-09.redacted.txt line
 * 228), says: "Company authorizes Financial Institution to debit its Account
 * in the amount of each file." Our files are unbalanced (section 14, no offset
 * entry), so the bank makes the settlement debit. The mirrors do NOT say
 * whether that shows up as one line per file or one per entry. So we try both,
 * in this order, and label which one matched:
 *   1. FILE TOTAL — each released file (not voided, money > 0) against one
 *      Main-account debit in its window (effective date T+0..T+2 business
 *      days), exact amount first, else the closest within tolerance.
 *   2. PER PAYMENT — vendor payments whose file did not match by total go to
 *      the existing vendor engine (reconcileVendorPayments), dated by their
 *      file's effective date, using only the debits step 1 did not use.
 *   3. PER RUN — payroll runs with no file in the ledger (older runs) go to the
 *      existing payroll engine (reconcilePayroll) on what is left.
 * A bank debit is used at most once across all three steps.
 *
 * Plaid sign: positive amount = money out (plaid-core). Money is integer cents.
 * Dates are Pacific yyyy-mm-dd. Zero I/O here; the store hands in arrays.
 */

import { bankPostingWindow } from "@/lib/atm/atm-core";
import {
  reconcilePayroll,
  toleranceCentsFor,
  type BankWithdrawal,
} from "@/lib/payroll/payroll-reconcile-core";
import {
  reconcileVendorPayments,
  type VendorPaymentMethod,
} from "@/lib/payments/vendor-reconcile-core";
import { latestUploadAndApproval } from "@/lib/payments/timberland-deadline-core";

// ---------------------------------------------------------------- inputs ---

export type ReportFileKind = "payroll" | "vendor" | "prenote" | "micro_entry";
export type ReportFileStatus = "released" | "uploaded" | "bank_approved" | "voided";

export type ReportFile = {
  id: string;
  kind: ReportFileKind;
  /** payroll: the run id. vendor: the batch ref stamped on each payment. */
  sourceId: string;
  filename: string;
  effectiveDate: string;
  entryCount: number;
  totalCents: number;
  status: ReportFileStatus;
  releasedAt: string;
  uploadedAt: string | null;
  bankApprovedAt: string | null;
  voidedAt: string | null;
  voidedReason: string | null;
};

export type ReportPayrollRun = {
  runId: string;
  label: string | null;
  /** The payday as entered. */
  payDate: string;
  /** The bank effective date (Schedule D prior-day shift), used for matching. */
  bankDate: string;
  status: string; // draft | file_generated | submitted | void
  totalNetCents: number;
  entryCount: number;
};

export type ReportPayrollLine = { runId: string; employeeName: string; netPayCents: number };

export type ReportVendorPayment = {
  paymentId: string;
  vendorName: string;
  /** Manifest or paper-invoice number. */
  documentNumber: string;
  amountCents: number;
  /** Pacific day the payment was recorded. */
  recordedDate: string;
  method: VendorPaymentMethod;
  /** The NACHA batch stamp (= the vendor file's sourceId), if any. */
  achBatchRef: string | null;
  reference: string | null;
};

export type ReportPayable = {
  key: string;
  source: "manifest" | "noncannabis_invoice";
  vendorName: string;
  documentNumber: string;
  owedCents: number;
  paidCents: number;
  /** Pacific day the bill started (manifest accepted / invoice date), if known. */
  sinceDate: string | null;
};

export type AchReportInput = {
  todayIso: string;
  fromDate: string;
  toDate: string;
  files: ReportFile[];
  runs: ReportPayrollRun[];
  lines: ReportPayrollLine[];
  payments: ReportVendorPayment[];
  payables: ReportPayable[];
  withdrawals: BankWithdrawal[];
  hasMainAccount: boolean;
  /** Plaid available balance of the Main account(s), or null when unknown. */
  mainAvailableCents: number | null;
};

// --------------------------------------------------------------- outputs ---

/**
 * Where a file stands, in plain words:
 *   built     released here, not uploaded to Timberland yet
 *   uploaded  uploaded, not approved in the portal yet
 *   approved  approved at Timberland, the bank debit has not posted yet
 *   cleared   the bank debit posted for the exact amount
 *   off       a debit posted but the amount differs (within tolerance)
 *   missing   approved, the posting window has passed, and no debit was found
 *   voided    voided here (never sent, or cancelled)
 *   no_money  a prenote (zero dollars): nothing to match
 */
export type FileStage = "built" | "uploaded" | "approved" | "cleared" | "off" | "missing" | "voided" | "no_money";

export type MatchBasis = "file_total" | "per_payment" | "per_run";

export type BankMatch = {
  transactionId: string;
  bankDate: string;
  bankDescription: string | null;
  bankCents: number;
  expectedCents: number;
  differenceCents: number;
  basis: MatchBasis;
  /** What the debit was tied to, in words ("Payroll run Oct 23", "Vendor file x.ach (3 payments)"). */
  matchedTo: string;
  pending: boolean;
};

export type FileRow = {
  id: string;
  kind: ReportFileKind;
  filename: string;
  effectiveDate: string;
  entryCount: number;
  totalCents: number;
  status: ReportFileStatus;
  stage: FileStage;
  /** Timberland's upload-and-approve day for this file (null if not computable). */
  deadlineDay: string | null;
  /** Not yet approved at Timberland and today is past the deadline day. */
  overdue: boolean;
  /** Not yet approved at Timberland and today is the deadline day. */
  dueToday: boolean;
  match: BankMatch | null;
  windowEarliest: string;
  windowLatest: string;
  voidedReason: string | null;
};

export type PaymentStatus = "cleared" | "off" | "processing" | "missing" | "file_voided" | "outside_bank";

export type PaymentRow = {
  date: string;
  payee: string;
  payeeKind: "employee" | "vendor";
  amountCents: number;
  method: VendorPaymentMethod | "ach";
  /** File name, run label or document number: whatever ties it to a record. */
  detail: string;
  status: PaymentStatus;
  bankDate: string | null;
  bankDescription: string | null;
};

export type PayeeRow = {
  payee: string;
  payeeKind: "employee" | "vendor";
  payments: number;
  totalCents: number;
  clearedCents: number;
  processingCents: number;
  lastDate: string;
};

export type OutstandingRow = {
  key: string;
  vendorName: string;
  documentNumber: string;
  owedCents: number;
  paidCents: number;
  remainingCents: number;
  sinceDate: string | null;
  ageDays: number | null;
  bucket: AgingBucket;
};

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+" | "unknown";

export type FundingDay = { date: string; cents: number; files: number };

export type MonthTotal = { month: string; payrollCents: number; vendorCents: number };

export type AchReport = {
  files: FileRow[];
  payments: PaymentRow[];
  payees: PayeeRow[];
  bankMatches: BankMatch[];
  outstanding: OutstandingRow[];
  draftRuns: ReportPayrollRun[];
  funding: FundingDay[];
  months: MonthTotal[];
  attention: string[];
  summary: {
    /** Money in non-voided files with an effective date in the range (prenotes excluded). */
    sentCents: number;
    sentPayrollCents: number;
    sentVendorCents: number;
    /** Of that, how much the bank feed shows as posted (exact or within tolerance). */
    clearedCents: number;
    /** Every non-voided file not yet cleared, any date (built, uploaded, approved, missing). */
    processingCents: number;
    processingFiles: number;
    outstandingCents: number;
    outstandingBills: number;
    draftPayrollCents: number;
    fundingNeededCents: number;
    stageCounts: Record<FileStage, number>;
    agingCents: Record<AgingBucket, number>;
  };
};

// ---------------------------------------------------------------- helpers ---

export const FILE_WINDOW_MIN_DAYS = 0;
export const FILE_WINDOW_MAX_DAYS = 2;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function inRange(d: string, from: string, to: string): boolean {
  return ISO.test(d) && d >= from && d <= to;
}

/** Whole days from a to b (b later is positive). Null when either is not a date. */
export function daysBetween(a: string, b: string): number | null {
  if (!ISO.test(a) || !ISO.test(b)) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86_400_000);
}

export function agingBucket(ageDays: number | null): AgingBucket {
  if (ageDays === null || ageDays < 0) return "unknown";
  if (ageDays <= 30) return "0-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  return "90+";
}

function safeDeadlineDay(effective: string): string | null {
  try {
    return latestUploadAndApproval(effective).day;
  } catch {
    return null;
  }
}

type Pooled = BankWithdrawal & { used: boolean };

/** Exact amount in the window first (earliest date), else the closest within tolerance. */
export function pickDebit(pool: Pooled[], expected: number, lo: string, hi: string, tol: number): { w: Pooled; exact: boolean } | null {
  let exact: Pooled | null = null;
  let near: Pooled | null = null;
  let nearDelta = Number.POSITIVE_INFINITY;
  for (const w of pool) {
    if (w.used) continue;
    if (!(w.date >= lo && w.date <= hi)) continue;
    if (w.amountCents === expected) {
      if (exact === null || w.date < exact.date) exact = w;
      continue;
    }
    const delta = Math.abs(w.amountCents - expected);
    if (delta > tol) continue;
    if (delta < nearDelta || (delta === nearDelta && near !== null && w.date < near.date)) {
      near = w;
      nearDelta = delta;
    }
  }
  if (exact) return { w: exact, exact: true };
  if (near) return { w: near, exact: false };
  return null;
}

function emptyStageCounts(): Record<FileStage, number> {
  return { built: 0, uploaded: 0, approved: 0, cleared: 0, off: 0, missing: 0, voided: 0, no_money: 0 };
}

function emptyAging(): Record<AgingBucket, number> {
  return { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0, unknown: 0 };
}

const NOT_CLEARED: ReadonlySet<FileStage> = new Set<FileStage>(["built", "uploaded", "approved", "missing"]);

export function usd(cents: number): string {
  const neg = cents < 0;
  const a = Math.abs(Math.round(cents));
  const s = `$${Math.floor(a / 100).toLocaleString("en-US")}.${String(a % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

// ---------------------------------------------------------------- engine ---

export function buildAchReport(input: AchReportInput): AchReport {
  const { todayIso, fromDate, toDate } = input;
  const pool: Pooled[] = input.withdrawals.map((w) => ({ ...w, used: false }));
  const bankMatches: BankMatch[] = [];
  const attention: string[] = [];

  const runById = new Map(input.runs.map((r) => [r.runId, r]));

  // ---- 1. files, oldest effective first, matched by file total ----------
  const orderedFiles = [...input.files].sort((a, b) =>
    a.effectiveDate !== b.effectiveDate ? (a.effectiveDate < b.effectiveDate ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const fileRows: FileRow[] = [];
  const paymentsByBatch = new Map<string, ReportVendorPayment[]>();
  for (const p of input.payments) {
    if (!p.achBatchRef) continue;
    const list = paymentsByBatch.get(p.achBatchRef) ?? [];
    list.push(p);
    paymentsByBatch.set(p.achBatchRef, list);
  }

  for (const f of orderedFiles) {
    const win = bankPostingWindow(f.effectiveDate, FILE_WINDOW_MIN_DAYS, FILE_WINDOW_MAX_DAYS) ?? { earliest: f.effectiveDate, latest: f.effectiveDate };
    const deadlineDay = f.status === "voided" ? null : safeDeadlineDay(f.effectiveDate);
    const notApproved = f.status === "released" || f.status === "uploaded";
    const row: FileRow = {
      id: f.id,
      kind: f.kind,
      filename: f.filename,
      effectiveDate: f.effectiveDate,
      entryCount: f.entryCount,
      totalCents: f.totalCents,
      status: f.status,
      stage: "built",
      deadlineDay,
      overdue: notApproved && deadlineDay !== null && todayIso > deadlineDay,
      dueToday: notApproved && deadlineDay !== null && todayIso === deadlineDay,
      match: null,
      windowEarliest: win.earliest,
      windowLatest: win.latest,
      voidedReason: f.voidedReason,
    };
    if (f.status === "voided") {
      row.stage = "voided";
    } else if (f.kind === "prenote" || f.totalCents <= 0) {
      row.stage = "no_money";
    } else {
      const pick = pickDebit(pool, f.totalCents, win.earliest, win.latest, toleranceCentsFor(f.totalCents));
      if (pick) {
        pick.w.used = true;
        const run = f.kind === "payroll" ? runById.get(f.sourceId) : undefined;
        const n = f.kind === "vendor" ? (paymentsByBatch.get(f.sourceId)?.length ?? 0) : 0;
        const matchedTo =
          f.kind === "payroll"
            ? `Payroll ${run?.label ?? `pay date ${run?.payDate ?? f.effectiveDate}`} (${f.filename})`
            : f.kind === "vendor"
              ? `Vendor file ${f.filename} (${n} payment${n === 1 ? "" : "s"})`
              : `${f.kind} file ${f.filename}`;
        row.match = {
          transactionId: pick.w.transactionId,
          bankDate: pick.w.date,
          bankDescription: pick.w.description,
          bankCents: pick.w.amountCents,
          expectedCents: f.totalCents,
          differenceCents: pick.w.amountCents - f.totalCents,
          basis: "file_total",
          matchedTo,
          pending: pick.w.pending,
        };
        bankMatches.push(row.match);
        row.stage = pick.exact ? "cleared" : "off";
      } else if (f.status === "released") {
        row.stage = "built";
      } else if (f.status === "uploaded") {
        row.stage = "uploaded";
      } else {
        row.stage = todayIso <= win.latest ? "approved" : "missing";
      }
    }
    fileRows.push(row);
  }
  const fileBySource = new Map<string, FileRow>();
  for (let i = 0; i < orderedFiles.length; i++) {
    const f = orderedFiles[i];
    if (f.status !== "voided") fileBySource.set(`${f.kind}:${f.sourceId}`, fileRows[i]);
  }
  const voidedSources = new Set(orderedFiles.filter((f) => f.status === "voided").map((f) => `${f.kind}:${f.sourceId}`));

  // ---- 2. vendor payments: per payment when the file total did not match --
  const paymentRows: PaymentRow[] = [];
  const perPaymentInput: { rec: ReportVendorPayment; date: string }[] = [];
  for (const p of input.payments) {
    const file = p.achBatchRef ? fileBySource.get(`vendor:${p.achBatchRef}`) : undefined;
    const fileVoided = !file && p.achBatchRef ? voidedSources.has(`vendor:${p.achBatchRef}`) : false;
    if (fileVoided) {
      paymentRows.push({
        date: p.recordedDate,
        payee: p.vendorName,
        payeeKind: "vendor",
        amountCents: p.amountCents,
        method: p.method,
        detail: p.documentNumber,
        status: "file_voided",
        bankDate: null,
        bankDescription: null,
      });
      continue;
    }
    if (file && file.match) {
      paymentRows.push({
        date: file.effectiveDate,
        payee: p.vendorName,
        payeeKind: "vendor",
        amountCents: p.amountCents,
        method: p.method,
        detail: `${p.documentNumber} · ${file.filename}`,
        status: file.stage === "cleared" ? "cleared" : "off",
        bankDate: file.match.bankDate,
        bankDescription: file.match.bankDescription,
      });
      continue;
    }
    perPaymentInput.push({ rec: p, date: file ? file.effectiveDate : p.recordedDate });
  }
  const vendorResult = reconcileVendorPayments(
    perPaymentInput.map(({ rec, date }) => ({
      paymentId: rec.paymentId,
      vendorName: rec.vendorName,
      manifestNumber: rec.documentNumber,
      amountCents: rec.amountCents,
      paidDate: date,
      method: rec.method,
      reference: rec.reference ?? rec.achBatchRef,
    })),
    pool.filter((w) => !w.used).map(({ used: _u, ...w }) => w),
    { todayIso },
  );
  const usedIds = new Set<string>();
  const vendorById = new Map(perPaymentInput.map((x) => [x.rec.paymentId, x]));
  for (const m of vendorResult.payments) {
    const src = vendorById.get(m.paymentId)!;
    const file = src.rec.achBatchRef ? fileBySource.get(`vendor:${src.rec.achBatchRef}`) : undefined;
    if (m.matchedTransactionId) {
      usedIds.add(m.matchedTransactionId);
      const bm: BankMatch = {
        transactionId: m.matchedTransactionId,
        bankDate: m.matchedDate ?? "",
        bankDescription: m.matchedDescription,
        bankCents: m.matchedCents ?? 0,
        expectedCents: m.expectedCents,
        differenceCents: m.differenceCents ?? 0,
        basis: "per_payment",
        matchedTo: `Vendor payment to ${m.vendorName} (${m.manifestNumber})`,
        pending: pool.find((w) => w.transactionId === m.matchedTransactionId)?.pending ?? false,
      };
      bankMatches.push(bm);
    }
    let status: PaymentStatus;
    if (m.status === "matched") status = "cleared";
    else if (m.status === "mismatch") status = "off";
    else if (m.status === "unmatched") status = file && (file.stage === "built" || file.stage === "uploaded") ? "processing" : "missing";
    else status = "processing";
    paymentRows.push({
      date: m.paidDate,
      payee: m.vendorName,
      payeeKind: "vendor",
      amountCents: m.expectedCents,
      method: m.method,
      detail: file ? `${m.manifestNumber} · ${file.filename}` : m.manifestNumber,
      status,
      bankDate: m.matchedDate,
      bankDescription: m.matchedDescription,
    });
  }
  for (const o of vendorResult.otherMethodPayments) {
    paymentRows.push({
      date: o.paidDate,
      payee: o.vendorName,
      payeeKind: "vendor",
      amountCents: o.amountCents,
      method: o.method,
      detail: o.manifestNumber,
      status: "outside_bank",
      bankDate: null,
      bankDescription: null,
    });
  }
  for (const w of pool) if (usedIds.has(w.transactionId)) w.used = true;

  // A vendor file whose payments all cleared one by one is cleared too.
  for (const row of fileRows) {
    if (row.kind !== "vendor" || row.match || row.stage === "voided" || row.stage === "no_money") continue;
    const src = orderedFiles.find((f) => f.id === row.id)!;
    const mine = paymentRows.filter((p) => p.payeeKind === "vendor" && p.detail.endsWith(` · ${row.filename}`));
    const expected = (paymentsByBatch.get(src.sourceId) ?? []).length;
    if (expected > 0 && mine.length === expected && mine.every((p) => p.status === "cleared" || p.status === "off")) {
      row.stage = mine.every((p) => p.status === "cleared") ? "cleared" : "off";
    }
  }

  // ---- 3. payroll: per line, file first, else the run engine ------------
  const linesByRun = new Map<string, ReportPayrollLine[]>();
  for (const l of input.lines) {
    const list = linesByRun.get(l.runId) ?? [];
    list.push(l);
    linesByRun.set(l.runId, list);
  }
  const paidRuns = input.runs.filter((r) => r.status === "file_generated" || r.status === "submitted");
  const legacyRuns = paidRuns.filter((r) => !fileBySource.has(`payroll:${r.runId}`));
  const payrollResult = reconcilePayroll(
    legacyRuns.map((r) => ({ runId: r.runId, label: r.label, payDate: r.bankDate, totalNetCents: r.totalNetCents, status: r.status, entryCount: r.entryCount })),
    pool.filter((w) => !w.used).map(({ used: _u, ...w }) => w),
    { todayIso },
  );
  const legacyById = new Map(payrollResult.runs.map((m) => [m.runId, m]));
  for (const m of payrollResult.runs) {
    if (!m.matchedTransactionId) continue;
    const w = pool.find((x) => x.transactionId === m.matchedTransactionId);
    if (w) w.used = true;
    bankMatches.push({
      transactionId: m.matchedTransactionId,
      bankDate: m.matchedDate ?? "",
      bankDescription: m.matchedDescription,
      bankCents: m.matchedCents ?? 0,
      expectedCents: m.expectedCents,
      differenceCents: m.differenceCents ?? 0,
      basis: "per_run",
      matchedTo: `Payroll ${m.label ?? `pay date ${m.payDate}`} (no ledger file)`,
      pending: w?.pending ?? false,
    });
  }
  for (const r of paidRuns) {
    const file = fileBySource.get(`payroll:${r.runId}`);
    const legacy = legacyById.get(r.runId);
    let status: PaymentStatus;
    let bankDate: string | null = null;
    let bankDescription: string | null = null;
    if (file) {
      status = file.stage === "cleared" ? "cleared" : file.stage === "off" ? "off" : file.stage === "missing" ? "missing" : "processing";
      bankDate = file.match?.bankDate ?? null;
      bankDescription = file.match?.bankDescription ?? null;
    } else if (legacy) {
      status = legacy.status === "matched" ? "cleared" : legacy.status === "mismatch" ? "off" : legacy.status === "unmatched" ? "missing" : "processing";
      bankDate = legacy.matchedDate;
      bankDescription = legacy.matchedDescription;
    } else {
      status = "processing"; // zero-dollar run: the engine skips it
    }
    const label = r.label ?? `Payroll ${r.payDate}`;
    for (const l of linesByRun.get(r.runId) ?? []) {
      paymentRows.push({
        date: r.bankDate,
        payee: l.employeeName,
        payeeKind: "employee",
        amountCents: l.netPayCents,
        method: "ach",
        detail: label,
        status,
        bankDate,
        bankDescription,
      });
    }
  }

  // ---- payees and range filter -------------------------------------------
  const inWindow = paymentRows.filter((p) => inRange(p.date, fromDate, toDate));
  inWindow.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.payee.localeCompare(b.payee)));
  const payeeMap = new Map<string, PayeeRow>();
  for (const p of inWindow) {
    if (p.status === "file_voided") continue;
    const k = `${p.payeeKind}:${p.payee}`;
    const cur = payeeMap.get(k) ?? { payee: p.payee, payeeKind: p.payeeKind, payments: 0, totalCents: 0, clearedCents: 0, processingCents: 0, lastDate: p.date };
    cur.payments += 1;
    cur.totalCents += p.amountCents;
    if (p.status === "cleared" || p.status === "off") cur.clearedCents += p.amountCents;
    if (p.status === "processing") cur.processingCents += p.amountCents;
    if (p.date > cur.lastDate) cur.lastDate = p.date;
    payeeMap.set(k, cur);
  }
  const payees = [...payeeMap.values()].sort((a, b) => b.totalCents - a.totalCents || a.payee.localeCompare(b.payee));

  // ---- outstanding bills ---------------------------------------------------
  const outstanding: OutstandingRow[] = [];
  const agingCents = emptyAging();
  for (const b of input.payables) {
    const remaining = b.owedCents - b.paidCents;
    if (remaining <= 0) continue;
    const ageDays = b.sinceDate ? daysBetween(b.sinceDate, todayIso) : null;
    const bucket = agingBucket(ageDays);
    agingCents[bucket] += remaining;
    outstanding.push({ key: b.key, vendorName: b.vendorName, documentNumber: b.documentNumber, owedCents: b.owedCents, paidCents: b.paidCents, remainingCents: remaining, sinceDate: b.sinceDate, ageDays, bucket });
  }
  outstanding.sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1) || b.remainingCents - a.remainingCents);
  const draftRuns = input.runs.filter((r) => r.status === "draft").sort((a, b) => (a.payDate < b.payDate ? -1 : 1));

  // ---- funding calendar (agreement section 14: funds by 9:00 a.m. on the settlement date)
  const fundingMap = new Map<string, FundingDay>();
  for (const r of fileRows) {
    if (!NOT_CLEARED.has(r.stage) || r.stage === "missing") continue;
    if (r.effectiveDate < todayIso) continue;
    const cur = fundingMap.get(r.effectiveDate) ?? { date: r.effectiveDate, cents: 0, files: 0 };
    cur.cents += r.totalCents;
    cur.files += 1;
    fundingMap.set(r.effectiveDate, cur);
  }
  const funding = [...fundingMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  const fundingNeededCents = funding.reduce((s, d) => s + d.cents, 0);

  // ---- months (range only, by effective date) ----------------------------
  const monthMap = new Map<string, MonthTotal>();
  let sentPayrollCents = 0;
  let sentVendorCents = 0;
  let clearedCents = 0;
  for (const r of fileRows) {
    if (r.stage === "voided" || r.stage === "no_money") continue;
    if (!inRange(r.effectiveDate, fromDate, toDate)) continue;
    const m = r.effectiveDate.slice(0, 7);
    const cur = monthMap.get(m) ?? { month: m, payrollCents: 0, vendorCents: 0 };
    if (r.kind === "payroll") {
      cur.payrollCents += r.totalCents;
      sentPayrollCents += r.totalCents;
    } else {
      cur.vendorCents += r.totalCents;
      sentVendorCents += r.totalCents;
    }
    if (r.stage === "cleared" || r.stage === "off") clearedCents += r.totalCents;
    monthMap.set(m, cur);
  }
  const months = [...monthMap.values()].sort((a, b) => (a.month < b.month ? -1 : 1));

  // ---- summary -------------------------------------------------------------
  const stageCounts = emptyStageCounts();
  let processingCents = 0;
  let processingFiles = 0;
  for (const r of fileRows) {
    stageCounts[r.stage] += 1;
    if (NOT_CLEARED.has(r.stage)) {
      processingCents += r.totalCents;
      processingFiles += 1;
    }
  }
  const outstandingCents = outstanding.reduce((s, o) => s + o.remainingCents, 0);
  const draftPayrollCents = draftRuns.reduce((s, r) => s + Math.max(0, r.totalNetCents), 0);

  // ---- what needs attention (most serious first) -------------------------
  if (!input.hasMainAccount) attention.push("No bank account is tagged as the Main account in Plaid, so nothing can be matched to the bank. Tag it under Finances > Accounts.");
  for (const r of fileRows) if (r.stage === "missing") attention.push(`${r.filename}: approved at Timberland for ${r.effectiveDate}, but no ${usd(r.totalCents)} debit showed up by ${r.windowLatest}. Check the Timberland portal and your statement.`);
  for (const r of fileRows) if (r.overdue) attention.push(`${r.filename}: not approved at Timberland and the deadline (${r.deadlineDay}, 4:00 pm Pacific) has passed. Void it and build a new one with a later date.`);
  for (const r of fileRows) if (r.dueToday) attention.push(`${r.filename}: must be uploaded and approved at Timberland today by 4:00 pm Pacific.`);
  for (const r of fileRows) if (r.stage === "off" && r.match) attention.push(`${r.filename}: the bank debit was ${usd(r.match.bankCents)}, the file was ${usd(r.totalCents)} (difference ${usd(r.match.differenceCents)}).`);
  const voidedPaid = paymentRows.filter((p) => p.status === "file_voided");
  if (voidedPaid.length > 0) attention.push(`${voidedPaid.length} vendor payment record(s) belong to a voided file (${usd(voidedPaid.reduce((s, p) => s + p.amountCents, 0))}). Those bills still show as paid; check them on Accounts Payable.`);
  const missingPays = paymentRows.filter((p) => p.status === "missing").length;
  if (missingPays > 0) attention.push(`${missingPays} payment(s) are past their posting window with no matching bank debit.`);
  if (input.mainAvailableCents !== null && fundingNeededCents > input.mainAvailableCents) {
    attention.push(`Files waiting to settle total ${usd(fundingNeededCents)}, but the Main account shows ${usd(input.mainAvailableCents)} available. Funds must be there by 9:00 a.m. on each settlement date (agreement section 14).`);
  }

  bankMatches.sort((a, b) => (a.bankDate < b.bankDate ? 1 : a.bankDate > b.bankDate ? -1 : 0));
  fileRows.sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0));

  return {
    files: fileRows,
    payments: inWindow,
    payees,
    bankMatches,
    outstanding,
    draftRuns,
    funding,
    months,
    attention,
    summary: {
      sentCents: sentPayrollCents + sentVendorCents,
      sentPayrollCents,
      sentVendorCents,
      clearedCents,
      processingCents,
      processingFiles,
      outstandingCents,
      outstandingBills: outstanding.length,
      draftPayrollCents,
      fundingNeededCents,
      stageCounts,
      agingCents,
    },
  };
}

export const FILE_STAGE_LABEL: Record<FileStage, string> = {
  built: "Built, not uploaded",
  uploaded: "Uploaded, not approved",
  approved: "Approved, waiting for the bank",
  cleared: "Cleared",
  off: "Cleared, amount differs",
  missing: "No bank debit found",
  voided: "Voided",
  no_money: "Prenote (no money)",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  cleared: "Cleared",
  off: "Cleared, amount differs",
  processing: "Processing",
  missing: "No bank debit found",
  file_voided: "File voided",
  outside_bank: "Paid outside the bank feed",
};

// ------------------------------------------------------------- self-tests ---

export function __runAchPaymentsReportCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, n: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  FAIL ach-payments-report-core: ${n}`);
    }
  };

  const file = (o: Partial<ReportFile> & { id: string }): ReportFile => ({
    kind: "payroll",
    sourceId: "run-1",
    filename: `${o.id}.ach`,
    effectiveDate: "2026-10-23",
    entryCount: 2,
    totalCents: 250_000,
    status: "bank_approved",
    releasedAt: "2026-10-20T18:00:00Z",
    uploadedAt: null,
    bankApprovedAt: null,
    voidedAt: null,
    voidedReason: null,
    ...o,
  });
  const wd = (id: string, cents: number, date: string, desc = "ACH SETTLEMENT"): BankWithdrawal => ({ transactionId: id, amountCents: cents, date, description: desc, pending: false });
  const run = (o: Partial<ReportPayrollRun> & { runId: string }): ReportPayrollRun => ({ label: null, payDate: "2026-10-23", bankDate: "2026-10-23", status: "file_generated", totalNetCents: 250_000, entryCount: 2, ...o });
  const base = (o: Partial<AchReportInput>): AchReportInput => ({
    todayIso: "2026-10-30",
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    files: [],
    runs: [],
    lines: [],
    payments: [],
    payables: [],
    withdrawals: [],
    hasMainAccount: true,
    mainAvailableCents: null,
    ...o,
  });

  // helpers
  ok(daysBetween("2026-10-01", "2026-10-31") === 30, "daysBetween 30");
  ok(daysBetween("2026-10-31", "2026-10-01") === -30, "daysBetween negative");
  ok(daysBetween("x", "2026-10-01") === null, "daysBetween bad date");
  ok(agingBucket(0) === "0-30" && agingBucket(30) === "0-30", "aging 0-30 inclusive");
  ok(agingBucket(31) === "31-60" && agingBucket(60) === "31-60", "aging 31-60");
  ok(agingBucket(61) === "61-90" && agingBucket(90) === "61-90", "aging 61-90");
  ok(agingBucket(91) === "90+", "aging 90+");
  ok(agingBucket(null) === "unknown" && agingBucket(-1) === "unknown", "aging unknown");
  ok(inRange("2026-10-01", "2026-10-01", "2026-10-31") && inRange("2026-10-31", "2026-10-01", "2026-10-31"), "inRange inclusive");
  ok(!inRange("2026-11-01", "2026-10-01", "2026-10-31") && !inRange("bad", "a", "z"), "inRange excludes");
  ok(usd(123456) === "$1,234.56" && usd(-500) === "-$5.00" && usd(7) === "$0.07", "usd format");

  // 1. payroll file cleared by file total; lines become cleared payee rows
  {
    const r = buildAchReport(
      base({
        files: [file({ id: "f1" })],
        runs: [run({ runId: "run-1", label: "Oct 23" })],
        lines: [
          { runId: "run-1", employeeName: "A. Worker", netPayCents: 150_000 },
          { runId: "run-1", employeeName: "B. Worker", netPayCents: 100_000 },
        ],
        withdrawals: [wd("t1", 250_000, "2026-10-23")],
      }),
    );
    ok(r.files[0].stage === "cleared", "payroll file cleared");
    ok(r.files[0].match?.basis === "file_total" && r.files[0].match?.transactionId === "t1", "file-total basis and txn");
    ok(r.bankMatches.length === 1 && r.bankMatches[0].matchedTo.includes("Oct 23"), "bank match names the run");
    ok(r.payments.length === 2 && r.payments.every((p) => p.status === "cleared" && p.bankDate === "2026-10-23"), "lines cleared with bank date");
    ok(r.payees[0].payee === "A. Worker" && r.payees[0].clearedCents === 150_000, "payee sorted by total, cleared cents");
    ok(r.summary.sentPayrollCents === 250_000 && r.summary.clearedCents === 250_000, "sent and cleared totals");
    ok(r.summary.processingFiles === 0 && r.attention.length === 0, "nothing processing, no attention");
  }

  // 2. a debit outside T+0..T+2 is not used; window passed => missing
  {
    const r = buildAchReport(base({ files: [file({ id: "f1" })], withdrawals: [wd("t1", 250_000, "2026-10-28")] }));
    ok(r.files[0].windowLatest === "2026-10-27", "window ends T+2 business days");
    ok(r.files[0].stage === "missing", "approved, window passed, no debit => missing");
    ok(r.attention.some((a) => a.includes("no $2,500.00 debit")), "missing file in attention");
    ok(r.summary.processingFiles === 1 && r.summary.processingCents === 250_000, "missing counts as not cleared");
  }

  // 3. approved and still in window => approved (waiting), not missing
  {
    const r = buildAchReport(base({ todayIso: "2026-10-26", files: [file({ id: "f1" })] }));
    ok(r.files[0].stage === "approved", "approved in window => waiting");
  }

  // 4. released / uploaded stages, deadline flags
  {
    const r = buildAchReport(
      base({
        todayIso: "2026-10-21",
        files: [file({ id: "rel", status: "released", sourceId: "a" }), file({ id: "up", status: "uploaded", sourceId: "b", effectiveDate: "2026-10-26" })],
      }),
    );
    const rel = r.files.find((f) => f.id === "rel")!;
    const up = r.files.find((f) => f.id === "up")!;
    ok(rel.stage === "built" && up.stage === "uploaded", "built and uploaded stages");
    ok(rel.deadlineDay === "2026-10-21" && rel.dueToday && !rel.overdue, "due today on the deadline day");
    ok(up.deadlineDay === "2026-10-22" && !up.dueToday && !up.overdue, "not due yet");
    ok(r.attention.some((a) => a.includes("today by 4:00 pm Pacific")), "due-today attention");
    ok(r.funding.length === 2 && r.summary.fundingNeededCents === 500_000, "funding calendar sums upcoming files");
  }
  {
    const r = buildAchReport(base({ todayIso: "2026-10-22", files: [file({ id: "rel", status: "released" })] }));
    ok(r.files[0].overdue && !r.files[0].dueToday, "overdue the day after the deadline");
    ok(r.attention.some((a) => a.includes("deadline") && a.includes("has passed")), "overdue attention");
  }
  {
    const r = buildAchReport(base({ todayIso: "2026-10-22", files: [file({ id: "ok", status: "bank_approved" })] }));
    ok(!r.files[0].overdue && !r.files[0].dueToday, "approved files are never overdue");
  }

  // 5. tolerance: close amount => off; far amount => not matched
  {
    const r = buildAchReport(base({ files: [file({ id: "f1" })], withdrawals: [wd("t1", 250_300, "2026-10-23")] }));
    ok(r.files[0].stage === "off" && r.files[0].match?.differenceCents === 300, "within tolerance => off, signed diff");
    ok(r.attention.some((a) => a.includes("difference $3.00")), "off in attention");
    const r2 = buildAchReport(base({ files: [file({ id: "f1" })], withdrawals: [wd("t1", 4_000, "2026-10-23")] }));
    ok(r2.files[0].match === null, "a $40 fee never matches a $2,500 file");
  }

  // 6. exact preferred over closer-dated near; one debit used once
  {
    const r = buildAchReport(
      base({
        files: [file({ id: "a", sourceId: "r1" }), file({ id: "b", sourceId: "r2" })],
        withdrawals: [wd("near", 250_100, "2026-10-23"), wd("exact", 250_000, "2026-10-26")],
      }),
    );
    const a = r.files.find((f) => f.id === "a")!;
    const b = r.files.find((f) => f.id === "b")!;
    ok(a.match?.transactionId === "exact" && a.stage === "cleared", "exact beats near");
    ok(b.match?.transactionId === "near" && b.stage === "off", "second file takes the other debit");
    ok(new Set(r.bankMatches.map((m) => m.transactionId)).size === r.bankMatches.length, "no debit used twice");
  }

  // 7. voided and prenote files
  {
    const r = buildAchReport(
      base({
        files: [file({ id: "v", status: "voided", voidedReason: "wrong amount typed" }), file({ id: "p", kind: "prenote", totalCents: 0, sourceId: "pn" })],
        withdrawals: [wd("t1", 250_000, "2026-10-23")],
      }),
    );
    ok(r.files.find((f) => f.id === "v")!.stage === "voided", "voided stage");
    ok(r.files.find((f) => f.id === "v")!.match === null, "voided file never matched");
    ok(r.files.find((f) => f.id === "p")!.stage === "no_money", "prenote no money");
    ok(r.summary.sentCents === 0, "voided and prenote are not sent money");
    ok(r.files.find((f) => f.id === "v")!.deadlineDay === null, "voided has no deadline");
  }

  // 8. vendor file matched by total => each payment cleared
  {
    const pay = (id: string, cents: number): ReportVendorPayment => ({ paymentId: id, vendorName: `Vendor ${id}`, documentNumber: `M-${id}`, amountCents: cents, recordedDate: "2026-10-20", method: "ach", achBatchRef: "vb1", reference: null });
    const r = buildAchReport(
      base({
        files: [file({ id: "vf", kind: "vendor", sourceId: "vb1", totalCents: 30_000, effectiveDate: "2026-10-23" })],
        payments: [pay("1", 10_000), pay("2", 20_000)],
        withdrawals: [wd("t1", 30_000, "2026-10-23")],
      }),
    );
    ok(r.files[0].stage === "cleared" && r.files[0].match?.matchedTo.includes("2 payments"), "vendor file total match");
    ok(r.payments.length === 2 && r.payments.every((p) => p.status === "cleared" && p.date === "2026-10-23"), "vendor payments cleared, dated by effective date");
    ok(r.summary.sentVendorCents === 30_000, "vendor sent total");
  }

  // 9. vendor file posted per entry => per-payment fallback clears payments and the file
  {
    const pay = (id: string, cents: number): ReportVendorPayment => ({ paymentId: id, vendorName: `Vendor ${id}`, documentNumber: `M-${id}`, amountCents: cents, recordedDate: "2026-10-20", method: "ach", achBatchRef: "vb1", reference: null });
    const r = buildAchReport(
      base({
        files: [file({ id: "vf", kind: "vendor", sourceId: "vb1", totalCents: 300_000 })],
        payments: [pay("1", 100_000), pay("2", 200_000)],
        withdrawals: [wd("t1", 100_000, "2026-10-23"), wd("t2", 200_000, "2026-10-23")],
      }),
    );
    ok(r.files[0].match === null, "no single debit for the file total");
    ok(r.payments.every((p) => p.status === "cleared"), "each payment matched per payment");
    ok(r.bankMatches.length === 2 && r.bankMatches.every((m) => m.basis === "per_payment"), "per-payment basis shown");
    ok(r.files[0].stage === "cleared", "file cleared when every payment cleared");
  }

  // 10. payments of a voided file are flagged, not counted as paid
  {
    const r = buildAchReport(
      base({
        files: [file({ id: "vf", kind: "vendor", sourceId: "vb1", status: "voided", voidedReason: "duplicate file sent" })],
        payments: [{ paymentId: "1", vendorName: "V", documentNumber: "M-1", amountCents: 5_000, recordedDate: "2026-10-20", method: "ach", achBatchRef: "vb1", reference: null }],
      }),
    );
    ok(r.payments[0].status === "file_voided", "payment of voided file flagged");
    ok(r.payees.length === 0, "voided-file payment not in payee totals");
    ok(r.attention.some((a) => a.includes("voided file")), "voided-file payments in attention");
  }

  // 11. check/cash payments shown as outside the bank feed
  {
    const r = buildAchReport(base({ payments: [{ paymentId: "c", vendorName: "Cash V", documentNumber: "M-9", amountCents: 7_000, recordedDate: "2026-10-05", method: "cash", achBatchRef: null, reference: null }] }));
    ok(r.payments.length === 1 && r.payments[0].status === "outside_bank", "cash payment outside bank");
    ok(r.payees[0].totalCents === 7_000 && r.payees[0].clearedCents === 0, "counted as paid, not cleared");
  }

  // 12. legacy payroll run (no ledger file) matched per run
  {
    const r = buildAchReport(
      base({
        runs: [run({ runId: "old", label: "Sep 25", payDate: "2026-10-09", bankDate: "2026-10-09", totalNetCents: 90_000 })],
        lines: [{ runId: "old", employeeName: "C. Worker", netPayCents: 90_000 }],
        withdrawals: [wd("t9", 90_000, "2026-10-09")],
      }),
    );
    ok(r.bankMatches.length === 1 && r.bankMatches[0].basis === "per_run", "per-run basis for a run with no file");
    ok(r.payments[0].status === "cleared", "legacy run lines cleared");
  }

  // 13. a debit used by a file is not reused by a legacy run
  {
    const r = buildAchReport(
      base({
        files: [file({ id: "f1", sourceId: "run-1" })],
        runs: [run({ runId: "run-1" }), run({ runId: "legacy" })],
        withdrawals: [wd("t1", 250_000, "2026-10-23")],
      }),
    );
    ok(r.bankMatches.length === 1 && r.bankMatches[0].basis === "file_total", "legacy run cannot take the file's debit");
  }

  // 14. range filter applies to payments and sent totals, not to processing/outstanding
  {
    const r = buildAchReport(
      base({
        fromDate: "2026-11-01",
        toDate: "2026-11-30",
        todayIso: "2026-10-21",
        files: [file({ id: "f1", status: "released" })],
        runs: [run({ runId: "run-1" })],
        lines: [{ runId: "run-1", employeeName: "A", netPayCents: 250_000 }],
        payables: [{ key: "m1", source: "manifest", vendorName: "V", documentNumber: "M1", owedCents: 10_000, paidCents: 0, sinceDate: "2026-10-01" }],
      }),
    );
    ok(r.payments.length === 0 && r.summary.sentCents === 0, "out-of-range payments and totals excluded");
    ok(r.summary.processingFiles === 1 && r.summary.outstandingCents === 10_000, "processing and outstanding are current, not ranged");
  }

  // 15. outstanding bills, aging, sort, drafts
  {
    const r = buildAchReport(
      base({
        payables: [
          { key: "a", source: "manifest", vendorName: "A", documentNumber: "1", owedCents: 10_000, paidCents: 4_000, sinceDate: "2026-10-20" },
          { key: "b", source: "noncannabis_invoice", vendorName: "B", documentNumber: "2", owedCents: 5_000, paidCents: 0, sinceDate: "2026-07-01" },
          { key: "c", source: "manifest", vendorName: "C", documentNumber: "3", owedCents: 5_000, paidCents: 5_000, sinceDate: "2026-07-01" },
          { key: "d", source: "manifest", vendorName: "D", documentNumber: "4", owedCents: 1_000, paidCents: 0, sinceDate: null },
        ],
        runs: [run({ runId: "d1", status: "draft", totalNetCents: 80_000 })],
      }),
    );
    ok(r.outstanding.length === 3, "fully paid bills dropped");
    ok(r.outstanding[0].key === "b" && r.outstanding[0].bucket === "90+", "oldest first, 90+ bucket");
    ok(r.outstanding.find((o) => o.key === "a")!.remainingCents === 6_000, "remaining = owed - paid");
    ok(r.summary.agingCents["0-30"] === 6_000 && r.summary.agingCents["90+"] === 5_000 && r.summary.agingCents.unknown === 1_000, "aging totals");
    ok(r.summary.outstandingCents === 12_000 && r.summary.outstandingBills === 3, "outstanding totals");
    ok(r.draftRuns.length === 1 && r.summary.draftPayrollCents === 80_000, "draft payroll not yet sent");
  }

  // 16. funding shortfall and no-main-account warnings
  {
    const r = buildAchReport(base({ todayIso: "2026-10-21", files: [file({ id: "f1", status: "uploaded" })], mainAvailableCents: 100_000 }));
    ok(r.attention.some((a) => a.includes("9:00 a.m.")), "funding shortfall warned");
    const r2 = buildAchReport(base({ todayIso: "2026-10-21", files: [file({ id: "f1", status: "uploaded" })], mainAvailableCents: 250_000 }));
    ok(!r2.attention.some((a) => a.includes("9:00 a.m.")), "exactly enough is not short");
    const r3 = buildAchReport(base({ hasMainAccount: false }));
    ok(r3.attention[0].includes("Main account"), "no main account warned first");
  }

  // 17. months trend
  {
    const r = buildAchReport(
      base({
        fromDate: "2026-09-01",
        files: [file({ id: "a", sourceId: "r1", effectiveDate: "2026-09-25" }), file({ id: "b", kind: "vendor", sourceId: "vb", effectiveDate: "2026-10-09", totalCents: 1_000 })],
      }),
    );
    ok(r.months.length === 2 && r.months[0].month === "2026-09" && r.months[0].payrollCents === 250_000 && r.months[1].vendorCents === 1_000, "monthly totals by effective month");
  }

  return { passed, failed };
}
