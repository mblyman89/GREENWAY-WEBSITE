/** R74 S49: Unstick & re-ask (stuck / in-progress / failed lookups). */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runBatchUnstickTests } from "../../src/lib/ai/batch-unstick-core";

describe("R74 S49 unstick", () => {
  it("pure core", () => expect(__runBatchUnstickTests()).toEqual({ passed: 9, failed: 0 }));
  it("wired: action audited, buttons on the vendor table", () => {
    const A = readFileSync("src/app/admin/inventory/batch-lookups/actions.ts", "utf8");
    const T = readFileSync("src/app/admin/inventory/batch-lookups/VendorProgressTable.tsx", "utf8");
    expect(A).toContain("export async function unstickAndRequeueAction");
    expect(A).toContain('action: "ai_batch.unstick_requeue"');
    expect(T).toContain("<form action={unstickAndRequeueAction}");
    expect(A).not.toMatch(/\.limit\(\d{4,}\)/);
  });
});
