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
  BenchmarkSaleClass,
  PriceSummary,
  PotencyBenchmark,
  DohSellerStat,
  SupplierTypeStat,
  SupplierProductStat,
  ProducerSellThroughStat,
} from "./ccrs-extract/aggregate";
import type {
  BenchmarkMetric,
  BenchmarkScope,
  DiscoveryCompetitorStatRow,
  DiscoveryDataset,
  DiscoveryMarketSignalRow,
  DiscoverySupplierStatRow,
  DiscoveryDohSellerRow,
  DiscoveryProducerStatRow,
} from "./types";

const BATCH = 500;

// ---------------------------------------------------------------------------
// Payload validation (the result crosses the client/server boundary)
// ---------------------------------------------------------------------------

/** Caps that a legitimate transformer payload can never exceed. */
const MAX_STATEWIDE = 5_000;
const MAX_COMPETITORS = 200;
/**
 * Signals = 100 statewide movers + 10 per inventory type (Task I I4
 * "type_mover"; the real data has ~25 types) + 15 per tracked competitor.
 * 4,000 gives honest headroom without letting a hostile payload balloon.
 */
const MAX_SIGNALS = 4_000;
/** S10: the aggregator emits ≤ TOP_SUPPLIERS_STATEWIDE (100); allow slack. */
const MAX_SUPPLIERS = 200;
/** Payload guard for the DOH seller list (aggregator caps at TOP_DOH_SELLERS). */
const MAX_DOH_SELLERS = 200;
/**
 * Slice 7: payload guard for the producer sell-through list (the aggregator
 * caps at TOP_PRODUCERS = 150); allow the same slack the other lists get.
 */
const MAX_PRODUCERS = 250;
/**
 * Slice 7: payload guard for one licensee's product/type mix. The aggregator
 * emits <= TOP_PRODUCTS_PER_SUPPLIER (15) products and <= the number of real
 * InventoryType values (13 in the real December delivery); 60 is generous
 * slack that still blocks a hostile payload.
 */
const MAX_MIX_ROWS = 60;
const MAX_KEY_LEN = 300;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
/**
 * Like num(), but keeps "the field wasn't there" distinct from "the value was
 * zero". Used for optional counters where 0 would be a factual claim rather
 * than an absence (never guess).
 */
function numOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
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

/**
 * Slice 7: sanitize a licensee's inventory-type mix ("what they sell most of").
 * Returns undefined when the key is absent entirely — an older payload never
 * measured the mix, which is NOT the same claim as "this vendor sells nothing".
 */
function sanitizeTypeMix(v: unknown): SupplierTypeStat[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: SupplierTypeStat[] = [];
  for (const raw of v.slice(0, MAX_MIX_ROWS)) {
    const t = (raw ?? {}) as Record<string, unknown>;
    const inventoryType = strOrNull(t.inventoryType);
    if (!inventoryType) continue; // an unnamed type is not a fact we can state
    out.push({
      inventoryType,
      units: num(t.units),
      revenueMinor: Math.round(num(t.revenueMinor)),
      lineCount: intOrNull(t.lineCount) ?? 0,
      medianUnitPriceMinor: intOrNull(t.medianUnitPriceMinor),
    });
  }
  return out;
}

/** Slice 7: sanitize a licensee's top-products mix. Same absent-vs-empty rule. */
function sanitizeProductMix(v: unknown): SupplierProductStat[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: SupplierProductStat[] = [];
  for (const raw of v.slice(0, MAX_MIX_ROWS)) {
    const p = (raw ?? {}) as Record<string, unknown>;
    const productName = strOrNull(p.productName);
    if (!productName) continue;
    out.push({
      productName,
      inventoryType: strOrNull(p.inventoryType),
      brand: strOrNull(p.brand),
      units: num(p.units),
      revenueMinor: Math.round(num(p.revenueMinor)),
      lineCount: intOrNull(p.lineCount) ?? 0,
      medianUnitPriceMinor: intOrNull(p.medianUnitPriceMinor),
    });
  }
  return out;
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
 * Potency is bounded by physics: 1000 mg/g is 100% of the product's mass.
 * Anything above that is an impossible reading and is rejected rather than
 * averaged into a statewide benchmark.
 */
const MAX_POTENCY_MG_PER_G = 1000;
/** 2 analytes x (1 overall + per-type) rows; generous slack over the real 13 types. */
const MAX_POTENCY = 500;

/**
 * Validate one posted potency row. Returns null when the row is unusable, so a
 * malformed entry is dropped rather than poisoning the benchmark.
 */
function sanitizePotency(v: unknown): PotencyBenchmark | null {
  if (v == null || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const analyte = p.analyte;
  if (analyte !== "total_thc" && analyte !== "total_cbd") return null;
  const scope = p.scope;
  if (scope !== "overall" && scope !== "type") return null;
  const scopeKey = strOrNull(p.scopeKey);
  if (!scopeKey) return null;

  const sampleSize = intOrNull(p.sampleSize) ?? 0;
  const censoredCount = intOrNull(p.censoredCount) ?? 0;
  if (sampleSize < 0 || censoredCount < 0) return null;
  // A row that measured nothing at all carries no information.
  if (sampleSize === 0 && censoredCount === 0) return null;

  const mg = (x: unknown): number | null => {
    if (typeof x !== "number" || !Number.isFinite(x)) return null;
    if (x < 0 || x > MAX_POTENCY_MG_PER_G) return null;
    return Math.round(x * 100) / 100;
  };
  // With no reported values there is no average to state — null, never 0.
  const avgMgPerG = sampleSize > 0 ? mg(p.avgMgPerG) : null;
  return {
    analyte,
    scope,
    scopeKey,
    avgMgPerG,
    medianMgPerG: sampleSize > 0 ? mg(p.medianMgPerG) : null,
    minMgPerG: sampleSize > 0 ? mg(p.minMgPerG) : null,
    maxMgPerG: sampleSize > 0 ? mg(p.maxMgPerG) : null,
    sampleSize,
    censoredCount,
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
  // Potency is OPTIONAL: a payload produced before potency capture has no such
  // array, which sanitizes to undefined ("never measured"), not to an empty
  // array ("measured and found nothing").
  const potencyIn = Array.isArray(r.potency) ? r.potency : null;
  if (potencyIn && potencyIn.length > MAX_POTENCY) {
    return { ok: false, error: "Too many potency rows." };
  }
  const potency = potencyIn
    ? potencyIn.map(sanitizePotency).filter((p): p is PotencyBenchmark => p !== null)
    : undefined;

  const statewide: AggregationResult["statewide"] = [];
  for (const b0 of statewideIn) {
    const b = (b0 ?? {}) as Record<string, unknown>;
    const scope = b.scope;
    const saleClass = b.saleClass;
    const scopeKey = strOrNull(b.scopeKey);
    if (
      (scope !== "type" && scope !== "brand" && scope !== "strain" && scope !== "overall") ||
      (saleClass !== "retail" &&
        saleClass !== "wholesale" &&
        saleClass !== "medical" &&
        saleClass !== "doh") ||
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
      // Slice 7 (sell-in mix). Absent on pre-Slice-7 payloads → undefined,
      // which reads as "never measured", not "shipped nothing".
      byType: sanitizeTypeMix(s.byType),
      topProducts: sanitizeProductMix(s.topProducts),
      unattributedLines: numOrUndefined(s.unattributedLines),
    });
  }

  // Slice 7: producer/processor SELL-THROUGH. Separate list from `suppliers`
  // on purpose — different source, ~2% sample coverage. Absent key =>
  // undefined ("never measured"), empty array => "measured, none found".
  const producersIn = Array.isArray(r.producers) ? r.producers : null;
  if (producersIn && producersIn.length > MAX_PRODUCERS) {
    return { ok: false, error: "Too many producer rows." };
  }
  let producers: ProducerSellThroughStat[] | undefined;
  if (producersIn) {
    producers = [];
    for (const p0 of producersIn) {
      const p = (p0 ?? {}) as Record<string, unknown>;
      // License number is the join key across months — a row without one
      // cannot be attributed to anybody, so it is dropped rather than guessed.
      const licenseNumber = strOrNull(p.licenseNumber, 32);
      if (!licenseNumber) return { ok: false, error: "Malformed producer row." };
      producers.push({
        licenseNumber,
        name: strOrNull(p.name),
        dba: strOrNull(p.dba),
        units: num(p.units),
        revenueMinor: Math.round(num(p.revenueMinor)),
        lineCount: intOrNull(p.lineCount) ?? 0,
        unitPrice: sanitizeSummary(p.unitPrice),
        distinctRetailers: intOrNull(p.distinctRetailers) ?? 0,
        trackedRetailers: intOrNull(p.trackedRetailers) ?? 0,
        dohLineCount: intOrNull(p.dohLineCount) ?? 0,
        byType: sanitizeTypeMix(p.byType) ?? [],
        topProducts: sanitizeProductMix(p.topProducts) ?? [],
      });
    }
  }

  // DOH sellers ("who sold DOH-compliant product"). BACKWARD COMPATIBLE: a
  // payload from before DOH capture has no `dohSellers` key at all, which
  // sanitizes to undefined = "never measured". That is deliberately DISTINCT
  // from an empty array, which means "measured, and nobody sold DOH product".
  const dohSellersIn = Array.isArray(r.dohSellers) ? r.dohSellers : null;
  if (dohSellersIn && dohSellersIn.length > MAX_DOH_SELLERS) {
    return { ok: false, error: "Too many DOH seller rows." };
  }
  let dohSellers: DohSellerStat[] | undefined;
  if (dohSellersIn) {
    dohSellers = [];
    for (const s0 of dohSellersIn) {
      const s = (s0 ?? {}) as Record<string, unknown>;
      const licenseeId = strOrNull(s.licenseeId, 32);
      if (!licenseeId) return { ok: false, error: "Malformed DOH seller row." };
      dohSellers.push({
        licenseeId,
        licenseNumber: strOrNull(s.licenseNumber, 32),
        name: strOrNull(s.name),
        dba: strOrNull(s.dba),
        tracked: s.tracked === true,
        isSelf: s.isSelf === true,
        units: num(s.units),
        revenueMinor: Math.round(num(s.revenueMinor)),
        lineCount: intOrNull(s.lineCount) ?? 0,
        unitPrice: sanitizeSummary(s.unitPrice),
      });
    }
  }

  const signals: AggregationResult["signals"] = [];
  for (const s0 of signalsIn) {
    const s = (s0 ?? {}) as Record<string, unknown>;
    const kind = s.kind;
    if (
      kind !== "statewide_mover" &&
      kind !== "competitor_mover" &&
      kind !== "type_mover" &&
      kind !== "doh_mover"
    ) {
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
      // Task I (I4): manifest-derived shipping vendor. Optional — a pre-I4
      // payload has neither field; that sanitizes to null, never guessed.
      vendorName: strOrNull(s.vendorName),
      vendorLicense: strOrNull(s.vendorLicense, 32),
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
        // Medical split: retail lines whose SaleHeader was RecreationalMedical.
        // A SUBSET of retailLines, never added to it.
        //
        // numOrUndefined (NOT num) on purpose: a payload produced before the
        // medical split carries no such field, and coercing that to 0 would
        // state as fact that the month had no medical sales. It stays absent,
        // and absent persists as NULL — "never measured", not "none".
        medicalLines: numOrUndefined(totalsIn.medicalLines),
        // DOH counters — optional for the same reason as medicalLines. A month
        // ingested before DOH capture has no honest DOH figure; absent means
        // "never measured", which is NOT "no DOH product sold".
        dohLines: numOrUndefined(totalsIn.dohLines),
        dohUnknownLines: numOrUndefined(totalsIn.dohUnknownLines),
        dohInventoryRows: numOrUndefined(totalsIn.dohInventoryRows),
        unpackableProductIds: numOrUndefined(totalsIn.unpackableProductIds),
        // Potency counters — optional for the same reason as medicalLines.
        labResultRows: numOrUndefined(totalsIn.labResultRows),
        potencyRows: numOrUndefined(totalsIn.potencyRows),
        potencyCensoredRows: numOrUndefined(totalsIn.potencyCensoredRows),
        potencyUnjoinedRows: numOrUndefined(totalsIn.potencyUnjoinedRows),
        moverMapPrunes: num(totalsIn.moverMapPrunes),
        // Task I (I4): manifest inputs (optional — pre-I4 payloads have none).
        manifestRows: num(totalsIn.manifestRows),
        transportedItemRows: num(totalsIn.transportedItemRows),
        // Slice 7 coverage counters — optional for the same reason as the
        // others. vendorAttributedRetailLines is the sell-through SAMPLE size;
        // without it the producer list could be mistaken for a census.
        vendorAttributedRetailLines: numOrUndefined(totalsIn.vendorAttributedRetailLines),
        supplierMixLines: numOrUndefined(totalsIn.supplierMixLines),
        mixMapPrunes: numOrUndefined(totalsIn.mixMapPrunes),
      },
      statewide,
      competitors,
      signals,
      suppliers,
      potency,
      dohSellers,
      producers,
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
  // Explicit per-class metric names via an EXHAUSTIVE lookup keyed by sale
  // class. Deliberately NOT a chain of ternaries: with four classes an
  // else-branch would silently file the odd one out under "wholesale". The
  // Record<BenchmarkSaleClass, ...> type makes TypeScript fail the build if a
  // new class is ever added without naming its metrics here.
  const METRICS: Record<
    BenchmarkSaleClass,
    { price: BenchmarkMetric; ppg: BenchmarkMetric; units: BenchmarkMetric; revenue: BenchmarkMetric }
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
  const metrics = METRICS[b.saleClass];
  const priceMetric: BenchmarkMetric = metrics.price;
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
  const ppgMetric: BenchmarkMetric = metrics.ppg;
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
  const unitsMetric: BenchmarkMetric = metrics.units;
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
  const revMetric: BenchmarkMetric = metrics.revenue;
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
  {
    // DOH sellers (migration 0181). Clear is unconditional so a recompute
    // never leaves stale DOH rows behind from a previous run.
    const { error } = await admin
      .from("discovery_doh_sellers")
      .delete()
      .eq("dataset_id", datasetId);
    if (error) throw new Error(`discovery_doh_sellers clear failed: ${error.message}`);
  }
  {
    // Slice 7 (migration 0182). Unconditional clear keeps re-uploads
    // idempotent even when the new payload carries no producer block.
    const { error } = await admin
      .from("discovery_producer_stats")
      .delete()
      .eq("dataset_id", datasetId);
    if (error) throw new Error(`discovery_producer_stats clear failed: ${error.message}`);
  }

  const benchRows: Record<string, unknown>[] = [];
  for (const b of result.statewide) {
    benchRows.push(...benchmarkRows(datasetId, b, result.periodStart, result.periodEnd));
  }
  // Potency rides in the same benchmarks table under its own metric names.
  // value_num carries mg/g (the published unit) — NOT a percentage.
  for (const p of result.potency ?? []) {
    if (p.avgMgPerG == null) continue; // nothing but non-detects: no average to state
    benchRows.push({
      dataset_id: datasetId,
      scope: p.scope,
      scope_key: p.scopeKey,
      period_start: result.periodStart,
      period_end: result.periodEnd,
      metric: p.analyte === "total_thc" ? "total_thc_mg_per_g" : "total_cbd_mg_per_g",
      sample_size: p.sampleSize,
      min_minor: null,
      p25_minor: null,
      median_minor: null,
      p75_minor: null,
      max_minor: null,
      avg_minor: null,
      value_num: p.avgMgPerG,
    });
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
    // Task I (I4, migration 0110): manifest-derived shipping vendor.
    vendor_name: s.vendorName,
    vendor_license: s.vendorLicense,
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
    // Slice 7 (migration 0182): WHAT this supplier shipped. `undefined` means
    // the payload never measured a mix — persist NULL, not an empty array,
    // so a pre-Slice-7 upload never reads as "this vendor sells nothing".
    by_type: s.byType ?? null,
    top_products: s.topProducts ?? null,
    unattributed_lines: s.unattributedLines ?? null,
  }));
  await insertInBatches("discovery_supplier_stats", supplierRows);

  // Slice 7 (migration 0182): producer/processor SELL-THROUGH. `undefined`
  // means the payload predates Slice 7 — leave the absence alone rather than
  // writing an empty set that would read as "measured, nobody sold anything".
  if (result.producers) {
    const producerRows = result.producers.map((p) => ({
      dataset_id: datasetId,
      license_number: p.licenseNumber,
      name: p.name,
      dba: p.dba,
      units: p.units,
      revenue_minor: Math.round(p.revenueMinor),
      line_count: p.lineCount,
      price_sample_size: p.unitPrice?.sampleSize ?? 0,
      price_min_minor: p.unitPrice?.minMinor ?? null,
      price_p25_minor: p.unitPrice?.p25Minor ?? null,
      price_median_minor: p.unitPrice?.medianMinor ?? null,
      price_p75_minor: p.unitPrice?.p75Minor ?? null,
      price_max_minor: p.unitPrice?.maxMinor ?? null,
      price_avg_minor: p.unitPrice?.avgMinor ?? null,
      distinct_retailers: p.distinctRetailers,
      tracked_retailers: p.trackedRetailers,
      doh_line_count: p.dohLineCount,
      by_type: p.byType,
      top_products: p.topProducts,
    }));
    await insertInBatches("discovery_producer_stats", producerRows);
  }

  // DOH sellers (migration 0181): WHO sold DOH-compliant product. `undefined`
  // means the payload never measured DOH at all — leave the prior rows'
  // absence alone rather than writing an empty set that would read as
  // "measured, nobody sold DOH product".
  if (result.dohSellers) {
    const dohRows = result.dohSellers.map((s) => ({
      dataset_id: datasetId,
      licensee_id: s.licenseeId,
      license_number: s.licenseNumber,
      name: s.name,
      dba: s.dba,
      tracked: s.tracked,
      is_self: s.isSelf,
      units: s.units,
      revenue_minor: Math.round(s.revenueMinor),
      line_count: s.lineCount,
      price_sample_size: s.unitPrice?.sampleSize ?? 0,
      price_min_minor: s.unitPrice?.minMinor ?? null,
      price_p25_minor: s.unitPrice?.p25Minor ?? null,
      price_median_minor: s.unitPrice?.medianMinor ?? null,
      price_p75_minor: s.unitPrice?.p75Minor ?? null,
      price_max_minor: s.unitPrice?.maxMinor ?? null,
      price_avg_minor: s.unitPrice?.avgMinor ?? null,
    }));
    await insertInBatches("discovery_doh_sellers", dohRows);
  }

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
        // Medical split (migration 0180). A SUBSET of retail_lines, so
        // non-medical retail = retail_lines - medical_lines. Writes NULL (not
        // 0) when the payload never measured it — an unmeasured month must not
        // claim it had zero medical sales.
        medical_lines:
          result.totals.medicalLines == null ? null : Math.round(result.totals.medicalLines),
        // DOH capture (migration 0181). A SUBSET of retail_lines, and
        // INDEPENDENT of medical_lines — the two overlap freely and must never
        // be subtracted from one another. NULL when never measured.
        doh_lines: result.totals.dohLines == null ? null : Math.round(result.totals.dohLines),
        doh_unknown_lines:
          result.totals.dohUnknownLines == null
            ? null
            : Math.round(result.totals.dohUnknownLines),
        doh_inventory_rows:
          result.totals.dohInventoryRows == null
            ? null
            : Math.round(result.totals.dohInventoryRows),
        // Slice 7 (migration 0182): the sell-through SAMPLE size. Without this
        // the producer list has no stated denominator and could be mistaken
        // for a complete picture of the market. NULL when never measured.
        vendor_attributed_retail_lines:
          result.totals.vendorAttributedRetailLines == null
            ? null
            : Math.round(result.totals.vendorAttributedRetailLines),
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

/**
 * Who sold DOH-compliant product in this dataset's month (revenue desc) —
 * the evidence base for the medical-endorsement decision.
 */
export async function listDohSellers(datasetId: string): Promise<DiscoveryDohSellerRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_doh_sellers")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("revenue_minor", { ascending: false });
  return (data as DiscoveryDohSellerRow[] | null) ?? [];
}

/**
 * Slice 7: producer/processors ranked by retail SELL-THROUGH (what consumers
 * actually bought), revenue desc.
 *
 * HONESTY: this list rides the manifest ORIGIN join, which matched ~2% of
 * inventory rows in the real May-2026 delivery. It is a SAMPLE of the market,
 * not a census — every consumer must say so. For near-complete "what shipped"
 * numbers use listSupplierStats() instead. The two must never be summed.
 */
export async function listProducerStats(datasetId: string): Promise<DiscoveryProducerStatRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_producer_stats")
    .select("*")
    .eq("dataset_id", datasetId)
    .order("revenue_minor", { ascending: false });
  return (data as DiscoveryProducerStatRow[] | null) ?? [];
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
