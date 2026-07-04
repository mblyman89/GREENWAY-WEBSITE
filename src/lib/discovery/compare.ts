import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isDiscoveryEnabled } from "./store";
import { listBenchmarks } from "./benchmarks";
import type { DiscoveryBenchmark, BenchmarkScope, BenchmarkMetric } from "./types";

/**
 * Compare layer (Slice 6).
 *
 * Compares Greenway's OWN live inventory (what we paid vendors) against the
 * statewide CCRS **wholesale** price benchmark, by category. This is the
 * headline value: "am I over- or under-paying versus the rest of the state?"
 *
 * We deliberately compare COST-vs-WHOLESALE because both are what a store pays
 * a vendor — apples to apples. Retail-vs-retail is available on the benchmarks
 * page. Everything here is READ-ONLY and derived; nothing is written.
 *
 * Money is in minor units (cents) end to end. All source columns are verified
 * against inventory_lots (see src/lib/inventory/types.ts) and the CCRS
 * benchmark rows we compute — nothing is guessed.
 */

export type CompareRow = {
  /** Category label as stored on our lots (falls back to "Uncategorized"). */
  category: string;
  /** How many of our lots feed this row. */
  lotCount: number;
  /** Our average unit cost (what we pay vendors), minor units. */
  ourAvgCostMinor: number | null;
  /** Our average cost per gram, minor units (null when weights unknown). */
  ourAvgCostPerGramMinor: number | null;
  /** Statewide median wholesale unit price for this category, minor units. */
  benchWholesaleMedianMinor: number | null;
  /** Statewide median wholesale $/gram for this category, minor units. */
  benchWholesalePerGramMedianMinor: number | null;
  /** ourAvgCost - benchMedian (positive = we pay MORE than the state). */
  deltaMinor: number | null;
  /** delta as a percentage of the benchmark median. */
  deltaPct: number | null;
  /** "over" | "under" | "inline" | "no_benchmark". */
  flag: CompareFlag;
  /** Benchmark transaction sample size backing the comparison. */
  benchSample: number;
};

export type CompareFlag = "over" | "under" | "inline" | "no_benchmark";

export type CompareResult = {
  datasetId: string | null;
  rows: CompareRow[];
  /** Provenance for display. */
  computedAt: string | null;
};

type LotLite = {
  category: string | null;
  unit_cost_minor_units: number | null;
  unit_weight: number | null;
};

const INLINE_BAND = 0.05; // within ±5% of the statewide median = "in line".

function norm(cat: string | null | undefined): string {
  const c = (cat ?? "").trim();
  return c.length ? c : "Uncategorized";
}

/** Case-insensitive lookup of a benchmark row by scope/key/metric. */
function findBench(
  rows: DiscoveryBenchmark[],
  scope: BenchmarkScope,
  key: string,
  metric: BenchmarkMetric,
): DiscoveryBenchmark | null {
  const lk = key.trim().toLowerCase();
  return (
    rows.find(
      (r) => r.scope === scope && r.metric === metric && (r.scope_key ?? "").trim().toLowerCase() === lk,
    ) ?? null
  );
}

function classify(ourMinor: number | null, benchMinor: number | null): { flag: CompareFlag; deltaMinor: number | null; deltaPct: number | null } {
  if (ourMinor == null || benchMinor == null || benchMinor === 0) {
    return { flag: "no_benchmark", deltaMinor: null, deltaPct: null };
  }
  const deltaMinor = ourMinor - benchMinor;
  const deltaPct = deltaMinor / benchMinor;
  let flag: CompareFlag;
  if (Math.abs(deltaPct) <= INLINE_BAND) flag = "inline";
  else if (deltaPct > 0) flag = "over";
  else flag = "under";
  return { flag, deltaMinor, deltaPct: deltaPct * 100 };
}

async function loadOwnLots(): Promise<LotLite[]> {
  const admin = createSupabaseAdminClient();
  const out: LotLite[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await admin
      .from("inventory_lots")
      .select("category, unit_cost_minor_units, unit_weight, status")
      .neq("status", "destroyed")
      .range(from, from + pageSize - 1);
    const rows =
      (data as Array<LotLite & { status?: string }> | null)?.map((r) => ({
        category: r.category,
        unit_cost_minor_units: r.unit_cost_minor_units,
        unit_weight: r.unit_weight,
      })) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * Build the our-vs-market comparison for a given (computed) dataset. When no
 * dataset is supplied, callers should pass the latest computed one.
 */
export async function compareOwnVsBenchmarks(datasetId: string, computedAt?: string | null): Promise<CompareResult> {
  if (!isSupabaseServiceConfigured) return { datasetId: null, rows: [], computedAt: null };
  if (!(await isDiscoveryEnabled())) return { datasetId: null, rows: [], computedAt: null };

  const [lots, bench] = await Promise.all([loadOwnLots(), listBenchmarks(datasetId)]);

  // Aggregate our lots by category.
  type Agg = { count: number; costSum: number; costN: number; ppgSum: number; ppgN: number };
  const byCat = new Map<string, Agg>();
  for (const lot of lots) {
    const cat = norm(lot.category);
    const agg = byCat.get(cat) ?? { count: 0, costSum: 0, costN: 0, ppgSum: 0, ppgN: 0 };
    agg.count += 1;
    const cost = lot.unit_cost_minor_units;
    if (cost != null && Number.isFinite(cost)) {
      agg.costSum += cost;
      agg.costN += 1;
      const w = lot.unit_weight;
      if (w != null && w > 0) {
        agg.ppgSum += cost / w;
        agg.ppgN += 1;
      }
    }
    byCat.set(cat, agg);
  }

  const rows: CompareRow[] = [];
  for (const [category, agg] of byCat.entries()) {
    const ourAvgCostMinor = agg.costN > 0 ? Math.round(agg.costSum / agg.costN) : null;
    const ourAvgCostPerGramMinor = agg.ppgN > 0 ? Math.round(agg.ppgSum / agg.ppgN) : null;

    const benchUnit = findBench(bench, "category", category, "wholesale_unit_price");
    const benchPpg = findBench(bench, "category", category, "price_per_gram");
    const benchWholesaleMedianMinor = benchUnit?.median_minor ?? null;
    const benchWholesalePerGramMedianMinor = benchPpg?.median_minor ?? null;

    const { flag, deltaMinor, deltaPct } = classify(ourAvgCostMinor, benchWholesaleMedianMinor);

    rows.push({
      category,
      lotCount: agg.count,
      ourAvgCostMinor,
      ourAvgCostPerGramMinor,
      benchWholesaleMedianMinor,
      benchWholesalePerGramMedianMinor,
      deltaMinor,
      deltaPct,
      flag,
      benchSample: benchUnit?.sample_size ?? 0,
    });
  }

  // Sort: biggest overpay first (actionable), then the rest.
  rows.sort((a, b) => (b.deltaMinor ?? -Infinity) - (a.deltaMinor ?? -Infinity));

  return { datasetId, rows, computedAt: computedAt ?? null };
}

/**
 * A single-category benchmark chip datum for use on product-lead rows / PO
 * lines. Returns null when there's no benchmark for that category.
 */
export type BenchmarkChip = {
  category: string;
  medianWholesaleMinor: number | null;
  medianRetailMinor: number | null;
  medianPerGramMinor: number | null;
  sample: number;
};

export async function benchmarkChipForCategory(
  datasetId: string,
  category: string,
): Promise<BenchmarkChip | null> {
  if (!isSupabaseServiceConfigured) return null;
  const bench = await listBenchmarks(datasetId, { scope: "category" });
  const wholesale = findBench(bench, "category", category, "wholesale_unit_price");
  const retail = findBench(bench, "category", category, "retail_unit_price");
  const ppg = findBench(bench, "category", category, "price_per_gram");
  if (!wholesale && !retail && !ppg) return null;
  return {
    category,
    medianWholesaleMinor: wholesale?.median_minor ?? null,
    medianRetailMinor: retail?.median_minor ?? null,
    medianPerGramMinor: ppg?.median_minor ?? null,
    sample: (wholesale?.sample_size ?? 0) + (retail?.sample_size ?? 0),
  };
}
