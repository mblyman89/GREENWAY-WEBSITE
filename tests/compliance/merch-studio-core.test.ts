/** R70 S1 - Merch Studio pure cores under vitest. */
import { describe, it, expect } from "vitest";
import { __runGarmentViewsTests } from "@/lib/merch-studio/garment-views-core";
import { __runMerchDesignTests } from "@/lib/merch-studio/merch-design-core";
import { __runGarmentCatalogTests, BLANKS } from "@/lib/merch-studio/garment-catalog-core";
import { __runPrintRulesTests } from "@/lib/merch-studio/print-rules-core";
import { __runFulfillmentTests } from "@/lib/merch-studio/fulfillment-core";
import { __runPrintExportTests } from "@/lib/merch-studio/print-export-core";

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
});
