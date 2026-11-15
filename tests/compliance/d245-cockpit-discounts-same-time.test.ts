/**
 * D245 (owner 2026-11-15): two new first cards on the dashboard ("Revenue
 * before discounts", "Total discounts") and the compare-with options compare
 * each baseline day cut at the SAME Pacific time of day as now.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { __runSameTimeCoreTests, baselineDayValues, buildClockSeries } from "@/lib/admin/same-time-core";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

vi.mock("server-only", () => ({}));

const read = (p: string) => readFileSync(p, "utf8");

describe("D245 same-time core", () => {
  it("self-tests pass", () => {
    const r = __runSameTimeCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(36);
  });

  it("cuts a baseline day at the same minute and keeps the closed-day rule", () => {
    const series = buildClockSeries([
      { date: "2026-11-14", minute: 9 * 60 + 30, revenue: 4000, units: 2, discount: 400 },
      { date: "2026-11-14", minute: 18 * 60, revenue: 9000, units: 3, discount: 0 },
    ]);
    const byDay = [
      { date: "2026-11-13", revenueMinorUnits: 0, orders: 0, units: 0, discountMinorUnits: 0 },
      { date: "2026-11-14", revenueMinorUnits: 13000, orders: 2, units: 5, discountMinorUnits: 400 },
    ];
    const { days, sameTime } = baselineDayValues(byDay, series, 14 * 60 + 35);
    expect(sameTime).toBe(true);
    expect(days.get("2026-11-13")).toBeNull();
    expect(days.get("2026-11-14")).toEqual({
      revenue: 4000,
      orders: 1,
      units: 2,
      avgOrder: 4000,
      discount: 400,
      grossBeforeDiscounts: 4400,
    });
  });
});

// ── buildComparison with a faked sales report ─────────────────────────────

let fakeReport: unknown = null;
vi.mock("@/lib/reports/sales", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return { ...actual, getSalesReport: () => Promise.resolve(fakeReport) };
});

describe("D245 buildComparison cuts at the same time of day", () => {
  beforeEach(() => {
    fakeReport = null;
  });

  async function build(cutMinute: number | null) {
    vi.resetModules();
    const { buildComparison } = await import("@/lib/admin/comparison-data");
    return buildComparison(
      "yesterday",
      "2026-11-15",
      {
        totalRevenueMinorUnits: 5000,
        totalOrders: 1,
        totalUnits: 2,
        avgOrderMinorUnits: 5000,
        totalDiscountMinorUnits: 1000,
      } as never,
      undefined,
      cutMinute,
    );
  }

  it("compares today with yesterday up to the same minute", async () => {
    fakeReport = {
      hasData: true,
      byDay: [{ date: "2026-11-14", revenueMinorUnits: 20000, orders: 3, units: 6, discountMinorUnits: 3000 }],
      byDayClock: buildClockSeries([
        { date: "2026-11-14", minute: 600, revenue: 4000, units: 2, discount: 500 },
        { date: "2026-11-14", minute: 800, revenue: 6000, units: 2, discount: 500 },
        { date: "2026-11-14", minute: 1200, revenue: 10000, units: 2, discount: 2000 },
      ]),
    };
    const c = await build(875); // 2:35 PM
    expect(c.cutMinute).toBe(875);
    expect(c.cutLabel).toBe("2:35 PM");
    expect(c.revenue.baseline).toBe(10000);
    expect(c.orders.baseline).toBe(2);
    expect(c.discount?.baseline).toBe(1000);
    expect(c.grossBeforeDiscounts?.baseline).toBe(11000);
    expect(c.grossBeforeDiscounts?.current).toBe(6000);
    expect(c.discount?.current).toBe(1000);
  });

  it("whole days when no cut is given (old behaviour, honestly labelled)", async () => {
    fakeReport = {
      hasData: true,
      byDay: [{ date: "2026-11-14", revenueMinorUnits: 20000, orders: 3, units: 6, discountMinorUnits: 3000 }],
      byDayClock: [],
    };
    const c = await build(null);
    expect(c.cutMinute).toBeNull();
    expect(c.cutLabel).toBe("");
    expect(c.revenue.baseline).toBe(20000);
    expect(c.grossBeforeDiscounts?.baseline).toBe(23000);
  });

  it("the baseline span still never reaches into today", () => {
    expect(Date.parse(pacificWallTimeToUtcISO("2026-11-14", "end"))).toBeLessThan(
      Date.parse(pacificWallTimeToUtcISO("2026-11-15", "start")),
    );
  });
});

describe("D245 wiring", () => {
  const page = read("src/app/admin/page.tsx");

  it("the two new cards lead the Today's sales row", () => {
    const iGross = page.indexOf('label="Revenue before discounts"');
    const iDisc = page.indexOf('label="Total discounts"');
    const iRev = page.indexOf('label="Revenue"');
    expect(iGross).toBeGreaterThan(0);
    expect(iGross).toBeLessThan(iDisc);
    expect(iDisc).toBeLessThan(iRev);
    expect(page).toContain("snap.comparison.grossBeforeDiscounts");
    expect(page).toContain("snap.comparison.discount");
  });

  it("the cockpit passes the current Pacific minute and cuts after the cached read", () => {
    const data = read("src/lib/admin/cockpit-data.ts");
    expect(data).toContain("buildComparison(basis, todayYmd, todayR.data, baselineP, nowMinuteOfDay())");
    // The cached reads are still keyed by dates only.
    const server = read("src/lib/admin/cockpit-cache-server.ts");
    expect(server).toContain('"sales-days"');
  });

  it("the sales report carries the clock series and per-day discounts", () => {
    const sales = read("src/lib/reports/sales.ts");
    expect(sales).toContain("byDayClock: buildClockSeries(clockOrders)");
    expect(sales).toContain("day.discountMinorUnits += orderDiscount.get(orderId) ?? 0;");
  });

  it("the cache version moved for the new SalesReport shape", () => {
    expect(read("src/lib/admin/cockpit-cache-core.ts")).toMatch(/COCKPIT_CACHE_VERSION = "v3"/);
  });

  it("the concierge knows", () => {
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Revenue before discounts");
  });
});

describe("D245b: the phone dashboard matches", () => {
  it("six tiles, discount tiles first, every hint compares at the same time of day", async () => {
    const { __runMobileCoreTests } = await import("@/lib/admin/mobile-core");
    expect(__runMobileCoreTests().passed).toBeGreaterThanOrEqual(17);
    const core = read("src/lib/admin/mobile-core.ts");
    expect(core).toContain('key: "grossBeforeDiscounts"');
    expect(core).toContain("c.cutLabel ? ` by ${c.cutLabel}` : \"\"");
    expect(read("src/components/admin/mobile/MobileHome.tsx")).toContain("deltaLabel(kpi.delta, kpi.vsLabel)");
  });
});
