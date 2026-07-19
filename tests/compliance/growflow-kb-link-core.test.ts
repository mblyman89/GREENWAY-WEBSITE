/**
 * Vitest mirror of the growflow-kb-link-core pure self-tests (GF-7).
 * Locks the KB product-identity derivation so the slug/variant rule can never
 * drift from the crawler (kb_products.py) or the app write-back path.
 */
import { describe, expect, it } from "vitest";

import {
  kbDisplayNameForItem,
  kbIdentityForItem,
  normalizeVariantLabel,
  slugifyDashed,
  __runGrowflowKbLinkCoreTests,
} from "@/lib/purchasing/growflow-kb-link-core";

describe("growflow-kb-link-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runGrowflowKbLinkCoreTests()).not.toThrow();
  });

  it("slugifyDashed matches the canonical rule", () => {
    expect(slugifyDashed("Blue Dream")).toBe("blue-dream");
    expect(slugifyDashed("  OG Kush #18  ")).toBe("og-kush-18");
    expect(slugifyDashed("---Fire Bros.---")).toBe("fire-bros");
    expect(slugifyDashed(null)).toBe("");
  });

  it("normalizeVariantLabel keeps human spelling but strips spaces", () => {
    expect(normalizeVariantLabel("3.5g")).toBe("3.5g");
    expect(normalizeVariantLabel("1 g")).toBe("1g");
    expect(normalizeVariantLabel("  0.5 G ")).toBe("0.5g");
    expect(normalizeVariantLabel("")).toBe("");
  });

  it("derives a durable NUL-joined identity from a menu item", () => {
    const id = kbIdentityForItem({ name: "Blue Dream", brand: "Avitas", size_label: "1g" });
    expect(id.brandSlug).toBe("avitas");
    expect(id.productSlug).toBe("blue-dream");
    expect(id.variantLabel).toBe("1g");
    expect(id.posProductKey).toBe("avitas\u0000blue-dream\u00001g");
    expect(id.displayName).toBe("Avitas — Blue Dream 1g");
  });

  it("falls back to the same sentinels writeBackProductFacts uses", () => {
    const miss = kbIdentityForItem({ name: null, brand: null, size_label: null });
    expect(miss.brandSlug).toBe("unknown-brand");
    expect(miss.productSlug).toBe("product");
    expect(miss.variantLabel).toBe("");
    expect(miss.posProductKey).toBe("unknown-brand\u0000product\u0000");
  });

  it("reads the normalized-item sizeLabel spelling too", () => {
    const camel = kbIdentityForItem({ name: "Wedding Cake", brand: "Redbird", sizeLabel: "3.5g" });
    expect(camel.variantLabel).toBe("3.5g");
    expect(camel.posProductKey).toBe("redbird\u0000wedding-cake\u00003.5g");
  });

  it("builds graceful display names", () => {
    expect(kbDisplayNameForItem({ name: "Preroll", brand: null, size_label: null })).toBe("Preroll");
    expect(kbDisplayNameForItem({ name: "Gummies", brand: "Wyld", size_label: "10pk" })).toBe(
      "Wyld — Gummies 10pk",
    );
    expect(kbDisplayNameForItem({ name: null, brand: null, size_label: null })).toBe("GrowFlow product");
  });
});
