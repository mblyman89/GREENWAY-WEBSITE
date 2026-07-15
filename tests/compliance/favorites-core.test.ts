/**
 * POS Slice B40 — vitest mirror for the register favorites core.
 *
 * Runs the full self-test suite, then pins the behaviors the register shell
 * depends on: stale-pin resolution (a delisted product NEVER shows a tile),
 * corruption-proof parsing, and the pin cap.
 */
import { describe, expect, it } from "vitest";

import {
  FAVORITES_KEY,
  MAX_FAVORITES,
  __runFavoritesCoreTests,
  favoriteProducts,
  parseFavorites,
  serializeFavorites,
  toggleFavorite,
} from "@/lib/pos/favorites-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

function product(variantId: string, overrides: Partial<PosMenuProduct> = {}): PosMenuProduct {
  return {
    productId: `prod-${variantId}`,
    variantId,
    name: `Product ${variantId}`,
    brand: null,
    category: "flower",
    categories: ["flower"],
    variantLabel: null,
    regularPriceMinor: 1000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    ...overrides,
  };
}

describe("favorites-core self-tests", () => {
  it("all pass", () => {
    expect(() => __runFavoritesCoreTests()).not.toThrow();
  });
});

describe("favorites-core pins", () => {
  it("uses a stable localStorage key", () => {
    expect(FAVORITES_KEY).toBe("gw-pos-favorites");
  });

  it("never renders a delisted product (pins resolve against the live menu)", () => {
    const menu = [product("v1"), product("v2")];
    expect(favoriteProducts(menu, ["v-delisted", "v2", "v1"]).map((p) => p.variantId)).toEqual(["v2", "v1"]);
  });

  it("resolved tiles carry LIVE menu data, not stored data", () => {
    const menu = [product("v1", { regularPriceMinor: 2599, inventoryStatus: "low-stock" })];
    const [tile] = favoriteProducts(menu, ["v1"]);
    expect(tile?.regularPriceMinor).toBe(2599);
    expect(tile?.inventoryStatus).toBe("low-stock");
  });

  it("round-trips through storage and survives corruption", () => {
    expect(parseFavorites(serializeFavorites(["v2", "v1"]))).toEqual(["v2", "v1"]);
    expect(parseFavorites("garbage{{{")).toEqual([]);
    expect(parseFavorites(JSON.stringify({ v: 99, ids: ["v1"] }))).toEqual([]);
  });

  it("caps pins and keeps toggle immutable", () => {
    const atCap = Array.from({ length: MAX_FAVORITES }, (_, i) => `v${i}`);
    expect(toggleFavorite(atCap, "overflow")).toHaveLength(MAX_FAVORITES);
    const before = ["v1"];
    const after = toggleFavorite(before, "v2");
    expect(before).toEqual(["v1"]);
    expect(after).toEqual(["v1", "v2"]);
  });
});
