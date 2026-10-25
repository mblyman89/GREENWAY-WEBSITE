/**
 * R74 S41 - Batch Mission Control: the explain core self-tests, the
 * registration, and the wiring that stops the 11-for-4 pile-up and the
 * cancel-then-resend loop.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runGeminiBatchExplainTests, explainGemini, sendDecision } from "@/lib/ai/gemini-batch-explain-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R74 S41 batch mission control", () => {
  it("explain core self-tests pass and are registered", () => {
    const r = __runGeminiBatchExplainTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(14);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/__runGeminiBatchExplainTests\(\); if \(r\.failed > 0 \|\| r\.passed < 14\)/);
  });

  it("manual mode with no budget never sends; a 429 says wait", () => {
    expect(sendDecision({ paused: false, mode: "manual", budget: 0, open: 0, cap: 4, backoffUntil: null, now: 0, queued: 5 }).send).toBe(false);
    expect(explainGemini(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }).severity).not.toBe("ok");
  });

  it("the tick holds one sender lease, sends at most one batch, and cancels set products aside", () => {
    const s = read("src/lib/ai/gemini-batch-server.ts");
    expect(s).toMatch(/rpc\("ai_batch_send_lease"/);
    expect(s).toMatch(/rpc\("ai_batch_send_release"/);
    expect(s).toMatch(/BATCH_STOPPED_NOTE/);
    expect(s).toMatch(/in\("state", \[\.\.\.OPEN_BATCH_STATES\]\)/);
  });
});
