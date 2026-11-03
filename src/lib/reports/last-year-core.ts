/**
 * src/lib/reports/last-year-core.ts  (CVB-10, pure)
 *
 * "Same period last year" on Reports → Overview and Sales (owner request 2026-11-02, decision CVB-D17).
 *
 *   splitAtCutover      a period -> its Greenway part (on/after the cut-over) and its Cultivera part (before it)
 *   comparePeriod       this period vs the same calendar days a year earlier: revenue, orders, units, each with
 *                       the system it came from. A last-year period that spans the cut-over is SHOWN SPLIT
 *                       (Greenway + Cultivera (imported)), never blended silently. The Cultivera part is owner
 *                       only: for anyone else it is "hidden", and no total or change is claimed.
 *
 * Both sides use one basis: completed orders' tax-inclusive totals, Pacific days (Cultivera's order Total is the
 * same thing), so the change is like for like.
 */
import { samePeriodLastYear } from "@/lib/reports/cultivera-benchmark-core";
import { CULTIVERA_LABEL } from "@/lib/reports/cultivera-history-core";

export type Totals = { revenueMinor: number; orders: number; units: number; days: number };
export type Segment = { from: string; to: string; source: "greenway" | "cultivera" };

const ZERO: Totals = { revenueMinor: 0, orders: 0, units: 0, days: 0 };

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** No cut-over = the whole period is Greenway (Cultivera is never guessed in). */
export function splitAtCutover(from: string, to: string, cutover: string | null): Segment[] {
  if (to < from) return [];
  if (!cutover || from >= cutover) return [{ from, to, source: "greenway" }];
  if (to < cutover) return [{ from, to, source: "cultivera" }];
  return [
    { from, to: addDays(cutover, -1), source: "cultivera" },
    { from: cutover, to, source: "greenway" },
  ];
}

export type LastYearPart = { segment: Segment; label: string; totals: Totals | null; hidden: boolean };

export type MetricChange = { key: "revenue" | "orders" | "units"; label: string; now: number; then: number | null; changePct: number | null };

export type LastYearComparison = {
  period: { from: string; to: string };
  lastYear: { from: string; to: string };
  parts: LastYearPart[];
  /** Last year's total when every part is visible; null when a part is hidden (owner only) or unreadable. */
  lastYearTotals: Totals | null;
  metrics: MetricChange[];
  /** True when any figure on the last-year side is Cultivera's (the badge shows). */
  usesCultivera: boolean;
  note: string;
};

const pct = (now: number, then: number | null): number | null => (then === null || then === 0 ? null : Math.round(((now - then) / then) * 1000) / 10);

/**
 * now          this period's totals (Greenway order basis)
 * partTotals   loader result per last-year segment, in the order splitAtCutover gave (null = unreadable)
 * canSeeCultivera  owner only (cultivera.benchmark)
 */
export function comparePeriod(input: {
  from: string;
  to: string;
  now: Totals;
  cutover: string | null;
  canSeeCultivera: boolean;
  partTotals: (seg: Segment) => Totals | null;
}): LastYearComparison | null {
  const ly = samePeriodLastYear(input.from, input.to);
  if (!ly) return null;
  const segs = splitAtCutover(ly.from, ly.to, input.cutover);
  const parts: LastYearPart[] = segs.map((segment) => {
    const hidden = segment.source === "cultivera" && !input.canSeeCultivera;
    return {
      segment,
      label: segment.source === "cultivera" ? CULTIVERA_LABEL : "Greenway",
      hidden,
      totals: hidden ? null : input.partTotals(segment),
    };
  });
  const complete = parts.every((p) => !p.hidden && p.totals !== null);
  const lastYearTotals = complete
    ? parts.reduce<Totals>(
        (a, p) => ({
          revenueMinor: a.revenueMinor + (p.totals as Totals).revenueMinor,
          orders: a.orders + (p.totals as Totals).orders,
          units: a.units + (p.totals as Totals).units,
          days: a.days + (p.totals as Totals).days,
        }),
        { ...ZERO },
      )
    : null;
  const then = (k: keyof Totals) => (lastYearTotals ? lastYearTotals[k] : null);
  const metrics: MetricChange[] = [
    { key: "revenue", label: "Revenue", now: input.now.revenueMinor, then: then("revenueMinor"), changePct: pct(input.now.revenueMinor, then("revenueMinor")) },
    { key: "orders", label: "Orders", now: input.now.orders, then: then("orders"), changePct: pct(input.now.orders, then("orders")) },
    { key: "units", label: "Units", now: input.now.units, then: then("units"), changePct: pct(input.now.units, then("units")) },
  ];
  const usesCultivera = parts.some((p) => p.segment.source === "cultivera" && !p.hidden && p.totals !== null);
  let note: string;
  if (parts.some((p) => p.hidden)) note = `Last year includes days before the cut-over, which are ${CULTIVERA_LABEL} figures and shown to the owner only. No change is claimed.`;
  else if (parts.some((p) => p.totals === null)) note = "Part of last year could not be read, so no change is claimed.";
  else if (parts.length === 2) note = `Last year spans the cut-over: shown split between ${CULTIVERA_LABEL} (before ${input.cutover}) and Greenway.`;
  else if (usesCultivera) note = `Last year is entirely ${CULTIVERA_LABEL} (before the cut-over on ${input.cutover}).`;
  else note = "Both periods are Greenway figures.";
  return { period: { from: input.from, to: input.to }, lastYear: ly, parts, lastYearTotals, metrics, usesCultivera, note };
}

// ---------------------------------------------------------------------------
// self-tests
// ---------------------------------------------------------------------------

export function __runLastYearTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("  x last-year-core:", m);
    }
  };

  ok(JSON.stringify(splitAtCutover("2025-10-01", "2025-10-31", null)) === '[{"from":"2025-10-01","to":"2025-10-31","source":"greenway"}]', "no cut-over: Greenway");
  ok(splitAtCutover("2025-10-01", "2025-10-31", "2026-11-01")[0].source === "cultivera", "all before cut-over: Cultivera");
  const sp = splitAtCutover("2026-10-20", "2026-11-10", "2026-11-01");
  ok(sp.length === 2 && sp[0].to === "2026-10-31" && sp[1].from === "2026-11-01", "spanning period split at the cut-over");
  ok(splitAtCutover("2026-11-05", "2026-11-01", null).length === 0, "inverted range empty");

  const T = (r: number, o: number, u: number, d: number): Totals => ({ revenueMinor: r, orders: o, units: u, days: d });
  const owner = comparePeriod({
    from: "2026-10-01", to: "2026-10-31", now: T(120000, 120, 240, 31), cutover: "2026-09-15", canSeeCultivera: true,
    partTotals: (s) => (s.source === "cultivera" ? T(100000, 100, 200, 31) : T(0, 0, 0, 0)),
  });
  ok(owner !== null && owner.lastYear.from === "2025-10-01" && owner.lastYear.to === "2025-10-31", "same calendar days a year earlier");
  ok(owner!.parts.length === 1 && owner!.parts[0].label === "Cultivera (imported)", "last year labelled Cultivera (imported)");
  ok(owner!.metrics[0].changePct === 20 && owner!.metrics[1].changePct === 20, "+20% revenue and orders");
  ok(owner!.usesCultivera && /entirely Cultivera \(imported\)/.test(owner!.note), "owner note");

  const staff = comparePeriod({
    from: "2026-10-01", to: "2026-10-31", now: T(120000, 120, 240, 31), cutover: "2026-09-15", canSeeCultivera: false,
    partTotals: () => T(1, 1, 1, 1),
  });
  ok(staff!.parts[0].hidden && staff!.parts[0].totals === null, "Cultivera part hidden for non-owners");
  ok(staff!.lastYearTotals === null && staff!.metrics.every((m) => m.changePct === null), "no change claimed when hidden");
  ok(!staff!.usesCultivera && /owner only/.test(staff!.note), "hidden note");

  const split = comparePeriod({
    from: "2027-10-20", to: "2027-11-10", now: T(5000, 5, 5, 22), cutover: "2026-11-01", canSeeCultivera: true,
    partTotals: (s) => (s.source === "cultivera" ? T(3000, 3, 3, 12) : T(2000, 2, 2, 10)),
  });
  ok(split!.parts.length === 2 && split!.lastYearTotals!.revenueMinor === 5000 && split!.metrics[0].changePct === 0, "split parts summed, shown separately");
  ok(/spans the cut-over/.test(split!.note), "split note");

  const unread = comparePeriod({ from: "2026-10-01", to: "2026-10-02", now: T(1, 1, 1, 2), cutover: null, canSeeCultivera: true, partTotals: () => null });
  ok(unread!.lastYearTotals === null && /could not be read/.test(unread!.note), "unreadable: no change claimed");
  const zero = comparePeriod({ from: "2026-10-01", to: "2026-10-02", now: T(1, 1, 1, 2), cutover: null, canSeeCultivera: true, partTotals: () => T(0, 0, 0, 0) });
  ok(zero!.metrics[0].changePct === null && zero!.metrics[0].then === 0, "zero last year: no percentage");
  ok(comparePeriod({ from: "bad", to: "2026-10-02", now: T(0, 0, 0, 0), cutover: null, canSeeCultivera: true, partTotals: () => null }) === null, "bad dates -> null");
  ok(/Both periods are Greenway/.test(zero!.note), "Greenway note");

  return { passed, failed };
}
