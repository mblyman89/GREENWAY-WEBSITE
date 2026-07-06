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
 * Everything is computed from COMPLETED orders, bucketed by calendar month of
 * completed_at (Pacific time) — the CANONICAL period basis shared with the
 * LIQ-1295 excise return and the CCRS Sale.csv (see docs/PERIOD_BASIS.md), so
 * the three filings always reconcile. Money in MINOR UNITS (cents). State/local
 * split is pro-rated from the configured basis points.
 *
 * S-8: lines covered by a WAC 314-55-090(2) medical exempt-sale record report
 * their exempted tax as ZERO here and the exempted amounts separately.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, pagedAll } from "@/lib/supabase/chunked-in";
import { pacificMonthKey } from "@/lib/reports/timezone";
import {
  getTaxSettings,
  getCannabisCategorySet,
  isCannabisCategory,
  computeLineTax,
  applyBps,
  detectTaxInclusive,
  normalizeTaxableBase,
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

/** Tax by detailed POS product type (mirrors the Sales / COGS "by type" tables). */
export type WaTaxTypeRow = {
  type: string;
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
  // Non-cannabis (sales-tax-only) subtotals for the dedicated taxable
  // non-cannabis section. Excise never applies to these.
  nonCannabisSalesTaxMinor: number;
  nonCannabisUnits: number;
  // S-8 — medical exemptions (WAC 314-55-090(2), RCW 69.51A.230). The LIQ-1295
  // needs BOTH the taxable figure and the exempt figure, so exempted amounts
  // are reported separately and EXCLUDED from the tax totals above.
  /** Pre-tax base of lines covered by a medical exempt-sale record. */
  medicalExemptBaseMinor: number;
  /** 37% excise NOT collected because the line was excise-exempt. */
  medicalExemptExciseMinor: number;
  /** Sales tax NOT collected because the line was sales-tax-exempt. */
  medicalExemptSalesTaxMinor: number;
  /** Lines matched to a medical exempt-sale record in the range. */
  medicalExemptLines: number;
  /** Exempt records in range that could not be matched to a sold line. */
  medicalExemptUnmatchedRecords: number;
  // Breakdowns
  byMonth: WaTaxMonthRow[];
  byCategory: WaTaxCategoryRow[];
  byType: WaTaxTypeRow[];
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
  return pacificMonthKey(iso); // YYYY-MM in Pacific time
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_LABELS[idx] ?? m} ${y}`;
}

type ProductTaxMeta = { category: string; type: string };
type ProductLookup = Map<string, ProductTaxMeta>; // source_item_id -> {category, type}

async function buildCategoryLookup(
  admin: ReturnType<typeof createSupabaseAdminClient>,
): Promise<ProductLookup> {
  const lookup: ProductLookup = new Map();
  // S-7: page past the PostgREST per-response row cap so no product's
  // category snapshot is silently dropped (a dropped row misclassifies its
  // lines as non-cannabis and understates excise).
  type MenuRow = {
    source_item_id: string;
    category: string | null;
    pos_inventory_type: string | null;
    pos_inventory_category: string | null;
  };
  const rows = await pagedAll<MenuRow>(async (from, to) => {
    const { data } = await admin
      .from("menu_items")
      .select("source_item_id, category, pos_inventory_type, pos_inventory_category, created_at")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    return (data as MenuRow[] | null) ?? [];
  });
  for (const r of rows) {
    if (!r.source_item_id || lookup.has(r.source_item_id)) continue;
    const category = r.category?.trim() || "";
    // Detailed POS type mirrors the Sales / COGS reports.
    const type =
      r.pos_inventory_type?.trim() || r.pos_inventory_category?.trim() || category || "Untyped";
    lookup.set(r.source_item_id, { category, type });
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
    taxBaseMode: "pre_tax" as const,
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
    nonCannabisSalesTaxMinor: 0,
    nonCannabisUnits: 0,
    medicalExemptBaseMinor: 0,
    medicalExemptExciseMinor: 0,
    medicalExemptSalesTaxMinor: 0,
    medicalExemptLines: 0,
    medicalExemptUnmatchedRecords: 0,
    byMonth: [],
    byCategory: [],
    byType: [],
  };

  if (!isSupabaseServiceConfigured) return empty;
  const admin = createSupabaseAdminClient();

  const [cannabisSet, categoryLookup] = await Promise.all([
    getCannabisCategorySet(),
    buildCategoryLookup(admin),
  ]);

  // S-7: page the base query too — PostgREST caps any single response at
  // db.max_rows (default 1000), so a busy range would silently drop orders.
  //
  // S-8 canonical period basis (docs/PERIOD_BASIS.md): tax filings are based
  // on COMPLETED orders bucketed by completed_at — the same basis the
  // LIQ-1295 builder (excise-return.ts) and the CCRS Sale.csv use, so the
  // three always reconcile. Previously this report used placed_at over all
  // non-cancelled orders, which could overstate tax with never-completed
  // orders and disagree with the excise return by a day at month boundaries.
  type OrderRow = {
    id: string;
    status: string;
    placed_at: string;
    completed_at: string | null;
    subtotal_minor_units: number | null;
    estimated_tax_minor_units: number | null;
    total_minor_units: number | null;
  };
  const orders = await pagedAll<OrderRow>(async (from, to) => {
    const { data } = await admin
      .from("orders")
      .select("id, status, placed_at, completed_at, subtotal_minor_units, estimated_tax_minor_units, total_minor_units")
      .eq("status", "completed")
      // completed_at basis with a placed_at fallback for legacy completed
      // orders that predate the completed_at column (docs/PERIOD_BASIS.md).
      .or(
        `and(completed_at.gte.${fromISO},completed_at.lte.${toISO}),and(completed_at.is.null,placed_at.gte.${fromISO},placed_at.lte.${toISO})`,
      )
      .order("id", { ascending: true })
      .range(from, to);
    return (data as OrderRow[] | null) ?? [];
  });
  // Base query already filters to completed orders (canonical period basis).
  const valid = orders;
  if (valid.length === 0) return empty;

  // Month bucketing follows the same canonical basis: completed_at.
  const placedById = new Map(valid.map((o) => [o.id, o.completed_at ?? o.placed_at]));
  // Per-order tax-inclusive resolution (only consulted in "auto" mode).
  const inclusiveByOrder = new Map<string, boolean>();
  if (resolvedSettings.taxBaseMode === "auto") {
    for (const o of valid) {
      const det = detectTaxInclusive({
        subtotalMinor: o.subtotal_minor_units,
        estimatedTaxMinor: o.estimated_tax_minor_units,
        totalMinor: o.total_minor_units,
      });
      if (det != null) inclusiveByOrder.set(o.id, det);
    }
  }
  const orderIds = valid.map((o) => o.id);

  // S-7: chunked + paginated — every line of every order in range, no caps.
  type LineRow = { order_id: string; product_id: string | null; quantity: number; price_minor_units: number };
  const lines = await chunkedIn<string, LineRow>(orderIds, async (chunk, from, to) => {
    const { data } = await admin
      .from("order_lines")
      .select("order_id, product_id, quantity, price_minor_units")
      .in("order_id", chunk)
      .order("id", { ascending: true })
      .range(from, to);
    return (data as LineRow[] | null) ?? [];
  });

  // S-8: medical exemptions — join medical_exempt_sales (WAC 314-55-090(2))
  // by (order_id, product_sku=product_id) so exempt lines contribute ZERO to
  // the collected-tax totals and their exempted amounts are reported
  // separately (the LIQ-1295 needs both numbers).
  const exemptByOrderSku = new Map<string, { salesExempt: boolean; exciseExempt: boolean; matched: boolean }>();
  {
    type ExemptRow = {
      order_id: string | null;
      product_sku: string | null;
      sales_tax_exempt: boolean | null;
      excise_tax_exempt: boolean | null;
    };
    const exemptRows = await pagedAll<ExemptRow>(async (from, to) => {
      const { data } = await admin
        .from("medical_exempt_sales")
        .select("order_id, product_sku, sales_tax_exempt, excise_tax_exempt, sale_date, id")
        .gte("sale_date", fromISO.slice(0, 10))
        .lte("sale_date", toISO.slice(0, 10))
        .order("id", { ascending: true })
        .range(from, to);
      return (data as ExemptRow[] | null) ?? [];
    });
    for (const r of exemptRows) {
      if (!r.order_id || !r.product_sku) continue;
      const key = `${r.order_id}|${r.product_sku}`;
      const prev = exemptByOrderSku.get(key);
      exemptByOrderSku.set(key, {
        salesExempt: (prev?.salesExempt ?? false) || r.sales_tax_exempt === true,
        exciseExempt: (prev?.exciseExempt ?? false) || r.excise_tax_exempt === true,
        matched: prev?.matched ?? false,
      });
    }
  }
  let medicalExemptBase = 0;
  let medicalExemptExcise = 0;
  let medicalExemptSalesTax = 0;
  let medicalExemptLines = 0;

  // Pro-rate the combined sales tax into state vs local for reporting clarity.
  const stateBps = resolvedSettings.stateSalesRateBps;
  const localBps = resolvedSettings.localSalesRateBps;

  const monthMap = new Map<string, WaTaxMonthRow>();
  const monthOrderSeen = new Map<string, Set<string>>();
  const catMap = new Map<string, WaTaxCategoryRow>();
  const typeMap = new Map<string, WaTaxTypeRow>();

  let cannabisBase = 0;
  let nonCannabisBase = 0;
  let stateSalesTax = 0;
  let localSalesTax = 0;
  let exciseTax = 0;
  let nonCannabisSalesTax = 0;
  let nonCannabisUnits = 0;

  for (const l of lines) {
    const qty = l.quantity ?? 0;
    const storedBase = (l.price_minor_units ?? 0) * qty;
    if (storedBase <= 0) continue;

    const meta = l.product_id ? categoryLookup.get(l.product_id) : undefined;
    const category = meta?.category || "";
    const type = meta?.type || "Untyped";
    const isCannabis = isCannabisCategory(category, cannabisSet);

    // Robustness: if prices are (or look) tax-inclusive, back the tax out so the
    // reported BASE is always pre-tax — regardless of how the POS stores prices.
    const base = normalizeTaxableBase(storedBase, resolvedSettings, {
      isCannabis,
      resolvedInclusive: inclusiveByOrder.get(l.order_id),
    });

    // Tax engine (recreational rates first).
    const recTax = computeLineTax({ taxableBaseMinor: base, isCannabis }, resolvedSettings);
    // S-8: apply the WAC 314-55-090(2) medical exemptions per line. The two
    // exemptions are independent (sales tax vs 37% excise): zero what was
    // exempted at the register and track it separately for the LIQ-1295.
    const exemptKey = l.product_id ? `${l.order_id}|${l.product_id}` : null;
    const exempt = exemptKey ? exemptByOrderSku.get(exemptKey) : undefined;
    const salesExempt = exempt?.salesExempt === true;
    const exciseExempt = exempt?.exciseExempt === true;
    if (exempt) {
      exempt.matched = true;
      medicalExemptLines += 1;
      medicalExemptBase += base;
      if (salesExempt) medicalExemptSalesTax += applyBps(base, stateBps) + applyBps(base, localBps);
      if (exciseExempt) medicalExemptExcise += recTax.exciseTaxMinor;
    }
    const tax = { ...recTax, exciseTaxMinor: exciseExempt ? 0 : recTax.exciseTaxMinor };
    // Split sales tax into state/local by basis points (zeroed when exempt).
    const lineStateTax = salesExempt ? 0 : applyBps(base, stateBps);
    const lineLocalTax = salesExempt ? 0 : applyBps(base, localBps);

    if (isCannabis) {
      cannabisBase += base;
    } else {
      nonCannabisBase += base;
      nonCannabisSalesTax += lineStateTax + lineLocalTax;
      nonCannabisUnits += qty;
    }
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

    // Type bucket (detailed POS type).
    const typeKey = type || "Untyped";
    let tr = typeMap.get(typeKey);
    if (!tr) {
      tr = { type: typeKey, isCannabis, baseMinor: 0, salesTaxMinor: 0, exciseTaxMinor: 0, units: 0 };
      typeMap.set(typeKey, tr);
    }
    tr.baseMinor += base;
    tr.salesTaxMinor += lineStateTax + lineLocalTax;
    tr.exciseTaxMinor += tax.exciseTaxMinor;
    tr.units += qty;
  }

  const salesTax = stateSalesTax + localSalesTax;
  const totalTax = salesTax + exciseTax;
  const totalBase = cannabisBase + nonCannabisBase;

  // S-8: exempt records that never matched a sold line (wrong/missing SKU or
  // order id) — surfaced so the owner can fix the record before filing.
  let medicalExemptUnmatchedRecords = 0;
  for (const v of exemptByOrderSku.values()) {
    if (!v.matched) medicalExemptUnmatchedRecords += 1;
  }

  const byMonth = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  const byCategory = [...catMap.values()].sort((a, b) => b.baseMinor - a.baseMinor);
  const byType = [...typeMap.values()].sort((a, b) => b.baseMinor - a.baseMinor);

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
    nonCannabisSalesTaxMinor: nonCannabisSalesTax,
    nonCannabisUnits,
    medicalExemptBaseMinor: medicalExemptBase,
    medicalExemptExciseMinor: medicalExemptExcise,
    medicalExemptSalesTaxMinor: medicalExemptSalesTax,
    medicalExemptLines,
    medicalExemptUnmatchedRecords,
    byMonth,
    byCategory,
    byType,
  };
}
