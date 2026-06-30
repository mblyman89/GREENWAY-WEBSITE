import "server-only";

/**
 * src/lib/reports/sales.ts  (Run 4 / Slice 14)
 *
 * Rich sales analytics for the Greenway back office. Answers the owner's ask:
 * "rich sales reports that are by type, category, vendor, brand, etc."
 *
 * Data model reality
 * ------------------
 *  • orders            — header (status, totals, placed_at, customer_email).
 *  • order_lines       — snapshot lines (product_id, brand, quantity,
 *                        price_minor_units = engine-discounted unit price,
 *                        regular_price_minor_units = pre-discount unit price).
 *  • menu_items        — published catalog snapshot keyed by source_item_id,
 *                        which equals order_lines.product_id. This is where
 *                        category + vendor_name live (order_lines doesn't store
 *                        them). We build a lookup so even historical products
 *                        resolve to a category/vendor.
 *
 * Money is always in MINOR UNITS (cents). We report GROSS retail revenue as the
 * sum of (unit price × quantity) for NON-cancelled orders, matching the existing
 * dashboard's "gross" definition (line price is tax-inclusive at order time, but
 * we surface pre-tax later in the dedicated tax tab).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey, pacificHour, addPacificDays, formatHourLabel } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SalesGroupRow = {
  /** Display label (category name, vendor, brand, product, hour, etc.). */
  label: string;
  /** Gross revenue in minor units (sum of unit price × qty). */
  revenueMinorUnits: number;
  /** Units sold (sum of quantity). */
  units: number;
  /** Distinct orders that contained this group. */
  orders: number;
  /** Total markdown given away (regular − sold) in minor units. */
  discountMinorUnits: number;
  /** Share of total revenue, 0..1. */
  revenueShare: number;
};

export type DayPoint = { date: string; revenueMinorUnits: number; orders: number; units: number };
export type HourPoint = { hour: number; label: string; revenueMinorUnits: number; orders: number };

export type CustomerTypeRow = {
  label: "New customers" | "Returning customers" | "Guest / no email";
  orders: number;
  revenueMinorUnits: number;
};

export type SalesReport = {
  /** True when at least one non-cancelled order existed in range. */
  hasData: boolean;
  totalRevenueMinorUnits: number;
  totalUnits: number;
  totalOrders: number;
  avgOrderMinorUnits: number;
  avgUnitsPerOrder: number;
  totalDiscountMinorUnits: number;
  byCategory: SalesGroupRow[];
  /**
   * Revenue by detailed product TYPE — the granular POS inventory type (e.g.
   * Rosin, BHO, Live Resin, Gummies, Beverage), as opposed to the high-level
   * website category (Flower, Concentrate, etc.).
   */
  byType: SalesGroupRow[];
  /** Types nested under their parent category, for a drill-down view. */
  byTypeWithinCategory: CategoryTypeBreakdown[];
  byVendor: SalesGroupRow[];
  byBrand: SalesGroupRow[];
  byProduct: SalesGroupRow[];
  byDay: DayPoint[];
  byHour: HourPoint[];
  byCustomerType: CustomerTypeRow[];
};

export type CategoryTypeBreakdown = {
  /** Parent website category label. */
  category: string;
  revenueMinorUnits: number;
  units: number;
  revenueShare: number;
  /** Detailed types within this category, sorted by revenue. */
  types: SalesGroupRow[];
};

export const EMPTY_SALES_REPORT: SalesReport = {
  hasData: false,
  totalRevenueMinorUnits: 0,
  totalUnits: 0,
  totalOrders: 0,
  avgOrderMinorUnits: 0,
  avgUnitsPerOrder: 0,
  totalDiscountMinorUnits: 0,
  byCategory: [],
  byType: [],
  byTypeWithinCategory: [],
  byVendor: [],
  byBrand: [],
  byProduct: [],
  byDay: [],
  byHour: [],
  byCustomerType: [],
};

// ---------------------------------------------------------------------------
// Internal accumulator
// ---------------------------------------------------------------------------

type Acc = {
  revenue: number;
  units: number;
  discount: number;
  orderIds: Set<string>;
};

function newAcc(): Acc {
  return { revenue: 0, units: 0, discount: 0, orderIds: new Set() };
}

function finalizeGroups(map: Map<string, Acc>, totalRevenue: number, limit?: number): SalesGroupRow[] {
  const rows: SalesGroupRow[] = [...map.entries()].map(([label, a]) => ({
    label,
    revenueMinorUnits: a.revenue,
    units: a.units,
    orders: a.orderIds.size,
    discountMinorUnits: a.discount,
    revenueShare: totalRevenue > 0 ? a.revenue / totalRevenue : 0,
  }));
  rows.sort((x, y) => y.revenueMinorUnits - x.revenueMinorUnits);
  return limit ? rows.slice(0, limit) : rows;
}

/** Pacific calendar day for an order's placed_at. */
function dayKey(iso: string): string {
  return pacificDayKey(iso);
}

function emptyDaySeries(fromISO: string, toISO: string): DayPoint[] {
  const out: DayPoint[] = [];
  // Walk Pacific calendar days from the Pacific day of fromISO to that of toISO.
  let cur = pacificDayKey(fromISO);
  const last = pacificDayKey(toISO);
  let guard = 0;
  while (cur <= last && guard < 400) {
    out.push({ date: cur, revenueMinorUnits: 0, orders: 0, units: 0 });
    cur = addPacificDays(cur, 1);
    guard += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Product → category/vendor lookup (from menu snapshots)
// ---------------------------------------------------------------------------

type ProductMeta = { category: string; type: string; vendor: string; brand: string };

/**
 * Build a source_item_id → {category, type, vendor, brand} map. We pull every
 * menu_items row ordered by created_at DESC and keep the FIRST (most recent)
 * value seen per source_item_id, so the current catalog wins but historical
 * products still resolve.
 *
 * `type` is the granular POS inventory type (pos_inventory_type), falling back
 * to pos_inventory_category, then to the website category. This is what powers
 * "revenue by type" (Rosin, BHO, Live Resin, Gummies, …) vs the high-level
 * website "category" (Concentrate, Edible, …).
 */
async function buildProductLookup(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<Map<string, ProductMeta>> {
  const lookup = new Map<string, ProductMeta>();
  const { data } = await admin
    .from("menu_items")
    .select("source_item_id, category, pos_inventory_type, pos_inventory_category, vendor_name, brand_name, created_at")
    .order("created_at", { ascending: false })
    .limit(20000);

  const rows =
    (data as
      | {
          source_item_id: string;
          category: string | null;
          pos_inventory_type: string | null;
          pos_inventory_category: string | null;
          vendor_name: string | null;
          brand_name: string | null;
        }[]
      | null) ?? [];

  for (const r of rows) {
    if (!r.source_item_id || lookup.has(r.source_item_id)) continue;
    const type =
      r.pos_inventory_type?.trim() ||
      r.pos_inventory_category?.trim() ||
      r.category?.trim() ||
      "Untyped";
    lookup.set(r.source_item_id, {
      category: r.category?.trim() || "Uncategorized",
      type,
      vendor: r.vendor_name?.trim() || "Unknown vendor",
      brand: r.brand_name?.trim() || "Unknown brand",
    });
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Main report builder
// ---------------------------------------------------------------------------

export async function getSalesReport(fromISO: string, toISO: string): Promise<SalesReport> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_SALES_REPORT };

  const admin = createSupabaseAdminClient();

  // 1) Orders in range (exclude cancelled from revenue).
  const { data: ordersData } = await admin
    .from("orders")
    .select("id, status, customer_email, placed_at")
    .gte("placed_at", fromISO)
    .lte("placed_at", toISO);

  const orders =
    (ordersData as
      | { id: string; status: string; customer_email: string | null; placed_at: string }[]
      | null) ?? [];

  const validOrders = orders.filter((o) => o.status !== "cancelled");
  if (validOrders.length === 0) return { ...EMPTY_SALES_REPORT };

  const orderById = new Map(validOrders.map((o) => [o.id, o]));
  const orderIds = validOrders.map((o) => o.id);

  // 2) Lines for those orders.
  const { data: linesData } = await admin
    .from("order_lines")
    .select("order_id, product_id, product_name, brand, quantity, price_minor_units, regular_price_minor_units")
    .in("order_id", orderIds.slice(0, 2000));

  const lines =
    (linesData as
      | {
          order_id: string;
          product_id: string | null;
          product_name: string;
          brand: string | null;
          quantity: number;
          price_minor_units: number;
          regular_price_minor_units: number | null;
        }[]
      | null) ?? [];

  // 3) Product → category/vendor lookup.
  const lookup = await buildProductLookup(admin);

  // 4) Accumulators.
  const byCategory = new Map<string, Acc>();
  const byType = new Map<string, Acc>();
  const byVendor = new Map<string, Acc>();
  const byBrand = new Map<string, Acc>();
  const byProduct = new Map<string, Acc>();
  // Detailed types nested under their parent category: category -> (type -> Acc).
  const typesPerCategory = new Map<string, Map<string, Acc>>();

  const dayMap = new Map<string, DayPoint>();
  for (const p of emptyDaySeries(fromISO, toISO)) dayMap.set(p.date, p);

  const hourPoints: HourPoint[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: formatHour(h),
    revenueMinorUnits: 0,
    orders: 0,
  }));
  const hourOrderSeen: Array<Set<string>> = Array.from({ length: 24 }, () => new Set());

  let totalRevenue = 0;
  let totalUnits = 0;
  let totalDiscount = 0;

  const orderRevenue = new Map<string, number>(); // for per-order day/hour roll-up

  for (const l of lines) {
    const qty = l.quantity ?? 0;
    const lineRevenue = (l.price_minor_units ?? 0) * qty;
    const regular = (l.regular_price_minor_units ?? l.price_minor_units ?? 0) * qty;
    const lineDiscount = Math.max(0, regular - lineRevenue);

    totalRevenue += lineRevenue;
    totalUnits += qty;
    totalDiscount += lineDiscount;

    const meta = (l.product_id && lookup.get(l.product_id)) || null;
    const category = meta?.category ?? "Uncategorized";
    const type = meta?.type ?? "Untyped";
    const vendor = meta?.vendor ?? "Unknown vendor";
    const brand = l.brand?.trim() || meta?.brand || "Unknown brand";
    const product = l.product_name?.trim() || "Unknown product";

    pushAcc(byCategory, category, lineRevenue, qty, lineDiscount, l.order_id);
    pushAcc(byType, type, lineRevenue, qty, lineDiscount, l.order_id);
    pushAcc(byVendor, vendor, lineRevenue, qty, lineDiscount, l.order_id);
    pushAcc(byBrand, brand, lineRevenue, qty, lineDiscount, l.order_id);
    pushAcc(byProduct, product, lineRevenue, qty, lineDiscount, l.order_id);

    // Nested: type within its parent category.
    let typeMap = typesPerCategory.get(category);
    if (!typeMap) {
      typeMap = new Map<string, Acc>();
      typesPerCategory.set(category, typeMap);
    }
    pushAcc(typeMap, type, lineRevenue, qty, lineDiscount, l.order_id);

    orderRevenue.set(l.order_id, (orderRevenue.get(l.order_id) ?? 0) + lineRevenue);
  }

  // 5) Day + hour roll-up (per order, using header placed_at).
  for (const [orderId, revenue] of orderRevenue) {
    const o = orderById.get(orderId);
    if (!o) continue;
    const dk = dayKey(o.placed_at);
    const day = dayMap.get(dk);
    if (day) {
      day.revenueMinorUnits += revenue;
      day.orders += 1;
    }
    const hour = pacificHour(o.placed_at);
    if (hour >= 0 && hour < 24) {
      hourPoints[hour].revenueMinorUnits += revenue;
      if (!hourOrderSeen[hour].has(orderId)) {
        hourOrderSeen[hour].add(orderId);
        hourPoints[hour].orders += 1;
      }
    }
  }
  // units per day (separate pass keyed by order day)
  for (const l of lines) {
    const o = orderById.get(l.order_id);
    if (!o) continue;
    const day = dayMap.get(dayKey(o.placed_at));
    if (day) day.units += l.quantity ?? 0;
  }

  // 6) Customer type: new vs returning (by email, within range), guest otherwise.
  const emailFirstSeen = new Map<string, string>(); // email -> earliest order id
  const sortedByDate = [...validOrders].sort(
    (a, b) => new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime(),
  );
  for (const o of sortedByDate) {
    const email = o.customer_email?.trim().toLowerCase();
    if (email && !emailFirstSeen.has(email)) emailFirstSeen.set(email, o.id);
  }
  const custTypes: Record<CustomerTypeRow["label"], CustomerTypeRow> = {
    "New customers": { label: "New customers", orders: 0, revenueMinorUnits: 0 },
    "Returning customers": { label: "Returning customers", orders: 0, revenueMinorUnits: 0 },
    "Guest / no email": { label: "Guest / no email", orders: 0, revenueMinorUnits: 0 },
  };
  for (const o of validOrders) {
    const revenue = orderRevenue.get(o.id) ?? 0;
    const email = o.customer_email?.trim().toLowerCase();
    let key: CustomerTypeRow["label"];
    if (!email) key = "Guest / no email";
    else if (emailFirstSeen.get(email) === o.id) key = "New customers";
    else key = "Returning customers";
    custTypes[key].orders += 1;
    custTypes[key].revenueMinorUnits += revenue;
  }

  const totalOrders = validOrders.length;

  // Build the nested type-within-category breakdown, sorted by category revenue.
  const byTypeWithinCategory: CategoryTypeBreakdown[] = [...typesPerCategory.entries()]
    .map(([category, typeMap]) => {
      let revenue = 0;
      let units = 0;
      for (const a of typeMap.values()) {
        revenue += a.revenue;
        units += a.units;
      }
      return {
        category,
        revenueMinorUnits: revenue,
        units,
        revenueShare: totalRevenue > 0 ? revenue / totalRevenue : 0,
        types: finalizeGroups(typeMap, totalRevenue),
      };
    })
    .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);

  return {
    hasData: true,
    totalRevenueMinorUnits: totalRevenue,
    totalUnits,
    totalOrders,
    avgOrderMinorUnits: totalOrders ? Math.round(totalRevenue / totalOrders) : 0,
    avgUnitsPerOrder: totalOrders ? Math.round((totalUnits / totalOrders) * 10) / 10 : 0,
    totalDiscountMinorUnits: totalDiscount,
    byCategory: finalizeGroups(byCategory, totalRevenue),
    byType: finalizeGroups(byType, totalRevenue),
    byTypeWithinCategory,
    byVendor: finalizeGroups(byVendor, totalRevenue),
    byBrand: finalizeGroups(byBrand, totalRevenue),
    byProduct: finalizeGroups(byProduct, totalRevenue, 25),
    byDay: [...dayMap.values()],
    byHour: hourPoints,
    byCustomerType: [
      custTypes["New customers"],
      custTypes["Returning customers"],
      custTypes["Guest / no email"],
    ].filter((r) => r.orders > 0),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pushAcc(
  map: Map<string, Acc>,
  key: string,
  revenue: number,
  units: number,
  discount: number,
  orderId: string,
): void {
  let a = map.get(key);
  if (!a) {
    a = newAcc();
    map.set(key, a);
  }
  a.revenue += revenue;
  a.units += units;
  a.discount += discount;
  a.orderIds.add(orderId);
}

function formatHour(h: number): string {
  return formatHourLabel(h);
}
