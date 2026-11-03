/**
 * D160 - WCIA deliveries (Cultivera vendors) store the state's placeholder
 * "EndProduct" as the lot category, which refused the whole delivery's goods
 * receipt and vendor bill (Edgemont/Sungrown 32 lots, Bellevue 27 lots). The
 * lot is now filed by its state inventory type + product name, only when the
 * category itself is not recognised; never into a non-cannabis account.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inventoryTypeSlug, mapLotCategory, mapReceiptCategory } from "@/lib/accounting/receipt-category-core";

describe("D160 books: state inventory type files EndProduct lots", () => {
  it("files the real Edgemont / Bellevue lots by product line", () => {
    const cases: [string, string, string][] = [
      ["Concentrate for Inhalation", "Full Spec - Elite - Cartridge - 1g - (Core 5) (I) Night Nurse", "cartridge"],
      ["Concentrate for Inhalation", "Thrills - FlavorStrains ERASR - AIO - 1g - (C5) (S) Tropicana Cookies", "disposable-cartridge"],
      ["Concentrate for Inhalation", "Solr Bear - Live Rosin Badder - 1g - (H) Orange Cake", "concentrate"],
      ["Usable Cannabis", "3.5g - DOH / Toad Venom (I)", "flower"],
      ["Usable Cannabis", "DOH-Full Flower Glass Tip Preroll - 3pack (3.6g) / Blue Jam- (IH)", "preroll-pack"],
      ["Cannabis Mix Packaged", "ThunderStix BLUNT-Tilted-DOH-glass tip preroll(1.2g) / Toad Venom (I)", "blunt"],
      ["Solid Edible", "SG Stash - Drops - Rosin Gummies - 20 Pack - Edible - 100mg - (Active)", "edible-solid"],
    ];
    for (const [inventory_type, product_name, want] of cases) {
      const m = mapLotCategory({ category: "EndProduct", inventory_type, product_name });
      expect(m.kind === "mapped" ? m.slug : m.kind).toBe(want);
    }
  });

  it("keeps the old discipline: known categories unchanged, unknown types refuse, blank stays unknown", () => {
    expect(mapReceiptCategory("EndProduct").kind).toBe("refused");
    expect(mapLotCategory({ category: "Accessories", inventory_type: "Usable Marijuana", product_name: "x" })).toMatchObject({ kind: "mapped", slug: "accessories" });
    expect(mapLotCategory({ category: "EndProduct", inventory_type: "Something New", product_name: "x" }).kind).toBe("refused");
    expect(mapLotCategory({ category: "EndProduct", inventory_type: null, product_name: "x" }).kind).toBe("refused");
    expect(mapLotCategory({ category: null, inventory_type: "Usable Cannabis", product_name: "x" }).kind).toBe("unknown");
    for (const t of ["Concentrate for Inhalation", "Usable Cannabis", "Cannabis Mix Packaged", "Cannabis Mix Infused", "Solid Edible", "Liquid Edible", "Topical Ointment", "Tincture"]) {
      expect(["accessories", "paraphernalia", "merch", null]).not.toContain(inventoryTypeSlug(t, "Pipe accessory merch"));
    }
  });

  it("the receipt and the vendor bill both use it and read the two columns", () => {
    for (const f of ["src/lib/accounting/receipt-service.ts", "src/lib/accounting/vendor-bill-service.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("mapLotCategory(lot)");
      expect(src).toMatch(/\.select\("id, lot_code, category, inventory_type, product_name, /);
    }
  });
});
