/**
 * Register price lookup (lock screen) — vitest mirror.
 * Pins: the lookup prices through the SAME engine the sale uses, it uses
 * the SAME scan resolver (never a different size), and it closes itself.
 */
import { describe, expect, it } from "vitest";

import {
  PRICE_LOOKUP_IDLE_MS,
  __runPriceLookupCoreTests,
  lookupIdleRemaining,
  lookupPrice,
  priceLookupUnavailableReason,
  resolveLookupScan,
} from "@/lib/pos/price-lookup-core";
import { priceCart, type PosMenuProduct } from "@/lib/pos/sale-flow-core";

const prod = (over: Partial<PosMenuProduct> = {}): PosMenuProduct => ({
  productId: "PROD-0001",
  variantId: "PROD-0001",
  name: "Wedding Cake",
  brand: "Greenway",
  category: "flower",
  categories: ["flower"],
  variantLabel: "1g",
  regularPriceMinor: 1200,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
  ...over,
});

describe("price-lookup-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runPriceLookupCoreTests()).not.toThrow();
  });
});

describe("price-lookup-core pins", () => {
  it("today's price equals what the sale screen would ring", () => {
    const p = prod();
    expect(lookupPrice(p, []).todayMinor).toBe(priceCart([{ product: p, quantity: 1 }], []).lines[0].unitPriceMinor);
  });

  it("a scan never adds anything — it only shows", () => {
    const out = resolveLookupScan({ products: [prod()], rules: [] }, "PROD-0001");
    expect(out.kind).toBe("show");
  });

  it("closes itself after the idle window", () => {
    expect(lookupIdleRemaining(0, PRICE_LOOKUP_IDLE_MS)).toBe(0);
    expect(lookupIdleRemaining(0, 1000)).toBe(PRICE_LOOKUP_IDLE_MS - 1000);
  });

  it("the lock-screen button explains why it is off without a menu", () => {
    expect(priceLookupUnavailableReason(null)).toMatch(/menu/i);
    expect(priceLookupUnavailableReason({ products: [prod()] })).toBeNull();
  });
});
