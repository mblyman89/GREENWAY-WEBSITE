/**
 * src/lib/discovery/statewide-market-core.ts
 *
 * PURE semantic layer for the statewide CCRS benchmarks command center
 * (Slice 8). Every number the statewide page shows on screen, writes to a CSV
 * export, or hands to the AI comes from THIS module and nowhere else.
 *
 * WHY a semantic layer instead of ad-hoc math in the component: dbt Labs'
 * 2026-04-07 benchmark found text-to-SQL answers business questions correctly
 * 84–90% of the time while a semantic layer reaches 98–100%, and — the part
 * that matters for a compliance surface — the failure mode differs. A semantic
 * layer errors out; ad-hoc SQL returns a confident wrong number. Defining
 * "velocity", "fair share", and "margin" exactly once means the screen, the
 * export, and any future AI answer cannot disagree.
 *
 * Standing rules honored:
 *  - NEVER GUESS: a metric that was never measured stays `null` and renders
 *    "—". Null is NEVER coerced to zero, because "we did not measure it" and
 *    "it was zero" are different facts and the owner makes buying decisions on
 *    the difference.
 *  - Money in MINOR UNITS (cents) end to end. No floats-as-dollars.
 *  - Pure module: no I/O, no React, no Supabase — covered by
 *    tests/compliance/statewide-market-core.test.ts.
 *
 * Metric storage conventions VERIFIED against market-rollups.ts (not assumed):
 *  - a *_units   benchmark row carries its count in `value_num`
 *  - a *_revenue benchmark row carries its total in `avg_minor`
 *  - price metrics carry the percentile ladder in min/p25/median/p75/max_minor
 *  - potency is mg/g, NOT percent (divide by 10 for a percentage)
 */

// ---------------------------------------------------------------------------
// Structural inputs — shaped to match the DB row types without importing them,
// so this module stays pure and independently testable.
// ---------------------------------------------------------------------------

export type MarketBenchmarkLike = {
  scope: string;
  scope_key: string;
  metric: string;
  sample_size: number;
  min_minor: number | null;
  p25_minor: number | null;
  median_minor: number | null;
  p75_minor: number | null;
  max_minor: number | null;
  avg_minor: number | null;
  value_num: number | null;
};

export type MarketCompetitorLike = {
  license_number: string;
  name: string | null;
  dba: string | null;
  city: string | null;
  retail_units: number;
  retail_revenue_minor: number;
  retail_line_count: number;
  price_median_minor: number | null;
  price_p25_minor: number | null;
  price_p75_minor: number | null;
  by_type?: Array<{ inventoryType: string; units: number; revenueMinor: number }> | null;
  top_products?: MarketMixProductLike[] | null;
  wholesale_spend_minor?: number | null;
};

export type MarketMixTypeLike = {
  inventoryType: string;
  units: number;
  revenueMinor: number;
  lineCount: number;
  medianUnitPriceMinor: number | null;
};

export type MarketMixProductLike = {
  productName: string;
  inventoryType: string | null;
  brand?: string | null;
  units: number;
  revenueMinor: number;
  medianUnitPriceMinor: number | null;
};

/**
 * Details-on-demand payload (Shneiderman's fourth task): the mix behind one
 * row, carried inline so opening a drill-down costs zero round trips and
 * cannot disagree with the summary it expanded from.
 */
export type MixDetail = {
  types: MarketMixTypeLike[];
  products: MarketMixProductLike[];
};

function normalizeTypeMix(mix: MarketMixTypeLike[] | null | undefined): MarketMixTypeLike[] {
  if (!Array.isArray(mix)) return [];
  return [...mix]
    .filter((t) => t && typeof t.inventoryType === "string" && t.inventoryType.trim() !== "")
    .sort((a, b) => (nonNegOrNull(b.revenueMinor) ?? -1) - (nonNegOrNull(a.revenueMinor) ?? -1));
}

function normalizeProductMix(
  mix: MarketMixProductLike[] | null | undefined,
): MarketMixProductLike[] {
  if (!Array.isArray(mix)) return [];
  return [...mix]
    .filter((p) => p && typeof p.productName === "string" && p.productName.trim() !== "")
    .sort((a, b) => (nonNegOrNull(b.revenueMinor) ?? -1) - (nonNegOrNull(a.revenueMinor) ?? -1));
}

export type MarketSupplierLike = {
  licensee_id: string;
  license_number: string | null;
  name: string | null;
  dba: string | null;
  line_count: number;
  revenue_minor: number;
  price_median_minor: number | null;
  distinct_buyers: number;
  tracked_buyers: number;
  by_type?: MarketMixTypeLike[] | null;
  top_products?: MarketMixProductLike[] | null;
  unattributed_lines?: number | null;
};

export type MarketProducerLike = {
  license_number: string;
  name: string | null;
  dba: string | null;
  units: number;
  revenue_minor: number;
  line_count: number;
  price_median_minor: number | null;
  distinct_retailers: number;
  tracked_retailers: number;
  doh_line_count: number;
  by_type?: MarketMixTypeLike[] | null;
  top_products?: MarketMixProductLike[] | null;
};

export type MarketDohSellerLike = {
  license_number: string | null;
  name: string | null;
  dba: string | null;
  tracked: boolean;
  is_self: boolean;
  units: number;
  revenue_minor: number;
  line_count: number;
  price_median_minor: number | null;
};

/** The four measurement classes the transformer persists. */
export type SaleClass = "retail" | "wholesale" | "medical" | "doh";

export const SALE_CLASSES: readonly SaleClass[] = ["retail", "wholesale", "medical", "doh"] as const;

/**
 * Metric names per class, mirroring market-rollups.ts METRICS exactly. A
 * Record keyed by SaleClass makes the build fail if a class is ever added
 * without naming its metrics here.
 */
const CLASS_METRICS: Record<
  SaleClass,
  { price: string; ppg: string; units: string; revenue: string }
> = {
  retail: {
    price: "retail_unit_price",
    ppg: "retail_price_per_gram",
    units: "retail_units",
    revenue: "retail_revenue",
  },
  wholesale: {
    price: "wholesale_unit_price",
    ppg: "wholesale_price_per_gram",
    units: "wholesale_units",
    revenue: "wholesale_revenue",
  },
  medical: {
    price: "medical_unit_price",
    ppg: "medical_price_per_gram",
    units: "medical_units",
    revenue: "medical_revenue",
  },
  doh: {
    price: "doh_unit_price",
    ppg: "doh_price_per_gram",
    units: "doh_units",
    revenue: "doh_revenue",
  },
};

// ---------------------------------------------------------------------------
// Null-safe numeric helpers. `null` in => `null` out, ALWAYS.
// ---------------------------------------------------------------------------

function finiteOrNull(n: number | null | undefined): number | null {
  if (n == null || typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

function nonNegOrNull(n: number | null | undefined): number | null {
  const v = finiteOrNull(n);
  if (v == null || v < 0) return null;
  return v;
}

/** Safe ratio: null unless both sides are real and the denominator is > 0. */
export function ratioOrNull(num: number | null | undefined, den: number | null | undefined): number | null {
  const n = finiteOrNull(num);
  const d = finiteOrNull(den);
  if (n == null || d == null || d <= 0) return null;
  return n / d;
}

// ---------------------------------------------------------------------------
// Level 1: the market table (one row per scope_key, all four classes pivoted)
// ---------------------------------------------------------------------------

export type ClassStats = {
  /** Percentile ladder for unit price, minor units. */
  minUnitPriceMinor: number | null;
  p25UnitPriceMinor: number | null;
  medianUnitPriceMinor: number | null;
  p75UnitPriceMinor: number | null;
  maxUnitPriceMinor: number | null;
  /** How many priced lines backed the ladder. Null when never measured. */
  priceSampleSize: number | null;
  medianPpgMinor: number | null;
  units: number | null;
  revenueMinor: number | null;
};

const EMPTY_CLASS_STATS: ClassStats = {
  minUnitPriceMinor: null,
  p25UnitPriceMinor: null,
  medianUnitPriceMinor: null,
  p75UnitPriceMinor: null,
  maxUnitPriceMinor: null,
  priceSampleSize: null,
  medianPpgMinor: null,
  units: null,
  revenueMinor: null,
};

export type MarketRow = {
  /** scope_key, e.g. an InventoryType like "Usable Marijuana". */
  key: string;
  scope: string;
  retail: ClassStats;
  wholesale: ClassStats;
  medical: ClassStats;
  doh: ClassStats;
  /** Potency in mg/g as WSLCB publishes it. Divide by 10 for a percentage. */
  totalThcMgPerG: number | null;
  totalCbdMgPerG: number | null;
  /** Share (0..1) of all rows' retail revenue. Null when unmeasured. */
  revenueShare: number | null;
  unitsShare: number | null;
  /**
   * Retail median − wholesale median, minor units. The per-unit gross spread
   * a retailer captures on a typical unit of this type. Null unless BOTH
   * medians were measured — a spread against a missing side is a guess.
   */
  marginMinor: number | null;
  /** marginMinor as a fraction (0..1) of the retail median. */
  marginPct: number | null;
  /** Medical revenue as a share of retail revenue within this row. */
  medicalShare: number | null;
  /** DOH revenue as a share of retail revenue within this row. */
  dohShare: number | null;
};

function readClass(byMetric: Map<string, MarketBenchmarkLike>, cls: SaleClass): ClassStats {
  const names = CLASS_METRICS[cls];
  const price = byMetric.get(names.price);
  const ppg = byMetric.get(names.ppg);
  const units = byMetric.get(names.units);
  const revenue = byMetric.get(names.revenue);
  // A class with no rows at all was never measured — every field stays null.
  if (!price && !ppg && !units && !revenue) return { ...EMPTY_CLASS_STATS };
  return {
    minUnitPriceMinor: price ? nonNegOrNull(price.min_minor) : null,
    p25UnitPriceMinor: price ? nonNegOrNull(price.p25_minor) : null,
    medianUnitPriceMinor: price ? nonNegOrNull(price.median_minor) : null,
    p75UnitPriceMinor: price ? nonNegOrNull(price.p75_minor) : null,
    maxUnitPriceMinor: price ? nonNegOrNull(price.max_minor) : null,
    priceSampleSize: price ? nonNegOrNull(price.sample_size) : null,
    medianPpgMinor: ppg ? nonNegOrNull(ppg.median_minor) : null,
    // Units live in value_num; revenue lives in avg_minor. Verified against
    // market-rollups.ts, not assumed.
    units: units ? nonNegOrNull(units.value_num) : null,
    revenueMinor: revenue ? nonNegOrNull(revenue.avg_minor) : null,
  };
}

/**
 * Pivot flat benchmark rows into one wide row per scope_key for a single
 * scope. This is the "overview first" table of Shneiderman's mantra: every
 * type on one screen, every class side by side, no drilling required to see
 * the shape of the market.
 */
export function buildMarketRows(benchmarks: MarketBenchmarkLike[], scope: string): MarketRow[] {
  const byKey = new Map<string, Map<string, MarketBenchmarkLike>>();
  for (const b of benchmarks) {
    if (!b || b.scope !== scope) continue;
    const key = typeof b.scope_key === "string" ? b.scope_key.trim() : "";
    if (!key) continue;
    let m = byKey.get(key);
    if (!m) {
      m = new Map();
      byKey.set(key, m);
    }
    // Last row wins; the persist layer writes one row per (scope,key,metric).
    m.set(b.metric, b);
  }

  const rows: MarketRow[] = [];
  for (const [key, byMetric] of byKey) {
    const retail = readClass(byMetric, "retail");
    const wholesale = readClass(byMetric, "wholesale");
    const medical = readClass(byMetric, "medical");
    const doh = readClass(byMetric, "doh");
    const thc = byMetric.get("total_thc_mg_per_g");
    const cbd = byMetric.get("total_cbd_mg_per_g");

    // Margin only exists when BOTH sides were measured.
    const r = retail.medianUnitPriceMinor;
    const w = wholesale.medianUnitPriceMinor;
    const marginMinor = r != null && w != null ? r - w : null;

    rows.push({
      key,
      scope,
      retail,
      wholesale,
      medical,
      doh,
      totalThcMgPerG: thc ? nonNegOrNull(thc.median_minor) : null,
      totalCbdMgPerG: cbd ? nonNegOrNull(cbd.median_minor) : null,
      revenueShare: null, // filled below, once the denominator is known
      unitsShare: null,
      marginMinor,
      marginPct: marginMinor != null && r != null && r > 0 ? marginMinor / r : null,
      medicalShare: ratioOrNull(medical.revenueMinor, retail.revenueMinor),
      dohShare: ratioOrNull(doh.revenueMinor, retail.revenueMinor),
    });
  }

  // Shares are computed against the rows we actually measured. Rows whose
  // retail revenue was never measured contribute nothing to the denominator
  // and receive a null share rather than a fabricated 0%.
  let revenueTotal = 0;
  let unitsTotal = 0;
  for (const row of rows) {
    if (row.retail.revenueMinor != null) revenueTotal += row.retail.revenueMinor;
    if (row.retail.units != null) unitsTotal += row.retail.units;
  }
  for (const row of rows) {
    row.revenueShare = ratioOrNull(row.retail.revenueMinor, revenueTotal);
    row.unitsShare = ratioOrNull(row.retail.units, unitsTotal);
  }

  rows.sort((a, b) => (b.retail.revenueMinor ?? -1) - (a.retail.revenueMinor ?? -1) || a.key.localeCompare(b.key));
  return rows;
}

// ---------------------------------------------------------------------------
// Concentration — DOJ/FTC Herfindahl-Hirschman Index
// ---------------------------------------------------------------------------

export type ConcentrationBand = "unconcentrated" | "moderately_concentrated" | "highly_concentrated";

export type Concentration = {
  /** HHI in the DOJ's units: sum of squared percentage-point shares (0..10000). */
  hhi: number | null;
  band: ConcentrationBand | null;
  /** How many participants carried a measured, positive value. */
  participants: number;
  /** Combined share (0..1) of the four largest participants. */
  top4Share: number | null;
};

/**
 * Herfindahl-Hirschman Index per the DOJ/FTC Merger Guidelines (thresholds
 * restated 2024-01-17): sum of the squared market shares expressed in
 * percentage points. Below 1,000 is unconcentrated, 1,000–1,800 moderately
 * concentrated, above 1,800 highly concentrated.
 *
 * Values that were never measured (null) are EXCLUDED from the denominator
 * rather than treated as zero, so an unmeasured month cannot make the market
 * look artificially concentrated.
 */
export function computeConcentration(values: Array<number | null | undefined>): Concentration {
  const measured: number[] = [];
  for (const v of values) {
    const n = nonNegOrNull(v);
    if (n != null && n > 0) measured.push(n);
  }
  if (measured.length === 0) {
    return { hhi: null, band: null, participants: 0, top4Share: null };
  }
  let total = 0;
  for (const n of measured) total += n;
  if (total <= 0) {
    return { hhi: null, band: null, participants: measured.length, top4Share: null };
  }
  let hhi = 0;
  for (const n of measured) {
    const pct = (n / total) * 100;
    hhi += pct * pct;
  }
  const sorted = [...measured].sort((a, b) => b - a);
  let top4 = 0;
  for (let i = 0; i < Math.min(4, sorted.length); i += 1) top4 += sorted[i];
  const rounded = Math.round(hhi);
  // DOJ bands. Boundaries follow the Guidelines' own wording: "greater than
  // 1,800" is highly concentrated, so exactly 1,800 is moderate.
  const band: ConcentrationBand =
    rounded > 1800 ? "highly_concentrated" : rounded >= 1000 ? "moderately_concentrated" : "unconcentrated";
  return { hhi: rounded, band, participants: measured.length, top4Share: top4 / total };
}

export function concentrationLabel(band: ConcentrationBand | null): string {
  if (band === "highly_concentrated") return "Highly concentrated";
  if (band === "moderately_concentrated") return "Moderately concentrated";
  if (band === "unconcentrated") return "Unconcentrated";
  return "Not measured";
}

// ---------------------------------------------------------------------------
// Level 1: retailers (competitors) with velocity + fair share
// ---------------------------------------------------------------------------

export type RetailerRow = {
  licenseNumber: string;
  name: string;
  city: string | null;
  units: number | null;
  revenueMinor: number | null;
  lineCount: number | null;
  medianUnitPriceMinor: number | null;
  p25UnitPriceMinor: number | null;
  p75UnitPriceMinor: number | null;
  /** Share (0..1) of measured retail revenue across all retailers listed. */
  revenueShare: number | null;
  /** Distinct inventory types this store was observed selling. */
  typesCarried: number | null;
  /**
   * NielsenIQ velocity: revenue per distribution point. Here a distribution
   * point is one inventory type the store actually carried, so this reads as
   * "dollars earned per category carried" — high velocity means the store
   * wrings more out of a narrower range.
   */
  velocityMinor: number | null;
  /**
   * Fair-share index, 100 = par. Revenue share divided by assortment share,
   * times 100. Above 100 means the store earns more than its breadth of
   * assortment would predict.
   */
  fairShareIndex: number | null;
  /** Basket proxy: revenue per line. */
  revenuePerLineMinor: number | null;
  wholesaleSpendMinor: number | null;
  /** Level 2: what this store actually sells. Empty when never measured. */
  detail: MixDetail;
};

function displayName(name: string | null, dba: string | null, fallback: string): string {
  const d = typeof dba === "string" ? dba.trim() : "";
  if (d) return d;
  const n = typeof name === "string" ? name.trim() : "";
  if (n) return n;
  return fallback;
}

export function buildRetailerRows(competitors: MarketCompetitorLike[]): RetailerRow[] {
  const cleaned = competitors.filter(
    (c) => c && typeof c.license_number === "string" && c.license_number.trim() !== "",
  );

  let revenueTotal = 0;
  let typesTotal = 0;
  const typeCounts = new Map<string, number>();
  for (const c of cleaned) {
    const rev = nonNegOrNull(c.retail_revenue_minor);
    if (rev != null) revenueTotal += rev;
    const types = Array.isArray(c.by_type) ? new Set(c.by_type.map((t) => t.inventoryType)).size : 0;
    typeCounts.set(c.license_number, types);
    typesTotal += types;
  }

  const rows: RetailerRow[] = cleaned.map((c) => {
    const revenueMinor = nonNegOrNull(c.retail_revenue_minor);
    const types = typeCounts.get(c.license_number) ?? 0;
    const typesCarried = types > 0 ? types : null;
    const revenueShare = ratioOrNull(revenueMinor, revenueTotal);
    const assortmentShare = ratioOrNull(types, typesTotal);
    return {
      licenseNumber: c.license_number,
      name: displayName(c.name, c.dba, c.license_number),
      city: typeof c.city === "string" && c.city.trim() !== "" ? c.city.trim() : null,
      units: nonNegOrNull(c.retail_units),
      revenueMinor,
      lineCount: nonNegOrNull(c.retail_line_count),
      medianUnitPriceMinor: nonNegOrNull(c.price_median_minor),
      p25UnitPriceMinor: nonNegOrNull(c.price_p25_minor),
      p75UnitPriceMinor: nonNegOrNull(c.price_p75_minor),
      revenueShare,
      typesCarried,
      velocityMinor:
        revenueMinor != null && typesCarried != null ? Math.round(revenueMinor / typesCarried) : null,
      fairShareIndex:
        revenueShare != null && assortmentShare != null && assortmentShare > 0
          ? (revenueShare / assortmentShare) * 100
          : null,
      revenuePerLineMinor:
        revenueMinor != null && nonNegOrNull(c.retail_line_count) ? Math.round(revenueMinor / c.retail_line_count) : null,
      wholesaleSpendMinor: nonNegOrNull(c.wholesale_spend_minor),
      detail: {
        // Competitor by_type carries no lineCount/median — normalize to the
        // shared shape without inventing the missing fields.
        types: normalizeTypeMix(
          Array.isArray(c.by_type)
            ? c.by_type.map((t) => ({
                inventoryType: t.inventoryType,
                units: t.units,
                revenueMinor: t.revenueMinor,
                lineCount: 0,
                medianUnitPriceMinor: null,
              }))
            : null,
        ),
        products: normalizeProductMix(c.top_products),
      },
    };
  });

  rows.sort((a, b) => (b.revenueMinor ?? -1) - (a.revenueMinor ?? -1) || a.name.localeCompare(b.name));
  return rows;
}

// ---------------------------------------------------------------------------
// Level 1: producers / processors — TWO signals, never summed
// ---------------------------------------------------------------------------

/**
 * A producer/processor as seen from ONE of two independent vantage points.
 *
 * `sell_in`      = wholesale invoices (near-complete): what they SHIPPED.
 * `sell_through` = retail lines joined to a manifest origin (~2% SAMPLE of
 *                  inventory rows in the real delivery): what consumers BOUGHT.
 *
 * These measure different things at different scales. Adding them together
 * would be meaningless, so they are kept as separate rows with an explicit
 * `signal` discriminator that the UI is required to display.
 */
export type ProducerSignal = "sell_in" | "sell_through";

export type ProducerRow = {
  signal: ProducerSignal;
  /** Stable identity for the row within its signal. */
  id: string;
  licenseNumber: string | null;
  name: string;
  units: number | null;
  revenueMinor: number | null;
  lineCount: number | null;
  medianUnitPriceMinor: number | null;
  /** Stores buying (sell-in) or observed selling (sell-through). */
  distributionPoints: number | null;
  trackedPoints: number | null;
  /** Share (0..1) of revenue WITHIN this signal only. */
  revenueShare: number | null;
  /** Revenue per distribution point — NielsenIQ velocity. */
  velocityMinor: number | null;
  /** Fair-share index, 100 = par, within this signal only. */
  fairShareIndex: number | null;
  /** Best-selling inventory type by revenue, with its share of the row. */
  topType: string | null;
  topTypeShare: number | null;
  typesCarried: number | null;
  /** Sell-through only: how many of the retail lines were DOH-compliant lots. */
  dohLineCount: number | null;
  /** Sell-in only: wholesale lines whose lot never resolved to a product. */
  unattributedLines: number | null;
  /** Level 2: the vendor's full measured mix. Empty when never measured. */
  detail: MixDetail;
};

function topTypeOf(mix: MarketMixTypeLike[] | null | undefined): {
  topType: string | null;
  topTypeShare: number | null;
  typesCarried: number | null;
} {
  if (!Array.isArray(mix) || mix.length === 0) {
    return { topType: null, topTypeShare: null, typesCarried: null };
  }
  let total = 0;
  let best: MarketMixTypeLike | null = null;
  for (const t of mix) {
    const rev = nonNegOrNull(t?.revenueMinor) ?? 0;
    total += rev;
    if (!best || rev > (nonNegOrNull(best.revenueMinor) ?? 0)) best = t;
  }
  return {
    topType: best?.inventoryType ?? null,
    topTypeShare: ratioOrNull(best ? nonNegOrNull(best.revenueMinor) : null, total),
    typesCarried: mix.length,
  };
}

/** Shared share/velocity/fair-share pass, applied WITHIN a single signal. */
function finalizeProducerRows(rows: ProducerRow[]): ProducerRow[] {
  let revenueTotal = 0;
  let pointsTotal = 0;
  for (const r of rows) {
    if (r.revenueMinor != null) revenueTotal += r.revenueMinor;
    if (r.distributionPoints != null) pointsTotal += r.distributionPoints;
  }
  for (const r of rows) {
    r.revenueShare = ratioOrNull(r.revenueMinor, revenueTotal);
    const distShare = ratioOrNull(r.distributionPoints, pointsTotal);
    r.velocityMinor =
      r.revenueMinor != null && r.distributionPoints != null && r.distributionPoints > 0
        ? Math.round(r.revenueMinor / r.distributionPoints)
        : null;
    r.fairShareIndex =
      r.revenueShare != null && distShare != null && distShare > 0 ? (r.revenueShare / distShare) * 100 : null;
  }
  rows.sort((a, b) => (b.revenueMinor ?? -1) - (a.revenueMinor ?? -1) || a.name.localeCompare(b.name));
  return rows;
}

/** Wholesale sell-in: what producers/processors shipped to stores. */
export function buildSellInRows(suppliers: MarketSupplierLike[]): ProducerRow[] {
  const rows: ProducerRow[] = (suppliers ?? [])
    .filter((s) => s && typeof s.licensee_id === "string" && s.licensee_id.trim() !== "")
    .map((s) => {
      const mix = topTypeOf(s.by_type);
      return {
        signal: "sell_in" as const,
        id: s.licensee_id,
        licenseNumber: typeof s.license_number === "string" && s.license_number.trim() !== "" ? s.license_number : null,
        name: displayName(s.name, s.dba, s.license_number ?? s.licensee_id),
        // Wholesale rollups count lines and dollars, not consumer units.
        units: null,
        revenueMinor: nonNegOrNull(s.revenue_minor),
        lineCount: nonNegOrNull(s.line_count),
        medianUnitPriceMinor: nonNegOrNull(s.price_median_minor),
        distributionPoints: nonNegOrNull(s.distinct_buyers),
        trackedPoints: nonNegOrNull(s.tracked_buyers),
        revenueShare: null,
        velocityMinor: null,
        fairShareIndex: null,
        topType: mix.topType,
        topTypeShare: mix.topTypeShare,
        typesCarried: mix.typesCarried,
        dohLineCount: null,
        // null = never measured (pre-Slice-7 upload); 0 = measured, all resolved.
        unattributedLines: s.unattributed_lines == null ? null : nonNegOrNull(s.unattributed_lines),
        detail: { types: normalizeTypeMix(s.by_type), products: normalizeProductMix(s.top_products) },
      };
    });
  return finalizeProducerRows(rows);
}

/** Retail sell-through: what consumers actually bought, by maker. ~2% sample. */
export function buildSellThroughRows(producers: MarketProducerLike[]): ProducerRow[] {
  const rows: ProducerRow[] = (producers ?? [])
    .filter((p) => p && typeof p.license_number === "string" && p.license_number.trim() !== "")
    .map((p) => {
      const mix = topTypeOf(p.by_type);
      return {
        signal: "sell_through" as const,
        id: p.license_number,
        licenseNumber: p.license_number,
        name: displayName(p.name, p.dba, p.license_number),
        units: nonNegOrNull(p.units),
        revenueMinor: nonNegOrNull(p.revenue_minor),
        lineCount: nonNegOrNull(p.line_count),
        medianUnitPriceMinor: nonNegOrNull(p.price_median_minor),
        distributionPoints: nonNegOrNull(p.distinct_retailers),
        trackedPoints: nonNegOrNull(p.tracked_retailers),
        revenueShare: null,
        velocityMinor: null,
        fairShareIndex: null,
        topType: mix.topType,
        topTypeShare: mix.topTypeShare,
        typesCarried: mix.typesCarried,
        dohLineCount: nonNegOrNull(p.doh_line_count),
        unattributedLines: null,
        detail: { types: normalizeTypeMix(p.by_type), products: normalizeProductMix(p.top_products) },
      };
    });
  return finalizeProducerRows(rows);
}

// ---------------------------------------------------------------------------
// Level 1: DOH sellers — the medical-endorsement decision
// ---------------------------------------------------------------------------

export type DohSellerRow = {
  licenseNumber: string | null;
  name: string;
  tracked: boolean;
  isSelf: boolean;
  units: number | null;
  revenueMinor: number | null;
  lineCount: number | null;
  medianUnitPriceMinor: number | null;
  revenueShare: number | null;
  revenuePerLineMinor: number | null;
};

export function buildDohSellerRows(sellers: MarketDohSellerLike[]): DohSellerRow[] {
  const cleaned = (sellers ?? []).filter((s) => s != null);
  let revenueTotal = 0;
  for (const s of cleaned) {
    const rev = nonNegOrNull(s.revenue_minor);
    if (rev != null) revenueTotal += rev;
  }
  const rows: DohSellerRow[] = cleaned.map((s) => {
    const revenueMinor = nonNegOrNull(s.revenue_minor);
    const lineCount = nonNegOrNull(s.line_count);
    return {
      licenseNumber: typeof s.license_number === "string" && s.license_number.trim() !== "" ? s.license_number : null,
      name: displayName(s.name, s.dba, s.license_number ?? "Unknown"),
      tracked: s.tracked === true,
      isSelf: s.is_self === true,
      units: nonNegOrNull(s.units),
      revenueMinor,
      lineCount,
      medianUnitPriceMinor: nonNegOrNull(s.price_median_minor),
      revenueShare: ratioOrNull(revenueMinor, revenueTotal),
      revenuePerLineMinor:
        revenueMinor != null && lineCount != null && lineCount > 0 ? Math.round(revenueMinor / lineCount) : null,
    };
  });
  rows.sort((a, b) => (b.revenueMinor ?? -1) - (a.revenueMinor ?? -1) || a.name.localeCompare(b.name));
  return rows;
}

/**
 * The medical-endorsement question in one object: how big is the DOH pocket,
 * who owns it, and does DOH product carry a price premium over the market?
 *
 * `premiumPct` compares the DOH median unit price against the overall retail
 * median. Null unless BOTH were measured.
 */
export type DohVerdict = {
  sellerCount: number;
  trackedSellerCount: number;
  selfPresent: boolean;
  revenueMinor: number | null;
  unitsTotal: number | null;
  dohMedianUnitPriceMinor: number | null;
  retailMedianUnitPriceMinor: number | null;
  premiumPct: number | null;
  concentration: Concentration;
  /** Share (0..1) of retail LINES that were DOH lots, honest denominator. */
  dohLineShare: number | null;
};

export function buildDohVerdict(args: {
  sellers: DohSellerRow[];
  dohMedianUnitPriceMinor: number | null;
  retailMedianUnitPriceMinor: number | null;
  dohLines: number | null | undefined;
  retailLines: number | null | undefined;
  dohUnknownLines: number | null | undefined;
}): DohVerdict {
  const { sellers } = args;
  let revenue: number | null = null;
  let units: number | null = null;
  for (const s of sellers) {
    if (s.revenueMinor != null) revenue = (revenue ?? 0) + s.revenueMinor;
    if (s.units != null) units = (units ?? 0) + s.units;
  }
  const doh = nonNegOrNull(args.dohMedianUnitPriceMinor);
  const retail = nonNegOrNull(args.retailMedianUnitPriceMinor);

  // Honest denominator: lines we could actually read a DOH answer for.
  const dohLines = nonNegOrNull(args.dohLines);
  const retailLines = nonNegOrNull(args.retailLines);
  const unknown = nonNegOrNull(args.dohUnknownLines) ?? 0;
  const knowable = retailLines != null ? retailLines - unknown : null;

  return {
    sellerCount: sellers.length,
    trackedSellerCount: sellers.filter((s) => s.tracked).length,
    selfPresent: sellers.some((s) => s.isSelf),
    revenueMinor: revenue,
    unitsTotal: units,
    dohMedianUnitPriceMinor: doh,
    retailMedianUnitPriceMinor: retail,
    premiumPct: doh != null && retail != null && retail > 0 ? (doh - retail) / retail : null,
    concentration: computeConcentration(sellers.map((s) => s.revenueMinor)),
    dohLineShare: ratioOrNull(dohLines, knowable),
  };
}

// ---------------------------------------------------------------------------
// Zoom & filter — client-side, so every keystroke is under 100ms
// ---------------------------------------------------------------------------

export type SortDirection = "asc" | "desc";

/**
 * Generic null-last comparator. Rows that were never measured always sink to
 * the bottom in BOTH directions — a null is not "the smallest value", it is
 * the absence of a value, and letting it win an "ascending price" sort would
 * put unmeasured rows at the top of a cheapest-first list.
 */
export function compareValues(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  dir: SortDirection,
): number {
  const aNull = a == null || (typeof a === "number" && !Number.isFinite(a));
  const bNull = b == null || (typeof b === "number" && !Number.isFinite(b));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  let cmp: number;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else cmp = String(a).localeCompare(String(b));
  return dir === "asc" ? cmp : -cmp;
}

/** Sort a copy of `rows` by a caller-supplied accessor. Never mutates input. */
export function sortRows<T>(
  rows: readonly T[],
  accessor: (row: T) => number | string | null | undefined,
  dir: SortDirection,
): T[] {
  return [...rows].sort((a, b) => compareValues(accessor(a), accessor(b), dir));
}

/** Case-insensitive, whitespace-tolerant substring match across fields. */
export function matchesQuery(query: string, fields: Array<string | null | undefined>): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  for (const f of fields) {
    if (typeof f === "string" && f.toLowerCase().includes(q)) return true;
  }
  return false;
}

/**
 * A facet: one filter per aspect of the data, each option carrying its own
 * count so the control teaches the shape of the data before it is touched
 * (Whitenton, NN/g).
 */
export type FacetOption = { value: string; count: number };

export function buildFacet<T>(rows: readonly T[], accessor: (row: T) => string | null | undefined): FacetOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = accessor(row);
    if (typeof v !== "string") continue;
    const key = v.trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// ---------------------------------------------------------------------------
// Extract — Shneiderman's seventh task
// ---------------------------------------------------------------------------

/**
 * RFC 4180 CSV escaping. Quotes any cell containing a comma, quote, CR or LF,
 * and doubles embedded quotes. A bare CR matters: Excel on Windows will split
 * a row on it, silently corrupting the export.
 */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minor units to a plain decimal string for spreadsheets. Null => "". */
export function minorToCsvAmount(minor: number | null | undefined): string {
  const n = finiteOrNull(minor);
  if (n == null) return "";
  return (n / 100).toFixed(2);
}

/** Fraction (0..1) to a percentage string with one decimal. Null => "". */
export function fractionToCsvPct(f: number | null | undefined): string {
  const n = finiteOrNull(f);
  if (n == null) return "";
  return (n * 100).toFixed(1);
}

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | boolean | null | undefined };

/** Build an RFC 4180 CSV from rows + column definitions. */
export function rowsToCsv<T>(rows: readonly T[], columns: ReadonlyArray<CsvColumn<T>>): string {
  const head = columns.map((c) => csvCell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(","));
  return [head, ...body].join("\r\n");
}

/** Column set for the market table export. Shared by screen and CSV. */
export const MARKET_CSV_COLUMNS: ReadonlyArray<CsvColumn<MarketRow>> = [
  { header: "inventory_type", value: (r) => r.key },
  { header: "retail_units", value: (r) => r.retail.units ?? "" },
  { header: "retail_revenue", value: (r) => minorToCsvAmount(r.retail.revenueMinor) },
  { header: "retail_revenue_share_pct", value: (r) => fractionToCsvPct(r.revenueShare) },
  { header: "retail_median_price", value: (r) => minorToCsvAmount(r.retail.medianUnitPriceMinor) },
  { header: "retail_p25_price", value: (r) => minorToCsvAmount(r.retail.p25UnitPriceMinor) },
  { header: "retail_p75_price", value: (r) => minorToCsvAmount(r.retail.p75UnitPriceMinor) },
  { header: "retail_median_price_per_gram", value: (r) => minorToCsvAmount(r.retail.medianPpgMinor) },
  { header: "wholesale_median_price", value: (r) => minorToCsvAmount(r.wholesale.medianUnitPriceMinor) },
  { header: "wholesale_median_price_per_gram", value: (r) => minorToCsvAmount(r.wholesale.medianPpgMinor) },
  { header: "gross_spread", value: (r) => minorToCsvAmount(r.marginMinor) },
  { header: "gross_spread_pct", value: (r) => fractionToCsvPct(r.marginPct) },
  { header: "medical_revenue", value: (r) => minorToCsvAmount(r.medical.revenueMinor) },
  { header: "medical_share_of_retail_pct", value: (r) => fractionToCsvPct(r.medicalShare) },
  { header: "doh_revenue", value: (r) => minorToCsvAmount(r.doh.revenueMinor) },
  { header: "doh_share_of_retail_pct", value: (r) => fractionToCsvPct(r.dohShare) },
  { header: "median_total_thc_mg_per_g", value: (r) => (r.totalThcMgPerG == null ? "" : r.totalThcMgPerG) },
  { header: "median_total_cbd_mg_per_g", value: (r) => (r.totalCbdMgPerG == null ? "" : r.totalCbdMgPerG) },
];

export const RETAILER_CSV_COLUMNS: ReadonlyArray<CsvColumn<RetailerRow>> = [
  { header: "license_number", value: (r) => r.licenseNumber },
  { header: "store", value: (r) => r.name },
  { header: "city", value: (r) => r.city ?? "" },
  { header: "retail_units", value: (r) => r.units ?? "" },
  { header: "retail_revenue", value: (r) => minorToCsvAmount(r.revenueMinor) },
  { header: "revenue_share_pct", value: (r) => fractionToCsvPct(r.revenueShare) },
  { header: "median_price", value: (r) => minorToCsvAmount(r.medianUnitPriceMinor) },
  { header: "revenue_per_line", value: (r) => minorToCsvAmount(r.revenuePerLineMinor) },
  { header: "types_carried", value: (r) => r.typesCarried ?? "" },
  { header: "velocity_per_type", value: (r) => minorToCsvAmount(r.velocityMinor) },
  { header: "fair_share_index", value: (r) => (r.fairShareIndex == null ? "" : r.fairShareIndex.toFixed(1)) },
  { header: "wholesale_spend", value: (r) => minorToCsvAmount(r.wholesaleSpendMinor) },
];

export const PRODUCER_CSV_COLUMNS: ReadonlyArray<CsvColumn<ProducerRow>> = [
  { header: "signal", value: (r) => r.signal },
  { header: "license_number", value: (r) => r.licenseNumber ?? "" },
  { header: "producer", value: (r) => r.name },
  { header: "units", value: (r) => r.units ?? "" },
  { header: "revenue", value: (r) => minorToCsvAmount(r.revenueMinor) },
  { header: "revenue_share_pct", value: (r) => fractionToCsvPct(r.revenueShare) },
  { header: "lines", value: (r) => r.lineCount ?? "" },
  { header: "median_price", value: (r) => minorToCsvAmount(r.medianUnitPriceMinor) },
  { header: "distribution_points", value: (r) => r.distributionPoints ?? "" },
  { header: "tracked_points", value: (r) => r.trackedPoints ?? "" },
  { header: "velocity_per_point", value: (r) => minorToCsvAmount(r.velocityMinor) },
  { header: "fair_share_index", value: (r) => (r.fairShareIndex == null ? "" : r.fairShareIndex.toFixed(1)) },
  { header: "top_type", value: (r) => r.topType ?? "" },
  { header: "top_type_share_pct", value: (r) => fractionToCsvPct(r.topTypeShare) },
  { header: "doh_lines", value: (r) => r.dohLineCount ?? "" },
  { header: "unattributed_lines", value: (r) => r.unattributedLines ?? "" },
];

export const DOH_CSV_COLUMNS: ReadonlyArray<CsvColumn<DohSellerRow>> = [
  { header: "license_number", value: (r) => r.licenseNumber ?? "" },
  { header: "store", value: (r) => r.name },
  { header: "on_my_roster", value: (r) => (r.tracked ? "yes" : "no") },
  { header: "is_my_store", value: (r) => (r.isSelf ? "yes" : "no") },
  { header: "doh_units", value: (r) => r.units ?? "" },
  { header: "doh_revenue", value: (r) => minorToCsvAmount(r.revenueMinor) },
  { header: "doh_revenue_share_pct", value: (r) => fractionToCsvPct(r.revenueShare) },
  { header: "doh_lines", value: (r) => r.lineCount ?? "" },
  { header: "doh_median_price", value: (r) => minorToCsvAmount(r.medianUnitPriceMinor) },
  { header: "doh_revenue_per_line", value: (r) => minorToCsvAmount(r.revenuePerLineMinor) },
];
