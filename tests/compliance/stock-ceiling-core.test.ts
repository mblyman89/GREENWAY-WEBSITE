/**
 * tests/compliance/stock-ceiling-core.test.ts  (SLICE 14)
 *
 * The on-hand ceiling the owner asked for after finding, at the counter, that
 * a tile reading "1 LEFT" could be tapped twice and both units landed in the
 * cart — and that the +/− buttons would then add without limit.
 *
 * These tests are written to FAIL against the pre-slice-14 code. That was
 * verified by running them before the fix existed, not assumed.
 */

import { describe, expect, it } from "vitest";

import {
  __runStockCeilingCoreTests,
  STOCK_CEILING_MAX_LINE_QUANTITY,
  canAddOne,
  clampToStock,
  isKnownOutOfStock,
  sellableCeiling,
  stockBlockingLines,
  stockRefusalMessage,
} from "@/lib/pos/stock-ceiling-core";
import { addToCart, setCartQuantity, type PosCartEntry, type PosMenuProduct } from "@/lib/pos/sale-flow-core";

describe("embedded self-tests", () => {
  it("run clean", () => {
    expect(() => __runStockCeilingCoreTests()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Fixtures — a product whose stock we control
// ---------------------------------------------------------------------------

function product(unitsLeft: number | null | undefined, id = "v1"): PosMenuProduct {
  return {
    productId: `p-${id}`,
    variantId: id,
    name: "Blue Dream",
    brand: null,
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 1200,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    unitsLeft,
  } as PosMenuProduct;
}

const qtyOf = (cart: PosCartEntry[], variantId = "v1") =>
  cart.find((e) => e.product.variantId === variantId)?.quantity ?? 0;

// ---------------------------------------------------------------------------
// THE OWNER'S EXACT REPORT
// ---------------------------------------------------------------------------

describe("the owner's reported bug: tile says 1 LEFT, tapped twice", () => {
  it("first tap adds the unit", () => {
    const cart = addToCart([], product(1));
    expect(qtyOf(cart)).toBe(1);
  });

  it("second tap does NOT add a second unit", () => {
    const p = product(1);
    const cart = addToCart(addToCart([], p), p);
    expect(qtyOf(cart)).toBe(1);
  });

  it("a hundred taps still cannot exceed the stock on hand", () => {
    const p = product(1);
    let cart: PosCartEntry[] = [];
    for (let i = 0; i < 100; i += 1) cart = addToCart(cart, p);
    expect(qtyOf(cart)).toBe(1);
  });
});

describe("the owner's reported bug: +/- buttons in the cart", () => {
  it("the + button cannot push a line past its stock", () => {
    const cart = addToCart([], product(2));
    const bumped = setCartQuantity(cart, "v1", 3);
    expect(qtyOf(bumped)).toBe(2);
  });

  it("typing a huge quantity is clamped to stock, not to 99", () => {
    const cart = addToCart([], product(4));
    expect(qtyOf(setCartQuantity(cart, "v1", 500))).toBe(4);
  });

  it("the - button and removal still work normally", () => {
    const cart = setCartQuantity(addToCart([], product(5)), "v1", 3);
    expect(qtyOf(cart)).toBe(3);
    expect(setCartQuantity(cart, "v1", 0)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// MUST NOT REGRESS — these paths legitimately have no stock number
// ---------------------------------------------------------------------------

describe("unknown stock stays unlimited (custom sales must not break)", () => {
  it("null unitsLeft is unrestricted", () => {
    let cart: PosCartEntry[] = [];
    for (let i = 0; i < 10; i += 1) cart = addToCart(cart, product(null));
    expect(qtyOf(cart)).toBe(10);
  });

  it("undefined unitsLeft (pre-B32 cached bundle) is unrestricted", () => {
    let cart: PosCartEntry[] = [];
    for (let i = 0; i < 10; i += 1) cart = addToCart(cart, product(undefined));
    expect(qtyOf(cart)).toBe(10);
  });

  it("a corrupt negative count does not 86 a live product", () => {
    const cart = setCartQuantity(addToCart([], product(-1)), "v1", 7);
    expect(qtyOf(cart)).toBe(7);
  });

  it("the 99-per-line cap that predates this slice still holds", () => {
    expect(qtyOf(setCartQuantity(addToCart([], product(null)), "v1", 500))).toBe(
      STOCK_CEILING_MAX_LINE_QUANTITY,
    );
  });
});

describe("zero stock", () => {
  it("a known-zero item cannot be added at all", () => {
    expect(addToCart([], product(0))).toHaveLength(0);
  });

  it("adding a zero-stock item never creates an empty phantom line", () => {
    const cart = addToCart([], product(0));
    expect(cart.every((e) => e.quantity > 0)).toBe(true);
  });

  it("is flagged for the greyed-out tile", () => {
    expect(isKnownOutOfStock(0)).toBe(true);
    expect(isKnownOutOfStock(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OVERRIDE — owner decision Q2: ANY staff member
// ---------------------------------------------------------------------------

describe("staff override", () => {
  it("lifts the stock ceiling", () => {
    expect(clampToStock(5, 1, true).quantity).toBe(5);
  });

  it("allows selling a unit physically found despite a zero count", () => {
    expect(clampToStock(1, 0, true).quantity).toBe(1);
  });

  it("does NOT lift the structural 99 cap", () => {
    expect(clampToStock(500, 1, true).quantity).toBe(STOCK_CEILING_MAX_LINE_QUANTITY);
  });
});

// ---------------------------------------------------------------------------
// TENDER GATE
// ---------------------------------------------------------------------------

describe("stockBlockingLines — the last line of defence at tender", () => {
  const line = (quantity: number, unitsLeft: number | null | undefined) => ({
    productName: "Blue Dream",
    variantLabel: "3.5g",
    quantity,
    unitsLeft,
  });

  it("allows a cart that fits", () => {
    expect(stockBlockingLines([line(2, 5)])).toHaveLength(0);
  });

  it("allows an exact fit", () => {
    expect(stockBlockingLines([line(5, 5)])).toHaveLength(0);
  });

  it("blocks a cart that went over after a menu refresh lowered the count", () => {
    expect(stockBlockingLines([line(5, 2)])).toHaveLength(1);
  });

  it("never blocks on unknown stock", () => {
    expect(stockBlockingLines([line(99, null)])).toHaveLength(0);
    expect(stockBlockingLines([line(99, undefined)])).toHaveLength(0);
  });

  it("reports every offending line, not just the first", () => {
    expect(stockBlockingLines([line(3, 1), line(4, 2)])).toHaveLength(2);
  });

  it("explains itself in plain English with no jargon", () => {
    const msg = stockBlockingLines([line(3, 1)])[0] ?? "";
    expect(msg).toMatch(/only 1 is left/);
    expect(msg).not.toMatch(/unitsLeft|variantId|undefined|null|NaN/);
  });
});

// ---------------------------------------------------------------------------
// THE INVARIANT
// ---------------------------------------------------------------------------

describe("clamp and tender-gate can never disagree", () => {
  it("nothing the cart accepts is later refused at tender", () => {
    const stocks: (number | null | undefined)[] = [0, 1, 2, 3, 10, null, undefined, -1];
    for (const stock of stocks) {
      for (const want of [0, 1, 2, 5, 120]) {
        const clamped = clampToStock(want, stock);
        const blocked = stockBlockingLines([
          { productName: "P", variantLabel: null, quantity: clamped.quantity, unitsLeft: stock },
        ]);
        expect(blocked, `stock=${String(stock)} want=${want}`).toHaveLength(0);
      }
    }
  });

  it("a cart built purely through addToCart is always tenderable", () => {
    for (const stock of [0, 1, 3, null, undefined] as (number | null | undefined)[]) {
      let cart: PosCartEntry[] = [];
      for (let i = 0; i < 12; i += 1) cart = addToCart(cart, product(stock));
      const blocked = stockBlockingLines(
        cart.map((e) => ({
          productName: e.product.name,
          variantLabel: e.product.variantLabel,
          quantity: e.quantity,
          unitsLeft: e.product.unitsLeft,
        })),
      );
      expect(blocked, `stock=${String(stock)}`).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

describe("sellableCeiling", () => {
  it("treats only a non-negative safe integer as trustworthy", () => {
    expect(sellableCeiling(0)).toBe(0);
    expect(sellableCeiling(7)).toBe(7);
    expect(sellableCeiling(null)).toBeNull();
    expect(sellableCeiling(undefined)).toBeNull();
    expect(sellableCeiling(-1)).toBeNull();
    expect(sellableCeiling(2.5)).toBeNull();
    expect(sellableCeiling(Number.NaN)).toBeNull();
    expect(sellableCeiling(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("canAddOne", () => {
  it("mirrors the owner's double-tap exactly", () => {
    expect(canAddOne(0, 1)).toBe(true);
    expect(canAddOne(1, 1)).toBe(false);
  });

  it("respects the override and the hard cap", () => {
    expect(canAddOne(1, 1, true)).toBe(true);
    expect(canAddOne(STOCK_CEILING_MAX_LINE_QUANTITY, null)).toBe(false);
  });
});

describe("stockRefusalMessage", () => {
  it("never leaks internals to the counter", () => {
    for (const n of [0, 1, 4, null, undefined, -1] as (number | null | undefined)[]) {
      expect(stockRefusalMessage("Blue Dream", n)).not.toMatch(/unitsLeft|ceiling|undefined|null|NaN/);
    }
  });
});
