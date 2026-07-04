/**
 * src/lib/discovery/benchmarks.ts
 *
 * Server-side computation of CCRS benchmarks from ingested discovery_ccrs_*
 * rows, plus derivation of the supplier roster and generation of vendor leads
 * from wholesale sellers.
 *
 * STANDING RULES honored:
 *   - Guarded by isSupabaseServiceConfigured + isDiscoveryEnabled.
 *   - NEVER FABRICATE: benchmarks are computed only from real rows; a scope
 *     with no rows produces no benchmark. No synthetic market prices.
 *   - Money in MINOR UNITS. Percentiles via pure benchmarks-core helpers.
 *   - Vendor-lead generation reuses the existing reconcile/dedupe engine.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isDiscoveryEnabled, createVendorLead, listSources } from "./store";
import { summarizeMinor, avgNum } from "./benchmarks-core";
import type {
  BenchmarkMetric,
  BenchmarkScope,
  DiscoveryBenchmark,
  DiscoveryDataset,
} from "./types";

type SaleRow = {
  seller_license: string | null;
  buyer_license: string | null;
  sale_type: string;
  quantity_num: number | null;
  unit_price_minor: number | null;
  price_per_gram_minor: number | null;
  product_category: string | null;
  product_type: string | null;
  product_name: string | null;
  brand: string | null;
};

async function loadSales(datasetId: string): Promise<SaleRow[]> {
  const admin = createSupabaseAdminClient();
  const out: SaleRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await admin
      .from("discovery_ccrs_sales")
      .select(
        "seller_license, buyer_license, sale_type, quantity_num, unit_price_minor, price_per_gram_minor, product_category, product_type, product_name, brand",
      )
      .eq("dataset_id", datasetId)
      .range(from, from + pageSize - 1);
    const rows = (data as SaleRow[] | null) ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Compute benchmarks
// ---------------------------------------------------------------------------

type BenchInsert = Omit<DiscoveryBenchmark, "id" | "computed_at">;

/**
 * Recompute ALL benchmarks for a dataset: wholesale & retail unit price and
 * price-per-gram summaries per category / type / category_type / brand, plus
 * potency (THC/CBD) per category. Replaces prior rows for the dataset.
 */
export async function computeBenchmarks(datasetId: string): Promise<{ rows: number }> {
  if (!isSupabaseServiceConfigured) return { rows: 0 };
  if (!(await isDiscoveryEnabled())) return { rows: 0 };
  const admin = createSupabaseAdminClient();

  const ds = (await admin.from("discovery_datasets").select("*").eq("id", datasetId).maybeSingle()).data as
    | DiscoveryDataset
    | null;
  const periodStart = ds?.period_start ?? null;
  const periodEnd = ds?.period_end ?? null;

  const sales = await loadSales(datasetId);

  // Accumulators: scope|key|metric -> number[]
  const priceBuckets = new Map<string, number[]>();
  const push = (scope: BenchmarkScope, key: string, metric: BenchmarkMetric, v: number | null) => {
    if (v == null || !Number.isFinite(v)) return;
    const k = `${scope}\u0001${key}\u0001${metric}`;
    const arr = priceBuckets.get(k);
    if (arr) arr.push(v);
    else priceBuckets.set(k, [v]);
  };

  // Units + revenue accumulators (kept separate; totals not percentiles)
  const unitTotals = new Map<string, number>(); // scope|key -> units
  const revenueTotals = new Map<string, number>(); // scope|key -> minor
  const addTotals = (scope: BenchmarkScope, key: string, units: number, revenueMinor: number) => {
    const k = `${scope}\u0001${key}`;
    unitTotals.set(k, (unitTotals.get(k) ?? 0) + units);
    revenueTotals.set(k, (revenueTotals.get(k) ?? 0) + revenueMinor);
  };

  for (const s of sales) {
    const priceMetric: BenchmarkMetric | null =
      s.sale_type === "wholesale"
        ? "wholesale_unit_price"
        : s.sale_type === "retail" || s.sale_type === "medical"
          ? "retail_unit_price"
          : null;
    if (!priceMetric) continue;

    const cat = s.product_category?.trim() || null;
    const typ = s.product_type?.trim() || null;
    const brand = s.brand?.trim() || null;
    const catType = cat && typ ? `${cat}|${typ}` : null;

    const up = s.unit_price_minor;
    const ppg = s.price_per_gram_minor;
    const qty = s.quantity_num ?? 0;
    const revenue = up != null ? up * (qty || 1) : 0;

    if (cat) {
      push("category", cat, priceMetric, up);
      push("category", cat, "price_per_gram", ppg);
      addTotals("category", cat, qty, revenue);
    }
    if (typ) {
      push("type", typ, priceMetric, up);
    }
    if (catType) {
      push("category_type", catType, priceMetric, up);
      push("category_type", catType, "price_per_gram", ppg);
    }
    if (brand) {
      push("brand", brand, priceMetric, up);
      addTotals("brand", brand, qty, revenue);
    }
    // overall
    push("overall", "all", priceMetric, up);
  }

  // Potency: join lab tests to sales' product context is expensive; instead we
  // summarize lab test values per test_name across the dataset (THC/CBD ranges).
  const potency = await loadPotency(datasetId);

  const toInsert: BenchInsert[] = [];

  for (const [k, values] of priceBuckets.entries()) {
    const [scope, scope_key, metric] = k.split("\u0001") as [BenchmarkScope, string, BenchmarkMetric];
    const s = summarizeMinor(values);
    if (s.sample_size === 0) continue;
    toInsert.push({
      dataset_id: datasetId,
      scope,
      scope_key,
      metric,
      sample_size: s.sample_size,
      min_minor: s.min_minor,
      p25_minor: s.p25_minor,
      median_minor: s.median_minor,
      p75_minor: s.p75_minor,
      max_minor: s.max_minor,
      avg_minor: s.avg_minor,
      value_num: null,
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  // Units + revenue totals as value_num / avg_minor
  for (const [k, units] of unitTotals.entries()) {
    const [scope, scope_key] = k.split("\u0001") as [BenchmarkScope, string];
    toInsert.push({
      dataset_id: datasetId,
      scope,
      scope_key,
      metric: "units",
      sample_size: 0,
      min_minor: null,
      p25_minor: null,
      median_minor: null,
      p75_minor: null,
      max_minor: null,
      avg_minor: null,
      value_num: units,
      period_start: periodStart,
      period_end: periodEnd,
    });
  }
  for (const [k, revenueMinor] of revenueTotals.entries()) {
    const [scope, scope_key] = k.split("\u0001") as [BenchmarkScope, string];
    toInsert.push({
      dataset_id: datasetId,
      scope,
      scope_key,
      metric: "revenue",
      sample_size: 0,
      min_minor: null,
      p25_minor: null,
      median_minor: null,
      p75_minor: null,
      max_minor: null,
      avg_minor: Math.round(revenueMinor),
      value_num: null,
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  // Potency benchmarks (value_num = avg %). scope 'overall', key = test name.
  for (const [testName, vals] of potency.entries()) {
    const metric: BenchmarkMetric | null = /cbd/i.test(testName)
      ? "cbd_pct"
      : /thc/i.test(testName)
        ? "thc_pct"
        : null;
    if (!metric) continue;
    const avg = avgNum(vals);
    if (avg == null) continue;
    toInsert.push({
      dataset_id: datasetId,
      scope: "overall",
      scope_key: testName,
      metric,
      sample_size: vals.length,
      min_minor: null,
      p25_minor: null,
      median_minor: null,
      p75_minor: null,
      max_minor: null,
      avg_minor: null,
      value_num: Math.round(avg * 100) / 100,
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  // Replace prior benchmarks for this dataset, then insert fresh.
  await admin.from("discovery_benchmarks").delete().eq("dataset_id", datasetId);
  if (toInsert.length) {
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const { error } = await admin.from("discovery_benchmarks").insert(chunk);
      if (error) throw new Error(`benchmark insert failed: ${error.message}`);
    }
  }

  // Roster + timestamp.
  await deriveLicenseeRoster(datasetId, sales);
  await admin
    .from("discovery_datasets")
    .update({ benchmarks_computed_at: new Date().toISOString() })
    .eq("id", datasetId);

  return { rows: toInsert.length };
}

async function loadPotency(datasetId: string): Promise<Map<string, number[]>> {
  const admin = createSupabaseAdminClient();
  const map = new Map<string, number[]>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await admin
      .from("discovery_ccrs_lab")
      .select("test_name, test_value_num")
      .eq("dataset_id", datasetId)
      .range(from, from + pageSize - 1);
    const rows = (data as Array<{ test_name: string | null; test_value_num: number | null }> | null) ?? [];
    for (const r of rows) {
      if (r.test_name && r.test_value_num != null && Number.isFinite(r.test_value_num)) {
        const key = r.test_name.trim();
        const arr = map.get(key);
        if (arr) arr.push(r.test_value_num);
        else map.set(key, [r.test_value_num]);
      }
    }
    if (rows.length < pageSize) break;
  }
  return map;
}

/** Derive the supplier roster from wholesale sales (seller = supplier). */
export async function deriveLicenseeRoster(datasetId: string, sales?: SaleRow[]): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  const rows = sales ?? (await loadSales(datasetId));

  const agg = new Map<string, { units: number; minor: number }>();
  for (const s of rows) {
    if (s.sale_type !== "wholesale" || !s.seller_license) continue;
    const qty = s.quantity_num ?? 0;
    const revenue = s.unit_price_minor != null ? s.unit_price_minor * (qty || 1) : 0;
    const cur = agg.get(s.seller_license) ?? { units: 0, minor: 0 };
    cur.units += qty;
    cur.minor += revenue;
    agg.set(s.seller_license, cur);
  }

  await admin.from("discovery_ccrs_licensees").delete().eq("dataset_id", datasetId);
  const inserts = [...agg.entries()].map(([license, v]) => ({
    dataset_id: datasetId,
    license_number: license,
    name: null,
    role: "producer_processor" as const,
    wholesale_out_units: v.units,
    wholesale_out_minor: Math.round(v.minor),
  }));
  for (let i = 0; i < inserts.length; i += 500) {
    const chunk = inserts.slice(i, i + 500);
    if (chunk.length) await admin.from("discovery_ccrs_licensees").insert(chunk);
  }
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function listBenchmarks(
  datasetId: string,
  opts?: { scope?: BenchmarkScope; metric?: BenchmarkMetric },
): Promise<DiscoveryBenchmark[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin.from("discovery_benchmarks").select("*").eq("dataset_id", datasetId);
  if (opts?.scope) q = q.eq("scope", opts.scope);
  if (opts?.metric) q = q.eq("metric", opts.metric);
  const { data } = await q.order("scope_key", { ascending: true });
  return (data as DiscoveryBenchmark[] | null) ?? [];
}

/** Convenience lookup of one benchmark row (e.g. for a chip). */
export async function getBenchmarkFor(
  datasetId: string,
  scope: BenchmarkScope,
  scopeKey: string,
  metric: BenchmarkMetric,
): Promise<DiscoveryBenchmark | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_benchmarks")
    .select("*")
    .eq("dataset_id", datasetId)
    .eq("scope", scope)
    .eq("scope_key", scopeKey)
    .eq("metric", metric)
    .maybeSingle();
  return (data as DiscoveryBenchmark | null) ?? null;
}

export async function listTopLicensees(
  datasetId: string,
  limit = 25,
): Promise<Array<{ license_number: string; name: string | null; wholesale_out_units: number; wholesale_out_minor: number }>> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_ccrs_licensees")
    .select("license_number, name, wholesale_out_units, wholesale_out_minor")
    .eq("dataset_id", datasetId)
    .order("wholesale_out_minor", { ascending: false })
    .limit(limit);
  return (
    (data as Array<{
      license_number: string;
      name: string | null;
      wholesale_out_units: number;
      wholesale_out_minor: number;
    }> | null) ?? []
  );
}

/** The most recent dataset with computed benchmarks (for defaults). */
export async function getLatestReadyDataset(): Promise<DiscoveryDataset | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_datasets")
    .select("*")
    .eq("status", "ready")
    .order("benchmarks_computed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  return (data as DiscoveryDataset | null) ?? null;
}

// ---------------------------------------------------------------------------
// Vendor-lead generation from CCRS wholesale sellers
// ---------------------------------------------------------------------------

/**
 * Turn the top wholesale sellers in a dataset into vendor leads (deduped +
 * reconciled by the existing engine). Priority by wholesale $ rank. Returns how
 * many produced a NEW lead row.
 */
export async function generateVendorLeadsFromCcrs(
  datasetId: string,
  opts?: { limit?: number; createdBy?: string | null },
): Promise<{ inserted: number; processed: number }> {
  if (!isSupabaseServiceConfigured) return { inserted: 0, processed: 0 };
  if (!(await isDiscoveryEnabled())) return { inserted: 0, processed: 0 };

  const top = await listTopLicensees(datasetId, opts?.limit ?? 50);
  // Prefer the WSLCB source id for provenance if present, else null.
  const sources = await listSources();
  const wslcb = sources.find((s) => s.kind === "wslcb_license_list");
  const sourceId = wslcb?.id ?? null;

  let inserted = 0;
  const n = top.length;
  for (let i = 0; i < n; i++) {
    const lic = top[i];
    // top third → high, middle → med, bottom → low
    const priority = i < n / 3 ? "high" : i < (2 * n) / 3 ? "med" : "low";
    const id = await createVendorLead({
      sourceId,
      displayName: lic.name ?? `WA License ${lic.license_number}`,
      licenseNumber: lic.license_number,
      priority,
      note: `From CCRS wholesale activity: ${lic.wholesale_out_units.toLocaleString()} units, $${(
        lic.wholesale_out_minor / 100
      ).toLocaleString(undefined, { maximumFractionDigits: 0 })} shipped.`,
      createdBy: opts?.createdBy ?? null,
    });
    if (id) inserted += 1;
  }
  return { inserted, processed: n };
}
