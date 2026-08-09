import { describe, it, expect } from "vitest";
import {
  normalizeCcrsType,
  slugifyDashedPure,
  matchCategoryByCcrsType,
  resolveCategoryForType,
  __runCcrsCategoryMatchCoreTests,
  type CcrsMatchCategory,
} from "@/lib/ai/kb/ccrs-category-match-core";

// A realistic slice of KB categories using EXACT CCRS/LCB inventory-type names
// (verbatim from product-categories-data.ts wa_inventory_types) so these cases
// reflect the real join the intake->KB writeback performs.
const cats: CcrsMatchCategory[] = [
  { id: "flower", slug: "flower", name: "Flower", sort_order: 0, wa_inventory_types: ["Flower Lot", "Usable Marijuana", "Marijuana Mix"] },
  { id: "pre-roll", slug: "pre-roll", name: "Pre-Rolls", sort_order: 1, wa_inventory_types: ["Marijuana Mix Infused"] },
  { id: "wax", slug: "wax", name: "Wax", sort_order: 2, wa_inventory_types: ["Hydrocarbon Wax"] },
  { id: "shatter", slug: "shatter", name: "Shatter", sort_order: 3, wa_inventory_types: ["Food Grade Solvent Extract"] },
  { id: "cart", slug: "vape-cartridge", name: "Vape Cartridge", sort_order: 4, wa_inventory_types: ["Marijuana Extract for Inhalation", "Concentrate for Inhalation"] },
  { id: "gummies", slug: "gummies", name: "Gummies", sort_order: 5, wa_inventory_types: ["Solid Marijuana Infused Edible"] },
  { id: "tincture", slug: "tincture", name: "Tincture", sort_order: 6, wa_inventory_types: ["Liquid Marijuana Infused Edible"] },
];

describe("ccrs-category-match core", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runCcrsCategoryMatchCoreTests()).not.toThrow();
  });

  it("normalizes: trims, lower-cases, collapses whitespace; null -> empty", () => {
    expect(normalizeCcrsType("  Hydrocarbon   Wax ")).toBe("hydrocarbon wax");
    expect(normalizeCcrsType(null)).toBe("");
    expect(normalizeCcrsType(undefined)).toBe("");
  });

  it("slugifyDashedPure mirrors the writeback slugifier", () => {
    expect(slugifyDashedPure("Vape Cartridge")).toBe("vape-cartridge");
    expect(slugifyDashedPure("  Concentrate for Inhalation ")).toBe("concentrate-for-inhalation");
    expect(slugifyDashedPure(null)).toBe("");
  });

  it("matches on the CCRS name (the join key that used to be missed)", () => {
    expect(matchCategoryByCcrsType("Hydrocarbon Wax", cats)?.id).toBe("wax");
    expect(matchCategoryByCcrsType("Food Grade Solvent Extract", cats)?.id).toBe("shatter");
    expect(matchCategoryByCcrsType("Solid Marijuana Infused Edible", cats)?.id).toBe("gummies");
    expect(matchCategoryByCcrsType("Liquid Marijuana Infused Edible", cats)?.id).toBe("tincture");
  });

  it("CCRS matching is case- and whitespace-insensitive", () => {
    expect(matchCategoryByCcrsType("  marijuana extract   for inhalation ", cats)?.id).toBe("cart");
    expect(matchCategoryByCcrsType("HYDROCARBON WAX", cats)?.id).toBe("wax");
  });

  it("never guesses: unknown CCRS type -> null", () => {
    expect(matchCategoryByCcrsType("Some Brand New CCRS Type", cats)).toBeNull();
    expect(matchCategoryByCcrsType("", cats)).toBeNull();
    expect(matchCategoryByCcrsType(null, cats)).toBeNull();
  });

  it("resolveCategoryForType precedence: slug wins first", () => {
    const r = resolveCategoryForType("flower", cats);
    expect(r.source).toBe("slug");
    expect(r.id).toBe("flower");
  });

  it("resolveCategoryForType: name wins when slug misses", () => {
    // "Pre-Rolls" slugifies to "pre-rolls" (not a slug here), but matches name.
    const r = resolveCategoryForType("Pre-Rolls", cats);
    expect(r.source).toBe("name");
    expect(r.id).toBe("pre-roll");
  });

  it("resolveCategoryForType: CCRS fills the gap slug+name both miss", () => {
    // The real-world case: a raw CCRS string that is neither a slug nor a name.
    const r = resolveCategoryForType("Concentrate for Inhalation", cats);
    expect(r.source).toBe("ccrs");
    expect(r.id).toBe("cart");

    const r2 = resolveCategoryForType("Usable Marijuana", cats);
    expect(r2.source).toBe("ccrs");
    expect(r2.id).toBe("flower");
  });

  it("resolveCategoryForType: honest miss -> none (product_category_id stays null)", () => {
    const r = resolveCategoryForType("Totally Unknown Regulatory Type", cats);
    expect(r.source).toBe("none");
    expect(r.id).toBeNull();
    expect(r.category).toBeNull();
    expect(resolveCategoryForType("", cats).source).toBe("none");
  });

  it("is deterministic on ties: lowest sort_order wins, stable across input order", () => {
    const dupe: CcrsMatchCategory[] = [
      { id: "b", slug: "b-cat", name: "B", sort_order: 9, wa_inventory_types: ["Shared Type"] },
      { id: "a", slug: "a-cat", name: "A", sort_order: 1, wa_inventory_types: ["Shared Type"] },
    ];
    expect(matchCategoryByCcrsType("Shared Type", dupe)?.id).toBe("a");
    // Reversed input still resolves the same way.
    expect(matchCategoryByCcrsType("Shared Type", [...dupe].reverse())?.id).toBe("a");
  });

  it("existing slug/name resolutions are unchanged by the added CCRS leg", () => {
    // Anything that resolved by slug or name before must still resolve identically.
    // slug leg: the value slugifies to an existing category slug.
    expect(resolveCategoryForType("wax", cats).source).toBe("slug");
    expect(resolveCategoryForType("Flower", cats).source).toBe("slug");
    // name leg: "Pre-Rolls" slugifies to "pre-rolls" (not a slug here) so it
    // falls through to the case-insensitive name match on "Pre-Rolls".
    expect(resolveCategoryForType("Pre-Rolls", cats).source).toBe("name");
  });
});
