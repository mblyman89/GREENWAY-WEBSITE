/**
 * SLICE 21 — comparison bases on the cockpit, and returns/voids in the back office.
 *
 * Owner, verbatim:
 *
 *   "nowhere in the back office can I find anything related to returns or
 *    voids ... It should be in reports and in the main cockpit."
 *   "I want to be able to switch between different comparison metrics ... an
 *    average for that particular day of the week going back in history ... Or
 *    maybe I want to see last weeks specific day of the week ... Test
 *    everything you can including the tests."
 *
 * These tests drive the REAL modules. The comparison engine is exercised
 * against a fake `getSalesReport` so the arithmetic can be checked against
 * known day values, and the returns store is exercised against a fake
 * PostgREST client whose write methods throw — reading refunds must never
 * mutate anything.
 *
 * The filesystem assertions matter as much as the unit ones: the owner asked
 * for this to be visible in specific PLACES, so the tests check that the
 * cockpit and the reports suite actually render it, and that the link the
 * cockpit emits resolves to a page that exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  pacificDayKey,
  pacificWallTimeToUtcISO,
} from "@/lib/reports/timezone";

import {
  COMPARISON_BASES,
  DEFAULT_BASIS,
  parseComparisonBasis,
  comparisonWindowFor,
  combineBaseline,
  baselineQualifier,
  allBaselineDays,
  shiftYmd,
  ymdWeekday,
  weekdayName,
  isYmd,
  type ComparisonBasis,
} from "@/lib/admin/comparison-basis-core";
import {
  computeNetSales,
  refundSeverity,
  toRefundFacts,
  breakdownBy,
  restockShare,
  totalReturnedUnits,
  formatRate,
  sumRefundFacts,
  EMPTY_REFUND_FACTS,
} from "@/lib/admin/refund-metrics-core";
import { summarizeRefunds, type RefundSummary } from "@/lib/pos/day-report-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// The comparison bases the owner asked for actually exist
// ─────────────────────────────────────────────────────────────────────────────

describe("SLICE 21 — the comparison metrics the owner named", () => {
  it("offers 'last week's specific day of the week'", () => {
    const w = comparisonWindowFor("same_day_last_week", "2026-09-06");
    expect(w.days).toEqual(["2026-08-30"]);
    expect(ymdWeekday(w.days[0])).toBe(ymdWeekday("2026-09-06"));
  });

  it("offers a day-of-week average going back through history", () => {
    const w = comparisonWindowFor("dow_average_12", "2026-09-06");
    expect(w.days).toHaveLength(12);
    expect(w.mode).toBe("average");
    for (const d of w.days) expect(weekdayName(d)).toBe("Sunday");
  });

  it("keeps yesterday as the default so nothing changed for anyone who liked it", () => {
    expect(DEFAULT_BASIS).toBe("yesterday");
    expect(parseComparisonBasis(undefined)).toBe("yesterday");
    expect(comparisonWindowFor("yesterday", "2026-09-06").days).toEqual(["2026-09-05"]);
  });

  it("adds genuinely different lenses, not near-duplicates", () => {
    const ids = COMPARISON_BASES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Each basis must produce a distinct day-set for the same 'today',
    // otherwise it is a duplicate wearing a different label.
    const seen = new Map<string, ComparisonBasis>();
    for (const b of COMPARISON_BASES) {
      const key = `${b.mode}:${comparisonWindowFor(b.id, "2026-09-06").days.join(",")}`;
      expect(seen.has(key), `${b.id} duplicates ${seen.get(key)}`).toBe(false);
      seen.set(key, b.id);
    }
  });

  it("never lets today contaminate its own baseline", () => {
    for (const today of ["2026-09-06", "2026-01-01", "2024-02-29", "2026-12-31"]) {
      for (const b of COMPARISON_BASES) {
        const w = comparisonWindowFor(b.id, today);
        expect(w.days).not.toContain(today);
        for (const d of w.days) expect(d < today).toBe(true);
      }
    }
  });

  it("uses 364 days for 'a year ago' so the weekday still matches", () => {
    for (const today of ["2026-09-06", "2026-03-15", "2025-07-04"]) {
      const w = comparisonWindowFor("same_day_last_year", today);
      expect(ymdWeekday(w.days[0])).toBe(ymdWeekday(today));
    }
  });

  it("survives leap years and month ends", () => {
    expect(shiftYmd("2024-03-01", -1)).toBe("2024-02-29");
    expect(shiftYmd("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftYmd("2027-01-01", -1)).toBe("2026-12-31");
    expect(isYmd("2026-02-30")).toBe(false);
  });

  it("falls back rather than throwing on a hand-edited URL", () => {
    for (const junk of ["", "  ", "nope", "dow_average", "../etc/passwd", "%%%", null, 42, {}]) {
      expect(parseComparisonBasis(junk)).toBe(DEFAULT_BASIS);
    }
  });

  it("fetches every basis's days within one bounded span", () => {
    const all = allBaselineDays("2026-09-06");
    expect(all).not.toContain("2026-09-06");
    // The widest basis is a year back, so the span is bounded but long; the
    // point is that it is FINITE and de-duplicated.
    expect(new Set(all).size).toBe(all.length);
    for (const b of COMPARISON_BASES) {
      for (const d of comparisonWindowFor(b.id, "2026-09-06").days) expect(all).toContain(d);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A closed day is not a zero day
// ─────────────────────────────────────────────────────────────────────────────

describe("SLICE 21 — a day the store was shut must not drag the baseline down", () => {
  it("drops no-data days instead of averaging them in as zero", () => {
    const r = combineBaseline([null, 100_000, null, 200_000], "average");
    expect(r.value).toBe(150_000);
    expect(r.daysWithData).toBe(2);
    expect(r.daysRequested).toBe(4);
    expect(r.partial).toBe(true);
  });

  it("still counts a genuine zero when the store WAS open", () => {
    const r = combineBaseline([0, 100_000], "average");
    expect(r.value).toBe(50_000);
    expect(r.daysWithData).toBe(2);
    expect(r.partial).toBe(false);
  });

  it("says out loud how thin a partial baseline is", () => {
    expect(baselineQualifier(combineBaseline([null, null, null, 5], "average"))).toBe(
      "1 of 4 days had data",
    );
    expect(baselineQualifier(combineBaseline([1, 2], "average"))).toBe("");
    expect(baselineQualifier(combineBaseline([null], "single"))).toBe("no baseline data");
  });

  it("returns null rather than 0 when nothing is comparable", () => {
    expect(combineBaseline([], "average").value).toBeNull();
    expect(combineBaseline([null, null], "average").value).toBeNull();
  });

  it("treats a zero-order day as absence of data in the real indexer", async () => {
    const { indexDays } = await import("@/lib/admin/comparison-data");
    const idx = indexDays({
      byDay: [
        { date: "2026-09-01", revenueMinorUnits: 0, orders: 0, units: 0 },
        { date: "2026-09-02", revenueMinorUnits: 0, orders: 3, units: 4 },
        { date: "2026-09-03", revenueMinorUnits: 30_000, orders: 3, units: 9 },
      ],
    } as never);
    // Zero orders => null (no evidence the store traded).
    expect(idx.get("2026-09-01")).toBeNull();
    // Open but zero revenue => real data, a genuine 0.
    expect(idx.get("2026-09-02")).toEqual({ revenue: 0, orders: 3, units: 4, avgOrder: 0 });
    // AOV is derived per day from that day's own revenue and orders.
    expect(idx.get("2026-09-03")).toEqual({
      revenue: 30_000,
      orders: 3,
      units: 9,
      avgOrder: 10_000,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The comparison engine end-to-end, against a fake sales report
// ─────────────────────────────────────────────────────────────────────────────

let dayRevenue: Record<string, { revenue: number; orders: number; units: number }> = {};
let salesCalls: { fromISO: string; toISO: string }[] = [];

vi.mock("@/lib/reports/sales", async (importActual) => {
  const actual = await importActual<Record<string, unknown>>();
  return {
    ...actual,
    getSalesReport: (fromISO: string, toISO: string) => {
      salesCalls.push({ fromISO, toISO });
      // Rebuild the same zero-seeded day series the real report produces
      // (sales.ts:151 emptyDaySeries) so the indexer is exercised honestly.
      const byDay: { date: string; revenueMinorUnits: number; orders: number; units: number }[] = [];
      let cur = fromISO.slice(0, 10);
      const last = toISO.slice(0, 10);
      let guard = 0;
      while (cur <= last && guard < 400) {
        const hit = dayRevenue[cur];
        byDay.push({
          date: cur,
          revenueMinorUnits: hit?.revenue ?? 0,
          orders: hit?.orders ?? 0,
          units: hit?.units ?? 0,
        });
        cur = shiftYmd(cur, 1);
        guard += 1;
      }
      return Promise.resolve({ hasData: true, byDay } as never);
    },
  };
});

describe("SLICE 21 — building a comparison from real day data", () => {
  beforeEach(() => {
    salesCalls = [];
    dayRevenue = {};
  });

  async function build(basis: ComparisonBasis, today: string, current: number) {
    vi.resetModules();
    const { buildComparison } = await import("@/lib/admin/comparison-data");
    return buildComparison(
      basis,
      today,
      {
        totalRevenueMinorUnits: current,
        totalOrders: 10,
        totalUnits: 20,
        avgOrderMinorUnits: Math.round(current / 10),
      } as never,
    );
  }

  it("averages the last four of this weekday", async () => {
    // Four Sundays before 2026-09-06.
    dayRevenue = {
      "2026-08-30": { revenue: 100_000, orders: 10, units: 10 },
      "2026-08-23": { revenue: 200_000, orders: 10, units: 10 },
      "2026-08-16": { revenue: 300_000, orders: 10, units: 10 },
      "2026-08-09": { revenue: 400_000, orders: 10, units: 10 },
    };
    const c = await build("dow_average_4", "2026-09-06", 500_000);
    expect(c.revenue.baseline).toBe(250_000);
    expect(c.revenue.delta.direction).toBe("up");
    expect(c.revenue.result.daysWithData).toBe(4);
    expect(c.revenue.qualifier).toBe("");
  });

  it("uses only ONE query span even for the 28-day basis", async () => {
    dayRevenue = { "2026-09-05": { revenue: 1, orders: 1, units: 1 } };
    await build("trailing_28_avg", "2026-09-06", 1);
    expect(salesCalls).toHaveLength(1);
    // Span covers oldest..newest baseline day and never reaches today.
    //
    // NOTE on the assertion style: the span endpoints are UTC instants, so a
    // raw `.slice(0, 10)` is the wrong lens. `pacificWallTimeToUtcISO(ymd,
    // "end")` builds 23:59:59.999 PACIFIC and converts it to UTC
    // (timezone.ts:139) - and because Pacific is UTC-7/-8, that instant lands
    // at 06:59/07:59Z on the FOLLOWING UTC calendar date. Reading the ISO
    // string's date field would therefore report a day the query does not
    // actually include. The honest question is "which Pacific day does this
    // boundary fall on?", which is exactly what pacificDayKey answers.
    expect(pacificDayKey(salesCalls[0].fromISO)).toBe("2026-08-09");
    expect(pacificDayKey(salesCalls[0].toISO)).toBe("2026-09-05");
  });

  it("never includes today in the fetched span", async () => {
    for (const basis of COMPARISON_BASES.map((b) => b.id)) {
      salesCalls = [];
      await build(basis, "2026-09-06", 1);
      for (const call of salesCalls) {
        // Pacific day, not the UTC string's date field - see the note above.
        expect(pacificDayKey(call.toISO) < "2026-09-06").toBe(true);
        // And belt-and-braces: the instant itself must precede the moment
        // today begins in Pacific, so no row from today can satisfy the
        // range filter no matter how the database rounds.
        expect(
          Date.parse(call.toISO) <
            Date.parse(pacificWallTimeToUtcISO("2026-09-06", "start")),
        ).toBe(true);
      }
    }
  });

  it("ignores closed weeks rather than manufacturing a record day", async () => {
    // Only one of the last four Sundays traded.
    dayRevenue = { "2026-08-23": { revenue: 200_000, orders: 10, units: 10 } };
    const c = await build("dow_average_4", "2026-09-06", 100_000);
    expect(c.revenue.baseline).toBe(200_000);
    expect(c.revenue.result.daysWithData).toBe(1);
    expect(c.revenue.qualifier).toBe("1 of 4 days had data");
    // Today is genuinely BELOW the one comparable Sunday, and says so.
    expect(c.revenue.delta.direction).toBe("down");
  });

  it("reports 'new activity' rather than a fake percentage with no baseline", async () => {
    dayRevenue = {};
    const c = await build("same_day_last_week", "2026-09-06", 50_000);
    expect(c.revenue.baseline).toBeNull();
    expect(c.revenue.delta.isNew).toBe(true);
    expect(c.revenue.qualifier).toBe("no baseline data");
  });

  it("takes the best day for the record-chasing basis", async () => {
    dayRevenue = {
      "2026-08-30": { revenue: 100_000, orders: 10, units: 10 },
      "2026-08-23": { revenue: 900_000, orders: 10, units: 10 },
      "2026-08-16": { revenue: 300_000, orders: 10, units: 10 },
    };
    const c = await build("best_same_dow", "2026-09-06", 500_000);
    expect(c.revenue.baseline).toBe(900_000);
    expect(c.revenue.delta.direction).toBe("down");
  });

  it("compares orders and units, not just money", async () => {
    dayRevenue = { "2026-09-05": { revenue: 100_000, orders: 4, units: 8 } };
    const c = await build("yesterday", "2026-09-06", 100_000);
    expect(c.orders.baseline).toBe(4);
    expect(c.units.baseline).toBe(8);
    expect(c.orders.current).toBe(10);
    expect(c.orders.delta.direction).toBe("up");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Returns and voids: the numbers, and that reading them never writes
// ─────────────────────────────────────────────────────────────────────────────

let voidRows: { after_json: unknown; created_at: string }[] = [];
let returnRows: {
  refund_minor_units: number;
  quantity: number;
  reason: string | null;
  disposition: string | null;
  created_at: string;
}[] = [];
let readFails = false;
let configured = true;
const touched: { table: string; op: string }[] = [];

vi.mock("@/lib/supabase/env", () => ({
  get isSupabaseServiceConfigured() {
    return configured;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from(table: string) {
      touched.push({ table, op: "from" });
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        gte: () => b,
        lte() {
          if (readFails) return Promise.resolve({ data: null, error: { message: "boom" } });
          if (table === "audit_logs") return Promise.resolve({ data: voidRows, error: null });
          if (table === "customer_returns") return Promise.resolve({ data: returnRows, error: null });
          return Promise.resolve({ data: [], error: null });
        },
        // Reading refunds must NEVER mutate the ledger.
        update() {
          touched.push({ table, op: "update" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
        insert() {
          touched.push({ table, op: "insert" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
        delete() {
          touched.push({ table, op: "delete" });
          throw new Error(`WRITE ATTEMPTED on ${table}`);
        },
      };
      return b;
    },
  }),
}));

async function fetchRange(from: string, to: string) {
  vi.resetModules();
  const { returnsVoidsForRange } = await import("@/lib/admin/returns-metrics-store");
  return returnsVoidsForRange(from, to);
}

describe("SLICE 21 — returns and voids, read from the two places they live", () => {
  beforeEach(() => {
    configured = true;
    readFails = false;
    touched.length = 0;
    voidRows = [
      { after_json: { refundMinor: 2500 }, created_at: "2026-09-05T18:00:00.000Z" },
    ];
    returnRows = [
      {
        refund_minor_units: 5000,
        quantity: 2,
        reason: "defective",
        disposition: "destroy",
        created_at: "2026-09-05T19:00:00.000Z",
      },
      {
        refund_minor_units: 1000,
        quantity: 1,
        reason: "wrong_item",
        disposition: "restock",
        created_at: "2026-09-05T20:00:00.000Z",
      },
    ];
  });

  it("combines voids (audit_logs) and returns (customer_returns)", async () => {
    const r = await fetchRange("2026-09-05", "2026-09-05");
    expect(r.totals.voidCount).toBe(1);
    expect(r.totals.voidRefundMinor).toBe(2500);
    expect(r.totals.returnCount).toBe(2);
    expect(r.totals.returnRefundMinor).toBe(6000);
    expect(r.totals.refundTotalMinor).toBe(8500);
    const tables = touched.filter((t) => t.op === "from").map((t) => t.table);
    expect(tables).toContain("audit_logs");
    expect(tables).toContain("customer_returns");
  });

  it("never writes while reading", async () => {
    await fetchRange("2026-09-05", "2026-09-05");
    expect(touched.filter((t) => t.op !== "from")).toEqual([]);
  });

  it("seeds every requested day so a quiet day is a real zero, not a gap", async () => {
    const r = await fetchRange("2026-09-01", "2026-09-05");
    expect(r.byDay).toHaveLength(5);
    expect(r.byDay.map((d) => d.day)).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
    expect(r.byDay[0].refundTotalMinor).toBe(0);
    expect(r.byDay[4].refundTotalMinor).toBe(8500);
  });

  it("groups return value by reason and by disposition", async () => {
    const r = await fetchRange("2026-09-05", "2026-09-05");
    expect(r.byReason[0].key).toBe("defective");
    expect(r.byReason[0].refundMinor).toBe(5000);
    expect(r.byDisposition.find((d) => d.key === "restock")?.refundMinor).toBe(1000);
    expect(r.restockShare).toBeCloseTo(1000 / 6000, 9);
    expect(r.returnedUnits).toBe(3);
  });

  it("degrades to zeros instead of throwing when the read fails", async () => {
    readFails = true;
    const r = await fetchRange("2026-09-05", "2026-09-05");
    expect(r.ok).toBe(false);
    expect(r.totals.refundTotalMinor).toBe(0);
  });

  it("returns an honest empty when Supabase is not configured", async () => {
    configured = false;
    const r = await fetchRange("2026-09-05", "2026-09-05");
    expect(r.ok).toBe(false);
    expect(touched).toEqual([]);
  });

  it("ignores a malformed void payload rather than counting NaN", async () => {
    voidRows = [
      { after_json: null, created_at: "2026-09-05T18:00:00.000Z" },
      { after_json: { refundMinor: "not-a-number" }, created_at: "2026-09-05T18:00:00.000Z" },
      { after_json: { refundMinor: -900 }, created_at: "2026-09-05T18:00:00.000Z" },
    ];
    returnRows = [];
    const r = await fetchRange("2026-09-05", "2026-09-05");
    expect(r.totals.voidCount).toBe(3);
    expect(r.totals.voidRefundMinor).toBe(0);
    expect(Number.isFinite(r.totals.refundTotalMinor)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Net revenue: the number the back office never had
// ─────────────────────────────────────────────────────────────────────────────

describe("SLICE 21 — gross is not net", () => {
  it("subtracts refunds from gross", () => {
    const n = computeNetSales(100_000, toRefundFacts({ voidRefundMinor: 2500, returnRefundMinor: 5000 }));
    expect(n.netMinor).toBe(92_500);
    expect(n.refundRate).toBeCloseTo(0.075, 9);
  });

  it("lets net go negative when a big return lands on a slow day", () => {
    const n = computeNetSales(1000, toRefundFacts({ returnRefundMinor: 9000 }));
    expect(n.netMinor).toBe(-8000);
    expect(refundSeverity(n)).toBe("high");
  });

  it("refuses to report a flattering 0% when there is no gross to divide by", () => {
    const n = computeNetSales(0, toRefundFacts({ returnRefundMinor: 5000 }));
    expect(n.refundRate).toBeNull();
    expect(formatRate(n.refundRate)).toBe("—");
    expect(formatRate(0)).toBe("0.0%");
    expect(refundSeverity(n)).toBe("high");
  });

  it("stays quiet on a genuinely clean day", () => {
    expect(refundSeverity(computeNetSales(500_000, EMPTY_REFUND_FACTS))).toBe("ok");
    expect(refundSeverity(computeNetSales(0, EMPTY_REFUND_FACTS))).toBe("ok");
  });

  it("keeps the same shape as the register's own refund summary", () => {
    // day-report-core's RefundSummary is what the X/Z slip prints. If the two
    // ever drift, the back office and the register would disagree about the
    // same day, so the compatibility is asserted rather than assumed.
    const fromRegister: RefundSummary = summarizeRefunds([
      { source: "void", refundMinor: 2500 },
      { source: "return", refundMinor: 5000 },
    ]);
    const asFacts = toRefundFacts(fromRegister);
    expect(asFacts.voidRefundMinor).toBe(fromRegister.voidRefundMinor);
    expect(asFacts.returnRefundMinor).toBe(fromRegister.returnRefundMinor);
    expect(asFacts.refundTotalMinor).toBe(fromRegister.refundTotalMinor);
    expect(sumRefundFacts([asFacts]).refundTotalMinor).toBe(7500);
  });

  it("buckets an unlabelled return instead of dropping it", () => {
    const rows = breakdownBy(
      [{ reason: null, disposition: null, refundMinorUnits: 100, quantity: 1 }],
      "reason",
    );
    expect(rows[0].key).toBe("unspecified");
    expect(rows[0].count).toBe(1);
    expect(restockShare([])).toBeNull();
    expect(totalReturnedUnits([])).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// It is actually WIRED where the owner asked for it
// ─────────────────────────────────────────────────────────────────────────────

describe("SLICE 21 — visible in the cockpit and in reports, not just computed", () => {
  const cockpit = () => read("src/app/admin/page.tsx");
  const cockpitData = () => read("src/lib/admin/cockpit-data.ts");

  it("the cockpit renders returns, voids and net revenue", () => {
    const src = cockpit();
    expect(src).toContain("Returns, voids & net");
    expect(src).toContain("Net revenue");
    expect(src).toContain("Refunded out");
    expect(src).toContain("snap.refundsToday.totals.voidCount");
    expect(src).toContain("snap.refundsToday.totals.returnCount");
  });

  it("the cockpit no longer hard-codes 'vs yesterday'", () => {
    const src = cockpit();
    expect(src).toContain("ComparisonBasisPicker");
    expect(src).toContain("snap.comparison.revenue");
    // The old call site passed the fixed yesterday deltas straight in.
    expect(src).not.toContain("deltaLabel(snap.deltas.revenue)");
  });

  it("the cockpit passes the URL's basis into the snapshot", () => {
    const src = cockpit();
    expect(src).toContain("searchParams");
    expect(src).toContain("getCockpitSnapshot(sp.basis)");
    expect(cockpitData()).toContain("parseComparisonBasis");
  });

  it("the snapshot actually reads refunds rather than declaring the field", () => {
    const src = cockpitData();
    expect(src).toContain("returnsVoidsForDay");
    expect(src).toContain("computeNetSales");
  });

  it("the returns report page exists and is registered as a tab", () => {
    expect(existsSync(join(ROOT, "src/app/admin/reports/returns/page.tsx"))).toBe(true);
    const tabs = read("src/components/admin/reports/ReportTabs.tsx");
    expect(tabs).toContain('href: "/admin/reports/returns"');
  });

  it("every link the cockpit emits to the returns report resolves to a real page", () => {
    const src = cockpit();
    const hrefs = [...src.matchAll(/href="(\/admin\/reports\/[a-z-]+)"/g)].map((m) => m[1]);
    expect(hrefs).toContain("/admin/reports/returns");
    for (const h of hrefs) {
      const file = `src/app${h}/page.tsx`;
      expect(existsSync(join(ROOT, file)), `${h} -> ${file} missing`).toBe(true);
    }
  });

  it("the refund attention flag points somewhere that exists", async () => {
    const { buildAttentionFlags } = await import("@/lib/admin/cockpit-core");
    const flags = buildAttentionFlags({
      activeOrders: 0,
      lowStockCount: 0,
      drawers: {
        openCount: 1,
        closedUnverifiedCount: 0,
        verifiedCount: 1,
        totalVarianceMinor: 0,
        needsAttention: 0,
      },
      publishedItems: 100,
      refunds: { severity: "high", refundMinor: 9000, ratePct: "9.0%" },
    });
    expect(flags).toHaveLength(1);
    expect(flags[0].href).toBe("/admin/reports/returns");
    expect(existsSync(join(ROOT, "src/app/admin/reports/returns/page.tsx"))).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Found by mutation M13. Deleting the `severity !== "ok"` guard from
  // buildAttentionFlags (cockpit-core.ts:179) left the whole suite GREEN,
  // because the only flag test above passes severity "high". That mutation
  // is not academic: every trading day has SOME refunds, so without the
  // guard the cockpit would raise a refund alarm on a perfectly healthy
  // day, and the owner would learn to ignore the alarm bar. These tests
  // pin the guard from both sides.
  // ---------------------------------------------------------------------
  const quietDay = {
    activeOrders: 0,
    lowStockCount: 0,
    drawers: {
      openCount: 1,
      closedUnverifiedCount: 0,
      verifiedCount: 1,
      totalVarianceMinor: 0,
      needsAttention: 0,
    },
    publishedItems: 100,
  };

  it("a normal refund day raises NO flag, however much money moved", async () => {
    const { buildAttentionFlags } = await import("@/lib/admin/cockpit-core");
    // $1,250 refunded is a real amount of money, but at an ok rate it is
    // just Tuesday. Alarming here would train the owner to ignore alarms.
    const flags = buildAttentionFlags({
      ...quietDay,
      refunds: { severity: "ok", refundMinor: 125_000, ratePct: "1.2%" },
    });
    expect(flags).toHaveLength(0);
  });

  it("a bad rate with no money actually refunded raises NO flag", async () => {
    const { buildAttentionFlags } = await import("@/lib/admin/cockpit-core");
    // Guards the other half of the condition: severity can read "high" off a
    // null rate on a zero-sales morning. Nothing was refunded, so nothing is
    // wrong yet.
    const flags = buildAttentionFlags({
      ...quietDay,
      refunds: { severity: "high", refundMinor: 0, ratePct: "\u2014" },
    });
    expect(flags).toHaveLength(0);
  });

  it("grades a watch-level refund rate as info and a high one as a warning", async () => {
    const { buildAttentionFlags } = await import("@/lib/admin/cockpit-core");
    const watch = buildAttentionFlags({
      ...quietDay,
      refunds: { severity: "watch", refundMinor: 30_000, ratePct: "3.0%" },
    });
    expect(watch).toHaveLength(1);
    expect(watch[0].severity).toBe("info");

    const high = buildAttentionFlags({
      ...quietDay,
      refunds: { severity: "high", refundMinor: 90_000, ratePct: "9.0%" },
    });
    expect(high).toHaveLength(1);
    expect(high[0].severity).toBe("warning");
  });

  it("omitting refunds entirely leaves older callers untouched", async () => {
    const { buildAttentionFlags } = await import("@/lib/admin/cockpit-core");
    // The mobile cockpit does not pass refunds. It must not start flagging.
    expect(buildAttentionFlags({ ...quietDay })).toHaveLength(0);
  });

  it("the report states the store-wide limitation instead of faking attribution", () => {
    const src = read("src/app/admin/reports/returns/page.tsx");
    expect(src.toLowerCase()).toContain("store-wide");
    // It must not invent a per-register split the data cannot support.
    expect(src).not.toContain("byRegister");
  });

  it("the returns store documents that neither source carries a register", () => {
    const src = read("src/lib/admin/returns-metrics-store.ts");
    expect(src).toContain("register attribution");
    expect(src).toContain("customer_returns");
    expect(src).toContain("register.sale_voided");
  });
});
