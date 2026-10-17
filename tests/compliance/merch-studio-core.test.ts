/** R70 S1 - Merch Studio pure cores under vitest. */
import { describe, it, expect } from "vitest";
import { __runGarmentViewsTests } from "@/lib/merch-studio/garment-views-core";
import { __runMerchDesignTests } from "@/lib/merch-studio/merch-design-core";
import { __runGarmentCatalogTests, BLANKS } from "@/lib/merch-studio/garment-catalog-core";
import { __runPrintRulesTests } from "@/lib/merch-studio/print-rules-core";
import { __runFulfillmentTests } from "@/lib/merch-studio/fulfillment-core";
import { __runPrintExportTests } from "@/lib/merch-studio/print-export-core";
import { __runListingPackageTests } from "@/lib/merch-studio/listing-package-core";
import { __runMerchAdTests } from "@/lib/merch/merch-ad-core";
import { JIT_PIPELINE, SHIPPED_SLICE } from "@/lib/merch-studio/fulfillment-core";

describe("merch studio cores", () => {
  it("garment-catalog-core", () => {
    const r = __runGarmentCatalogTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(150);
  });
  it("print-rules-core", () => {
    const r = __runPrintRulesTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(29);
  });
  it("fulfillment-core", () => {
    const r = __runFulfillmentTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(11);
  });
  it("garment-views-core", () => {
    const r = __runGarmentViewsTests(BLANKS);
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(250);
  });
  it("merch-design-core", () => {
    const r = __runMerchDesignTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(42);
  });
  it("print-export-core", () => {
    const r = __runPrintExportTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(85);
  });
  it("listing-package-core (R71 S4)", () => {
    const r = __runListingPackageTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(29);
  });
  it("merch-ad-core (R71 S4)", () => {
    const r = __runMerchAdTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(51);
  });
  it("R72 S5 roadmap: Slice 5 shipped (greenwaymerch.com checkout); Printful orders Slice 6", () => {
    expect(SHIPPED_SLICE).toBe(5);
    expect(JIT_PIPELINE.find((s) => s.id === "sell")?.slice).toBe(5);
    expect(JIT_PIPELINE.find((s) => s.id === "order")?.slice).toBe(6);
    expect(JIT_PIPELINE.some((s) => /subdomain/i.test(s.title + s.what))).toBe(false);
  });
});
