/**
 * tests/compliance/menu-category-override-core.test.ts
 *
 * Per-product website category override overlay for the LIVE customer menu
 * (Option A). Pins that: only a valid GreenwayCategory override is applied;
 * unknown/null/no-op overrides leave the card referentially identical (so the
 * menu can never break and serialization stays cheap); and when the category
 * changes, filterCategories is recomputed with the same fan-out the import
 * transform uses. CCRS/LCB raw fields are only read, never mutated.
 */
import { describe, it, expect } from "vitest";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  __runMenuCategoryOverrideCoreTests,
  applyCategoryOverrides,
  filterCategoriesForOverride,
  isValidWebsiteCategory,
} from "@/lib/menu/menu-category-override-core";

const item = (over: Partial<GreenwayMenuItem> = {}): GreenwayMenuItem =>
  ({
    id: "SKU-1",
    name: "Test",
    brand: "Brand",
    category: "concentrate",
    strainType: "hybrid",
    thc: null,
    cbd: null,
    totalThc: null,
    totalCbd: null,
    variants: [],
    inventoryStatus: "in-stock",
    ...over,
  }) as unknown as GreenwayMenuItem;

describe("menu-category-override-core", () => {
  it("embedded self-tests pass", () => {
    const { passed } = __runMenuCategoryOverrideCoreTests();
    expect(passed).toBeGreaterThanOrEqual(14);
  });

  it("only real website categories are valid", () => {
    expect(isValidWebsiteCategory("flower")).toBe(true);
    expect(isValidWebsiteCategory("concentrate")).toBe(true);
    expect(isValidWebsiteCategory("not-a-real-category")).toBe(false);
    expect(isValidWebsiteCategory(null)).toBe(false);
    expect(isValidWebsiteCategory(undefined)).toBe(false);
  });

  it("empty map returns the same items untouched", () => {
    const items = [item()];
    expect(applyCategoryOverrides(items, new Map())).toBe(items);
  });

  it("a valid override changes category and recomputes filterCategories", () => {
    const base = item({ category: "concentrate" });
    const out = applyCategoryOverrides([base], new Map([["SKU-1", "cartridge"]]));
    expect(out[0]).not.toBe(base);
    expect(out[0].category).toBe("cartridge");
    expect([...(out[0].filterCategories ?? [])].sort()).toEqual(["cartridge", "concentrate"]);
  });

  it("invalid, null, and no-op overrides leave the item referentially identical", () => {
    const base = item({ category: "flower" });
    expect(applyCategoryOverrides([base], new Map([["SKU-1", "nope"]]))[0]).toBe(base);
    expect(applyCategoryOverrides([base], new Map([["SKU-1", null]]))[0]).toBe(base);
    expect(applyCategoryOverrides([base], new Map([["SKU-1", "flower"]]))[0]).toBe(base);
  });

  it("only the targeted item changes", () => {
    const a = item({ id: "A", category: "flower" });
    const b = item({ id: "B", category: "flower" });
    const out = applyCategoryOverrides([a, b], new Map([["B", "concentrate"]]));
    expect(out[0]).toBe(a);
    expect(out[1].category).toBe("concentrate");
  });

  it("filterCategories fan-out mirrors the import transform", () => {
    expect(filterCategoriesForOverride("preroll-pack").sort()).toEqual(["preroll", "preroll-pack"]);
    expect(filterCategoriesForOverride("popcorn-bud").sort()).toEqual(["flower", "popcorn-bud"]);
    expect(filterCategoriesForOverride("infused-flower").sort()).toEqual([
      "concentrate",
      "flower",
      "infused-flower",
    ]);
    expect(filterCategoriesForOverride("disposable-cartridge").sort()).toEqual([
      "concentrate",
      "disposable-cartridge",
    ]);
    expect(filterCategoriesForOverride("flower", "Blunt").sort()).toEqual(["blunt", "flower"]);
    expect(filterCategoriesForOverride("flower", "Tincture").sort()).toEqual(["flower", "tincture"]);
    expect(filterCategoriesForOverride("flower").sort()).toEqual(["flower"]);
  });
});
