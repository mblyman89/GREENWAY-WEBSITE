/**
 * G-71b (owner message 12): platform changes register + monthly review +
 * standing rules 15 and 16.
 *
 * Owner (verbatim): "Let's build 1-4 first. I see real value in all of them.
 * ... Update the standing rules so we don't rely on the database to do things
 * for us and we are more deliberate about how we communicate with the
 * database."
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PLATFORM_CHANGES,
  PLATFORM_SOURCES,
  REGISTER_REVIEWED_ON,
  __runPlatformChangesTests,
  deadlineStage,
  validateRegister,
} from "@/lib/platform/platform-changes";

const ROOT = path.resolve(__dirname, "../..");
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("G-71b platform changes register", () => {
  it("pure self-tests pass and are registered", () => {
    const r = __runPlatformChangesTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(30);
    expect(src("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("platform-changes", __runPlatformChangesTests\(\), 30\)/);
  });

  it("the register is well formed and grounded in vendor links", () => {
    expect(validateRegister(PLATFORM_CHANGES)).toEqual([]);
    expect(PLATFORM_CHANGES.length).toBeGreaterThanOrEqual(8);
    for (const v of ["supabase", "vercel", "nextjs", "github", "nodejs"] as const) {
      expect(PLATFORM_SOURCES.some((s) => s.vendor === v)).toBe(true);
    }
    expect(PLATFORM_CHANGES.find((e) => e.id === "supabase-no-auto-expose")?.status).toBe("done");
  });

  it("nothing open is already overdue on the review day (no stray overdue email)", () => {
    const overdue = PLATFORM_CHANGES.filter((e) => deadlineStage(e, REGISTER_REVIEWED_ON) === "overdue").map((e) => e.id);
    // supabase-js-node20 is open and past its date on purpose: CI still runs Node 20 (item 5).
    expect(overdue).toEqual(["supabase-js-node20"]);
  });

  it("docs/PLATFORM-CHANGES.md mirrors the register", () => {
    const md = src("docs/PLATFORM-CHANGES.md");
    expect(md).toContain(`**Last reviewed:** ${REGISTER_REVIEWED_ON}`);
    const mdIds = [...md.matchAll(/^### ([a-z0-9-]+)$/gm)].map((m) => m[1]).sort();
    expect(mdIds).toEqual(PLATFORM_CHANGES.map((e) => e.id).sort());
    for (const e of PLATFORM_CHANGES) {
      const block = md.slice(md.indexOf(`### ${e.id}\n`)).split("\n### ")[0];
      expect(block, e.id).toContain(`- **Status:** ${e.status}`);
      expect(block, e.id).toContain(`- **Deadline:** ${e.deadline ?? "none"}`);
      expect(block, e.id).toContain(e.source);
    }
    for (const s of PLATFORM_SOURCES) expect(md).toContain(s.url);
  });

  it("the daily cron sends the review and deadline warnings, claimed first", () => {
    const route = src("src/app/api/cron/platform-health/route.ts");
    expect(route).toContain("runPlatformReview");
    const store = src("src/lib/platform/platform-review-store.ts");
    expect(store).toContain('import "server-only"');
    expect(store).toContain("monthlyReviewKey(today)");
    expect(store).toContain("deadlineAlertKey(e.id, stage)");
    // claim before send
    expect(store.indexOf("await claim(")).toBeLessThan(store.indexOf("await sendStaffAlertEmail("));
    expect(store).toContain('"23505"');
    // still one cron
    const crons = JSON.parse(src("vercel.json")).crons as { path: string }[];
    expect(crons.filter((c) => c.path.startsWith("/api/cron/platform-")).length).toBe(1);
  });

  it("the Platform health page shows the register", () => {
    const page = src("src/app/admin/settings/platform-health/page.tsx");
    expect(page).toContain("PLATFORM_CHANGES");
    expect(page).toContain("REGISTER_REVIEWED_ON");
    expect(page).toContain("PLATFORM_SOURCES");
  });

  it("AGENTS.md carries standing rules 15 and 16 with the owner's words", () => {
    const a = src("AGENTS.md");
    expect(a).toMatch(/^15\. \*\*Be deliberate with the database/m);
    expect(a).toMatch(/^16\. \*\*Review the platforms every month/m);
    expect(a).toContain("Update the standing rules so we don't rely on the database to do things for us and we are more deliberate about how we communicate with the database.");
    expect(a).toContain("scripts/platform/build-db-contract.ts");
    expect(a).toContain("42501");
    expect(a).toContain("docs/PLATFORM-CHANGES.md");
    expect(a.indexOf("16. **Review the platforms")).toBeLessThan(a.indexOf("## 🔴 CCRS COMPLIANCE"));
  });
});
