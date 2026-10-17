/** R70 S1 - Merch Studio pure cores under vitest. */
import { describe, it, expect } from "vitest";
import { __runGarmentCatalogTests } from "@/lib/merch-studio/garment-catalog-core";
import { __runPrintRulesTests } from "@/lib/merch-studio/print-rules-core";
import { __runFulfillmentTests } from "@/lib/merch-studio/fulfillment-core";

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
});
