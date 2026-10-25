/**
 * R74 S35 - Batch Lookups console: pinned self-test count + wiring.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { __runBatchConsoleCoreTests, planBatches } from "@/lib/ai/batch-console-core";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");

describe("R74 S35 batch-console-core", () => {
  it("self-tests run at the measured 27 and are registered", () => {
    const r = __runBatchConsoleCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(27);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/__runBatchConsoleCoreTests\(\); if \(r\.failed > 0 \|\| r\.passed < 27\)/);
  });
  it("batches never exceed 200 products", () => {
    const p = planBatches([{ manifestId: "a", vendor: "V", label: "a", lots: 900, families: 777 }]);
    expect(p.map((b) => b.families)).toEqual([200, 200, 200, 177]);
  });
  it("both cron ticks honor the pause switch; page is in the nav", () => {
    expect(read("src/lib/ai/gemini-batch-server.ts")).toMatch(/control\.paused\) return \{ \.\.\.out, skipped: "paused" \}/);
    expect(read("src/lib/catalog/lookup-job-server.ts")).toMatch(/control\?\.paused\) return \{ ok: true, skipped: "paused"/);
    expect(read("src/components/admin/admin-nav-data.ts")).toContain('href: "/admin/inventory/batch-lookups"');
  });
});
