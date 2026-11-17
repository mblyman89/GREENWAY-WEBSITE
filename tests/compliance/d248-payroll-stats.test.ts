/**
 * D248 slice 5 - payroll stats and charts (read-only, calculate only).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { __runPayrollStatsCoreTests, computeStats, estWages, weekRange } from "@/lib/payroll/payroll-stats-core";

const REPO = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");

describe("D248 slice 5 - payroll-stats-core", () => {
  it("passes its embedded self-tests", () => {
    const r = __runPayrollStatsCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(43);
  });

  it("week range is clamped and oldest-first", () => {
    const r = weekRange("2026-11-18", 0, 999);
    expect(r).toHaveLength(52);
    expect(r[0].startDate < r[51].startDate).toBe(true);
    expect(weekRange("2026-11-18", 0, 0)).toHaveLength(1);
  });

  it("overtime is paid at half-time extra on top of straight time", () => {
    // 41h worked, 1h OT, $20.00/h -> 41*20 + 1*10 = $830.00
    expect(estWages(41 * 60, 60, 2_000_000)).toBe(83_000);
  });

  it("open and over-24h punches are excluded and counted, never guessed", () => {
    const s = computeStats({
      today: "2026-11-18",
      weeks: 1,
      workweekStartsOn: 0,
      employees: [{ id: "e1", name: "Pat", rateMilliCents: 2_000_000 }],
      punches: [
        { employeeId: "e1", kind: "work", day: "2026-11-16", clockInIso: "2026-11-16T17:00:00Z", clockOutIso: null },
        { employeeId: "e1", kind: "work", day: "2026-11-16", clockInIso: "2026-11-16T17:00:00Z", clockOutIso: "2026-11-18T17:00:00Z" },
      ],
      breakFlags: [],
      sickLedger: [],
    });
    expect(s.totals.excludedOpen).toBe(1);
    expect(s.totals.excludedImplausible).toBe(1);
    expect(s.totals.workMinutes).toBe(0);
  });

  it("without a workweek, overtime is not split (null), not guessed", () => {
    const s = computeStats({ today: "2026-11-18", weeks: 1, workweekStartsOn: null, employees: [], punches: [], breakFlags: [], sickLedger: [] });
    expect(s.otSplit).toBe(false);
    expect(s.weeks[0].overtimeMinutes).toBeNull();
  });
});

describe("D248 slice 5 - wiring and safety", () => {
  const page = read("src/app/admin/payroll-center/stats/page.tsx");
  const store = read("src/lib/payroll/payroll-stats-store.ts");

  it("page is owner/admin, calculate-only, and on the nav", () => {
    expect(page).toContain('requirePermission("settings.manage")');
    expect(page).toContain("CalculateOnlyBanner");
    expect(page).toContain('current="stats"');
    expect(read("src/components/admin/payroll-center/PayrollCenterNav.tsx")).toContain('href: "/admin/payroll-center/stats"');
    expect(read("src/app/admin/payroll-center/page.tsx")).toContain('href: "/admin/payroll-center/stats"');
  });

  it("the stats store only reads - never writes, books or pays", () => {
    expect(store).toContain('import "server-only"');
    expect(store).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(store).not.toMatch(/\.rpc\(/);
  });

  it("self-test suite is registered in the pure self-test runner", () => {
    const r = read("scripts/compliance/run-pure-selftests.ts");
    expect(r).toContain('assertRan("payroll-stats-core", __runPayrollStatsCoreTests(), 43)');
  });
});
