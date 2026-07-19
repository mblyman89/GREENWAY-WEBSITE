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
  parseVariantSelections,
  clampVariantQty,
  variantDisplayName,
  buildVariantPrefills,
  variantPrefillBanner,
  type MenuPrefillItemLike,
  type VariantLike,
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

/* ------------------------------------------------------------------
 * CH-3 — per-variant hand-off (sizes table → PO builder)
 * ------------------------------------------------------------------ */

describe("parseVariantSelections", () => {
  it("reads vq_<id> params with positive integer quantities", () => {
    const sels = parseVariantSelections({ vq_447772: "3", vq_9: "1", other: "x" });
    expect(sels).toEqual([
      { variantId: "447772", qty: 3 },
      { variantId: "9", qty: 1 },
    ]);
  });
  it("drops zero/negative/junk/empty-id entries", () => {
    expect(parseVariantSelections({ vq_1: "0" })).toHaveLength(0);
    expect(parseVariantSelections({ vq_1: "-2" })).toHaveLength(0);
    expect(parseVariantSelections({ vq_1: "junk" })).toHaveLength(0);
    expect(parseVariantSelections({ vq_: "3" })).toHaveLength(0);
  });
  it("truncates fractions, takes the first of arrays, respects the cap", () => {
    expect(parseVariantSelections({ vq_1: "2.9" })[0].qty).toBe(2);
    expect(parseVariantSelections({ vq_1: ["4", "9"] })[0].qty).toBe(4);
    expect(parseVariantSelections({ vq_1: "1", vq_2: "1", vq_3: "1" }, 2)).toHaveLength(2);
    expect(parseVariantSelections({}, 0)).toHaveLength(0);
  });
});

describe("clampVariantQty", () => {
  it("clamps to MaxOrderLimit and availability (tightest wins)", () => {
    expect(clampVariantQty(5, null, null)).toBe(5);
    expect(clampVariantQty(100, 75, null)).toBe(75);
    expect(clampVariantQty(100, null, 20)).toBe(20);
    expect(clampVariantQty(100, 75, 20)).toBe(20);
  });
  it("never returns below 1 and ignores zero limits", () => {
    expect(clampVariantQty(0, null, null)).toBe(1);
    expect(clampVariantQty(Number.NaN, null, null)).toBe(1);
    expect(clampVariantQty(5, 0, 0)).toBe(5);
  });
});

describe("variantDisplayName", () => {
  it("prefers the clean name, appending the size when missing", () => {
    expect(variantDisplayName({ cleanName: "Luxor", name: "Luxor [1g]", sizeLabel: "1g" }, "Line")).toBe(
      "Luxor — 1g",
    );
    expect(variantDisplayName({ cleanName: "Luxor 1g", name: null, sizeLabel: "1g" }, null)).toBe("Luxor 1g");
  });
  it("falls back to the product-line name, then a neutral label", () => {
    expect(variantDisplayName({ cleanName: null, name: null, sizeLabel: "1g" }, "Signature Line")).toBe(
      "Signature Line — 1g",
    );
    expect(variantDisplayName({ cleanName: null, name: null, sizeLabel: null }, null)).toBe("Cultivera variant");
  });
});

describe("buildVariantPrefills", () => {
  const vlist: VariantLike[] = [
    { variantId: "1", cleanName: "Luxor", name: "Luxor [1g]", sizeLabel: "1g",
      unitPriceMinor: 450, availableQty: 20, maxOrderLimit: null },
    { variantId: "2", cleanName: "Wedding Cake", name: "Wedding Cake [3.5g]", sizeLabel: "3.5g",
      unitPriceMinor: 1400, availableQty: 1471, maxOrderLimit: 75 },
    { variantId: "3", cleanName: "Ghost", name: null, sizeLabel: null,
      unitPriceMinor: null, availableQty: null, maxOrderLimit: null },
  ];
  it("keeps stored order, clamps quantities, threads the vendor", () => {
    const vp = buildVariantPrefills(
      vlist,
      [{ variantId: "2", qty: 100 }, { variantId: "1", qty: 3 }],
      "Signature Flower Line",
      "v1",
      "Lifted Cannabis",
    );
    expect(vp).toHaveLength(2);
    expect(vp[0].productName).toBe("Luxor — 1g");
    expect(vp[0].suggestedQty).toBe(3);
    expect(vp[0].unitCostMinor).toBe(450);
    expect(vp[1].suggestedQty).toBe(75); // clamped to MaxOrderLimit
    expect(vp[1].vendorId).toBe("v1");
    expect(vp[1].vendorName).toBe("Lifted Cannabis");
  });
  it("ignores unknown ids, empty selections, and applies the cap", () => {
    expect(buildVariantPrefills(vlist, [{ variantId: "nope", qty: 1 }], null, null, null)).toHaveLength(0);
    expect(buildVariantPrefills(vlist, [], null, null, null)).toHaveLength(0);
    expect(
      buildVariantPrefills(vlist, [{ variantId: "1", qty: 1 }, { variantId: "2", qty: 1 }], null, null, null, 1),
    ).toHaveLength(1);
  });
  it("maps null prices to 0 cents and never floats", () => {
    const vp = buildVariantPrefills(vlist, [{ variantId: "3", qty: 2 }], "Line", null, null);
    expect(vp[0].unitCostMinor).toBe(0);
    expect(vp[0].productName).toBe("Ghost");
    expect(Number.isInteger(vp[0].unitCostMinor)).toBe(true);
  });
});

describe("variantPrefillBanner", () => {
  it("pluralizes sizes and includes the vendor when known", () => {
    expect(variantPrefillBanner(2, "Lifted Cannabis").startsWith(
      "Started from a Cultivera sizes table: 2 sizes from Lifted Cannabis",
    )).toBe(true);
    expect(variantPrefillBanner(1, null).startsWith(
      "Started from a Cultivera sizes table: 1 size ",
    )).toBe(true);
  });
});
