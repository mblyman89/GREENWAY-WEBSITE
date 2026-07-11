/**
 * src/lib/discovery/local-benchmarks-core.ts
 *
 * PURE competitor/area shaping for Reports → Local Benchmarks (Task H, S6).
 * Turns the persisted per-competitor rollups from the monthly CCRS transformer
 * (migration 0106 `discovery_competitor_stats`) plus the verified WSLCB roster
 * (`discovery_competitors`) into the report page's local views:
 *
 *  - one row per tracked competitor (price bands, volume, top products), and
 *  - one honest area rollup per area (median of each store's median — the
 *    same labeled proxy the legacy view uses; a true pooled median would need
 *    raw rows the transformer deliberately does not upload).
 *
 * Standing rules honored:
 *  - NEVER GUESS: missing price bands stay null (UI renders "—"), junk numbers
 *    coerce to 0/null — never a fabricated figure. Unknown licenses fall back
 *    to the stat row's own CCRS name, never an invented tradename.
 *  - Money in MINOR UNITS end to end.
 *  - Pure module: no I/O — covered by tests/compliance/local-benchmarks-core.test.ts.
 */
import type { DiscoveryCompetitorArea } from "@/lib/discovery/types";

// ---------------------------------------------------------------------------
// Inputs — structurally match DiscoveryCompetitorStatRow / DiscoveryCompetitor.
// ---------------------------------------------------------------------------

export type CompetitorStatLike = {
  license_number: string;
  name: string | null;
  dba: string | null;
  city: string | null;
  retail_units: number;
  retail_revenue_minor: number;
  retail_line_count: number;
  price_sample_size: number;
  price_min_minor: number | null;
  price_p25_minor: number | null;
  price_median_minor: number | null;
  price_p75_minor: number | null;
  price_max_minor: number | null;
  price_avg_minor: number | null;
  by_type: Array<{ inventoryType: string; units: number; revenueMinor: number }>;
  top_products: Array<{
    productName: string;
    inventoryType: string | null;
    units: number;
    revenueMinor: number;
    medianUnitPriceMinor: number | null;
  }>;
};

export type RosterEntryLike = {
  license_number: string;
  tradename: string;
  area: DiscoveryCompetitorArea;
  city: string | null;
  is_self: boolean;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type LocalCompetitorStat = {
  licenseNumber: string;
  /** Roster tradename, else the CCRS DBA/name, else "License <n>". */
  tradename: string;
  area: DiscoveryCompetitorArea;
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
};

export type LocalAreaStat = {
  area: DiscoveryCompetitorArea;
  storeCount: number;
  retailLineCount: number;
  retailUnits: number;
  retailRevenueMinor: number;
  /** Median of each store's median unit price — labeled proxy, never pooled. */
  retailMedianMinor: number | null;
  /** Average of each store's average unit price. */
  retailAvgMinor: number | null;
};

export type LocalBenchmarks = {
  competitors: LocalCompetitorStat[];
  areas: LocalAreaStat[];
};

/** Stable area ordering for the report (mirrors competitors.ts AREA_ORDER). */
export const LOCAL_AREA_ORDER: DiscoveryCompetitorArea[] = [
  "port_orchard",
  "bremerton",
  "silverdale",
  "key_peninsula",
  "kitsap_other",
  "tacoma",
  "other",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCount(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return v;
}

function minorOrNull(n: unknown): number | null {
  if (n == null) return null;
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

/** Nearest-rank median (same convention as the aggregator's percentiles). */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.5 * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Join the transformer's competitor stats to the roster and roll up areas.
 * Self is structurally absent from transformer stats (the aggregator excludes
 * the owner's own license — POS owns those numbers), but is filtered here too
 * as a belt-and-braces guard for the area rollups.
 */
export function buildLocalBenchmarks(
  stats: CompetitorStatLike[],
  roster: RosterEntryLike[],
): LocalBenchmarks {
  const byLicense = new Map<string, RosterEntryLike>();
  for (const r of roster) {
    if (r.license_number) byLicense.set(r.license_number, r);
  }

  const competitors: LocalCompetitorStat[] = [];
  for (const s of stats) {
    if (!s.license_number) continue;
    const roster = byLicense.get(s.license_number);
    if (roster?.is_self) continue; // market = competitors, never us
    competitors.push({
      licenseNumber: s.license_number,
      tradename:
        roster?.tradename ?? s.dba ?? s.name ?? `License ${s.license_number}`,
      area: roster?.area ?? "other",
      city: roster?.city ?? s.city ?? null,
      retailUnits: toCount(s.retail_units),
      retailRevenueMinor: Math.round(toCount(s.retail_revenue_minor)),
      retailLineCount: toCount(s.retail_line_count),
      priceSampleSize: toCount(s.price_sample_size),
      priceP25Minor: minorOrNull(s.price_p25_minor),
      priceMedianMinor: minorOrNull(s.price_median_minor),
      priceP75Minor: minorOrNull(s.price_p75_minor),
      priceAvgMinor: minorOrNull(s.price_avg_minor),
      byType: Array.isArray(s.by_type) ? s.by_type : [],
      topProducts: Array.isArray(s.top_products) ? s.top_products : [],
    });
  }

  // Deterministic: revenue desc, then lines desc, then tradename asc.
  competitors.sort(
    (a, b) =>
      b.retailRevenueMinor - a.retailRevenueMinor ||
      b.retailLineCount - a.retailLineCount ||
      a.tradename.localeCompare(b.tradename),
  );

  // Area rollups — median of store medians (honest labeled proxy).
  const byArea = new Map<DiscoveryCompetitorArea, LocalCompetitorStat[]>();
  for (const c of competitors) {
    const arr = byArea.get(c.area) ?? [];
    arr.push(c);
    byArea.set(c.area, arr);
  }
  const areas: LocalAreaStat[] = [];
  for (const [area, list] of byArea.entries()) {
    const medians = list
      .map((c) => c.priceMedianMinor)
      .filter((v): v is number => v != null);
    const avgs = list.map((c) => c.priceAvgMinor).filter((v): v is number => v != null);
    areas.push({
      area,
      storeCount: list.length,
      retailLineCount: list.reduce((a, c) => a + c.retailLineCount, 0),
      retailUnits: list.reduce((a, c) => a + c.retailUnits, 0),
      retailRevenueMinor: list.reduce((a, c) => a + c.retailRevenueMinor, 0),
      retailMedianMinor: medianOf(medians),
      retailAvgMinor: avgs.length
        ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length)
        : null,
    });
  }
  areas.sort(
    (a, b) => LOCAL_AREA_ORDER.indexOf(a.area) - LOCAL_AREA_ORDER.indexOf(b.area),
  );

  return { competitors, areas };
}
