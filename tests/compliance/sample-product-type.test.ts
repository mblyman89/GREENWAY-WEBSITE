/**
 * tests/compliance/sample-product-type.test.ts  (H16b Samples Slice A)
 *
 * Pins the LCB-line → sample-ledger product-type mapping used when an accepted
 * email-intake sample line seeds an INCOMING trade_sample_events row. The
 * three-value target (useable | concentrate | infused) drives the per-unit size
 * caps in WAC 314-55-096(1)(e). Non-cannabis / unmappable lines are skipped.
 */
import { describe, it, expect } from "vitest";
import {
  sampleProductTypeFromWebsiteCategory,
  sampleProductTypeForLine,
  __runSampleProductTypeCoreTests,
} from "@/lib/compliance/sample-product-type-core";

describe("website-category → sample product type", () => {
  it("useable family (flower/preroll/trim) → useable", () => {
    expect(sampleProductTypeFromWebsiteCategory("flower")).toBe("useable");
    expect(sampleProductTypeFromWebsiteCategory("preroll")).toBe("useable");
    expect(sampleProductTypeFromWebsiteCategory("trim")).toBe("useable");
  });
  it("concentrate family → concentrate", () => {
    expect(sampleProductTypeFromWebsiteCategory("concentrate")).toBe("concentrate");
    expect(sampleProductTypeFromWebsiteCategory("cartridge")).toBe("concentrate");
    expect(sampleProductTypeFromWebsiteCategory("rso")).toBe("concentrate");
  });
  it("infused family (edibles/tincture/topical/infused-*) → infused", () => {
    expect(sampleProductTypeFromWebsiteCategory("edible-solid")).toBe("infused");
    expect(sampleProductTypeFromWebsiteCategory("tincture")).toBe("infused");
    expect(sampleProductTypeFromWebsiteCategory("infused-preroll")).toBe("infused");
  });
  it("non-cannabis / unknown → null (skip)", () => {
    expect(sampleProductTypeFromWebsiteCategory("accessories")).toBeNull();
    expect(sampleProductTypeFromWebsiteCategory("merch")).toBeNull();
    expect(sampleProductTypeFromWebsiteCategory(null)).toBeNull();
    expect(sampleProductTypeFromWebsiteCategory("mystery")).toBeNull();
  });
});

describe("LCB line → sample product type (resolver reuse)", () => {
  it("maps common LCB types end-to-end", () => {
    expect(sampleProductTypeForLine({ productName: "Blue Dream", inventoryType: "Usable Cannabis" })).toBe("useable");
    expect(sampleProductTypeForLine({ productName: "Live Resin", inventoryType: "Concentrate for Inhalation" })).toBe("concentrate");
    expect(sampleProductTypeForLine({ productName: "Gummies", inventoryType: "Solid Edible" })).toBe("infused");
  });
});

describe("embedded self-tests still pass under vitest", () => {
  it("__runSampleProductTypeCoreTests", () => {
    expect(() => __runSampleProductTypeCoreTests()).not.toThrow();
  });
});
