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
import { chunkedIn } from "@/lib/supabase/chunked-in";
import type { KbProductMatch } from "@/lib/ai/kb/intake";
import {
  collectLookupKeys,
  indexEnrichments,
  indexKbProducts,
  indexStrains,
  type EnrichmentRow,
  type KnowledgeIndexes,
  type KnowledgeQuery,
  type StrainRow,
} from "@/lib/ai/kb/product-knowledge-batch-core";

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

/** Rungs 1 & 2 — every `kb_products` row whose product_slug we care about. */
async function loadKbProducts(
  admin: AdminClient,
  productSlugs: string[],
): Promise<Map<string, KbProductMatch>> {
  if (productSlugs.length === 0) return new Map();
  try {
    const rows = await chunkedIn<string, KbProductMatch>(
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
      { chunkSize: CHUNK_SIZE },
    );
    return indexKbProducts(rows);
  } catch {
    // Table missing / not migrated / read failed → behave like
    // `checkProductKnown()` returning "not-ready": fall through to rung 3.
    return new Map();
  }
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
      { chunkSize: CHUNK_SIZE },
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
      { chunkSize: CHUNK_SIZE },
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

  const { identityParts, posKeys, strainSlugs } = collectLookupKeys(queries);
  const productSlugs = [...new Set(identityParts.map((p) => p.productSlug))];

  const [kbProducts, enrichments, strains] = await Promise.all([
    loadKbProducts(admin, productSlugs),
    loadEnrichments(admin, posKeys),
    loadStrains(admin, strainSlugs),
  ]);

  return { kbProducts, enrichments, strains };
}
