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
  { value: "cultivera_sales", label: "Cultivera — sales export" },
  { value: "cultivera_inventory", label: "Cultivera — inventory export" },
  { value: "pos_summary", label: "POS daily summary" },
  { value: "gl_export", label: "Sage GL export (CSV)" },
  { value: "trial_balance", label: "Trial balance export" },
  { value: "other", label: "Other report" },
] as const;

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

IMPORT ORDER: Chart of Accounts (and customer/vendor lists) must exist before importing transaction journals; every G/L account used must already exist.

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

  console.log(`sage-helper-core: ${pass} assertions passed`);
}
