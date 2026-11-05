/**
 * cockpit-data.ts (Slice 64) — server aggregator for the POS dashboard cockpit.
 *
 * Assembles a single, real-data snapshot from EXISTING helpers:
 *   - today vs yesterday sales (getSalesReport over Pacific-day boundaries)
 *   - open orders by status (getOrdersBoardSnapshot + ACTIVE_ORDER_STATUSES)
 *   - live registers + drawers (liveRegisters)
 *   - low-stock count (buildReorderSuggestions, onlyNeeded)
 *   - live menu size (getPublishedVersion) + loyalty signups (getLoyaltyStatusCounts)
 *
 * Nothing is fabricated; every number traces to a real query. Degrades
 * gracefully to zeros when Supabase isn't configured. No migration.
 */
import "server-only";

import { cache } from "react";

import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { safeData } from "@/lib/safe-data";
import { EMPTY_SALES_REPORT, type SalesReport } from "@/lib/reports/sales";
import { getOrdersBoardSnapshot } from "@/lib/orders/orders-store";
import { ACTIVE_ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/orders/types";
import { liveRegisters, type RegisterLive } from "@/lib/registers/store";
import {
  cockpitLowStockCount,
  cockpitReturnsToday,
  cockpitSalesDays,
  cockpitSalesToday,
} from "@/lib/admin/cockpit-cache-server";
import { getPublishedVersion, listImports } from "@/lib/pos/menu-version";
import { getLoyaltyStatusCounts } from "@/lib/loyalty/signups-store";
import { pacificToday, addPacificDays } from "@/lib/reports/timezone";
import {
  computeDelta,
  rollupDrawers,
  type Delta,
  type DrawerRollup,
} from "@/lib/admin/cockpit-core";
import {
  parseComparisonBasis,
  DEFAULT_BASIS,
  comparisonWindowFor,
  type ComparisonBasis,
} from "@/lib/admin/comparison-basis-core";
import {
  buildComparison,
  emptyComparisonBundle,
  type ComparisonBundle,
} from "@/lib/admin/comparison-data";
import { emptyReturnsVoidsRange, type ReturnsVoidsRange } from "@/lib/admin/returns-metrics-store";
import {
  computeNetSales,
  refundSeverity,
  EMPTY_REFUND_FACTS,
  type NetSales,
  type RefundSeverity,
} from "@/lib/admin/refund-metrics-core";

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
  /** Signups in the DB queue still awaiting review (status = new). */
  loyaltySignups: number;
  /**
   * SLICE 21 — the comparison the owner picked, and what it produced. The
   * `yesterday` field above is KEPT so nothing that already reads it breaks;
   * when the basis is "yesterday" the two agree by construction.
   */
  basis: ComparisonBasis;
  comparison: ComparisonBundle;
  /**
   * SLICE 21 — returns and voids for TODAY, store-wide. Previously computed
   * only for the register's X/Z slip and never surfaced in the back office.
   */
  refundsToday: ReturnsVoidsRange;
  /** Gross, refunds, net and the refund rate for today. */
  netToday: NetSales;
  refundSeverityToday: RefundSeverity;
  /** The Pacific business day this snapshot describes. */
  todayYmd: string;
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
    basis: DEFAULT_BASIS,
    comparison: emptyComparisonBundle(DEFAULT_BASIS, pacificToday()),
    refundsToday: emptyReturnsVoidsRange([]),
    netToday: computeNetSales(0, EMPTY_REFUND_FACTS),
    refundSeverityToday: "ok",
    todayYmd: pacificToday(),
  };
}

/*
 * PERF P3 (owner 2026-11-05, verbatim: "I want the main admin page to be
 * instant"): the snapshot is now built from four INDEPENDENT parts, so the
 * cockpit can stream each section the moment its own data is ready instead
 * of waiting for the slowest read of all of them:
 *
 *   cockpitSales(basis)  today, yesterday and the comparison baseline
 *   cockpitOps()         order board, registers/drawers, live menu, loyalty
 *   cockpitRefunds()     today's returns and voids
 *   cockpitLowStock()    the low-stock count
 *
 * Each part is wrapped in React cache(): within ONE request every section
 * that asks for a part shares a single read. The heavy figures (sales,
 * refunds, low stock) also go through the short shared cache in
 * cockpit-cache-server.ts (display only; 30 s for today, 10 min for finished
 * days, 2 min for low stock; failed reads never stored). getCockpitSnapshot
 * keeps its exact shape for the mobile home and register oversight.
 */

export type CockpitSales = {
  basis: ComparisonBasis;
  todayYmd: string;
  today: SalesReport;
  yesterday: SalesReport;
  comparison: ComparisonBundle;
  /** False when today's sales could not be read (the tiles say so). */
  todayReadable: boolean;
};

export type CockpitOps = {
  orderBoard: OrderBoardRow[];
  activeOrders: number;
  registers: RegisterLive[];
  drawers: DrawerRollup;
  publishedItems: number | null;
  lastImportISO: string | null;
  loyaltySignups: number;
};

export type CockpitRefunds = {
  refundsToday: ReturnsVoidsRange;
  netToday: NetSales;
  refundSeverityToday: RefundSeverity;
};

function readSales(basis: ComparisonBasis, todayYmd: string): Promise<CockpitSales> {
  const yestYmd = addPacificDays(todayYmd, -1);
  const yesterdayP = safeData(() => cockpitSalesDays(yestYmd, yestYmd), EMPTY_SALES_REPORT).then((r) => r.data);
  const window = comparisonWindowFor(basis, todayYmd);
  const sorted = [...window.days].sort();
  // Every baseline day is a finished day, so the whole span is shared for
  // 10 minutes. When the span IS yesterday (the default) it is the same read.
  const baselineP =
    sorted.length === 0
      ? Promise.resolve(EMPTY_SALES_REPORT)
      : sorted[0] === yestYmd && sorted[sorted.length - 1] === yestYmd
        ? yesterdayP
        : safeData(() => cockpitSalesDays(sorted[0], sorted[sorted.length - 1]), EMPTY_SALES_REPORT).then((r) => r.data);
  const todayP = safeData(() => cockpitSalesToday(todayYmd), EMPTY_SALES_REPORT);
  return Promise.all([todayP, yesterdayP]).then(async ([todayR, yesterday]) => ({
    basis,
    todayYmd,
    today: todayR.data,
    yesterday,
    comparison: await buildComparison(basis, todayYmd, todayR.data, baselineP),
    todayReadable: todayR.ok,
  }));
}

/** Today's sales and the chosen comparison (one read per request). */
export const cockpitSales = cache(async (rawBasis?: string): Promise<CockpitSales> => {
  const basis = parseComparisonBasis(rawBasis);
  const todayYmd = pacificToday();
  if (!isSupabaseServiceConfigured) {
    return {
      basis,
      todayYmd,
      today: EMPTY_SALES_REPORT,
      yesterday: EMPTY_SALES_REPORT,
      comparison: emptyComparisonBundle(basis, todayYmd),
      todayReadable: true,
    };
  }
  return readSales(basis, todayYmd);
});

/** Orders, registers, live menu and loyalty: all small, all live (not cached). */
export const cockpitOps = cache(async (): Promise<CockpitOps> => {
  if (!isSupabaseServiceConfigured) {
    const e = emptySnapshot();
    return {
      orderBoard: e.orderBoard,
      activeOrders: 0,
      registers: [],
      drawers: e.drawers,
      publishedItems: null,
      lastImportISO: null,
      loyaltySignups: 0,
    };
  }
  const [statusCounts, registers, published, imports, loyaltyCounts] = await Promise.all([
    // USAGE-3: one grouped RPC (0233) instead of seven exact counts.
    safeData(
      () => getOrdersBoardSnapshot({ arrivalsLimit: 0 }).then((s) => s.counts),
      {} as Record<OrderStatus, number>,
    ).then((r) => r.data),
    safeData(() => liveRegisters(), [] as RegisterLive[]).then((r) => r.data),
    safeData(() => getPublishedVersion(), null).then((r) => r.data),
    safeData(() => listImports(1), [] as Awaited<ReturnType<typeof listImports>>).then((r) => r.data),
    safeData(
      () => getLoyaltyStatusCounts(),
      { new: 0, entered: 0, duplicate: 0, archived: 0 },
    ).then((r) => r.data),
  ]);
  const orderBoard: OrderBoardRow[] = ACTIVE_ORDER_STATUSES.map((s) => ({
    status: s,
    label: ORDER_STATUS_LABELS[s],
    count: statusCounts[s] ?? 0,
  }));
  const drawers = rollupDrawers(
    registers
      .filter((r) => r.openSession)
      .map((r) => ({
        status: r.openSession!.status,
        over_short_minor: r.openSession!.over_short_minor,
      })),
  );
  return {
    orderBoard,
    activeOrders: orderBoard.reduce((sum, r) => sum + r.count, 0),
    registers,
    drawers,
    publishedItems: published?.item_count ?? null,
    lastImportISO: imports[0]?.created_at ?? null,
    loyaltySignups: loyaltyCounts.new,
  };
});

/** Today's returns and voids, and net against today's gross. */
export const cockpitRefunds = cache(async (rawBasis?: string): Promise<CockpitRefunds> => {
  const todayYmd = pacificToday();
  const [refundsToday, sales] = await Promise.all([
    // SLICE 21 — store-wide: neither source carries register attribution.
    isSupabaseServiceConfigured
      ? safeData(() => cockpitReturnsToday(todayYmd), emptyReturnsVoidsRange([todayYmd])).then((r) => r.data)
      : Promise.resolve(emptyReturnsVoidsRange([todayYmd])),
    cockpitSales(rawBasis),
  ]);
  const netToday = computeNetSales(sales.today.totalRevenueMinorUnits, refundsToday.totals);
  return { refundsToday, netToday, refundSeverityToday: refundSeverity(netToday) };
});

/**
 * Products at or below their reorder point. null = could not be read (the
 * tile says so; it used to read as 0, "all above reorder point").
 */
export const cockpitLowStock = cache(async (): Promise<number | null> => {
  if (!isSupabaseServiceConfigured) return 0;
  const r = await safeData(() => cockpitLowStockCount(), null as number | null);
  return r.ok ? r.data : null;
});

export async function getCockpitSnapshot(
  rawBasis?: unknown,
): Promise<CockpitSnapshot> {
  const basisArg = typeof rawBasis === "string" ? rawBasis : undefined;
  const basis = parseComparisonBasis(basisArg);
  if (!isSupabaseServiceConfigured) return { ...emptySnapshot(), basis };

  const [sales, ops, refunds, lowStock] = await Promise.all([
    cockpitSales(basisArg),
    cockpitOps(),
    cockpitRefunds(basisArg),
    cockpitLowStock(),
  ]);
  const { today, yesterday } = sales;

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
    activeOrders: ops.activeOrders,
    orderBoard: ops.orderBoard,
    registers: ops.registers,
    drawers: ops.drawers,
    lowStockCount: lowStock ?? 0,
    publishedItems: ops.publishedItems,
    lastImportISO: ops.lastImportISO,
    loyaltySignups: ops.loyaltySignups,
    basis: sales.basis,
    comparison: sales.comparison,
    refundsToday: refunds.refundsToday,
    netToday: refunds.netToday,
    refundSeverityToday: refunds.refundSeverityToday,
    todayYmd: sales.todayYmd,
  };
}
