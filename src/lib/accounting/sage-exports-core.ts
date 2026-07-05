/**
 * src/lib/accounting/sage-exports-core.ts
 *
 * PURE Sage 50 export builders (no server-only, no DB) for the data types the
 * back office actually holds:
 *
 *   • Cash Receipts Journal (RECEIPTS.CSV)   — daily category sales + taxes,
 *     plus the separate daily COGS receipts, matching the owner's REAL books
 *     (verified against his own Sage RECEIPTS_JOURNAL export).
 *   • Purchases Journal (PURCHASE.CSV)       — vendor invoices from accepted
 *     inbound manifests.
 *   • Payments Journal (PAYMENTS.CSV)        — vendor payments applied to
 *     manifests.
 *   • Inventory adjustments as a GENERAL JOURNAL file — the back office has no
 *     Sage Item IDs (required by ADJUST.CSV), so adjustments are booked as
 *     balanced GL entries (debit source/COGS, credit inventory) instead.
 *   • Vendor List (VENDOR.CSV)               — vendors that have a Sage ID.
 *
 * Every field name, order, and format rule below comes from the official Sage
 * 50 import specifications (see docs/sage50-knowledge.md for citations):
 *   - Dates must be month/day/yr (##/##/##).
 *   - Positive Amount = debit, negative = credit.
 *   - Text must not contain double quotes.
 *   - Only import-enabled fields are emitted, in the canonical field order, so
 *     the Fields tab can be matched exactly (with First Row Contains Headings).
 *
 * Money is handled in MINOR UNITS (cents) and emitted as decimal dollars.
 */

import { dollars, csvCell, clean } from "@/lib/accounting/sage50-core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The seven category buckets in the owner's Sage company. */
export const SAGE_BUCKETS = [
  "concentrate",
  "edible",
  "flower",
  "liquid",
  "non_cannabis",
  "preroll",
  "topical",
] as const;
export type SageBucket = (typeof SAGE_BUCKETS)[number];

export function isSageBucket(v: string): v is SageBucket {
  return (SAGE_BUCKETS as readonly string[]).includes(v);
}

/** Per-bucket Sage mapping (from sage_category_accounts). */
export type SageCategoryAccount = {
  bucket: SageBucket;
  label: string; // e.g. "FLOWER"
  salesCustomerId: string; // e.g. "01-FLOWER"
  cogsCustomerId: string; // e.g. "07-FLOWER"
  glSales: string; // e.g. "50002-GRNWY"
  glCogs: string; // e.g. "60002-GRNWY"
  glInventory: string; // e.g. "20002-GRNWY"
  isCannabis: boolean;
};

/** Store-wide Sage export settings (accounting_settings, migration 0091). */
export type SageExportSettings = {
  glApAccount: string; // e.g. "30000-GRNWY"
  glBankAccount: string; // e.g. "10005-GRNWY" (checking)
  glPurchasesDefault: string; // e.g. "20009-GRNWY"
  glCashOnHand: string; // e.g. "10000-GRNWY"
  glExciseTaxPayable: string; // e.g. "31000-GRNWY"
  glSalesTaxPayable: string; // e.g. "31001-GRNWY"
  salesTaxIdCannabis: string; // e.g. "WA_LCB01"
  salesTaxIdOther: string; // e.g. "WA_DOR01"
};

export const DEFAULT_SAGE_EXPORT_SETTINGS: SageExportSettings = {
  glApAccount: "",
  glBankAccount: "",
  glPurchasesDefault: "",
  glCashOnHand: "",
  glExciseTaxPayable: "",
  glSalesTaxPayable: "",
  salesTaxIdCannabis: "",
  salesTaxIdOther: "",
};

/** One business day × bucket of summarized sales (minor units). */
export type DayBucketSales = {
  date: string; // YYYY-MM-DD (Pacific business day)
  bucket: SageBucket;
  units: number; // units sold
  salesMinor: number; // pre-tax, post-discount base
  exciseMinor: number; // 37% cannabis excise (0 for non-cannabis)
  stateTaxMinor: number; // state sales tax portion
  localTaxMinor: number; // local sales tax portion
  cogsMinor: number; // weighted-average cost of the units sold
};

export type SageCsvResult = {
  csv: string;
  fileName: string;
  /** Number of Sage transactions (receipts / invoices / payments / entries). */
  transactionCount: number;
  /** Number of CSV data rows. */
  rowCount: number;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Date helpers — Sage import spec: dates must be ##/##/## (month/day/yr).
// ---------------------------------------------------------------------------

/** YYYY-MM-DD → M/D/YY (matches the owner's Sage exports, e.g. "1/1/26"). */
export function mdyy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
}

/** YYYY-MM-DD → M/D/YYYY (used for Reference, matching his books). */
export function mdyyyy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}/${y}`;
}

/** Timestamped export file name, e.g. Sage50_Receipts_20250107.csv */
export function sageFileName(kind: string, date: Date = new Date()): string {
  const ts =
    date.getUTCFullYear().toString() +
    String(date.getUTCMonth() + 1).padStart(2, "0") +
    String(date.getUTCDate()).padStart(2, "0");
  return `Sage50_${kind}_${ts}.csv`;
}

/** Unit price as dollars with 2 decimals; 0 when qty is 0. */
function unitPrice(amountMinor: number, qty: number): string {
  if (!qty) return "0.00";
  return (amountMinor / 100 / qty).toFixed(2);
}

// ---------------------------------------------------------------------------
// 1) Cash Receipts Journal (RECEIPTS.CSV) — "Apply to Revenues" receipts.
//
// Import-enabled fields, in canonical spec order:
//   Customer ID, Reference, Date, Payment Method, Cash Account, Sales Tax ID,
//   Number of Distributions, Quantity, Description, G/L Account, Unit Price,
//   Tax Type, Amount
// Header fields repeat on every distribution row (as in Sage's own exports).
// ---------------------------------------------------------------------------

export const RECEIPTS_HEADER = [
  "Customer ID",
  "Reference",
  "Date",
  "Payment Method",
  "Cash Account",
  "Sales Tax ID",
  "Number of Distributions",
  "Quantity",
  "Description",
  "G/L Account",
  "Unit Price",
  "Tax Type",
  "Amount",
].join(",");

export function buildCashReceiptsCsv(
  rows: DayBucketSales[],
  accounts: Partial<Record<SageBucket, SageCategoryAccount>>,
  settings: SageExportSettings,
): SageCsvResult {
  const warnings: string[] = [];
  const out: string[] = [RECEIPTS_HEADER];
  let receipts = 0;

  const missing: string[] = [];
  if (!settings.glCashOnHand) missing.push("Cash on hand");
  if (!settings.glExciseTaxPayable) missing.push("Excise tax payable");
  if (!settings.glSalesTaxPayable) missing.push("Sales tax payable");
  if (missing.length) {
    warnings.push(`Set these accounts in Accounting settings before importing: ${missing.join(", ")}.`);
  }

  // Stable ordering: by day, then bucket.
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.bucket.localeCompare(b.bucket));

  const skippedBuckets = new Set<string>();
  for (const r of sorted) {
    const acct = accounts[r.bucket];
    if (!acct || !acct.salesCustomerId || !acct.glSales) {
      skippedBuckets.add(r.bucket);
      continue;
    }
    const date = mdyy(r.date);
    const ref = mdyyyy(r.date);
    const taxId = acct.isCannabis ? settings.salesTaxIdCannabis : settings.salesTaxIdOther;

    // ── Sales receipt (01-XXX): excise (cannabis only) + local + state + sales
    const dists: { qty: number; desc: string; gl: string; unit: string; taxType: number; amountMinor: number }[] = [];
    if (acct.isCannabis && r.exciseMinor !== 0) {
      dists.push({ qty: 0, desc: "WA LIQUOR & CANNABIS BOARD", gl: settings.glExciseTaxPayable, unit: "0.00", taxType: 0, amountMinor: -r.exciseMinor });
    }
    if (r.localTaxMinor !== 0) {
      dists.push({ qty: 0, desc: "LOCAL SALES TAX", gl: settings.glSalesTaxPayable, unit: "0.00", taxType: 0, amountMinor: -r.localTaxMinor });
    }
    if (r.stateTaxMinor !== 0) {
      dists.push({ qty: 0, desc: "STATE SALES TAX", gl: settings.glSalesTaxPayable, unit: "0.00", taxType: 0, amountMinor: -r.stateTaxMinor });
    }
    if (r.salesMinor !== 0) {
      dists.push({ qty: r.units, desc: "SALES", gl: acct.glSales, unit: unitPrice(r.salesMinor, r.units), taxType: 1, amountMinor: -r.salesMinor });
    }
    if (dists.length > 0) {
      receipts += 1;
      for (const d of dists) {
        out.push(
          [
            csvCell(acct.salesCustomerId),
            csvCell(ref),
            date,
            "Cash",
            csvCell(settings.glCashOnHand),
            csvCell(taxId),
            dists.length,
            d.qty.toFixed(2),
            csvCell(clean(d.desc)),
            csvCell(d.gl),
            d.unit,
            d.taxType,
            dollars(d.amountMinor),
          ].join(","),
        );
      }
    }

    // ── COGS receipt (07-XXX): "cash account" = COGS (debit), credit inventory.
    if (r.cogsMinor > 0 && acct.cogsCustomerId && acct.glCogs && acct.glInventory) {
      receipts += 1;
      out.push(
        [
          csvCell(acct.cogsCustomerId),
          csvCell(ref),
          date,
          "Cash",
          csvCell(acct.glCogs),
          "", // no sales tax on the COGS move
          1,
          r.units.toFixed(2),
          csvCell(clean(`${acct.label || r.bucket.toUpperCase()} COGS`)),
          csvCell(acct.glInventory),
          unitPrice(r.cogsMinor, r.units),
          1,
          dollars(-r.cogsMinor),
        ].join(","),
      );
    } else if (r.cogsMinor > 0) {
      skippedBuckets.add(`${r.bucket} (COGS mapping incomplete)`);
    }
  }

  if (skippedBuckets.size > 0) {
    warnings.push(
      `Skipped buckets with incomplete Sage mapping: ${[...skippedBuckets].sort().join(", ")}. Fix them in the Sage category mapping.`,
    );
  }

  return {
    csv: out.join("\n"),
    fileName: sageFileName("Receipts"),
    transactionCount: receipts,
    rowCount: out.length - 1,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 2) Purchases Journal (PURCHASE.CSV) — vendor invoices (accepted manifests).
//
// Import-enabled fields, canonical order:
//   Vendor ID, Invoice #, Date, Date Due, Accounts Payable Account,
//   Number of Distributions, Quantity, Description, G/L Account, Unit Price,
//   Amount
// ---------------------------------------------------------------------------

export const PURCHASES_HEADER = [
  "Vendor ID",
  "Invoice #",
  "Date",
  "Date Due",
  "Accounts Payable Account",
  "Number of Distributions",
  "Quantity",
  "Description",
  "G/L Account",
  "Unit Price",
  "Amount",
].join(",");

export type PurchaseInvoiceLine = {
  qty: number;
  description: string;
  glAccount: string;
  unitCostMinor: number;
  amountMinor: number; // positive = debit (inventory/expense)
};

export type PurchaseInvoice = {
  vendorSageId: string; // e.g. "01-TWO HEADS"
  invoiceNumber: string; // manifest number
  date: string; // YYYY-MM-DD
  lines: PurchaseInvoiceLine[];
};

export function buildPurchasesCsv(invoices: PurchaseInvoice[], settings: SageExportSettings): SageCsvResult {
  const warnings: string[] = [];
  const out: string[] = [PURCHASES_HEADER];
  let txns = 0;

  if (!settings.glApAccount) {
    warnings.push("Set the Accounts Payable account in Accounting settings before importing.");
  }

  const seen = new Set<string>();
  const sorted = [...invoices].sort((a, b) => a.date.localeCompare(b.date) || a.invoiceNumber.localeCompare(b.invoiceNumber));
  for (const inv of sorted) {
    if (!inv.vendorSageId || !inv.invoiceNumber || inv.lines.length === 0) continue;
    // Sage rejects duplicate invoice numbers for the same vendor.
    const dupKey = `${inv.vendorSageId}::${inv.invoiceNumber}`.toLowerCase();
    if (seen.has(dupKey)) {
      warnings.push(`Duplicate invoice ${inv.invoiceNumber} for ${inv.vendorSageId} skipped (Sage rejects duplicates per vendor).`);
      continue;
    }
    seen.add(dupKey);
    txns += 1;
    const date = mdyy(inv.date);
    for (const l of inv.lines) {
      out.push(
        [
          csvCell(clean(inv.vendorSageId)),
          csvCell(clean(inv.invoiceNumber)),
          date,
          date, // Date Due — same day (owner pays manifests C.O.D.-style); required so AP aging works
          csvCell(settings.glApAccount),
          inv.lines.length,
          l.qty.toFixed(2),
          csvCell(clean(l.description).slice(0, 160)),
          csvCell(l.glAccount),
          unitPrice(l.amountMinor, l.qty),
          dollars(l.amountMinor),
        ].join(","),
      );
    }
  }

  return {
    csv: out.join("\n"),
    fileName: sageFileName("Purchases"),
    transactionCount: txns,
    rowCount: out.length - 1,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 3) Payments Journal (PAYMENTS.CSV) — vendor payments applied to invoices.
//
// Import-enabled fields, canonical order (matching the owner's own export):
//   Vendor ID, Check Number, Date, Memo, Cash Account,
//   Total Paid on Invoice(s), Detailed Payment, Number of Distributions,
//   Invoice Paid, Discount Amount, Description, G/L Account, Amount,
//   Payment Method
// The distribution debits the AP account (positive amount).
// ---------------------------------------------------------------------------

export const PAYMENTS_HEADER = [
  "Vendor ID",
  "Check Number",
  "Date",
  "Memo",
  "Cash Account",
  "Total Paid on Invoice(s)",
  "Detailed Payment",
  "Number of Distributions",
  "Invoice Paid",
  "Discount Amount",
  "Description",
  "G/L Account",
  "Amount",
  "Payment Method",
].join(",");

export type VendorPaymentRow = {
  vendorSageId: string;
  checkNumber: string; // ACH batch ref or blank
  date: string; // YYYY-MM-DD
  memo: string;
  invoiceNumber: string; // manifest number being paid
  amountMinor: number; // > 0
  /** Must exist in Sage Vendor Defaults (owner uses Cash / Check / Electronic). */
  paymentMethod: string;
};

export function buildPaymentsCsv(payments: VendorPaymentRow[], settings: SageExportSettings): SageCsvResult {
  const warnings: string[] = [];
  const out: string[] = [PAYMENTS_HEADER];
  let txns = 0;

  if (!settings.glApAccount) warnings.push("Set the Accounts Payable account in Accounting settings before importing.");
  if (!settings.glBankAccount) warnings.push("Set the Bank (checking) account in Accounting settings before importing.");

  const sorted = [...payments].sort((a, b) => a.date.localeCompare(b.date) || a.vendorSageId.localeCompare(b.vendorSageId));
  for (const p of sorted) {
    if (!p.vendorSageId || p.amountMinor <= 0) continue;
    txns += 1;
    out.push(
      [
        csvCell(clean(p.vendorSageId)),
        csvCell(clean(p.checkNumber).slice(0, 20)),
        mdyy(p.date),
        csvCell(clean(p.memo).slice(0, 30)),
        csvCell(settings.glBankAccount),
        dollars(p.amountMinor),
        "Yes",
        1,
        csvCell(clean(p.invoiceNumber).slice(0, 20)),
        "0.00",
        "",
        csvCell(settings.glApAccount),
        dollars(p.amountMinor),
        csvCell(clean(p.paymentMethod)),
      ].join(","),
    );
  }

  return {
    csv: out.join("\n"),
    fileName: sageFileName("Payments"),
    transactionCount: txns,
    rowCount: out.length - 1,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 4) Inventory adjustments — as a GENERAL JOURNAL import file.
//
// WHY not ADJUST.CSV: Sage's Inventory Adjustments import REQUIRES a Sage
// Item ID for every row, and the back office has no mapping to Sage item ids
// (the owner's Sage items are ids like "A-01"). Per the owner's rule — if the
// back office doesn't have the info, don't fake it — adjustments are exported
// as balanced GL entries instead: debit the source/COGS account, credit the
// bucket's inventory account (reversed when stock is added).
//
// General Journal import-enabled fields (canonical order):
//   Date, Reference, Number of Distributions, G/L Account, Description,
//   Amount, Recur Number, Recur Frequency
// ---------------------------------------------------------------------------

export const GJ_IMPORT_HEADER = [
  "Date",
  "Reference",
  "Number of Distributions",
  "G/L Account",
  "Description",
  "Amount",
  "Recur Number",
  "Recur Frequency",
].join(",");

export type AdjustmentGjEntry = {
  date: string; // YYYY-MM-DD
  reference: string; // ≤ 20 chars
  description: string;
  glSource: string; // debit side for shrink (usually the bucket COGS account)
  glInventory: string; // credit side for shrink (bucket inventory account)
  /** Positive cost value of the adjusted stock, in minor units. */
  valueMinor: number;
  /** Signed quantity delta; negative = stock removed (shrink/damage/etc). */
  qtyDelta: number;
};

export function buildAdjustmentsGjCsv(entries: AdjustmentGjEntry[]): SageCsvResult {
  const warnings: string[] = [];
  const out: string[] = [GJ_IMPORT_HEADER];
  let txns = 0;

  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const e of sorted) {
    if (e.valueMinor <= 0 || !e.glSource || !e.glInventory || e.qtyDelta === 0) continue;
    txns += 1;
    const date = mdyy(e.date);
    const ref = clean(e.reference).slice(0, 20);
    const desc = clean(e.description).slice(0, 160);
    // Shrink (qty down): DR source/COGS, CR inventory. Stock added: reversed.
    const drAccount = e.qtyDelta < 0 ? e.glSource : e.glInventory;
    const crAccount = e.qtyDelta < 0 ? e.glInventory : e.glSource;
    const line = (gl: string, amountMinor: number) =>
      out.push([date, csvCell(ref), 2, csvCell(gl), csvCell(desc), dollars(amountMinor), 0, 0].join(","));
    line(drAccount, e.valueMinor);
    line(crAccount, -e.valueMinor);
  }

  return {
    csv: out.join("\n"),
    fileName: sageFileName("InventoryAdjustments_GJ"),
    transactionCount: txns,
    rowCount: out.length - 1,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 5) Vendor List (VENDOR.CSV) — vendors that already have a Sage Vendor ID.
//
// Import-enabled fields we hold data for (canonical order from the owner's
// VENDORS.CSV export / official Vendor List spec):
//   Vendor ID, Vendor Name, Contact, Address-Line One, Address-Line Two,
//   City, State, Zip, Telephone 1, Vendor E-mail, Vendor Web Site
// ---------------------------------------------------------------------------

export const VENDOR_LIST_HEADER = [
  "Vendor ID",
  "Vendor Name",
  "Contact",
  "Address-Line One",
  "Address-Line Two",
  "City",
  "State",
  "Zip",
  "Telephone 1",
  "Vendor E-mail",
  "Vendor Web Site",
].join(",");

export type SageVendorListRow = {
  sageVendorId: string;
  name: string;
  contact: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  website: string;
};

export function buildVendorListCsv(rows: SageVendorListRow[]): SageCsvResult {
  const out: string[] = [VENDOR_LIST_HEADER];
  const sorted = [...rows].sort((a, b) => a.sageVendorId.localeCompare(b.sageVendorId));
  let count = 0;
  for (const v of sorted) {
    if (!v.sageVendorId || !v.name) continue;
    count += 1;
    out.push(
      [
        csvCell(clean(v.sageVendorId).slice(0, 20)),
        csvCell(clean(v.name).slice(0, 39)),
        csvCell(clean(v.contact)),
        csvCell(clean(v.address1).slice(0, 30)),
        csvCell(clean(v.address2).slice(0, 30)),
        csvCell(clean(v.city).slice(0, 20)),
        csvCell(clean(v.state).slice(0, 2)),
        csvCell(clean(v.zip).slice(0, 12)),
        csvCell(clean(v.phone)),
        csvCell(clean(v.email)),
        csvCell(clean(v.website)),
      ].join(","),
    );
  }
  return {
    csv: out.join("\n"),
    fileName: sageFileName("VendorList"),
    transactionCount: count,
    rowCount: out.length - 1,
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// Category normalization: back-office menu category → lookup key.
// ---------------------------------------------------------------------------

/** Normalize a menu category for sage_category_map lookup (lowercase, trimmed). */
export function normalizeCategory(category: string): string {
  return category.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runSageExportsCoreTests(): void {
  let pass = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    pass += 1;
  };

  // date helpers
  ok(mdyy("2026-01-01") === "1/1/26", "mdyy");
  ok(mdyy("2025-12-09") === "12/9/25", "mdyy no leading zeros");
  ok(mdyyyy("2026-01-02") === "1/2/2026", "mdyyyy");
  ok(sageFileName("Receipts", new Date(Date.UTC(2025, 0, 7))) === "Sage50_Receipts_20250107.csv", "file name");

  const settings: SageExportSettings = {
    glApAccount: "30000-GRNWY",
    glBankAccount: "10005-GRNWY",
    glPurchasesDefault: "20009-GRNWY",
    glCashOnHand: "10000-GRNWY",
    glExciseTaxPayable: "31000-GRNWY",
    glSalesTaxPayable: "31001-GRNWY",
    salesTaxIdCannabis: "WA_LCB01",
    salesTaxIdOther: "WA_DOR01",
  };
  const flower: SageCategoryAccount = {
    bucket: "flower",
    label: "FLOWER",
    salesCustomerId: "01-FLOWER",
    cogsCustomerId: "07-FLOWER",
    glSales: "50002-GRNWY",
    glCogs: "60002-GRNWY",
    glInventory: "20002-GRNWY",
    isCannabis: true,
  };

  // ── Cash receipts: one cannabis day-bucket → 4-dist sales receipt + COGS receipt
  {
    const res = buildCashReceiptsCsv(
      [
        {
          date: "2026-01-01",
          bucket: "flower",
          units: 42,
          salesMinor: 93632,
          exciseMinor: 34644,
          stateTaxMinor: 6086,
          localTaxMinor: 2622,
          cogsMinor: 54360,
        },
      ],
      { flower },
      settings,
    );
    ok(res.transactionCount === 2, "receipts: 2 receipts (sales + cogs)");
    ok(res.rowCount === 5, "receipts: 4 sales dists + 1 cogs dist");
    const lines = res.csv.split("\n");
    ok(lines[0] === RECEIPTS_HEADER, "receipts header");
    ok(lines[1].startsWith("01-FLOWER,1/1/2026,1/1/26,Cash,10000-GRNWY,WA_LCB01,4,"), "receipts sales header fields");
    ok(lines[1].includes("WA LIQUOR & CANNABIS BOARD,31000-GRNWY") && lines[1].endsWith("-346.44"), "excise line");
    ok(lines[2].includes("LOCAL SALES TAX,31001-GRNWY") && lines[2].endsWith("-26.22"), "local tax line");
    ok(lines[3].includes("STATE SALES TAX,31001-GRNWY") && lines[3].endsWith("-60.86"), "state tax line");
    ok(lines[4].includes("SALES,50002-GRNWY,22.29,1,-936.32"), "sales line w/ unit price + tax type");
    ok(lines[5].startsWith("07-FLOWER,1/1/2026,1/1/26,Cash,60002-GRNWY,,1,42.00,FLOWER COGS,20002-GRNWY,12.94,1,-543.60"), "cogs receipt");
    ok(res.warnings.length === 0, "receipts no warnings");
  }

  // ── Cash receipts: non-cannabis bucket has no excise line (3 distributions)
  {
    const nc: SageCategoryAccount = { ...flower, bucket: "non_cannabis", label: "NON-CANNABIS", salesCustomerId: "01-NON CANNABIS", cogsCustomerId: "07-NON CANNABIS", glSales: "50004-GRNWY", glCogs: "60004-GRNWY", glInventory: "20004-GRNWY", isCannabis: false };
    const res = buildCashReceiptsCsv(
      [{ date: "2026-01-01", bucket: "non_cannabis", units: 12, salesMinor: 9249, exciseMinor: 0, stateTaxMinor: 601, localTaxMinor: 259, cogsMinor: 0 }],
      { non_cannabis: nc },
      settings,
    );
    ok(res.rowCount === 3, "non-cannabis: 3 dists, no excise");
    ok(res.csv.includes("WA_DOR01,3,"), "non-cannabis uses other tax id");
    ok(!res.csv.includes("LIQUOR"), "non-cannabis has no excise line");
  }

  // ── Cash receipts: unmapped bucket → skipped + warning
  {
    const res = buildCashReceiptsCsv(
      [{ date: "2026-01-01", bucket: "edible", units: 1, salesMinor: 100, exciseMinor: 37, stateTaxMinor: 7, localTaxMinor: 3, cogsMinor: 50 }],
      {},
      settings,
    );
    ok(res.rowCount === 0, "unmapped bucket emits nothing");
    ok(res.warnings.some((w) => w.includes("edible")), "unmapped bucket warned");
  }

  // ── Purchases
  {
    const res = buildPurchasesCsv(
      [
        {
          vendorSageId: "01-TWO HEADS",
          invoiceNumber: "M-12345",
          date: "2026-01-05",
          lines: [
            { qty: 10, description: "BLUE DREAM 1G", glAccount: "20009-GRNWY", unitCostMinor: 500, amountMinor: 5000 },
            { qty: 5, description: "OG KUSH 3.5G", glAccount: "20009-GRNWY", unitCostMinor: 1200, amountMinor: 6000 },
          ],
        },
      ],
      settings,
    );
    ok(res.transactionCount === 1, "purchases: 1 invoice");
    ok(res.rowCount === 2, "purchases: 2 lines");
    const l = res.csv.split("\n");
    ok(l[0] === PURCHASES_HEADER, "purchases header");
    ok(l[1].startsWith("01-TWO HEADS,M-12345,1/5/26,1/5/26,30000-GRNWY,2,10.00,BLUE DREAM 1G,20009-GRNWY,5.00,50.00"), "purchases line");
  }

  // ── Purchases: duplicate invoice per vendor skipped with warning
  {
    const inv: PurchaseInvoice = {
      vendorSageId: "01-X",
      invoiceNumber: "A1",
      date: "2026-01-05",
      lines: [{ qty: 1, description: "x", glAccount: "20009-GRNWY", unitCostMinor: 100, amountMinor: 100 }],
    };
    const res = buildPurchasesCsv([inv, { ...inv }], settings);
    ok(res.transactionCount === 1, "duplicate invoice skipped");
    ok(res.warnings.some((w) => w.includes("Duplicate invoice")), "duplicate warned");
  }

  // ── Payments
  {
    const res = buildPaymentsCsv(
      [
        {
          vendorSageId: "01-SKORD",
          checkNumber: "ACH-2026-01",
          date: "2026-01-02",
          memo: "Manifest 19584",
          invoiceNumber: "19584",
          amountMinor: 169500,
          paymentMethod: "Electronic",
        },
      ],
      settings,
    );
    ok(res.transactionCount === 1, "payments: 1 payment");
    const l = res.csv.split("\n");
    ok(l[0] === PAYMENTS_HEADER, "payments header");
    ok(
      l[1] === "01-SKORD,ACH-2026-01,1/2/26,Manifest 19584,10005-GRNWY,1695.00,Yes,1,19584,0.00,,30000-GRNWY,1695.00,Electronic",
      "payments row",
    );
  }

  // ── Adjustments GJ: shrink debits COGS, credits inventory; balanced
  {
    const res = buildAdjustmentsGjCsv([
      {
        date: "2026-01-03",
        reference: "ADJ-SHRINK",
        description: "Shrink: BLUE DREAM 1G",
        glSource: "60002-GRNWY",
        glInventory: "20002-GRNWY",
        valueMinor: 1500,
        qtyDelta: -3,
      },
      {
        date: "2026-01-04",
        reference: "ADJ-COUNT",
        description: "Count up: OG KUSH",
        glSource: "60002-GRNWY",
        glInventory: "20002-GRNWY",
        valueMinor: 500,
        qtyDelta: 1,
      },
    ]);
    ok(res.transactionCount === 2, "adjustments: 2 entries");
    ok(res.rowCount === 4, "adjustments: 4 GL lines");
    const l = res.csv.split("\n");
    ok(l[0] === GJ_IMPORT_HEADER, "adjustments GJ header");
    ok(l[1] === "1/3/26,ADJ-SHRINK,2,60002-GRNWY,Shrink: BLUE DREAM 1G,15.00,0,0", "shrink debit COGS");
    ok(l[2].includes("20002-GRNWY") && l[2].includes("-15.00"), "shrink credit inventory");
    ok(l[3].includes("20002-GRNWY") && l[3].includes(",5.00,"), "count-up debit inventory");
    ok(l[4].includes("60002-GRNWY") && l[4].includes("-5.00"), "count-up credit source");
  }

  // ── Vendor list
  {
    const res = buildVendorListCsv([
      {
        sageVendorId: "01-TWO HEADS",
        name: "TWO HEADS FARMS",
        contact: "",
        address1: "123 GROW RD",
        address2: "",
        city: "SEATTLE",
        state: "WA",
        zip: "98101",
        phone: "206-555-0100",
        email: "ap@twoheads.example",
        website: "",
      },
      { sageVendorId: "", name: "NO ID", contact: "", address1: "", address2: "", city: "", state: "", zip: "", phone: "", email: "", website: "" },
    ]);
    ok(res.transactionCount === 1, "vendor list: only vendors with sage id");
    const l = res.csv.split("\n");
    ok(l[0] === VENDOR_LIST_HEADER, "vendor list header");
    ok(l[1].startsWith("01-TWO HEADS,TWO HEADS FARMS,"), "vendor list row");
  }

  // normalizeCategory
  ok(normalizeCategory("  Pre-Roll ") === "pre-roll", "normalizeCategory");
  ok(isSageBucket("flower") && !isSageBucket("vape"), "isSageBucket");

  console.log(`sage-exports-core: ${pass} assertions passed`);
}
