/**
 * tests/compliance/email-receipt-core.test.ts
 *
 * Vitest mirror for the B30 digital-receipt pure core. The email receipt
 * renders from the SAME frozen snapshot the paper receipt prints from —
 * these tests pin the privacy contract (one-time use, masked audit, no
 * card details), the strict money validation, and content parity with
 * the paper receipt's conditional rows.
 */
import { describe, expect, it } from "vitest";
import {
  normalizeReceiptEmail,
  maskEmailForAudit,
  validateEmailReceiptSnapshot,
  buildEmailReceiptHtml,
  emailReceiptSubject,
  __runEmailReceiptCoreTests,
} from "@/lib/pos/email-receipt-core";
import type { PosReceiptInput } from "@/lib/pos/receipt-core";

const SNAPSHOT = {
  saleClientUuid: "123e4567-e89b-12d3-a456-426614174000",
  soldAtIso: "2026-02-08T20:15:00.000Z",
  registerLabel: "Register 1",
  lines: [{ productName: "Blue Dream 3.5g", quantity: 2, unitPriceMinor: 2500, regularPriceMinor: 3000 }],
  subtotalMinor: 3417,
  taxMinor: 1583,
  totalMinor: 5000,
  savingsMinor: 1000,
  medicalSavingsMinor: 0,
  medicalSale: false,
  tenderedMinor: 6000,
  changeMinor: 1000,
};

describe("email validation + audit masking", () => {
  it("normalizes and validates pragmatically", () => {
    expect(normalizeReceiptEmail("  Jane.Doe@Gmail.COM ")).toBe("jane.doe@gmail.com");
    expect(normalizeReceiptEmail("no-at-sign.com")).toBeNull();
    expect(normalizeReceiptEmail("a b@c.com")).toBeNull();
    expect(normalizeReceiptEmail("a@nodot")).toBeNull();
    expect(normalizeReceiptEmail("a@do..t.com")).toBeNull();
  });

  it("masks addresses so the full email is never stored", () => {
    expect(maskEmailForAudit("jane@gmail.com")).toBe("j***@gmail.com");
    expect(maskEmailForAudit("bad")).toBe("***");
  });
});

describe("snapshot validation (server-side, strict on money)", () => {
  it("accepts a valid snapshot and floors loyalty points", () => {
    const v = validateEmailReceiptSnapshot({ ...SNAPSHOT, loyalty: { memberLabel: "Jane D.", pointsEarned: 34.9 } });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.receipt.loyalty?.pointsEarned).toBe(34);
  });

  it("refuses fractional cents, bad UUIDs, and empty lines — ALL errors at once", () => {
    expect(validateEmailReceiptSnapshot({ ...SNAPSHOT, totalMinor: 50.5 }).ok).toBe(false);
    expect(validateEmailReceiptSnapshot({ ...SNAPSHOT, saleClientUuid: "nope" }).ok).toBe(false);
    expect(validateEmailReceiptSnapshot({ ...SNAPSHOT, lines: [] }).ok).toBe(false);
    const multi = validateEmailReceiptSnapshot({ ...SNAPSHOT, totalMinor: -1, medicalSale: "yes" });
    expect(multi.ok).toBe(false);
    if (!multi.ok) expect(multi.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("email HTML mirrors the paper receipt", () => {
  const receipt = (() => {
    const v = validateEmailReceiptSnapshot({ ...SNAPSHOT, loyalty: { memberLabel: "Jane D.", pointsEarned: 34 } });
    if (!v.ok) throw new Error("fixture invalid");
    return v.receipt;
  })();

  it("carries the receipt number, lines, totals, savings, loyalty, and warning footer", () => {
    const html = buildEmailReceiptHtml(receipt);
    expect(html).toContain("Receipt 14174000");
    expect(html).toContain("2x Blue Dream 3.5g");
    expect(html).toContain("$50.00");
    expect(html).toContain("You saved");
    expect(html).toContain("Loyalty: Jane D.");
    expect(html).toContain("intoxicating effects");
    expect(html).toContain("did not keep it"); // privacy note
  });

  it("medical banner + savings row on carded sales, NEVER card details", () => {
    const html = buildEmailReceiptHtml({ ...receipt, medicalSale: true, medicalSavingsMinor: 500 });
    expect(html).toContain("MEDICAL &mdash; TAX EXEMPT SALE");
    expect(html).toContain("Medical savings (tax off)");
    expect(html.toLowerCase()).not.toContain("upid");
  });

  it("honors hideSavings (B13 parity) and escapes product names", () => {
    expect(buildEmailReceiptHtml({ ...receipt, hideSavings: true })).not.toContain("You saved");
    const xss = buildEmailReceiptHtml({
      ...receipt,
      lines: [{ productName: "<script>alert(1)</script>", quantity: 1, unitPriceMinor: 100, regularPriceMinor: 100 }],
    });
    expect(xss).not.toContain("<script>");
  });

  it("subject carries the receipt number", () => {
    expect(emailReceiptSubject(SNAPSHOT as PosReceiptInput)).toBe("Your Greenway receipt 14174000");
  });
});

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runEmailReceiptCoreTests()).not.toThrow();
  });
});
