/**
 * src/lib/enrichment/image-resolver.ts  (DF-3)
 *
 * The product image resolver: guarantees a product card is never blank by
 * walking an honest fallback ladder and reporting WHERE the image came from
 * (provenance) so the UI can show a "representative image" cue when it's a
 * substitute rather than the actual product.
 *
 * Ladder (first hit wins):
 *   1. exact        — the product's own PUBLISHED enrichment image
 *                     (primary_media_id / image_media_ids[0]).
 *   2. brand/vendor — an approved branded-but-untitled shot for the product's
 *                     brand or vendor (kb_image_substitutes scope brand|vendor).
 *   3. category     — an approved fallback for the product's category.
 *   4. inventory    — an approved fallback for the product's inventory type.
 *   5. global       — the last-resort house fallback ('*').
 *   6. none         — nothing configured → caller renders the stylized mockup.
 *
 * Everything resolves to a public media URL. Reads degrade gracefully (return
 * `none`) pre-migration or when Supabase isn't configured.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { publicUrlForKey } from "@/lib/media/store";
import {
  resolveSubstituteFor,
  resolveBrandVendorSubstitute,
  normalizeKey,
} from "@/lib/ai/kb/image-substitutes";

export type ImageSource = "exact" | "brand" | "vendor" | "category" | "inventory_type" | "global";

export type ResolvedImage = {
  url: string;
  /** Where the image came from in the ladder. */
  source: ImageSource;
  /** True for anything that isn't the product's own exact photo. */
  isFallback: boolean;
};

export type ProductImageQuery = {
  /** Stable POS product key (matches product_enrichments.pos_product_key). */
  posKey: string;
  brandSlug?: string | null;
  vendorSlug?: string | null;
  category?: string | null;
  inventoryType?: string | null;
};

// ---------------------------------------------------------------------------
// Single-product resolve (used by the PDP and one-off lookups).
// ---------------------------------------------------------------------------

/**
 * Resolve the best image for one product. `exactUrl`, when provided by the
 * caller (already-resolved published enrichment image), short-circuits the
 * ladder at step 1 and avoids an extra query.
 */
export async function resolveProductImage(
  q: ProductImageQuery,
  exactUrl?: string | null,
): Promise<ResolvedImage | null> {
  if (exactUrl) return { url: exactUrl, source: "exact", isFallback: false };

  // Step 1: the product's own published enrichment image.
  const own = await resolveExactEnrichmentImage(q.posKey);
  if (own) return { url: own, source: "exact", isFallback: false };

  // Steps 2: brand/vendor approved generic shot.
  const bv = await resolveBrandVendorSubstitute(q.brandSlug, q.vendorSlug);
  if (bv) {
    return { url: bv.url, source: bv.scope === "brand" ? "brand" : "vendor", isFallback: true };
  }

  // Steps 3–5: category → inventory_type → global.
  const sub = await resolveSubstituteFor(q.category, q.inventoryType);
  if (sub) {
    const source: ImageSource =
      sub.scope === "category"
        ? "category"
        : sub.scope === "inventory_type"
          ? "inventory_type"
          : "global";
    return { url: sub.url, source, isFallback: true };
  }

  return null;
}

/** Resolve a product's own PUBLISHED enrichment image to a public URL, or null. */
async function resolveExactEnrichmentImage(posKey: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured || !posKey) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("product_enrichments")
      .select("primary_media_id, image_media_ids, status")
      .eq("pos_product_key", posKey)
      .maybeSingle();
    const row = data as
      | { primary_media_id: string | null; image_media_ids: string[] | null; status: string }
      | null;
    if (!row || row.status !== "published") return null;
    const mediaId = row.primary_media_id || (row.image_media_ids ?? [])[0] || null;
    if (!mediaId) return null;
    return await mediaUrl(mediaId);
  } catch {
    return null;
  }
}

async function mediaUrl(mediaId: string): Promise<string | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("media_assets")
    .select("storage_key, public_url")
    .eq("id", mediaId)
    .maybeSingle();
  const row = data as { storage_key: string; public_url: string | null } | null;
  if (!row) return null;
  return publicUrlForKey(row.storage_key) ?? row.public_url ?? null;
}

// ---------------------------------------------------------------------------
// Batch resolve (used by the menu grid to avoid N+1 queries).
// ---------------------------------------------------------------------------

/**
 * Resolve images for many products at once. Strategy:
 *   • one query for all published enrichment images (exact),
 *   • then, for the remainder, batch-resolve substitutes grouped by
 *     brand/vendor and category/inventory_type so we do O(distinct-keys)
 *     queries instead of O(products).
 * Returns a Map keyed by posKey → ResolvedImage (absent = render mockup).
 */
export async function resolveProductImagesBatch(
  items: ProductImageQuery[],
): Promise<Map<string, ResolvedImage>> {
  const out = new Map<string, ResolvedImage>();
  if (!isSupabaseServiceConfigured || items.length === 0) return out;

  // 1) Batch exact enrichment images.
  const exactByKey = await batchExactImages(items.map((i) => i.posKey));
  const remaining: ProductImageQuery[] = [];
  for (const it of items) {
    const url = exactByKey.get(it.posKey);
    if (url) out.set(it.posKey, { url, source: "exact", isFallback: false });
    else remaining.push(it);
  }
  if (remaining.length === 0) return out;

  // 2) Build the active-substitute index once, then resolve each remaining
  //    product against it in memory (no per-product query).
  const index = await loadSubstituteIndex();
  if (!index) return out; // table missing → leave remainder for the mockup

  for (const it of remaining) {
    const resolved = resolveFromIndex(index, it);
    if (resolved) out.set(it.posKey, resolved);
  }
  return out;
}

async function batchExactImages(posKeys: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const keys = Array.from(new Set(posKeys.filter(Boolean)));
  if (keys.length === 0 || !isSupabaseServiceConfigured) return map;
  const admin = createSupabaseAdminClient();

  // Pull published enrichment rows that actually have an image.
  const rowsByKey = new Map<string, string>(); // posKey -> mediaId
  const CHUNK = 300;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const { data } = await admin
      .from("product_enrichments")
      .select("pos_product_key, primary_media_id, image_media_ids, status")
      .in("pos_product_key", slice)
      .eq("status", "published");
    for (const r of (data as
      | { pos_product_key: string; primary_media_id: string | null; image_media_ids: string[] | null }[]
      | null) ?? []) {
      const mediaId = r.primary_media_id || (r.image_media_ids ?? [])[0] || null;
      if (mediaId) rowsByKey.set(r.pos_product_key, mediaId);
    }
  }
  if (rowsByKey.size === 0) return map;

  // Batch-resolve those media ids to URLs.
  const mediaIds = Array.from(new Set(rowsByKey.values()));
  const urlById = new Map<string, string>();
  for (let i = 0; i < mediaIds.length; i += CHUNK) {
    const slice = mediaIds.slice(i, i + CHUNK);
    const { data } = await admin.from("media_assets").select("id, storage_key, public_url").in("id", slice);
    for (const m of (data as { id: string; storage_key: string; public_url: string | null }[] | null) ?? []) {
      const url = publicUrlForKey(m.storage_key) ?? m.public_url ?? null;
      if (url) urlById.set(m.id, url);
    }
  }
  for (const [posKey, mediaId] of rowsByKey) {
    const url = urlById.get(mediaId);
    if (url) map.set(posKey, url);
  }
  return map;
}

type SubstituteIndex = {
  // scope -> key -> best (lowest-priority) media URL
  byScopeKey: Map<string, string>;
};

/** Load all active substitutes + their URLs into an in-memory index. */
async function loadSubstituteIndex(): Promise<SubstituteIndex | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("kb_image_substitutes")
      .select("scope, key, media_id, priority")
      .eq("active", true)
      .order("priority", { ascending: true });
    if (error || !data) return null;
    const rows = data as { scope: string; key: string; media_id: string; priority: number }[];
    if (rows.length === 0) return { byScopeKey: new Map() };

    // Keep the lowest-priority media per scope+key (rows already sorted asc).
    const bestMediaByScopeKey = new Map<string, string>();
    const neededMedia = new Set<string>();
    for (const r of rows) {
      const sk = `${r.scope}::${r.key}`;
      if (!bestMediaByScopeKey.has(sk)) {
        bestMediaByScopeKey.set(sk, r.media_id);
        neededMedia.add(r.media_id);
      }
    }
    // Resolve those media ids to URLs.
    const urlById = new Map<string, string>();
    const ids = Array.from(neededMedia);
    const { data: media } = await admin
      .from("media_assets")
      .select("id, storage_key, public_url")
      .in("id", ids);
    for (const m of (media as { id: string; storage_key: string; public_url: string | null }[] | null) ?? []) {
      const url = publicUrlForKey(m.storage_key) ?? m.public_url ?? null;
      if (url) urlById.set(m.id, url);
    }
    const byScopeKey = new Map<string, string>();
    for (const [sk, mediaId] of bestMediaByScopeKey) {
      const url = urlById.get(mediaId);
      if (url) byScopeKey.set(sk, url);
    }
    return { byScopeKey };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Convenience: attach resolved images to a list of GreenwayMenuItem.
// ---------------------------------------------------------------------------

/** Minimal shape the resolver needs from a menu item (kept loose to avoid a
 *  hard import cycle with the leafly types). */
type ImageableItem = {
  id: string;
  brand?: string | null;
  vendor?: string | null;
  category?: string | null;
  posInventoryCategory?: string | null;
  posInventoryType?: string | null;
  imageUrl?: string;
  imageIsFallback?: boolean;
};

/**
 * Return a copy of `items` with `imageUrl` / `imageIsFallback` populated from
 * the resolver. Safe + non-throwing: on any failure it returns the items
 * unchanged so the page always renders (the card falls back to the mockup).
 *
 * Uses the POS inventory category when present (closer to the kb_image_substitutes
 * `category` keys), otherwise the display category.
 */
export async function withResolvedImages<T extends ImageableItem>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  try {
    const queries: ProductImageQuery[] = items.map((it) => ({
      posKey: it.id,
      brandSlug: it.brand ?? null,
      vendorSlug: it.vendor ?? null,
      category: it.posInventoryCategory ?? it.category ?? null,
      inventoryType: it.posInventoryType ?? null,
    }));
    const resolved = await resolveProductImagesBatch(queries);
    if (resolved.size === 0) return items;
    return items.map((it) => {
      const r = resolved.get(it.id);
      if (!r) return it;
      return { ...it, imageUrl: r.url, imageIsFallback: r.isFallback };
    });
  } catch {
    return items;
  }
}

function resolveFromIndex(index: SubstituteIndex, q: ProductImageQuery): ResolvedImage | null {
  const tries: { scope: string; key: string; source: ImageSource }[] = [];
  if (q.brandSlug) tries.push({ scope: "brand", key: normalizeKey(q.brandSlug), source: "brand" });
  if (q.vendorSlug) tries.push({ scope: "vendor", key: normalizeKey(q.vendorSlug), source: "vendor" });
  if (q.category) tries.push({ scope: "category", key: normalizeKey(q.category), source: "category" });
  if (q.inventoryType)
    tries.push({ scope: "inventory_type", key: normalizeKey(q.inventoryType), source: "inventory_type" });
  tries.push({ scope: "global", key: "*", source: "global" });

  for (const t of tries) {
    const url = index.byScopeKey.get(`${t.scope}::${t.key}`);
    if (url) return { url, source: t.source, isFallback: t.source !== "exact" };
  }
  return null;
}
