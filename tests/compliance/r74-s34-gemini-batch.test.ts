/**
 * R74 S34 - Gemini Batch API engine: pinned self-test count + wiring.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { __runGeminiBatchCoreTests, productFamilyKey, lookupEngine } from "@/lib/ai/gemini-batch-core";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("R74 S34 gemini-batch-core", () => {
  it("self-tests run at the measured 23 and are registered", () => {
    const r = __runGeminiBatchCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(23);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/__runGeminiBatchCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 23\)/);
  });
  it("a 2nd lot and a size variant ask Gemini once", () => {
    expect(productFamilyKey({ brand: "B", productName: "Runtz 3.5g", category: "flower" })).toBe(productFamilyKey({ brand: "B", productName: "Runtz 7g", category: "flower" }));
    expect(lookupEngine(undefined)).toBe("live");
  });
});

describe("R74 S34 wiring", () => {
  it("the cron runs the batch tick; the live tick stands down when the engine is batch", () => {
    const route = read("src/app/api/cron/lookup-jobs/route.ts");
    expect(route).toContain("const batch = await runGeminiBatchTick({ budgetMs: 180_000 });");
    const srv = read("src/lib/catalog/lookup-job-server.ts");
    expect(srv).toContain('lookupEngine(process.env[AI_LOOKUP_ENGINE_ENV]) === "batch") return { ok: true, skipped: "batch_engine", ...EMPTY };');
  });
  it("the engine is server-only, uses the shared prompt / parse / attach path, and the migration + rollback + check exist", () => {
    const b = read("src/lib/ai/gemini-batch-server.ts");
    expect(b).toContain('import "server-only"');
    expect(b).toContain("buildProductLookupPrompt(");
    expect(b).toContain("finishProductLookup(");
    expect(b).toContain("completeItem(");
    expect(b).not.toMatch(/\.limit\((?:[1-9]\d{3,})\)/);
    expect(read("supabase/migrations/0295_ai_batches.sql")).toContain("create table if not exists public.ai_batches");
    expect(read("supabase/rollbacks/0295_ai_batches.rollback.sql")).toContain("drop table if exists public.ai_batches;");
    expect(read("scripts/recon/ai-batches-0295-pg-check.sql")).toContain("R74 0295 CHECK PASSED");
  });
});
