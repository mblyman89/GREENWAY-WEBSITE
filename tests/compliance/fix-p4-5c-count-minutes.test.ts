/**
 * Fix Phase 4.5c — counts sized in MINUTES of counting time, not only lots
 * (G-40 vendor rotation, G-41 year-end full count; owner D58: "a vendor per
 * day, broken into chunks if a large vendor", a chunk being what "one employee
 * can finish in a session").
 *
 * The rate is never invented: measured from finished counts (claimed_at →
 * submitted_at, migration 0326) once there are three, else the owner's
 * setting, else a starting value the screen labels "a starting guess".
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runCountTimeTests, lotsForMinutes, resolvePace } from "@/lib/inventory/count-time-core";

const read = (f: string) => readFileSync(f, "utf8");

describe("count-time-core", () => {
  it("self-test passes", () => {
    const r = __runCountTimeTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(18);
  });
  it("45 minutes at a measured 1.5 min/lot is a 30-lot vendor chunk", () => {
    const at = (m: number) => ({ claimedAt: "2026-10-01T16:00:00Z", submittedAt: new Date(Date.parse("2026-10-01T16:00:00Z") + m * 60000).toISOString(), lots: 20 });
    const pace = resolvePace([at(30), at(30), at(30)], null);
    expect(pace.source).toBe("measured");
    expect(lotsForMinutes(45, pace, 5, 200)).toBe(30);
  });
});

describe("the screens and the action", () => {
  it("vendor rotation accepts minutes and shows the pace", () => {
    const ui = read("src/app/admin/inventory/audits/new/CountGenerators.tsx");
    expect(ui).toContain('name="chunkMinutes"');
    expect(ui).toContain('name="minutesPerLot"');
    expect(ui).toContain("paceSentence(pace)");
    const act = read("src/app/admin/inventory/audits/actions.ts");
    expect(act).toContain("lotsForMinutes(fromMinutes, pace, MIN_CHUNK_LOTS, MAX_CHUNK_LOTS)");
    expect(act).toContain('action: "inventory_audit.count_pace"');
  });
  it("full-count planner accepts minutes per section and shows time per section", () => {
    const fc = read("src/app/admin/inventory/audits/full-count/page.tsx");
    expect(fc).toContain('name="minutes"');
    expect(fc).toContain("lotsForMinutes(minutesCheck.value, pace, MIN_SECTION_LOTS, MAX_SECTION_LOTS)");
    expect(fc).toContain("Counting time");
  });
});
