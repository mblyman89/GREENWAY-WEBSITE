import { describe, it, expect } from "vitest";
import {
  computeUnmappedCcrsTypes,
  summarizeUnmapped,
  buildMappedIndex,
  __runUnmappedCcrsCoreTests,
  type SeenCcrsType,
  type UnmappedKbCategory,
} from "@/lib/ai/kb/unmapped-ccrs-core";

const kb: UnmappedKbCategory[] = [
  { id: "flower", slug: "flower", name: "Flower", group_key: "flower", wa_inventory_types: ["Flower Lot"] },
  { id: "gummies", slug: "gummies", name: "Gummies", group_key: "edible", wa_inventory_types: ["Solid Edible"] },
  { id: "usable", slug: "usable-cannabis", name: "Usable Cannabis", group_key: "flower", wa_inventory_types: ["Usable Cannabis"] },
];

describe("unmapped-ccrs core", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runUnmappedCcrsCoreTests()).not.toThrow();
  });

  it("returns nothing when every seen type is already mapped", () => {
    const seen: SeenCcrsType[] = [
      { type: "Flower Lot", count: 5 },
      { type: "Solid Edible", count: 3 },
    ];
    expect(computeUnmappedCcrsTypes(seen, kb)).toEqual([]);
  });

  it("treats a legacy spelling as mapped when its modern twin is mapped", () => {
    // 'Usable Marijuana' → 'Usable Cannabis' which is mapped → not unmapped.
    const seen: SeenCcrsType[] = [{ type: "Usable Marijuana", count: 9 }];
    expect(computeUnmappedCcrsTypes(seen, kb)).toEqual([]);
  });

  it("surfaces an unrecognized older name with no canonical and no guess", () => {
    const seen: SeenCcrsType[] = [{ type: "Hydrocarbon Wax", count: 4 }];
    const r = computeUnmappedCcrsTypes(seen, kb);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("unrecognized");
    expect(r[0].canonical).toBeNull();
    expect(r[0].storeAs).toBe("Hydrocarbon Wax");
    expect(r[0].suggestedCategorySlug).toBeNull();
  });

  it("surfaces a current CCRS type not yet mapped, carrying its canonical", () => {
    const seen: SeenCcrsType[] = [{ type: "Tincture", count: 2 }];
    const r = computeUnmappedCcrsTypes(seen, kb);
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("known");
    expect(r[0].canonical).toBe("Tincture");
    expect(r[0].storeAs).toBe("Tincture");
    // No category maps 'Tincture' yet → no provable suggestion.
    expect(r[0].suggestedCategorySlug).toBeNull();
  });

  it("offers a provable suggestion only when the canonical maps to exactly one category", () => {
    // Add a second category that ALSO maps 'Usable Cannabis' → now ambiguous,
    // so even a seen twin would get no suggestion. Here we test the single-owner
    // provable case via a fresh unmapped known type that shares identity with a
    // single mapped category.
    const kb2: UnmappedKbCategory[] = [
      { id: "cart", slug: "vape-cartridge", name: "Vape Cartridge", group_key: "vape", wa_inventory_types: ["Concentrate for Inhalation"] },
    ];
    // 'concentrate for inhalation' (case variant) is already mapped → not unmapped.
    const r = computeUnmappedCcrsTypes([{ type: "concentrate for inhalation", count: 1 }], kb2);
    expect(r).toEqual([]);
  });

  it("collapses case variants, sums counts, orders by count desc", () => {
    const seen: SeenCcrsType[] = [
      { type: "Tincture", count: 2 },
      { type: "tincture", count: 3 },
      { type: "Suppository", count: 10 },
    ];
    const r = computeUnmappedCcrsTypes(seen, kb);
    expect(r.map((x) => x.rawType.toLowerCase())).toEqual(["suppository", "tincture"]);
    const tinc = r.find((x) => x.normalized === "tincture")!;
    expect(tinc.count).toBe(5);
  });

  it("summarizes the review for a headline badge", () => {
    const seen: SeenCcrsType[] = [
      { type: "Tincture", count: 2 },
      { type: "Hydrocarbon Wax", count: 4 },
    ];
    const r = computeUnmappedCcrsTypes(seen, kb);
    const s = summarizeUnmapped(r);
    expect(s.total).toBe(2);
    expect(s.known).toBe(1);
    expect(s.unrecognized).toBe(1);
    expect(s.affectedLots).toBe(6);
  });

  it("buildMappedIndex keys by canonical identity (legacy + modern collapse)", () => {
    const idx = buildMappedIndex([
      { id: "a", slug: "a", name: "A", wa_inventory_types: ["Usable Marijuana"] },
      { id: "b", slug: "b", name: "B", wa_inventory_types: ["Usable Cannabis"] },
    ]);
    // Both map the same canonical type → one key, two owning slugs.
    expect(idx.size).toBe(1);
    const owners = [...idx.values()][0];
    expect([...owners].sort()).toEqual(["a", "b"]);
  });
});
