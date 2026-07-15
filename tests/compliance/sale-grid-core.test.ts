/**
 * tests/compliance/sale-grid-core.test.ts
 *
 * Vitest mirror for the B36 sale-screen grid core. Key invariants: category
 * colors are deterministic and case/whitespace-insensitive (every register
 * paints "flower" the same); chips are unique, counted, busiest-first; the
 * category filter combines with the existing search semantics unchanged.
 */
import { describe, expect, it } from "vitest";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";
import {
  CATEGORY_COLOR_COUNT,
  categoryColorIndex,
  filterMenuProducts,
  menuCategoryChips,
  __runSaleGridCoreTests,
} from "@/lib/pos/sale-grid-core";

function prod(over: Partial<PosMenuProduct>): PosMenuProduct {
  return {
    productId: "p1",
    variantId: "v1",
    name: "Blue Dream",
    brand: "Farm",
    category: "flower",
    categories: ["flower"],
    variantLabel: "3.5g",
    regularPriceMinor: 3000,
    costMinorUnits: null,
    inventoryStatus: "in-stock",
    ...over,
  };
}

describe("categoryColorIndex", () => {
  it("is deterministic and case/whitespace-insensitive", () => {
    expect(categoryColorIndex("flower")).toBe(categoryColorIndex("flower"));
    expect(categoryColorIndex("Flower")).toBe(categoryColorIndex("flower"));
    expect(categoryColorIndex("  flower  ")).toBe(categoryColorIndex("flower"));
  });

  it("always lands inside the palette", () => {
    const cats = ["flower", "pre-rolls", "vapor", "edibles", "concentrates", "topicals", "tinctures", "cbd"];
    for (const c of cats) {
      const i = categoryColorIndex(c);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(CATEGORY_COLOR_COUNT);
    }
  });

  it("maps blank to 0 and survives a bad palette size", () => {
    expect(categoryColorIndex("")).toBe(0);
    expect(categoryColorIndex("   ")).toBe(0);
    expect(categoryColorIndex("flower", 0)).toBe(categoryColorIndex("flower"));
  });
});

describe("menuCategoryChips", () => {
  const menu = [
    prod({ variantId: "a", category: "flower" }),
    prod({ variantId: "b", category: "Flower" }),
    prod({ variantId: "c", category: "vapor" }),
    prod({ variantId: "d", category: "edibles" }),
    prod({ variantId: "e", category: "edibles" }),
    prod({ variantId: "f", category: "edibles" }),
    prod({ variantId: "g", category: "  " }),
  ];

  it("dedupes case-insensitively, counts, sorts busiest-first, skips blanks", () => {
    const chips = menuCategoryChips(menu);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toEqual({ category: "edibles", count: 3 });
    expect(chips[1]).toEqual({ category: "flower", count: 2 });
    expect(chips[2]).toEqual({ category: "vapor", count: 1 });
  });

  it("breaks count ties alphabetically", () => {
    const tied = menuCategoryChips([prod({ variantId: "x", category: "zed" }), prod({ variantId: "y", category: "alpha" })]);
    expect(tied.map((c) => c.category)).toEqual(["alpha", "zed"]);
  });
});

describe("filterMenuProducts", () => {
  const menu = [
    prod({ variantId: "a", name: "Blue Dream", category: "flower" }),
    prod({ variantId: "b", name: "Blue Razz Gummy", category: "edibles" }),
    prod({ variantId: "c", name: "OG Kush", category: "flower" }),
  ];

  it("null/blank category means All", () => {
    expect(filterMenuProducts(menu, "", null)).toHaveLength(3);
    expect(filterMenuProducts(menu, "", "  ")).toHaveLength(3);
  });

  it("category narrows case-insensitively and combines with the query", () => {
    expect(filterMenuProducts(menu, "", "FLOWER")).toHaveLength(2);
    const hits = filterMenuProducts(menu, "blue", "edibles");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.variantId).toBe("b");
  });

  it("keeps existing search semantics (every token must hit)", () => {
    expect(filterMenuProducts(menu, "blue dream", null)).toHaveLength(1);
    expect(filterMenuProducts(menu, "zzzznope", null)).toHaveLength(0);
  });
});

describe("self-tests", () => {
  it("pass", () => {
    expect(() => __runSaleGridCoreTests()).not.toThrow();
  });
});
