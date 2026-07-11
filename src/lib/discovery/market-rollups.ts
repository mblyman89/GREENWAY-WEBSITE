/**
 * src/lib/discovery/market-rollups.ts
 *
 * Server-side persistence + loaders for the monthly CCRS statewide-extract
 * TRANSFORMER rollups (Task H, migrations 0106 + 0107). The transformer runs in the
 * browser (see ccrs-extract/) on the dragged-in monthly zip and posts ONLY the
 * compact AggregationResult (~1 MB JSON for a real month) — never raw rows.
 *
 * Written surfaces:
 *   - statewide benchmarks -> existing discovery_benchmarks (class-scoped
 *     metric strings so retail/wholesale never collide)
 *   - competitor stats     -> discovery_competitor_stats
 *   - market signals       -> discovery_market_signals
 *   - honest line totals   -> discovery_datasets columns (0106)
 *
 * STANDING RULES honored:
 *   - Guarded by isSupabaseServiceConfigured + isDiscoveryEnabled (kill-switch).
 *   - DRAFTS-ONLY: writes only discovery_* tables. Never touches catalog/POs.
 *   - Money in MINOR UNITS end to end.
 *   - NEVER GUESS: the posted payload is structurally validated (sanitize*)
 *     before a single row is written; a malformed payload is rejected whole.
 *   - Replaces prior rollups for the SAME dataset (recompute-safe), keeps
 *     history across datasets (owner keeps monthly datasets for trends).
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isDiscoveryEnabled } from "./store";
import type {
  AggregationResult,
  StatewideBenchmark,
  PriceSummary,
} from "./ccrs-extract/aggregate";
import type {
  BenchmarkMetric,
  BenchmarkScope,
  DiscoveryCompetitorStatRow,
  DiscoveryDataset,
  DiscoveryMarketSignalRow,
  DiscoverySupplierStatRow,
} from "./types";

const BATCH = 500;

// ---------------------------------------------------------------------------
// Payload validation (the result crosses the client/server boundary)
// ---------------------------------------------------------------------------

/** Caps that a legitimate transformer payload can never exceed. */
const MAX_STATEWIDE = 5_000;
const MAX_COMPETITORS = 200;
const MAX_SIGNALS = 2_000;
/** S10: the aggregator emits ≤ TOP_SUPPLIERS_STATEWIDE (100); allow slack. */
const MAX_SUPPLIERS = 200;
const MAX_KEY_LEN = 300;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}
function strOrNull(v: unknown, max = MAX_KEY_LEN): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}
function isoDateOrNull(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function sanitizeSummary(v: unknown): PriceSummary | null {
  if (v == null || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const sampleSize = intOrNull(s.sampleSize);
  if (sampleSize == null || sampleSize <= 0) return null;
  return {
    sampleSize,
    minMinor: intOrNull(s.minMinor) ?? 0,
    p25Minor: intOrNull(s.p25Minor) ?? 0,
    medianMinor: intOrNull(s.medianMinor) ?? 0,
    p75Minor: intOrNull(s.p75Minor) ?? 0,
    maxMinor: intOrNull(s.maxMinor) ?? 0,
    avgMinor: intOrNull(s.avgMinor) ?? 0,
  };
}

/**
 * Structural validation of a posted AggregationResult. Returns the sanitized
 * result or an error string — never a partially-trusted object.
 */
export function sanitizeAggregationResult(
  input: unknown,
): { ok: true; result: AggregationResult } | { ok: false; error: string } {
  if (input == null || typeof input !== "object") return { ok: false, error: "Payload is not an object." };
  const r = input as Record<string, unknown>;
  const totalsIn = (r.totals ?? {}) as Record<string, unknown>;
  const statewideIn = Array.isArray(r.statewide) ? r.statewide : null;
  const competitorsIn = Array.isArray(r.competitors) ? r.competitors : null;
  const signalsIn = Array.isArray(r.signals) ? r.signals : null;
  if (!statewideIn || !competitorsIn || !signalsIn) {
    return { ok: false, error: "Payload is missing statewide/competitors/signals arrays." };
  }
  if (statewideIn.length > MAX_STATEWIDE) return { ok: false, error: "Too many statewide benchmark rows." };
  if (competitorsIn.length > MAX_COMPETITORS) return { ok: false, error: "Too many competitor rows." };
  if (signalsIn.length > MAX_SIGNALS) return { ok: false, error: "Too many signal rows." };

  const statewide: AggregationResult["statewide"] = [];
  for (const b0 of statewideIn) {
    const b = (b0 ?? {}) as Record<string, unknown>;
    const scope = b.scope;
    const saleClass = b.saleClass;
    const scopeKey = strOrNull(b.scopeKey);
    if (
      (scope !== "type" && scope !== "brand" && scope !== "strain" && scope !== "overall") ||
      (saleClass !== "retail" && saleClass !== "wholesale") ||
      !scopeKey
    ) {
      return { ok: false, error: "Malformed statewide benchmark row." };
    }
    statewide.push({
      scope,
      scopeKey,
      saleClass,
      unitPrice: sanitizeSummary(b.unitPrice),
      pricePerGram: sanitizeSummary(b.pricePerGram),
      units: num(b.units),
      revenueMinor: Math.round(num(b.revenueMinor)),
    });
  }

  const competitors: AggregationResult["competitors"] = [];
  for (const c0 of competitorsIn) {
    const c = (c0 ?? {}) as Record<string, unknown>;
    const licenseNumber = strOrNull(c.licenseNumber, 32);
    const licenseeId = strOrNull(c.licenseeId, 32);
    const retail = (c.retail ?? {}) as Record<string, unknown>;
    if (!licenseNumber || !licenseeId) return { ok: false, error: "Malformed competitor row." };
    const byTypeIn = Array.isArray(retail.byType) ? retail.byType : [];
    const topProductsIn = Array.isArray(retail.topProducts) ? retail.topProducts : [];
    if (byTypeIn.length > 100 || topProductsIn.length > 100) {
      return { ok: false, error: "Competitor breakdown too large." };
    }
    // S7 wholesale sourcing block. BACKWARD COMPATIBLE: a payload from an
    // older transformer build has no `wholesale` key — that sanitizes to
    // zeros/empty (honest "no sourcing data"), never a rejection.
    const wholesale = (c.wholesale ?? {}) as Record<string, unknown>;
    const topSuppliersIn = Array.isArray(wholesale.topSuppliers) ? wholesale.topSuppliers : [];
    if (topSuppliersIn.length > 20) {
      return { ok: false, error: "Competitor supplier list too large." };
    }
    const topSuppliers: AggregationResult["competitors"][number]["wholesale"]["topSuppliers"] = [];
    for (const s0 of topSuppliersIn) {
      const s = (s0 ?? {}) as Record<string, unknown>;
      const supplierLicenseeId = strOrNull(s.licenseeId, 32);
      if (!supplierLicenseeId) return { ok: false, error: "Malformed supplier row." };
      topSuppliers.push({
        licenseeId: supplierLicenseeId,
        licenseNumber: strOrNull(s.licenseNumber, 32),
        name: strOrNull(s.name),
        dba: strOrNull(s.dba),
        lineCount: intOrNull(s.lineCount) ?? 0,
        spendMinor: Math.round(num(s.spendMinor)),
      });
    }
    competitors.push({
      licenseNumber,
      licenseeId,
      name: strOrNull(c.name),
      dba: strOrNull(c.dba),
      city: strOrNull(c.city, 120),
      retail: {
        units: num(retail.units),
        revenueMinor: Math.round(num(retail.revenueMinor)),
        lineCount: intOrNull(retail.lineCount) ?? 0,
        unitPrice: sanitizeSummary(retail.unitPrice),
        byType: byTypeIn.map((t0) => {
          const t = (t0 ?? {}) as Record<string, unknown>;
          return {
            inventoryType: strOrNull(t.inventoryType) ?? "(unattributed)",
            units: num(t.units),
            revenueMinor: Math.round(num(t.revenueMinor)),
          };
        }),
        topProducts: topProductsIn.map((p0) => {
          const p = (p0 ?? {}) as Record<string, unknown>;
          return {
            productName: strOrNull(p.productName) ?? "(unnamed)",
            inventoryType: strOrNull(p.inventoryType),
            units: num(p.units),
            revenueMinor: Math.round(num(p.revenueMinor)),
            medianUnitPriceMinor: intOrNull(p.medianUnitPriceMinor),
          };
        }),
      },
      wholesale: {
        lineCount: intOrNull(wholesale.lineCount) ?? 0,
        spendMinor: Math.round(num(wholesale.spendMinor)),
        topSuppliers,
      },
    });
  }

  // S10: statewide supplier benchmarks. BACKWARD COMPATIBLE: an older
  // transformer payload has no `suppliers` array — that sanitizes to []
  // (honest "no supplier benchmarks"), never a rejection.
  const suppliersIn = Array.isArray(r.suppliers) ? r.suppliers : [];
  if (suppliersIn.length > MAX_SUPPLIERS) {
    return { ok: false, error: "Too many statewide supplier rows." };
  }
  const suppliers: AggregationResult["suppliers"] = [];
  for (const s0 of suppliersIn) {
    const s = (s0 ?? {}) as Record<string, unknown>;
    const licenseeId = strOrNull(s.licenseeId, 32);
    if (!licenseeId) return { ok: false, error: "Malformed statewide supplier row." };
    suppliers.push({
      licenseeId,
      licenseNumber: strOrNull(s.licenseNumber, 32),
      name: strOrNull(s.name),
      dba: strOrNull(s.dba),
      lineCount: intOrNull(s.lineCount) ?? 0,
      revenueMinor: Math.round(num(s.revenueMinor)),
      unitPrice: sanitizeSummary(s.unitPrice),
      distinctBuyers: intOrNull(s.distinctBuyers) ?? 0,
      trackedBuyers: intOrNull(s.trackedBuyers) ?? 0,
    });
  }

  const signals: AggregationResult["signals"] = [];
  for (const s0 of signalsIn) {
    const s = (s0 ?? {}) as Record<string, unknown>;
    const kind = s.kind;
    if (kind !== "statewide_mover" && kind !== "competitor_mover") {
      return { ok: false, error: "Malformed signal row." };
    }
    signals.push({
      kind,
      licenseNumber: strOrNull(s.licenseNumber, 32),
      inventoryType: strOrNull(s.inventoryType),
      productName: strOrNull(s.productName),
      brand: strOrNull(s.brand),
      strainName: strOrNull(s.strainName),
      units: num(s.units),
      revenueMinor: Math.round(num(s.revenueMinor)),
      medianUnitPriceMinor: intOrNull(s.medianUnitPriceMinor),
      p25UnitPriceMinor: intOrNull(s.p25UnitPriceMinor),
    });
  }

  return {
    ok: true,
    result: {
      periodStart: isoDateOrNull(r.periodStart),
      periodEnd: isoDateOrNull(r.periodEnd),
      // Task I (I1): honest observed SaleDate span (optional — an older
      // transformer payload has neither; that sanitizes to null, never guessed).
      observedMinDate: isoDateOrNull(r.observedMinDate),
      observedMaxDate: isoDateOrNull(r.observedMaxDate),
      totals: {
        licenseeRows: num(totalsIn.licenseeRows),
        productRows: num(totalsIn.productRows),
        inventoryRows: num(totalsIn.inventoryRows),
        saleHeaderRows: num(totalsIn.saleHeaderRows),
        saleDetailRows: num(totalsIn.saleDetailRows),
        strainRows: num(totalsIn.strainRows),
        retailLines: num(totalsIn.retailLines),
        wholesaleLines: num(totalsIn.wholesaleLines),
        attributedRetailLines: num(totalsIn.attributedRetailLines),
        moverMapPrunes: num(totalsIn.moverMapPrunes),
      },
      statewide,
      competitors,
      signals,
      suppliers,
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function insertInBatches(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const admin = createSupabaseAdminClient();
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await admin.from(table).insert(chunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

/** Maps a transformer StatewideBenchmark to discovery_benchmarks rows. */
function benchmarkRows(
  datasetId: string,
  b: StatewideBenchmark,
  periodStart: string | null,
  periodEnd: string | null,
): Record<string, unknown>[] {
  const scope: BenchmarkScope = b.scope === "overall" ? "overall" : b.scope;
  const base = {
    dataset_id: datasetId,
    scope,
    scope_key: b.scopeKey,
    period_start: periodStart,
    period_end: periodEnd,
  };
  const rows: Record<string, unknown>[] = [];
  const priceMetric: BenchmarkMetric =
    b.saleClass === "retail" ? "retail_unit_price" : "wholesale_unit_price";
  if (b.unitPrice) {
    rows.push({
      ...base,
      metric: priceMetric,
      sample_size: b.unitPrice.sampleSize,
      min_minor: b.unitPrice.minMinor,
      p25_minor: b.unitPrice.p25Minor,
      median_minor: b.unitPrice.medianMinor,
      p75_minor: b.unitPrice.p75Minor,
      max_minor: b.unitPrice.maxMinor,
      avg_minor: b.unitPrice.avgMinor,
      value_num: null,
    });
  }
  const ppgMetric: BenchmarkMetric =
    b.saleClass === "retail" ? "retail_price_per_gram" : "wholesale_price_per_gram";
  if (b.pricePerGram) {
    rows.push({
      ...base,
      metric: ppgMetric,
      sample_size: b.pricePerGram.sampleSize,
      min_minor: b.pricePerGram.minMinor,
      p25_minor: b.pricePerGram.p25Minor,
      median_minor: b.pricePerGram.medianMinor,
      p75_minor: b.pricePerGram.p75Minor,
      max_minor: b.pricePerGram.maxMinor,
      avg_minor: b.pricePerGram.avgMinor,
      value_num: null,
    });
  }
  const unitsMetric: BenchmarkMetric = b.saleClass === "retail" ? "retail_units" : "wholesale_units";
  rows.push({
    ...base,
    metric: unitsMetric,
    sample_size: 0,
    min_minor: null,
    p25_minor: null,
    median_minor: null,
    p75_minor: null,
    max_minor: null,
    avg_minor: null,
    value_num: b.units,
  });
  const revMetric: BenchmarkMetric = b.saleClass === "retail" ? "retail_revenue" : "wholesale_revenue";
  rows.push({
    ...base,
    metric: revMetric,
    sample_size: 0,
    min_minor: null,
    p25_minor: null,
    median_minor: null,
    p75_minor: null,
    max_minor: null,
    avg_minor: Math.round(b.revenueMinor),
    value_num: null,
  });
  return rows;
}

/**
 * Persists a (sanitized) AggregationResult under a dataset. Replaces any prior
 * rollups for the same dataset so re-uploads are idempotent. Returns row
 * counts written per surface.
 */
export async function persistAggregationResult(
  datasetId: string,
  result: AggregationResult,
): Promise<{ benchmarks: number; competitors: number; signals: number }> {
  if (!isSupabaseServiceConfigured) throw new Error("Supabase not configured.");
  if (!(await isDiscoveryEnabled())) throw new Error("Discovery is turned off.");
  const admin = createSupabaseAdminClient();

  // Replace-then-insert per dataset (recompute-safe; history kept per dataset).
  {
    const { error } = await admin.from("discovery_benchmarks").delete().eq("dataset_id", datasetId);
    if (error) throw new Error(`discovery_benchmarks clear failed: ${error.message}`);
  }
  {
    const { error } = await admin
      .from("discovery_competitor_stats")
      .delete()
      .eq("dataset_id", datasetId);
    if (error) throw new Error(`discovery_competitor_stats clear failed: ${error.message}`);
  }
  {
    const { error } = await admin
      .from("discovery_market_signals")
      .delete()
      .eq("dataset_id", datasetId);
    if (error) throw new Error(`discovery_market_signals clear failed: ${error.message}`);
  }
  {
    // S10 (migration 0109). Clear is unconditional so re-uploads stay
    // idempotent even when the new payload has no supplier block.
    const { error } = await admin
      .from("discovery_supplier_stats")
      .delete()
      .eq("dataset_id", datasetId);
    if (error) throw new Error(`discovery_supplier_stats clear failed: ${error.message}`);
  }

  const benchRows: Record<string, unknown>[] = [];
  for (const b of result.statewide) {
    benchRows.push(...benchmarkRows(datasetId, b, result.periodStart, result.periodEnd));
  }
  await insertInBatches("discovery_benchmarks", benchRows);

  const compRows = result.competitors.map((c) => ({
    dataset_id: datasetId,
    license_number: c.licenseNumber,
    licensee_id: c.licenseeId,
    name: c.name,
    dba: c.dba,
    city: c.city,
    retail_units: c.retail.units,
    retail_revenue_minor: Math.round(c.retail.revenueMinor),
    retail_line_count: c.retail.lineCount,
    price_sample_size: c.retail.unitPrice?.sampleSize ?? 0,
    price_min_minor: c.retail.unitPrice?.minMinor ?? null,
    price_p25_minor: c.retail.unitPrice?.p25Minor ?? null,
    price_median_minor: c.retail.unitPrice?.medianMinor ?? null,
    price_p75_minor: c.retail.unitPrice?.p75Minor ?? null,
    price_max_minor: c.retail.unitPrice?.maxMinor ?? null,
    price_avg_minor: c.retail.unitPrice?.avgMinor ?? null,
    by_type: c.retail.byType,
    top_products: c.retail.topProducts,
    // S7 (migration 0107): wholesale sourcing.
    wholesale_line_count: c.wholesale.lineCount,
    wholesale_spend_minor: Math.round(c.wholesale.spendMinor),
    top_suppliers: c.wholesale.topSuppliers,
  }));
  await insertInBatches("discovery_competitor_stats", compRows);

  const signalRows = result.signals.map((s) => ({
    dataset_id: datasetId,
    kind: s.kind,
    license_number: s.licenseNumber,
    inventory_type: s.inventoryType,
    product_name: s.productName,
    brand: s.brand,
    strain_name: s.strainName,
    units: s.units,
    revenue_minor: Math.round(s.revenueMinor),
    median_unit_price_minor: s.medianUnitPriceMinor,
    p25_unit_price_minor: s.p25UnitPriceMinor,
  }));
  await insertInBatches("discovery_market_signals", signalRows);

  // S10 (migration 0109): statewide supplier benchmarks.
  const supplierRows = result.suppliers.map((s) => ({
    dataset_id: datasetId,
    licensee_id: s.licenseeId,
    license_number: s.licenseNumber,
    name: s.name,
    dba: s.dba,
    line_count: s.lineCount,
    revenue_minor: Math.round(s.revenueMinor),
    price_sample_size: s.unitPrice?.sampleSize ?? 0,
    price_min_minor: s.unitPrice?.minMinor ?? null,
    price_p25_minor: s.unitPrice?.p25Minor ?? null,
    price_median_minor: s.unitPrice?.medianMinor ?? null,
    price_p75_minor: s.unitPrice?.p75Minor ?? null,
    price_max_minor: s.unitPrice?.maxMinor ?? null,
    price_avg_minor: s.unitPrice?.avgMinor ?? null,
    distinct_buyers: s.distinctBuyers,
    tracked_buyers: s.trackedBuyers,
  }));
  await insertInBatches("discovery_supplier_stats", supplierRows);

  // Dataset bookkeeping: derived period, honest line totals, row counts, and
  // benchmarks_computed_at (the transformer computes benchmarks inline).
  {
    const { error } = await admin
      .from("discovery_datasets")
      .update({
        period_start: result.periodStart,
        period_end: result.periodEnd,
        sales_rows: Math.round(result.totals.saleDetailRows),
        product_rows: Math.round(result.totals.productRows),
        inventory_rows: Math.round(result.totals.inventoryRows),
        strain_rows: Math.round(result.totals.strainRows),
        retail_lines: Math.round(result.totals.retailLines),
        wholesale_lines: Math.round(result.totals.wholesaleLines),
        attributed_retail_lines: Math.round(result.totals.attributedRetailLines),
        ingest_kind: "monthly_zip",
        benchmarks_computed_at: new Date().toISOString(),
      })
      .eq("id", datasetId);
    if (error) throw new Error(`discovery_datasets update failed: ${error.message}`);
  }

  return { benchmarks: benchRows.length, competitors: compRows.length, signals: signalRows.length };
}

// ---------------------------------------------------------------------------
// Loaders (S4/S5/S6 surfaces)
// ---------------------------------------------------------------------------

/** Latest dataset ingested via the monthly-zip transformer (status ready). */
export async function getLatestTransformerDataset(): Promise<DiscoveryDataset | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_datasets")
    .select("*")
    .eq("status", "ready")
    .eq("ingest_kind", "monthly_zip")
    .order("period_end", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as DiscoveryDataset | null) ?? null;
}

/** All ready transformer datasets, newest period first (for history/trends). */
export async function listTransformerDatasets(): Promise<DiscoveryDataset[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_datasets")
    .select("*")
    .eq("status", "ready")
    .eq("ingest_kind", "monthly_zip")
    .order("period_end", { ascending: false, nullsFirst: false });
  return (data as DiscoveryDataset[] | null) ?? [];
}

export async function listCompetitorStats(datasetId: string): Promise<DiscoveryCompetitorStatRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_competitor_stats")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("retail_revenue_minor", { ascending: false });
  return (data as DiscoveryCompetitorStatRow[] | null) ?? [];
}

/** S10: statewide supplier benchmarks for a dataset (revenue desc). */
export async function listSupplierStats(datasetId: string): Promise<DiscoverySupplierStatRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_supplier_stats")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("revenue_minor", { ascending: false });
  return (data as DiscoverySupplierStatRow[] | null) ?? [];
}

export async function listMarketSignals(
  datasetId: string,
  kind?: DiscoveryMarketSignalRow["kind"],
): Promise<DiscoveryMarketSignalRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("discovery_market_signals")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("revenue_minor", { ascending: false });
  if (kind) q = q.eq("kind", kind);
  const { data } = await q;
  return (data as DiscoveryMarketSignalRow[] | null) ?? [];
}
