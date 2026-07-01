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
  const eq = (a: unknown, b: unknown, msg: string) =>
    ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)})`);

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

  console.log(`sage-helper-core: ${pass} assertions passed`);
}
