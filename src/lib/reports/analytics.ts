/**
 * src/lib/reports/analytics.ts
 *
 * Server-side analytics aggregations for the Slice 9 Reports hub. Reads the
 * real data we now have in the database — orders + order_lines (Slice 7),
 * loyalty_signups (Slice 8) — plus the currently published menu version
 * (Slice 2) for inventory-health diagnostics. All DB access is service-role and
 * SERVER-ONLY. Charts are rendered with lightweight dependency-free SVG/CSS in
 * the UI, so this layer just returns plain aggregated numbers.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion, getVersionItems } from "@/lib/pos/menu-version";
import type { OrderStatus } from "@/lib/orders/types";

export type DayPoint = { date: string; value: number };
export type LabeledCount = { label: string; value: number };

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export function rangeStartISO(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString();
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Build a zero-filled day series for the last `days` days (oldest -> newest). */
function emptyDaySeries(days: number): DayPoint[] {
  const out: DayPoint[] = [];
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    out.push({ date: d.toISOString().slice(0, 10), value: 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orders / sales
// ---------------------------------------------------------------------------

export type OrdersReport = {
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  noShowOrders: number;
  grossMinorUnits: number; // sum of totals across non-cancelled orders
  avgOrderMinorUnits: number; // AOV across non-cancelled orders
  avgItemsPerOrder: number;
  statusCounts: Record<OrderStatus, number>;
  ordersByDay: DayPoint[];
  revenueByDay: DayPoint[]; // minor units
  topProducts: LabeledCount[];
  topBrands: LabeledCount[];
  topCategories: LabeledCount[]; // by brand is available; category not on lines, so brand only
};

const EMPTY_STATUS: Record<OrderStatus, number> = {
  new: 0,
  acknowledged: 0,
  preparing: 0,
  ready: 0,
  completed: 0,
  cancelled: 0,
  no_show: 0,
};

export async function getOrdersReport(days = 30): Promise<OrdersReport> {
  const base: OrdersReport = {
    totalOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    noShowOrders: 0,
    grossMinorUnits: 0,
    avgOrderMinorUnits: 0,
    avgItemsPerOrder: 0,
    statusCounts: { ...EMPTY_STATUS },
    ordersByDay: emptyDaySeries(days),
    revenueByDay: emptyDaySeries(days),
    topProducts: [],
    topBrands: [],
    topCategories: [],
  };
  if (!isSupabaseServiceConfigured) return base;

  const admin = createSupabaseAdminClient();
  const startISO = rangeStartISO(days);

  const { data: orders } = await admin
    .from("orders")
    .select("id, status, total_minor_units, item_count, placed_at")
    .gte("placed_at", startISO);

  const orderRows =
    (orders as
      | {
          id: string;
          status: OrderStatus;
          total_minor_units: number;
          item_count: number;
          placed_at: string;
        }[]
      | null) ?? [];

  const ordersByDay = emptyDaySeries(days);
  const revenueByDay = emptyDaySeries(days);
  const dayIndex = new Map(ordersByDay.map((p, i) => [p.date, i]));

  let gross = 0;
  let nonCancelledCount = 0;
  let itemsTotal = 0;
  const orderIds: string[] = [];

  for (const o of orderRows) {
    base.totalOrders += 1;
    base.statusCounts[o.status] = (base.statusCounts[o.status] ?? 0) + 1;
    if (o.status === "completed") base.completedOrders += 1;
    if (o.status === "cancelled") base.cancelledOrders += 1;
    if (o.status === "no_show") base.noShowOrders += 1;

    const k = dayKey(o.placed_at);
    const idx = dayIndex.get(k);
    if (idx != null) ordersByDay[idx].value += 1;

    if (o.status !== "cancelled") {
      gross += o.total_minor_units;
      nonCancelledCount += 1;
      itemsTotal += o.item_count;
      if (idx != null) revenueByDay[idx].value += o.total_minor_units;
      orderIds.push(o.id);
    }
  }

  base.grossMinorUnits = gross;
  base.avgOrderMinorUnits = nonCancelledCount ? Math.round(gross / nonCancelledCount) : 0;
  base.avgItemsPerOrder = nonCancelledCount
    ? Math.round((itemsTotal / nonCancelledCount) * 10) / 10
    : 0;
  base.ordersByDay = ordersByDay;
  base.revenueByDay = revenueByDay;

  // Top products / brands from the non-cancelled orders' lines.
  if (orderIds.length) {
    const { data: lines } = await admin
      .from("order_lines")
      .select("product_name, brand, quantity, price_minor_units, order_id")
      .in("order_id", orderIds.slice(0, 1000));

    const lineRows =
      (lines as
        | {
            product_name: string;
            brand: string | null;
            quantity: number;
            price_minor_units: number;
          }[]
        | null) ?? [];

    const productMap = new Map<string, number>();
    const brandMap = new Map<string, number>();
    for (const l of lineRows) {
      productMap.set(l.product_name, (productMap.get(l.product_name) ?? 0) + l.quantity);
      if (l.brand) brandMap.set(l.brand, (brandMap.get(l.brand) ?? 0) + l.quantity);
    }
    base.topProducts = topN(productMap, 8);
    base.topBrands = topN(brandMap, 8);
  }

  return base;
}

function topN(map: Map<string, number>, n: number): LabeledCount[] {
  return [...map.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// ---------------------------------------------------------------------------
// Loyalty
// ---------------------------------------------------------------------------

export type LoyaltyReport = {
  total: number;
  newCount: number;
  enteredCount: number;
  duplicateCount: number;
  archivedCount: number;
  dedupeFlagged: number;
  signupsByDay: DayPoint[];
};

export async function getLoyaltyReport(days = 30): Promise<LoyaltyReport> {
  const base: LoyaltyReport = {
    total: 0,
    newCount: 0,
    enteredCount: 0,
    duplicateCount: 0,
    archivedCount: 0,
    dedupeFlagged: 0,
    signupsByDay: emptyDaySeries(days),
  };
  if (!isSupabaseServiceConfigured) return base;

  const admin = createSupabaseAdminClient();
  const startISO = rangeStartISO(days);

  const { data } = await admin
    .from("loyalty_signups")
    .select("status, dedupe_of, submitted_at")
    .gte("submitted_at", startISO);

  const rows =
    (data as { status: string; dedupe_of: string | null; submitted_at: string }[] | null) ?? [];

  const byDay = emptyDaySeries(days);
  const idx = new Map(byDay.map((p, i) => [p.date, i]));

  for (const r of rows) {
    base.total += 1;
    if (r.status === "new") base.newCount += 1;
    else if (r.status === "entered") base.enteredCount += 1;
    else if (r.status === "duplicate") base.duplicateCount += 1;
    else if (r.status === "archived") base.archivedCount += 1;
    if (r.dedupe_of) base.dedupeFlagged += 1;
    const i = idx.get(dayKey(r.submitted_at));
    if (i != null) byDay[i].value += 1;
  }
  base.signupsByDay = byDay;
  return base;
}

// ---------------------------------------------------------------------------
// Inventory health (from the currently published menu version)
// ---------------------------------------------------------------------------

export type InventoryHealthReport = {
  hasPublishedMenu: boolean;
  totalItems: number;
  totalVariants: number;
  outOfStock: number; // every variant at 0
  lowStock: number; // any variant 1..5
  zeroPrice: number; // price_minor_units <= 0
  missingDescription: number;
  missingBrand: number;
  hiddenItems: number;
  suspiciousPotency: number; // thc parse > 100 or nonsense
  topBrandsByCount: LabeledCount[];
  topCategoriesByCount: LabeledCount[];
};

function parsePotency(value: string | null): number | null {
  if (!value) return null;
  const m = value.match(/[\d.]+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export async function getInventoryHealthReport(): Promise<InventoryHealthReport> {
  const base: InventoryHealthReport = {
    hasPublishedMenu: false,
    totalItems: 0,
    totalVariants: 0,
    outOfStock: 0,
    lowStock: 0,
    zeroPrice: 0,
    missingDescription: 0,
    missingBrand: 0,
    hiddenItems: 0,
    suspiciousPotency: 0,
    topBrandsByCount: [],
    topCategoriesByCount: [],
  };
  if (!isSupabaseServiceConfigured) return base;

  const version = await getPublishedVersion();
  if (!version) return base;
  base.hasPublishedMenu = true;

  const items = await getVersionItems(version.id);
  base.totalItems = items.length;

  const brandMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();

  for (const item of items) {
    base.totalVariants += item.variants.length;
    if (item.hidden) base.hiddenItems += 1;

    const price = item.price_minor_units;
    const variantPrices = item.variants.map((v) => v.price_minor_units);
    const allZeroPrice = price <= 0 && variantPrices.every((p) => p <= 0);
    if (allZeroPrice) base.zeroPrice += 1;

    if (!item.description || item.description.trim().length < 10) base.missingDescription += 1;
    if (!item.brand_name || item.brand_name.trim() === "") base.missingBrand += 1;

    const levels = item.variants.map((v) => v.inventory_level);
    if (levels.length > 0) {
      if (levels.every((l) => l <= 0)) base.outOfStock += 1;
      else if (levels.some((l) => l > 0 && l <= 5)) base.lowStock += 1;
    }

    const thc = parsePotency(item.thc);
    if (thc != null && thc > 100) base.suspiciousPotency += 1;

    if (item.brand_name) brandMap.set(item.brand_name, (brandMap.get(item.brand_name) ?? 0) + 1);
    if (item.category) categoryMap.set(item.category, (categoryMap.get(item.category) ?? 0) + 1);
  }

  base.topBrandsByCount = topN(brandMap, 10);
  base.topCategoriesByCount = topN(categoryMap, 12);
  return base;
}

// ---------------------------------------------------------------------------
// Promotions performance (published promos overview)
// ---------------------------------------------------------------------------

export type PromotionsReport = {
  total: number;
  published: number;
  draft: number;
  scheduled: number;
  archived: number;
};

export async function getPromotionsReport(): Promise<PromotionsReport> {
  const base: PromotionsReport = {
    total: 0,
    published: 0,
    draft: 0,
    scheduled: 0,
    archived: 0,
  };
  if (!isSupabaseServiceConfigured) return base;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("promotions").select("status");
  const rows = (data as { status: string }[] | null) ?? [];
  for (const r of rows) {
    base.total += 1;
    if (r.status === "published") base.published += 1;
    else if (r.status === "draft") base.draft += 1;
    else if (r.status === "scheduled") base.scheduled += 1;
    else if (r.status === "archived") base.archived += 1;
  }
  return base;
}
