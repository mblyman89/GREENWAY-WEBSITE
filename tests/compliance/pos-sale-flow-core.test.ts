/**
 * tests/compliance/pos-sale-flow-core.test.ts  (POS Slice B6)
 *
 * Pins the register's guided-sale math: cart operations, pricing through the
 * SHARED promotions engine with the statutory cannabis floor (RCW 69.50.357)
 * and CCRS acquisition-cost floor, the WAC 314-55-095 limit meter semantics
 * (hard block / soft warning / enforcement off), and sale-payload assembly
 * that refuses malformed sales BEFORE they can enter the offline queue.
 */
import { describe, it, expect } from "vitest";
import {
  addToCart,
  setCartQuantity,
  searchProducts,
  priceCart,
  judgeLimits,
  limitLinesFor,
  buildSalePayload,
  MAX_LINE_QUANTITY,
  __runSaleFlowCoreTests,
  type PosMenuProduct,
  type PosLimitSettings,
} from "@/lib/pos/sale-flow-core";
import type { EngineRule } from "@/lib/promotions/discount-engine-core";

const FLOWER: PosMenuProduct = {
  productId: "prod-flower",
  variantId: "var-flower-35",
  name: "Blue Dream",
  brand: "Greenway Farms",
  category: "flower",
  categories: ["flower"],
  variantLabel: "3.5g",
  regularPriceMinor: 3500,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
};

const CONC: PosMenuProduct = {
  productId: "prod-conc",
  variantId: "var-conc-1",
  name: "Live Resin",
  brand: null,
  category: "concentrate",
  categories: ["concentrate"],
  variantLabel: "1g",
  regularPriceMinor: 2500,
  costMinorUnits: 800,
  inventoryStatus: "in-stock",
};

const SETTINGS: PosLimitSettings = {
  enforce: true,
  hardBlock: true,
  rec: {
    usable: 28,
    solid_edible: 453.6,
    concentrate: 7,
    liquid_edible: 2016,
    low_thc_liquid: 200,
    otherwise_taken: 10,
  },
  med: {
    usable: 84,
    solid_edible: 1360.8,
    concentrate: 21,
    liquid_edible: 6048,
    low_thc_liquid: 200,
    otherwise_taken: 10,
  },
  unitGrams: {},
};

const DRAWER = "55555555-5555-4555-8555-555555555555";

function percentRule(overrides: Partial<EngineRule> = {}): EngineRule {
  return {
    id: "r1",
    title: "20% off flower",
    discountType: "percent",
    discountPercent: 20,
    discountFixed: 0,
    priority: 1,
    storewide: false,
    targetCategories: ["flower"],
    targetBrands: [],
    targetProductKeys: [],
    excludeCategories: [],
    excludeBrands: [],
    excludeProductKeys: [],
    config: {},
    ...overrides,
  };
}

describe("cart operations", () => {
  it("merges repeated adds of the same variant", () => {
    const cart = addToCart(addToCart([], FLOWER), FLOWER);
    expect(cart).toHaveLength(1);
    expect(cart[0]!.quantity).toBe(2);
  });

  it("appends distinct variants", () => {
    const cart = addToCart(addToCart([], FLOWER), CONC);
    expect(cart).toHaveLength(2);
  });

  it("setCartQuantity updates, removes at 0, and caps", () => {
    let cart = addToCart([], FLOWER);
    cart = setCartQuantity(cart, FLOWER.variantId, 5);
    expect(cart[0]!.quantity).toBe(5);
    expect(setCartQuantity(cart, FLOWER.variantId, 0)).toHaveLength(0);
    expect(setCartQuantity(cart, FLOWER.variantId, 1000)[0]!.quantity).toBe(MAX_LINE_QUANTITY);
  });

  it("search matches tokens across name/brand/category/label", () => {
    const all = [FLOWER, CONC];
    expect(searchProducts(all, "blue 3.5")).toHaveLength(1);
    expect(searchProducts(all, "greenway")).toHaveLength(1);
    expect(searchProducts(all, "concentrate")).toHaveLength(1);
    expect(searchProducts(all, "")).toHaveLength(2);
    expect(searchProducts(all, "nothing-matches")).toHaveLength(0);
  });
});

describe("pricing — shared engine + statutory floors", () => {
  it("prices a plain cart at regular with the 1.463 cannabis back-out", () => {
    const out = priceCart([{ product: FLOWER, quantity: 2 }], []);
    expect(out.problems).toHaveLength(0);
    expect(out.totals.totalMinorUnits).toBe(7000);
    expect(out.totals.subtotalMinorUnits).toBe(Math.round(7000 / 1.463));
    expect(out.totals.estimatedTaxMinorUnits).toBe(7000 - Math.round(7000 / 1.463));
  });

  it("applies the best promotion per line", () => {
    const out = priceCart([{ product: FLOWER, quantity: 1 }], [percentRule()]);
    expect(out.lines[0]!.unitPriceMinor).toBe(2800);
    expect(out.lines[0]!.appliedLabel).toContain("20% off flower");
    expect(out.totals.savingsMinorUnits).toBe(700);
  });

  it("holds the CCRS acquisition-cost floor on deep discounts", () => {
    const deep = percentRule({ id: "r2", discountPercent: 90, targetCategories: ["concentrate"] });
    const out = priceCart([{ product: CONC, quantity: 1 }], [deep]);
    expect(out.lines[0]!.unitPriceMinor).toBeGreaterThanOrEqual(800);
  });

  it("refuses a zero-price cannabis line instead of selling it free", () => {
    const freebie = { ...FLOWER, variantId: "var-free", regularPriceMinor: 0 };
    const out = priceCart([{ product: freebie, quantity: 1 }], []);
    expect(out.lines).toHaveLength(0);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain("69.50.357");
  });

  it("productName embeds the variant label for the order snapshot", () => {
    const out = priceCart([{ product: FLOWER, quantity: 1 }], []);
    expect(out.lines[0]!.productName).toBe("Blue Dream (3.5g)");
  });
});

describe("limit meter — WAC 314-55-095 semantics", () => {
  it("hard-blocks an over-limit rec cart", () => {
    const j = judgeLimits([{ category: "concentrate", quantity: 8 }], "recreational", SETTINGS);
    expect(j.blocked).toBe(true);
    expect(j.softWarning).toBe(false);
  });

  it("soft-warns when the owner disables hard block", () => {
    const j = judgeLimits(
      [{ category: "concentrate", quantity: 8 }],
      "recreational",
      { ...SETTINGS, hardBlock: false },
    );
    expect(j.blocked).toBe(false);
    expect(j.softWarning).toBe(true);
  });

  it("is silent when enforcement is off (evaluation still computed)", () => {
    const j = judgeLimits(
      [{ category: "concentrate", quantity: 8 }],
      "recreational",
      { ...SETTINGS, enforce: false },
    );
    expect(j.blocked).toBe(false);
    expect(j.softWarning).toBe(false);
    expect(j.evaluation.blocked).toBe(true);
  });

  it("medical profile allows what recreational blocks", () => {
    const j = judgeLimits([{ category: "concentrate", quantity: 8 }], "medical", SETTINGS);
    expect(j.blocked).toBe(false);
  });

  it("limitLinesFor snapshots category + quantity from priced lines", () => {
    const priced = priceCart([{ product: FLOWER, quantity: 2 }], []);
    // SLICE 16: limitLinesFor now also emits the low-THC beverage
    // classification on every line. SLICE 17 adds the otherwise-taken pair.
    // Asserted EXPLICITLY rather than relaxed to objectContaining, so this test
    // still pins the exact shape — and now also pins that a flower line is
    // never classified as a low-THC beverage NOR as otherwise taken into the
    // body. Flower is inhaled; it can be neither.
    expect(limitLinesFor(priced.lines)).toEqual([
      {
        category: "flower",
        quantity: 2,
        lowThcLiquid: null,
        unitThcMg: null,
        otherwiseTaken: null,
        unitsPerPackage: null,
      },
    ]);
  });

  it("AN-1: limitLinesFor carries whole-LINE grams when the variant weight is known", () => {
    // A 7 g jar must meter as 7 g per unit — not the 3.5 g category default.
    const priced = priceCart([{ product: { ...FLOWER, unitGrams: 7 }, quantity: 2 }], []);
    expect(limitLinesFor(priced.lines)).toEqual([
      {
        category: "flower",
        quantity: 2,
        grams: 14,
        lowThcLiquid: null,
        unitThcMg: null,
        otherwiseTaken: null,
        unitsPerPackage: null,
      },
    ]);
  });
});

describe("sale payload assembly — validated before enqueue", () => {
  const priced = priceCart([{ product: FLOWER, quantity: 1 }], []);

  it("builds a valid cash sale with exact change", () => {
    const built = buildSalePayload({
      lines: priced.lines,
      totals: priced.totals,
      tenderedMinor: 4000,
      drawerSessionId: DRAWER,
      idVerification: { method: "scan" },
    });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.changeMinor).toBe(500);
      expect(built.payload.paymentMethod).toBe("cash");
      expect(built.payload.drawerSessionId).toBe(DRAWER);
    }
  });

  it("refuses a short tender", () => {
    const built = buildSalePayload({
      lines: priced.lines,
      totals: priced.totals,
      tenderedMinor: 1000,
      drawerSessionId: DRAWER,
      idVerification: { method: "scan" },
    });
    expect(built.ok).toBe(false);
  });

  it("refuses a manual ID verification without its audit-event UUID", () => {
    const built = buildSalePayload({
      lines: priced.lines,
      totals: priced.totals,
      tenderedMinor: 4000,
      drawerSessionId: DRAWER,
      idVerification: { method: "manual" },
    });
    expect(built.ok).toBe(false);
  });

  it("refuses an empty cart", () => {
    const empty = priceCart([], []);
    const built = buildSalePayload({
      lines: empty.lines,
      totals: empty.totals,
      tenderedMinor: 0,
      drawerSessionId: DRAWER,
      idVerification: { method: "scan" },
    });
    expect(built.ok).toBe(false);
  });
});

describe("embedded self-tests", () => {
  it("__runSaleFlowCoreTests passes", () => {
    expect(() => __runSaleFlowCoreTests()).not.toThrow();
  });
});
