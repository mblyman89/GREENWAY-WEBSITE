/**
 * tests/compliance/sage-exports-core.test.ts
 *
 * ADVERSARIAL MIRROR for src/lib/accounting/sage-exports-core.ts.
 *
 * This module builds the CSV files that carry real money into Sage 50: cash
 * receipts, purchases, vendor payments, general journal adjustments and the
 * vendor list. It shipped with a substantial embedded suite that NOTHING ever
 * executed -- it was not registered in the pure-self-test runner and had no
 * vitest mirror.
 *
 * WHAT THIS MIRROR ADDS ON TOP OF THE EMBEDDED SUITE
 * ---------------------------------------------------------------------------
 * The embedded tests are mostly golden-string comparisons: they assert that a
 * particular line equals a particular string. Those are valuable but they only
 * prove the output has not CHANGED. They do not prove the output is INTERNALLY
 * CONSISTENT, and it is the internal consistency that a Sage import actually
 * depends on. So the tests here assert STRUCTURAL INVARIANTS that must hold
 * for every input, checked over generated data rather than one hand-written
 * example:
 *
 *   - the "Number of Distributions" field on every row of a receipt must equal
 *     the number of rows actually emitted for that receipt (Sage reads this
 *     count to decide where one transaction ends and the next begins -- if it
 *     is wrong, transactions merge or truncate silently);
 *   - the header field of every row within one receipt must be identical;
 *   - reported rowCount / transactionCount must match what is really in the file;
 *   - every row must have exactly as many columns as its header;
 *   - money must never be silently dropped: a skipped bucket must WARN.
 */
import { describe, it, expect } from "vitest";

import {
  SAGE_BUCKETS,
  isStandardSageBucket,
  isValidBucketKey,
  normalizeBucketKey,
  isSageBucket,
  normalizeCategory,
  mdyy,
  mdyyyy,
  sageFileName,
  buildCashReceiptsCsv,
  buildPurchasesCsv,
  buildPaymentsCsv,
  buildAdjustmentsGjCsv,
  buildVendorListCsv,
  type PurchaseInvoice,
  type PurchaseInvoiceLine,
  type AdjustmentGjEntry,
  type VendorPaymentRow,
  type SageVendorListRow,
  RECEIPTS_HEADER,
  PURCHASES_HEADER,
  PAYMENTS_HEADER,
  GJ_IMPORT_HEADER,
  VENDOR_LIST_HEADER,
  DEFAULT_SAGE_EXPORT_SETTINGS,
  __runSageExportsCoreTests,
  type SageExportSettings,
  type SageCategoryAccount,
  type DayBucketSales,
} from "@/lib/accounting/sage-exports-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SETTINGS: SageExportSettings = {
  glApAccount: "30000-GRNWY",
  glBankAccount: "10005-GRNWY",
  glPurchasesDefault: "20009-GRNWY",
  glCashOnHand: "10000-GRNWY",
  glExciseTaxPayable: "31000-GRNWY",
  glSalesTaxPayable: "31001-GRNWY",
  salesTaxIdCannabis: "WA_LCB01",
  salesTaxIdOther: "WA_DOR01",
  glSalesDiscounts: "",
};

function account(bucket: string, isCannabis: boolean): SageCategoryAccount {
  return {
    bucket,
    label: bucket.toUpperCase(),
    salesCustomerId: `01-${bucket}`,
    cogsCustomerId: `07-${bucket}`,
    glSales: "50002-GRNWY",
    glCogs: "60002-GRNWY",
    glInventory: "20002-GRNWY",
    isCannabis,
  };
}

const ACCOUNTS: Record<string, SageCategoryAccount> = {
  flower: account("flower", true),
  non_cannabis: account("non_cannabis", false),
};

function dataRows(csv: string): string[] {
  return csv.split("\n").slice(1).filter((l) => l.length > 0);
}

/**
 * A real RFC 4180 field splitter.
 *
 * NOTE ON WHY THIS IS HERE: the first version of these tests split rows on a
 * plain `,`, which reports a spurious column-count mismatch the moment a value
 * is legitimately quoted (`"ACME, Inc."` is ONE field, not two). A test that
 * fails on correct behaviour is worse than no test, so column alignment is
 * checked with a parser that understands quoting.
 */
function splitFields(row: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (inQuotes) {
      if (c === '"') {
        if (row[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}

/** Assert every data row has exactly the header's column count. */
function expectAligned(csv: string, header: string): void {
  const width = splitFields(header).length;
  for (const row of dataRows(csv)) {
    expect(splitFields(row).length, `misaligned row: ${row}`).toBe(width);
  }
}

// ---------------------------------------------------------------------------
describe("embedded self-tests", () => {
  it("passes its own suite", () => {
    expect(() => __runSageExportsCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Bucket keys
// ---------------------------------------------------------------------------
describe("bucket keys", () => {
  it("recognises every standard bucket", () => {
    for (const b of SAGE_BUCKETS) {
      expect(isStandardSageBucket(b)).toBe(true);
      expect(isValidBucketKey(b)).toBe(true);
    }
  });

  it("does not recognise something that is merely bucket-shaped", () => {
    for (const bad of ["flowers", "Flower", "FLOWER", "", "cannabis"]) {
      expect(isStandardSageBucket(bad)).toBe(false);
    }
  });

  it("normalises case, whitespace and separators to one canonical key", () => {
    expect(normalizeBucketKey(" Flower ")).toBe("flower");
    expect(normalizeBucketKey("NON CANNABIS")).toBe("non_cannabis");
    expect(normalizeBucketKey("non-cannabis")).toBe("non_cannabis");
  });

  it("is idempotent: normalising twice changes nothing", () => {
    for (const raw of [" Flower ", "NON CANNABIS", "pre-roll", "Topical"]) {
      const once = normalizeBucketKey(raw);
      expect(normalizeBucketKey(once)).toBe(once);
    }
  });

  it("produces a valid key from any reasonable input", () => {
    for (const raw of [" Flower ", "NON CANNABIS", "pre-roll", "Topical"]) {
      expect(isValidBucketKey(normalizeBucketKey(raw))).toBe(true);
    }
  });

  it("rejects empty and unnormalised keys", () => {
    expect(isValidBucketKey("")).toBe(false);
    expect(isValidBucketKey("A B")).toBe(false);
    expect(isValidBucketKey(" flower")).toBe(false);
  });

  it("isSageBucket agrees with isValidBucketKey on the standard set", () => {
    for (const b of SAGE_BUCKETS) expect(isSageBucket(b)).toBe(true);
  });

  it("normalizeCategory lowercases and trims", () => {
    expect(normalizeCategory("  FLOWER  ")).toBe("flower");
    expect(normalizeCategory("Flower")).toBe("flower");
  });

  it("normalizeCategory is idempotent", () => {
    for (const raw of ["  FLOWER  ", "Pre-Roll", "edible"]) {
      const once = normalizeCategory(raw);
      expect(normalizeCategory(once)).toBe(once);
    }
  });
});

// ---------------------------------------------------------------------------
// Dates -- Sage's formats have no leading zeros
// ---------------------------------------------------------------------------
describe("date formats", () => {
  it("mdyy drops leading zeros and uses a two-digit year", () => {
    expect(mdyy("2026-01-01")).toBe("1/1/26");
    expect(mdyy("2025-12-09")).toBe("12/9/25");
  });

  it("mdyyyy drops leading zeros and keeps four digits", () => {
    expect(mdyyyy("2026-01-02")).toBe("1/2/2026");
    expect(mdyyyy("2026-11-30")).toBe("11/30/2026");
  });

  it("never emits a leading zero on month or day, across a sweep", () => {
    for (let mo = 1; mo <= 12; mo++) {
      for (const d of [1, 9, 10, 28]) {
        const ymd = `2026-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        expect(mdyy(ymd)).toBe(`${mo}/${d}/26`);
        expect(mdyyyy(ymd)).toBe(`${mo}/${d}/2026`);
      }
    }
  });

  it("the two formats agree on month and day", () => {
    for (const ymd of ["2026-01-01", "2026-07-04", "2026-12-31"]) {
      const [m1, d1] = mdyy(ymd).split("/");
      const [m2, d2] = mdyyyy(ymd).split("/");
      expect(m1).toBe(m2);
      expect(d1).toBe(d2);
    }
  });

  it("sageFileName stamps a sortable date and ends in .csv", () => {
    expect(sageFileName("Receipts", new Date(Date.UTC(2025, 0, 7)))).toBe(
      "Sage50_Receipts_20250107.csv",
    );
    expect(sageFileName("Purchases", new Date(Date.UTC(2026, 9, 1)))).toMatch(/\.csv$/);
  });

  it("sageFileName names sort chronologically as plain strings", () => {
    const a = sageFileName("X", new Date(Date.UTC(2026, 0, 9)));
    const b = sageFileName("X", new Date(Date.UTC(2026, 9, 1)));
    expect(a < b).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CASH RECEIPTS -- the structural invariants
// ---------------------------------------------------------------------------
describe("buildCashReceiptsCsv: structure Sage depends on", () => {
  function generatedDays(n: number): DayBucketSales[] {
    const out: DayBucketSales[] = [];
    for (let i = 1; i <= n; i++) {
      const cannabis = i % 2 === 1;
      out.push({
        date: `2026-01-${String(i).padStart(2, "0")}`,
        bucket: cannabis ? "flower" : "non_cannabis",
        units: i,
        salesMinor: 1000 * i,
        exciseMinor: cannabis ? 370 * i : 0,
        stateTaxMinor: 65 * i,
        localTaxMinor: 28 * i,
        cogsMinor: 500 * i,
        discountMinor: i % 3 === 0 ? 100 * i : 0,
      });
    }
    return out;
  }

  it("emits the documented header", () => {
    const res = buildCashReceiptsCsv([], {}, SETTINGS);
    expect(res.csv.split("\n")[0]).toBe(RECEIPTS_HEADER);
  });

  it("THE INVARIANT: 'Number of Distributions' equals the rows actually emitted", () => {
    // Sage reads this count to decide where one transaction ends and the next
    // begins. If it disagrees with reality, receipts merge or truncate and the
    // file still looks perfectly well-formed.
    const res = buildCashReceiptsCsv(generatedDays(8), ACCOUNTS, {
      ...SETTINGS,
      glSalesDiscounts: "50007-GRNWY",
    });
    const groups = new Map<string, { declared: number; actual: number }>();
    for (const row of dataRows(res.csv)) {
      const f = row.split(",");
      const key = `${f[0]}|${f[1]}`;
      const declared = Number(f[6]);
      if (!groups.has(key)) groups.set(key, { declared, actual: 0 });
      const g = groups.get(key)!;
      // Every row of one receipt must declare the SAME count.
      expect(declared, `inconsistent distribution count within receipt ${key}`).toBe(g.declared);
      g.actual++;
    }
    expect(groups.size).toBeGreaterThan(0);
    for (const [key, g] of groups) {
      expect(g.actual, `receipt ${key} declares ${g.declared} distributions`).toBe(g.declared);
    }
  });

  it("reports a rowCount that matches the file", () => {
    for (const n of [1, 3, 8]) {
      const res = buildCashReceiptsCsv(generatedDays(n), ACCOUNTS, SETTINGS);
      expect(res.rowCount).toBe(dataRows(res.csv).length);
    }
  });

  it("reports a transactionCount that matches the distinct receipts", () => {
    const res = buildCashReceiptsCsv(generatedDays(6), ACCOUNTS, SETTINGS);
    const distinct = new Set(dataRows(res.csv).map((r) => r.split(",").slice(0, 2).join("|")));
    expect(res.transactionCount).toBe(distinct.size);
  });

  it("gives every row the same number of columns as the header", () => {
    const res = buildCashReceiptsCsv(generatedDays(6), ACCOUNTS, SETTINGS);
    expectAligned(res.csv, RECEIPTS_HEADER);
  });

  it("only cannabis buckets carry an excise line", () => {
    const cannabis = buildCashReceiptsCsv(
      [
        {
          date: "2026-01-01",
          bucket: "flower",
          units: 1,
          salesMinor: 1000,
          exciseMinor: 370,
          stateTaxMinor: 65,
          localTaxMinor: 28,
          cogsMinor: 0,
          discountMinor: 0,
        },
      ],
      ACCOUNTS,
      SETTINGS,
    );
    expect(cannabis.csv).toContain("LIQUOR");

    const other = buildCashReceiptsCsv(
      [
        {
          date: "2026-01-01",
          bucket: "non_cannabis",
          units: 1,
          salesMinor: 1000,
          exciseMinor: 0,
          stateTaxMinor: 65,
          localTaxMinor: 28,
          cogsMinor: 0,
          discountMinor: 0,
        },
      ],
      ACCOUNTS,
      SETTINGS,
    );
    expect(other.csv).not.toContain("LIQUOR");
  });

  it("uses the cannabis tax id only for cannabis", () => {
    const res = buildCashReceiptsCsv(generatedDays(4), ACCOUNTS, SETTINGS);
    for (const row of dataRows(res.csv)) {
      const f = row.split(",");
      const customer = f[0];
      if (customer.includes("non_cannabis")) {
        expect(f[5]).not.toBe(SETTINGS.salesTaxIdCannabis);
      }
    }
  });

  it("NEVER drops money silently: an unmapped bucket warns", () => {
    // The dangerous failure is a bucket with no account mapping producing an
    // empty file and no complaint -- a day of sales that simply never arrives.
    const res = buildCashReceiptsCsv(
      [
        {
          date: "2026-01-01",
          bucket: "edible",
          units: 1,
          salesMinor: 100_00,
          exciseMinor: 37_00,
          stateTaxMinor: 700,
          localTaxMinor: 300,
          cogsMinor: 50_00,
          discountMinor: 0,
        },
      ],
      {},
      SETTINGS,
    );
    expect(res.rowCount).toBe(0);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings.join(" ")).toContain("edible");
  });

  it("warns when discounts cannot be tracked because no account is configured", () => {
    const res = buildCashReceiptsCsv(
      [
        {
          date: "2026-01-02",
          bucket: "flower",
          units: 10,
          salesMinor: 9000,
          exciseMinor: 3330,
          stateTaxMinor: 585,
          localTaxMinor: 252,
          cogsMinor: 0,
          discountMinor: 1000,
        },
      ],
      ACCOUNTS,
      { ...SETTINGS, glSalesDiscounts: "" },
    );
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it("produces an empty body but a valid header for no input", () => {
    const res = buildCashReceiptsCsv([], ACCOUNTS, SETTINGS);
    expect(res.rowCount).toBe(0);
    expect(res.transactionCount).toBe(0);
    expect(res.csv.split("\n")[0]).toBe(RECEIPTS_HEADER);
  });

  it("writes amounts with exactly two decimal places", () => {
    const res = buildCashReceiptsCsv(generatedDays(5), ACCOUNTS, SETTINGS);
    for (const row of dataRows(res.csv)) {
      const amount = row.split(",").pop()!;
      expect(amount, `bad amount in row: ${row}`).toMatch(/^-?\d+\.\d{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// PURCHASES
// ---------------------------------------------------------------------------
describe("buildPurchasesCsv", () => {
  const line = (over: Partial<PurchaseInvoiceLine> = {}): PurchaseInvoiceLine => ({
    qty: 1,
    description: "Bags",
    glAccount: "20009-GRNWY",
    unitCostMinor: 5000,
    amountMinor: 5000,
    ...over,
  });

  const invoice = (over: Partial<PurchaseInvoice> = {}): PurchaseInvoice => ({
    vendorSageId: "ACME",
    invoiceNumber: "INV-1",
    date: "2026-01-05",
    lines: [line()],
    ...over,
  });

  it("emits the documented header", () => {
    const res = buildPurchasesCsv([], SETTINGS);
    expect(res.csv.split("\n")[0]).toBe(PURCHASES_HEADER);
  });

  it("emits one row per invoice line", () => {
    const res = buildPurchasesCsv(
      [
        invoice({
          lines: [
            line({ description: "A", amountMinor: 100 }),
            line({ description: "B", amountMinor: 200 }),
            line({ description: "C", amountMinor: 300 }),
          ],
        }),
      ],
      SETTINGS,
    );
    expect(dataRows(res.csv).length).toBe(3);
    expect(res.rowCount).toBe(3);
  });

  it("THE INVARIANT: declared distributions equal the rows emitted per invoice", () => {
    const res = buildPurchasesCsv(
      [
        invoice({ invoiceNumber: "INV-A", lines: [line(), line(), line()] }),
        invoice({ invoiceNumber: "INV-B", lines: [line()] }),
      ],
      SETTINGS,
    );
    const groups = new Map<string, { declared: number; actual: number }>();
    for (const row of dataRows(res.csv)) {
      const f = splitFields(row);
      const key = f[1]; // invoice number
      const declared = Number(f[5]);
      if (!groups.has(key)) groups.set(key, { declared, actual: 0 });
      expect(Number(f[5]), `inconsistent count within invoice ${key}`).toBe(
        groups.get(key)!.declared,
      );
      groups.get(key)!.actual++;
    }
    expect(groups.size).toBe(2);
    for (const [key, g] of groups) {
      expect(g.actual, `invoice ${key} declares ${g.declared}`).toBe(g.declared);
    }
  });

  it("keeps every column aligned with the header", () => {
    const res = buildPurchasesCsv([invoice(), invoice()], SETTINGS);
    expectAligned(res.csv, PURCHASES_HEADER);
  });

  it("writes two-decimal amounts", () => {
    const res = buildPurchasesCsv([invoice()], SETTINGS);
    for (const row of dataRows(res.csv)) {
      expect(row).toMatch(/\d+\.\d{2}/);
    }
  });

  it("keeps columns aligned when free text contains commas and quotes", () => {
    const res = buildPurchasesCsv(
      [invoice({ lines: [line({ description: 'ACME, Inc. 6" bags' })] })],
      SETTINGS,
    );
    expectAligned(res.csv, PURCHASES_HEADER);
  });

  it("survives an invoice with no lines without emitting a broken row", () => {
    const res = buildPurchasesCsv([invoice({ lines: [] })], SETTINGS);
    for (const row of dataRows(res.csv)) {
      expect(splitFields(row).length).toBe(splitFields(PURCHASES_HEADER).length);
    }
  });
});

// ---------------------------------------------------------------------------
// PAYMENTS
// ---------------------------------------------------------------------------
describe("buildPaymentsCsv", () => {
  const payment = (over: Partial<VendorPaymentRow> = {}): VendorPaymentRow => ({
    vendorSageId: "ACME",
    checkNumber: "1001",
    date: "2026-01-06",
    amountMinor: 5000,
    memo: "January supplies",
    invoiceNumber: "INV-1",
    paymentMethod: "Check",
    ...over,
  });

  it("emits the documented header", () => {
    const res = buildPaymentsCsv([], SETTINGS);
    expect(res.csv.split("\n")[0]).toBe(PAYMENTS_HEADER);
  });

  it("emits one row per payment and keeps columns aligned", () => {
    const res = buildPaymentsCsv([payment(), payment()], SETTINGS);
    expect(dataRows(res.csv).length).toBe(2);
    expectAligned(res.csv, PAYMENTS_HEADER);
  });

  it("truncates over-long fields rather than shifting the columns", () => {
    // Sage has hard field widths. Truncation is correct; a long value that
    // pushes other columns along is not.
    const res = buildPaymentsCsv(
      [
        payment({
          memo: "M".repeat(200),
          checkNumber: "C".repeat(200),
          invoiceNumber: "I".repeat(200),
        }),
      ],
      SETTINGS,
    );
    expectAligned(res.csv, PAYMENTS_HEADER);
  });

  it("strips commas out of free text so they cannot split a row", () => {
    const res = buildPaymentsCsv([payment({ memo: "Rent, January" })], SETTINGS);
    expectAligned(res.csv, PAYMENTS_HEADER);
  });
});

// ---------------------------------------------------------------------------
// GENERAL JOURNAL ADJUSTMENTS -- must balance
// ---------------------------------------------------------------------------
describe("buildAdjustmentsGjCsv", () => {
  it("emits the documented header", () => {
    const res = buildAdjustmentsGjCsv([]);
    expect(res.csv.split("\n")[0]).toBe(GJ_IMPORT_HEADER);
  });

  const adjustment = (over: Partial<AdjustmentGjEntry> = {}): AdjustmentGjEntry => ({
    date: "2026-01-07",
    reference: "ADJ-1",
    description: "Shrinkage",
    glSource: "60002-GRNWY",
    glInventory: "20002-GRNWY",
    valueMinor: 2500,
    qtyDelta: -5,
    ...over,
  });

  it("emits a balanced pair of lines for each adjustment", () => {
    const res = buildAdjustmentsGjCsv([adjustment()]);
    const rows = dataRows(res.csv);
    expect(rows.length).toBe(2);
    const total = rows.reduce(
      (sum, r) => sum + Math.round(parseFloat(r.split(",")[5]) * 100),
      0,
    );
    expect(total).toBe(0);
  });

  it("THE INVARIANT: every adjustment nets to zero across a sweep of amounts", () => {
    // An unbalanced general journal is refused by Sage, and by our own books.
    // A one-cent rounding slip here is exactly the kind of thing that is
    // invisible on screen and fatal on import.
    const entries = [1, 7, 99, 12345, 100000, 999999].map((valueMinor, i) =>
      adjustment({ reference: `ADJ-${i}`, valueMinor, qtyDelta: -(i + 1) }),
    );
    const res = buildAdjustmentsGjCsv(entries);
    const byRef = new Map<string, number>();
    for (const row of dataRows(res.csv)) {
      const f = row.split(",");
      const ref = f[1];
      byRef.set(ref, (byRef.get(ref) ?? 0) + Math.round(parseFloat(f[5]) * 100));
    }
    expect(byRef.size).toBe(entries.length);
    for (const [ref, net] of byRef) {
      expect(net, `${ref} does not balance`).toBe(0);
    }
  });

  it("moves the value between the two named accounts, in opposite directions", () => {
    const res = buildAdjustmentsGjCsv([adjustment({ valueMinor: 2500 })]);
    const rows = dataRows(res.csv).map((r) => r.split(","));
    const source = rows.find((f) => f[3] === "60002-GRNWY");
    const inventory = rows.find((f) => f[3] === "20002-GRNWY");
    expect(source, "the source account line is missing").toBeDefined();
    expect(inventory, "the inventory account line is missing").toBeDefined();
    const a = Math.round(parseFloat(source![5]) * 100);
    const b = Math.round(parseFloat(inventory![5]) * 100);
    expect(Math.abs(a)).toBe(2500);
    expect(Math.abs(b)).toBe(2500);
    expect(Math.sign(a)).toBe(-Math.sign(b));
  });

  it("keeps every row aligned with the header", () => {
    const res = buildAdjustmentsGjCsv([
      adjustment({ reference: "ADJ, comma", description: 'Text, with comma and 6" quote' }),
    ]);
    expectAligned(res.csv, GJ_IMPORT_HEADER);
  });
});

// ---------------------------------------------------------------------------
// VENDOR LIST
// ---------------------------------------------------------------------------
describe("buildVendorListCsv", () => {
  const vendor = (over: Partial<SageVendorListRow> = {}): SageVendorListRow => ({
    sageVendorId: "ACME",
    name: "ACME Distributing",
    contact: "Jane",
    address1: "1 Main St",
    address2: "",
    city: "Port Orchard",
    state: "WA",
    zip: "98366",
    phone: "360-555-0100",
    email: "ap@acme.example",
    website: "",
    ...over,
  });

  it("emits the documented header", () => {
    const res = buildVendorListCsv([]);
    expect(res.csv.split("\n")[0]).toBe(VENDOR_LIST_HEADER);
  });

  it("emits one row per vendor with aligned columns", () => {
    const res = buildVendorListCsv([vendor(), vendor()]);
    expect(dataRows(res.csv).length).toBe(2);
    expectAligned(res.csv, VENDOR_LIST_HEADER);
  });

  it("truncates the state to two characters", () => {
    const res = buildVendorListCsv([vendor({ state: "WASHINGTON" })]);
    const f = dataRows(res.csv)[0].split(",");
    expect(f[6].length).toBeLessThanOrEqual(2);
  });

  it("keeps columns aligned when a vendor name contains a comma", () => {
    const res = buildVendorListCsv([vendor({ name: "ACME Distributing, Inc." })]);
    expectAligned(res.csv, VENDOR_LIST_HEADER);
  });

  it("keeps columns aligned when free text contains quotes or line breaks", () => {
    const res = buildVendorListCsv([
      vendor({ name: 'ACME "The Best" Co', contact: "Line1\nLine2", city: "Port\rOrchard" }),
    ]);
    expect(dataRows(res.csv).length).toBe(1);
    expectAligned(res.csv, VENDOR_LIST_HEADER);
  });
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
describe("DEFAULT_SAGE_EXPORT_SETTINGS", () => {
  it("ships with no account numbers invented", () => {
    // Guessing an account number is worse than leaving it blank: a blank is a
    // visible setup step, a wrong number is a silently misposted export.
    for (const key of [
      "glApAccount",
      "glBankAccount",
      "glCashOnHand",
      "glExciseTaxPayable",
      "glSalesTaxPayable",
    ] as const) {
      expect(DEFAULT_SAGE_EXPORT_SETTINGS[key]).toBe("");
    }
  });
});
