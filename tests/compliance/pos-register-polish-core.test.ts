/**
 * POS B17 — register polish core (pure) tests.
 *
 * Pins the contracts behind the register's "little things":
 *  - the last-receipt snapshot round-trips through localStorage with REAL
 *    validation (corruption → null, never a garbage print),
 *  - held sales park MINIMAL state (variant ids + counts, never prices) and
 *    rebuild against the CURRENT bundle so a hold can never resurrect a
 *    stale price or a product the store can no longer sell,
 *  - the no-sale slip prints reason + both humans behind the drawer open.
 */
import { describe, it, expect } from "vitest";
import {
  LAST_RECEIPT_KEY,
  HELD_SALE_KEY,
  serializeLastReceipt,
  parseLastReceipt,
  serializeHeldSale,
  parseHeldSale,
  holdFromCart,
  rebuildHeldCart,
  ageLabel,
  __runRegisterPolishCoreTests,
} from "@/lib/pos/register-polish-core";
import { buildNoSaleSlipHtml, type PosReceiptInput } from "@/lib/pos/receipt-core";
import { MAX_LINE_QUANTITY, type PosMenuProduct } from "@/lib/pos/sale-flow-core";

const receipt: PosReceiptInput = {
  saleClientUuid: "aaaaaaaa-bbbb-4ccc-8ddd-00000001417a",
  soldAtIso: "2026-07-13T18:00:00.000Z",
  registerLabel: "Register 1",
  lines: [{ productName: "Blue Dream 3.5g", quantity: 2, unitPriceMinor: 3500, regularPriceMinor: 4000 }],
  subtotalMinor: 5645,
  taxMinor: 1355,
  totalMinor: 7000,
  savingsMinor: 1000,
  medicalSavingsMinor: 0,
  medicalSale: false,
  tenderedMinor: 8000,
  changeMinor: 1000,
};

const product: PosMenuProduct = {
  productId: "prod-1",
  variantId: "var-1",
  name: "Blue Dream",
  brand: null,
  category: "flower",
  categories: ["flower"],
  variantLabel: "3.5g",
  regularPriceMinor: 3500,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
};

describe("pos/register-polish-core — last receipt persistence (POS B17)", () => {
  it("round-trips a frozen receipt and refuses corruption", () => {
    const round = parseLastReceipt(serializeLastReceipt(receipt));
    expect(round?.saleClientUuid).toBe(receipt.saleClientUuid);
    expect(round?.lines[0].unitPriceMinor).toBe(3500);
    expect(parseLastReceipt(null)).toBeNull();
    expect(parseLastReceipt("not json")).toBeNull();
    expect(parseLastReceipt(JSON.stringify({ v: 2, receipt }))).toBeNull();
    expect(parseLastReceipt(JSON.stringify({ v: 1, receipt: { ...receipt, lines: [] } }))).toBeNull();
    expect(parseLastReceipt(JSON.stringify({ v: 1, receipt: { ...receipt, totalMinor: "70.00" } }))).toBeNull();
  });

  it("exports the storage keys next to their validators", () => {
    expect(LAST_RECEIPT_KEY).toBe("gw-pos-last-receipt");
    expect(HELD_SALE_KEY).toBe("gw-pos-held-sale");
  });
});

describe("pos/register-polish-core — hold / resume (POS B17)", () => {
  it("parks minimal state and rebuilds against the CURRENT bundle", () => {
    const gone: PosMenuProduct = { ...product, productId: "p2", variantId: "var-2", name: "Gone Kush" };
    const oos: PosMenuProduct = { ...product, productId: "p3", variantId: "var-3", name: "Sold Out OG", inventoryStatus: "unavailable" };
    const hold = holdFromCart(
      [
        { product, quantity: 2 },
        { product: gone, quantity: 1 },
        { product: oos, quantity: 1 },
      ],
      "Jane D.",
      "2026-07-13T18:00:00.000Z",
    );
    // Minimal state only — no prices stored anywhere in the snapshot.
    expect(JSON.stringify(hold)).not.toContain("3500");
    const round = parseHeldSale(serializeHeldSale(hold));
    expect(round?.lines).toHaveLength(3);

    // Bundle no longer carries "gone"; "oos" is unavailable.
    const rebuilt = rebuildHeldCart(hold, [product, oos]);
    expect(rebuilt.cart).toHaveLength(1);
    expect(rebuilt.cart[0].product.variantId).toBe("var-1");
    expect(rebuilt.cart[0].quantity).toBe(2);
    expect(rebuilt.dropped).toHaveLength(2);
    expect(rebuilt.dropped.join(" ")).toContain("out of stock");
  });

  it("refuses corrupted holds and clamps quantities", () => {
    expect(parseHeldSale("junk")).toBeNull();
    expect(
      parseHeldSale(JSON.stringify({ v: 1, hold: { heldAtIso: "not-a-date", heldByName: "J", lines: [{ variantId: "v", quantity: 1 }] } })),
    ).toBeNull();
    const big = rebuildHeldCart(
      { heldAtIso: "2026-07-13T18:00:00.000Z", heldByName: "J", lines: [{ variantId: "var-1", quantity: 500 }] },
      [product],
    );
    expect(big.cart[0].quantity).toBe(MAX_LINE_QUANTITY);
  });
});

describe("pos/receipt-core — no-sale slip (POS B17)", () => {
  it("prints the banner, reason, and both humans; escapes input", () => {
    const html = buildNoSaleSlipHtml({
      registerLabel: "Register 1",
      openedAtIso: "2026-07-16T20:00:00.000Z",
      reason: "Change for a $20 <swap>",
      openedByName: "Jane D.",
      approvedByName: "Mark L.",
    });
    expect(html).toContain("NO SALE &mdash; DRAWER OPENED");
    expect(html).toContain("Change for a $20 &lt;swap&gt;");
    expect(html).toContain("Opened by: Jane D.");
    expect(html).toContain("Approved by: Mark L.");
    expect(html).toContain("body{width:576px");
    expect(html).not.toContain("TOTAL");
  });
});

describe("pos/register-polish-core — age labels", () => {
  it("formats recency for the home-screen cards", () => {
    const now = new Date("2026-07-13T19:05:00.000Z");
    expect(ageLabel("2026-07-13T19:04:40.000Z", now)).toBe("just now");
    expect(ageLabel("2026-07-13T19:00:00.000Z", now)).toBe("5m ago");
    expect(ageLabel("2026-07-13T17:53:00.000Z", now)).toBe("1h 12m ago");
    expect(ageLabel("garbage", now)).toBe("unknown");
  });
});

describe("embedded self-tests", () => {
  it("register-polish-core self-tests pass", () => {
    expect(() => __runRegisterPolishCoreTests()).not.toThrow();
  });
});
