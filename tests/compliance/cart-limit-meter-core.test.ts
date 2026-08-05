/**
 * Shop-cart WAC 314-55-095 limit meter (vitest mirror).
 *
 * Pins the contract that makes the customer cart mirror the front-end POS
 * register meter: the variant LABEL drives the true per-unit grams (a 7 g jar
 * counts as 7 g, mirroring the register's limitLinesFor), the engine evaluates
 * against the STATUTORY RECREATIONAL maximums, the MIX-INFUSED rule counts
 * infused prerolls against the 7 g concentrate bucket, and the OK/NEAR/OVER
 * status matches the register badge (NEAR at >80% of a bucket, OVER when any
 * bucket is exceeded). All math is delegated to the shared self-tested cores —
 * this file guards the adapter, never re-deriving a statute.
 */
import { describe, expect, it } from "vitest";
import {
  __runCartLimitMeterCoreTests,
  activeBuckets,
  cartLimitLines,
  evaluateCartMeter,
  hasTrackedWeight,
  meterStatus,
  NEAR_LIMIT_RATIO,
} from "../../src/lib/menu/cart-limit-meter-core";

describe("cart-limit-meter-core", () => {
  it("passes its pure self-tests", () => {
    expect(() => __runCartLimitMeterCoreTests()).not.toThrow();
  });

  it("derives whole-line grams from the variant label (mirrors POS limitLinesFor)", () => {
    const [jar] = cartLimitLines([{ category: "flower", quantity: 2, variantLabel: "7g" }]);
    expect(jar.grams).toBe(14);
    const [oz] = cartLimitLines([{ category: "flower", quantity: 1, variantLabel: "1oz" }]);
    expect(oz.grams).toBe(28);
  });

  it("falls back to category defaults for non-weight labels (no explicit grams)", () => {
    expect(cartLimitLines([{ category: "concentrate", quantity: 3, variantLabel: "each" }])[0].grams).toBeUndefined();
    expect(cartLimitLines([{ category: "edible-solid", quantity: 1, variantLabel: "100mg" }])[0].grams).toBeUndefined();
    expect(cartLimitLines([{ category: "flower", quantity: 1, variantLabel: null }])[0].grams).toBeUndefined();
  });

  it("evaluates against the statutory recreational maxima", () => {
    const atLimit = evaluateCartMeter([{ category: "flower", quantity: 8, variantLabel: "3.5g" }]);
    expect(atLimit.customerType).toBe("recreational");
    expect(atLimit.blocked).toBe(false);
    expect(atLimit.buckets.find((b) => b.bucket === "usable")!.usedGrams).toBe(28);

    const over = evaluateCartMeter([{ category: "flower", quantity: 9, variantLabel: "3.5g" }]);
    expect(over.blocked).toBe(true);
  });

  it("applies the mix-infused rule to the 7g concentrate bucket", () => {
    const infused = evaluateCartMeter([{ category: "infused-preroll", quantity: 8, variantLabel: "1g" }]);
    expect(infused.blocked).toBe(true);
    expect(infused.buckets.find((b) => b.bucket === "concentrate")!.exceeded).toBe(true);
    expect(infused.buckets.find((b) => b.bucket === "usable")!.usedGrams).toBe(0);
  });

  it("computes OK / NEAR / OVER exactly like the register badge", () => {
    expect(meterStatus(evaluateCartMeter([]))).toBe("ok");
    expect(meterStatus(evaluateCartMeter([{ category: "merch", quantity: 4, variantLabel: "each" }]))).toBe("ok");
    // 4g of 7g concentrate = 0.571 < 0.8 → ok
    expect(meterStatus(evaluateCartMeter([{ category: "concentrate", quantity: 4, variantLabel: "1g" }]))).toBe("ok");
    // 6g of 7g concentrate = 0.857 > 0.8 → near
    expect(meterStatus(evaluateCartMeter([{ category: "concentrate", quantity: 6, variantLabel: "1g" }]))).toBe("near");
    // 9 x 3.5g flower = 31.5g > 28g → over
    expect(meterStatus(evaluateCartMeter([{ category: "flower", quantity: 9, variantLabel: "3.5g" }]))).toBe("over");
  });

  it("surfaces only buckets carrying weight", () => {
    const mixed = evaluateCartMeter([
      { category: "flower", quantity: 2, variantLabel: "3.5g" },
      { category: "concentrate", quantity: 1, variantLabel: "1g" },
      { category: "merch", quantity: 1, variantLabel: "each" },
    ]);
    const active = activeBuckets(mixed);
    expect(active).toHaveLength(2);
    expect(active.every((b) => b.usedGrams > 0)).toBe(true);
    expect(hasTrackedWeight(mixed)).toBe(true);
    expect(hasTrackedWeight(evaluateCartMeter([{ category: "merch", quantity: 1, variantLabel: "each" }]))).toBe(false);
  });

  it("pins the near-limit threshold to the register's 80%", () => {
    expect(NEAR_LIMIT_RATIO).toBe(0.8);
  });
});
