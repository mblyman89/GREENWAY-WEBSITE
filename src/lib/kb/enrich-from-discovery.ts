/**
 * src/lib/kb/enrich-from-discovery.ts
 *
 * SLICE B — KB enrichment from state CCRS discovery data.
 *
 * OWNER REQUEST (verbatim): "with the data we will get from product/vendor
 * leads by importing the state data, we should be able to enrich our kb
 * significantly right?! Will you make sure that whatever data we pull in from
 * the state to do our leads and set our bench marks and such, are also
 * connected to our kb. Any information we get that is accurate, needs to find
 * its home in the kb."
 *
 * WHAT THIS DOES: turns one uploaded CCRS dataset (discovery_ccrs_products +
 * the vendors directory) into reviewable KB drafts:
 *   • BRANDS   — distinct product brand prefixes → kb_brands drafts, linked to
 *                the operational vendor when the license number matches.
 *   • PRODUCTS — CCRS product rows → kb_products drafts keyed by the natural
 *                identity (brand_slug, product_slug, variant_label), with the
 *                category mapped through our canonical website-category
 *                resolver and prose compliance-gated.
 *
 * GUARANTEES (mirrors src/lib/ai/kb/writeback.ts — the canonical pattern):
 *   • DRAFTS-ONLY   — every machine write lands status='draft', active=false.
 *                     Nothing is authoritative until a human publishes it in
 *                     the KB review inbox.
 *   • NON-DESTRUCTIVE — inserts use ON CONFLICT DO NOTHING; existing rows are
 *                     only gap-filled (null → value, arrays unioned). Curated
 *                     data is NEVER overwritten.
 *   • PROVENANCE    — source='ccrs:<datasetId>', sources[] carries the dataset
 *                     label, confidence 0.9 (license-matched vendor) / 0.6
 *                     (name-only). Every fact is auditable back to its file.
 *   • COMPLIANCE-GATED — descriptions run through checkCompliance() + the
 *                     owner blocklist; non-compliant prose is stripped, the
 *                     structured facts still land.
 *   • BOUNDED       — every read pages `.range()` past the PostgREST 1000-row
 *                     cap; hard caps keep one run's memory/time sane.
 *   • DEFENSIVE     — kb_brands writes require migration 0082 (status column);
 *                     without it we skip brands with a clear warning instead
 *                     of writing rows that would bypass the drafts lifecycle.
 *   • POTENCY       — kb_products has NO potency columns (verified against
 *                     migration 0071). Lab results are NOT attached; a warning
 *                     documents the gap instead of guessing a home for it.
 *   • DRY-RUN       — opts.dryRun computes the full report without writing.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { checkCompliance } from "@/lib/ai/compliance";
import { loadBannedPhrases } from "@/lib/ai/kb/retrieval";
import { normalizeLicense } from "@/lib/discovery/reconcile";
import { resolveWebsiteCategory } from "@/lib/inventory/website-category-resolver";

// ---------------------------------------------------------------------------
// Bounds — keep a single run predictable. Warnings surface when a cap is hit.
// ---------------------------------------------------------------------------
const PAGE = 1000; // PostgREST single-select cap; page every read.
const MAX_PRODUCT_ROWS = 20000; // discovery rows consumed per run
const MAX_EXISTING_KB_PRODUCTS = 20000; // existing kb rows loaded for gap-fill
const MAX_GAPFILL_UPDATES = 2000; // per-row updates per run
const INSERT_CHUNK = 500;

export type EnrichResult = {
  ok: boolean;
  dryRun: boolean;
  brandsInserted: number;
  brandsEnriched: number;
  productsInserted: number;
  productsEnriched: number;
  skipped: number;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Small pure helpers (kept in sync with src/lib/ai/kb/writeback.ts).
// ---------------------------------------------------------------------------

/** Dashed slug — MUST match writeback.ts so kb_brands.slug ↔ kb_products.brand_slug link. */
function slugifyDashed(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Union two string arrays (case-insensitive), preserving first-seen casing. */
function unionNotes(existing: string[] | null | undefined, incoming: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...(existing ?? []), ...(incoming ?? [])]) {
    const key = String(v ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(v).trim());
  }
  return out;
}

/** "3.5" → "3.5g"; null/0/NaN → "" (base variant). */
function variantFromGrams(grams: number | null | undefined): string {
  if (grams == null || !Number.isFinite(grams) || grams <= 0) return "";
  // Trim trailing zeros without scientific notation surprises.
  const s = String(Math.round(grams * 1000) / 1000);
  return `${s}g`;
}

/** Probe a table/column so a pre-migration schema degrades instead of failing. */
async function tableUsable(table: string, column = "id"): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from(table).select(column, { head: true, count: "exact" }).limit(1);
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Paged reads
// ---------------------------------------------------------------------------

type DiscoveryProductRow = {
  license_number: string | null;
  category: string | null;
  product_type: string | null;
  name: string | null;
  brand: string | null;
  description: string | null;
  unit_weight_grams: number | null;
};

async function loadDiscoveryProducts(datasetId: string, warnings: string[]): Promise<DiscoveryProductRow[]> {
  const admin = createSupabaseAdminClient();
  const rows: DiscoveryProductRow[] = [];
  for (let from = 0; from < MAX_PRODUCT_ROWS; from += PAGE) {
    const { data, error } = await admin
      .from("discovery_ccrs_products")
      .select("license_number,category,product_type,name,brand,description,unit_weight_grams")
      .eq("dataset_id", datasetId)
      .order("id", { ascending: true })
      .range(from, Math.min(from + PAGE, MAX_PRODUCT_ROWS) - 1);
    if (error) {
      warnings.push(`Reading discovery products failed: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as DiscoveryProductRow[]));
    if (data.length < PAGE) break;
  }
  if (rows.length >= MAX_PRODUCT_ROWS) {
    warnings.push(
      `Dataset has more than ${MAX_PRODUCT_ROWS.toLocaleString()} product rows; only the first ${MAX_PRODUCT_ROWS.toLocaleString()} were processed this run. Re-run to continue (inserts are idempotent).`,
    );
  }
  return rows;
}

/** normalized license → vendor id, from the full vendors directory (paged). */
async function loadVendorLicenseMap(warnings: string[]): Promise<Map<string, string>> {
  const admin = createSupabaseAdminClient();
  const map = new Map<string, string>();
  const LIMIT = 5000; // matches listVendors() ceiling
  for (let from = 0; from < LIMIT; from += PAGE) {
    const { data, error } = await admin
      .from("vendors")
      .select("id,license_number")
      .not("license_number", "is", null)
      .order("id", { ascending: true })
      .range(from, Math.min(from + PAGE, LIMIT) - 1);
    if (error) {
      warnings.push(`Reading vendors for license matching failed: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const v of data) {
      const key = normalizeLicense(v.license_number as string);
      if (key && !map.has(key)) map.set(key, v.id as string);
    }
    if (data.length < PAGE) break;
  }
  return map;
}

type ExistingKbBrand = {
  id: string;
  slug: string;
  name: string;
  aliases: string[] | null;
  vendor_id: string | null;
};

async function loadExistingKbBrands(warnings: string[]): Promise<Map<string, ExistingKbBrand>> {
  const admin = createSupabaseAdminClient();
  const map = new Map<string, ExistingKbBrand>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("kb_brands")
      .select("id,slug,name,aliases,vendor_id")
      .order("slug", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      warnings.push(`Reading kb_brands failed: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const b of data as ExistingKbBrand[]) map.set(b.slug, b);
    if (data.length < PAGE) break;
  }
  return map;
}

type ExistingKbProduct = {
  id: string;
  brand_slug: string;
  product_slug: string;
  variant_label: string;
  category: string | null;
  description: string | null;
  vendor_id: string | null;
  kb_brand_id: string | null;
  sources: string[] | null;
};

function productKey(brandSlug: string, productSlug: string, variantLabel: string): string {
  return `${brandSlug}\u0000${productSlug}\u0000${variantLabel}`;
}

async function loadExistingKbProducts(warnings: string[]): Promise<Map<string, ExistingKbProduct>> {
  const admin = createSupabaseAdminClient();
  const map = new Map<string, ExistingKbProduct>();
  for (let from = 0; from < MAX_EXISTING_KB_PRODUCTS; from += PAGE) {
    const { data, error } = await admin
      .from("kb_products")
      .select("id,brand_slug,product_slug,variant_label,category,description,vendor_id,kb_brand_id,sources")
      .order("id", { ascending: true })
      .range(from, Math.min(from + PAGE, MAX_EXISTING_KB_PRODUCTS) - 1);
    if (error) {
      warnings.push(`Reading kb_products failed: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    for (const p of data as ExistingKbProduct[]) {
      map.set(productKey(p.brand_slug, p.product_slug, p.variant_label), p);
    }
    if (data.length < PAGE) break;
  }
  if (map.size >= MAX_EXISTING_KB_PRODUCTS) {
    warnings.push(
      `kb_products exceeds ${MAX_EXISTING_KB_PRODUCTS.toLocaleString()} rows; gap-fill matching was truncated (inserts remain safe via ON CONFLICT DO NOTHING).`,
    );
  }
  return map;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Enrich the KB from one ready CCRS dataset. Returns a full report; never
 * throws for data-shaped problems (they land in `warnings`). Only throws when
 * Supabase itself is unusable mid-flight (callers wrap in try/catch anyway).
 */
export async function enrichKbFromCcrsDataset(
  datasetId: string,
  actorId: string | null,
  opts: { dryRun?: boolean } = {},
): Promise<EnrichResult> {
  const dryRun = opts.dryRun === true;
  const result: EnrichResult = {
    ok: false,
    dryRun,
    brandsInserted: 0,
    brandsEnriched: 0,
    productsInserted: 0,
    productsEnriched: 0,
    skipped: 0,
    warnings: [],
  };
  if (!isSupabaseServiceConfigured) {
    result.warnings.push("Supabase is not configured.");
    return result;
  }
  const admin = createSupabaseAdminClient();

  // --- Dataset (for the provenance label) ------------------------------------
  const { data: dataset, error: dsErr } = await admin
    .from("discovery_datasets")
    .select("id,label,status")
    .eq("id", datasetId)
    .maybeSingle();
  if (dsErr || !dataset) {
    result.warnings.push("Dataset not found.");
    return result;
  }
  const sourceTag = `ccrs:${datasetId}`;
  const sourceLabel = `CCRS dataset: ${(dataset.label as string) || datasetId}`;

  // --- Schema capability probes (defensive; never guess) ---------------------
  const kbProductsReady = await tableUsable("kb_products");
  if (!kbProductsReady) {
    result.warnings.push("kb_products is not available (apply migration 0071). Nothing was written.");
    return result;
  }
  // kb_brands drafts REQUIRE the 0082 lifecycle columns. Without status there
  // is no drafts-only gate, so we refuse to write brands rather than bypass it.
  const kbBrandsDraftReady = await tableUsable("kb_brands", "status");
  if (!kbBrandsDraftReady) {
    result.warnings.push(
      "kb_brands has no status/provenance columns yet (apply migration 0082). Brand drafts were skipped; product drafts still ran.",
    );
  }

  // --- Load inputs -------------------------------------------------------------
  const [discRows, licenseMap, banned] = await Promise.all([
    loadDiscoveryProducts(datasetId, result.warnings),
    loadVendorLicenseMap(result.warnings),
    loadBannedPhrases(),
  ]);
  if (discRows.length === 0) {
    result.warnings.push("Dataset has no product rows — upload the CCRS Product file to enrich the KB.");
    result.ok = true;
    return result;
  }

  // ==========================================================================
  // PHASE 1 — BRANDS
  // ==========================================================================
  // Aggregate: brand → { rawName, licenses tally } so a brand's vendor link is
  // the MOST FREQUENT license among its rows that matches a real vendor.
  type BrandAgg = { rawName: string; licenseTally: Map<string, number> };
  const brandAgg = new Map<string, BrandAgg>();
  for (const row of discRows) {
    const raw = (row.brand ?? "").trim();
    if (!raw) continue;
    const slug = slugifyDashed(raw);
    if (!slug) continue;
    let agg = brandAgg.get(slug);
    if (!agg) {
      agg = { rawName: raw, licenseTally: new Map() };
      brandAgg.set(slug, agg);
    }
    const lic = normalizeLicense(row.license_number);
    if (lic) agg.licenseTally.set(lic, (agg.licenseTally.get(lic) ?? 0) + 1);
  }

  /** Most frequent license for a brand that maps to a vendor, or null. */
  const brandVendorId = (agg: BrandAgg): string | null => {
    let best: string | null = null;
    let bestCount = 0;
    for (const [lic, count] of agg.licenseTally) {
      const vid = licenseMap.get(lic);
      if (vid && count > bestCount) {
        best = vid;
        bestCount = count;
      }
    }
    return best;
  };

  const existingBrands = await loadExistingKbBrands(result.warnings);

  if (kbBrandsDraftReady) {
    // Inserts — new slugs only, drafts, ON CONFLICT DO NOTHING.
    const brandInserts: Record<string, unknown>[] = [];
    for (const [slug, agg] of brandAgg) {
      if (existingBrands.has(slug)) continue;
      const vendorId = brandVendorId(agg);
      brandInserts.push({
        slug,
        name: agg.rawName,
        aliases: [],
        vendor_id: vendorId,
        source: sourceTag,
        confidence: vendorId ? 0.9 : 0.6,
        sources: [sourceLabel],
        status: "draft", // DRAFTS-ONLY — human publishes in the review inbox
        active: false,
        created_by: actorId,
        updated_by: actorId,
      });
    }
    if (!dryRun) {
      for (let i = 0; i < brandInserts.length; i += INSERT_CHUNK) {
        const chunk = brandInserts.slice(i, i + INSERT_CHUNK);
        const { data, error } = await admin
          .from("kb_brands")
          .upsert(chunk, { onConflict: "slug", ignoreDuplicates: true })
          .select("id");
        if (error) {
          result.warnings.push(`Inserting brand drafts failed: ${error.message}`);
          break;
        }
        result.brandsInserted += data?.length ?? 0;
      }
    } else {
      result.brandsInserted = brandInserts.length;
    }

    // Gap-fill existing brands — vendor_id when null; alias union when the CCRS
    // raw name differs from the curated name. NEVER touches curated values.
    let updates = 0;
    for (const [slug, agg] of brandAgg) {
      const existing = existingBrands.get(slug);
      if (!existing) continue;
      if (updates >= MAX_GAPFILL_UPDATES) {
        result.warnings.push(`Brand gap-fill capped at ${MAX_GAPFILL_UPDATES} updates this run; re-run to continue.`);
        break;
      }
      const patch: Record<string, unknown> = {};
      const vendorId = brandVendorId(agg);
      if (!existing.vendor_id && vendorId) patch.vendor_id = vendorId;
      const nameDiffers =
        agg.rawName.trim().toLowerCase() !== (existing.name ?? "").trim().toLowerCase();
      if (nameDiffers) {
        const merged = unionNotes(existing.aliases, [agg.rawName]);
        if (merged.length !== (existing.aliases ?? []).length) patch.aliases = merged;
      }
      if (Object.keys(patch).length === 0) continue;
      patch.updated_by = actorId;
      updates += 1;
      if (!dryRun) {
        const { error } = await admin.from("kb_brands").update(patch).eq("id", existing.id);
        if (error) {
          result.warnings.push(`Gap-filling brand '${slug}' failed: ${error.message}`);
          continue;
        }
      }
      result.brandsEnriched += 1;
    }
  }

  // Refresh slug → id map so product rows can link kb_brand_id (post-insert).
  const brandIdBySlug = new Map<string, string>();
  if (!dryRun || existingBrands.size > 0) {
    const refreshed = dryRun ? existingBrands : await loadExistingKbBrands(result.warnings);
    for (const [slug, b] of refreshed) brandIdBySlug.set(slug, b.id);
  }

  // ==========================================================================
  // PHASE 2 — PRODUCTS
  // ==========================================================================
  const existingProducts = await loadExistingKbProducts(result.warnings);

  // Dedupe within the dataset by natural identity; first occurrence wins.
  type Staged = {
    row: Record<string, unknown>;
    key: string;
  };
  const staged = new Map<string, Staged>();
  let strippedDescriptions = 0;

  for (const row of discRows) {
    const name = (row.name ?? "").trim();
    if (!name) {
      result.skipped += 1;
      continue;
    }
    const brandRaw = (row.brand ?? "").trim();
    const brandSlug = brandRaw ? slugifyDashed(brandRaw) || "unknown-brand" : "unknown-brand";
    const productSlug = slugifyDashed(name) || "product";
    const variantLabel = variantFromGrams(row.unit_weight_grams);
    const key = productKey(brandSlug, productSlug, variantLabel);
    if (staged.has(key)) {
      result.skipped += 1; // duplicate identity within the dataset
      continue;
    }

    // Category through the canonical resolver (CCRS InventoryCategory/Type).
    const resolution = resolveWebsiteCategory({
      productName: name,
      inventoryType: row.product_type,
      category: row.category,
    });
    const category = resolution.unmapped ? null : resolution.websiteCategory;

    // Compliance-gate the description; strip when non-compliant, keep facts.
    let description = (row.description ?? "").trim() || null;
    if (description) {
      const check = checkCompliance(description, banned);
      if (!check.ok) {
        description = null;
        strippedDescriptions += 1;
      }
    }

    const lic = normalizeLicense(row.license_number);
    const vendorId = lic ? licenseMap.get(lic) ?? null : null;

    staged.set(key, {
      key,
      row: {
        brand_slug: brandSlug,
        product_slug: productSlug,
        variant_label: variantLabel,
        display_name: variantLabel ? `${name} ${variantLabel}` : name,
        category,
        description,
        kb_brand_id: brandIdBySlug.get(brandSlug) ?? null,
        vendor_id: vendorId,
        source: sourceTag,
        confidence: vendorId ? 0.9 : 0.6,
        sources: [sourceLabel],
        status: "draft", // DRAFTS-ONLY — human publishes in the review inbox
        active: false,
        created_by: actorId,
        updated_by: actorId,
      },
    });
  }

  // Split staged rows into inserts (new identity) vs gap-fill updates.
  const inserts: Record<string, unknown>[] = [];
  let updateCount = 0;
  for (const { key, row } of staged.values()) {
    const existing = existingProducts.get(key);
    if (!existing) {
      inserts.push(row);
      continue;
    }
    // Gap-fill ONLY: null → value; sources unioned. Curated values never move.
    const patch: Record<string, unknown> = {};
    if (!existing.category && row.category) patch.category = row.category;
    if (!existing.description && row.description) patch.description = row.description;
    if (!existing.vendor_id && row.vendor_id) patch.vendor_id = row.vendor_id;
    if (!existing.kb_brand_id && row.kb_brand_id) patch.kb_brand_id = row.kb_brand_id;
    const mergedSources = unionNotes(existing.sources, [sourceLabel]);
    if (mergedSources.length !== (existing.sources ?? []).length) patch.sources = mergedSources;
    if (Object.keys(patch).length === 0) {
      result.skipped += 1;
      continue;
    }
    if (updateCount >= MAX_GAPFILL_UPDATES) {
      result.skipped += 1;
      continue;
    }
    patch.updated_by = actorId;
    updateCount += 1;
    if (!dryRun) {
      const { error } = await admin.from("kb_products").update(patch).eq("id", existing.id);
      if (error) {
        result.warnings.push(`Gap-filling product '${key.replaceAll("\u0000", " / ")}' failed: ${error.message}`);
        continue;
      }
    }
    result.productsEnriched += 1;
  }
  if (updateCount >= MAX_GAPFILL_UPDATES) {
    result.warnings.push(`Product gap-fill capped at ${MAX_GAPFILL_UPDATES} updates this run; re-run to continue.`);
  }

  // Chunked, idempotent inserts — ON CONFLICT DO NOTHING can never clobber.
  if (!dryRun) {
    for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
      const chunk = inserts.slice(i, i + INSERT_CHUNK);
      const { data, error } = await admin
        .from("kb_products")
        .upsert(chunk, { onConflict: "brand_slug,product_slug,variant_label", ignoreDuplicates: true })
        .select("id");
      if (error) {
        result.warnings.push(`Inserting product drafts failed: ${error.message}`);
        break;
      }
      result.productsInserted += data?.length ?? 0;
    }
  } else {
    result.productsInserted = inserts.length;
  }

  if (strippedDescriptions > 0) {
    result.warnings.push(
      `${strippedDescriptions} product description(s) failed the compliance check and were stripped (structured facts still landed).`,
    );
  }
  // Honest, verified limitation — kb_products has no potency columns (0071).
  result.warnings.push(
    "Lab potency (THC/CBD) was NOT attached: kb_products has no potency columns (verified against migration 0071). Tracked as a roadmap follow-up — potency stays available in discovery_ccrs_lab / benchmarks.",
  );

  result.ok = true;
  return result;
}
