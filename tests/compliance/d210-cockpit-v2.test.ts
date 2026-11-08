/**
 * D210 (owner 2026-11-07, docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 *   "add more details to the bar chart, have it show more based on the selection of the top
 *    comparisons. I want to add pie and donut graphs. A line chart to compliment the bar chart.
 *    ... overlaying labor hours or transactions over the hourly sales ... who on shift currently
 *    is selling more ... Better visualization of categories and types ... how much the atm goes
 *    through on average, a forecaster for when it will be empty."
 *
 * Pins: the pure cores pass and are registered; the hourly chart follows the basis; same-day
 * per-person dollars never reach the on-shift board (B34); staffing and ATM panels are gated
 * and their reads are never fetched for anyone else; every new section streams in its own
 * Suspense; the new reads select explicit columns, read their errors and page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  __runCockpitAnalyticsTests,
  hourlyVsBaseline,
  onShiftBoard,
  dailyTrend,
} from "@/lib/admin/cockpit-analytics-core";
import { __runAtmForecastTests, dispenseStats, forecastDepletion, dispenseDays } from "@/lib/atm/atm-forecast-core";

const read = (p: string) => readFileSync(p, "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("D210 cockpit v2: pure cores", () => {
  it("cockpit-analytics-core passes and is registered", () => {
    const r = __runCockpitAnalyticsTests();
    expect(r.messages).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(79);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("cockpit-analytics-core", __runCockpitAnalyticsTests(), 79)');
  });

  it("atm-forecast-core passes and is registered", () => {
    const r = __runAtmForecastTests();
    expect(r.messages).toEqual([]);
    expect(r.passed).toBeGreaterThanOrEqual(34);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("atm-forecast-core", __runAtmForecastTests(), 34)');
  });

  it("the hourly baseline is the basis: average skips a closed day, max takes the best whole day", () => {
    const byDay = [
      { date: "2026-10-30", revenueMinorUnits: 10_000, orders: 5, units: 5 },
      { date: "2026-10-23", revenueMinorUnits: 0, orders: 0, units: 0 },
      { date: "2026-10-16", revenueMinorUnits: 30_000, orders: 9, units: 9 },
    ];
    const byDayHour = [
      { date: "2026-10-30", hour: 12, revenueMinorUnits: 10_000, orders: 5 },
      { date: "2026-10-16", hour: 12, revenueMinorUnits: 30_000, orders: 9 },
    ];
    const base = {
      todayByHour: [],
      baselineByDay: byDay,
      baselineByDayHour: byDayHour,
      windowDays: ["2026-10-30", "2026-10-23", "2026-10-16"],
      nowHour: 10,
      nowMinute: 0,
    };
    const avg = hourlyVsBaseline({ ...base, mode: "average" });
    expect(avg.rows.find((r) => r.hour === 12)!.baselineMinor).toBe(20_000);
    expect(avg.baseline.partial).toBe(true);
    const max = hourlyVsBaseline({ ...base, mode: "max" });
    expect(max.rows.find((r) => r.hour === 12)!.baselineMinor).toBe(30_000);
    expect(max.baseline.bestDay).toBe("2026-10-16");
  });

  it("the on-shift board carries no same-day dollars (B34)", () => {
    const b = onShiftBoard({
      onClock: [{ employeeId: "e1", name: "Ann", role: "sales", clockInIso: "2026-11-07T17:00:00Z" }],
      today: [{ employeeId: "e1", saleCount: 4, itemCount: 9, grossMinor: 12_345 }],
      week: [{ employeeId: "e1", saleCount: 30, itemCount: 70, grossMinor: 99_000 }],
      nowIso: "2026-11-07T19:00:00Z",
    });
    const row = b.rows[0] as Record<string, unknown>;
    expect(Object.values(row)).not.toContain(12_345);
    expect(row.weekGrossMinor).toBe(99_000);
    expect(row.salesPerHour).toBe(2);
  });

  it("a closed day in the trend is a gap, not $0", () => {
    const t = dailyTrend(
      [
        { date: "2026-11-05", revenueMinorUnits: 0, orders: 0, units: 0 },
        { date: "2026-11-06", revenueMinorUnits: 5_000, orders: 2, units: 3 },
      ],
      null,
      "2026-11-07",
    );
    expect(t.rows[0].revenueMinor).toBeNull();
    expect(t.rows[1].revenueMinor).toBe(5_000);
  });

  it("the ATM forecast needs a reading and a pace, and says which balance it used", () => {
    const days = dispenseDays(
      Array.from({ length: 20 }, (_, i) => ({
        settlementDate: `2026-10-${String(10 + i).padStart(2, "0")}`,
        terminalId: "T1",
        withdrawalTrx: 5,
        surchargeCents: 1250,
        settlementTotalCents: 100_000,
      })),
      "T1",
    );
    const stats = dispenseStats(days, "2026-11-01");
    expect(stats.avgDailyCents).toBe(100_000);
    const f = forecastDepletion({ balanceCents: 350_000, source: "estimate", startDate: "2026-11-01", todayYmd: "2026-11-01", stats });
    expect(f.hasForecast).toBe(true);
    expect(f.source).toBe("estimate");
    expect(f.likelyEmptyDate).toBe("2026-11-04");
    expect(forecastDepletion({ balanceCents: null, source: "unknown", startDate: "2026-11-01", todayYmd: "2026-11-01", stats }).hasForecast).toBe(false);
  });
});

describe("D210 cockpit v2: wiring", () => {
  const page = () => strip(read("src/app/admin/page.tsx"));
  const server = () => read("src/lib/admin/cockpit-analytics-server.ts");

  it("every new section streams inside its own Suspense", () => {
    const src = page();
    for (const c of ["CockpitTrafficSection", "CockpitMixSection"]) {
      expect(src).toMatch(new RegExp(`<Suspense fallback=\\{[^\\n]*\\}>\\s*<${c}\\b`));
    }
    expect(src).toMatch(/<Suspense fallback=\{[^\n]*\}>\s*\{canSeeStaffing \? <CockpitOnShiftSection \/>/);
    expect(src).toMatch(/<Suspense fallback=\{[^\n]*\}>\s*\{canSeeStaffing \? <CockpitTrendSection /);
    expect(src).toMatch(/<Suspense fallback=\{[^\n]*\}>\s*\{canSeeAtm \? <CockpitAtmSection \/>/);
  });

  it("the gates: staffing.manage or reports.view for people figures, finances.view for the ATM", () => {
    const src = page();
    expect(src).toContain('const canSeeStaffing = can(session.profile.role, "staffing.manage") || can(session.profile.role, "reports.view");');
    expect(src).toContain('const canSeeAtm = can(session.profile.role, "finances.view");');
    // Labor is not even read for a viewer without the gate.
    expect(src).toContain("showLabor ? cockpitLabor() : Promise.resolve(null)");
    expect(src).toContain("<CockpitTrafficSection basis={basis} showLabor={canSeeStaffing} />");
  });

  it("the hourly chart and the mix follow the comparison picker", () => {
    const src = page();
    expect(src).toContain("baselineByDayHour: snap.baseline.byDayHour,");
    expect(src).toContain("baselineByDayCategoryType: snap.baseline.byDayCategoryType,");
    expect(src).toContain("windowDays: snap.comparison.window.days,");
    expect(src).toContain("mode: snap.comparison.window.mode,");
    expect(read("src/lib/admin/cockpit-data.ts")).toContain("baseline: await baselineP,");
  });

  it("the new reads are server-only, explicit, error-reading and paged (rule 15)", () => {
    const s = server();
    expect(s).toContain('import "server-only";');
    expect(s).toContain('.select("id, employee_id, punch_kind, clock_in_at, clock_out_at")');
    expect(s).toContain('.select("id, employee_id, event_type, status, payload, occurred_at")');
    expect(s).toContain('.select("id, full_name, job_role")');
    expect(s).not.toMatch(/\.select\(\s*["']\*["']/);
    expect((s.match(/if \(error\) throw new Error/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((s.match(/\.order\("id", \{ ascending: true \}\)/g) ?? []).length).toBe(2);
    expect((s.match(/pagedAll</g) ?? []).length).toBe(2);
    for (const n of ["cockpitLabor", "cockpitOnShift", "cockpitTrend", "cockpitAtm"]) {
      expect(s).toMatch(new RegExp(`export const ${n} = cache\\(`));
    }
  });

  it("the display cache stays display-only and its keys carry no instants", () => {
    const s = server();
    expect(s).toContain('cockpitCached("labor-today", COCKPIT_TODAY_TTL_S, readLabor)');
    expect(s).toContain('cockpitCached("sellers-7d", COCKPIT_TODAY_TTL_S, readSellers)');
    expect(s).toContain("cachedLabor(todayYmd)");
    expect(s).toContain("cachedSellers(todayYmd)");
  });

  it("the cache version moved because the SalesReport shape changed", () => {
    expect(read("src/lib/admin/cockpit-cache-core.ts")).toMatch(/COCKPIT_CACHE_VERSION = "v2"/);
  });

  it("only the chart kit imports recharts", () => {
    for (const f of [
      "src/app/admin/page.tsx",
      "src/lib/admin/cockpit-analytics-core.ts",
      "src/lib/admin/cockpit-analytics-server.ts",
    ]) {
      expect(read(f)).not.toContain('from "recharts"');
    }
  });
});
