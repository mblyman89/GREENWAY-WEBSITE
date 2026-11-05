/**
 * PERF P4b (owner 2026-11-05, D186-D190): "please make it a permanent issue to address every time
 * we add to the repo". Pins AGENTS.md rule 18 (speed is a requirement) and the function region
 * next to the database (Vercel sfo1 <-> Supabase us-west-1, ~20 ms per round trip saved).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

describe("PERF P4b: speed is a standing rule", () => {
  it("AGENTS.md carries rule 18 and points at the guard tests that enforce it", () => {
    const a = readFileSync("AGENTS.md", "utf8");
    expect(a).toContain("18. **Speed is a requirement, not a polish step.");
    for (const t of [
      "tests/compliance/perf-guard-menu-items-scope.test.ts",
      "tests/compliance/perf-p3-cockpit-instant.test.ts",
    ]) {
      expect(a).toContain(t);
      expect(existsSync(t), t).toBe(true);
    }
    expect(a).toContain("CACHE THE DISPLAY. NEVER CACHE THE MONEY.");
  });

  it("functions run in sfo1, next to the database; crons and preview settings untouched", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8"));
    expect(v.regions).toEqual(["sfo1"]);
    expect(v.git.deploymentEnabled).toEqual({ main: true, "**": false });
    expect(Array.isArray(v.crons) && v.crons.length).toBeGreaterThan(0);
  });
});
