/**
 * src/lib/admin/cockpit-analytics-server.ts  (D209, server-only)
 *
 * The reads behind the cockpit v2 visual sections on /admin. DISPLAY ONLY:
 * nothing here feeds a register, a report total, a filing or a write.
 *
 *   cockpitLabor()      today's time punches + who is on the clock now
 *   cockpitSellers()    trailing-7-day processed POS sales, per employee
 *   cockpitTrend()      the last 28 finished days (finished-day cache)
 *   cockpitAtm()        settlements, loads and PAI's latest status
 *
 * Every database call selects explicit columns, reads its error and THROWS
 * on one (rule 15), so the shared cache never stores a failed read and the
 * section shows "unavailable" through safeData instead of a quiet zero. Long
 * lists are paged with a stable unique order (pagedAll). Each part is wrapped
 * in React cache() so sections that share a part share one read per request.
 *
 * What is cached is the raw-ish input (punches, per-employee totals); anything
 * that depends on "now" (minutes on the clock, open punches running to now,
 * the ATM's share of today still to come) is computed per request by the
 * pure cores, so a 30-second-old cache entry never freezes the clock.
 */
import "server-only";

import { cache } from "react";

import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pagedAll } from "@/lib/supabase/chunked-in";
import { safeData } from "@/lib/safe-data";
import { addPacificDays, pacificDayKey, pacificParts, pacificToday, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";
import { EMPTY_SALES_REPORT, type SalesReport } from "@/lib/reports/sales";
import { aggregateLeaderboard, type LeaderboardEventRow } from "@/lib/pos/leaderboard-core";
import { cockpitCached, cockpitSalesDays } from "@/lib/admin/cockpit-cache-server";
import { COCKPIT_TODAY_TTL_S } from "@/lib/admin/cockpit-cache-core";
import { laborByHour, onShiftBoard, type LaborHour, type OnClockIn, type OnShiftBoard, type PunchIn, type SellerTotalsIn } from "@/lib/admin/cockpit-analytics-core";
import { getAtmConnection, getLatestAtmTerminalStatus, listAtmCashLoads, listAtmSettlements } from "@/lib/atm/store";
import { buildCashLoadsView } from "@/lib/atm/atm-ui-core";
import { buildTerminalStatusView } from "@/lib/atm/terminal-status-core";
import {
  dispenseDays,
  dispenseHistory,
  dispenseStats,
  forecastDepletion,
  shareOfDayRemaining,
  type DepletionForecast,
  type DispenseHistoryRow,
  type DispenseStats,
} from "@/lib/atm/atm-forecast-core";

const PAGE = 1000;

// ---------------------------------------------------------------------------
// Labor: today's punches and the people on the clock
// ---------------------------------------------------------------------------

type PunchDbRow = {
  id: string;
  employee_id: string;
  punch_kind: string;
  clock_in_at: string;
  clock_out_at: string | null;
};

type EmployeeDbRow = { id: string; full_name: string; job_role: string };

export type LaborRaw = {
  punches: PunchIn[];
  /** Open WORK punches (on the clock now), with names. */
  onClock: OnClockIn[];
};

async function employeeNames(ids: string[]): Promise<Map<string, EmployeeDbRow>> {
  const out = new Map<string, EmployeeDbRow>();
  if (ids.length === 0) return out;
  const admin = createSupabaseAdminClient();
  // One page per 200 ids keeps the query string short.
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await admin.from("employees").select("id, full_name, job_role").in("id", chunk);
    if (error) throw new Error(`Could not read employee names: ${error.message}`);
    for (const e of (data as EmployeeDbRow[] | null) ?? []) out.set(e.id, e);
  }
  return out;
}

async function readLabor(todayYmd: string): Promise<LaborRaw> {
  const admin = createSupabaseAdminClient();
  // A punch that STARTED up to 12 hours before Pacific midnight can still be
  // running into today (a late close); anything starting later than the end
  // of today cannot touch it. laborByHour clips each punch to the day.
  const from = new Date(Date.parse(pacificWallTimeToUtcISO(todayYmd, "start")) - 12 * 3_600_000).toISOString();
  const to = pacificWallTimeToUtcISO(todayYmd, "end");
  const rows = await pagedAll<PunchDbRow>(async (a, b) => {
    const { data, error } = await admin
      .from("time_punches")
      .select("id, employee_id, punch_kind, clock_in_at, clock_out_at")
      .gte("clock_in_at", from)
      .lte("clock_in_at", to)
      .order("id", { ascending: true })
      .range(a, b);
    if (error) throw new Error(`Could not read today's time punches: ${error.message}`);
    return (data as PunchDbRow[] | null) ?? [];
  }, { pageSize: PAGE });

  const punches: PunchIn[] = rows.map((r) => ({
    employeeId: r.employee_id,
    kind: r.punch_kind,
    clockInIso: r.clock_in_at,
    clockOutIso: r.clock_out_at,
  }));

  // On the clock = an open WORK punch. Earliest open work punch per person.
  const openWork = new Map<string, string>();
  for (const r of rows) {
    if (r.punch_kind !== "work" || r.clock_out_at !== null) continue;
    const cur = openWork.get(r.employee_id);
    if (!cur || r.clock_in_at < cur) openWork.set(r.employee_id, r.clock_in_at);
  }
  const names = await employeeNames([...openWork.keys()]);
  const onClock: OnClockIn[] = [...openWork.entries()].map(([employeeId, clockInIso]) => ({
    employeeId,
    name: names.get(employeeId)?.full_name ?? "Unknown",
    role: names.get(employeeId)?.job_role ?? "",
    clockInIso,
  }));
  return { punches, onClock };
}

const cachedLabor = cockpitCached("labor-today", COCKPIT_TODAY_TTL_S, readLabor);

export type CockpitLabor = {
  ok: boolean;
  labor: LaborHour[];
  onClock: OnClockIn[];
  nowIso: string;
};

/** Labor by Pacific hour today, plus who is on the clock now. */
export const cockpitLabor = cache(async (): Promise<CockpitLabor> => {
  const todayYmd = pacificToday();
  const nowIso = new Date().toISOString();
  if (!isSupabaseServiceConfigured) {
    return { ok: true, labor: laborByHour([], todayYmd, nowIso), onClock: [], nowIso };
  }
  const r = await safeData(() => cachedLabor(todayYmd), { punches: [], onClock: [] } as LaborRaw);
  return { ok: r.ok, labor: laborByHour(r.data.punches, todayYmd, nowIso), onClock: r.data.onClock, nowIso };
});

// ---------------------------------------------------------------------------
// Sellers: trailing 7 days of processed POS sales, per employee
// ---------------------------------------------------------------------------

type SaleEventDbRow = {
  id: string;
  employee_id: string | null;
  event_type: string;
  status: string;
  payload: unknown;
  occurred_at: string;
};

export type SellersRaw = { today: SellerTotalsIn[]; week: SellerTotalsIn[] };

async function readSellers(todayYmd: string): Promise<SellersRaw> {
  const admin = createSupabaseAdminClient();
  const from = pacificWallTimeToUtcISO(addPacificDays(todayYmd, -6), "start");
  const to = pacificWallTimeToUtcISO(todayYmd, "end");
  const rows = await pagedAll<SaleEventDbRow>(async (a, b) => {
    const { data, error } = await admin
      .from("pos_sale_events")
      .select("id, employee_id, event_type, status, payload, occurred_at")
      .eq("event_type", "sale")
      .eq("status", "processed")
      .gte("occurred_at", from)
      .lte("occurred_at", to)
      .order("id", { ascending: true })
      .range(a, b);
    if (error) throw new Error(`Could not read the week's POS sales: ${error.message}`);
    return (data as SaleEventDbRow[] | null) ?? [];
  }, { pageSize: PAGE });
  const events: LeaderboardEventRow[] = rows.map((r) => ({
    employeeId: r.employee_id ?? "",
    eventType: r.event_type,
    status: r.status,
    payload: r.payload,
    dayKey: pacificDayKey(r.occurred_at),
  }));
  // Only the per-employee totals are cached (plain JSON, small).
  return aggregateLeaderboard(events, todayYmd);
}

const cachedSellers = cockpitCached("sellers-7d", COCKPIT_TODAY_TTL_S, readSellers);

export type CockpitOnShift = {
  ok: boolean;
  board: OnShiftBoard;
};

/**
 * Who on the clock is selling. TODAY is counts and items only (B34 blind
 * count); the 7-day gross spans finished, reconciled days.
 */
export const cockpitOnShift = cache(async (): Promise<CockpitOnShift> => {
  const todayYmd = pacificToday();
  const [labor, sellers] = await Promise.all([
    cockpitLabor(),
    isSupabaseServiceConfigured
      ? safeData(() => cachedSellers(todayYmd), { today: [], week: [] } as SellersRaw)
      : Promise.resolve({ ok: true, data: { today: [], week: [] } as SellersRaw, error: null }),
  ]);
  return {
    ok: labor.ok && sellers.ok,
    board: onShiftBoard({ onClock: labor.onClock, today: sellers.data.today, week: sellers.data.week, nowIso: labor.nowIso }),
  };
});

// ---------------------------------------------------------------------------
// Trend: the last 28 finished days
// ---------------------------------------------------------------------------

export type CockpitTrend = { ok: boolean; history: SalesReport; fromYmd: string; toYmd: string };

/** The last 28 finished Pacific days (shared 10 minutes, display only). */
export const cockpitTrend = cache(async (): Promise<CockpitTrend> => {
  const todayYmd = pacificToday();
  const fromYmd = addPacificDays(todayYmd, -28);
  const toYmd = addPacificDays(todayYmd, -1);
  if (!isSupabaseServiceConfigured) return { ok: true, history: EMPTY_SALES_REPORT, fromYmd, toYmd };
  const r = await safeData(() => cockpitSalesDays(fromYmd, toYmd), EMPTY_SALES_REPORT);
  return { ok: r.ok, history: r.data, fromYmd, toYmd };
});

// ---------------------------------------------------------------------------
// ATM: throughput and the run-empty forecast
// ---------------------------------------------------------------------------

export type CockpitAtm = {
  configured: boolean;
  terminalId: string | null;
  stats: DispenseStats;
  history: DispenseHistoryRow[];
  forecast: DepletionForecast;
  currentCashCents: number | null;
  currentCashSource: "live" | "estimate" | "unknown";
  capturedAt: string | null;
  /** PAI's own figure, shown beside ours (never blended). */
  paiDaysUntilCashOut: number | null;
  /** Estimate path only: load-day withdrawals not split out (high estimate). */
  sameDayLoadCaveat: boolean;
  dispensedThroughDate: string | null;
};

/**
 * The ATM store's readers swallow their own errors and return empty (they
 * predate rule 15); an empty read therefore shows as "not enough data", never
 * as a made-up balance. The forecast says which balance it started from.
 */
export const cockpitAtm = cache(async (): Promise<CockpitAtm> => {
  const todayYmd = pacificToday();
  const [conn, settlements, loads] = await Promise.all([
    safeData(() => getAtmConnection(), null),
    safeData(() => listAtmSettlements(120), [] as Awaited<ReturnType<typeof listAtmSettlements>>),
    safeData(() => listAtmCashLoads(60), [] as Awaited<ReturnType<typeof listAtmCashLoads>>),
  ]);
  const terminalId = conn.data?.terminalId?.trim() || null;
  const live = (await safeData(() => getLatestAtmTerminalStatus(terminalId), null)).data;

  const days = dispenseDays(settlements.data, terminalId);
  const stats = dispenseStats(days, todayYmd);
  const history = dispenseHistory(days, todayYmd, 30);
  const loadsView = buildCashLoadsView(loads.data, settlements.data);
  const status = buildTerminalStatusView(
    live
      ? {
          terminalId: live.terminalId,
          location: live.location,
          groupName: live.groupName,
          status: live.status,
          daysUntilCashOut: live.daysUntilCashOut,
          lastTrxRaw: live.lastTrxRaw,
          lastWithdrawalTrxRaw: live.lastWdTrxRaw,
          lastReversalTrxRaw: live.lastRevTrxRaw,
          trxsSinceSettlement: live.trxsSinceSettlement,
          balancePrevEodCents: live.balancePrevEodCents,
          balanceCents: live.balanceCents,
          raw: {},
        }
      : null,
    { capturedAt: live?.capturedAt ?? null, estimateCents: loadsView.currentInMachineCents },
  );

  // Where the walk starts. Live: the reading's own Pacific day, and only the
  // share of that day still to trade, taken from the store's OWN 28-day
  // hour-by-hour sales profile (no assumed opening hours). Estimate: the day
  // after the last settled day, in full.
  let startDate = todayYmd;
  let firstDayFraction = 1;
  if (status.currentCashSource === "live" && status.capturedAt) {
    startDate = pacificDayKey(status.capturedAt);
    const p = pacificParts(status.capturedAt);
    firstDayFraction = shareOfDayRemaining((await cockpitTrend()).history.byHour, p.hour, p.minute);
  } else if (status.currentCashSource === "estimate" && loadsView.dispensedThroughDate) {
    startDate = addPacificDays(loadsView.dispensedThroughDate, 1);
  }
  const forecast = forecastDepletion({
    balanceCents: status.currentCashCents,
    source: status.currentCashSource,
    startDate,
    todayYmd,
    stats,
    firstDayFraction,
  });
  return {
    configured: Boolean(conn.data && conn.data.status !== "unconfigured") || days.length > 0,
    terminalId,
    stats,
    history,
    forecast,
    currentCashCents: status.currentCashCents,
    currentCashSource: status.currentCashSource,
    capturedAt: status.capturedAt,
    paiDaysUntilCashOut: status.daysUntilCashOut,
    sameDayLoadCaveat: status.currentCashSource === "estimate" && loadsView.sameDayLoadCaveat,
    dispensedThroughDate: loadsView.dispensedThroughDate,
  };
});

/** Exposed for the D209 test: the cached readers' names (keys carry no instants). */
export const COCKPIT_ANALYTICS_CACHE_NAMES = ["labor-today", "sellers-7d"] as const;
