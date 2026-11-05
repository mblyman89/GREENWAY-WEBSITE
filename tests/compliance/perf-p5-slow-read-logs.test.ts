/**
 * PERF P5 (owner 2026-11-05, D186-D190; AGENTS.md rule 18 "when you are unsure, measure"):
 * a cockpit read that misses its cache is timed, and one "[slow-read]" line is logged when it
 * passes its budget, so a slow section names itself in the Vercel logs. Never changes a result.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { __runSlowReadTests, judgeRead, SLOW_READ_TAG } from "@/lib/platform/slow-read-core";

describe("PERF P5: slow reads name themselves", () => {
  it("pure core passes and is registered", () => {
    const r = __runSlowReadTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(13);
    expect(readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8")).toContain('assertRan("slow-read-core", __runSlowReadTests(), 13)');
  });

  it("formats one greppable line only past budget", () => {
    expect(judgeRead("x", 10, true)).toEqual({ slow: false });
    const v = judgeRead("cockpit:low-stock", 2000, false);
    expect(v.slow && v.line.startsWith(SLOW_READ_TAG)).toBe(true);
  });

  it("every cockpit cached read is timed on a miss, inside the cache, and failures re-throw", () => {
    const s = readFileSync("src/lib/admin/cockpit-cache-server.ts", "utf8");
    expect(s).toContain("gate(await timedRead(`cockpit:${name}`, () => read(...args)))");
    expect(s).toMatch(/finally \{\s*const v = judgeRead\(label, Date\.now\(\) - t0, ok\);\s*if \(v\.slow\) console\.warn\(v\.line\);/);
  });
});
