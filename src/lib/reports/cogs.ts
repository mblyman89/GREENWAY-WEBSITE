import "server-only";

/**
 * src/lib/reports/cogs.ts  (Run 4 / Slice 15)
 *
 * Cost of Goods Sold + inventory profitability for the back office. Answers:
 * "cost of goods sold reports, in all the various ways" + inventory valuation,
 * margin, and aging.
 *
 * Cost source
 * -----------
 *  • inventory_lots.unit_cost_minor_units keyed by pos_product_key. A product may
 *    have multiple lots, so we compute a WEIGHTED-AVERAGE unit cost per product
 *    (weighted by received_qty; falls back to simple average, then 0).
 *  • Sold lines (order_lines) carry product_id == pos_product_key, so COGS for a
 *    line = avgUnitCost(product) × quantity.
 *  • Category/vendor/brand labels are resolved from the menu_items snapshot, the
 *    same way the Sales report does, so groupings line up across tabs.
 *
 * Definitions
 * -----------
 *  • Revenue = sum(line price × qty) on non-cancelled orders (matches Sales tab;
 *    line price is tax-inclusive at order time — we surface pre-tax separately in
 *    the dedicated Tax tab).
 *  • COGS = sum(avgUnitCost × qty).
 *  • Gross profit = Revenue − COGS. Margin = profit / revenue.
 *
 * All money in MINOR UNITS (cents).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CogsGroupRow = {
  label: string;
  revenueMinorUnits: number;
  cogsMinorUnits: number;
  grossProfitMinorUnits: number;
  /** Margin 0..1 (profit / revenue). */
  margin: number;
  units: number;
};

export type InventoryValuationRow = {
  label: string;
  onHandUnits: number;
  /** On-hand value at cost. */
  costValueMinorUnits: number;
  lots: number;
};

export type AgingBucketRow = {
  label: string;
  lots: number;
  onHandUnits: number;
  costValueMinorUnits: number;
};

/** Aging detail for a single product type, nested under its aging bucket. */
export type AgingTypeRow = {
  type: string;
  lots: number;
  onHandUnits: number;
  costValueMinorUnits: number;
};

/** An aging bucket with its per-type breakdown (so aging mirrors sales/COGS by type). */
export type AgingBucketWithTypes = AgingBucketRow & {
  types: AgingTypeRow[];
};

/**
 * A sold product whose COGS came back $0 because no unit cost could be resolved.
 * Surfaced so a $0 COGS is EXPLAINABLE instead of mysterious — the owner can see
 * exactly which product_id failed to link to an inventory lot with a cost.
 */
export type MissingCostRow = {
  productId: string;
  productName: string;
  units: number;
  revenueMinorUnits: number;
  /** Why the cost is missing — best-effort diagnosis. */
  reason: string;
};

export type CogsReport = {
  hasData: boolean;
  // Sold-period KPIs
  totalRevenueMinorUnits: number;
  totalCogsMinorUnits: number;
  totalGrossProfitMinorUnits: number;
  overallMargin: number;
  unitsSold: number;
  // Inventory snapshot KPIs (current, not range-bound)
  inventoryCostValueMinorUnits: number;
  inventoryOnHandUnits: number;
  inventoryLots: number;
  // Breakdowns
  byCategory: CogsGroupRow[];
  byType: CogsGroupRow[];
  byVendor: CogsGroupRow[];
  byBrand: CogsGroupRow[];
  valuationByCategory: InventoryValuationRow[];
  valuationByType: InventoryValuationRow[];
  aging: AgingBucketRow[];
  /** Aging buckets with their per-type breakdown (drill-down). */
  agingByType: AgingBucketWithTypes[];
  // Diagnostics: sold lines whose COGS resolved to $0 for lack of a unit cost.
  missingCost: MissingCostRow[];
  missingCostUnits: number;
  missingCostRevenueMinorUnits: number;
};

export const EMPTY_COGS_REPORT: CogsReport = {
  hasData: false,
  totalRevenueMinorUnits: 0,
  totalCogsMinorUnits: 0,
  totalGrossProfitMinorUnits: 0,
  overallMargin: 0,
  unitsSold: 0,
  inventoryCostValueMinorUnits: 0,
  inventoryOnHandUnits: 0,
  inventoryLots: 0,
  byCategory: [],
  byType: [],
  byVendor: [],
  byBrand: [],
  valuationByCategory: [],
  valuationByType: [],
  aging: [],
  agingByType: [],
  missingCost: [],
  missingCostUnits: 0,
  missingCostRevenueMinorUnits: 0,
};

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

type ProductMeta = { category: string; type: string; vendor: string; brand: string };

async function buildProductLookup(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<Map<string, ProductMeta>> {
  const lookup = new Map<string, ProductMeta>();
  const { data } = await admin
    .from("menu_items")
    .select(
      "source_item_id, category, pos_inventory_type, pos_inventory_category, vendor_name, brand_name, created_at",
    )
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
    // Detailed POS type mirrors the Sales report: prefer pos_inventory_type, then
    // pos_inventory_category, then the website category, else "Untyped".
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

type LotRow = {
  pos_product_key: string | null;
  product_name: string | null;
  received_qty: number | null;
  on_hand_qty: number | null;
  unit_cost_minor_units: number | null;
  expires_on: string | null;
  status: string | null;
};

type CostMap = {
  /** Weighted-average unit cost (minor units) per pos_product_key, when known. */
  cost: Map<string, number>;
  /** All pos_product_keys that have at least one lot (cost known or not). */
  lotKeys: Set<string>;
  /** Keys that have lot(s) but every lot is missing unit_cost_minor_units. */
  keysWithLotsButNoCost: Set<string>;
};

/** Weighted-average unit cost (minor units) per pos_product_key + diagnostics. */
function buildCostMap(lots: LotRow[]): CostMap {
  const num = new Map<string, number>(); // sum(cost*qty)
  const den = new Map<string, number>(); // sum(qty)
  const simpleSum = new Map<string, number>();
  const simpleCount = new Map<string, number>();
  const lotKeys = new Set<string>();
  const keysWithCost = new Set<string>();
  for (const l of lots) {
    const key = l.pos_product_key;
    if (!key) continue;
    lotKeys.add(key);
    if (l.unit_cost_minor_units == null) continue;
    keysWithCost.add(key);
    const cost = l.unit_cost_minor_units;
    const qty = Number(l.received_qty ?? 0);
    if (qty > 0) {
      num.set(key, (num.get(key) ?? 0) + cost * qty);
      den.set(key, (den.get(key) ?? 0) + qty);
    }
    simpleSum.set(key, (simpleSum.get(key) ?? 0) + cost);
    simpleCount.set(key, (simpleCount.get(key) ?? 0) + 1);
  }
  const cost = new Map<string, number>();
  const keys = new Set<string>([...simpleSum.keys()]);
  for (const key of keys) {
    const d = den.get(key) ?? 0;
    if (d > 0) cost.set(key, Math.round((num.get(key) ?? 0) / d));
    else cost.set(key, Math.round((simpleSum.get(key) ?? 0) / (simpleCount.get(key) || 1)));
  }
  const keysWithLotsButNoCost = new Set<string>();
  for (const k of lotKeys) if (!keysWithCost.has(k)) keysWithLotsButNoCost.add(k);
  return { cost, lotKeys, keysWithLotsButNoCost };
}

// ---------------------------------------------------------------------------
// Accumulator
// ---------------------------------------------------------------------------

type Acc = { revenue: number; cogs: number; units: number };
function pushAcc(map: Map<string, Acc>, key: string, revenue: number, cogs: number, units: number) {
  let a = map.get(key);
  if (!a) {
    a = { revenue: 0, cogs: 0, units: 0 };
    map.set(key, a);
  }
  a.revenue += revenue;
  a.cogs += cogs;
  a.units += units;
}
function finalize(map: Map<string, Acc>): CogsGroupRow[] {
  const rows: CogsGroupRow[] = [...map.entries()].map(([label, a]) => {
    const profit = a.revenue - a.cogs;
    return {
      label,
      revenueMinorUnits: a.revenue,
      cogsMinorUnits: a.cogs,
      grossProfitMinorUnits: profit,
      margin: a.revenue > 0 ? profit / a.revenue : 0,
      units: a.units,
    };
  });
  rows.sort((x, y) => y.grossProfitMinorUnits - x.grossProfitMinorUnits);
  return rows;
}

// ---------------------------------------------------------------------------
// Aging buckets (by days until expiry; lots with no expiry → "No expiry")
// ---------------------------------------------------------------------------

function agingBucket(expiresOn: string | null): string {
  if (!expiresOn) return "No expiry date";
  const exp = new Date(expiresOn + "T00:00:00Z").getTime();
  const now = Date.now();
  const days = Math.floor((exp - now) / (24 * 60 * 60 * 1000));
  if (days < 0) return "Expired";
  if (days <= 30) return "Expiring ≤ 30 days";
  if (days <= 90) return "31–90 days";
  if (days <= 180) return "91–180 days";
  return "180+ days";
}

const AGING_ORDER = [
  "Expired",
  "Expiring ≤ 30 days",
  "31–90 days",
  "91–180 days",
  "180+ days",
  "No expiry date",
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function getCogsReport(fromISO: string, toISO: string): Promise<CogsReport> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_COGS_REPORT };
  const admin = createSupabaseAdminClient();

  // Lots (active inventory for valuation + cost map across all statuses for COGS).
  const { data: lotsData } = await admin
    .from("inventory_lots")
    .select("pos_product_key, product_name, received_qty, on_hand_qty, unit_cost_minor_units, expires_on, status")
    .limit(50000);
  const lots = (lotsData as LotRow[] | null) ?? [];

  const costMap = buildCostMap(lots);
  const lookup = await buildProductLookup(admin);

  // Diagnostics for $0-COGS lines.
  const missingMap = new Map<string, { name: string; units: number; revenue: number; reason: string }>();

  // Orders in range (non-cancelled).
  const { data: ordersData } = await admin
    .from("orders")
    .select("id, status, placed_at")
    .gte("placed_at", fromISO)
    .lte("placed_at", toISO);
  const orders = (ordersData as { id: string; status: string; placed_at: string }[] | null) ?? [];
  const validOrderIds = orders.filter((o) => o.status !== "cancelled").map((o) => o.id);

  const byCategory = new Map<string, Acc>();
  const byType = new Map<string, Acc>();
  const byVendor = new Map<string, Acc>();
  const byBrand = new Map<string, Acc>();
  let totalRevenue = 0;
  let totalCogs = 0;
  let unitsSold = 0;

  if (validOrderIds.length) {
    const { data: linesData } = await admin
      .from("order_lines")
      .select("order_id, product_id, product_name, brand, quantity, price_minor_units")
      .in("order_id", validOrderIds.slice(0, 2000));
    const lines =
      (linesData as
        | {
            order_id: string;
            product_id: string | null;
            product_name: string | null;
            brand: string | null;
            quantity: number;
            price_minor_units: number;
          }[]
        | null) ?? [];

    for (const l of lines) {
      const qty = l.quantity ?? 0;
      const revenue = (l.price_minor_units ?? 0) * qty;
      const resolvedCost = l.product_id ? costMap.cost.get(l.product_id) : undefined;
      const unitCost = resolvedCost ?? 0;
      const cogs = unitCost * qty;

      // Diagnose missing cost so a $0 COGS is explainable.
      if (resolvedCost == null && revenue > 0) {
        const pid = l.product_id ?? "(no product_id)";
        let reason: string;
        if (!l.product_id) {
          reason = "Order line has no product_id (sold off-catalog or legacy import).";
        } else if (!costMap.lotKeys.has(l.product_id)) {
          reason =
            "No inventory lot matches this product key (received outside this system, or pos_product_key ≠ order product_id).";
        } else if (costMap.keysWithLotsButNoCost.has(l.product_id)) {
          reason = "Inventory lot exists but unit_cost_minor_units is empty (no cost captured at intake).";
        } else {
          reason = "Cost could not be resolved.";
        }
        const m = missingMap.get(pid) ?? { name: l.product_name ?? pid, units: 0, revenue: 0, reason };
        m.units += qty;
        m.revenue += revenue;
        missingMap.set(pid, m);
      }

      totalRevenue += revenue;
      totalCogs += cogs;
      unitsSold += qty;

      const meta = (l.product_id && lookup.get(l.product_id)) || null;
      const category = meta?.category ?? "Uncategorized";
      const type = meta?.type ?? "Untyped";
      const vendor = meta?.vendor ?? "Unknown vendor";
      const brand = l.brand?.trim() || meta?.brand || "Unknown brand";

      pushAcc(byCategory, category, revenue, cogs, qty);
      pushAcc(byType, type, revenue, cogs, qty);
      pushAcc(byVendor, vendor, revenue, cogs, qty);
      pushAcc(byBrand, brand, revenue, cogs, qty);
    }
  }

  // Inventory valuation + aging from ACTIVE lots with on_hand > 0.
  const valuationMap = new Map<string, { onHand: number; cost: number; lots: number }>();
  const valuationTypeMap = new Map<string, { onHand: number; cost: number; lots: number }>();
  const agingMap = new Map<string, { lots: number; onHand: number; cost: number }>();
  // bucket -> type -> totals (so aging mirrors the by-type breakdown).
  const agingTypeMap = new Map<string, Map<string, { lots: number; onHand: number; cost: number }>>();
  let invValue = 0;
  let invOnHand = 0;
  let invLots = 0;

  for (const l of lots) {
    if (l.status === "destroyed") continue;
    const onHand = Number(l.on_hand_qty ?? 0);
    if (onHand <= 0) continue;
    const unitCost =
      (l.pos_product_key ? costMap.cost.get(l.pos_product_key) : undefined) ?? l.unit_cost_minor_units ?? 0;
    const value = Math.round(unitCost * onHand);

    invValue += value;
    invOnHand += onHand;
    invLots += 1;

    const meta = (l.pos_product_key && lookup.get(l.pos_product_key)) || null;
    const category = meta?.category ?? "Uncategorized";
    const type = meta?.type ?? "Untyped";

    const v = valuationMap.get(category) ?? { onHand: 0, cost: 0, lots: 0 };
    v.onHand += onHand;
    v.cost += value;
    v.lots += 1;
    valuationMap.set(category, v);

    const vt = valuationTypeMap.get(type) ?? { onHand: 0, cost: 0, lots: 0 };
    vt.onHand += onHand;
    vt.cost += value;
    vt.lots += 1;
    valuationTypeMap.set(type, vt);

    const bucket = agingBucket(l.expires_on);
    const a = agingMap.get(bucket) ?? { lots: 0, onHand: 0, cost: 0 };
    a.lots += 1;
    a.onHand += onHand;
    a.cost += value;
    agingMap.set(bucket, a);

    let typeMap = agingTypeMap.get(bucket);
    if (!typeMap) {
      typeMap = new Map();
      agingTypeMap.set(bucket, typeMap);
    }
    const at = typeMap.get(type) ?? { lots: 0, onHand: 0, cost: 0 };
    at.lots += 1;
    at.onHand += onHand;
    at.cost += value;
    typeMap.set(type, at);
  }

  const valuationByCategory: InventoryValuationRow[] = [...valuationMap.entries()]
    .map(([label, v]) => ({
      label,
      onHandUnits: Math.round(v.onHand * 100) / 100,
      costValueMinorUnits: v.cost,
      lots: v.lots,
    }))
    .sort((x, y) => y.costValueMinorUnits - x.costValueMinorUnits);

  const valuationByType: InventoryValuationRow[] = [...valuationTypeMap.entries()]
    .map(([label, v]) => ({
      label,
      onHandUnits: Math.round(v.onHand * 100) / 100,
      costValueMinorUnits: v.cost,
      lots: v.lots,
    }))
    .sort((x, y) => y.costValueMinorUnits - x.costValueMinorUnits);

  const aging: AgingBucketRow[] = AGING_ORDER.filter((b) => agingMap.has(b)).map((label) => {
    const a = agingMap.get(label)!;
    return {
      label,
      lots: a.lots,
      onHandUnits: Math.round(a.onHand * 100) / 100,
      costValueMinorUnits: a.cost,
    };
  });

  const agingByType: AgingBucketWithTypes[] = AGING_ORDER.filter((b) => agingMap.has(b)).map((label) => {
    const a = agingMap.get(label)!;
    const typeMap = agingTypeMap.get(label) ?? new Map();
    const types: AgingTypeRow[] = [...typeMap.entries()]
      .map(([type, t]) => ({
        type,
        lots: t.lots,
        onHandUnits: Math.round(t.onHand * 100) / 100,
        costValueMinorUnits: t.cost,
      }))
      .sort((x, y) => y.costValueMinorUnits - x.costValueMinorUnits);
    return {
      label,
      lots: a.lots,
      onHandUnits: Math.round(a.onHand * 100) / 100,
      costValueMinorUnits: a.cost,
      types,
    };
  });

  const totalProfit = totalRevenue - totalCogs;

  const missingCost: MissingCostRow[] = [...missingMap.entries()]
    .map(([productId, m]) => ({
      productId,
      productName: m.name,
      units: m.units,
      revenueMinorUnits: m.revenue,
      reason: m.reason,
    }))
    .sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);
  const missingCostUnits = missingCost.reduce((s, r) => s + r.units, 0);
  const missingCostRevenueMinorUnits = missingCost.reduce((s, r) => s + r.revenueMinorUnits, 0);

  return {
    hasData: totalRevenue > 0 || invLots > 0,
    totalRevenueMinorUnits: totalRevenue,
    totalCogsMinorUnits: totalCogs,
    totalGrossProfitMinorUnits: totalProfit,
    overallMargin: totalRevenue > 0 ? totalProfit / totalRevenue : 0,
    unitsSold,
    inventoryCostValueMinorUnits: invValue,
    inventoryOnHandUnits: Math.round(invOnHand * 100) / 100,
    inventoryLots: invLots,
    byCategory: finalize(byCategory),
    byType: finalize(byType),
    byVendor: finalize(byVendor),
    byBrand: finalize(byBrand),
    valuationByCategory,
    valuationByType,
    aging,
    agingByType,
    missingCost,
    missingCostUnits,
    missingCostRevenueMinorUnits,
  };
}
