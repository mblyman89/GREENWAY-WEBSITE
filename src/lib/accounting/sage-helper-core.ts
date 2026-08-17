/**
 * src/lib/accounting/sage-helper-core.ts  (Slice 56)
 *
 * PURE helpers for the Sage 50 helper: uploaded-report parsing (light aggregate
 * extraction) + the grounded Sage 50 AI system prompt. No I/O — tsx-unit-testable.
 *
 * The knowledge the AI is grounded on lives in docs/sage50-knowledge.md; the
 * canonical facts are mirrored here as SAGE50_KNOWLEDGE so the assistant answers
 * from verified Sage documentation and never guesses.
 */

/** Accepted report file kinds (a .ptb Sage backup is explicitly NOT accepted). */
export const SAGE_REPORT_KINDS = [
  { value: "chart_of_accounts", label: "Sage Chart of Accounts (CHART.CSV)" },
  { value: "cultivera_sales", label: "Cultivera — sales export" },
  { value: "cultivera_inventory", label: "Cultivera — inventory export" },
  { value: "pos_summary", label: "POS daily summary" },
  { value: "gl_export", label: "Sage GL export (CSV)" },
  { value: "trial_balance", label: "Trial balance export" },
  { value: "aged_payables", label: "Aged Payables (open vendor invoices)" },
  { value: "other", label: "Other report" },
] as const;

/**
 * Sage 50 Account Type codes (VERIFIED — official Sage 50 help, Chart of
 * Accounts Import/Export fields). Used to interpret an uploaded CHART.CSV.
 */
export const SAGE_ACCOUNT_TYPES: Record<number, string> = {
  0: "Cash",
  1: "Accounts Receivable",
  2: "Inventory",
  3: "Receivable Retainage",
  4: "Other Current Assets",
  5: "Fixed Assets",
  6: "Accumulated Depreciation",
  8: "Other Assets",
  10: "Accounts Payable",
  11: "Payable Retainage",
  12: "Other Current Liabilities",
  14: "Long Term Liabilities",
  16: "Equity-doesn't close",
  18: "Equity-Retained Earnings",
  19: "Equity-gets closed",
  21: "Income",
  23: "Cost of Sales",
  24: "Expenses",
};

export function sageAccountTypeLabel(code: number | null | undefined): string {
  if (code == null) return "Unknown";
  return SAGE_ACCOUNT_TYPES[code] ?? `Type ${code}`;
}

export type SageReportKind = (typeof SAGE_REPORT_KINDS)[number]["value"];

export function isSageReportKind(v: string): v is SageReportKind {
  return SAGE_REPORT_KINDS.some((k) => k.value === v);
}

export function sageReportKindLabel(v: string | null | undefined): string {
  return SAGE_REPORT_KINDS.find((k) => k.value === v)?.label ?? "Other report";
}

/** File extensions we accept for upload. */
export const SAGE_ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls", ".pdf", ".txt"] as const;
/** Extensions we explicitly reject (proprietary Sage backup). */
export const SAGE_REJECTED_EXTENSIONS = [".ptb"] as const;

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function isRejectedSageFile(name: string): boolean {
  return SAGE_REJECTED_EXTENSIONS.includes(fileExtension(name) as (typeof SAGE_REJECTED_EXTENSIONS)[number]);
}

export function isAcceptedSageFile(name: string): boolean {
  return SAGE_ACCEPTED_EXTENSIONS.includes(fileExtension(name) as (typeof SAGE_ACCEPTED_EXTENSIONS)[number]);
}

// ---------------------------------------------------------------------------
// CSV aggregate extraction (no PII stored — headers + counts + numeric totals).
// ---------------------------------------------------------------------------

/** Minimal RFC-4180-ish CSV row splitter (handles quoted commas + escaped quotes). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQ = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export type CsvColumnStat = {
  header: string;
  /** True when every non-empty value in the column parses as a number. */
  numeric: boolean;
  /** Sum of numeric values (only when numeric). */
  total: number | null;
  /** Count of non-empty values. */
  filled: number;
};

export type SageUploadSummary = {
  format: "csv" | "non-csv";
  rowCount: number;
  columnCount: number;
  columns: CsvColumnStat[];
  /** Columns that look monetary/numeric with their totals, for AI mapping hints. */
  numericTotals: { header: string; total: number }[];
  note?: string;
  /** Kind-aware findings (e.g. trial-balance tie-out) — see analyzeUploadByKind. */
  analysis?: string[];
};

/** Parse a plausibly-numeric cell (strips $ , and surrounding spaces). */
export function parseNumericCell(v: string): number | null {
  const t = v.trim().replace(/[$,]/g, "");
  if (t === "") return null;
  const neg = /^\(.*\)$/.test(t); // accounting negatives (1.00)
  const body = neg ? t.slice(1, -1) : t;
  const n = Number(body);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

/**
 * Extract an aggregate summary from a CSV text: header names, row count, and a
 * per-column numeric total when the column is fully numeric. Caps the rows it
 * scans so a huge file can't blow up memory; the cap is reported in `note`.
 */
export function summarizeCsv(text: string, maxRows = 50_000): SageUploadSummary {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { format: "csv", rowCount: 0, columnCount: 0, columns: [], numericTotals: [], note: "Empty file." };
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const dataLines = lines.slice(1);
  const scanned = dataLines.slice(0, maxRows);

  const stats: CsvColumnStat[] = headers.map((h) => ({ header: h, numeric: true, total: 0, filled: 0 }));
  for (const line of scanned) {
    const cells = splitCsvLine(line);
    for (let c = 0; c < headers.length; c += 1) {
      const raw = (cells[c] ?? "").trim();
      if (raw === "") continue;
      stats[c].filled += 1;
      const n = parseNumericCell(raw);
      if (n == null) {
        stats[c].numeric = false;
      } else if (stats[c].numeric) {
        stats[c].total = (stats[c].total ?? 0) + n;
      }
    }
  }
  // Finalize: a column with zero filled values is not "numeric with a total".
  for (const s of stats) {
    if (!s.numeric || s.filled === 0) s.total = null;
  }
  const numericTotals = stats
    .filter((s) => s.numeric && s.filled > 0 && s.total != null)
    .map((s) => ({ header: s.header, total: Math.round((s.total as number) * 100) / 100 }));

  return {
    format: "csv",
    rowCount: dataLines.length,
    columnCount: headers.length,
    columns: stats,
    numericTotals,
    note: dataLines.length > maxRows ? `Scanned first ${maxRows} of ${dataLines.length} rows for totals.` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Chart of Accounts (CHART.CSV) parsing + GL-mapping validation
// ---------------------------------------------------------------------------

export type ChartAccount = {
  id: string; // Account ID (≤15 chars)
  description: string; // Account Description (≤30 chars)
  /** Sage Account Type code (0..24) when detected, else null. */
  typeCode: number | null;
  typeLabel: string;
  inactive: boolean;
};

export type ChartOfAccountsParse = {
  ok: boolean;
  accounts: ChartAccount[];
  /** IDs only, for fast membership checks. */
  ids: string[];
  /** Non-fatal notes (e.g. header not recognized -> fell back to positions). */
  warnings: string[];
  rowCount: number;
};

/** Case-insensitive header locator that tolerates spaces/underscores. */
function findHeaderIndex(headers: string[], candidates: string[]): number {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, " ");
  const wanted = candidates.map(norm);
  for (let i = 0; i < headers.length; i += 1) {
    if (wanted.includes(norm(headers[i]))) return i;
  }
  return -1;
}

function toBool(v: string): boolean {
  const t = v.trim().toLowerCase();
  return t === "true" || t === "yes" || t === "1" || t === "[true]" || t === "y";
}

/**
 * Parse a Sage 50 Chart of Accounts export (CHART.CSV). VERIFIED field order:
 * Account ID, Account Description, Account Type, Inactive, ... We locate columns
 * by header when a header row is present; otherwise fall back to the first four
 * canonical positions. Only the import-relevant fields are extracted.
 */
export function parseChartOfAccounts(text: string, maxRows = 100_000): ChartOfAccountsParse {
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  const warnings: string[] = [];
  if (lines.length === 0) {
    return { ok: false, accounts: [], ids: [], warnings: ["Empty file."], rowCount: 0 };
  }

  const firstCells = splitCsvLine(lines[0]).map((c) => c.trim());
  const idxId = findHeaderIndex(firstCells, ["Account ID", "Account Id", "ID"]);
  const hasHeader = idxId >= 0;

  let iId = 0;
  let iDesc = 1;
  let iType = 2;
  let iInactive = 3;
  let dataLines = lines;

  if (hasHeader) {
    iId = idxId;
    iDesc = findHeaderIndex(firstCells, ["Account Description", "Description"]);
    iType = findHeaderIndex(firstCells, ["Account Type", "Type"]);
    iInactive = findHeaderIndex(firstCells, ["Inactive"]);
    dataLines = lines.slice(1);
    if (iDesc < 0) iDesc = 1;
  } else {
    warnings.push("No header row detected — read columns by canonical position (ID, Description, Type, Inactive).");
  }

  const accounts: ChartAccount[] = [];
  const seen = new Set<string>();
  for (const line of dataLines.slice(0, maxRows)) {
    const cells = splitCsvLine(line);
    const id = (cells[iId] ?? "").trim();
    if (!id) continue;
    const description = iDesc >= 0 ? (cells[iDesc] ?? "").trim() : "";
    let typeCode: number | null = null;
    if (iType >= 0) {
      const raw = (cells[iType] ?? "").trim();
      const n = Number(raw);
      if (raw !== "" && Number.isInteger(n)) typeCode = n;
    }
    const inactive = iInactive >= 0 ? toBool(cells[iInactive] ?? "") : false;
    if (seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    accounts.push({ id, description, typeCode, typeLabel: sageAccountTypeLabel(typeCode), inactive });
  }

  return {
    ok: accounts.length > 0,
    accounts,
    ids: accounts.map((a) => a.id),
    warnings,
    rowCount: dataLines.length,
  };
}

export type GlMappingCheck = {
  /** Which store mapping this is (label + the account id it points at). */
  label: string;
  accountId: string;
  /** Present in the uploaded CoA? */
  exists: boolean;
  /** If present, is it marked inactive in the CoA? */
  inactive: boolean;
  /** The CoA description when found. */
  description?: string;
  typeLabel?: string;
};

export type GlValidationResult = {
  checks: GlMappingCheck[];
  missing: GlMappingCheck[];
  inactive: GlMappingCheck[];
  allValid: boolean;
};

/**
 * Cross-check the store's configured GL account mappings against an uploaded
 * Chart of Accounts. This is the grounding: Sage REQUIRES that every G/L
 * account used in an import already exist in the CoA, so we flag any mapping
 * that points at an account not present (or marked inactive) in the CoA.
 *
 * `mappings` is a flat list of {label, accountId} the caller derives from the
 * AccountingSettings (empty account ids are skipped).
 */
export function validateGlMappingAgainstCoa(
  mappings: { label: string; accountId: string }[],
  coa: ChartOfAccountsParse,
): GlValidationResult {
  const byId = new Map<string, ChartAccount>();
  for (const a of coa.accounts) byId.set(a.id.trim().toLowerCase(), a);

  const checks: GlMappingCheck[] = [];
  for (const m of mappings) {
    const id = m.accountId.trim();
    if (!id) continue;
    const found = byId.get(id.toLowerCase());
    checks.push({
      label: m.label,
      accountId: id,
      exists: Boolean(found),
      inactive: Boolean(found?.inactive),
      description: found?.description,
      typeLabel: found?.typeLabel,
    });
  }
  const missing = checks.filter((c) => !c.exists);
  const inactive = checks.filter((c) => c.exists && c.inactive);
  return { checks, missing, inactive, allValid: missing.length === 0 && inactive.length === 0 };
}

// ---------------------------------------------------------------------------
// Restructure-prep report analyzers (Trial Balance / Aged Payables) — PURE.
// Sage report exports vary by version/options, so columns are located by
// candidate headers and the parse degrades gracefully with warnings — the
// analyzers never assume a layout they can't see.
// ---------------------------------------------------------------------------

/**
 * Parse a money cell to INTEGER CENTS from its DIGITS, never through a float.
 *
 * Standing rule 13e: "FLOAT IS FORBIDDEN in money paths. Parse digits as text;
 * divide with BigInt." The trial-balance tie-out decides whether Michael's
 * beginning balances are trustworthy, so it is a money path in the strictest
 * sense and gets the strictest treatment.
 *
 * Handles: $ and thousands separators, accounting negatives "(1.00)", a
 * leading +/- sign, bare ".50", and any number of decimal places (extra places
 * are truncated toward zero, never rounded through a double).
 *
 * Returns null when the cell is not a number, so a caller can tell "absent"
 * from "zero" — the same contract parseNumericCell already offered.
 */
export function parseCentsCell(v: string): bigint | null {
  let t = v.trim().replace(/[$,\s]/g, "");
  if (t === "") return null;

  // Accounting negatives: (1.00)
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  // Explicit sign
  if (t.startsWith("-")) {
    neg = !neg;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }

  // Digits only, with at most one decimal point. Reject anything else so a
  // stray word can never be silently read as 0.
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;

  const dot = t.indexOf(".");
  const whole = dot < 0 ? t : t.slice(0, dot);
  const frac = dot < 0 ? "" : t.slice(dot + 1);

  // Pad/truncate to exactly 2 decimal places WITHOUT arithmetic.
  const cents2 = (frac + "00").slice(0, 2);
  const digits = (whole === "" ? "0" : whole) + cents2;

  // Defence in depth: the regex above should already guarantee `digits` is all
  // digits, but BigInt() THROWS on bad input rather than returning NaN. A
  // malformed cell in an uploaded Sage export must never crash the upload, so
  // this returns null (= "not a number") instead of propagating.
  let magnitude: bigint;
  try {
    magnitude = BigInt(digits);
  } catch {
    return null;
  }
  return neg ? -magnitude : magnitude;
}

/** Render integer cents as a decimal dollar string, without float division. */
export function centsToDollarString(cents: bigint): string {
  const neg = cents < BigInt("0");
  const abs = neg ? -cents : cents;
  const s = abs.toString().padStart(3, "0");
  const whole = s.slice(0, -2);
  const frac = s.slice(-2);
  // Thousands separators, applied to the digit string.
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}.${frac}`;
}

export type TrialBalanceParse = {
  ok: boolean;
  accountCount: number;
  /**
   * Totals in INTEGER CENTS (rule 13e). These are the authoritative values the
   * tie-out verdict is computed from. `bigint` so a large trial balance can
   * never lose a cent to floating-point accumulation.
   */
  totalDebitsCents: bigint;
  totalCreditsCents: bigint;
  /** debits − credits in CENTS. Exactly BigInt("0") means the TB ties out. */
  differenceCents: bigint;
  balanced: boolean;
  warnings: string[];
};

/**
 * Parse a Sage 50 Trial Balance export (CSV). Locates Account ID / Debit /
 * Credit columns by header (tolerant of "Debit Amt", "Debit Amount", …).
 * Rows without an Account ID (e.g. a Total line) are skipped so totals are
 * computed from account rows only — then debits vs credits are tied out.
 */
export function parseTrialBalance(text: string, maxRows = 100_000): TrialBalanceParse {
  const warnings: string[] = [];
  const fail = (w: string): TrialBalanceParse => ({
    ok: false, accountCount: 0, totalDebitsCents: BigInt("0"), totalCreditsCents: BigInt("0"),
    differenceCents: BigInt("0"), balanced: false, warnings: [...warnings, w],
  });
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return fail("Empty file.");

  // The header row may not be the first line (report title/date lines above it).
  let headerIdx = -1;
  let iId = -1;
  let iDebit = -1;
  let iCredit = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i += 1) {
    const cells = splitCsvLine(lines[i]).map((c) => c.trim());
    const id = findHeaderIndex(cells, ["Account ID", "Account Id", "Account No", "Account"]);
    const d = findHeaderIndex(cells, ["Debit Amt", "Debit Amount", "Debit", "Debits"]);
    const c = findHeaderIndex(cells, ["Credit Amt", "Credit Amount", "Credit", "Credits"]);
    if (id >= 0 && d >= 0 && c >= 0) {
      headerIdx = i; iId = id; iDebit = d; iCredit = c;
      break;
    }
  }
  if (headerIdx < 0) {
    return fail("Could not find Account ID + Debit + Credit columns — is this the General Ledger Trial Balance export (CSV)?");
  }

  let accountCount = 0;
  // Rule 13e: accumulate in INTEGER CENTS. A float sum over a large trial
  // balance can drift far enough to report "balanced" when it is not; this
  // cannot, at any size, because BigInt addition is exact.
  let totalDebitsCents = BigInt("0");
  let totalCreditsCents = BigInt("0");
  for (const line of lines.slice(headerIdx + 1, headerIdx + 1 + maxRows)) {
    const cells = splitCsvLine(line);
    const id = (cells[iId] ?? "").trim();
    if (!id) continue; // Total / blank / footer rows carry no Account ID.
    const d = parseCentsCell(cells[iDebit] ?? "") ?? BigInt("0");
    const c = parseCentsCell(cells[iCredit] ?? "") ?? BigInt("0");
    accountCount += 1;
    totalDebitsCents += d;
    totalCreditsCents += c;
  }
  if (accountCount === 0) return fail("Header found but no account rows with an Account ID.");

  const differenceCents = totalDebitsCents - totalCreditsCents;
  return {
    ok: true,
    accountCount,
    totalDebitsCents,
    totalCreditsCents,
    differenceCents,
    balanced: differenceCents === BigInt("0"),
    warnings,
  };
}

export type AgedPayablesParse = {
  ok: boolean;
  vendorCount: number;
  invoiceCount: number;
  /** Sum of the located total/amount-due column, or null when not identifiable. */
  totalDue: number | null;
  warnings: string[];
};

/**
 * Parse a Sage 50 Aged Payables export (CSV). Locates the Vendor / Invoice /
 * total columns by candidate headers; when a total column can't be identified
 * the parse still reports vendor + invoice counts and says so honestly.
 */
export function parseAgedPayables(text: string, maxRows = 100_000): AgedPayablesParse {
  const warnings: string[] = [];
  const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { ok: false, vendorCount: 0, invoiceCount: 0, totalDue: null, warnings: ["Empty file."] };
  }

  let headerIdx = -1;
  let iVendor = -1;
  let iInvoice = -1;
  let iTotal = -1;
  for (let i = 0; i < Math.min(lines.length, 10); i += 1) {
    const cells = splitCsvLine(lines[i]).map((c) => c.trim());
    const v = findHeaderIndex(cells, ["Vendor ID", "Vendor Id", "Vendor"]);
    if (v >= 0) {
      headerIdx = i;
      iVendor = v;
      iInvoice = findHeaderIndex(cells, ["Invoice/CM #", "Invoice/CM No", "Invoice No", "Invoice #", "Invoice Number", "Invoice"]);
      iTotal = findHeaderIndex(cells, ["Total", "Amount Due", "Balance Due", "Balance", "Amount"]);
      break;
    }
  }
  if (headerIdx < 0) {
    return { ok: false, vendorCount: 0, invoiceCount: 0, totalDue: null, warnings: ["Could not find a Vendor ID column — is this the Aged Payables export (CSV)?"] };
  }
  if (iInvoice < 0) warnings.push("No invoice-number column identified — invoice count unavailable.");
  if (iTotal < 0) warnings.push("No total/amount-due column identified — total not computed (the assistant can still use the generic column totals).");

  const vendors = new Set<string>();
  let invoiceCount = 0;
  let totalDue = 0;
  let lastVendor = "";
  for (const line of lines.slice(headerIdx + 1, headerIdx + 1 + maxRows)) {
    const cells = splitCsvLine(line);
    const vendor = (cells[iVendor] ?? "").trim();
    if (vendor) {
      lastVendor = vendor;
      vendors.add(vendor.toLowerCase());
    }
    const invoice = iInvoice >= 0 ? (cells[iInvoice] ?? "").trim() : "";
    if (invoice) {
      if (!vendor && !lastVendor) continue; // detail row before any vendor — ignore defensively
      invoiceCount += 1;
      if (iTotal >= 0) totalDue += parseNumericCell(cells[iTotal] ?? "") ?? 0;
    }
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    ok: vendors.size > 0,
    vendorCount: vendors.size,
    invoiceCount,
    totalDue: iTotal >= 0 ? round2(totalDue) : null,
    warnings,
  };
}

/**
 * Kind-aware analysis lines for an uploaded report (PURE). Returns
 * human-readable findings for the UI + assistant context, or null when the
 * kind has no dedicated analyzer (the generic CSV summary still applies).
 */
export function analyzeUploadByKind(kind: string, text: string): string[] | null {
  if (kind === "trial_balance") {
    const tb = parseTrialBalance(text);
    if (!tb.ok) return [`Trial balance: ${tb.warnings.join(" ")}`];
    // Rule 13e: render from integer cents; never round-trip money through a float.
    const money = centsToDollarString;
    const lines = [
      `Trial balance: ${tb.accountCount} accounts · debits ${money(tb.totalDebitsCents)} · credits ${money(tb.totalCreditsCents)}.`,
      tb.balanced
        ? "Tie-out PASSED — total debits equal total credits. Ready to key beginning balances (Phase 4)."
        : `Tie-out FAILED — debits minus credits = ${money(tb.differenceCents)}. Resolve this in the old company BEFORE keying beginning balances, or Sage will park the difference in Beginning Balance Equity.`,
      ...tb.warnings,
    ];
    return lines;
  }
  if (kind === "aged_payables") {
    const ap = parseAgedPayables(text);
    if (!ap.ok) return [`Aged payables: ${ap.warnings.join(" ")}`];
    const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return [
      `Aged payables: ${ap.vendorCount} vendors${ap.invoiceCount > 0 ? ` · ${ap.invoiceCount} open invoices` : ""}${ap.totalDue != null ? ` · total due ${money(ap.totalDue)}` : ""}.`,
      "Each open invoice must be entered INDIVIDUALLY in the new company (so payments can apply to them) — not as one lump sum.",
      ...ap.warnings,
    ];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grounded Sage 50 AI system prompt.
// ---------------------------------------------------------------------------

/** The verified Sage 50 facts the assistant is grounded on (mirror of the doc). */
export const SAGE50_KNOWLEDGE = `
SAGE 50 QUANTUM — VERIFIED FACTS (source: official Sage 50 help).

GENERAL JOURNAL IMPORT FIELDS (canonical order; default export file GENERAL.CSV):
1. Date (REQUIRED) — format MM/DD/YY.
2. Reference (optional) — alphanumeric, up to 20 chars.
3. Date Cleared in Bank Rec (optional) — MM/DD/YY; leave blank if N/A.
4. Number of Distributions (REQUIRED) — whole number 2–560 (count of G/L lines).
5. G/L Account (REQUIRED) — alphanumeric, up to 15 chars; must already exist in the Chart of Accounts.
6. Description (optional) — up to 160 chars.
7. Amount (REQUIRED) — positive = DEBIT, negative = CREDIT.
8. Job ID (optional, Premium+) — "jobid,phase,costcode".
9. Used for Reimbursable Expense (optional) — True/False.
10. Consolidated Transaction (optional) — True/False.
11. Recur Number (REQUIRED) — 0 = not recurring; >0 = recurring group id.
12. Recur Frequency (REQUIRED) — 0 none,1 weekly,2 bi-weekly,3 monthly,4 per period,5 quarterly,6 yearly,7 every four weeks,8 twice a year.
(Transaction Period and Transaction Number are EXPORT-ONLY.)

IMPORT PROCEDURE:
File menu -> Select Import/Export -> pick General Ledger -> General Journal -> Import.
On the Fields tab, check Show for exactly the fields in your file, in the same order (import FAILS if count/order mismatch; use Move to reorder). On the Options tab set the file path; check "First Row Contains Headings" if your file has a header row. Optionally Save the template under a unique name. Click OK. On error Sage reports the problem AND the line number.

CHART OF ACCOUNTS IMPORT FIELDS (default export file CHART.CSV):
1. Account ID (REQUIRED for import) — alphanumeric G/L account number, up to 15 chars.
2. Account Description (REQUIRED for import) — alphanumeric, up to 30 chars.
3. Account Type (REQUIRED for import) — WHOLE NUMBER code: 0=Cash, 1=Accounts Receivable, 2=Inventory, 3=Receivable Retainage, 4=Other Current Assets, 5=Fixed Assets, 6=Accumulated Depreciation, 8=Other Assets, 10=Accounts Payable, 11=Payable Retainage, 12=Other Current Liabilities, 14=Long Term Liabilities, 16=Equity-doesn't close, 18=Equity-Retained Earnings, 19=Equity-gets closed, 21=Income, 23=Cost of Sales, 24=Expenses.
4. Inactive (importable) — Boolean [True]/[False] (True=Inactive, False=Active).
5. 1099 Settings (importable) — whole-number code (0..14) from Vendor Defaults.
   Beginning/period debit-credit-net totals and Current Balance are EXPORT-ONLY (cannot be imported). To import a Chart of Accounts: File -> Select Import/Export -> General Ledger -> Chart of Accounts List -> Import; on the Fields tab check Show for exactly the fields in your file in the same order; on Options set the path and "First Row Contains Headings" if applicable.

IMPORT ORDER: Chart of Accounts (and customer/vendor lists) must exist before importing transaction journals; every G/L account used must already exist. The back office can VALIDATE this: upload your Chart of Accounts (CHART.CSV) here and it cross-checks the account IDs mapped in Accounting settings so a General Journal import won't fail on a missing/inactive account.

OUR BACK OFFICE FILE: the Accounting (Sage 50) tab builds a daily General Journal CSV from completed sales using the store's chart-of-accounts mapping. Each day = one balanced transaction (debits positive, credits negative, summing to zero). Header row: Date, Reference, Transaction Number, G/L Account ID, Description, Amount — so enable "First Row Contains Headings" on import.

.PTB BACKUPS: a .ptb is a proprietary compressed Sage company backup, NOT a readable report; it cannot be parsed outside Sage 50. To let the assistant use book data, export specific reports (General Ledger, Trial Balance) to CSV/PDF and upload those instead.

IMPORT ORDER (authoritative, from Sage Import/Export Tips): import LISTS first — Chart of Accounts, then Employee list, Vendor list, Customer list, Inventory Item list — THEN journals in this order: General Journal, Purchase Orders, Purchases (must precede sales so item costing is right), Assemblies, Inventory Adjustments, Sales Orders, Sales, Payments, Cash Receipts, Payroll. Purchase transactions MUST be imported before sales transactions for inventory costing to compute correctly.

IMPORT/EXPORT TIPS (verified):
- No DOUBLE QUOTES inside memos, notes, or descriptions — Sage treats quotes as field delimiters and the import fails or corrupts.
- Blank values become 0 (numeric) or False (boolean). Include Date Due on purchases/sales or aging reports will be wrong.
- Duplicate invoice numbers for the SAME customer/vendor are rejected.
- You cannot import journal entries dated past the end of the SECOND open fiscal year; close the first year before importing future-dated entries.
- Sales tax IDs and tax agencies CANNOT be imported (stored in taxcode.dat/taxauth.dat); set them up in Sage manually and reference the IDs in import files.
- When rebuilding a company, use identical accounting-period dates and the same number of custom fields, and export with date range ALL from several years back.

CASH RECEIPTS IMPORT (RECEIPTS.CSV): Reference, Date, Cash Account, Number of Distributions (1–147), Amount are required. For Apply-to-Revenues receipts, G/L Account and Amount are required per distribution; Quantity/Item ID/Unit Price/Tax Type optional. Cash Amount, Inventory Account, Cost of Sales Account/Amount are EXPORT-ONLY (computed on import). Positive amount = debit, negative = credit.

PAYMENTS IMPORT (PAYMENTS.CSV): Date, Cash Account, Detailed Payment (Yes/No), Number of Distributions (1–147), Amount required. Payment Method must already exist in Vendor Defaults. For Apply-to-Invoices, Vendor ID + Invoice Paid + Total Paid on Invoice(s) are needed; for Apply-to-Expenses, G/L Account + Amount.

PURCHASES IMPORT (PURCHASE.CSV): Vendor ID, Date, Date Due, Accounts Payable Account, Number of Distributions, G/L Account, Amount required. Accounts Payable Amount is EXPORT-ONLY (computed). Duplicate invoice # per vendor rejected.

INVENTORY ADJUSTMENTS IMPORT (ADJUST.CSV): Item ID, Date, Number of Distributions (always 1), G/L Source Account (usually COS), Quantity, Amount required. Amount should be NEGATIVE (credit to the source account); a NEGATIVE Quantity is what triggers the reversing debit. Requires a Sage Item ID per row — our back office has no Sage item mapping, so it exports adjustments as balanced General Journal entries instead (DR COGS / CR inventory for shrink, reversed for count-ups).

PAYROLL IMPORT (PAYROLL.CSV): needs Employee ID, Check Number, Date, Cash Account, Pay Period End, and per-pay-field amounts/accounts (fields 1–20 gross, 21–60 employee taxes/deductions, 61–100 employer). The back office only stores net/gross/taxes totals per employee, NOT the per-field detail, so per the store's rule there is NO payroll upload — keep entering payroll in Sage directly (or via your payroll service).

THIS STORE'S REAL BOOKS (verified from the owner's own Sage exports):
- Sales are keyed as daily CASH RECEIPTS per category "customer": 01-CONCENTRATE/EDIBLE/FLOWER/LIQUID/NON CANNABIS/PREROLL/TOPICAL. Each receipt's cash account is 10000-GRNWY (cash on hand) and its distributions are: WA LIQUOR & CANNABIS BOARD (excise 37%) → 31000-GRNWY (agency WA_LCB01), LOCAL SALES TAX → 31001-GRNWY (WA_DOR02), STATE SALES TAX → 31001-GRNWY (WA_DOR01), and SALES → the category income account (50000–50006-GRNWY), all as credits.
- Daily COGS is a separate receipt per category under the 07-* customers: "cash account" = the category COGS account (60000–60006-GRNWY, debit) and one distribution crediting the category inventory account (20000–20006-GRNWY).
- Vendor invoices (manifests) post to AP 30000-GRNWY with lines at 20009-GRNWY (default purchases/inventory entry). Vendor payments come out of checking 10005-GRNWY (methods: Cash / Check / Electronic).
- The Accounting tab's "Sage 50 imports" section generates these exact files from back-office data (orders, manifests, vendor payments, adjustments, vendor list). Review each file before importing; anything unmapped is flagged, never guessed.
- ABOUT THE "CATEGORY CUSTOMERS" WORKAROUND (01-*/07-*): the owner is right that recording sales/COGS "as customers" isn't the textbook method. Verified alternative: in Receive Money, leaving Customer ID BLANK records a DIRECT SALE applied straight to revenue G/L accounts — no customer record touched. So daily summary receipts do NOT require category customers. That said, the 01-*/07-* pattern is a harmless, widely-used summary convention (it groups receipts for reporting); in a FRESH START the cleaner design is direct-sale daily receipts (or keeping simple "DAILY SALES" reference customers if grouping is wanted) plus item-driven or export-driven COGS — never a customer per category for COGS.

ACCOUNT RECONCILIATION (Tasks > Account Reconciliation): choose the account, enter the statement ending balance and statement date, then check off cleared checks/deposits/withdrawals until Unreconciled Difference is 0.00. Add missing transactions (bank fees, interest) via Adjust. Reconcile every bank/cash account monthly — this is the #1 habit for professional books.

BANK FEEDS (verified, US edition): Bank Feeds automatically retrieves bank transactions into Sage 50. Requirements: a Sage service plan that includes Bank Services; US banks only. Setup: Home window > Apps & Services > Bank Feeds (or Tasks > Account Reconciliation > pick the G/L account > Bank Feeds toolbar button > Connect to Bank Feed). Steps: enter/confirm an email (cannot be changed later), accept terms, pass CAPTCHA, choose your bank (top-10 popular list or search; can submit a missing bank), sign in with your online banking credentials, pick the account type (checking/savings) matching the G/L account, then choose a START DATE and Process. Start-date rules: defaults to 90 days back; max two years back; no future dates; do NOT include a period you already reconciled; your bank may limit how far back it allows. CRITICAL BEHAVIOR: downloaded bank records appear ONLY inside Account Reconciliation — they do NOT create transactions. If a downloaded record matches a transaction already entered in Sage, it auto-clears. Unmatched records show as "New Bank Records": right-click > Manual Match to link to an existing transaction, or right-click > Create New to make the missing transaction. Disconnecting (Account Reconciliation > Bank Feeds > Disconnect) does not affect already-downloaded records. Repeat the connection for EACH G/L bank account (e.g. checking 10005-GRNWY). Note: cannabis businesses sometimes face banking-access limits; if your bank isn't supported, reconcile manually from statements — same monthly discipline.

INVENTORY ITEM CLASSES (verified): the class is chosen on the General tab of Maintain Inventory Items and CANNOT be changed once saved. Classes: Stock (traditional tracked inventory: quantities, costs, vendors, reorder points), Master Stock + Substock (Premium+; one master defines shared attributes — e.g. Size × Strain — and Sage auto-generates the substock items; substocks can't be created or deleted directly), Serialized Stock (Premium+; per-unit serial numbers and per-unit specific cost), Non-stock (bought/sold but quantity not tracked), Service, Labor, Activity/Charge (Time & Billing), Description-only, Assembly (+ Serialized Assembly; built from a Bill of Materials).

ONE ITEM PER PRODUCT — NOT PER LOT (verified): Sage 50 does NOT require a new inventory item for every received lot, and Sage 50 US has no native lot-tracking field. Set up ONE Stock item per product/SKU. Each purchase at a different cost simply creates a new COST LAYER; the item's costing method (Average / FIFO / LIFO, or Specific Unit on Premium+) values COGS automatically as you sell. Master Stock + substock items reduce data entry further for families like "Brand X Gummies" in multiple flavors/sizes. Lot- and traceability-level detail stays in the POS/back office (which is the WA-compliant seed-to-sale system of record); Sage carries the FINANCIAL view. Costing methods: Average Cost, FIFO, LIFO, Specific Unit (Premium+). Sage's guidance: generally ALL items should use the SAME costing method — confirm with your accountant before mixing.

HOW STOCK ITEMS AUTO-POST COGS (verified): each item carries three G/L accounts — GL Sales (income credited on sale), GL Inventory (debited on purchase, credited on sale), GL Cost of Sales (debited on sale). When you buy a Stock item via Purchases, Sage debits inventory; when you sell it via Sales/Invoicing or Receive Money with the item on the line, Sage automatically credits inventory and debits COGS at the costing-method value, as of the transaction date. THIS is the professional replacement for manually keying daily 07-* COGS receipts — item-driven COGS is automatic and audit-traceable.

DISCOUNT TRACKING (verified): two kinds. (1) EARLY-PAYMENT (terms) discounts: set defaults in Maintain > Default Information > Customers > Terms and Credit (Discount %, Discount in N days) plus the G/L LINK ACCOUNTS: default G/L Sales account, Discount G/L account (required — updated whenever a customer takes an early-pay discount), and Cash account. In Receive Money, when applying to invoices, Sage computes the Discount from the customer's terms and posts it to the Discount Account (editable per receipt; a required field). (2) POS/PROMO discounts (what this store gives at register): professional treatment is GROSS sales credited to income and the discount DEBITED to a contra-revenue "Sales Discounts" account, so the income statement shows gross revenue, discounts, and net revenue. The back office does this automatically in the Sage receipts export once a "Sales discounts" G/L account is set in Accounting settings — it credits SALES at the pre-discount amount and adds a positive SALES DISCOUNTS line per day/category. If the account is blank, sales export net of discounts and the export warns you.

BEGINNING BALANCES (verified): G/L — Maintain > Chart of Accounts > Beginning Balances button; pick the period (previous, current, or future); type amounts into the white cells (minus sign for negatives); balances roll forward period-to-period (changing Period 1 updates later periods, not vice versa). If you've already posted transactions, the same button records PRIOR-PERIOD ADJUSTMENTS instead. Inventory — Maintain Inventory Items > General tab > Beginning Balances button: per item enter QUANTITY, UNIT COST, and TOTAL COST (only used at startup; serialized items also need serial numbers). Trial balance from the old books is your source document: total debits must equal total credits or Sage posts the difference to Beginning Balance Equity — clear that account to zero before going live.

FRESH-START RESTRUCTURE PLAYBOOK (the professional path from the current books to expert books — walk the owner through ONE phase at a time):
Phase 0 — CLOSE OUT THE OLD: pick a clean start date (first day of a month, ideally the fiscal year). In the OLD company: post/print everything, reconcile every bank/cash account through the start date, run a TRIAL BALANCE as of the day before the start date, plus Aged Payables (open vendor invoices), Aged Receivables (if any), and an inventory valuation from the back office. These reports are the source documents for the new company. Keep the old company forever — read-only history.
Phase 1 — NEW COMPANY: File > New Company; match fiscal/accounting periods to the start date; build the chart of accounts (copying the existing chart is fine — the ACCOUNTS were largely right; it's the customer-per-category WORKAROUND being retired). Keep: cash 10000, checking 10005, inventory 20000-20006, AP 30000, excise payable 31000, sales tax payable 31001, income 50000-50006, COGS 60000-60006. Add a SALES DISCOUNTS contra-revenue account (e.g. 50007) if tracking discounts.
Phase 2 — DEFAULTS BEFORE DATA: Vendor defaults (payment methods Cash/Check/Electronic, terms, AP aging), Customer defaults (Terms & Credit + G/L link accounts: sales, DISCOUNT account, cash), Inventory Item defaults (default G/L accounts per class, costing method — pick ONE, e.g. Average or FIFO, and confirm with your CPA), and set up sales tax IDs/agencies MANUALLY (they cannot be imported): WA_LCB01 excise, WA_DOR01/WA_DOR02 state/local.
Phase 3 — LISTS: import/enter the Vendor list (back office exports it), real customers only (retail walk-in trade needs NO customer records — daily summary receipts can post as direct sales), and inventory items (one Stock item per product/SKU if adopting item-level tracking, or skip items entirely if keeping summary-level books with the back office as the perpetual inventory system).
Phase 4 — BEGINNING BALANCES: G/L balances from the trial balance; each OPEN vendor invoice entered individually (so payments can apply to them); inventory quantities+costs (if using Stock items); verify Beginning Balance Equity nets to zero and the balance sheet ties to the old books.
Phase 5 — CONNECT & RECONCILE: connect Bank Feeds to checking; first reconciliation = the first statement after the start date. Monthly cadence from then on.
Phase 6 — GO-FORWARD RHYTHM: daily/weekly — import back-office Cash Receipts (sales+tax+COGS or gross+discounts), Purchases (accepted manifests), Payments; monthly — reconcile every cash/bank account, review P&L and Balance Sheet, tie inventory G/L to the back-office valuation and book one adjustment if they differ; quarterly — excise/B&O/sales-tax filings tie to 31000/31001 activity; yearly — Year-End Wizard after the CPA review.
TWO HONEST BOOKKEEPING MODELS (owner must choose, don't guess for them): (A) SUMMARY MODEL (recommended for a high-SKU dispensary) — the back office remains the perpetual inventory system; Sage receives daily summary receipts (gross sales, discounts, taxes, COGS by category) exactly as the export builds them; no Sage inventory items needed; monthly inventory tie-out. (B) ITEM MODEL — every product is a Sage Stock item; purchases and sales flow item-by-item and Sage computes COGS automatically; most accurate inside Sage but heavy data entry/import volume for thousands of cannabis SKUs. Deloitte-grade practice for retail POS environments is model A with strict monthly reconciliation.

THE OWNER'S CHOSEN MODEL (decision on record — do not re-ask): Model A (summary model) with DETAILED category tracking. Sales/COGS are tracked by the store's detailed product categories (rosin, cartridges, infused pre-rolls, and so on), not just the seven broad types (flower, pre-rolls, concentrates, vape, edibles, topicals, other). The back office supports this via migration 0092 (dynamic category buckets): the seven broad buckets remain as seeds, and new detailed buckets are added on the Accounting reports page ("Sage category buckets" section → "+ New category"). RULE for every new detailed category: FIRST create the matching accounts in Sage — an income account (5xxxx range, e.g. 50010 ROSIN SALES), a COGS account (6xxxx, e.g. 60010 ROSIN COGS), and an inventory/asset account (2xxxx, e.g. 20010 ROSIN INVENTORY) via Maintain > Chart of Accounts — THEN add the bucket in the back office with those account IDs. If keeping the legacy 01-*/07-* category-customer convention, also create the matching 01-* (sales) and 07-* (COGS) customers in Sage; otherwise leave the customer fields set and post as direct sales. Once the bucket exists, map each POS category name to it in the "Sage category map" so exports post to the right accounts. Exports will warn about any unmapped categories.

RESTRUCTURE-PREP UPLOADS (how the back office receives the source documents): the "Upload reports for Sage import" section accepts the three restructure source documents whenever the owner is ready — no rush; the owner is finishing the POS build first. (1) TRIAL BALANCE (kind "Trial balance export"): export from Sage via Reports & Forms > General Ledger > General Ledger Trial Balance, dated the day BEFORE the chosen start date, to CSV. On upload the back office automatically ties out total debits vs total credits per account row; if they differ, that must be fixed in the OLD company before keying beginning balances (otherwise Sage parks the difference in Beginning Balance Equity). (2) AGED PAYABLES (kind "Aged Payables (open vendor invoices)"): Reports & Forms > Accounts Payable > Aged Payables, to CSV. On upload the back office counts vendors/open invoices and totals the amount due; remind the owner every open invoice is entered INDIVIDUALLY in the new company so payments can apply to them. (3) CHART OF ACCOUNTS (kind "Sage Chart of Accounts (CHART.CSV)"): validates the store's mapped G/L accounts against it. When these uploads appear in the context, USE their findings (tie-out result, vendor/invoice counts, totals) to guide the restructure phases — and if a needed report is not uploaded yet, say which one and give the exact Sage menu path.

FISCAL YEAR-END (Tasks > System > Year-End Wizard): Sage keeps TWO open fiscal years. Close the first year when you need to enter transactions beyond the second. If the payroll year is the calendar year, close payroll first (after W-2s/941/940). Before closing: post/print everything, reconcile accounts, back up the company (the wizard requires a backup), and review reports. Closing is permanent — transactions in the closed year become read-only.
`.trim();

/** Build the system prompt for the Sage 50 chat assistant. */
export function buildSageSystemPrompt(extraContext?: string): string {
  return [
    "You are a Sage 50 Quantum assistant for a Washington State cannabis retailer's back office.",
    "Answer ONLY from the verified facts below and any context provided. If a question is outside these facts, say you don't have verified information on it and suggest checking Sage's official help — do NOT guess or invent Sage behavior.",
    "Be concise, practical, and specific to Sage 50 Quantum. Use the exact field names and steps below. When relevant, remind the user that debits are positive and credits are negative, and that G/L accounts must already exist.",
    "",
    "=== VERIFIED SAGE 50 FACTS ===",
    SAGE50_KNOWLEDGE,
    extraContext ? `\n=== UPLOAD / STORE CONTEXT ===\n${extraContext}` : "",
  ]
    .join("\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runSageHelperCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };
  // BigInt-aware serializer: money totals are bigint (rule 13e) and
  // JSON.stringify throws on them. Tagged with a suffix so BigInt("1") never compares
  // equal to the string "1" — the fix must not loosen the comparison.
  const show = (v: unknown): string =>
    JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? `${val}n#bigint` : val)) ?? String(v);
  const eq = (a: unknown, b: unknown, msg: string) => ok(show(a) === show(b), `${msg} (got ${show(a)})`);

  // extension guards
  eq(fileExtension("Report.CSV"), ".csv", "ext lowercased");
  ok(isRejectedSageFile("company.ptb"), "ptb rejected");
  ok(!isAcceptedSageFile("company.ptb"), "ptb not accepted");
  ok(isAcceptedSageFile("sales.xlsx"), "xlsx accepted");
  ok(isSageReportKind("cultivera_sales"), "kind valid");
  ok(!isSageReportKind("nope"), "kind invalid");
  eq(sageReportKindLabel("pos_summary"), "POS daily summary", "kind label");

  // csv line splitting
  eq(splitCsvLine('a,b,c'), ["a", "b", "c"], "plain split");
  eq(splitCsvLine('"a,b",c'), ["a,b", "c"], "quoted comma");
  eq(splitCsvLine('"say ""hi""",x'), ['say "hi"', "x"], "escaped quotes");

  // numeric cell parsing
  eq(parseNumericCell("$1,234.50"), 1234.5, "currency parse");
  eq(parseNumericCell("(50.00)"), -50, "accounting negative");
  eq(parseNumericCell("abc"), null, "non-numeric null");
  eq(parseNumericCell(""), null, "empty null");

  // csv summary
  const csv = "Date,Product,Amount\n2025-01-01,Flower,100.00\n2025-01-02,Edible,50.50\n2025-01-03,Vape,\n";
  const s = summarizeCsv(csv);
  eq(s.rowCount, 3, "3 data rows");
  eq(s.columnCount, 3, "3 columns");
  const amt = s.columns.find((c) => c.header === "Amount");
  ok(amt !== undefined && amt.numeric === true, "Amount numeric");
  eq(amt?.total, 150.5, "Amount total 150.50");
  const prod = s.columns.find((c) => c.header === "Product");
  ok(prod !== undefined && prod.numeric === false, "Product not numeric");
  eq(s.numericTotals.find((t) => t.header === "Amount")?.total, 150.5, "numericTotals amount");

  // empty csv
  const e = summarizeCsv("");
  eq(e.rowCount, 0, "empty rowCount 0");

  // system prompt grounding
  const prompt = buildSageSystemPrompt("License: 412345");
  ok(prompt.includes("positive = DEBIT"), "prompt has debit rule");
  ok(prompt.includes("Select Import/Export"), "prompt has import steps");
  ok(prompt.includes("License: 412345"), "prompt has extra context");
  ok(prompt.includes("do NOT guess"), "prompt forbids guessing");
  ok(prompt.includes("CHART.CSV"), "prompt has Chart of Accounts facts");

  // account type labels
  eq(sageAccountTypeLabel(0), "Cash", "type 0 cash");
  eq(sageAccountTypeLabel(23), "Cost of Sales", "type 23 cos");
  eq(sageAccountTypeLabel(999), "Type 999", "unknown type code");
  eq(sageAccountTypeLabel(null), "Unknown", "null type");

  // parse chart of accounts (with header, mixed order)
  const coaCsv =
    "Account ID,Account Description,Account Type,Inactive\n" +
    "1000,Cash on hand,0,False\n" +
    "4000,Cannabis Sales,21,False\n" +
    "2200,Sales Tax Payable,12,False\n" +
    "9999,Old Account,24,True\n";
  const coa = parseChartOfAccounts(coaCsv);
  ok(coa.ok === true, "coa parsed ok");
  eq(coa.accounts.length, 4, "coa 4 accounts");
  eq(coa.ids.includes("4000"), true, "coa has 4000");
  const cash = coa.accounts.find((a) => a.id === "1000");
  ok(cash !== undefined && cash.typeCode === 0 && cash.typeLabel === "Cash", "coa cash typed");
  const old = coa.accounts.find((a) => a.id === "9999");
  ok(old !== undefined && old.inactive === true, "coa inactive flagged");

  // headerless fallback
  const coaNoHeader = parseChartOfAccounts("1000,Cash,0,False\n4000,Sales,21,False\n");
  ok(coaNoHeader.ok === true && coaNoHeader.accounts.length === 2, "headerless coa parsed");
  ok(coaNoHeader.warnings.some((w) => w.includes("canonical position")), "headerless warns");

  // `ok` IS A GATE, NOT A DECORATION.
  // sage-helper.ts uses `coa.ok` as the ONLY thing standing between an
  // unreadable upload and a G/L validation run. If `ok` were ever hard-coded
  // true, a junk file would sail through and every mapping would be reported
  // missing against an empty chart. Added after a mutation (`ok: true`)
  // survived this gate.
  for (const [label, text] of [
    ["empty", ""],
    ["whitespace only", "   \n\n \t \n"],
    ["header row only", "Account ID,Account Description,Account Type,Inactive"],
    ["header + blank rows", "Account ID,Account Description,Account Type,Inactive\n,,,\n,,,"],
  ] as [string, string][]) {
    const r = parseChartOfAccounts(text);
    eq(r.accounts.length, 0, `coa ${label}: no accounts`);
    ok(r.ok === false, `coa ${label}: ok must be false when nothing parsed`);
  }
  for (const s of [
    "",
    "   ",
    "Account ID,Account Description",
    "Account ID,Account Description\n,,",
    "Account ID,Account Description\n10000,CASH",
    "10000,CASH,1,False",
  ]) {
    const r = parseChartOfAccounts(s);
    ok(r.ok === (r.accounts.length > 0), `coa ok===accounts>0 for ${JSON.stringify(s)}`);
  }
  // An unread trial balance must never report itself balanced.
  for (const [label, text] of [
    ["empty", ""],
    ["header only", "Account ID,Account Description,Debit Amt,Credit Amt"],
    ["prose", "no data here at all"],
  ] as [string, string][]) {
    const r = parseTrialBalance(text);
    ok(r.ok === false, `tb ${label}: not ok`);
    eq(r.accountCount, 0, `tb ${label}: no accounts`);
    ok(r.balanced === false, `tb ${label}: never reports balanced`);
    ok(r.warnings.length > 0, `tb ${label}: says why`);
  }
  for (const [label, text] of [
    ["empty", ""],
    ["header only", "Vendor ID,Vendor,Invoice/CM #,Amount Due"],
    ["prose", "nothing"],
  ] as [string, string][]) {
    const r = parseAgedPayables(text);
    ok(r.ok === false, `ap ${label}: not ok`);
    eq(r.vendorCount, 0, `ap ${label}: no vendors`);
  }

  // GL mapping validation
  const val = validateGlMappingAgainstCoa(
    [
      { label: "Cash / clearing", accountId: "1000" },
      { label: "Cannabis sales", accountId: "4000" },
      { label: "Sales tax payable", accountId: "2200" },
      { label: "COGS", accountId: "5000" }, // not in CoA
      { label: "Discounts", accountId: "" }, // skipped
    ],
    coa,
  );
  eq(val.checks.length, 4, "4 non-empty mappings checked");
  eq(val.missing.length, 1, "1 missing (5000)");
  ok(val.missing[0].accountId === "5000", "missing is 5000");
  ok(val.allValid === false, "not all valid");
  const allGood = validateGlMappingAgainstCoa([{ label: "Cash", accountId: "1000" }], coa);
  ok(allGood.allValid === true, "all valid when present");
  // inactive detection
  const inact = validateGlMappingAgainstCoa([{ label: "Old", accountId: "9999" }], coa);
  eq(inact.inactive.length, 1, "inactive mapping detected");
  ok(inact.allValid === false, "inactive => not valid");

  // trial balance parsing + tie-out
  const tbCsv =
    "Greenway Marijuana\nGeneral Ledger Trial Balance\nAs of Dec 31, 2025\n" +
    "Account ID,Account Description,Debit Amt,Credit Amt\n" +
    "10000,CASH ON HAND,\"1,500.00\",\n" +
    "30000,ACCOUNTS PAYABLE,,\"1,000.00\"\n" +
    "39000,RETAINED EARNINGS,,500.00\n" +
    ",Total,\"1,500.00\",\"1,500.00\"\n";
  const tb = parseTrialBalance(tbCsv);
  ok(tb.ok, "tb parsed");
  eq(tb.accountCount, 3, "tb 3 accounts (Total row skipped)");
  eq(tb.totalDebitsCents, BigInt("150000"), "tb debits 1500.00 = 150000 cents");
  eq(tb.totalCreditsCents, BigInt("150000"), "tb credits 1500.00 = 150000 cents");
  ok(tb.balanced && tb.differenceCents === BigInt("0"), "tb balanced");
  const tbBad = parseTrialBalance(tbCsv.replace("500.00\n,Total", "400.00\n,Total"));
  ok(tbBad.ok && !tbBad.balanced && tbBad.differenceCents === BigInt("10000"), "tb imbalance detected (+100.00)");
  ok(!parseTrialBalance("Nope,Nada\n1,2\n").ok, "tb rejects non-TB csv");

  // -------------------------------------------------------------------------
  // RULE 13e — money is parsed from DIGITS into integer cents, never a float.
  // Rule 15a: every positive case gets its negative twin.
  // -------------------------------------------------------------------------
  eq(parseCentsCell("1500.00"), BigInt("150000"), "cents: plain");
  eq(parseCentsCell("$1,234.56"), BigInt("123456"), "cents: currency + separators");
  eq(parseCentsCell("(50.00)"), -BigInt("5000"), "cents: accounting negative");
  eq(parseCentsCell("-50.00"), -BigInt("5000"), "cents: explicit minus");
  eq(parseCentsCell("(-50.00)"), BigInt("5000"), "cents: double negative is positive");
  eq(parseCentsCell("+7.25"), BigInt("725"), "cents: explicit plus");
  eq(parseCentsCell(".50"), BigInt("50"), "cents: bare decimal");
  eq(parseCentsCell("7"), BigInt("700"), "cents: whole dollars");
  eq(parseCentsCell("7.5"), BigInt("750"), "cents: one decimal place pads");
  eq(parseCentsCell("0.00"), BigInt("0"), "cents: zero is zero, not null");
  eq(parseCentsCell("1.999"), BigInt("199"), "cents: extra places TRUNCATE, never round via float");
  // Rule 15a negative controls — a bad cell must be null, never silently 0.
  eq(parseCentsCell(""), null, "cents: empty is null");
  eq(parseCentsCell("   "), null, "cents: whitespace is null");
  eq(parseCentsCell("abc"), null, "cents: text is null");
  eq(parseCentsCell("."), null, "cents: lone dot is null");
  eq(parseCentsCell("1.2.3"), null, "cents: two dots rejected");
  eq(parseCentsCell("12x.00"), null, "cents: embedded letter rejected");
  eq(parseCentsCell("1e5"), null, "cents: exponent notation rejected, not read as 100000");
  // BigInt() accepts JS numeric-literal prefixes. Without the shape regex these
  // become INVENTED MONEY: "0x10" -> $40.96, "0b101" -> $0.20, "0o17" -> $9.60,
  // "--5" -> $5.00, "+-3" -> -$3.00. Found by sweeping a hostile corpus and
  // diffing with/without the regex — not by imagination. Rule 3: never let a
  // machine silently invent a value.
  eq(parseCentsCell("0x10"), null, "cents: hex literal rejected (would be $40.96)");
  eq(parseCentsCell("0b101"), null, "cents: binary literal rejected (would be $0.20)");
  eq(parseCentsCell("0o17"), null, "cents: octal literal rejected (would be $9.60)");
  eq(parseCentsCell("--5"), null, "cents: double minus rejected (would be $5.00)");
  eq(parseCentsCell("+-3"), null, "cents: mixed signs rejected (would be -$3.00)");
  // These specifically pin the SHAPE regex. The try/catch around BigInt() is a
  // safety net, not the guard — without the regex a junk cell reaches BigInt
  // and (before the net existed) crashed the whole upload. Asserting the
  // TOTALS, not just the null, proves junk is excluded rather than read as 0.
  {
    const junk =
      "Account ID,Account Description,Debit Amt,Credit Amt\n" +
      "10000,GOOD,100.00,\n" +
      "10001,JUNK,abc,\n" +          // must NOT become 0 silently *or* crash
      "10002,JUNK2,12x.00,\n" +
      "10003,JUNK3,1.2.3,\n" +
      "30000,CREDIT,,100.00\n";
    const j = parseTrialBalance(junk);
    ok(j.ok, "junk tb still parses (never throws)");
    eq(j.totalDebitsCents, BigInt("10000"), "junk cells contribute NOTHING to the debit total");
    eq(j.totalCreditsCents, BigInt("10000"), "credits unaffected by junk debits");
    ok(j.balanced, "junk tb ties out on the real rows only");
  }

  // Renderer round-trips exactly, including the sign and the grouping.
  eq(centsToDollarString(BigInt("150000")), "1,500.00", "render: grouped");
  eq(centsToDollarString(BigInt("0")), "0.00", "render: zero");
  eq(centsToDollarString(BigInt("5")), "0.05", "render: nickel pads");
  eq(centsToDollarString(-BigInt("5000")), "-50.00", "render: negative");
  eq(centsToDollarString(BigInt("462469731")), "4,624,697.31", "render: the real $4.62M plug");

  // THE DEFECT THIS REPLACED (rule 19 — the owner's real failures are the corpus).
  // A trial balance whose float sum drifts far enough that round2() could no
  // longer hide it used to report "balanced" when it was off. Integer cents
  // cannot: an off-by-one-cent TB is caught at ANY magnitude.
  {
    const hdr = "Account ID,Account Description,Debit Amt,Credit Amt\n";
    // 800 accounts near 2^53 CENTS — magnitudes proven (by execution) to make
    // float accumulation drift by 2-3 cents, which is what used to hide an
    // imbalance. Integer cents must still find a ONE-CENT gap here.
    let rows = "";
    let sum = BigInt("0");
    for (let i = 0; i < 800; i += 1) {
      const cents = BigInt("9007199254740") - BigInt(i) * BigInt("3");
      sum += cents;
      rows += `${10000 + i},ACCT ${i},"${centsToDollarString(cents)}",\n`;
    }
    // credit side deliberately ONE CENT short.
    const short = `90000,PLUG,,"${centsToDollarString(sum - BigInt("1"))}"\n`;
    const huge = parseTrialBalance(hdr + rows + short);
    ok(huge.ok, "huge tb parsed");
    eq(huge.accountCount, 801, "huge tb counted every account row");
    eq(huge.differenceCents, BigInt("1"), "huge tb: the missing CENT is found at $8e11 scale");
    ok(!huge.balanced, "huge tb correctly refuses to tie out");
  }
  // Same shape, but genuinely balanced -> must PASS. (Rule 15b: prove the check
  // can say yes, so the assertion above is not just a tautology.)
  {
    const hdr = "Account ID,Account Description,Debit Amt,Credit Amt\n";
    let rows = "";
    let sum = BigInt("0");
    for (let i = 0; i < 800; i += 1) {
      const cents = BigInt("9007199254740") - BigInt(i) * BigInt("3");
      sum += cents;
      rows += `${10000 + i},ACCT ${i},"${centsToDollarString(cents)}",\n`;
    }
    const exact = `90000,PLUG,,"${centsToDollarString(sum)}"\n`;
    const good = parseTrialBalance(hdr + rows + exact);
    ok(good.ok && good.balanced && good.differenceCents === BigInt("0"), "huge tb ties out when it truly balances");
  }

  // aged payables parsing
  const apCsv =
    "Aged Payables\nAs of Dec 31, 2025\n" +
    "Vendor ID,Vendor,Invoice/CM #,Date,0-30,31-60,Total\n" +
    "V001,TWO HEADS FARMS,INV-1,12/01/25,250.00,,250.00\n" +
    ",,INV-2,12/15/25,\"1,250.50\",,\"1,250.50\"\n" +
    "V002,FAIRWINDS,INV-9,12/20/25,,100.00,100.00\n";
  const ap = parseAgedPayables(apCsv);
  ok(ap.ok, "ap parsed");
  eq(ap.vendorCount, 2, "ap 2 vendors");
  eq(ap.invoiceCount, 3, "ap 3 invoices (blank-vendor detail row counted)");
  eq(ap.totalDue, 1600.5, "ap total 1600.50");
  ok(!parseAgedPayables("Foo,Bar\n1,2\n").ok, "ap rejects non-AP csv");
  const apNoTotal = parseAgedPayables("Vendor ID,Invoice No\nV1,I1\n");
  ok(apNoTotal.ok && apNoTotal.totalDue === null && apNoTotal.warnings.length > 0, "ap no-total warns, null total");

  // kind-aware analysis
  const anTb = analyzeUploadByKind("trial_balance", tbCsv);
  ok(anTb !== null && anTb.some((l) => l.includes("PASSED")), "analysis tb passed line");
  const anTbBad = analyzeUploadByKind("trial_balance", tbCsv.replace("500.00\n,Total", "400.00\n,Total"));
  ok(anTbBad !== null && anTbBad.some((l) => l.includes("FAILED")), "analysis tb failed line");
  const anAp = analyzeUploadByKind("aged_payables", apCsv);
  ok(anAp !== null && anAp.some((l) => l.includes("2 vendors")), "analysis ap vendors line");
  ok(analyzeUploadByKind("cultivera_sales", tbCsv) === null, "analysis null for generic kinds");
  ok(isSageReportKind("aged_payables"), "aged_payables is a kind");

  console.log(`sage-helper-core: ${pass} assertions passed`);
}
