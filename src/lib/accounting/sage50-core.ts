/**
 * src/lib/accounting/sage50-core.ts
 *
 * Slice 36 (Feature Q) — PURE Sage 50 General Journal helpers extracted from
 * sage50.ts for testability + hardening (no server-only, no DB). The server
 * module re-exports these and layers the DB-backed builder on top.
 */

export type AccountingSettings = {
  glCashClearing: string;
  glSalesCannabis: string;
  glSalesNonCannabis: string;
  glSalesTaxPayable: string;
  glExciseTaxPayable: string;
  glCogs: string;
  glInventory: string;
  glDiscounts: string;
  journalRefPrefix: string;
};

export const DEFAULT_ACCOUNTING_SETTINGS: AccountingSettings = {
  glCashClearing: "",
  glSalesCannabis: "",
  glSalesNonCannabis: "",
  glSalesTaxPayable: "",
  glExciseTaxPayable: "",
  glCogs: "",
  glInventory: "",
  glDiscounts: "",
  journalRefPrefix: "GW",
};

export type JournalLine = {
  date: string; // MM/DD/YYYY
  reference: string;
  transactionNumber: number;
  glAccountId: string;
  description: string;
  amountMinor: number; // debit positive, credit negative
};

export type DayJournalSummary = {
  date: string; // YYYY-MM-DD
  cannabisSalesMinor: number;
  nonCannabisSalesMinor: number;
  salesTaxMinor: number;
  exciseMinor: number;
  cogsMinor: number;
  discountsMinor: number;
  cashCollectedMinor: number;
};

export type Sage50BuildResult = {
  csv: string;
  fileName: string;
  lineCount: number;
  days: number;
  warnings: string[];
  summaries: DayJournalSummary[];
};

// ---------------------------------------------------------------------------
// Pure formatting helpers
// ---------------------------------------------------------------------------

/** Cents → "D.DD" string (negatives preserved). */
export function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** YYYY-MM-DD → MM/DD/YYYY (Sage's expected date column format). */
export function mmddyyyy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${m}/${d}/${y}`;
}

/** Strip quotes + collapse newlines so a value is safe inside a CSV field. */
export function clean(s: string): string {
  return s.replace(/"/g, "").replace(/[\r\n]+/g, " ");
}

/** Quote a CSV cell only when it contains a comma or newline. */
export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[,\n]/.test(s) ? `"${s.replace(/"/g, "")}"` : s;
}

/** Timestamped Sage 50 file name. */
export function makeFileName(date: Date = new Date()): string {
  const ts =
    date.getUTCFullYear().toString() +
    String(date.getUTCMonth() + 1).padStart(2, "0") +
    String(date.getUTCDate()).padStart(2, "0");
  return `Sage50_GeneralJournal_${ts}.csv`;
}

/** Assemble the Sage 50 General Journal CSV from balanced lines. */
export function assembleCsv(lines: JournalLine[]): string {
  const out: string[] = [];
  out.push(["Date", "Reference", "Transaction Number", "G/L Account ID", "Description", "Amount"].join(","));
  for (const l of lines) {
    out.push(
      [
        l.date,
        csvCell(l.reference),
        l.transactionNumber,
        csvCell(l.glAccountId),
        csvCell(l.description),
        dollars(l.amountMinor),
      ].join(","),
    );
  }
  return out.join("\n");
}

/**
 * Drop discount distribution lines (kept in the preview, omitted from GL so the
 * journal balances) and warn about any per-transaction rounding imbalance.
 * Mutates `lines` in place and pushes any warning onto `warnings`.
 */
export function rebalance(
  lines: JournalLine[],
  settings: AccountingSettings,
  warnings: string[],
): void {
  if (settings.glDiscounts) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (
        lines[i].glAccountId === settings.glDiscounts &&
        lines[i].description.startsWith("Sales discounts")
      ) {
        lines.splice(i, 1);
      }
    }
  }
  const sums = new Map<number, number>();
  for (const l of lines) sums.set(l.transactionNumber, (sums.get(l.transactionNumber) ?? 0) + l.amountMinor);
  const unbalanced = [...sums.entries()].filter(([, v]) => v !== 0);
  if (unbalanced.length) {
    warnings.push(
      `${unbalanced.length} day(s) had rounding imbalances; review before import. (Sales discounts are shown in the preview but omitted from GL lines to keep entries balanced.)`,
    );
  }
}

/** Which GL account ids are still blank — surfaced as a setup warning. */
export function missingGlAccounts(settings: AccountingSettings): string[] {
  const required: [keyof AccountingSettings, string][] = [
    ["glCashClearing", "Cash / clearing"],
    ["glSalesCannabis", "Cannabis sales"],
    ["glSalesTaxPayable", "Sales tax payable"],
  ];
  return required.filter(([k]) => !String(settings[k]).trim()).map(([, label]) => label);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runSage50CoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // dollars
  ok(dollars(12345) === "123.45", "dollars 12345");
  ok(dollars(-500) === "-5.00", "dollars negative");
  ok(dollars(0) === "0.00", "dollars zero");

  // mmddyyyy
  ok(mmddyyyy("2025-01-07") === "01/07/2025", "mmddyyyy");

  // clean: strips quotes, collapses newlines to a single space
  ok(clean('a"b\nc') === "ab c", "clean strips quotes, newline→space");
  ok(clean('no"quotes') === "noquotes", "clean strips quotes only");

  // csvCell
  ok(csvCell("plain") === "plain", "csvCell plain");
  ok(csvCell("a,b") === '"a,b"', "csvCell comma quoted");
  ok(csvCell(null) === "", "csvCell null");
  ok(csvCell(42) === "42", "csvCell number");

  // makeFileName
  ok(
    makeFileName(new Date(Date.UTC(2025, 0, 7))) === "Sage50_GeneralJournal_20250107.csv",
    "makeFileName",
  );

  // assembleCsv header + a balanced pair
  const lines: JournalLine[] = [
    { date: "01/07/2025", reference: "GW-1", transactionNumber: 1, glAccountId: "1000", description: "Cash", amountMinor: 10000 },
    { date: "01/07/2025", reference: "GW-1", transactionNumber: 1, glAccountId: "4000", description: "Sales", amountMinor: -10000 },
  ];
  const csv = assembleCsv(lines);
  ok(csv.split("\n").length === 3, "csv 1 header + 2 rows");
  ok(csv.startsWith("Date,Reference,Transaction Number,G/L Account ID,Description,Amount"), "csv header");
  ok(csv.includes("100.00"), "csv debit 100.00");
  ok(csv.includes("-100.00"), "csv credit -100.00");

  // rebalance: balanced → no warning
  {
    const w: string[] = [];
    const bal = [...lines];
    rebalance(bal, DEFAULT_ACCOUNTING_SETTINGS, w);
    ok(w.length === 0, "balanced no warning");
  }

  // rebalance: drop discount lines
  {
    const settings = { ...DEFAULT_ACCOUNTING_SETTINGS, glDiscounts: "5000" };
    const w: string[] = [];
    const ls: JournalLine[] = [
      { date: "01/07/2025", reference: "GW-1", transactionNumber: 1, glAccountId: "1000", description: "Cash", amountMinor: 10000 },
      { date: "01/07/2025", reference: "GW-1", transactionNumber: 1, glAccountId: "4000", description: "Sales", amountMinor: -10000 },
      { date: "01/07/2025", reference: "GW-1", transactionNumber: 1, glAccountId: "5000", description: "Sales discounts", amountMinor: -200 },
    ];
    rebalance(ls, settings, w);
    ok(ls.length === 2, "discount line removed");
    // Remaining 10000 + (-10000) = 0 → still balanced, so no warning.
    ok(w.length === 0, "still balanced after discount removal");
  }

  // rebalance: genuinely unbalanced entry warns
  {
    const w: string[] = [];
    const ls: JournalLine[] = [
      { date: "01/07/2025", reference: "GW-1", transactionNumber: 1, glAccountId: "1000", description: "Cash", amountMinor: 10000 },
      { date: "01/07/2025", reference: "GW-1", transactionNumber: 1, glAccountId: "4000", description: "Sales", amountMinor: -9999 },
    ];
    rebalance(ls, DEFAULT_ACCOUNTING_SETTINGS, w);
    ok(w.length === 1, "rounding imbalance warned");
  }

  // missingGlAccounts
  ok(missingGlAccounts(DEFAULT_ACCOUNTING_SETTINGS).length === 3, "all 3 required missing");
  ok(
    missingGlAccounts({
      ...DEFAULT_ACCOUNTING_SETTINGS,
      glCashClearing: "1000",
      glSalesCannabis: "4000",
      glSalesTaxPayable: "2200",
    }).length === 0,
    "none missing when set",
  );

  console.log(`sage50-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`${fail} sage50-core tests failed`);
}
