/**
 * tests/compliance/pos-receipt-core.test.ts
 *
 * POS B10 — register receipt builder + Star PassPRNT URL. Mirrors the pure
 * self-tests and pins the printer contract details verified from the Star
 * PassPRNT manual (scheme, size=3 = 576 dots, drawer=after).
 */
import { describe, expect, it } from "vitest";
import {
  __runPosReceiptCoreTests,
  buildPassPrntUrl,
  buildPosReceiptHtml,
  escapeReceiptHtml,
  receiptNumber,
  type PosReceiptInput,
} from "@/lib/pos/receipt-core";

const BASE: PosReceiptInput = {
  saleClientUuid: "123e4567-e89b-12d3-a456-426614174000",
  soldAtIso: "2026-07-15T20:00:00.000Z",
  registerLabel: "Register 1",
  lines: [{ productName: "Blue Dream 3.5g", quantity: 2, unitPriceMinor: 1463, regularPriceMinor: 1463 }],
  subtotalMinor: 2000,
  taxMinor: 926,
  totalMinor: 2926,
  savingsMinor: 0,
  medicalSavingsMinor: 0,
  medicalSale: false,
  tenderedMinor: 3000,
  changeMinor: 74,
};

describe("pos/receipt-core (POS B10)", () => {
  it("escapes HTML in customer-controlled strings", () => {
    expect(escapeReceiptHtml('<b>"A&B"</b>')).toBe("&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;");
  });

  it("derives a stable 8-char receipt number from the sale UUID", () => {
    expect(receiptNumber("123e4567-e89b-12d3-a456-426614174000")).toBe("14174000");
  });

  it("renders a 576px recreational receipt with totals + change", () => {
    const html = buildPosReceiptHtml(BASE);
    expect(html).toContain("576px");
    expect(html).toContain('format-detection" content="telephone=no');
    expect(html).toContain("$29.26");
    expect(html).toContain("Cash tendered");
    expect(html).toContain("$0.74");
    expect(html).not.toContain("MEDICAL");
  });

  it("renders the medical banner + savings line WITHOUT card details", () => {
    const html = buildPosReceiptHtml({
      ...BASE,
      lines: [
        { productName: "RSO Syringe", quantity: 1, unitPriceMinor: 1000, regularPriceMinor: 1463, medicalTaxOff: true },
      ],
      subtotalMinor: 1000,
      taxMinor: 0,
      totalMinor: 1000,
      medicalSavingsMinor: 463,
      medicalSale: true,
      tenderedMinor: 1000,
      changeMinor: 0,
    });
    expect(html).toContain("MEDICAL &mdash; TAX EXEMPT SALE");
    expect(html).toContain("Medical savings (tax off)");
    expect(html).toContain("-$4.63");
    expect(html).toContain("MED TAX OFF");
    expect(html.toLowerCase()).not.toContain("upid");
  });

  it("builds the verified PassPRNT URL (scheme, size=3, drawer kick)", () => {
    const url = buildPassPrntUrl("<html>a&b</html>", { backUrl: "https://pos.example/pos?x=1" });
    expect(url.startsWith("starpassprnt://v1/print/nopreview?back=")).toBe(true);
    expect(url).toContain(encodeURIComponent("https://pos.example/pos?x=1"));
    expect(url).toContain("&size=3");
    expect(url).toContain("&drawer=after&drawerpulse=200");
  });

  it("omits the drawer kick when disabled", () => {
    expect(buildPassPrntUrl("x", { backUrl: "b", openDrawer: false })).not.toContain("drawer=");
  });

  it("__runPosReceiptCoreTests passes", () => {
    expect(() => __runPosReceiptCoreTests()).not.toThrow();
  });
});
