/**
 * src/lib/reports/cultivera-history-core.ts  (CVB-8, pure)
 *
 * Report history from Cultivera (owner request 2026-11-02, decision CVB-D15):
 *
 *   historyFiles       which archived files hold Cultivera's orders (orders.YYYY-MM.jsonl.gz), in order
 *   orderDay           the Pacific day of one order (CreatedAtStr wall clock; CreatedAt UTC as a fallback)
 *   HistoryRollup      rolls order rows into Pacific days, part by part (so a 300 s page never holds every
 *                      order at once): COMPLETED orders only, each order Id counted once, dollars -> cents once
 *   crossCheck         each day against Cultivera's own daily report (net_sales + taxes, cents):
 *                        match | returns | mismatch | no_daily  (a difference is shown, never hidden)
 *
 * The result is report history only ("Cultivera (imported)", before the cut-over, owner only). It is never
 * written into orders, the ledger or the GL.
 */
import { dollarsToCents, isDay, type BenchmarkDayRow } from "@/lib/reports/cultivera-benchmark-core";

export type CultiveraOrderRaw = {
  Id?: unknown;
  CreatedAt?: unknown;
  CreatedAtStr?: unknown;
  Total?: unknown;
  TotalReturned?: unknown;
  Units?: unknown;
  IsCompleted?: unknown;
  IsCanceled?: unknown;
};

export type HistoryCheckStatus = "match" | "returns" | "mismatch" | "no_daily";

/** Exactly the jsonb keys cvb_upsert_history_days reads. */
export type HistoryDayRow = {
  day: string;
  revenue_minor: number;
  returned_minor: number;
  orders: number;
  units: number;
  daily_check_minor: number | null;
  diff_minor: number | null;
  check_status: HistoryCheckStatus;
};

const ORDERS_PART_RE = /^orders\.\d{4}-\d{2}\.jsonl\.gz$/;

/** The archived orders parts (one per Pacific month), oldest first. */
export function historyFiles<T extends { name: string }>(files: readonly T[]): T[] {
  return files.filter((f) => ORDERS_PART_RE.test(f.name)).sort((a, b) => (a.name < b.name ? -1 : 1));
}

const STR_RE = /^(\d{2})\/(\d{2})\/(\d{4})\s/;
const PACIFIC_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });

/** Pacific day of an order: Cultivera's own wall-clock string first, else its UTC time converted. */
export function orderDay(raw: CultiveraOrderRaw): string | null {
  if (typeof raw.CreatedAtStr === "string") {
    const m = STR_RE.exec(raw.CreatedAtStr.trim() + " ");
    if (m) {
      const d = `${m[3]}-${m[1]}-${m[2]}`;
      if (isDay(d)) return d;
    }
  }
  if (typeof raw.CreatedAt === "string") {
    const t = Date.parse(raw.CreatedAt);
    if (Number.isFinite(t)) {
      const d = PACIFIC_DAY.format(new Date(t));
      if (isDay(d)) return d;
    }
  }
  return null;
}

type DayAcc = { revenue: number; returned: number; orders: number; unitsMilli: number };

export type RollupStats = {
  rows: number;
  completed: number;
  skippedNotCompleted: number;
  duplicates: number;
  problems: number;
  problemSample: string[];
};

/** Accumulates order rows into Pacific days. Feed parts one at a time with add(); read days() at the end. */
export class HistoryRollup {
  private readonly byDay = new Map<string, DayAcc>();
  private readonly seen = new Set<string>();
  readonly stats: RollupStats = { rows: 0, completed: 0, skippedNotCompleted: 0, duplicates: 0, problems: 0, problemSample: [] };

  private problem(msg: string) {
    this.stats.problems++;
    if (this.stats.problemSample.length < 5) this.stats.problemSample.push(msg);
  }

  add(rows: readonly CultiveraOrderRaw[]): void {
    for (const raw of rows) {
      this.stats.rows++;
      if (!raw || typeof raw !== "object") {
        this.problem("not an object");
        continue;
      }
      const id = raw.Id;
      if (!(typeof id === "number" && Number.isFinite(id)) && !(typeof id === "string" && id.trim())) {
        this.problem("order without an Id");
        continue;
      }
      const key = String(id);
      if (this.seen.has(key)) {
        this.stats.duplicates++;
        continue;
      }
      this.seen.add(key);
      if (raw.IsCompleted !== true || raw.IsCanceled === true) {
        this.stats.skippedNotCompleted++;
        continue;
      }
      const day = orderDay(raw);
      if (!day) {
        this.problem(`order ${key}: no readable date`);
        continue;
      }
      const total = dollarsToCents(raw.Total);
      if (total === null) {
        this.problem(`order ${key}: Total missing or not a number`);
        continue;
      }
      const returned = dollarsToCents(raw.TotalReturned) ?? 0;
      const units = typeof raw.Units === "number" && Number.isFinite(raw.Units) ? Math.round(raw.Units * 1000) : 0;
      const acc = this.byDay.get(day) ?? { revenue: 0, returned: 0, orders: 0, unitsMilli: 0 };
      acc.revenue += total;
      acc.returned += Math.abs(returned);
      acc.orders += 1;
      acc.unitsMilli += units;
      this.byDay.set(day, acc);
      this.stats.completed++;
    }
  }

  /** The rolled-up days, oldest first, not yet cross-checked. */
  days(): { day: string; revenue_minor: number; returned_minor: number; orders: number; units: number }[] {
    return [...this.byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([day, a]) => ({ day, revenue_minor: a.revenue, returned_minor: a.returned, orders: a.orders, units: a.unitsMilli / 1000 }));
  }
}

/**
 * Each rolled-up day against Cultivera's daily report. The orders' Total is tax-inclusive after discounts, so on a
 * day with no returns it equals NetSales + Taxes to the cent. A day with returns is flagged "returns" (Cultivera nets
 * returns on the day they happen, not on the original order), never forced to agree.
 */
export function crossCheck(
  days: readonly { day: string; revenue_minor: number; returned_minor: number; orders: number; units: number }[],
  daily: readonly Pick<BenchmarkDayRow, "day" | "net_sales_minor" | "taxes_minor" | "returns_minor">[],
): HistoryDayRow[] {
  const byDay = new Map(daily.map((d) => [d.day, d]));
  return days.map((d) => {
    const b = byDay.get(d.day);
    if (!b) return { ...d, daily_check_minor: null, diff_minor: null, check_status: "no_daily" as const };
    const check = b.net_sales_minor + b.taxes_minor;
    const diff = d.revenue_minor - check;
    const status: HistoryCheckStatus = diff === 0 ? "match" : b.returns_minor !== 0 || d.returned_minor !== 0 ? "returns" : "mismatch";
    return { ...d, daily_check_minor: check, diff_minor: diff, check_status: status };
  });
}

export type CheckSummary = { days: number; match: number; returns: number; mismatch: number; noDaily: number; first: string | null; last: string | null };

export function summarizeCheck(rows: readonly HistoryDayRow[]): CheckSummary {
  const s: CheckSummary = { days: rows.length, match: 0, returns: 0, mismatch: 0, noDaily: 0, first: rows[0]?.day ?? null, last: rows[rows.length - 1]?.day ?? null };
  for (const r of rows) {
    if (r.check_status === "match") s.match++;
    else if (r.check_status === "returns") s.returns++;
    else if (r.check_status === "mismatch") s.mismatch++;
    else s.noDaily++;
  }
  return s;
}

export function parseHistoryResult(x: unknown): { rows: number; written: number; keptNewer: number } | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const rows = Number(o.rows);
  const written = Number(o.written);
  const kept = Number(o.kept_newer);
  if (![rows, written, kept].every((v) => Number.isInteger(v) && v >= 0)) return null;
  return { rows, written, keptNewer: kept };
}

/** The label every report uses next to Cultivera figures (CVB-D16: "clearly mark Cultivera data"). */
export const CULTIVERA_LABEL = "Cultivera (imported)";

// ---------------------------------------------------------------------------
// self-tests
// ---------------------------------------------------------------------------

export function __runCultiveraHistoryTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("  x cultivera-history-core:", m);
    }
  };

  const files = historyFiles([{ name: "orders.2024-09.jsonl.gz" }, { name: "orders.2024-08.jsonl.gz" }, { name: "daily_sales.p0001.jsonl.gz" }, { name: "orders_lines.2024-08.jsonl.gz" }]);
  ok(files.map((f) => f.name).join() === "orders.2024-08.jsonl.gz,orders.2024-09.jsonl.gz", "orders parts only, oldest first");

  ok(orderDay({ CreatedAtStr: "08/30/2024 08:02 AM" }) === "2024-08-30", "wall-clock string read as written");
  ok(orderDay({ CreatedAtStr: "02/30/2024 08:02 AM", CreatedAt: "2024-03-01T20:00:00Z" }) === "2024-03-01", "impossible string falls back to UTC");
  ok(orderDay({ CreatedAt: "2024-08-31T06:30:00Z" }) === "2024-08-30", "UTC 06:30 is the previous Pacific day (PDT)");
  ok(orderDay({ CreatedAt: "2024-12-01T07:30:00Z" }) === "2024-11-30", "UTC 07:30 in winter is still the previous Pacific day (PST)");
  ok(orderDay({}) === null, "no date -> null");

  const r = new HistoryRollup();
  r.add([
    { Id: 1, CreatedAtStr: "08/30/2024 08:02 AM", Total: 18.0, Units: 2.0, IsCompleted: true },
    { Id: 2, CreatedAtStr: "08/30/2024 11:59 PM", Total: 0.1, Units: 1.5, IsCompleted: true },
    { Id: 3, CreatedAtStr: "08/30/2024 01:00 PM", Total: 99, Units: 1, IsCompleted: false },
    { Id: 4, CreatedAtStr: "08/30/2024 01:00 PM", Total: 99, Units: 1, IsCompleted: true, IsCanceled: true },
  ]);
  r.add([
    { Id: 1, CreatedAtStr: "08/30/2024 08:02 AM", Total: 18.0, Units: 2.0, IsCompleted: true },
    { Id: 5, CreatedAtStr: "08/31/2024 09:00 AM", Total: 20.2, TotalReturned: 5.05, Units: 1, IsCompleted: true },
    { Id: 6, CreatedAtStr: "08/31/2024 09:00 AM", Total: "x", IsCompleted: true },
    { CreatedAtStr: "08/31/2024 09:00 AM", Total: 1, IsCompleted: true },
  ]);
  const d = r.days();
  ok(d.length === 2, "two days");
  ok(d[0].day === "2024-08-30" && d[0].revenue_minor === 1810 && d[0].orders === 2, "completed only, cents exact (0.1 -> 10)");
  ok(d[0].units === 3.5, "fractional units summed without float drift");
  ok(d[1].revenue_minor === 2020 && d[1].returned_minor === 505, "returned tracked");
  ok(r.stats.duplicates === 1, "a repeated Id counted once");
  ok(r.stats.skippedNotCompleted === 2, "open and cancelled orders left out");
  ok(r.stats.problems === 2 && r.stats.problemSample.length === 2, "bad Total and missing Id reported");
  ok(r.stats.rows === 8 && r.stats.completed === 3, "row counts");

  const checked = crossCheck(
    [...d, { day: "2024-09-01", revenue_minor: 500, returned_minor: 0, orders: 1, units: 1 }, { day: "2024-09-02", revenue_minor: 700, returned_minor: 0, orders: 1, units: 1 }],
    [
      { day: "2024-08-30", net_sales_minor: 1500, taxes_minor: 310, returns_minor: 0 },
      { day: "2024-08-31", net_sales_minor: 1000, taxes_minor: 400, returns_minor: 505 },
      { day: "2024-09-02", net_sales_minor: 600, taxes_minor: 99, returns_minor: 0 },
    ],
  );
  ok(checked[0].check_status === "match" && checked[0].diff_minor === 0 && checked[0].daily_check_minor === 1810, "matching day");
  ok(checked[1].check_status === "returns" && checked[1].diff_minor === 620, "return day flagged, difference kept");
  ok(checked[2].check_status === "no_daily" && checked[2].daily_check_minor === null, "no daily row");
  ok(checked[3].check_status === "mismatch" && checked[3].diff_minor === 1, "one cent off with no returns is a mismatch");
  const s = summarizeCheck(checked);
  ok(s.days === 4 && s.match === 1 && s.returns === 1 && s.mismatch === 1 && s.noDaily === 1, "summary counts");
  ok(s.first === "2024-08-30" && s.last === "2024-09-02", "summary span");
  ok(summarizeCheck([]).first === null, "empty summary");

  ok(JSON.stringify(parseHistoryResult({ rows: 3, written: 2, kept_newer: 1 })) === '{"rows":3,"written":2,"keptNewer":1}', "rpc result parsed");
  ok(parseHistoryResult({ rows: -1, written: 0, kept_newer: 0 }) === null && parseHistoryResult(null) === null, "bad rpc result refused");
  ok(CULTIVERA_LABEL === "Cultivera (imported)", "label");

  return { passed, failed };
}
