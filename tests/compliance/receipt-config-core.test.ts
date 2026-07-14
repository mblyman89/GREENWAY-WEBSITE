/**
 * tests/compliance/receipt-config-core.test.ts
 *
 * POS B13 — receipt customization config + its consumption by the pure
 * receipt builder. Mirrors the pure self-tests and pins the admin-preview /
 * register-paper contract (identical builder, identical output).
 */
import { describe, expect, it } from "vitest";
import {
  __runReceiptConfigCoreTests,
  DEFAULT_POS_RECEIPT_CONFIG,
  normalizePosReceiptConfig,
  receiptAddressLines,
  RECEIPT_ADDRESS_MAX_LINES,
  RECEIPT_HEADER_MAX,
} from "@/lib/pos/receipt-config-core";
import { buildPosReceiptHtml, type PosReceiptInput } from "@/lib/pos/receipt-core";

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

describe("pos/receipt-config-core (POS B13)", () => {
  it("passes its pure self-tests", () => {
    expect(() => __runReceiptConfigCoreTests()).not.toThrow();
  });

  it("degrades garbage input to safe defaults", () => {
    expect(normalizePosReceiptConfig(null)).toEqual(DEFAULT_POS_RECEIPT_CONFIG);
    expect(normalizePosReceiptConfig("junk").headerText).toBe("GREENWAY MARIJUANA");
    expect(normalizePosReceiptConfig({ headerText: "H".repeat(999) }).headerText).toHaveLength(
      RECEIPT_HEADER_MAX,
    );
  });

  it("clamps the address block to the printable line budget", () => {
    const cfg = normalizePosReceiptConfig({
      addressText: Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"),
    });
    expect(receiptAddressLines(cfg)).toHaveLength(RECEIPT_ADDRESS_MAX_LINES);
  });

  it("keeps a cleared address empty but restores blank header/footer to defaults", () => {
    const cfg = normalizePosReceiptConfig({ headerText: " ", footerText: "", addressText: "" });
    expect(cfg.addressText).toBe("");
    expect(cfg.headerText).toBe(DEFAULT_POS_RECEIPT_CONFIG.headerText);
    expect(cfg.footerText).toBe(DEFAULT_POS_RECEIPT_CONFIG.footerText);
  });

  it("receipt builder prints the customized address, served-by, and loyalty block", () => {
    const html = buildPosReceiptHtml({
      ...BASE,
      addressLines: ["9107 SW State Hwy 3", "License <413541>"],
      servedBy: "Casey",
      loyalty: { memberLabel: "Jane D.", pointsEarned: 20 },
    });
    expect(html).toContain('<p class="addr">9107 SW State Hwy 3</p>');
    expect(html).toContain("License &lt;413541&gt;");
    expect(html).toContain("Served by Casey");
    expect(html).toContain("Loyalty: Jane D.");
    expect(html).toContain("Points earned this visit: 20");
  });

  it("owner toggles suppress optional lines", () => {
    const html = buildPosReceiptHtml({ ...BASE, savingsMinor: 200, hideSavings: true });
    expect(html).not.toContain("You saved");
    expect(buildPosReceiptHtml(BASE)).not.toContain("Served by");
    expect(buildPosReceiptHtml(BASE)).not.toContain("Loyalty:");
  });
});
