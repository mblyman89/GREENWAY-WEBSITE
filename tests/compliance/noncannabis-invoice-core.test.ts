/**
 * tests/compliance/noncannabis-invoice-core.test.ts
 *
 * Vitest wrapper around the pure non-cannabis paper-invoice core (Task N):
 * invoice-builder validation, cents math, the payment guardrails (same policy
 * as the manifest path) and the unified-payable key encoding.
 */
import { describe, expect, it } from "vitest";
import {
  __runNonCannabisInvoiceTests,
  checkNonCannabisInvoicePayment,
  decodePayableKey,
  encodePayableKey,
  invoiceLineTotal,
  invoiceRemainingOwed,
  invoiceTotalMinorUnits,
  isValidInvoiceDate,
  validateNonCannabisInvoice,
  type NonCannabisInvoiceDraft,
  type NonCannabisInvoicePayable,
} from "@/lib/noncannabis/invoice-core";

const draft = (over: Partial<NonCannabisInvoiceDraft> = {}): NonCannabisInvoiceDraft => ({
  vendorName: "Glass Guy Distribution",
  invoiceNumber: "GG-1042",
  invoiceDate: "2026-02-14",
  lines: [
    { kind: "new", description: "Blue Dot 6in Spoon Pipe", qty: 3, unitCostMinorUnits: 1250, productType: "pipe" },
    { kind: "existing", productId: "p1", description: "Clipper Lighter", qty: 2, unitCostMinorUnits: 500 },
  ],
  ...over,
});

const payable = (over: Partial<NonCannabisInvoicePayable> = {}): NonCannabisInvoicePayable => ({
  invoiceId: "i1",
  invoiceNumber: "GG-1042",
  vendorId: null,
  vendorName: "Glass Guy",
  status: "open",
  totalMinorUnits: 4750,
  paidMinorUnits: 0,
  ...over,
});

describe("noncannabis-invoice-core (paper invoice intake + payable guardrails)", () => {
  it("embedded self-test suite passes", () => {
    expect(() => __runNonCannabisInvoiceTests()).not.toThrow();
  });

  it("totals stay in integer cents", () => {
    expect(invoiceLineTotal({ qty: 3, unitCostMinorUnits: 1250 })).toBe(3750);
    expect(invoiceTotalMinorUnits(draft().lines)).toBe(4750);
    expect(invoiceTotalMinorUnits([])).toBe(0);
  });

  it("validates real calendar dates only", () => {
    expect(isValidInvoiceDate("2026-02-14")).toBe(true);
    expect(isValidInvoiceDate("2026-02-30")).toBe(false);
    expect(isValidInvoiceDate("02/14/2026")).toBe(false);
    expect(isValidInvoiceDate("")).toBe(false);
  });

  it("accepts a well-formed invoice and returns the computed total", () => {
    const v = validateNonCannabisInvoice(draft({ statedTotalMinorUnits: 4750 }));
    expect(v).toEqual({ ok: true, totalMinorUnits: 4750 });
  });

  it("blocks the dangerous drafts with plain-language problems", () => {
    const v = validateNonCannabisInvoice({
      vendorName: "",
      invoiceNumber: " ",
      invoiceDate: "nope",
      lines: [{ kind: "existing", description: "", qty: 1.5 as number, unitCostMinorUnits: -1 }],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.problems.join(" ")).toContain("Vendor name");
      expect(v.problems.join(" ")).toContain("Invoice number");
      expect(v.problems.join(" ")).toContain("Invoice date");
      expect(v.problems.join(" ")).toContain("quantity");
      expect(v.problems.join(" ")).toContain("unit cost");
      expect(v.problems.join(" ")).toContain("pick the existing product");
    }
    expect(validateNonCannabisInvoice(draft({ lines: [] })).ok).toBe(false);
  });

  it("blocks a stated paper total that disagrees with the lines (typo catcher)", () => {
    const v = validateNonCannabisInvoice(draft({ statedTotalMinorUnits: 4700 }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems[0]).toContain("does not match");
  });

  it("payment guardrails mirror the manifest policy exactly", () => {
    const p = payable({ paidMinorUnits: 1000 });
    expect(invoiceRemainingOwed(p)).toBe(3750);
    expect(checkNonCannabisInvoicePayment(p, 3750).severity).toBe("ok");
    expect(checkNonCannabisInvoicePayment(p, 3751).severity).toBe("blocked"); // overpay
    expect(checkNonCannabisInvoicePayment(p, 100).severity).toBe("warning"); // partial
    expect(checkNonCannabisInvoicePayment(p, 0).severity).toBe("blocked");
    expect(checkNonCannabisInvoicePayment(payable({ paidMinorUnits: 4750 }), 1).severity).toBe(
      "blocked",
    ); // fully paid
  });

  it("payable keys round-trip and bare ids stay manifests (back-compat)", () => {
    expect(encodePayableKey("noncannabis_invoice", "x")).toBe("ncinv:x");
    expect(decodePayableKey("ncinv:x")).toEqual({ source: "noncannabis_invoice", id: "x" });
    expect(decodePayableKey("manifest:m")).toEqual({ source: "manifest", id: "m" });
    expect(decodePayableKey("bare-id")).toEqual({ source: "manifest", id: "bare-id" });
  });
});
