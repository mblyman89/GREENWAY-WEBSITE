/**
 * src/lib/discovery/benchmarks-ai-core.ts
 *
 * PURE digest shaping for the "Ask the analyst" Q&A (Task I, I7). Owner's ask
 * (verbatim intent): "I want ai to be included in all of the benchmarks
 * sections … I want to be able to ask questions and have appropriate and
 * fantastic responses and insights."
 *
 * Two grounded fact blocks, built ONLY from the persisted rollups the
 * benchmarks pages already render (never from raw CCRS re-reads, never from
 * anything invented):
 *
 *  - buildStatewideAnalystDigest — the CCRS Benchmarks page's data: overall
 *    KPIs, per-type/brand/strain price bands, month-over-month history, and
 *    the per-type top movers (with I4 manifest-resolved vendors when present).
 *  - buildLocalAnalystDigest — the Local Benchmarks report's data: area
 *    rollups, per-competitor stats (price bands, top products, top suppliers,
 *    wholesale spend), shared suppliers, and statewide supplier benchmarks.
 *
 * HONESTY (standing rules — NEVER GUESS):
 *  - Every figure comes from a persisted row; missing values print "n/a".
 *  - Blocks with no rows are omitted entirely (the model is told what's absent
 *    rather than shown fabricated content).
 *  - Retail vs wholesale bases are labeled on every line that carries money.
 *  - A monthly drop is ONE month — the digest says so, and the system prompt
 *    forbids extrapolation.
 *  - Money in MINOR UNITS in, dollars out (real division, display only).
 *  - Pure module: no I/O — covered by tests/compliance/benchmarks-ai-core.test.ts.
 */
import type { DiscoveryCompetitorArea } from "@/lib/discovery/types";

// ---------------------------------------------------------------------------
// Structural input types — subsets of DiscoveryBenchmark, DiscoveryDataset,
// TransformerHistoryRow, TypeMoverGroup, LocalCompetitorStat/LocalAreaStat,
// SupplierLead, and DiscoverySupplierStatRow (so tests stay small and the
// digest can never depend on fields it doesn't print).
// ---------------------------------------------------------------------------

export type AnalystDatasetLike = {
  label: string;
  period_start: string | null;
  period_end: string | null;
  retail_lines?: number | null;
  attributed_retail_lines?: number | null;
};

export type AnalystBenchmarkLike = {
  scope: string;
  scope_key: string;
  metric: string;
  sample_size: number;
  p25_minor: number | null;
  median_minor: number | null;
  p75_minor: number | null;
  avg_minor: number | null;
  value_num: number | null;
};

export type AnalystHistoryRowLike = {
  label: string;
  periodStart: string | null;
  periodEnd: string | null;
  retailMedianMinor: number | null;
  retailPpgMedianMinor: number | null;
  wholesaleMedianMinor: number | null;
  retailUnits: number | null;
  retailRevenueMinor: number | null;
  attributedShare: number | null;
};

export type AnalystTypeMoverGroupLike = {
  inventoryType: string;
  rows: Array<{
    product_name: string | null;
    brand: string | null;
    vendor_name?: string | null;
    units: number;
    revenue_minor: number;
    median_unit_price_minor: number | null;
    p25_unit_price_minor: number | null;
  }>;
};

export type AnalystAreaLike = {
  area: DiscoveryCompetitorArea;
  storeCount: number;
  retailUnits: number;
  retailRevenueMinor: number;
  retailMedianMinor: number | null;
};

export type AnalystCompetitorLike = {
  tradename: string;
  area: DiscoveryCompetitorArea;
  city: string | null;
  retailUnits: number;
  retailRevenueMinor: number;
  priceP25Minor: number | null;
  priceMedianMinor: number | null;
  priceP75Minor: number | null;
  topProducts: Array<{
    productName: string;
    inventoryType: string | null;
    units: number;
    revenueMinor: number;
    medianUnitPriceMinor: number | null;
  }>;
  wholesaleSpendMinor: number;
  topSuppliers: Array<{
    displayName: string;
    spendMinor: number;
  }>;
};

export type AnalystSharedSupplierLike = {
  displayName: string;
  buyerCount: number;
  buyerNames: string[];
  totalSpendMinor: number;
};

export type AnalystSupplierStatLike = {
  name: string | null;
  dba: string | null;
  revenue_minor: number;
  line_count: number;
  price_median_minor: number | null;
  distinct_buyers: number;
  tracked_buyers: number;
};

// ---------------------------------------------------------------------------
// Answer types (shared with the client panels — this module stays pure).
// ---------------------------------------------------------------------------

export type AnalystAnswer = {
  /** One-to-two sentence direct answer to the question. */
  headline: string;
  /** The full answer, as ordered points/paragraphs. */
  answer_points: string[];
  /** The specific digest figures the answer rests on (grounding trail). */
  key_facts: string[];
  /** Honest limits: what the data can't say, thin samples, one-month scope. */
  caveats: string[];
  /** Suggested follow-up questions the data CAN answer. */
  follow_ups: string[];
  /** Model id (set server-side, never by the model). */
  model: string;
};

export type AnalystAnswerResult =
  | { ok: true; answer: AnalystAnswer }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dollars(minor: number | null | undefined): string {
  if (minor == null || !Number.isFinite(minor)) return "n/a";
  return `$${(minor / 100).toFixed(2)}`;
}

function count(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return String(Math.round(n));
}

/**
 * Sanitize the free-text question: trim, collapse whitespace, cap length.
 * Returns null for empty/whitespace-only input (the action refuses politely).
 */
export function sanitizeAnalystQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim();
  if (q.length === 0) return null;
  return q.length > 500 ? `${q.slice(0, 500)}…` : q;
}

function period(d: AnalystDatasetLike): string {
  return d.period_start && d.period_end ? `${d.period_start} → ${d.period_end}` : "period unknown";
}

function band(b: AnalystBenchmarkLike): string {
  return `p25=${dollars(b.p25_minor)}, median=${dollars(b.median_minor)}, p75=${dollars(b.p75_minor)}, n=${count(b.sample_size)}`;
}

// ---------------------------------------------------------------------------
// Statewide digest — the CCRS Benchmarks page's persisted rollups.
// ---------------------------------------------------------------------------

const MAX_TYPES = 12;
const MAX_BRANDS = 15;
const MAX_STRAINS = 10;
const MAX_HISTORY = 12;
const MAX_MOVER_GROUPS = 12;
const MAX_MOVERS_PER_GROUP = 5;

/**
 * Build the statewide fact block. Returns null when there are no benchmark
 * rows at all (nothing persisted to reason over — never a fabricated digest).
 */
export function buildStatewideAnalystDigest(input: {
  dataset: AnalystDatasetLike;
  benchmarks: AnalystBenchmarkLike[];
  history?: AnalystHistoryRowLike[];
  typeMovers?: AnalystTypeMoverGroupLike[];
}): string | null {
  const { dataset, benchmarks, history, typeMovers } = input;
  if (benchmarks.length === 0) return null;

  const parts: string[] = [];

  const retailLines = dataset.retail_lines ?? null;
  const attributed = dataset.attributed_retail_lines ?? null;
  const attributionNote =
    retailLines != null && attributed != null && retailLines > 0
      ? ` Type/brand/strain detail covers ${((attributed / retailLines) * 100).toFixed(1)}% of retail lines (delta-file attribution — the rest are counted, not guessed).`
      : "";
  parts.push(
    `DATASET: "${dataset.label}", sales observed ${period(dataset)}. This is ONE monthly CCRS drop — statewide Washington retail + wholesale. All prices are observed transaction prices (RETAIL = shelf prices shoppers paid; WHOLESALE = prices stores paid vendors). Never extrapolate beyond this month.${attributionNote}`,
  );

  const overall = (metric: string) =>
    benchmarks.find((b) => b.scope === "overall" && b.scope_key === "all" && b.metric === metric) ??
    null;
  const oRetail = overall("retail_unit_price");
  const oWholesale = overall("wholesale_unit_price");
  const oPpg = overall("retail_price_per_gram");
  const oUnits = overall("retail_units");
  const oRevenue = overall("retail_revenue");
  const overallBits = [
    oRetail ? `retail_unit_price: ${band(oRetail)}` : null,
    oWholesale ? `wholesale_unit_price: ${band(oWholesale)}` : null,
    oPpg ? `retail_$/gram: ${band(oPpg)}` : null,
    oUnits?.value_num != null ? `retail_units=${count(oUnits.value_num)}` : null,
    oRevenue?.avg_minor != null ? `retail_revenue=${dollars(oRevenue.avg_minor)}` : null,
  ].filter(Boolean);
  if (overallBits.length > 0) parts.push(`STATEWIDE OVERALL:\n- ${overallBits.join("\n- ")}`);

  // Per-scope price tables, biggest samples first (the same rows the page shows).
  const scopeBlock = (
    scope: string,
    metric: string,
    title: string,
    max: number,
  ): string | null => {
    const rows = benchmarks
      .filter((b) => b.scope === scope && b.metric === metric && b.median_minor != null)
      .sort((a, b) => b.sample_size - a.sample_size)
      .slice(0, max);
    if (rows.length === 0) return null;
    return `${title} (retail unit price, top ${rows.length} by sample size):\n${rows
      .map((r) => `- ${r.scope_key}: ${band(r)}`)
      .join("\n")}`;
  };
  const typeBlock = scopeBlock("type", "retail_unit_price", "BY INVENTORY TYPE", MAX_TYPES);
  if (typeBlock) parts.push(typeBlock);
  const brandBlock = scopeBlock("brand", "retail_unit_price", "BY BRAND", MAX_BRANDS);
  if (brandBlock) parts.push(brandBlock);
  const strainBlock = scopeBlock("strain", "retail_unit_price", "BY STRAIN", MAX_STRAINS);
  if (strainBlock) parts.push(strainBlock);

  if (history && history.length > 0) {
    const rows = history.slice(0, MAX_HISTORY).map((h) => {
      const p = h.periodStart && h.periodEnd ? `${h.periodStart}→${h.periodEnd}` : h.label;
      const share = h.attributedShare != null ? `${(h.attributedShare * 100).toFixed(1)}%` : "n/a";
      return `- ${p}: retail_median=${dollars(h.retailMedianMinor)}, retail_$/g_median=${dollars(h.retailPpgMedianMinor)}, wholesale_median=${dollars(h.wholesaleMedianMinor)}, retail_units=${count(h.retailUnits)}, retail_revenue=${dollars(h.retailRevenueMinor)}, attribution=${share}`;
    });
    parts.push(
      `MONTH-OVER-MONTH HISTORY (each row is a separate monthly drop):\n${rows.join("\n")}`,
    );
  }

  if (typeMovers && typeMovers.length > 0) {
    const groups = typeMovers.slice(0, MAX_MOVER_GROUPS).map((g) => {
      const rows = g.rows.slice(0, MAX_MOVERS_PER_GROUP).map((r) => {
        const bits = [
          `"${r.product_name ?? "(unnamed)"}"`,
          r.brand ? `brand=${r.brand}` : "brand=n/a",
          r.vendor_name ? `vendor=${r.vendor_name}` : "vendor=unresolved",
          `units=${count(r.units)}`,
          `revenue=${dollars(r.revenue_minor)}`,
          `median=${dollars(r.median_unit_price_minor)}`,
          `p25=${dollars(r.p25_unit_price_minor)}`,
        ];
        return `  - ${bits.join(", ")}`;
      });
      return `${g.inventoryType}:\n${rows.join("\n")}`;
    });
    parts.push(
      `TOP MOVERS BY TYPE (statewide, this drop; vendor = manifest-resolved shipping vendor, "unresolved" when the manifests couldn't name one):\n${groups.join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Local digest — the Local Benchmarks report's persisted rollups.
// ---------------------------------------------------------------------------

const MAX_COMPETITORS = 15;
const MAX_TOP_PRODUCTS = 3;
const MAX_TOP_SUPPLIERS = 3;
const MAX_SHARED_SUPPLIERS = 10;
const MAX_SUPPLIER_STATS = 10;

/**
 * Build the local-competitor fact block. Returns null when there are no
 * competitor stats (e.g. a legacy dataset with no 0106 rollups) — the action
 * turns that into an honest "no local rollups for this dataset" message.
 */
export function buildLocalAnalystDigest(input: {
  dataset: AnalystDatasetLike;
  areas: AnalystAreaLike[];
  competitors: AnalystCompetitorLike[];
  sharedSuppliers?: AnalystSharedSupplierLike[];
  supplierStats?: AnalystSupplierStatLike[];
}): string | null {
  const { dataset, areas, competitors, sharedSuppliers, supplierStats } = input;
  if (competitors.length === 0) return null;

  const parts: string[] = [];

  parts.push(
    `DATASET: "${dataset.label}", sales observed ${period(dataset)}. ONE monthly CCRS drop. These are TRACKED LOCAL COMPETITORS of Greenway Marijuana (Port Orchard, WA) — Greenway itself is structurally EXCLUDED from these rollups, so every number is a competitor's. Prices are observed RETAIL unless marked wholesale. Port Orchard is the market Greenway most needs to win — weight it accordingly. Never extrapolate beyond this month.`,
  );

  if (areas.length > 0) {
    const rows = areas.map(
      (a) =>
        `- ${a.area}: stores=${count(a.storeCount)}, retail_units=${count(a.retailUnits)}, retail_revenue=${dollars(a.retailRevenueMinor)}, median_retail=${dollars(a.retailMedianMinor)} (median of each store's median — labeled proxy)`,
    );
    parts.push(`AREA ROLLUPS:\n${rows.join("\n")}`);
  }

  const compRows = competitors.slice(0, MAX_COMPETITORS).map((c) => {
    const products = c.topProducts
      .slice(0, MAX_TOP_PRODUCTS)
      .map(
        (p) =>
          `"${p.productName}"${p.inventoryType ? ` [${p.inventoryType}]` : ""} units=${count(p.units)} revenue=${dollars(p.revenueMinor)} median=${dollars(p.medianUnitPriceMinor)}`,
      )
      .join("; ");
    const suppliers = c.topSuppliers
      .slice(0, MAX_TOP_SUPPLIERS)
      .map((s) => `${s.displayName} (${dollars(s.spendMinor)})`)
      .join("; ");
    const bits = [
      `${c.tradename} (${c.area}${c.city ? `, ${c.city}` : ""})`,
      `retail_units=${count(c.retailUnits)}`,
      `retail_revenue=${dollars(c.retailRevenueMinor)}`,
      `retail_band p25=${dollars(c.priceP25Minor)} median=${dollars(c.priceMedianMinor)} p75=${dollars(c.priceP75Minor)}`,
      products ? `top_products: ${products}` : "top_products: none recorded",
      c.wholesaleSpendMinor > 0
        ? `wholesale_spend=${dollars(c.wholesaleSpendMinor)}${suppliers ? `, top_suppliers: ${suppliers}` : ""}`
        : "wholesale_spend: none recorded (pre-0107 rollup or no wholesale lines this drop)",
    ];
    return `- ${bits.join(" | ")}`;
  });
  parts.push(`COMPETITORS (${competitors.length} tracked, showing ${compRows.length}):\n${compRows.join("\n")}`);

  if (sharedSuppliers && sharedSuppliers.length > 0) {
    const rows = sharedSuppliers
      .slice(0, MAX_SHARED_SUPPLIERS)
      .map(
        (s) =>
          `- ${s.displayName}: sells to ${count(s.buyerCount)} tracked competitors (${s.buyerNames.join(", ")}), observed spend ${dollars(s.totalSpendMinor)} this drop`,
      );
    parts.push(
      `SHARED SUPPLIERS (vendors serving 2+ tracked competitors — the strongest sourcing leads):\n${rows.join("\n")}`,
    );
  }

  if (supplierStats && supplierStats.length > 0) {
    const rows = supplierStats
      .slice()
      .sort((a, b) => b.revenue_minor - a.revenue_minor)
      .slice(0, MAX_SUPPLIER_STATS)
      .map((s) => {
        const name = s.dba || s.name || "(unnamed licensee)";
        return `- ${name}: statewide wholesale revenue=${dollars(s.revenue_minor)}, lines=${count(s.line_count)}, median_wholesale_price=${dollars(s.price_median_minor)}, distinct_buyers=${count(s.distinct_buyers)} (${count(s.tracked_buyers)} tracked local)`;
      });
    parts.push(
      `STATEWIDE SUPPLIER BENCHMARKS (top ${rows.length} by wholesale revenue — WHOLESALE prices, what stores PAY):\n${rows.join("\n")}`,
    );
  }

  return parts.join("\n\n");
}
