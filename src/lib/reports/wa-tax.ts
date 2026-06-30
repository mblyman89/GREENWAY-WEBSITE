import "server-only";

/**
 * src/lib/reports/wa-tax.ts  (Run 4 / Slice 16)
 *
 * Washington / WSLCB tax reporting for Greenway. Produces the figures the owner
 * needs to file:
 *   • Cannabis EXCISE tax (37%) — the LCB excise return is on CANNABIS retail
 *     sales only. CCRS calls this "OtherTax".
 *   • Combined retail SALES tax (state 6.50% + Port Orchard local 2.80% = 9.30%)
 *     on all retail goods (cannabis + non-cannabis), for the DOR return.
 *
 * Source of truth
 * ---------------
 *   order_lines.price_minor_units is the POST-discount, PRE-TAX unit price (the
 *   cart engine sums these to subtotalDiscounted, then adds tax on top). So the
 *   taxable base for a line = price_minor_units × quantity. We classify each
 *   line as cannabis/non-cannabis via the menu_items category snapshot and the
 *   tax_category_rules table, then run the shared tax engine.
 *
 * Everything is computed from NON-cancelled orders, bucketed by calendar month
 * of placed_at (UTC). Money in MINOR UNITS (cents). State/local split is
 * pro-rated from the configured basis points.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  getTaxSettings,
  getCannabisCategorySet,
  isCannabisCategory,
  computeLineTax,
  applyBps,
  type TaxSettings,
} from "@/lib/reports/tax";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WaTaxMonthRow = {
  /** YYYY-MM */
  month: string;
  /** Human label e.g. "Jan 2025". */
  label: string;
  cannabisBaseMinor: number;
  nonCannabisBaseMinor: number;
  totalBaseMinor: number;
  stateSalesTaxMinor: number;
  localSalesTaxMinor: number;
  salesTaxMinor: number;
  exciseTaxMinor: number;
  totalTaxMinor: number;
  orders: number;
};

export type WaTaxCategoryRow = {
  category: string;
  isCannabis: boolean;
  baseMinor: number;
  salesTaxMinor: number;
  exciseTaxMinor: number;
  units: number;
};

export type WaTaxReport = {
  hasData: boolean;
  settings: TaxSettings;
  combinedSalesRatePct: number;
  exciseRatePct: number;
  // Range totals
  cannabisBaseMinor: number;
  nonCannabisBaseMinor: number;
  totalBaseMinor: number;
  stateSalesTaxMinor: number;
  localSalesTaxMinor: number;
  salesTaxMinor: number;
  exciseTaxMinor: number;
  totalTaxMinor: number;
  orders: number;
  // Breakdowns
  byMonth: WaTaxMonthRow[];
  byCategory: WaTaxCategoryRow[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthKey(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_LABELS[idx] ?? m} ${y}`;
}

type ProductCategory = Map<string, string>; // source_item_id -> category

async function buildCategoryLookup(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<ProductCategory> {
  const lookup: ProductCategory = new Map();
  const { data } = await admin
    .from("menu_items")
    .select("source_item_id, category, created_at")
    .order("created_at", { ascending: false })
    .limit(20000);
  const rows = (data as { source_item_id: string; category: string | null }[] | null) ?? [];
  for (const r of rows) {
    if (!r.source_item_id || lookup.has(r.source_item_id)) continue;
    lookup.set(r.source_item_id, r.category?.trim() || "");
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function getWaTaxReport(fromISO: string, toISO: string): Promise<WaTaxReport> {
  const settings = await getTaxSettings().catch(() => null);
  const resolvedSettings = settings ?? {
    exciseRateBps: 3700,
    stateSalesRateBps: 650,
    localSalesRateBps: 280,
    medicalEndorsement: false,
  };
  const combinedSalesRatePct =
    (resolvedSettings.stateSalesRateBps + resolvedSettings.localSalesRateBps) / 100;
  const exciseRatePct = resolvedSettings.exciseRateBps / 100;

  const empty: WaTaxReport = {
    hasData: false,
    settings: resolvedSettings,
    combinedSalesRatePct,
    exciseRatePct,
    cannabisBaseMinor: 0,
    nonCannabisBaseMinor: 0,
    totalBaseMinor: 0,
    stateSalesTaxMinor: 0,
    localSalesTaxMinor: 0,
    salesTaxMinor: 0,
    exciseTaxMinor: 0,
    totalTaxMinor: 0,
    orders: 0,
    byMonth: [],
    byCategory: [],
  };

  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();

  const [cannabisSet, categoryLookup] = await Promise.all([
    getCannabisCategorySet(),
    buildCategoryLookup(admin),
  ]);

  const { data: ordersData } = await admin
    .from("orders")
    .select("id, status, placed_at")
    .gte("placed_at", fromISO)
    .lte("placed_at", toISO);
  const orders = (ordersData as { id: string; status: string; placed_at: string }[] | null) ?? [];
  const valid = orders.filter((o) => o.status !== "cancelled");
  if (valid.length === 0) return empty;

  const placedById = new Map(valid.map((o) => [o.id, o.placed_at]));
  const orderIds = valid.map((o) => o.id);

  const { data: linesData } = await admin
    .from("order_lines")
    .select("order_id, product_id, quantity, price_minor_units")
    .in("order_id", orderIds.slice(0, 2000));
  const lines =
    (linesData as
      | { order_id: string; product_id: string | null; quantity: number; price_minor_units: number }[]
      | null) ?? [];

  // Pro-rate the combined sales tax into state vs local for reporting clarity.
  const stateBps = resolvedSettings.stateSalesRateBps;
  const localBps = resolvedSettings.localSalesRateBps;

  const monthMap = new Map<string, WaTaxMonthRow>();
  const monthOrderSeen = new Map<string, Set<string>>();
  const catMap = new Map<string, WaTaxCategoryRow>();

  let cannabisBase = 0;
  let nonCannabisBase = 0;
  let stateSalesTax = 0;
  let localSalesTax = 0;
  let exciseTax = 0;

  for (const l of lines) {
    const qty = l.quantity ?? 0;
    const base = (l.price_minor_units ?? 0) * qty;
    if (base <= 0) continue;

    const category = (l.product_id ? categoryLookup.get(l.product_id) : "") || "";
    const isCannabis = isCannabisCategory(category, cannabisSet);

    // Tax engine (recreational; medical exemption handled per-sale elsewhere).
    const tax = computeLineTax({ taxableBaseMinor: base, isCannabis }, resolvedSettings);
    // Split sales tax into state/local by basis points.
    const lineStateTax = applyBps(base, stateBps);
    const lineLocalTax = applyBps(base, localBps);

    if (isCannabis) cannabisBase += base;
    else nonCannabisBase += base;
    stateSalesTax += lineStateTax;
    localSalesTax += lineLocalTax;
    exciseTax += tax.exciseTaxMinor;

    // Month bucket.
    const placed = placedById.get(l.order_id);
    if (placed) {
      const mk = monthKey(placed);
      let mr = monthMap.get(mk);
      if (!mr) {
        mr = {
          month: mk,
          label: monthLabel(mk),
          cannabisBaseMinor: 0,
          nonCannabisBaseMinor: 0,
          totalBaseMinor: 0,
          stateSalesTaxMinor: 0,
          localSalesTaxMinor: 0,
          salesTaxMinor: 0,
          exciseTaxMinor: 0,
          totalTaxMinor: 0,
          orders: 0,
        };
        monthMap.set(mk, mr);
        monthOrderSeen.set(mk, new Set());
      }
      if (isCannabis) mr.cannabisBaseMinor += base;
      else mr.nonCannabisBaseMinor += base;
      mr.totalBaseMinor += base;
      mr.stateSalesTaxMinor += lineStateTax;
      mr.localSalesTaxMinor += lineLocalTax;
      mr.salesTaxMinor += lineStateTax + lineLocalTax;
      mr.exciseTaxMinor += tax.exciseTaxMinor;
      mr.totalTaxMinor += lineStateTax + lineLocalTax + tax.exciseTaxMinor;
      const seen = monthOrderSeen.get(mk)!;
      if (!seen.has(l.order_id)) {
        seen.add(l.order_id);
        mr.orders += 1;
      }
    }

    // Category bucket.
    const catKey = category || "uncategorized";
    let cr = catMap.get(catKey);
    if (!cr) {
      cr = { category: catKey, isCannabis, baseMinor: 0, salesTaxMinor: 0, exciseTaxMinor: 0, units: 0 };
      catMap.set(catKey, cr);
    }
    cr.baseMinor += base;
    cr.salesTaxMinor += lineStateTax + lineLocalTax;
    cr.exciseTaxMinor += tax.exciseTaxMinor;
    cr.units += qty;
  }

  const salesTax = stateSalesTax + localSalesTax;
  const totalTax = salesTax + exciseTax;
  const totalBase = cannabisBase + nonCannabisBase;

  const byMonth = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const byCategory = [...catMap.values()].sort((a, b) => b.baseMinor - a.baseMinor);

  return {
    hasData: totalBase > 0,
    settings: resolvedSettings,
    combinedSalesRatePct,
    exciseRatePct,
    cannabisBaseMinor: cannabisBase,
    nonCannabisBaseMinor: nonCannabisBase,
    totalBaseMinor: totalBase,
    stateSalesTaxMinor: stateSalesTax,
    localSalesTaxMinor: localSalesTax,
    salesTaxMinor: salesTax,
    exciseTaxMinor: exciseTax,
    totalTaxMinor: totalTax,
    orders: valid.length,
    byMonth,
    byCategory,
  };
}
