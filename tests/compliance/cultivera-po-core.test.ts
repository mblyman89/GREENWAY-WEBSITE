/**
 * Vitest mirror of the cultivera-po-core self-tests (CV-6).
 * Exercises the SAME behaviors as __runCultiveraPoCoreTests so CI covers
 * the menu → PO hand-off mapper even without the pure runner.
 */
import { describe, expect, it } from "vitest";
import {
  MENU_PREFILL_CAP,
  parseMenuItemIds,
  menuItemDisplayName,
  prefillCostMinor,
  menuItemToPoPrefill,
  buildMenuPrefills,
  menuPrefillBanner,
  type MenuPrefillItemLike,
} from "@/lib/purchasing/cultivera-po-core";

function mkItem(over: Partial<MenuPrefillItemLike>): MenuPrefillItemLike {
  return {
    id: "i1",
    name: "Blue Dream",
    brand: "Acme",
    category: "Flower",
    size_label: "3.5g",
    wholesale_price_minor: 1250,
    ...over,
  };
}

describe("parseMenuItemIds", () => {
  it("handles undefined, empty, single, repeated, and csv forms", () => {
    expect(parseMenuItemIds(undefined)).toEqual([]);
    expect(parseMenuItemIds("")).toEqual([]);
    expect(parseMenuItemIds("a")).toEqual(["a"]);
    expect(parseMenuItemIds(["a", "b"])).toEqual(["a", "b"]);
    expect(parseMenuItemIds("a,b,c")).toEqual(["a", "b", "c"]);
    expect(parseMenuItemIds(["a,b", "c"])).toEqual(["a", "b", "c"]);
  });
  it("trims, drops empties, dedupes preserving order", () => {
    expect(parseMenuItemIds([" a ", "", "b"])).toEqual(["a", "b"]);
    expect(parseMenuItemIds(["a", "b", "a"])).toEqual(["a", "b"]);
  });
  it("caps the list (explicit, zero, negative, and default caps)", () => {
    expect(parseMenuItemIds(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(parseMenuItemIds("a", 0)).toEqual([]);
    expect(parseMenuItemIds("a", -1)).toEqual([]);
    const many = Array.from({ length: 100 }, (_, i) => `id${i}`);
    expect(parseMenuItemIds(many)).toHaveLength(MENU_PREFILL_CAP);
  });
});

describe("menuItemDisplayName", () => {
  it("appends the size label unless already in the name (case-insensitive)", () => {
    expect(menuItemDisplayName({ name: "Blue Dream", size_label: "3.5g" })).toBe("Blue Dream — 3.5g");
    expect(menuItemDisplayName({ name: "Blue Dream 3.5g Jar", size_label: "3.5g" })).toBe("Blue Dream 3.5g Jar");
    expect(menuItemDisplayName({ name: "Blue Dream 3.5G Jar", size_label: "3.5g" })).toBe("Blue Dream 3.5G Jar");
  });
  it("trims and falls back for missing names", () => {
    expect(menuItemDisplayName({ name: "Blue Dream", size_label: null })).toBe("Blue Dream");
    expect(menuItemDisplayName({ name: "  Blue Dream  ", size_label: "" })).toBe("Blue Dream");
    expect(menuItemDisplayName({ name: null, size_label: null })).toBe("Cultivera menu item");
    expect(menuItemDisplayName({ name: "  ", size_label: "1g" })).toBe("Cultivera menu item — 1g");
  });
});

describe("prefillCostMinor", () => {
  it("passes through integer cents and sanitizes bad values", () => {
    expect(prefillCostMinor(1250)).toBe(1250);
    expect(prefillCostMinor(null)).toBe(0);
    expect(prefillCostMinor(-50)).toBe(0);
    expect(prefillCostMinor(12.6)).toBe(13);
    expect(prefillCostMinor(Number.NaN)).toBe(0);
    expect(prefillCostMinor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("menuItemToPoPrefill", () => {
  it("maps a saved menu item to a draft builder line", () => {
    const line = menuItemToPoPrefill(mkItem({}), "v1", "Acme Farms");
    expect(line.posProductKey).toBeNull();
    expect(line.productName).toBe("Blue Dream — 3.5g");
    expect(line.brand).toBe("Acme");
    expect(line.category).toBe("Flower");
    expect(line.vendorId).toBe("v1");
    expect(line.vendorName).toBe("Acme Farms");
    expect(line.onHand).toBe(0);
    expect(line.avgDaily).toBe(0);
    expect(line.reorderPoint).toBe(0);
    expect(line.unit).toBe("each");
    expect(line.unitCostMinor).toBe(1250);
    expect(line.suggestedQty).toBe(1);
    expect(line.belowReorderPoint).toBe(true);
    expect(line.daysOfSupplyLeft).toBe(0);
  });
  it("normalizes blanks and nulls", () => {
    const bare = menuItemToPoPrefill(
      mkItem({ brand: "  ", category: null, wholesale_price_minor: null }),
      null,
      null,
    );
    expect(bare.brand).toBeNull();
    expect(bare.category).toBeNull();
    expect(bare.unitCostMinor).toBe(0);
    expect(bare.vendorId).toBeNull();
    expect(bare.vendorName).toBeNull();
  });
});

describe("buildMenuPrefills", () => {
  const items = [
    mkItem({ id: "a", name: "Alpha" }),
    mkItem({ id: "b", name: "Bravo" }),
    mkItem({ id: "c", name: "Charlie" }),
  ];
  it("keeps menu order and only includes ticked items", () => {
    const built = buildMenuPrefills(items, ["c", "a"], "v1", "Acme Farms");
    expect(built).toHaveLength(2);
    expect(built[0].productName.startsWith("Alpha")).toBe(true);
    expect(built[1].productName.startsWith("Charlie")).toBe(true);
  });
  it("ignores unknown ids and handles empty inputs + cap", () => {
    expect(buildMenuPrefills(items, ["nope"], null, null)).toHaveLength(0);
    expect(buildMenuPrefills(items, [], "v1", "x")).toHaveLength(0);
    expect(buildMenuPrefills(items, ["a", "b", "c"], null, null, 2)).toHaveLength(2);
    expect(buildMenuPrefills([], ["a"], null, null)).toHaveLength(0);
  });
});

describe("menuPrefillBanner", () => {
  it("pluralizes and includes the vendor when known", () => {
    expect(menuPrefillBanner(3, "Acme Farms")).toBe(
      "Started from a Cultivera menu: 3 items from Acme Farms pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    );
    expect(menuPrefillBanner(1, null)).toBe(
      "Started from a Cultivera menu: 1 item pre-added below as draft lines — confirm quantities, costs, and the vendor, then save.",
    );
  });
});
