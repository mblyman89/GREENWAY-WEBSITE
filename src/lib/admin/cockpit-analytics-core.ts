/**
 * src/lib/admin/cockpit-analytics-core.ts  (D210, cockpit v2: visual analytics)
 *
 * PURE math behind the /admin cockpit's charts. No I/O, no React, no clock:
 * every "now" is passed in, so it is tsx-testable and the self-tests below
 * run in scripts/compliance/run-pure-selftests.ts.
 *
 * Owner, verbatim (docs/sop-program/00-OWNER-REQUEST-VERBATIM.md, D210):
 *   "add more details to the bar chart, have it show more based on the
 *    selection of the top comparisons ... A line chart to compliment the bar
 *    chart ... overlaying labor hours or transactions over the hourly sales
 *    ... who on shift currently is selling more ... Better visualization of
 *    the break down within the categories and types."
 *
 * RULES THIS FILE KEEPS
 *   - Money is integer cents in and out (rule 8). Charts convert to dollars.
 *   - The CLOSED-DAY RULE (comparison-data.ts): a baseline day with no orders
 *     is NO DATA, never $0. Hour and category baselines are built only from
 *     baseline days that traded, exactly like the KPI tiles.
 *   - The basis decides the days and how they combine (comparison-basis-core):
 *       single  -> that one day (or nothing, when it was closed)
 *       average -> the mean over the days that traded
 *       max     -> the BEST day (highest revenue) and its own curve. A
 *                  per-hour max would stitch together a day that never
 *                  happened, so it is not used.
 *   - Same-day per-employee DOLLARS are never produced here (B34 blind-count
 *     discipline, leaderboard-core.ts). The on-shift board carries sale
 *     COUNTS and items for today; dollars only for the trailing week.
 */
import { formatHourLabel, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { shortHourLabel } from "@/lib/admin/cockpit-extras-core";

// ---------------------------------------------------------------------------
// Shared input shapes (structurally compatible with sales.ts; kept local so
// this file has no server imports).
// ---------------------------------------------------------------------------

export type DayIn = { date: string; revenueMinorUnits: number; orders: number; units: number };
export type HourPointIn = { hour: number; revenueMinorUnits: number; orders: number };
export type DayHourIn = { date: string; hour: number; revenueMinorUnits: number; orders: number };
export type DayCategoryTypeIn = {
  date: string;
  category: string;
  type: string;
  revenueMinorUnits: number;
  units: number;
};
export type BasisMode = "single" | "average" | "max";

function int(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0;
}

// ---------------------------------------------------------------------------
// 1. Which baseline days count
// ---------------------------------------------------------------------------

export type ResolvedBaseline = {
  /** The baseline days actually used (they traded). */
  days: string[];
  /** How many days the basis asked for. */
  requested: number;
  /** True when some asked-for days had no orders (closed / before the system). */
  partial: boolean;
  /** For mode "max": the best day picked. */
  bestDay: string | null;
};

/**
 * Apply the basis mode and the closed-day rule to the window's days.
 * `byDay` is the baseline report's per-day series.
 */
export function resolveBaselineDays(windowDays: readonly string[], mode: BasisMode, byDay: readonly DayIn[]): ResolvedBaseline {
  const traded = new Map<string, number>();
  for (const d of byDay) if (int(d.orders) > 0) traded.set(d.date, int(d.revenueMinorUnits));
  const withData = windowDays.filter((d) => traded.has(d));
  const requested = windowDays.length;
  if (withData.length === 0) return { days: [], requested, partial: requested > 0, bestDay: null };
  if (mode === "single") {
    // The single-day bases ask for exactly one day; use it only if it traded.
    return { days: [withData[0]], requested, partial: withData.length < requested, bestDay: null };
  }
  if (mode === "max") {
    let best = withData[0];
    for (const d of withData) if ((traded.get(d) ?? 0) > (traded.get(best) ?? 0)) best = d;
    return { days: [best], requested, partial: withData.length < requested, bestDay: best };
  }
  return { days: withData, requested, partial: withData.length < requested, bestDay: null };
}

// ---------------------------------------------------------------------------
// 2. Hour by hour: today vs the basis, cumulative pace and a projection
// ---------------------------------------------------------------------------

export type HourCompareRow = {
  hour: number;
  label: string;
  shortLabel: string;
  todayMinor: number;
  todayOrders: number;
  /** Basis value for this hour (cents), null when there is no baseline. */
  baselineMinor: number | null;
  baselineOrders: number | null;
  /** Running totals (cents). todayCum is null for hours still to come. */
  todayCumMinor: number | null;
  baselineCumMinor: number | null;
  /** Projected running total for hours still to come (null before now). */
  projectedCumMinor: number | null;
  /** True for hours after the current hour. */
  isFuture: boolean;
  /** True for the hour in progress. */
  isNow: boolean;
};

export type HourlyComparison = {
  rows: HourCompareRow[];
  /** Today so far (cents). */
  todaySoFarMinor: number;
  /** What the basis had sold by this same minute (cents), null without a baseline. */
  baselineSoFarMinor: number | null;
  /** today / baseline-at-this-minute; 1.12 = 12% ahead. null without a baseline. */
  pace: number | null;
  /** The basis's whole-day total (cents). */
  baselineDayMinor: number | null;
  /** End-of-day projection = basis day total x pace (cents). */
  projectedDayMinor: number | null;
  baseline: ResolvedBaseline;
  /** Busiest hour on the basis (the rush to staff for). */
  baselinePeakHour: number | null;
};

/**
 * Today's hours against the basis. `nowHour`/`nowMinute` are Pacific wall
 * time. Hours drawn: [openHour, closeHour) widened to any hour that sold
 * today or on the basis.
 */
export function hourlyVsBaseline(input: {
  todayByHour: readonly HourPointIn[];
  baselineByDay: readonly DayIn[];
  baselineByDayHour: readonly DayHourIn[];
  windowDays: readonly string[];
  mode: BasisMode;
  nowHour: number;
  nowMinute: number;
  openHour?: number;
  closeHour?: number;
}): HourlyComparison {
  const baseline = resolveBaselineDays(input.windowDays, input.mode, input.baselineByDay);
  const used = new Set(baseline.days);
  const n = baseline.days.length;
  const bRev = new Array<number>(24).fill(0);
  const bOrd = new Array<number>(24).fill(0);
  for (const p of input.baselineByDayHour) {
    if (!used.has(p.date) || !Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23) continue;
    bRev[p.hour] += int(p.revenueMinorUnits);
    bOrd[p.hour] += int(p.orders);
  }
  const tRev = new Array<number>(24).fill(0);
  const tOrd = new Array<number>(24).fill(0);
  for (const h of input.todayByHour) {
    if (!Number.isInteger(h.hour) || h.hour < 0 || h.hour > 23) continue;
    tRev[h.hour] += int(h.revenueMinorUnits);
    tOrd[h.hour] += int(h.orders);
  }
  const avg = (sum: number) => (n > 0 ? Math.round(sum / n) : null);
  const baseHour = bRev.map(avg);
  const baseOrd = bOrd.map((s) => (n > 0 ? Math.round((s / n) * 10) / 10 : null));

  const nowHour = Math.max(0, Math.min(23, Math.trunc(input.nowHour)));
  const frac = Math.max(0, Math.min(1, input.nowMinute / 60));

  let lo = Math.max(0, Math.min(23, input.openHour ?? 8));
  let hi = Math.max(lo, Math.min(23, (input.closeHour ?? 24) - 1));
  for (let h = 0; h < 24; h += 1) {
    if (tRev[h] > 0 || tOrd[h] > 0 || (baseHour[h] ?? 0) > 0) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }

  // Baseline sold by this same minute.
  let baselineSoFar: number | null = null;
  let baselineDay: number | null = null;
  if (n > 0) {
    let s = 0;
    for (let h = 0; h < nowHour; h += 1) s += baseHour[h] ?? 0;
    s += Math.round((baseHour[nowHour] ?? 0) * frac);
    baselineSoFar = s;
    baselineDay = baseHour.reduce<number>((a, b) => a + (b ?? 0), 0);
  }
  const todaySoFar = tRev.reduce((a, b) => a + b, 0);
  const pace = baselineSoFar !== null && baselineSoFar > 0 ? todaySoFar / baselineSoFar : null;
  const projectedDay = pace !== null && baselineDay !== null ? Math.round(baselineDay * pace) : null;

  const rows: HourCompareRow[] = [];
  let tCum = 0;
  let bCum = 0;
  for (let h = 0; h < 24; h += 1) {
    tCum += tRev[h];
    bCum += baseHour[h] ?? 0;
    if (h < lo || h > hi) continue;
    const isFuture = h > nowHour;
    let projected: number | null = null;
    if (h >= nowHour && pace !== null && baselineSoFar !== null) {
      // Today so far plus the basis's remaining curve, scaled by today's pace.
      projected = Math.round(todaySoFar + (bCum - baselineSoFar) * pace);
      if (projected < todaySoFar) projected = todaySoFar;
    }
    rows.push({
      hour: h,
      label: formatHourLabel(h),
      shortLabel: shortHourLabel(formatHourLabel(h)),
      todayMinor: tRev[h],
      todayOrders: tOrd[h],
      baselineMinor: baseHour[h],
      baselineOrders: baseOrd[h],
      todayCumMinor: isFuture ? null : tCum,
      baselineCumMinor: n > 0 ? bCum : null,
      projectedCumMinor: projected,
      isFuture,
      isNow: h === nowHour,
    });
  }

  let peak: number | null = null;
  if (n > 0) {
    let best = 0;
    for (let h = 0; h < 24; h += 1) {
      if ((baseHour[h] ?? 0) > best) {
        best = baseHour[h] ?? 0;
        peak = h;
      }
    }
  }

  return {
    rows,
    todaySoFarMinor: todaySoFar,
    baselineSoFarMinor: baselineSoFar,
    pace,
    baselineDayMinor: baselineDay,
    projectedDayMinor: projectedDay,
    baseline,
    baselinePeakHour: peak,
  };
}

// ---------------------------------------------------------------------------
// 3. Labor on the clock by hour, and sales per labor hour
// ---------------------------------------------------------------------------

export type PunchIn = {
  employeeId: string;
  kind: "work" | "break" | string;
  clockInIso: string;
  /** null = still open (on the clock / on break now). */
  clockOutIso: string | null;
};

export type LaborHour = {
  hour: number;
  /** Staff-minutes worked in this hour (breaks taken out). */
  staffMinutes: number;
  /** Distinct people on the clock at any point in this hour. */
  headcount: number;
};

type Interval = [number, number];

function subtract(base: Interval[], cuts: Interval[]): Interval[] {
  let out = base;
  for (const [cs, ce] of cuts) {
    const next: Interval[] = [];
    for (const [s, e] of out) {
      if (ce <= s || cs >= e) {
        next.push([s, e]);
        continue;
      }
      if (cs > s) next.push([s, cs]);
      if (ce < e) next.push([ce, e]);
    }
    out = next;
  }
  return out;
}

/**
 * Staff on the clock per Pacific hour of `dayYmd`. Work punches minus that
 * person's break punches (if breaks are recorded separately the subtraction
 * changes nothing; if they sit inside a work punch, they are taken out). An
 * open punch runs to `nowIso`. Time after `nowIso` is never counted.
 */
export function laborByHour(punches: readonly PunchIn[], dayYmd: string, nowIso: string): LaborHour[] {
  const nowMs = Date.parse(nowIso);
  const byEmp = new Map<string, { work: Interval[]; brk: Interval[] }>();
  for (const p of punches) {
    const s = Date.parse(p.clockInIso);
    const eRaw = p.clockOutIso ? Date.parse(p.clockOutIso) : nowMs;
    if (!Number.isFinite(s) || !Number.isFinite(eRaw)) continue;
    const e = Math.min(eRaw, nowMs);
    if (e <= s) continue;
    const slot = byEmp.get(p.employeeId) ?? { work: [], brk: [] };
    if (p.kind === "work") slot.work.push([s, e]);
    else if (p.kind === "break") slot.brk.push([s, e]);
    byEmp.set(p.employeeId, slot);
  }
  const worked = new Map<string, Interval[]>();
  for (const [id, { work, brk }] of byEmp) {
    const iv = subtract(work, brk);
    if (iv.length > 0) worked.set(id, iv);
  }
  const out: LaborHour[] = [];
  for (let h = 0; h < 24; h += 1) {
    const hs = Date.parse(pacificWallTimeToUtcISO(dayYmd, { h, m: 0, s: 0, ms: 0 }));
    const he = hs + 3_600_000;
    let ms = 0;
    let heads = 0;
    for (const iv of worked.values()) {
      let mine = 0;
      for (const [s, e] of iv) {
        const o = Math.min(e, he) - Math.max(s, hs);
        if (o > 0) mine += o;
      }
      if (mine > 0) {
        ms += mine;
        heads += 1;
      }
    }
    out.push({ hour: h, staffMinutes: Math.round(ms / 60_000), headcount: heads });
  }
  return out;
}

export type TrafficLaborRow = {
  hour: number;
  label: string;
  shortLabel: string;
  revenueMinor: number;
  orders: number;
  /** Labor hours worked in this hour (1 decimal). */
  laborHours: number;
  headcount: number;
  /** Sales per labor hour (cents), null when nobody was on the clock. */
  splhMinor: number | null;
  /** Orders per labor hour (1 decimal), null when nobody was on the clock. */
  ordersPerLaborHour: number | null;
  /** Basis orders for this hour (the rush you staff for), null without a baseline. */
  baselineOrders: number | null;
};

export type TrafficLaborSummary = {
  rows: TrafficLaborRow[];
  totalLaborHours: number;
  /** Today's sales per labor hour so far (cents), null with no labor. */
  splhMinor: number | null;
  /** The hour with the most orders per labor hour (most stretched). */
  mostStretchedHour: number | null;
  /** Hours with staff on the clock and no orders (idle labor). */
  idleStaffedHours: number[];
  /** True when no punches were recorded (the overlay says so). */
  noLabor: boolean;
};

/** Join hourly sales, transactions, labor and the basis's orders into chart rows. */
export function trafficVsLabor(input: {
  hourly: HourlyComparison;
  labor: readonly LaborHour[];
}): TrafficLaborSummary {
  const lab = new Map(input.labor.map((l) => [l.hour, l]));
  const rows: TrafficLaborRow[] = [];
  let totalMin = 0;
  let totalRev = 0;
  let stretched: { hour: number; v: number } | null = null;
  const idle: number[] = [];
  for (const r of input.hourly.rows) {
    const l = lab.get(r.hour);
    const mins = l?.staffMinutes ?? 0;
    const hrs = Math.round((mins / 60) * 10) / 10;
    const opl = mins > 0 ? Math.round((r.todayOrders / (mins / 60)) * 10) / 10 : null;
    if (!r.isFuture) {
      totalMin += mins;
      totalRev += r.todayMinor;
      if (opl !== null && (stretched === null || opl > stretched.v)) stretched = { hour: r.hour, v: opl };
      if (mins >= 30 && r.todayOrders === 0 && !r.isNow) idle.push(r.hour);
    }
    rows.push({
      hour: r.hour,
      label: r.label,
      shortLabel: r.shortLabel,
      revenueMinor: r.todayMinor,
      orders: r.todayOrders,
      laborHours: hrs,
      headcount: l?.headcount ?? 0,
      splhMinor: mins > 0 ? Math.round(r.todayMinor / (mins / 60)) : null,
      ordersPerLaborHour: opl,
      baselineOrders: r.baselineOrders,
    });
  }
  return {
    rows,
    totalLaborHours: Math.round((totalMin / 60) * 10) / 10,
    splhMinor: totalMin > 0 ? Math.round(totalRev / (totalMin / 60)) : null,
    mostStretchedHour: stretched && stretched.v > 0 ? stretched.hour : null,
    idleStaffedHours: idle,
    noLabor: input.labor.every((l) => l.staffMinutes === 0),
  };
}

// ---------------------------------------------------------------------------
// 4. Category and type mix, today vs the basis
// ---------------------------------------------------------------------------

export type TypeMixRow = {
  type: string;
  todayMinor: number;
  todayUnits: number;
  /** Share of its category today (0..1). */
  shareOfCategory: number;
  baselineMinor: number | null;
};

export type CategoryMixRow = {
  category: string;
  todayMinor: number;
  todayUnits: number;
  /** Share of all revenue today (0..1). */
  todayShare: number;
  /** Basis revenue for the category (cents per baseline day), null without a baseline. */
  baselineMinor: number | null;
  baselineShare: number | null;
  /** Change in share, percentage points (e.g. +3.2). */
  shareDeltaPts: number | null;
  /** Change in revenue vs basis (%), null when the basis sold none. */
  revenueDeltaPct: number | null;
  types: TypeMixRow[];
};

export type CategoryMix = {
  categories: CategoryMixRow[];
  todayTotalMinor: number;
  baselineTotalMinor: number | null;
  baseline: ResolvedBaseline;
  /** Biggest share gainer / loser vs the basis (category names). */
  topGainer: string | null;
  topLoser: string | null;
};

/** Today's category/type mix against the same basis days. */
export function categoryMixVsBaseline(input: {
  today: readonly { category: string; revenueMinorUnits: number; units: number; types: readonly { label: string; revenueMinorUnits: number; units: number }[] }[];
  baselineByDay: readonly DayIn[];
  baselineByDayCategoryType: readonly DayCategoryTypeIn[];
  windowDays: readonly string[];
  mode: BasisMode;
}): CategoryMix {
  const baseline = resolveBaselineDays(input.windowDays, input.mode, input.baselineByDay);
  const used = new Set(baseline.days);
  const n = baseline.days.length;
  const bCat = new Map<string, number>();
  const bType = new Map<string, number>();
  let bTotal = 0;
  for (const p of input.baselineByDayCategoryType) {
    if (!used.has(p.date)) continue;
    const v = int(p.revenueMinorUnits);
    bCat.set(p.category, (bCat.get(p.category) ?? 0) + v);
    const k = `${p.category}\u0000${p.type}`;
    bType.set(k, (bType.get(k) ?? 0) + v);
    bTotal += v;
  }
  const per = (v: number) => (n > 0 ? Math.round(v / n) : null);
  const baselineTotal = n > 0 ? Math.round(bTotal / n) : null;
  const todayTotal = input.today.reduce((a, c) => a + int(c.revenueMinorUnits), 0);

  const names = new Set<string>(input.today.map((c) => c.category));
  for (const c of bCat.keys()) names.add(c);
  const todayBy = new Map(input.today.map((c) => [c.category, c]));

  const categories: CategoryMixRow[] = [...names].map((category) => {
    const t = todayBy.get(category);
    const tMinor = int(t?.revenueMinorUnits);
    const bMinor = n > 0 ? per(bCat.get(category) ?? 0) : null;
    const tShare = todayTotal > 0 ? tMinor / todayTotal : 0;
    const bShare = bMinor !== null && baselineTotal !== null && baselineTotal > 0 ? bMinor / baselineTotal : null;
    const typeNames = new Set<string>((t?.types ?? []).map((x) => x.label));
    for (const k of bType.keys()) {
      const [c, ty] = k.split("\u0000");
      if (c === category) typeNames.add(ty);
    }
    const tTypes = new Map((t?.types ?? []).map((x) => [x.label, x]));
    const types: TypeMixRow[] = [...typeNames]
      .map((type) => {
        const tt = tTypes.get(type);
        const ttm = int(tt?.revenueMinorUnits);
        return {
          type,
          todayMinor: ttm,
          todayUnits: int(tt?.units),
          shareOfCategory: tMinor > 0 ? ttm / tMinor : 0,
          baselineMinor: n > 0 ? per(bType.get(`${category}\u0000${type}`) ?? 0) : null,
        };
      })
      .sort((a, b) => b.todayMinor - a.todayMinor || (b.baselineMinor ?? 0) - (a.baselineMinor ?? 0));
    return {
      category,
      todayMinor: tMinor,
      todayUnits: int(t?.units),
      todayShare: tShare,
      baselineMinor: bMinor,
      baselineShare: bShare,
      shareDeltaPts: bShare !== null && todayTotal > 0 ? Math.round((tShare - bShare) * 1000) / 10 : null,
      revenueDeltaPct: bMinor !== null && bMinor > 0 ? Math.round(((tMinor - bMinor) / bMinor) * 1000) / 10 : null,
      types,
    };
  });
  categories.sort((a, b) => b.todayMinor - a.todayMinor || (b.baselineMinor ?? 0) - (a.baselineMinor ?? 0));

  let gainer: CategoryMixRow | null = null;
  let loser: CategoryMixRow | null = null;
  for (const c of categories) {
    if (c.shareDeltaPts === null) continue;
    if (c.shareDeltaPts > 0 && (gainer === null || c.shareDeltaPts > (gainer.shareDeltaPts ?? 0))) gainer = c;
    if (c.shareDeltaPts < 0 && (loser === null || c.shareDeltaPts < (loser.shareDeltaPts ?? 0))) loser = c;
  }
  return {
    categories,
    todayTotalMinor: todayTotal,
    baselineTotalMinor: baselineTotal,
    baseline,
    topGainer: gainer?.category ?? null,
    topLoser: loser?.category ?? null,
  };
}

/**
 * Fold a long tail into "Other" so a donut stays readable. Keeps the `keep`
 * biggest slices; values are whatever unit the caller passes.
 */
export function foldTail<T extends { name: string; value: number }>(rows: readonly T[], keep = 6, otherName = "Other"): { name: string; value: number }[] {
  const sorted = [...rows].filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= keep + 1) return sorted.map((r) => ({ name: r.name, value: r.value }));
  const head = sorted.slice(0, keep).map((r) => ({ name: r.name, value: r.value }));
  const rest = sorted.slice(keep).reduce((a, r) => a + r.value, 0);
  return rest > 0 ? [...head, { name: otherName, value: rest }] : head;
}

// ---------------------------------------------------------------------------
// 5. Daily trend with a moving average
// ---------------------------------------------------------------------------

export type TrendRow = {
  date: string;
  /** null = the store did not trade (closed-day rule), not $0. */
  revenueMinor: number | null;
  orders: number | null;
  avgOrderMinor: number | null;
  unitsPerOrder: number | null;
  /** Trailing moving average of revenue over the last `window` TRADING days ending here. */
  maRevenueMinor: number | null;
  isToday: boolean;
};

export type TrendSummary = {
  rows: TrendRow[];
  /** Mean revenue per trading day in the series (excl. today, which is partial). */
  avgDayMinor: number | null;
  bestDay: { date: string; revenueMinor: number } | null;
  tradingDays: number;
};

/** Daily trend; today's (partial) day is included last and flagged. */
export function dailyTrend(history: readonly DayIn[], today: DayIn | null, todayYmd: string, window = 7): TrendSummary {
  const all = [...history.filter((d) => d.date < todayYmd)].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (today) all.push({ ...today, date: todayYmd });
  const rows: TrendRow[] = [];
  const recent: number[] = [];
  let sum = 0;
  let count = 0;
  let best: { date: string; revenueMinor: number } | null = null;
  for (const d of all) {
    const isToday = d.date === todayYmd;
    const traded = int(d.orders) > 0;
    const rev = traded ? int(d.revenueMinorUnits) : null;
    if (traded && !isToday) {
      recent.push(int(d.revenueMinorUnits));
      if (recent.length > window) recent.shift();
      sum += int(d.revenueMinorUnits);
      count += 1;
      if (!best || int(d.revenueMinorUnits) > best.revenueMinor) best = { date: d.date, revenueMinor: int(d.revenueMinorUnits) };
    }
    const ma = !isToday && traded && recent.length >= Math.min(3, window) ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : null;
    rows.push({
      date: d.date,
      revenueMinor: isToday ? int(d.revenueMinorUnits) : rev,
      orders: traded || isToday ? int(d.orders) : null,
      avgOrderMinor: int(d.orders) > 0 ? Math.round(int(d.revenueMinorUnits) / int(d.orders)) : null,
      unitsPerOrder: int(d.orders) > 0 ? Math.round((int(d.units) / int(d.orders)) * 10) / 10 : null,
      maRevenueMinor: ma,
      isToday,
    });
  }
  return { rows, avgDayMinor: count > 0 ? Math.round(sum / count) : null, bestDay: best, tradingDays: count };
}

// ---------------------------------------------------------------------------
// 6. Who on shift is selling (no same-day dollars)
// ---------------------------------------------------------------------------

export type OnClockIn = { employeeId: string; name: string; role: string; clockInIso: string };
export type SellerTotalsIn = { employeeId: string; saleCount: number; itemCount: number; grossMinor: number };

export type OnShiftRow = {
  employeeId: string;
  name: string;
  role: string;
  minutesOnClock: number;
  saleCount: number;
  itemCount: number;
  /** Items per sale today (1 decimal), null with no sales. */
  itemsPerSale: number | null;
  /** Sales rung per hour on the clock today (1 decimal), null under 15 minutes. */
  salesPerHour: number | null;
  /** Share of all sales rung today, 0..1. */
  shareOfSales: number;
  /** Trailing 7-day gross (cents). Multi-day, so it cannot rebuild a drawer. */
  weekGrossMinor: number;
  weekSaleCount: number;
  /** Rank today by sale count among people on the clock (competition rank). */
  rankToday: number;
};

export type OnShiftBoard = {
  rows: OnShiftRow[];
  /** Sales rung today by people not on the clock now (count only). */
  offClockSaleCount: number;
  totalSalesToday: number;
  leaderName: string | null;
};

/**
 * The on-shift board. TODAY carries counts and items only. Ranking: sale
 * count, then items, then name (the same order as the register leaderboard).
 */
export function onShiftBoard(input: {
  onClock: readonly OnClockIn[];
  today: readonly SellerTotalsIn[];
  week: readonly SellerTotalsIn[];
  nowIso: string;
}): OnShiftBoard {
  const nowMs = Date.parse(input.nowIso);
  const todayBy = new Map(input.today.map((t) => [t.employeeId, t]));
  const weekBy = new Map(input.week.map((t) => [t.employeeId, t]));
  const totalSales = input.today.reduce((a, t) => a + int(t.saleCount), 0);
  const seen = new Set<string>();
  const rows: Omit<OnShiftRow, "rankToday">[] = [];
  for (const e of input.onClock) {
    if (seen.has(e.employeeId)) continue;
    seen.add(e.employeeId);
    const t = todayBy.get(e.employeeId);
    const w = weekBy.get(e.employeeId);
    const startMs = Date.parse(e.clockInIso);
    const mins = Number.isFinite(startMs) && Number.isFinite(nowMs) ? Math.max(0, Math.round((nowMs - startMs) / 60_000)) : 0;
    const sc = int(t?.saleCount);
    const ic = int(t?.itemCount);
    rows.push({
      employeeId: e.employeeId,
      name: e.name.trim() || "Unknown",
      role: e.role,
      minutesOnClock: mins,
      saleCount: sc,
      itemCount: ic,
      itemsPerSale: sc > 0 ? Math.round((ic / sc) * 10) / 10 : null,
      salesPerHour: mins >= 15 ? Math.round((sc / (mins / 60)) * 10) / 10 : null,
      shareOfSales: totalSales > 0 ? sc / totalSales : 0,
      weekGrossMinor: int(w?.grossMinor),
      weekSaleCount: int(w?.saleCount),
    });
  }
  rows.sort((a, b) => b.saleCount - a.saleCount || b.itemCount - a.itemCount || a.name.localeCompare(b.name));
  const ranked: OnShiftRow[] = [];
  rows.forEach((r, i) => {
    const prev = ranked[i - 1];
    const tied = prev && prev.saleCount === r.saleCount && prev.itemCount === r.itemCount;
    ranked.push({ ...r, rankToday: tied ? prev.rankToday : i + 1 });
  });
  const onClockSales = ranked.reduce((a, r) => a + r.saleCount, 0);
  return {
    rows: ranked,
    offClockSaleCount: Math.max(0, totalSales - onClockSales),
    totalSalesToday: totalSales,
    leaderName: ranked[0] && ranked[0].saleCount > 0 ? ranked[0].name : null,
  };
}

// ---------------------------------------------------------------------------
// 7. Weekday x hour heatmap (when the rush really is)
// ---------------------------------------------------------------------------

export type HeatCell = {
  dow: number;
  hour: number;
  /** Mean orders in this weekday-hour across the trading days of that weekday. */
  avgOrders: number;
  avgRevenueMinor: number;
  /** 0..1 against the busiest cell (for colour). */
  intensity: number;
};

export type WeekHourHeatmap = {
  cells: HeatCell[];
  hours: number[];
  /** Trading days seen per weekday (0 = Sunday). */
  daysPerDow: number[];
  peak: { dow: number; hour: number; avgOrders: number } | null;
};

const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export function dowLabel(dow: number): string {
  return DOW_SHORT[((dow % 7) + 7) % 7];
}

function dowOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Average orders per weekday-hour over the given days. Closed days (no
 * orders) do not count toward a weekday's average. Hours drawn: every hour
 * that ever sold, widened to at least [openHour, closeHour).
 */
export function weekHourHeatmap(byDay: readonly DayIn[], byDayHour: readonly DayHourIn[], openHour = 9, closeHour = 22): WeekHourHeatmap {
  const traded = new Set(byDay.filter((d) => int(d.orders) > 0).map((d) => d.date));
  const daysPerDow = new Array<number>(7).fill(0);
  for (const d of traded) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) daysPerDow[dowOf(d)] += 1;
  const ord = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const rev = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let lo = openHour;
  let hi = closeHour - 1;
  for (const p of byDayHour) {
    if (!traded.has(p.date) || !Number.isInteger(p.hour) || p.hour < 0 || p.hour > 23) continue;
    const w = dowOf(p.date);
    ord[w][p.hour] += int(p.orders);
    rev[w][p.hour] += int(p.revenueMinorUnits);
    if (int(p.orders) > 0) {
      lo = Math.min(lo, p.hour);
      hi = Math.max(hi, p.hour);
    }
  }
  const hours: number[] = [];
  for (let h = Math.max(0, lo); h <= Math.min(23, hi); h += 1) hours.push(h);
  const cells: HeatCell[] = [];
  let max = 0;
  let peak: WeekHourHeatmap["peak"] = null;
  for (let w = 0; w < 7; w += 1) {
    for (const h of hours) {
      const n = daysPerDow[w];
      const avgOrders = n > 0 ? Math.round((ord[w][h] / n) * 10) / 10 : 0;
      const avgRevenueMinor = n > 0 ? Math.round(rev[w][h] / n) : 0;
      if (avgOrders > max) {
        max = avgOrders;
        peak = { dow: w, hour: h, avgOrders };
      }
      cells.push({ dow: w, hour: h, avgOrders, avgRevenueMinor, intensity: 0 });
    }
  }
  for (const c of cells) c.intensity = max > 0 ? Math.round((c.avgOrders / max) * 100) / 100 : 0;
  return { cells, hours, daysPerDow, peak };
}

// ---------------------------------------------------------------------------
// 8. Axis money: compact dollars from cents ($950, $1.2k, $14k, $1.1M)
// ---------------------------------------------------------------------------

export function compactMoney(minor: number): string {
  if (!Number.isFinite(minor)) return "$0";
  const neg = minor < 0;
  const d = Math.abs(minor) / 100;
  let s: string;
  if (d >= 1_000_000) s = `${(Math.round(d / 100_000) / 10).toString()}M`;
  else if (d >= 10_000) s = `${Math.round(d / 1000)}k`;
  else if (d >= 1000) s = `${(Math.round(d / 100) / 10).toString()}k`;
  else s = `${Math.round(d)}`;
  return `${neg ? "-" : ""}$${s}`;
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runCockpitAnalyticsTests(): { passed: number; failed: number; messages: string[] } {
  let passed = 0;
  let failed = 0;
  const messages: string[] = [];
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      messages.push(label);
    }
  };

  // ── resolveBaselineDays ──
  const days: DayIn[] = [
    { date: "2026-11-06", revenueMinorUnits: 50_000, orders: 10, units: 20 },
    { date: "2026-10-30", revenueMinorUnits: 0, orders: 0, units: 0 }, // closed
    { date: "2026-10-23", revenueMinorUnits: 90_000, orders: 18, units: 30 },
    { date: "2026-10-16", revenueMinorUnits: 70_000, orders: 14, units: 25 },
  ];
  const win = ["2026-11-06", "2026-10-30", "2026-10-23", "2026-10-16"];
  const avgB = resolveBaselineDays(win, "average", days);
  ok(avgB.days.length === 3, "average drops the closed day");
  ok(avgB.partial === true && avgB.requested === 4, "average is flagged partial");
  const maxB = resolveBaselineDays(win, "max", days);
  ok(maxB.bestDay === "2026-10-23" && maxB.days.length === 1, "max picks the best whole day");
  const singleClosed = resolveBaselineDays(["2026-10-30"], "single", days);
  ok(singleClosed.days.length === 0 && singleClosed.partial, "a closed single day is no baseline, not zero");
  const singleOpen = resolveBaselineDays(["2026-11-06"], "single", days);
  ok(singleOpen.days[0] === "2026-11-06" && !singleOpen.partial, "an open single day is used");
  ok(resolveBaselineDays([], "average", days).days.length === 0, "no window, no baseline");

  // ── hourlyVsBaseline ──
  const dh: DayHourIn[] = [
    { date: "2026-11-06", hour: 10, revenueMinorUnits: 10_000, orders: 2 },
    { date: "2026-11-06", hour: 11, revenueMinorUnits: 20_000, orders: 4 },
    { date: "2026-11-06", hour: 12, revenueMinorUnits: 20_000, orders: 4 },
    { date: "2026-10-23", hour: 10, revenueMinorUnits: 30_000, orders: 6 },
    { date: "2026-10-23", hour: 12, revenueMinorUnits: 60_000, orders: 12 },
    { date: "2026-10-30", hour: 10, revenueMinorUnits: 99_999, orders: 0 }, // closed day's stray row ignored
  ];
  const todayHours: HourPointIn[] = [
    { hour: 10, revenueMinorUnits: 12_000, orders: 3 },
    { hour: 11, revenueMinorUnits: 6_000, orders: 1 },
  ];
  const single = hourlyVsBaseline({
    todayByHour: todayHours,
    baselineByDay: days,
    baselineByDayHour: dh,
    windowDays: ["2026-11-06"],
    mode: "single",
    nowHour: 11,
    nowMinute: 30,
  });
  const r10 = single.rows.find((r) => r.hour === 10)!;
  const r11 = single.rows.find((r) => r.hour === 11)!;
  const r12 = single.rows.find((r) => r.hour === 12)!;
  ok(r10.baselineMinor === 10_000 && r10.todayMinor === 12_000, "single: hour 10 today vs basis");
  ok(single.baselineSoFarMinor === 10_000 + 10_000, "basis so far = full 10 AM + half of 11 AM");
  ok(single.todaySoFarMinor === 18_000, "today so far");
  ok(single.pace !== null && Math.abs(single.pace - 0.9) < 1e-9, "pace 18k / 20k = 0.9");
  ok(single.baselineDayMinor === 50_000 && single.projectedDayMinor === 45_000, "projection = 50k x 0.9");
  ok(r12.isFuture && r12.todayCumMinor === null, "future hours have no actual cumulative");
  ok(r11.isNow && r11.todayCumMinor === 18_000, "the current hour carries today's running total");
  ok(r12.projectedCumMinor === 18_000 + Math.round((50_000 - 20_000) * 0.9), "projection line ends at the projected day");
  ok(r11.projectedCumMinor !== null && r11.projectedCumMinor >= 18_000, "projection starts at the current hour");
  ok(single.rows[0].hour === 8 && single.rows[single.rows.length - 1].hour === 23, "draws 8 AM to 11 PM");
  ok(single.baselinePeakHour === 11, "basis rush hour (first of the ties)");

  const avg = hourlyVsBaseline({
    todayByHour: todayHours,
    baselineByDay: days,
    baselineByDayHour: dh,
    windowDays: win,
    mode: "average",
    nowHour: 11,
    nowMinute: 0,
  });
  ok(avg.baseline.days.length === 3, "average uses the 3 trading days");
  // hour 10: (10k + 30k + 0) / 3 = 13,333
  ok(avg.rows.find((r) => r.hour === 10)!.baselineMinor === 13_333, "average per hour counts a trading day's empty hour as 0");
  ok(avg.rows.find((r) => r.hour === 10)!.baselineOrders === Math.round((8 / 3) * 10) / 10, "average orders per hour");
  const none = hourlyVsBaseline({
    todayByHour: todayHours,
    baselineByDay: days,
    baselineByDayHour: dh,
    windowDays: ["2026-10-30"],
    mode: "single",
    nowHour: 11,
    nowMinute: 0,
  });
  ok(none.pace === null && none.projectedDayMinor === null, "no baseline: no pace, no projection");
  ok(none.rows.every((r) => r.baselineMinor === null), "no baseline: every hour says so (null, not 0)");
  const late = hourlyVsBaseline({
    todayByHour: [{ hour: 2, revenueMinorUnits: 100, orders: 1 }],
    baselineByDay: [],
    baselineByDayHour: [],
    windowDays: [],
    mode: "single",
    nowHour: 3,
    nowMinute: 0,
  });
  ok(late.rows[0].hour === 2, "window widens to an early sale");

  // ── laborByHour ──
  const day = "2026-11-07";
  const at = (h: number, m = 0) => pacificWallTimeToUtcISO(day, { h, m, s: 0, ms: 0 });
  const punches: PunchIn[] = [
    { employeeId: "a", kind: "work", clockInIso: at(9, 30), clockOutIso: at(12) },
    { employeeId: "a", kind: "break", clockInIso: at(10, 0), clockOutIso: at(10, 15) },
    { employeeId: "b", kind: "work", clockInIso: at(10), clockOutIso: null },
  ];
  const lab = laborByHour(punches, day, at(11, 30));
  const L = (h: number) => lab.find((l) => l.hour === h)!;
  ok(L(9).staffMinutes === 30 && L(9).headcount === 1, "9 AM: half an hour, one person");
  ok(L(10).staffMinutes === 45 + 60 && L(10).headcount === 2, "10 AM: break taken out, two people");
  ok(L(11).staffMinutes === 30 + 30, "11 AM: open punch runs only to now");
  ok(L(12).staffMinutes === 0 && L(12).headcount === 0, "nothing after now is counted");
  ok(lab.length === 24, "24 hours");
  ok(laborByHour([{ employeeId: "x", kind: "work", clockInIso: "garbage", clockOutIso: null }], day, at(12)).every((l) => l.staffMinutes === 0), "a bad timestamp is ignored");

  // ── trafficVsLabor ──
  const tl = trafficVsLabor({ hourly: single, labor: lab });
  const t10 = tl.rows.find((r) => r.hour === 10)!;
  ok(t10.laborHours === 1.8 && t10.headcount === 2, "labor hours to 1 decimal");
  ok(t10.splhMinor === Math.round(12_000 / (105 / 60)), "SPLH for the hour");
  ok(t10.ordersPerLaborHour === Math.round((3 / (105 / 60)) * 10) / 10, "orders per labor hour");
  ok(tl.totalLaborHours === Math.round(((30 + 105 + 60) / 60) * 10) / 10, "total labor hours so far");
  ok(tl.splhMinor === Math.round(18_000 / (195 / 60)), "SPLH today");
  ok(tl.mostStretchedHour === 10, "most stretched hour");
  ok(!tl.noLabor, "labor present");
  ok(trafficVsLabor({ hourly: single, labor: laborByHour([], day, at(12)) }).noLabor, "no punches is said");
  ok(t10.baselineOrders === 2, "basis orders carried for staffing");
  const idleLab = laborByHour([{ employeeId: "c", kind: "work", clockInIso: at(8), clockOutIso: at(9, 30) }], day, at(11, 30));
  ok(trafficVsLabor({ hourly: single, labor: idleLab }).idleStaffedHours.includes(8), "staffed hour with no orders is idle");

  // ── categoryMixVsBaseline ──
  const dct: DayCategoryTypeIn[] = [
    { date: "2026-11-06", category: "Flower", type: "Indica", revenueMinorUnits: 30_000, units: 10 },
    { date: "2026-11-06", category: "Flower", type: "Sativa", revenueMinorUnits: 10_000, units: 4 },
    { date: "2026-11-06", category: "Edible", type: "Gummies", revenueMinorUnits: 10_000, units: 5 },
    { date: "2026-10-30", category: "Vape", type: "Cart", revenueMinorUnits: 5_000, units: 1 }, // closed day ignored
  ];
  const mix = categoryMixVsBaseline({
    today: [
      { category: "Flower", revenueMinorUnits: 20_000, units: 6, types: [{ label: "Indica", revenueMinorUnits: 20_000, units: 6 }] },
      { category: "Edible", revenueMinorUnits: 20_000, units: 9, types: [{ label: "Gummies", revenueMinorUnits: 20_000, units: 9 }] },
    ],
    baselineByDay: days,
    baselineByDayCategoryType: dct,
    windowDays: ["2026-11-06"],
    mode: "single",
  });
  const flower = mix.categories.find((c) => c.category === "Flower")!;
  const edible = mix.categories.find((c) => c.category === "Edible")!;
  ok(mix.todayTotalMinor === 40_000 && mix.baselineTotalMinor === 50_000, "totals");
  ok(flower.baselineMinor === 40_000 && flower.todayShare === 0.5 && flower.baselineShare === 0.8, "flower shares");
  ok(flower.shareDeltaPts === -30 && edible.shareDeltaPts === 30, "share change in points");
  ok(flower.revenueDeltaPct === -50 && edible.revenueDeltaPct === 100, "revenue change %");
  ok(mix.topGainer === "Edible" && mix.topLoser === "Flower", "gainer and loser");
  ok(flower.types.some((t) => t.type === "Sativa" && t.todayMinor === 0 && t.baselineMinor === 10_000), "a type sold only on the basis still shows");
  ok(!mix.categories.some((c) => c.category === "Vape"), "a closed day's rows never leak in");
  ok(flower.types[0].type === "Indica" && flower.types[0].shareOfCategory === 1, "type share of category");
  const mixNone = categoryMixVsBaseline({ today: [], baselineByDay: [], baselineByDayCategoryType: [], windowDays: ["2026-11-06"], mode: "single" });
  ok(mixNone.baselineTotalMinor === null && mixNone.categories.length === 0, "nothing to compare");

  // ── foldTail ──
  const folded = foldTail(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => ({ name: `c${v}`, value: v })),
    3,
  );
  ok(folded.length === 4 && folded[3].name === "Other" && folded[3].value === 21, "tail folds into Other");
  ok(foldTail([{ name: "a", value: 1 }, { name: "b", value: 0 }], 3).length === 1, "zero slices dropped");
  ok(foldTail([1, 2, 3, 4].map((v) => ({ name: `c${v}`, value: v })), 3).length === 4, "no Other for one extra slice");

  // ── dailyTrend ──
  const hist: DayIn[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const d = `2026-11-${String(i).padStart(2, "0")}`;
    hist.push({ date: d, revenueMinorUnits: i === 5 ? 0 : i * 1000, orders: i === 5 ? 0 : i, units: i === 5 ? 0 : i * 2 });
  }
  const tr = dailyTrend(hist, { date: "x", revenueMinorUnits: 500, orders: 1, units: 3 }, "2026-11-11", 7);
  ok(tr.rows.length === 11 && tr.rows[10].isToday, "today is last and flagged");
  ok(tr.rows[4].revenueMinor === null && tr.rows[4].maRevenueMinor === null, "closed day is null, not $0");
  ok(tr.tradingDays === 9, "nine trading days");
  ok(tr.bestDay?.date === "2026-11-10", "best day");
  ok(tr.rows[1].maRevenueMinor === null && tr.rows[2].maRevenueMinor === 2000, "MA needs 3 trading days");
  // last 7 trading days through 11-10: 3,4,6,7,8,9,10 -> 47000/7
  ok(tr.rows[9].maRevenueMinor === Math.round(47_000 / 7), "7-day MA skips the closed day");
  ok(tr.rows[10].maRevenueMinor === null && tr.rows[10].revenueMinor === 500, "partial today has no MA");
  ok(tr.rows[9].avgOrderMinor === 1000 && tr.rows[9].unitsPerOrder === 2, "basket per day");
  ok(tr.avgDayMinor === Math.round(50_000 / 9), "average trading day excludes today");

  // ── onShiftBoard ──
  const now = "2026-11-07T20:00:00.000Z";
  const board = onShiftBoard({
    onClock: [
      { employeeId: "a", name: "Ava", role: "sales", clockInIso: "2026-11-07T16:00:00.000Z" },
      { employeeId: "b", name: "Ben", role: "lead", clockInIso: "2026-11-07T19:50:00.000Z" },
      { employeeId: "c", name: "Cy", role: "sales", clockInIso: "2026-11-07T18:00:00.000Z" },
      { employeeId: "a", name: "Ava", role: "sales", clockInIso: "2026-11-07T16:00:00.000Z" },
    ],
    today: [
      { employeeId: "a", saleCount: 12, itemCount: 30, grossMinor: 99_999 },
      { employeeId: "c", saleCount: 12, itemCount: 30, grossMinor: 1 },
      { employeeId: "z", saleCount: 6, itemCount: 7, grossMinor: 5 },
    ],
    week: [{ employeeId: "a", saleCount: 80, itemCount: 200, grossMinor: 400_000 }],
    nowIso: now,
  });
  ok(board.rows.length === 3, "duplicate punches collapse to one row");
  ok(board.rows[0].name === "Ava" && board.rows[1].name === "Cy" && board.rows[0].rankToday === 1 && board.rows[1].rankToday === 1, "ties share a rank");
  ok(board.rows[2].rankToday === 3 && board.rows[2].saleCount === 0, "competition rank skips");
  ok(board.rows[0].salesPerHour === 3 && board.rows[0].itemsPerSale === 2.5, "per-hour and basket");
  ok(board.rows[2].salesPerHour === null, "under 15 minutes: no rate");
  ok(board.offClockSaleCount === 6 && board.totalSalesToday === 30, "off-clock sales counted, not named");
  ok(board.rows[0].weekGrossMinor === 400_000, "week dollars allowed");
  ok(!JSON.stringify(board).includes("99999"), "today's per-person dollars never leave the core");
  ok(board.leaderName === "Ava", "leader");
  ok(Math.abs(board.rows[0].shareOfSales - 0.4) < 1e-9, "share of sales");

  // ── weekHourHeatmap ──
  const hmDays: DayIn[] = [
    { date: "2026-11-02", revenueMinorUnits: 1000, orders: 4, units: 4 }, // Mon
    { date: "2026-10-26", revenueMinorUnits: 1000, orders: 2, units: 2 }, // Mon
    { date: "2026-11-03", revenueMinorUnits: 0, orders: 0, units: 0 }, // Tue closed
  ];
  const hmHours: DayHourIn[] = [
    { date: "2026-11-02", hour: 16, revenueMinorUnits: 800, orders: 3 },
    { date: "2026-11-02", hour: 10, revenueMinorUnits: 200, orders: 1 },
    { date: "2026-10-26", hour: 16, revenueMinorUnits: 400, orders: 1 },
    { date: "2026-10-26", hour: 23, revenueMinorUnits: 600, orders: 1 },
    { date: "2026-11-03", hour: 12, revenueMinorUnits: 999, orders: 9 }, // closed day ignored
  ];
  const hm = weekHourHeatmap(hmDays, hmHours);
  ok(hm.daysPerDow[1] === 2 && hm.daysPerDow[2] === 0, "heatmap counts trading days per weekday");
  const mon16 = hm.cells.find((c) => c.dow === 1 && c.hour === 16)!;
  ok(mon16.avgOrders === 2 && mon16.avgRevenueMinor === 600, "heatmap averages over trading days");
  ok(mon16.intensity === 1 && hm.peak?.dow === 1 && hm.peak.hour === 16, "heatmap peak is the busiest cell");
  ok(hm.hours[0] === 9 && hm.hours[hm.hours.length - 1] === 23, "heatmap widens to a late sale");
  ok(hm.cells.find((c) => c.dow === 2 && c.hour === 12)!.avgOrders === 0, "a closed day adds nothing");
  ok(dowLabel(0) === "Sun" && dowLabel(6) === "Sat", "weekday labels");

  ok(compactMoney(95_000) === "$950" && compactMoney(123_400) === "$1.2k", "compact money small");
  ok(compactMoney(1_440_000) === "$14k" && compactMoney(110_000_000) === "$1.1M", "compact money large");
  ok(compactMoney(-50_000) === "-$500" && compactMoney(Number.NaN) === "$0", "compact money sign and junk");

  return { passed, failed, messages };
}
