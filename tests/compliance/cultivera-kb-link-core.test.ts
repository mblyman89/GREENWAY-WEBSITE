/**
 * Vitest mirror of the cultivera-kb-link-core pure self-tests (CV-7).
 * Locks the KB product-identity derivation so the slug rule can never drift
 * from the crawler (kb_products.py) or the app write-back path. This identity
 * is STRAIN/PRODUCT level (variantLabel always "") because the owner wants ONE
 * image per strain — not one per size variant.
 */
import { describe, expect, it } from "vitest";

import {
  kbDisplayNameForItem,
  kbIdentityForItem,
  slugifyDashed,
  normalizeStrainKey,
  strainImagesToSave,
  type StrainVariantLike,
  __runCultiveraKbLinkCoreTests,
} from "@/lib/purchasing/cultivera-kb-link-core";

describe("cultivera-kb-link-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runCultiveraKbLinkCoreTests()).not.toThrow();
  });

  it("slugifyDashed matches the canonical rule", () => {
    expect(slugifyDashed("Blue Nerdz")).toBe("blue-nerdz");
    expect(slugifyDashed("  Crunch Berries!!!  ")).toBe("crunch-berries");
    expect(slugifyDashed("---SubX---")).toBe("subx");
    expect(slugifyDashed(null)).toBe("");
  });

  it("derives a durable STRAIN-LEVEL NUL-joined identity (empty variant)", () => {
    const id = kbIdentityForItem({ name: "Blue Nerdz", brand: "SubX", category: "flower" });
    expect(id.brandSlug).toBe("subx");
    expect(id.productSlug).toBe("blue-nerdz");
    expect(id.variantLabel).toBe("");
    expect(id.posProductKey).toBe("subx\u0000blue-nerdz\u0000");
    expect(id.displayName).toBe("SubX — Blue Nerdz");
  });

  it("falls back to the same sentinels writeBackProductFacts uses", () => {
    const miss = kbIdentityForItem({ name: null, brand: null });
    expect(miss.brandSlug).toBe("unknown-brand");
    expect(miss.productSlug).toBe("product");
    expect(miss.variantLabel).toBe("");
    expect(miss.posProductKey).toBe("unknown-brand\u0000product\u0000");
  });

  it("builds graceful display names", () => {
    expect(kbDisplayNameForItem({ name: "i95 Cookies", brand: null })).toBe("i95 Cookies");
    expect(kbDisplayNameForItem({ name: null, brand: "SubX" })).toBe("SubX");
    expect(kbDisplayNameForItem({ name: "MAC", brand: "SubX" })).toBe("SubX — MAC");
    expect(kbDisplayNameForItem({ name: null, brand: null })).toBe("Cultivera product");
  });

  it("normalizeStrainKey trims, lowercases, and collapses whitespace", () => {
    expect(normalizeStrainKey("  Colorado   Nightshifter ")).toBe("colorado nightshifter");
    expect(normalizeStrainKey("Super Zulu")).toBe("super zulu");
    expect(normalizeStrainKey(null)).toBe("");
  });

  it("strainImagesToSave saves ONE image per DISTINCT strain (sizes collapsed)", () => {
    const variants: StrainVariantLike[] = [
      { cleanName: "Colorado Nightshifter", imageUrl: "https://c/cn.png", position: 0 },
      { cleanName: "Colorado Nightshifter", imageUrl: null, position: 1 },
      { cleanName: "Colorado Nightshifter", imageUrl: "https://c/cn2.png", position: 2 },
      { cleanName: "Super Zulu", imageUrl: null, position: 3 },
      { cleanName: "Super Zulu", imageUrl: null, position: 4 },
    ];
    const saves = strainImagesToSave(variants, { brand: "SubX", lineImageUrl: "https://c/card.png" });
    expect(saves.length).toBe(2);
    // Colorado Nightshifter: first OWN image wins, keyed on the STRAIN name.
    expect(saves[0].strainName).toBe("Colorado Nightshifter");
    expect(saves[0].imageUrl).toBe("https://c/cn.png");
    expect(saves[0].imageIsFallback).toBe(false);
    expect(saves[0].identity.posProductKey).toBe("subx\u0000colorado-nightshifter\u0000");
    // Super Zulu: no own image anywhere -> product-card fallback, flagged.
    expect(saves[1].strainName).toBe("Super Zulu");
    expect(saves[1].imageUrl).toBe("https://c/card.png");
    expect(saves[1].imageIsFallback).toBe(true);
  });

  it("strainImagesToSave skips strains with no image anywhere", () => {
    const saves = strainImagesToSave(
      [{ cleanName: "Ghost", imageUrl: null }],
      { brand: "SubX", lineImageUrl: null },
    );
    expect(saves.length).toBe(0);
  });
});
