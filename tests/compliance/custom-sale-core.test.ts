/**
 * tests/compliance/custom-sale-core.test.ts
 *
 * Vitest mirror for the B39 keypad core. Key invariants: keypad math is
 * cash-register digit entry with a hard cap; custom lines are restricted to
 * NON-CANNABIS categories (every CUSTOM_SALE_CATEGORIES member must be in
 * order-pricing-core's NON_CANNABIS_TAX_CATEGORIES — CCRS excise, the
 * cannabis price floor, and purchase limits all key off that set); reserved
 * "pos-custom-*" product keys are detectable so the inventory decrement can
 * skip keypad lines.
 */
import { describe, expect, it } from "vitest";
import { NON_CANNABIS_TAX_CATEGORIES } from "@/lib/orders/order-pricing-core";
import { categoryToBucket } from "@/lib/compliance/sales-limits-core";
import {
  CUSTOM_PRODUCT_PREFIX,
  CUSTOM_SALE_CATEGORIES,
  MAX_CUSTOM_AMOUNT_MINOR,
  buildCustomProduct,
  isCustomLineProductId,
  keypadAppend,
  keypadBackspace,
  keypadClear,
  __runCustomSaleCoreTests,
  type CustomSaleCategory,
} from "@/lib/pos/custom-sale-core";

describe("custom-sale-core (POS B39)", () => {
  it("runs the embedded self-tests", () => {
    expect(() => __runCustomSaleCoreTests()).not.toThrow();
  });

  it("keypad digits shift in from the right and cap safely", () => {
    let a = 0;
    for (const d of [1, 2, 5]) a = keypadAppend(a, d);
    expect(a).toBe(125);
    expect(keypadAppend(MAX_CUSTOM_AMOUNT_MINOR, 9)).toBe(MAX_CUSTOM_AMOUNT_MINOR);
    expect(keypadBackspace(125)).toBe(12);
    expect(keypadClear()).toBe(0);
  });

  it("every keypad category is non-cannabis AND unlimited (compliance pin)", () => {
    for (const c of CUSTOM_SALE_CATEGORIES) {
      expect(NON_CANNABIS_TAX_CATEGORIES.has(c)).toBe(true);
      expect(categoryToBucket(c)).toBeNull();
    }
  });

  it("builds a cart-ready product with the reserved key", () => {
    const r = buildCustomProduct({ category: "merch", amountMinor: 1500, note: "Tote bag", uid: "abc" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.product.productId).toBe(`${CUSTOM_PRODUCT_PREFIX}merch`);
      expect(r.product.name).toBe("Tote bag");
      expect(r.product.regularPriceMinor).toBe(1500);
      expect(isCustomLineProductId(r.product.productId)).toBe(true);
    }
  });

  it("refuses cannabis categories, bad amounts, and long notes", () => {
    expect(buildCustomProduct({ category: "flower" as CustomSaleCategory, amountMinor: 500, uid: "x" }).ok).toBe(false);
    expect(buildCustomProduct({ category: "merch", amountMinor: 0, uid: "x" }).ok).toBe(false);
    expect(buildCustomProduct({ category: "merch", amountMinor: MAX_CUSTOM_AMOUNT_MINOR + 1, uid: "x" }).ok).toBe(false);
    expect(buildCustomProduct({ category: "merch", amountMinor: 500, note: "y".repeat(61), uid: "x" }).ok).toBe(false);
  });

  it("does not flag real product keys as custom", () => {
    expect(isCustomLineProductId("leafly-8841")).toBe(false);
    expect(isCustomLineProductId(null)).toBe(false);
    expect(isCustomLineProductId(undefined)).toBe(false);
  });
});
