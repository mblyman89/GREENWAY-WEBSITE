import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { __runVendorLookupProgressTests } from "@/lib/catalog/vendor-lookup-progress-core";

describe("R74 S44 - lookup progress by vendor + pipeline bar", () => {
  it("self-tests pass", () => {
    expect(__runVendorLookupProgressTests()).toEqual({ passed: 16, failed: 0 }) // R74 S49: +2 (stuck);
  });
  it("is wired into the tab, the page and the lookup writers", () => {
    expect(readFileSync("src/app/admin/inventory/batch-lookups/ConfidenceTab.tsx", "utf8")).toContain("<VendorProgressTable");
    expect(readFileSync("src/app/admin/inventory/batch-lookups/page.tsx", "utf8")).toContain('<CatalogStageStrip current="onboard" />');
    expect(readFileSync("src/lib/ai/gemini-batch-server.ts", "utf8")).toContain("_asked");
    expect(readFileSync("src/lib/catalog/lookup-job-server.ts", "utf8")).toContain("asked: askedText");
  });
});
