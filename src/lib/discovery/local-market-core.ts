/**
 * src/lib/discovery/local-market-core.ts
 *
 * PURE presentation semantic layer for the LOCAL benchmarks command center
 * (Slice 9, Reports → Benchmarks).
 *
 * `local-benchmarks-core.ts` already aggregates the month's rollups into
 * LocalCompetitorStat / LocalAreaStat. This module does the next step and
 * only that step: derive the decision metrics (velocity, fair share, spread
 * against the area, DOH exposure), shape the drill-down payloads, and define
 * the CSV columns.
 *
 * It deliberately reuses the primitives in `statewide-market-core.ts` —
 * ratioOrNull, compareValues/sortRows, matchesQuery, buildFacet, csvCell,
 * rowsToCsv, computeConcentration. "Velocity" and "fair share" must mean
 * exactly the same thing on the statewide page and the local page, or the two
 * screens will quietly disagree and the owner will trust neither.
 *
 * Standing rules honored:
 *  - NEVER GUESS: never measured stays null and renders "—". Never 0.
 *  - Money in MINOR UNITS.
 *  - No I/O, no React — covered by tests/compliance/local-market-core.test.ts.
 *  - The transformer structurally EXCLUDES the owner's own license from
 *    competitor stats, so these rows are competitor-only by construction and
 *    the copy must never imply Greenway is in the ranking.
 */

import {
  computeConcentration,
  ratioOrNull,
  minorToCsvAmount,
  fractionToCsvPct,
  type Concentration,
  type CsvColumn,
  type MixDetail,
} from "./statewide-market-core";

// ---------------------------------------------------------------------------
// Structural inputs — match LocalCompetitorStat / LocalAreaStat without
// importing them, so this module stays independently testable.
// ---------------------------------------------------------------------------

export type LocalCompetitorLike = {
  licenseNumber: string;
  tradename: string;
  area: string;
  city: string | null;
  retailUnits: number;
  retailRevenueMinor: number;
  retailLineCount: number;
  priceSampleSize: number;
  priceP25Minor: number | null;
  priceMedianMinor: number | null;
  priceP75Minor: number | null;
  priceAvgMinor: number | null;
  byType: Array<{ inventoryType: string; units: number; revenueMinor: number }>;
  topProducts: Array<{
    productName: string;
    inventoryType: string | null;
    units: number;
    revenueMinor: number;
    medianUnitPriceMinor: number | null;
  }>;
  wholesaleLineCount: number;
  wholesaleSpendMinor: number;
  topSuppliers: Array<{
    licenseeId: string;
    licenseNumber: string | null;
    displayName: string;
    lineCount: number;
    spendMinor: number;
  }>;
};

export type LocalAreaLike = {
  area: string;
  storeCount: number;
  retailLineCount: number;
  retailUnits: number;
  retailRevenueMinor: number;
  retailMedianMinor: number | null;
  retailAvgMinor: number | null;
};

function nonNegOrNull(n: number | null | undefined): number | null {
  if (n == null || typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Level 1 — one row per competitor store
// ---------------------------------------------------------------------------

export type LocalStoreRow = {
  licenseNumber: string;
  tradename: string;
  area: string;
  city: string | null;
  units: number | null;
  revenueMinor: number | null;
  lineCount: number | null;
  priceSampleSize: number | null;
  p25Minor: number | null;
  medianMinor: number | null;
  p75Minor: number | null;
  /** Share (0..1) of measured revenue across the stores in scope. */
  revenueShare: number | null;
  /** Revenue per sale line — a basket-size proxy. */
  revenuePerLineMinor: number | null;
  typesCarried: number | null;
  /** Revenue per category carried (NielsenIQ velocity). */
  velocityMinor: number | null;
  /** 100 = par against assortment breadth. */
  fairShareIndex: number | null;
  wholesaleSpendMinor: number | null;
  wholesaleLineCount: number | null;
  /**
   * Observed retail revenue minus observed wholesale spend, minor units.
   * NOT profit: the two sides are measured over the same month but a store's
   * purchases and sales do not line up unit for unit, and neither figure is a
   * complete book. It is a directional buy-vs-sell gauge and is labeled as
   * such wherever it renders.
   */
  buySellGapMinor: number | null;
  /** Distinct suppliers observed shipping to this store. */
  supplierCount: number | null;
  /**
   * This store's median price minus its AREA's median, minor units.
   * Negative = cheaper than the area. Null unless both were measured.
   */
  vsAreaMinor: number | null;
  vsAreaPct: number | null;
  detail: MixDetail;
  suppliers: Array<{ name: string; licenseNumber: string | null; lineCount: number; spendMinor: number }>;
};

/**
 * Shape competitor stats into store rows, with each store priced against its
 * OWN area rather than a single statewide number — a Port Orchard store
 * undercutting Tacoma is not undercutting anyone who matters to Michael.
 */
export function buildLocalStoreRows(
  competitors: LocalCompetitorLike[],
  areas: LocalAreaLike[],
): LocalStoreRow[] {
  const areaMedian = new Map<string, number | null>();
  for (const a of areas ?? []) {
    if (a && typeof a.area === "string") areaMedian.set(a.area, nonNegOrNull(a.retailMedianMinor));
  }

  const cleaned = (competitors ?? []).filter(
    (c) => c && typeof c.licenseNumber === "string" && c.licenseNumber.trim() !== "",
  );

  let revenueTotal = 0;
  let typesTotal = 0;
  const typeCount = new Map<string, number>();
  for (const c of cleaned) {
    const rev = nonNegOrNull(c.retailRevenueMinor);
    if (rev != null) revenueTotal += rev;
    const t = Array.isArray(c.byType) ? new Set(c.byType.map((x) => x.inventoryType)).size : 0;
    typeCount.set(c.licenseNumber, t);
    typesTotal += t;
  }

  const rows: LocalStoreRow[] = cleaned.map((c) => {
    const revenueMinor = nonNegOrNull(c.retailRevenueMinor);
    const lineCount = nonNegOrNull(c.retailLineCount);
    const types = typeCount.get(c.licenseNumber) ?? 0;
    const typesCarried = types > 0 ? types : null;
    const revenueShare = ratioOrNull(revenueMinor, revenueTotal);
    const assortmentShare = ratioOrNull(types, typesTotal);
    const median = nonNegOrNull(c.priceMedianMinor);
    const areaMed = areaMedian.get(c.area) ?? null;
    const vsAreaMinor = median != null && areaMed != null ? median - areaMed : null;
    const spend = nonNegOrNull(c.wholesaleSpendMinor);

    return {
      licenseNumber: c.licenseNumber,
      tradename: c.tradename,
      area: c.area,
      city: typeof c.city === "string" && c.city.trim() !== "" ? c.city.trim() : null,
      units: nonNegOrNull(c.retailUnits),
      revenueMinor,
      lineCount,
      priceSampleSize: nonNegOrNull(c.priceSampleSize),
      p25Minor: nonNegOrNull(c.priceP25Minor),
      medianMinor: median,
      p75Minor: nonNegOrNull(c.priceP75Minor),
      revenueShare,
      revenuePerLineMinor:
        revenueMinor != null && lineCount != null && lineCount > 0 ? Math.round(revenueMinor / lineCount) : null,
      typesCarried,
      velocityMinor:
        revenueMinor != null && typesCarried != null ? Math.round(revenueMinor / typesCarried) : null,
      fairShareIndex:
        revenueShare != null && assortmentShare != null && assortmentShare > 0
          ? (revenueShare / assortmentShare) * 100
          : null,
      wholesaleSpendMinor: spend,
      wholesaleLineCount: nonNegOrNull(c.wholesaleLineCount),
      // Only meaningful when BOTH sides were observed this month.
      buySellGapMinor: revenueMinor != null && spend != null && spend > 0 ? revenueMinor - spend : null,
      supplierCount: Array.isArray(c.topSuppliers) && c.topSuppliers.length > 0 ? c.topSuppliers.length : null,
      vsAreaMinor,
      vsAreaPct: vsAreaMinor != null && areaMed != null && areaMed > 0 ? vsAreaMinor / areaMed : null,
      detail: {
        types: (Array.isArray(c.byType) ? c.byType : [])
          .filter((t) => t && typeof t.inventoryType === "string" && t.inventoryType.trim() !== "")
          .map((t) => ({
            inventoryType: t.inventoryType,
            units: t.units,
            revenueMinor: t.revenueMinor,
            // The competitor rollup carries no per-type line count or median.
            // Neutral placeholders, never borrowed from another figure.
            lineCount: 0,
            medianUnitPriceMinor: null,
          }))
          .sort((a, b) => (nonNegOrNull(b.revenueMinor) ?? -1) - (nonNegOrNull(a.revenueMinor) ?? -1)),
        products: (Array.isArray(c.topProducts) ? c.topProducts : [])
          .filter((p) => p && typeof p.productName === "string" && p.productName.trim() !== "")
          .map((p) => ({
            productName: p.productName,
            inventoryType: p.inventoryType,
            brand: null,
            units: p.units,
            revenueMinor: p.revenueMinor,
            medianUnitPriceMinor: p.medianUnitPriceMinor,
          }))
          .sort((a, b) => (nonNegOrNull(b.revenueMinor) ?? -1) - (nonNegOrNull(a.revenueMinor) ?? -1)),
      },
      suppliers: (Array.isArray(c.topSuppliers) ? c.topSuppliers : [])
        .map((s) => ({
          name: s.displayName,
          licenseNumber: s.licenseNumber,
          lineCount: s.lineCount,
          spendMinor: s.spendMinor,
        }))
        .sort((a, b) => (nonNegOrNull(b.spendMinor) ?? -1) - (nonNegOrNull(a.spendMinor) ?? -1)),
    };
  });

  rows.sort((a, b) => (b.revenueMinor ?? -1) - (a.revenueMinor ?? -1) || a.tradename.localeCompare(b.tradename));
  return rows;
}

// ---------------------------------------------------------------------------
// Area rollup
// ---------------------------------------------------------------------------

export type LocalAreaRow = {
  area: string;
  storeCount: number | null;
  units: number | null;
  revenueMinor: number | null;
  lineCount: number | null;
  medianMinor: number | null;
  avgMinor: number | null;
  /** Share (0..1) of measured revenue across all areas. */
  revenueShare: number | null;
  revenuePerStoreMinor: number | null;
};

export function buildLocalAreaRows(areas: LocalAreaLike[]): LocalAreaRow[] {
  const cleaned = (areas ?? []).filter((a) => a && typeof a.area === "string" && a.area.trim() !== "");
  let total = 0;
  for (const a of cleaned) {
    const rev = nonNegOrNull(a.retailRevenueMinor);
    if (rev != null) total += rev;
  }
  const rows = cleaned.map((a) => {
    const revenueMinor = nonNegOrNull(a.retailRevenueMinor);
    const storeCount = nonNegOrNull(a.storeCount);
    return {
      area: a.area,
      storeCount,
      units: nonNegOrNull(a.retailUnits),
      revenueMinor,
      lineCount: nonNegOrNull(a.retailLineCount),
      medianMinor: nonNegOrNull(a.retailMedianMinor),
      avgMinor: nonNegOrNull(a.retailAvgMinor),
      revenueShare: ratioOrNull(revenueMinor, total),
      revenuePerStoreMinor:
        revenueMinor != null && storeCount != null && storeCount > 0 ? Math.round(revenueMinor / storeCount) : null,
    };
  });
  rows.sort((a, b) => (b.revenueMinor ?? -1) - (a.revenueMinor ?? -1) || a.area.localeCompare(b.area));
  return rows;
}

// ---------------------------------------------------------------------------
// Vendor lens — who supplies the neighborhood
// ---------------------------------------------------------------------------

export type LocalVendorRow = {
  licenseeId: string;
  licenseNumber: string | null;
  name: string;
  /** Distinct tracked competitors this vendor shipped to this month. */
  buyerCount: number;
  buyerNames: string[];
  spendMinor: number | null;
  lineCount: number | null;
  /** Average spend per buying store — how deep each account runs. */
  spendPerBuyerMinor: number | null;
  /** Share (0..1) of all observed local wholesale spend. */
  spendShare: number | null;
  /** True when 2+ tracked competitors buy from them — proven local demand. */
  multiCompetitor: boolean;
};

/**
 * Roll every tracked competitor's observed suppliers into one vendor list.
 *
 * IMPORTANT COVERAGE NOTE: each competitor rollup keeps only its TOP suppliers
 * by spend (≤10), so a vendor sitting eleventh at every store is invisible
 * here. `buyerCount` is therefore "tracked stores where this vendor is a TOP
 * supplier", which is a floor, not a census. The UI states this.
 */
export function buildLocalVendorRows(stores: LocalStoreRow[]): LocalVendorRow[] {
  type Acc = {
    licenseNumber: string | null;
    name: string;
    buyers: Map<string, number>;
    spend: number;
    lines: number;
  };
  const byVendor = new Map<string, Acc>();

  for (const store of stores ?? []) {
    for (const s of store.suppliers) {
      const key = s.licenseNumber ?? s.name;
      if (!key) continue;
      let acc = byVendor.get(key);
      if (!acc) {
        acc = { licenseNumber: s.licenseNumber, name: s.name, buyers: new Map(), spend: 0, lines: 0 };
        byVendor.set(key, acc);
      }
      const spend = nonNegOrNull(s.spendMinor) ?? 0;
      acc.spend += spend;
      acc.lines += nonNegOrNull(s.lineCount) ?? 0;
      // Keep the largest account per buyer so buyerNames ranks sensibly.
      acc.buyers.set(store.tradename, Math.max(acc.buyers.get(store.tradename) ?? 0, spend));
    }
  }

  let total = 0;
  for (const acc of byVendor.values()) total += acc.spend;

  const rows: LocalVendorRow[] = [...byVendor.entries()].map(([key, acc]) => {
    // Spend descending, then name ascending. The name tie-break is REQUIRED:
    // without it two buyers with identical spend would order by Map insertion,
    // which depends on row arrival order, so the same month could export two
    // different CSVs. Exports must be byte-reproducible.
    const buyerNames = [...acc.buyers.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([n]) => n);
    return {
      licenseeId: key,
      licenseNumber: acc.licenseNumber,
      name: acc.name,
      buyerCount: buyerNames.length,
      buyerNames,
      spendMinor: acc.spend,
      lineCount: acc.lines,
      spendPerBuyerMinor: buyerNames.length > 0 ? Math.round(acc.spend / buyerNames.length) : null,
      spendShare: ratioOrNull(acc.spend, total),
      multiCompetitor: buyerNames.length >= 2,
    };
  });

  rows.sort(
    (a, b) =>
      b.buyerCount - a.buyerCount || (b.spendMinor ?? -1) - (a.spendMinor ?? -1) || a.name.localeCompare(b.name),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// The ten-second read
// ---------------------------------------------------------------------------

export type LocalHeadline = {
  storeCount: number;
  /** The owner's home-area median — the number that actually sets his price. */
  homeAreaMedianMinor: number | null;
  homeAreaStoreCount: number | null;
  totalRevenueMinor: number | null;
  totalWholesaleSpendMinor: number | null;
  cheapestStore: { tradename: string; medianMinor: number } | null;
  priciestStore: { tradename: string; medianMinor: number } | null;
  /** How concentrated local retail revenue is across tracked stores. */
  concentration: Concentration;
  /** Vendors shipping to 2+ tracked competitors — the priority call list. */
  multiCompetitorVendorCount: number;
};

export function buildLocalHeadline(args: {
  stores: LocalStoreRow[];
  areas: LocalAreaRow[];
  vendors: LocalVendorRow[];
  homeArea: string;
}): LocalHeadline {
  const { stores, areas, vendors, homeArea } = args;
  const home = areas.find((a) => a.area === homeArea) ?? null;

  let revenue: number | null = null;
  let spend: number | null = null;
  for (const s of stores) {
    if (s.revenueMinor != null) revenue = (revenue ?? 0) + s.revenueMinor;
    if (s.wholesaleSpendMinor != null) spend = (spend ?? 0) + s.wholesaleSpendMinor;
  }

  // Only stores with a MEASURED median can win "cheapest" or "priciest".
  const priced = stores.filter((s) => s.medianMinor != null) as Array<LocalStoreRow & { medianMinor: number }>;
  const sorted = [...priced].sort((a, b) => a.medianMinor - b.medianMinor);

  return {
    storeCount: stores.length,
    homeAreaMedianMinor: home?.medianMinor ?? null,
    homeAreaStoreCount: home?.storeCount ?? null,
    totalRevenueMinor: revenue,
    totalWholesaleSpendMinor: spend,
    cheapestStore: sorted.length > 0 ? { tradename: sorted[0].tradename, medianMinor: sorted[0].medianMinor } : null,
    priciestStore:
      sorted.length > 0
        ? { tradename: sorted[sorted.length - 1].tradename, medianMinor: sorted[sorted.length - 1].medianMinor }
        : null,
    concentration: computeConcentration(stores.map((s) => s.revenueMinor)),
    multiCompetitorVendorCount: vendors.filter((v) => v.multiCompetitor).length,
  };
}

// ---------------------------------------------------------------------------
// Extract
// ---------------------------------------------------------------------------

export const LOCAL_STORE_CSV_COLUMNS: ReadonlyArray<CsvColumn<LocalStoreRow>> = [
  { header: "license_number", value: (r) => r.licenseNumber },
  { header: "store", value: (r) => r.tradename },
  { header: "area", value: (r) => r.area },
  { header: "city", value: (r) => r.city ?? "" },
  { header: "retail_units", value: (r) => r.units ?? "" },
  { header: "retail_revenue", value: (r) => minorToCsvAmount(r.revenueMinor) },
  { header: "revenue_share_pct", value: (r) => fractionToCsvPct(r.revenueShare) },
  { header: "p25_price", value: (r) => minorToCsvAmount(r.p25Minor) },
  { header: "median_price", value: (r) => minorToCsvAmount(r.medianMinor) },
  { header: "p75_price", value: (r) => minorToCsvAmount(r.p75Minor) },
  { header: "vs_area_median", value: (r) => minorToCsvAmount(r.vsAreaMinor) },
  { header: "vs_area_median_pct", value: (r) => fractionToCsvPct(r.vsAreaPct) },
  { header: "revenue_per_line", value: (r) => minorToCsvAmount(r.revenuePerLineMinor) },
  { header: "types_carried", value: (r) => r.typesCarried ?? "" },
  { header: "velocity_per_type", value: (r) => minorToCsvAmount(r.velocityMinor) },
  { header: "fair_share_index", value: (r) => (r.fairShareIndex == null ? "" : r.fairShareIndex.toFixed(1)) },
  { header: "wholesale_spend", value: (r) => minorToCsvAmount(r.wholesaleSpendMinor) },
  { header: "buy_sell_gap", value: (r) => minorToCsvAmount(r.buySellGapMinor) },
  { header: "suppliers_observed", value: (r) => r.supplierCount ?? "" },
];

export const LOCAL_AREA_CSV_COLUMNS: ReadonlyArray<CsvColumn<LocalAreaRow>> = [
  { header: "area", value: (r) => r.area },
  { header: "stores", value: (r) => r.storeCount ?? "" },
  { header: "retail_units", value: (r) => r.units ?? "" },
  { header: "retail_revenue", value: (r) => minorToCsvAmount(r.revenueMinor) },
  { header: "revenue_share_pct", value: (r) => fractionToCsvPct(r.revenueShare) },
  { header: "revenue_per_store", value: (r) => minorToCsvAmount(r.revenuePerStoreMinor) },
  { header: "median_price", value: (r) => minorToCsvAmount(r.medianMinor) },
  { header: "avg_price", value: (r) => minorToCsvAmount(r.avgMinor) },
];

export const LOCAL_VENDOR_CSV_COLUMNS: ReadonlyArray<CsvColumn<LocalVendorRow>> = [
  { header: "license_number", value: (r) => r.licenseNumber ?? "" },
  { header: "vendor", value: (r) => r.name },
  { header: "tracked_buyers", value: (r) => r.buyerCount },
  { header: "buyers", value: (r) => r.buyerNames.join("; ") },
  { header: "observed_spend", value: (r) => minorToCsvAmount(r.spendMinor) },
  { header: "spend_share_pct", value: (r) => fractionToCsvPct(r.spendShare) },
  { header: "spend_per_buyer", value: (r) => minorToCsvAmount(r.spendPerBuyerMinor) },
  { header: "lines", value: (r) => r.lineCount ?? "" },
  { header: "multi_competitor", value: (r) => (r.multiCompetitor ? "yes" : "no") },
];
