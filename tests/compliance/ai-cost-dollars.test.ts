/**
 * AI-$ - dollars spent on the AI Usage page.
 * Owner (verbatim): "I am hoping we can include dollars spent for all the
 * credits I've used. ... Please make the page much more detailed with regard
 * to money spent."
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { __runAiCostCoreTests, priceRow } from "@/lib/ai/ai-cost-core";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("AI-$ ai-cost-core", () => {
  it("self-tests run at the measured 24 and are registered", () => {
    const r = __runAiCostCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(24);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("ai-cost-core", __runAiCostCoreTests(), 24)');
  });
  it("an unknown model is never guessed", () => {
    const c = priceRow({ feature: "x", model: "nope-1", prompt_tokens: 9, completion_tokens: 9, total_tokens: 18, estimated: false, ok: true, error_note: null, created_at: "2026-11-01T00:00:00Z" });
    expect(c).toMatchObject({ basis: "unpriced", cents: 0 });
  });
  it("every model the code defaults to has a price", () => {
    for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gemini-4-carbon", "gemini-3.5-flash-lite", "gemini-embedding-2", "gpt-image-2", "gemini-nano-banana-2.1", "flux-tools/erase-v1", "flux-pro-1.0-fill", "flux-pro-1.0-expand", "flux-kontext-pro", "flux-tools/deblur-v1"]) {
      const c = priceRow({ feature: "x", model: m, prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000, estimated: false, ok: true, error_note: null, created_at: "2026-11-01T00:00:00Z" });
      expect(c.basis, m).toBe("list-price");
    }
  });
});

describe("AI-$ wiring", () => {
  it("the page reads the spend report and the read pages with a unique tiebreak", () => {
    const page = read("src/app/admin/ai-usage/page.tsx");
    expect(page).toContain("getAiSpendReport(30)");
    expect(page).toContain("These dollar figures may be LOW");
    const usage = read("src/lib/ai/usage.ts");
    expect(usage).toMatch(/getAiSpendReport[\s\S]*\.order\("id", \{ ascending: true \}\)/);
  });
});
