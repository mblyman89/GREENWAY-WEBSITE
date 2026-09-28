/**
 * src/lib/ai/kb/product-knowledge-batch.ts
 *
 * SLICE C (performance) — THE N+1 FIX, IMPURE HALF.
 *
 * WHAT THIS REPLACES
 * ──────────────────
 * `resolveDisplayKnowledgeMap()` used to call `lookupProductKnowledge()` once
 * per product, eight at a time. That helper is a fall-through ladder of up to
 * FOUR separate single-row round trips, so a 4,500-product menu issued up to
 * 18,000 sequential database queries on every single load. At a realistic 8 ms
 * round trip that is ~18 seconds of pure network wait; the Vercel observability
 * panel showed exactly that shape — 0% errors, 0% timeouts, CPU awake and
 * blocked on I/O.
 *
 * This module loads the SAME rows the ladder would have read, but with three
 * batched, chunked, fully-paginated queries instead of 4 x N single-row reads.
 * Round trips drop from ~18,000 to roughly 15-45 depending on menu size.
 *
 * WHY THREE QUERIES AND NOT ONE JOIN
 * ──────────────────────────────────
 * The ladder is a PRECEDENCE, not a join: rung 3 is only consulted when rung 1
 * missed, rung 4 only when rung 3 missed. Expressing that as SQL would bury the
 * precedence in a query plan where it cannot be unit-tested. Instead we load
 * each rung's candidate rows in bulk and let the PURE
 * `resolveKnowledgeFromIndexes()` apply the precedence in memory, where
 * `tests/compliance/menu-knowledge-batch.test.ts` proves it byte-identical to
 * the old path.
 *
 * WHY `kb_products` IS FILTERED BY `product_slug`
 * ───────────────────────────────────────────────
 * The natural key is the triple (brand_slug, product_slug, variant_label) —
 * `uq_kb_products_identity` in migration 0071. PostgREST cannot express an
 * `.in()` over a composite key, so we filter on ONE indexed leg
 * (`idx_kb_products_product`) and re-apply the full triple in memory via
 * `indexKbProducts()`. Only a true 3-part match is ever returned, exactly like
 * the old `.eq().eq().eq()` query.
 *
 * `product_slug` is deliberately chosen over `brand_slug`: the number of
 * distinct product slugs is bounded by the menu size, whereas a brand filter
 * would pull every SKU the brand has ever had — unbounded memory for no gain.
 *
 * DEFENSIVE, LIKE THE CODE IT REPLACES
 * ────────────────────────────────────
 * Each rung is loaded inside its own try/catch. A missing or erroring table
 * yields an EMPTY index for that rung only, so resolution falls through to the
 * next rung exactly as `lookupProductKnowledge()` did when `checkProductKnown()`
 * returned "not-ready" or an inner query threw. This function never throws.
 *
 * READ-ONLY. Never writes. Never invents copy.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { chunkedIn, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import type { KbProductMatch } from "@/lib/ai/kb/intake";
import {
  collectLookupKeys,
  indexBrandNames,
  indexEnrichments,
  indexKbById,
  indexKbProducts,
  indexLots,
  indexStrains,
  lotKbReadPlan,
  type EnrichmentRow,
  type KnowledgeIndexes,
  type KnowledgeQuery,
  type LotKnowledgeRow,
  type StrainRow,
} from "@/lib/ai/kb/product-knowledge-batch-core";
import { isMissingIdentityColumnError } from "@/lib/catalog/identity-columns-core";

/**
 * The exact column list `checkProductKnown()` selects (`intake.ts:77-79`).
 * Kept identical so `KbProductMatch` is fully populated and the two paths
 * cannot diverge on a missing field.
 */
const KB_PRODUCT_COLUMNS =
  "id, brand_slug, product_slug, variant_label, display_name, category, aroma_notes, flavor_notes, terpenes, effects, description, short_description, image_media_ids, primary_media_id, status, active";

/** Columns rung 3 reads (`product-lookup.ts:107`), plus the key we index on. */
const ENRICHMENT_COLUMNS =
  "pos_product_key, display_name, description, short_description, image_media_ids, primary_media_id";

/** Columns rung 4 reads (`product-lookup.ts:138` + the 0071 `effects` column). */
const STRAIN_COLUMNS = "slug, aroma_notes, flavor_notes, terpenes, summary, effects";

/** Columns rung 4 read BEFORE migration 0071 added `effects`. */
const STRAIN_COLUMNS_LEGACY = "slug, aroma_notes, flavor_notes, terpenes, summary";

/**
 * 300 ids per chunk, matching the proven setting in
 * `src/lib/enrichment/image-resolver.ts:185-222`. Comfortably inside the
 * PostgREST URL budget while keeping the chunk count low.
 */
const CHUNK_SIZE = 300;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Rungs 1 & 2 — every `kb_products` row whose product_slug we care about
 * (raw rows, [] on any failure; indexed by loadKbSide).
 */
async function loadKbProductRows(admin: AdminClient, productSlugs: string[]): Promise<KbProductMatch[]> {
  if (productSlugs.length === 0) return [];
  try {
    return await chunkedIn<string, KbProductMatch>(
      productSlugs,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("kb_products")
          .select(KB_PRODUCT_COLUMNS)
          .in("product_slug", chunk)
          // Stable unique ordering — REQUIRED by the chunkedIn contract or
          // pagination is not deterministic (chunked-in.ts:33-34).
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data as unknown as KbProductMatch[] | null) ?? [];
      },
      // SLICE D (performance): disjoint key chunks, folded into a Map by the
      // index* helper, so overlapping them cannot change the result.
      { chunkSize: CHUNK_SIZE, concurrency: MENU_READ_CONCURRENCY },
    );
  } catch {
    // Table missing / not migrated / read failed → behave like
    // `checkProductKnown()` returning "not-ready": fall through to rung 3.
    return [];
  }
}

// ── S24: the lot rungs (read with the identity the writer used) ────────────
//
// The manifest bridge wrote kb_products under the lot's RAW product_name,
// brands.display_name and the "3.5 g" weight label (F-065); S05 stamped the
// row's id on inventory_lots.kb_product_id. The menu card only knows its lot
// keys, so: lots by pos_product_key (0023 inventory_lots_poskey_idx) ->
// then, concurrently, the brands they name, the kb rows they link, and the
// kb rows under their raw-name slugs. Every read is chunked + paged, ordered
// by id, and fails soft to "no lot rungs" - never worse than before S24.

/** inventory_lots columns for the lot rungs (all of LotKnowledgeRow). */
const LOT_COLUMNS =
  "id, pos_product_key, product_name, unit_weight, unit_weight_uom, brand_id, kb_product_id, status, disposition";

/** The same, before 0234 added inventory_lots.kb_product_id. */
const LOT_COLUMNS_PRE_0234 =
  "id, pos_product_key, product_name, unit_weight, unit_weight_uom, brand_id, status, disposition";

type DbError = { code?: string | null; message?: string | null } | null;

async function readLotRows(
  admin: AdminClient,
  lotKeys: string[],
  columns: string,
): Promise<{ rows: LotKnowledgeRow[]; error: DbError }> {
  let firstError: DbError = null;
  const rows = await chunkedIn<string, LotKnowledgeRow>(
    lotKeys,
    async (chunk, from, to) => {
      if (firstError) return [];
      const { data, error } = await admin
        .from("inventory_lots")
        .select(columns)
        .in("pos_product_key", chunk)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        firstError = error;
        return [];
      }
      return (data as unknown as LotKnowledgeRow[] | null) ?? [];
    },
    { chunkSize: CHUNK_SIZE, concurrency: MENU_READ_CONCURRENCY },
  );
  return { rows, error: firstError };
}

/**
 * The card lots. Pre-0234 (kb_product_id absent, 42703/PGRST204 naming it)
 * retries without the column - the lot-identity rung still works. Any other
 * error: no lots (rungs skipped). Exported for the S24 wiring test.
 */
export async function loadLotsForKnowledge(admin: AdminClient, lotKeys: string[]): Promise<LotKnowledgeRow[]> {
  // No keys -> chunkedIn makes zero requests (chunked-in.ts), so no guard.
  try {
    let res = await readLotRows(admin, lotKeys, LOT_COLUMNS);
    if (res.error && isMissingIdentityColumnError("inventory_lots", res.error)) {
      res = await readLotRows(admin, lotKeys, LOT_COLUMNS_PRE_0234);
      res.rows = res.rows.map((r) => ({ ...r, kb_product_id: null }));
    }
    if (res.error) return [];
    return res.rows;
  } catch {
    return [];
  }
}

/** brands.display_name by id - the name the bridge handed the writer. */
async function loadBrandNames(admin: AdminClient, brandIds: string[]): Promise<Map<string, string>> {
  if (brandIds.length === 0) return new Map();
  try {
    const rows = await chunkedIn<string, { id: string; display_name: string | null }>(
      brandIds,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("brands")
          .select("id, display_name")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data as unknown as { id: string; display_name: string | null }[] | null) ?? [];
      },
      { chunkSize: CHUNK_SIZE, concurrency: MENU_READ_CONCURRENCY },
    );
    return indexBrandNames(rows);
  } catch {
    // No names -> lotKbKey skips every branded lot (never guesses unbranded).
    return new Map();
  }
}

/** kb_products by id (the S05 inventory_lots.kb_product_id targets). */
async function loadKbByIdRows(admin: AdminClient, ids: string[]): Promise<KbProductMatch[]> {
  if (ids.length === 0) return [];
  try {
    return await chunkedIn<string, KbProductMatch>(
      ids,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("kb_products")
          .select(KB_PRODUCT_COLUMNS)
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data as unknown as KbProductMatch[] | null) ?? [];
      },
      { chunkSize: CHUNK_SIZE, concurrency: MENU_READ_CONCURRENCY },
    );
  } catch {
    return [];
  }
}

/**
 * The kb_products side of the indexes (rungs 1 & 2, all four S24 candidates).
 * Lots are read concurrently with the display-name slugs; the second wave
 * (brands, linked ids, raw-name slugs) depends on the lots. Never throws.
 */
async function loadKbSide(
  admin: AdminClient,
  productSlugs: string[],
  lotKeys: string[],
): Promise<Pick<KnowledgeIndexes, "kbProducts" | "lotsByKey" | "brandNames" | "kbById">> {
  const [slugRows, lots] = await Promise.all([
    loadKbProductRows(admin, productSlugs),
    loadLotsForKnowledge(admin, lotKeys),
  ]);
  // No lots -> an empty plan, and every second-wave loader below returns
  // before any request on an empty list: exactly the pre-S24 single read.
  const lotsByKey = indexLots(lots);
  const plan = lotKbReadPlan(lotsByKey, new Set(productSlugs));
  const loadedIds = new Set(slugRows.map((r) => r.id));
  const [brandNames, rawSlugRows, linkedRows] = await Promise.all([
    loadBrandNames(admin, plan.brandIds),
    loadKbProductRows(admin, plan.productSlugs),
    loadKbByIdRows(admin, plan.kbIds.filter((id) => !loadedIds.has(id))),
  ]);
  const allRows = [...slugRows, ...rawSlugRows, ...linkedRows];
  return {
    kbProducts: indexKbProducts(allRows),
    lotsByKey,
    brandNames,
    kbById: indexKbById(allRows),
  };
}

/**
 * S24 per-item entry (lookupProductKnowledge): ONLY the kb_products side, so
 * the detail page resolves rungs 1 & 2 exactly as the batched menu does.
 * Returns null when Supabase is unavailable (caller keeps its old path).
 */
export async function loadKbKnowledgeIndexes(query: KnowledgeQuery): Promise<KnowledgeIndexes | null> {
  if (!isSupabaseServiceConfigured) return null;
  let admin: AdminClient;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return null;
  }
  const { identityParts, lotKeys } = collectLookupKeys([query]);
  const productSlugs = [...new Set(identityParts.map((p) => p.productSlug))];
  const kb = await loadKbSide(admin, productSlugs, lotKeys);
  return { ...kb, enrichments: new Map(), strains: new Map() };
}

/** Rung 3 — the live marketing layer, keyed by POS product key. */
async function loadEnrichments(
  admin: AdminClient,
  posKeys: string[],
): Promise<Map<string, EnrichmentRow>> {
  if (posKeys.length === 0) return new Map();
  try {
    const rows = await chunkedIn<string, EnrichmentRow>(
      posKeys,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("product_enrichments")
          .select(ENRICHMENT_COLUMNS)
          .in("pos_product_key", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data as unknown as EnrichmentRow[] | null) ?? [];
      },
      // SLICE D (performance): disjoint key chunks, folded into a Map by the
      // index* helper, so overlapping them cannot change the result.
      { chunkSize: CHUNK_SIZE, concurrency: MENU_READ_CONCURRENCY },
    );
    return indexEnrichments(rows);
  } catch {
    return new Map();
  }
}

/**
 * Rung 4 — strain-level sensory/effects gap-fill.
 *
 * The old code read `effects` in a SECOND query wrapped in its own try/catch
 * because the column is only guaranteed from migration 0071 onward. Selecting
 * it inline removes that extra round trip per item, but to keep the identical
 * resilience we retry once without `effects` if the column is genuinely absent
 * — a strain with no effects list is still better than no strain row at all.
 */
async function loadStrains(admin: AdminClient, slugs: string[]): Promise<Map<string, StrainRow>> {
  if (slugs.length === 0) return new Map();

  const fetchWith = async (columns: string): Promise<StrainRow[]> =>
    chunkedIn<string, StrainRow>(
      slugs,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("kb_strains")
          .select(columns)
          .in("slug", chunk)
          // `.eq("active", true)` — carried over verbatim from
          // `product-lookup.ts:142`. Dropping it would surface retired strains.
          .eq("active", true)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) throw new Error(error.message);
        return (data as unknown as StrainRow[] | null) ?? [];
      },
      // SLICE D (performance): disjoint key chunks, folded into a Map by the
      // index* helper, so overlapping them cannot change the result.
      { chunkSize: CHUNK_SIZE, concurrency: MENU_READ_CONCURRENCY },
    );

  try {
    return indexStrains(await fetchWith(STRAIN_COLUMNS));
  } catch {
    try {
      return indexStrains(await fetchWith(STRAIN_COLUMNS_LEGACY));
    } catch {
      return new Map();
    }
  }
}

/**
 * Load every row the KB-first ladder could need for a batch of products, in
 * three batched queries instead of up to four per product.
 *
 * The three reads are independent, so they run CONCURRENTLY: wall-clock cost is
 * the slowest rung, not the sum. Never throws — a failed rung yields an empty
 * index and resolution falls through, exactly like the per-item path.
 */
export async function loadKnowledgeIndexes(
  queries: readonly KnowledgeQuery[],
): Promise<KnowledgeIndexes> {
  const empty: KnowledgeIndexes = {
    kbProducts: new Map(),
    enrichments: new Map(),
    strains: new Map(),
  };
  // Same first guard as `lookupProductKnowledge()` (product-lookup.ts:93):
  // with no service credentials every product resolves to "none".
  if (!isSupabaseServiceConfigured) return empty;
  if (queries.length === 0) return empty;

  let admin: AdminClient;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return empty;
  }

  const { identityParts, posKeys, strainSlugs, lotKeys } = collectLookupKeys(queries);
  const productSlugs = [...new Set(identityParts.map((p) => p.productSlug))];

  const [kb, enrichments, strains] = await Promise.all([
    // S24: with no lot keys loadKbSide makes exactly the pre-S24 single
    // kb_products read (loadLotsForKnowledge short-circuits on []).
    loadKbSide(admin, productSlugs, lotKeys),
    loadEnrichments(admin, posKeys),
    loadStrains(admin, strainSlugs),
  ]);

  return { ...kb, enrichments, strains };
}
