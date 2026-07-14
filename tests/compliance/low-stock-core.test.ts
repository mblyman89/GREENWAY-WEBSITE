/**
 * tests/compliance/low-stock-core.test.ts
 *
 * Vitest mirror for the B32 register low-stock core. Discipline under test:
 * exact variant counts beat the item-level status, unknown counts fall back
 * gracefully (including pre-B32 cached bundles), warnings NEVER block a
 * sale, and the home-screen count collapses variants by product.
 */
import { describe, expect, it } from "vitest";
import {
  stockSignal,
  cartStockWarnings,
  lowStockCount,
  __runLowStockCoreTests,
} from "@/lib/pos/low-stock-core";

describe("stockSignal", () => {
  it("variant counts beat item status", () => {
    expect(stockSignal("in-stock", 1)).toMatchObject({ badge: "LAST ONE", severity: "last-units" });
    expect(stockSignal("in-stock", 2)).toMatchObject({ badge: "2 LEFT" });
    expect(stockSignal("in-stock", 4)).toBeNull();
    expect(stockSignal("low-stock", 10)).toBeNull(); // healthy variant clears the item flag
    expect(stockSignal("in-stock", 0)).toMatchObject({ badge: "MAY BE OUT" }); // flag, never hide
  });

  it("unknown counts fall back to the item-level status (pre-B32 bundles included)", () => {
    expect(stockSignal("low-stock", null)).toMatchObject({ badge: "LOW STOCK", severity: "low" });
    expect(stockSignal("low-stock", undefined)).toMatchObject({ badge: "LOW STOCK" });
    expect(stockSignal("in-stock", null)).toBeNull();
    expect(stockSignal("low-stock", -1)).toMatchObject({ badge: "LOW STOCK" }); // invalid = unknown
    expect(stockSignal("low-stock", 2.5)).toMatchObject({ badge: "LOW STOCK" });
  });
});

describe("cartStockWarnings (advisory only — never blocks)", () => {
  it("names over-cache quantities and last-unit takes", () => {
    const w = cartStockWarnings([
      { productName: "Blue Dream 3.5g", variantLabel: null, quantity: 3, inventoryStatus: "low-stock", unitsLeft: 2 },
      { productName: "Sour Gummies", variantLabel: "10pk", quantity: 2, inventoryStatus: "in-stock", unitsLeft: 2 },
      { productName: "Plenty", variantLabel: null, quantity: 2, inventoryStatus: "in-stock", unitsLeft: 50 },
    ]);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain("cart has 3");
    expect(w[0]).toContain("only 2 left");
    expect(w[1]).toContain("Sour Gummies · 10pk");
    expect(w[1]).toContain("last 2");
  });

  it("uses singular phrasing for the last one and skips unknown counts", () => {
    const w = cartStockWarnings([
      { productName: "Preroll", variantLabel: null, quantity: 1, inventoryStatus: "in-stock", unitsLeft: 1 },
      { productName: "Unknown", variantLabel: null, quantity: 5, inventoryStatus: "low-stock", unitsLeft: null },
    ]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("last one");
  });
});

describe("lowStockCount", () => {
  it("collapses flagged variants by product", () => {
    expect(
      lowStockCount([
        { productId: "a", inventoryStatus: "low-stock", unitsLeft: null },
        { productId: "a", inventoryStatus: "low-stock", unitsLeft: 2 },
        { productId: "b", inventoryStatus: "in-stock", unitsLeft: 1 },
        { productId: "c", inventoryStatus: "in-stock", unitsLeft: 10 },
      ]),
    ).toBe(2);
    expect(lowStockCount([])).toBe(0);
  });
});

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runLowStockCoreTests()).not.toThrow();
  });
});
