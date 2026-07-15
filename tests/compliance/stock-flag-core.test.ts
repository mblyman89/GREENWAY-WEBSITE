/**
 * POS Slice B43 — vitest mirror for the out-of-stock quick-flag core.
 *
 * Runs the full self-test suite, then pins the behaviors the register and
 * the /api/pos/stock-flag route depend on: reasons are a closed set (no
 * free text), the optimistic local apply removes EVERY variant without
 * mutating the cached bundle, and B39 keypad lines are never flaggable.
 */
import { describe, expect, it } from "vitest";

import {
  STOCK_FLAG_REASONS,
  __runStockFlagCoreTests,
  applyLocalStockFlag,
  canFlagOutOfStock,
  isStockFlagReason,
  validateStockFlag,
} from "@/lib/pos/stock-flag-core";
import type { PosMenuBundle, PosMenuProduct } from "@/lib/pos/sale-flow-core";

function product(productId: string, variantId: string): PosMenuProduct {
  return {
    productId,
    variantId,
    name: productId,
    brand: null,
    category: "flower",
    categories: ["flower"],
    variantLabel: null,
    regularPriceMinor: 1000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
  };
}

function bundle(products: PosMenuProduct[]): PosMenuBundle {
  return {
    products,
    rules: [],
    limits: { enforce: true, hardBlock: true, rec: {}, med: {}, unitGrams: {} },
    hours: { openHour: 8, closeHour: 23 },
    fetchedAt: "2026-01-01T00:00:00Z",
  } as unknown as PosMenuBundle;
}

describe("stock-flag-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runStockFlagCoreTests()).not.toThrow();
  });
});

describe("stock-flag-core pins", () => {
  it("reasons are a closed set — free text is rejected", () => {
    expect(STOCK_FLAG_REASONS).toEqual(["shelf empty", "damaged / unsellable", "wrong listing"]);
    expect(isStockFlagReason("shelf empty")).toBe(true);
    expect(isStockFlagReason("customer said so")).toBe(false);
    const bad = validateStockFlag({ productId: "p1", reason: "anything else" });
    expect(bad.ok).toBe(false);
  });

  it("validateStockFlag normalizes a good request and never throws on garbage", () => {
    const good = validateStockFlag({ productId: "  p1  ", reason: "wrong listing" });
    expect(good).toEqual({ ok: true, request: { productId: "p1", reason: "wrong listing" } });
    for (const garbage of [null, undefined, 42, "x", [], { productId: "" }, { reason: "shelf empty" }]) {
      expect(validateStockFlag(garbage).ok).toBe(false);
    }
  });

  it("applyLocalStockFlag removes EVERY variant of the product, immutably", () => {
    const original = bundle([product("p1", "v1"), product("p1", "v2"), product("p2", "v3")]);
    const after = applyLocalStockFlag(original, "p1");
    expect(after.products.map((p) => p.variantId)).toEqual(["v3"]);
    expect(original.products).toHaveLength(3);
    expect(after).not.toBe(original);
    expect(after.fetchedAt).toBe(original.fetchedAt);
  });

  it("unknown or blank productId leaves the menu unchanged", () => {
    const original = bundle([product("p1", "v1")]);
    expect(applyLocalStockFlag(original, "nope").products).toHaveLength(1);
    expect(applyLocalStockFlag(original, "   ").products).toHaveLength(1);
  });

  it("B39 keypad lines are never flaggable; catalog products are", () => {
    expect(canFlagOutOfStock({ productId: "pos-custom-abc" })).toBe(false);
    expect(canFlagOutOfStock({ productId: "prod-123" })).toBe(true);
  });
});
