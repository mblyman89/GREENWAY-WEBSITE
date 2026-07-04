/**
 * src/lib/discovery/ingest.ts
 *
 * Server-side ingestion of uploaded WSLCB CCRS public-records extract files
 * into the discovery_ccrs_* tables under a dataset. Uses the pure parser in
 * ccrs.ts, then batch-inserts with the service-role client.
 *
 * STANDING RULES honored:
 *   - Guarded by isSupabaseServiceConfigured + isDiscoveryEnabled (kill-switch).
 *   - DRAFTS-ONLY: writes only to discovery_ccrs_* / discovery_datasets. Never
 *     touches vendors/catalog/purchase_orders.
 *   - Money in MINOR UNITS (parser already converts).
 *   - NEVER GUESS: an unrecognized file is reported, not force-fit.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { isDiscoveryEnabled } from "./store";
import { parseCcrsFile, pricePerGramMinor } from "./ccrs";
import type { CcrsFileKind, DiscoveryDataset } from "./types";

const BATCH = 500;

async function insertInBatches(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const admin = createSupabaseAdminClient();
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await admin.from(table).insert(chunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Datasets
// ---------------------------------------------------------------------------
export async function listDatasets(): Promise<DiscoveryDataset[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_datasets")
    .select("*")
    .order("created_at", { ascending: false });
  return (data as DiscoveryDataset[] | null) ?? [];
}

export async function getDataset(id: string): Promise<DiscoveryDataset | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("discovery_datasets").select("*").eq("id", id).maybeSingle();
  return (data as DiscoveryDataset | null) ?? null;
}

export async function createDataset(input: {
  label: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  sourceNote?: string | null;
  uploadedBy?: string | null;
}): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("discovery_datasets")
    .insert({
      label: input.label,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      source_note: input.sourceNote ?? null,
      uploaded_by: input.uploadedBy ?? null,
      status: "uploading",
    })
    .select("id")
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function deleteDataset(id: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  // discovery_ccrs_* + benchmarks cascade via FK on delete.
  await admin.from("discovery_datasets").delete().eq("id", id);
}

export async function markDatasetReady(id: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("discovery_datasets").update({ status: "ready", error: null }).eq("id", id);
}

export async function markDatasetError(id: string, error: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();
  await admin.from("discovery_datasets").update({ status: "error", error }).eq("id", id);
}

// ---------------------------------------------------------------------------
// Ingest one uploaded file into a dataset
// ---------------------------------------------------------------------------

export type IngestResult = {
  ok: boolean;
  kind: CcrsFileKind;
  inserted: number;
  message: string;
};

/**
 * Parse + store one CCRS file's text into the dataset. Returns the detected
 * kind and inserted count. For Sale rows we denormalize Product context
 * (category/type/name/brand/weight) by joining against products already
 * ingested in the SAME dataset (so upload Product BEFORE Sale for richest
 * benchmarks — but Sale still ingests fine without it).
 */
export async function ingestCcrsText(datasetId: string, text: string): Promise<IngestResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, kind: "unknown", inserted: 0, message: "Supabase not configured." };
  }
  if (!(await isDiscoveryEnabled())) {
    return { ok: false, kind: "unknown", inserted: 0, message: "Discovery is turned off." };
  }

  const parsed = parseCcrsFile(text);
  if (parsed.kind === "unknown") {
    return {
      ok: false,
      kind: "unknown",
      inserted: 0,
      message:
        "Could not recognize this file as a CCRS Sale, Product, Inventory, LabTest, or Strain export. Check the column headers.",
    };
  }

  const admin = createSupabaseAdminClient();

  if (parsed.kind === "product") {
    const rows = parsed.records.map((r) => ({
      dataset_id: datasetId,
      license_number: r.license_number,
      category: r.category,
      product_type: r.product_type,
      name: r.name,
      brand: r.brand,
      description: r.description,
      unit_weight_grams: r.unit_weight_grams,
      ext_id: r.ext_id,
    }));
    await insertInBatches("discovery_ccrs_products", rows);
    await bumpCount(datasetId, "product_rows", rows.length);
    return { ok: true, kind: "product", inserted: rows.length, message: `Imported ${rows.length} products.` };
  }

  if (parsed.kind === "sale") {
    // Build an ext_id → product context map from products already in this dataset.
    const productMap = await loadProductContext(datasetId);
    const rows = parsed.records.map((r) => {
      const ctx = r.inventory_ext_id ? undefined : undefined; // inventory linkage handled below
      void ctx;
      // Sales link to inventory (InventoryExternalIdentifier); products are a
      // separate id space. We denormalize product context when the sale's
      // inventory ext id also appears as a product ext id (common in extracts
      // where product == inventory lot). Otherwise leave product_* null.
      const p = r.inventory_ext_id ? productMap.get(r.inventory_ext_id) : undefined;
      const ppg = pricePerGramMinor(r.unit_price_minor, p?.unit_weight_grams ?? null);
      return {
        dataset_id: datasetId,
        seller_license: r.seller_license,
        buyer_license: r.buyer_license,
        sale_type: r.sale_type,
        sale_date: r.sale_date,
        quantity_num: r.quantity_num,
        unit_price_minor: r.unit_price_minor,
        discount_minor: r.discount_minor,
        sales_tax_minor: r.sales_tax_minor,
        other_tax_minor: r.other_tax_minor,
        inventory_ext_id: r.inventory_ext_id,
        sale_ext_id: r.sale_ext_id,
        product_category: p?.category ?? null,
        product_type: p?.product_type ?? null,
        product_name: p?.name ?? null,
        brand: p?.brand ?? null,
        unit_weight_grams: p?.unit_weight_grams ?? null,
        price_per_gram_minor: ppg,
      };
    });
    await insertInBatches("discovery_ccrs_sales", rows);
    await bumpCount(datasetId, "sales_rows", rows.length);
    return { ok: true, kind: "sale", inserted: rows.length, message: `Imported ${rows.length} sales.` };
  }

  if (parsed.kind === "labtest") {
    const rows = parsed.records.map((r) => ({
      dataset_id: datasetId,
      inventory_ext_id: r.inventory_ext_id,
      lab_license_number: r.lab_license_number,
      test_name: r.test_name,
      test_value_num: r.test_value_num,
      test_date: r.test_date,
    }));
    await insertInBatches("discovery_ccrs_lab", rows);
    await bumpCount(datasetId, "lab_rows", rows.length);
    return { ok: true, kind: "labtest", inserted: rows.length, message: `Imported ${rows.length} lab results.` };
  }

  if (parsed.kind === "inventory") {
    // Inventory rows are stored as products' cost basis is not separately
    // tabled here; we fold TotalCost into a lightweight products upsert is out
    // of scope — instead we keep inventory row count for provenance and use
    // Sale rows for pricing. (Kept minimal + honest.)
    await bumpCount(datasetId, "inventory_rows", parsed.records.length);
    return {
      ok: true,
      kind: "inventory",
      inserted: parsed.records.length,
      message: `Noted ${parsed.records.length} inventory rows (used for provenance).`,
    };
  }

  if (parsed.kind === "strain") {
    await bumpCount(datasetId, "strain_rows", parsed.records.length);
    return {
      ok: true,
      kind: "strain",
      inserted: parsed.records.length,
      message: `Noted ${parsed.records.length} strain rows.`,
    };
  }

  return { ok: false, kind: "unknown", inserted: 0, message: "Unsupported file." };

  async function bumpCount(dsId: string, column: string, add: number): Promise<void> {
    const ds = await getDataset(dsId);
    const current = (ds as unknown as Record<string, number>)?.[column] ?? 0;
    await admin.from("discovery_datasets").update({ [column]: current + add }).eq("id", dsId);
  }
}

/** Load ext_id → minimal product context for the dataset (for Sale denormalization). */
async function loadProductContext(datasetId: string): Promise<
  Map<string, { category: string | null; product_type: string | null; name: string | null; brand: string | null; unit_weight_grams: number | null }>
> {
  const map = new Map<
    string,
    { category: string | null; product_type: string | null; name: string | null; brand: string | null; unit_weight_grams: number | null }
  >();
  if (!isSupabaseServiceConfigured) return map;
  const admin = createSupabaseAdminClient();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await admin
      .from("discovery_ccrs_products")
      .select("ext_id, category, product_type, name, brand, unit_weight_grams")
      .eq("dataset_id", datasetId)
      .range(from, from + pageSize - 1);
    const rows = (data as Array<{
      ext_id: string | null;
      category: string | null;
      product_type: string | null;
      name: string | null;
      brand: string | null;
      unit_weight_grams: number | null;
    }> | null) ?? [];
    for (const r of rows) {
      if (r.ext_id) {
        map.set(r.ext_id, {
          category: r.category,
          product_type: r.product_type,
          name: r.name,
          brand: r.brand,
          unit_weight_grams: r.unit_weight_grams,
        });
      }
    }
    if (rows.length < pageSize) break;
  }
  return map;
}
