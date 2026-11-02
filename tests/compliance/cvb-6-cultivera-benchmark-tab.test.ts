/**
 * CVB-6: Reports -> Cultivera Benchmark (owner only). Michael, 2026-11-01: "I would like to have a new tab added
 * to reports called Cultivera Benchmark ... compare how well we're doing with our system vs Cultivera ... Total
 * build was 40k ... every time we outperform Cultivera it should go down ... This will be owner only access."
 *
 * Locks: the pure report core (Cultivera's formulas measured, never assumed; our pre-tax figures; unknown cost
 * is never a partial sum), the owner-only tab / page / actions, the server-side recompute of a credit, and the
 * no-double-credit rule.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PAYBACK_METRIC,
  __runCultiveraBenchmarkReportCoreTests,
  buildOurDays,
  creditOverlap,
  lineFigures,
  measureIdentities,
  ourLiveWindow,
  ourPeriodTotals,
  savingKey,
} from "@/lib/reports/cultivera-benchmark-report-core";
import {
  comparePeriods,
  outperformCredit,
  outperformKey,
  paybackSummary,
  sumPeriod,
  type BenchmarkDayRow,
} from "@/lib/reports/cultivera-benchmark-core";
import { CULTIVERA_BENCHMARK_TAB, REPORT_TABS, reportTabsFor, ACH_REPORT_TAB } from "@/components/admin/reports/ReportTabs";
import { can, rolesForPermission } from "@/lib/auth/roles";

const REPO = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(REPO, ...p), "utf8");

const rates = { combinedSalesRateBps: 930, exciseRateBps: 3700 };
const theirRow = (day: string, o: Partial<BenchmarkDayRow> = {}): BenchmarkDayRow => ({
  day,
  gross_sales_minor: 868414,
  discounts_minor: 257770,
  taxes_minor: 277990,
  returns_minor: 0,
  net_sales_minor: 610644,
  cost_minor: 368618,
  gross_profit_minor: 499796,
  net_profit_minor: 242026,
  cash_redemption_minor: 0,
  ...o,
});

describe("cultivera-benchmark-report-core", () => {
  it("passes its embedded self-tests", () => {
    expect(__runCultiveraBenchmarkReportCoreTests().passed).toBeGreaterThanOrEqual(43);
  });

  it("measures Cultivera's formulas on the real 2026-10-31 row (all three hold)", () => {
    const m = measureIdentities([theirRow("2026-10-31")]);
    expect(m).toMatchObject({ netIsGrossLessDiscounts: "holds", grossProfitIsGrossLessCost: "holds", netProfitIsNetLessCost: "holds", returnsRule: "no_returns" });
  });

  it("a line is valued pre-tax from the tax-inclusive stored price", () => {
    const f = lineFigures({ orderId: "o", quantity: 1, priceMinor: 1463, regularPriceMinor: 2926, isCannabis: true, salesExempt: false, exciseExempt: false }, rates);
    expect(f).toEqual({ gross: 2000, sold: 1000, discount: 1000, taxes: 93 + 370 });
  });

  it("one order without a cost entry makes the whole period's cost unknown (never a partial sum)", () => {
    const days = buildOurDays({
      liveDays: ["2026-11-01"],
      orders: [{ id: "a", day: "2026-11-01" }, { id: "b", day: "2026-11-01" }],
      lines: [],
      costByOrder: new Map([["a", 500]]),
      returnDays: [],
      rates,
    });
    const p = ourPeriodTotals(days, "2026-11-01", "2026-11-01", measureIdentities([theirRow("2025-11-01")]));
    expect(p.totals.cost).toBeNull();
    expect(p.totals.gross_profit).toBeNull();
    expect(p.notes.join(" ")).toContain("no single cost entry");
  });

  it("returns are never compared, and our side starts at the cut-over", () => {
    const p = ourPeriodTotals([], "2026-11-01", "2026-11-02", measureIdentities([]));
    expect(p.totals.returns).toBeNull();
    expect(ourLiveWindow("2026-10-01", "2026-11-30", "2026-11-01", "2026-11-10")).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(ourLiveWindow("2026-10-01", "2026-11-30", null, "2026-11-10")).toBeNull();
  });

  it("end to end: a closed, complete period where our gross profit is higher yields exactly that credit", () => {
    const ourDays = buildOurDays({
      liveDays: ["2026-11-01"],
      orders: [{ id: "a", day: "2026-11-01" }],
      lines: [{ orderId: "a", quantity: 1000, priceMinor: 1463, regularPriceMinor: null, isCannabis: true, salesExempt: false, exciseExempt: false }],
      costByOrder: new Map([["a", 300000]]),
      returnDays: [],
      rates,
    });
    const theirs = [theirRow("2025-11-01")];
    const ours = ourPeriodTotals(ourDays, "2026-11-01", "2026-11-01", measureIdentities(theirs));
    expect(ours.totals.gross_profit).toBe(1_000_000 - 300_000);
    const cmp = comparePeriods(ours, sumPeriod(theirs, "2025-11-01", "2025-11-01"));
    expect(cmp.complete).toBe(true);
    const c = outperformCredit(cmp, PAYBACK_METRIC, "2026-11-02");
    expect(typeof c).toBe("object");
    if (typeof c === "object") {
      expect(c.amountMinor).toBe(700_000 - 499_796);
      expect(c.entryKey).toBe(outperformKey("gross_profit", "2026-11-01", "2026-11-01"));
      expect(creditOverlap([{ entryKey: c.entryKey, kind: "outperform" }], "2026-10-25", "2026-11-07")).toContain("already credited");
    }
    // still open today -> no credit
    expect(typeof outperformCredit(cmp, PAYBACK_METRIC, "2026-11-01")).toBe("string");
  });

  it("the seeded ledger still reads $34,500.00 left", () => {
    const s = paybackSummary([
      { entryKey: "owner-build-cost", entryDate: "2026-11-01", kind: "build_cost", amountMinor: 4_000_000, note: "build" },
      { entryKey: "owner-saving-2026-11-01", entryDate: "2026-11-01", kind: "saving", amountMinor: 550_000, note: "saving" },
    ]);
    expect(s.remainingMinor).toBe(3_450_000);
    expect(savingKey({ entryDate: "2026-11-01", amountMinor: 550_000, note: "x" })).toMatch(/^saving:2026-11-01:550000:[0-9a-f]{8}$/);
  });
});

describe("owner only", () => {
  it("the tab is not in the shared list and shows only when the layout says so, before ACH", () => {
    expect(REPORT_TABS.some((t) => t.href === CULTIVERA_BENCHMARK_TAB.href)).toBe(false);
    expect(reportTabsFor(false).some((t) => t.href === CULTIVERA_BENCHMARK_TAB.href)).toBe(false);
    expect(reportTabsFor(false, true).at(-1)).toEqual(CULTIVERA_BENCHMARK_TAB);
    const both = reportTabsFor(true, true);
    expect(both.at(-1)).toEqual(ACH_REPORT_TAB);
    expect(both.at(-2)).toEqual(CULTIVERA_BENCHMARK_TAB);
    expect(CULTIVERA_BENCHMARK_TAB.label).toBe("Cultivera Benchmark");
    const layout = read("src", "app", "admin", "reports", "layout.tsx");
    expect(layout).toContain('const showCultiveraTab = can(session.profile.role, "cultivera.benchmark");');
    expect(rolesForPermission("cultivera.benchmark")).toEqual(["owner"]);
    for (const r of ["admin", "manager", "readonly", "budtender"] as const) expect(can(r as never, "cultivera.benchmark")).toBe(false);
  });

  it("the page checks cultivera.benchmark itself before reading anything", () => {
    const page = read("src", "app", "admin", "reports", "cultivera-benchmark", "page.tsx");
    expect(page).toMatch(/await requirePermission\("cultivera\.benchmark"\);/);
    expect(page).not.toMatch(/requirePermission\("reports\.view"\)/);
    expect(page.indexOf('requirePermission("cultivera.benchmark")')).toBeLessThan(page.indexOf("buildBenchmark(from, to)"));
  });

  it("every action is gated first and audited", () => {
    const src = read("src", "app", "admin", "reports", "cultivera-benchmark", "actions.ts");
    const fns = src.split("export async function ").slice(1);
    expect(fns.length).toBe(2);
    for (const f of fns) {
      expect(f.indexOf('await requirePermission("cultivera.benchmark")')).toBeGreaterThan(-1);
      expect(f.indexOf('await requirePermission("cultivera.benchmark")')).toBeLessThan(f.indexOf("insertPaybackEntry"));
      expect(f).toContain("recordAudit(");
    }
  });

  it("a credit is recomputed on the server, checked for overlap, and never takes an amount from the form", () => {
    const src = read("src", "app", "admin", "reports", "cultivera-benchmark", "actions.ts");
    const credit = src.slice(src.indexOf("export async function creditOutperformAction"));
    expect(credit).toContain("await buildBenchmark(from, to)");
    expect(credit).toContain("outperformCredit(b.cmp, PAYBACK_METRIC, b.today)");
    expect(credit).toContain("creditOverlap(await paybackEntries()");
    expect(credit).not.toMatch(/formData\.get\("(amount|dollars|cents)"\)/);
  });
});

describe("our side reads", () => {
  const store = read("src", "lib", "reports", "cultivera-benchmark-report-store.ts");
  it("uses completed orders on the completed_at basis, paged, with every error checked", () => {
    expect(store).toContain('.eq("status", "completed")');
    expect(store).toContain("completed_at.is.null,placed_at.gte.");
    expect(store).not.toMatch(/\.limit\(\d{4,}\)/);
    const reads = store.match(/const \{ data, error \} = await admin/g) ?? [];
    const checks = store.match(/if \(error\) fail\(/g) ?? [];
    expect(reads.length).toBeGreaterThanOrEqual(7);
    expect(checks.length).toBe(reads.length);
  });
  it("takes cost only from each sale's own cost entry, and our side starts at the cut-over", () => {
    expect(store).toContain("`order:${id}#cogs`");
    expect(store).toContain('.from("gl_conversion_config").select("cutover_date")');
    expect(store).toContain("ourLiveWindow(from, to, cutover, today)");
  });
});
