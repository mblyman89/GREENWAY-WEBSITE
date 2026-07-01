/**
 * cockpit-data.ts (Slice 64) — server aggregator for the POS dashboard cockpit.
 *
 * Assembles a single, real-data snapshot from EXISTING helpers:
 *   - today vs yesterday sales (getSalesReport over Pacific-day boundaries)
 *   - open orders by status (getOrderStatusCounts + ACTIVE_ORDER_STATUSES)
 *   - live registers + drawers (liveRegisters)
 *   - low-stock count (buildReorderSuggestions, onlyNeeded)
 *   - live menu size (getPublishedVersion) + loyalty signups (countLoyaltySignups)
 *
 * Nothing is fabricated; every number traces to a real query. Degrades
 * gracefully to zeros when Supabase isn't configured. No migration.
 */
import "server-only";

import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { safeData } from "@/lib/safe-data";
import { getSalesReport, EMPTY_SALES_REPORT, type SalesReport } from "@/lib/reports/sales";
import { getOrderStatusCounts } from "@/lib/orders/orders-store";
import { ACTIVE_ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/orders/types";
import { liveRegisters, type RegisterLive } from "@/lib/registers/store";
import { buildReorderSuggestions } from "@/lib/purchasing/po-store";
import { getPublishedVersion, listImports } from "@/lib/pos/menu-version";
import { countLoyaltySignups } from "@/lib/loyalty/store";
import {
  pacificToday,
  addPacificDays,
  pacificWallTimeToUtcISO,
} from "@/lib/reports/timezone";
import {
  computeDelta,
  rollupDrawers,
  type Delta,
  type DrawerRollup,
} from "@/lib/admin/cockpit-core";

export type OrderBoardRow = { status: OrderStatus; label: string; count: number };

export type CockpitSnapshot = {
  configured: boolean;
  today: SalesReport;
  yesterday: SalesReport;
  deltas: {
    revenue: Delta;
    orders: Delta;
    units: Delta;
    avgOrder: Delta;
  };
  activeOrders: number;
  orderBoard: OrderBoardRow[];
  registers: RegisterLive[];
  drawers: DrawerRollup;
  lowStockCount: number;
  publishedItems: number | null;
  lastImportISO: string | null;
  loyaltySignups: number;
};

function emptySnapshot(): CockpitSnapshot {
  const zeroDelta: Delta = { change: 0, pct: 0, direction: "flat", isNew: false };
  return {
    configured: false,
    today: EMPTY_SALES_REPORT,
    yesterday: EMPTY_SALES_REPORT,
    deltas: { revenue: zeroDelta, orders: zeroDelta, units: zeroDelta, avgOrder: zeroDelta },
    activeOrders: 0,
    orderBoard: [],
    registers: [],
    drawers: {
      openCount: 0,
      closedUnverifiedCount: 0,
      verifiedCount: 0,
      totalVarianceMinor: 0,
      needsAttention: 0,
    },
    lowStockCount: 0,
    publishedItems: null,
    lastImportISO: null,
    loyaltySignups: 0,
  };
}

export async function getCockpitSnapshot(): Promise<CockpitSnapshot> {
  if (!isSupabaseServiceConfigured) return emptySnapshot();

  const todayYmd = pacificToday();
  const yestYmd = addPacificDays(todayYmd, -1);
  const todayStart = pacificWallTimeToUtcISO(todayYmd, "start");
  const nowISO = new Date().toISOString();
  const yestStart = pacificWallTimeToUtcISO(yestYmd, "start");
  const yestEnd = pacificWallTimeToUtcISO(yestYmd, "end");

  const [
    today,
    yesterday,
    statusCounts,
    registers,
    reorder,
    published,
    imports,
    loyaltySignups,
  ] = await Promise.all([
    safeData(() => getSalesReport(todayStart, nowISO), EMPTY_SALES_REPORT).then((r) => r.data),
    safeData(() => getSalesReport(yestStart, yestEnd), EMPTY_SALES_REPORT).then((r) => r.data),
    safeData(
      () => getOrderStatusCounts(),
      {} as Record<OrderStatus, number>,
    ).then((r) => r.data),
    safeData(() => liveRegisters(), [] as RegisterLive[]).then((r) => r.data),
    safeData(
      () => buildReorderSuggestions({ onlyNeeded: true }),
      [] as Awaited<ReturnType<typeof buildReorderSuggestions>>,
    ).then((r) => r.data),
    safeData(() => getPublishedVersion(), null).then((r) => r.data),
    safeData(() => listImports(1), [] as Awaited<ReturnType<typeof listImports>>).then((r) => r.data),
    safeData(() => countLoyaltySignups(), 0).then((r) => r.data),
  ]);

  const orderBoard: OrderBoardRow[] = ACTIVE_ORDER_STATUSES.map((s) => ({
    status: s,
    label: ORDER_STATUS_LABELS[s],
    count: statusCounts[s] ?? 0,
  }));
  const activeOrders = orderBoard.reduce((sum, r) => sum + r.count, 0);

  const drawers = rollupDrawers(
    registers
      .filter((r) => r.openSession)
      .map((r) => ({
        status: r.openSession!.status,
        over_short_minor: r.openSession!.over_short_minor,
      })),
  );

  // Low stock = suggestions whose result is below the reorder point.
  const lowStockCount = reorder.filter((s) => s.result.belowReorderPoint).length;

  return {
    configured: true,
    today,
    yesterday,
    deltas: {
      revenue: computeDelta(today.totalRevenueMinorUnits, yesterday.totalRevenueMinorUnits),
      orders: computeDelta(today.totalOrders, yesterday.totalOrders),
      units: computeDelta(today.totalUnits, yesterday.totalUnits),
      avgOrder: computeDelta(today.avgOrderMinorUnits, yesterday.avgOrderMinorUnits),
    },
    activeOrders,
    orderBoard,
    registers,
    drawers,
    lowStockCount,
    publishedItems: published?.item_count ?? null,
    lastImportISO: imports[0]?.created_at ?? null,
    loyaltySignups,
  };
}
