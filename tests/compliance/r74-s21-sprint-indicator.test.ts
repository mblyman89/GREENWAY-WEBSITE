/**
 * tests/compliance/r74-s21-sprint-indicator.test.ts   (R74 S21, owner round 10)
 *
 * "will you add a Gemini ai sprint status indicator on the onboard page
 *  letting me know I have it set correctly."
 *
 * Proves: the pure core resolves every variable the way the code that USES it
 * does (provider.ts, router.ts, lookup-job-core), the page shows the panel
 * once, the server wrapper reads only the listed names, and no key is shown.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const core = await import("@/lib/ai/sprint-status-core");
const server = await import("@/lib/ai/sprint-status");
const read = (p: string) => readFileSync(p, "utf8");

const OWNER = { AI_API_KEY: "AIzaOwnerKey", AI_MODE: "sprint", AI_MODEL_HEAVY: "gemini-3.8-flash", AI_THINKING_LEVEL: "low" };

describe("R74 S21 pure core", () => {
  it("self-tests pass at the pinned count and are registered with their floor", () => {
    expect(core.__runSprintStatusCoreTests()).toEqual({ passed: 42, failed: 0 });
    const src = read("scripts/compliance/run-pure-selftests.ts");
    expect(src).toContain("__runSprintStatusCoreTests()");
    expect(src).toMatch(/sprint-status-core: .*expected >= 42/);
  });

  it("the owner's Vercel setup (sprint, 3.8 Flash, a Google key, low) is green", () => {
    const s = server.loadSprintStatus(OWNER);
    expect(s.tone).toBe("good");
    expect(s.headline).toBe("Gemini sprint is set correctly: sprint mode on, gemini-3.8-flash with Google Search.");
    expect(s.checks.map((c) => c.id)).toEqual(["key", "mode", "model", "gemini_key", "row_thinking", "batch_thinking", "batch_lookup", "parallel"]);
  });

  it("every not-right setting names the exact variable to change", () => {
    const cases: [Record<string, string | undefined>, string, RegExp][] = [
      [{ ...OWNER, AI_MODE: undefined }, "mode", /AI_MODE=sprint/],
      [{ ...OWNER, AI_MODE: "sprint " }, "mode", /exactly sprint/],
      [{ ...OWNER, AI_MODEL_HEAVY: undefined }, "model", /AI_MODEL_HEAVY/],
      [{ ...OWNER, AI_MODEL_HEAVY: "gemini-3.7-flash" }, "model", /AI_MODEL_HEAVY=gemini-3\.8-flash/],
      [{ ...OWNER, AI_API_KEY: undefined }, "key", /AI_API_KEY/],
      [{ ...OWNER, AI_API_KEY: "sk-openai" }, "gemini_key", /AI_GEMINI_API_KEY/],
      [{ ...OWNER, AI_THINKING_LEVEL: "sprint" }, "row_thinking", /AI_THINKING_LEVEL to low, medium or high/],
      [{ ...OWNER, AI_BATCH_THINKING_LEVEL: "max" }, "batch_thinking", /AI_BATCH_THINKING_LEVEL/],
      [{ ...OWNER, MANIFEST_BATCH_LOOKUP: "off" }, "batch_lookup", /MANIFEST_BATCH_LOOKUP/],
    ];
    for (const [env, id, fix] of cases) {
      const s = server.loadSprintStatus(env);
      const c = s.checks.find((x) => x.id === id)!;
      expect(c.tone, id).not.toBe("good");
      expect(c.fix, id).toMatch(fix);
      expect(s.tone, id).not.toBe("good");
    }
  });

  it("matches how the app really reads each value (?? not ||, router.ts has no trim)", () => {
    expect(server.loadSprintStatus({ ...OWNER, AI_MODE: " sprint" }).sprint).toBe(false);
    expect(server.loadSprintStatus({ ...OWNER, AI_API_KEY: "", OPENAI_API_KEY: "AIzaX" }).tone).toBe("bad");
    expect(server.loadSprintStatus({ ...OWNER, AI_MODEL_HEAVY: undefined, OPENAI_MODEL_HEAVY: "gemini-2.5-pro" }).model).toBe("gemini-2.5-pro");
    // The same sources the panel claims to mirror.
    expect(read("src/lib/ai/router.ts")).toContain('(process.env.AI_MODE ?? "maintenance").toLowerCase() === "sprint"');
    const provider = read("src/lib/ai/provider.ts");
    expect(provider).toContain('process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? ""');
    expect(provider).toContain('process.env.AI_MODEL_HEAVY ?? process.env.OPENAI_MODEL_HEAVY ?? "gpt-4o"');
    expect(provider).toContain("process.env.AI_GEMINI_API_KEY ?? AI_API_KEY");
    expect(provider).toContain("/^gemini/i.test(AI_WEBSEARCH_MODEL)");
    expect(provider).toContain('AI_THINKING_LEVEL: process.env.AI_THINKING_LEVEL ?? "low"');
  });

  it("never shows a key", () => {
    const s = server.loadSprintStatus({ ...OWNER, AI_API_KEY: "AIzaTOPSECRET", AI_GEMINI_API_KEY: "AIzaGEMSECRET" });
    expect(JSON.stringify(s)).not.toMatch(/TOPSECRET|GEMSECRET/);
  });
});

describe("R74 S21 wiring", () => {
  it("the server wrapper is server-only and reads only the listed names", () => {
    const src = read("src/lib/ai/sprint-status.ts");
    expect(src).toContain('import "server-only"');
    expect(src).toContain("for (const name of SPRINT_ENV_NAMES)");
    expect(src).not.toMatch(/process\.env\.[A-Z]/);
    expect(src).not.toMatch(/createSupabase|fetch\(/);
    const coreSrc = read("src/lib/ai/sprint-status-core.ts");
    expect(coreSrc).not.toMatch(/process\.env|fetch\(|Date\.now/);
  });

  it("Product Onboarding shows the indicator once, near the top", () => {
    const page = read("src/app/admin/inventory/drafts/page.tsx");
    expect(page.match(/<GeminiSprintStatus status=\{loadSprintStatus\(\)\} \/>/g)?.length).toBe(1);
    expect(page.indexOf("<GeminiSprintStatus")).toBeGreaterThan(page.indexOf("<WhatDoIDoHere"));
    expect(page.indexOf("<GeminiSprintStatus")).toBeLessThan(page.indexOf('label="Needs review"'));
    const comp = read("src/components/admin/catalog/GeminiSprintStatus.tsx");
    expect(comp).not.toContain('"use client"');
    expect(comp).toContain('data-testid="gemini-sprint-status"');
    expect(comp).toContain("open={status.tone === \"bad\"}");
  });
});
