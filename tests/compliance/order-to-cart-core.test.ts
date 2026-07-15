/**
 * Vitest mirror for src/lib/pos/order-to-cart-core.ts (Task AM-D) — loading
 * a website order into the register cart: variant matching (real ids + the
 * synthetic `-default` fallback), drop reporting, merge/clamp, and the
 * supersede note contract.
 */
import { describe, it, expect } from "vitest";
import {
  rebuildOrderCart,
  supersedeNote,
  __runOrderToCartCoreTests,
} from "@/lib/pos/order-to-cart-core";
import { MAX_LINE_QUANTITY, type PosMenuProduct } from "@/lib/pos/sale-flow-core";

const product = (over: Partial<PosMenuProduct>): PosMenuProduct => ({
  productId: "p1",
  variantId: "v1",
  name: "Blue Dream 3.5g",
  brand: null,
  category: "flower",
  categories: ["flower"],
  variantLabel: "3.5g",
  regularPriceMinor: 3500,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
  unitsLeft: null,
  strainType: null,
  thc: null,
  cbd: null,
  ...over,
});

const menu = [
  product({}),
  product({ productId: "p2", variantId: "p2-default", name: "Preroll Single", variantLabel: null }),
  product({ productId: "p3", variantId: "v3", name: "Gone Gummies", inventoryStatus: "unavailable" }),
];

describe("order-to-cart-core (AM-D)", () => {
  it("matches real variant ids against the current bundle", () => {
    const r = rebuildOrderCart(
      [{ productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 2 }],
      menu,
    );
    expect(r.cart).toHaveLength(1);
    expect(r.cart[0].product.variantId).toBe("v1");
    expect(r.cart[0].quantity).toBe(2);
    expect(r.dropped).toHaveLength(0);
  });

  it("falls back to the synthetic `${productId}-default` key for legacy null variant ids", () => {
    const r = rebuildOrderCart(
      [{ productId: "p2", variantId: null, productName: "Preroll Single", quantity: 1 }],
      menu,
    );
    expect(r.cart).toHaveLength(1);
    expect(r.cart[0].product.variantId).toBe("p2-default");
  });

  it("drops vanished and out-of-stock lines with named reasons", () => {
    const r = rebuildOrderCart(
      [
        { productId: "px", variantId: "vx", productName: "Discontinued Bar", quantity: 1 },
        { productId: "p3", variantId: "v3", productName: "Gone Gummies", quantity: 1 },
      ],
      menu,
    );
    expect(r.cart).toHaveLength(0);
    expect(r.dropped).toHaveLength(2);
    expect(r.dropped[0]).toContain("no longer on the menu");
    expect(r.dropped[1]).toContain("out of stock");
  });

  it("never guesses when both ids are null", () => {
    const r = rebuildOrderCart([{ productId: null, variantId: null, productName: "Mystery", quantity: 1 }], menu);
    expect(r.cart).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
  });

  it("merges duplicate variant lines and clamps to MAX_LINE_QUANTITY", () => {
    const r = rebuildOrderCart(
      [
        { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 60 },
        { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 60 },
      ],
      menu,
    );
    expect(r.cart).toHaveLength(1);
    expect(r.cart[0].quantity).toBe(MAX_LINE_QUANTITY);
  });

  it("skips zero/negative quantities and floors fractional ones", () => {
    const r = rebuildOrderCart(
      [
        { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 0 },
        { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: -3 },
        { productId: "p1", variantId: "v1", productName: "Blue Dream 3.5g", quantity: 1.9 },
      ],
      menu,
    );
    expect(r.cart).toHaveLength(1);
    expect(r.cart[0].quantity).toBe(1);
    expect(r.dropped).toHaveLength(0);
  });

  it("supersede note names who/where and forbids double fulfillment", () => {
    const note = supersedeNote("Front iPad", "Casey");
    expect(note).toContain("SUPERSEDED");
    expect(note).toContain("Front iPad");
    expect(note).toContain("Casey");
    expect(note).toContain("NOT be fulfilled separately");
  });

  it("embedded self-tests pass", () => {
    expect(() => __runOrderToCartCoreTests()).not.toThrow();
  });
});
