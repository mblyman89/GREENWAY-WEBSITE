/**
 * tests/compliance/d185-role-checklists.test.ts   (D185, round slice S8)
 *
 * Owner (2026-11-05): "Cash handling, sop, opening and closing tills, daily
 * employee tasks and obligations ... This is the step you are on ... Validate
 * us when we are done ... make it loud."
 *
 * Pins: the pure self-test passes; My Day is read-only; Michael's seal/bank
 * steps never hold up staff; urgent steps (drop due, missing bag, late
 * morning cash) are loud and come first; nothing unread is ever "done"; the
 * page guard matches the nav entry; the admin home shows the compact panel.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runRoleChecklistTests, buildMyDay, MY_DAY_PAGE, shiftForHour, type MyDayFacts } from "@/lib/registers/role-checklist-core";
import { adminNav } from "@/components/admin/admin-nav-data";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const ok = { ok: true as const, total: 1, ticked: 1, signedOff: true };
const facts = (over: Partial<MyDayFacts> = {}): MyDayFacts => ({
  today: "2026-11-05",
  yesterday: "2026-11-04",
  hour: 9,
  yesterdayDuties: { ok: true, duties: { day: "2026-11-04", steps: [], next: null, crewOpen: 0, quietDay: true } },
  todayDuties: { ok: true, duties: { day: "2026-11-05", steps: [], next: null, crewOpen: 0, quietDay: true } },
  drops: { ok: true, drops: [] },
  missingBagDays: { ok: true, days: [] },
  sheets: { opening: ok, during: ok, closing: ok },
  ...over,
});

describe("D185 S8: My Day role checklists", () => {
  it("the pure self-test passes", () => {
    const r = __runRoleChecklistTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });

  it("shifts follow the clock", () => {
    expect(shiftForHour(8)).toBe("opening");
    expect(shiftForHour(14)).toBe("during");
    expect(shiftForHour(21)).toBe("closing");
  });

  it("validates a finished day and names the float rule", () => {
    const d = buildMyDay(facts());
    expect(d.shiftDone).toBe(true);
    expect(d.headline).toMatch(/You're done/);
    expect(JSON.stringify(d)).toContain("$167.50");
    expect(JSON.stringify(d)).toContain("$300.00");
  });

  it("a due drop is loud and first", () => {
    const d = buildMyDay(facts({ hour: 15, drops: { ok: true, drops: [{ registerName: "R1", state: "due", sentence: "DROP NOW: R1" }] } }));
    expect(d.loud.length).toBe(1);
    expect(d.next?.text).toBe("DROP NOW: R1");
    expect(d.shiftDone).toBe(false);
  });

  it("a read failure is never done (rule 135)", () => {
    const d = buildMyDay(facts({ drops: { ok: false, error: "down" }, hour: 15 }));
    expect(d.shiftDone).toBe(false);
    expect(d.blocks.find((b) => b.shift === "during")?.steps[0].state).toBe("unknown");
  });

  it("the store and panel are read-only", () => {
    for (const f of ["src/lib/registers/role-checklist-store.ts", "src/lib/registers/role-checklist-core.ts", "src/components/admin/registers/MyDayPanel.tsx", "src/app/admin/registers/my-day/page.tsx"]) {
      const src = read(f);
      expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
      expect(src).not.toMatch(/"use server"/);
    }
    expect(read("src/lib/registers/role-checklist-store.ts")).toContain('import "server-only"');
  });

  it("the page guard matches the nav entry", () => {
    const page = read("src/app/admin/registers/my-day/page.tsx");
    expect(page).toContain('requirePermission("orders.manage")');
    const item = adminNav.find((i) => i.href === MY_DAY_PAGE);
    expect(item?.permission).toBe("orders.manage");
    expect(item?.group).toBe("Employee");
  });

  it("the admin home shows the compact panel to staff", () => {
    const home = read("src/app/admin/page.tsx");
    expect(home).toMatch(/canSeeCash \? <MyDayHomePanel/);
  });

  it("is registered in the pure self-test harness", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toMatch(/assertRan\("role-checklist-core", __runRoleChecklistTests\(\), 60\)/);
  });

  it("adds no cron", () => {
    const v = JSON.parse(read("vercel.json")) as { crons?: unknown[] };
    expect(v.crons?.length ?? 0).toBe(22); // D221 M4 later added /api/cron/media-describe; D206 later added /api/cron/coa-trust-all; D193 later added /api/cron/db-vitals; D185 itself added none
  });
});
