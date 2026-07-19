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
});
