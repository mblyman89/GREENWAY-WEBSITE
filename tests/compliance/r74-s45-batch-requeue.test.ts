import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runBatchRequeueTests, keepQueuing, pickRequeue } from "@/lib/ai/batch-requeue-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R74 S45 - batch lookups keep finding the products Google has not answered", () => {
  it("pure self-tests pass", () => {
    const r = __runBatchRequeueTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(12);
  });
  it("a wave keeps going past manifests with nothing left", () => {
    expect(keepQueuing({ queuedProducts: 0, target: 200, tried: 47 })).toBe(true);
    expect(pickRequeue([{ id: "x", draft_id: "busy" }], new Set(["busy"])).keep).toEqual([]);
  });
  it("the plan reads answered products across ALL jobs and re-runs skip answered ones", () => {
    const s = read("src/lib/ai/batch-console-server.ts");
    expect(s).toMatch(/new Set<string>\(handledAll\.map/);
    expect(s).toMatch(/pickRequeue\(rows, busy\)/);
    const a = read("src/app/admin/inventory/batch-lookups/actions.ts");
    expect(a).toMatch(/queueWave\(c\.plan, want, who\)/);
    expect(a).toMatch(/queueWave\(pool, n, who\)/);
  });
});
