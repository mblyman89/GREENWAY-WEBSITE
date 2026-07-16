/**
 * tests/compliance/price-drift-core.test.ts  (POS AN-5)
 *
 * Vitest mirror of the price-drift-core self-tests: override-aware
 * comparison of a synced sale's device menu-price snapshots against the
 * current published menu. Drift is a NOTICE (audit row), never a block.
 */
import { describe, expect, it } from "vitest";
import {
  buildMenuPriceIndex,
  checkPriceDrift,
  summarizePriceDrift,
  DEFAULT_PRICE_DRIFT_TOLERANCE_MINOR,
  __runPriceDriftCoreTests,
} from "@/lib/pos/price-drift-core";

const INDEX = buildMenuPriceIndex([
  { productId: "p1", variantId: "v1", priceMinor: 3500 },
  { productId: "p1", variantId: "v2", priceMinor: 6500 },
  { productId: "p2", variantId: "v3", priceMinor: 1200 },
]);

describe("price-drift-core (POS AN-5)", () => {
  it("self-tests pass", () => {
    expect(() => __runPriceDriftCoreTests()).not.toThrow();
  });

  it("default tolerance is exact-match (0¢) — same integer-cents source both sides", () => {
    expect(DEFAULT_PRICE_DRIFT_TOLERANCE_MINOR).toBe(0);
    expect(
      checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3500 }], INDEX),
    ).toHaveLength(0);
  });

  it("flags price drift in both directions with signed delta", () => {
    const up = checkPriceDrift(
      [{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3700 }],
      INDEX,
    );
    expect(up).toHaveLength(1);
    expect(up[0].kind).toBe("price");
    expect(up[0].deltaMinor).toBe(200);

    const down = checkPriceDrift(
      [{ productId: "p2", productName: "Gummy", variantId: "v3", regularPriceMinor: 1000 }],
      INDEX,
    );
    expect(down[0].deltaMinor).toBe(-200);
    expect(down[0].menuPriceMinor).toBe(1200);
  });

  it("tolerance quiets small drift; garbage tolerance collapses to 0", () => {
    const line = [{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3600 }];
    expect(checkPriceDrift(line, INDEX, 100)).toHaveLength(0);
    expect(checkPriceDrift(line, INDEX, 99)).toHaveLength(1);
    expect(checkPriceDrift(line, INDEX, -7)).toHaveLength(1);
  });

  it("reports delisted products and missing variants distinctly", () => {
    const gone = checkPriceDrift(
      [{ productId: "pX", productName: "Old", variantId: "v9", regularPriceMinor: 900 }],
      INDEX,
    );
    expect(gone[0].kind).toBe("delisted");
    expect(gone[0].menuPriceMinor).toBeNull();

    const vmiss = checkPriceDrift(
      [{ productId: "p1", productName: "Flower", variantId: "v9", regularPriceMinor: 900 }],
      INDEX,
    );
    expect(vmiss[0].kind).toBe("variant_missing");
  });

  it("skips lines without a variantId (pre-B20 queues) — never guesses a variant", () => {
    expect(
      checkPriceDrift([{ productId: "p1", productName: "Flower", regularPriceMinor: 9999 }], INDEX),
    ).toHaveLength(0);
    expect(
      checkPriceDrift([{ productId: "p1", productName: "Flower", variantId: " ", regularPriceMinor: 9999 }], INDEX),
    ).toHaveLength(0);
  });

  it("summary names products, direction, and the menu-refresh hint", () => {
    expect(summarizePriceDrift([])).toBe("No price drift.");
    const findings = checkPriceDrift(
      [{ productId: "p1", productName: "Flower", variantId: "v1", regularPriceMinor: 3700 }],
      INDEX,
    );
    const s = summarizePriceDrift(findings);
    expect(s).toContain("Flower");
    expect(s).toContain("above");
    expect(s).toContain("menu refresh");
  });
});
