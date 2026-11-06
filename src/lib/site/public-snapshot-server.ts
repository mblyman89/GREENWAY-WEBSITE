/**
 * public-snapshot-server.ts - DB HEALTH round, slice A (see public-snapshot-core.ts for the
 * measured cause: public page renders re-asking the database the same small questions, thousands
 * of times a minute, until the Micro database stopped answering).
 *
 * SERVER-ONLY. One shared snapshot per small, rarely-changing table that EVERY public render
 * reads, held in the Next.js data cache for PUBLIC_SNAPSHOT_TTL_SECONDS:
 *
 *   content_blocks             -> publicContentSnapshot()     (footer, header, hours, fonts...)
 *   product_enrichments+media  -> enrichmentImageSnapshot()   (product photos, exact + S20 borrow)
 *   product_classification_... -> classificationOverrideSnapshot() (owner's category re-file)
 *   medical_product_registry   -> medicalRegistrySnapshot()   (DOH pill)
 *
 * FRESHNESS
 *   - Content: editors' saves call revalidatePath("/(site)", "layout"). A render under that layout
 *     carries the layout's implicit cache tag, and unstable_cache treats an entry older than that
 *     revalidation as stale, so a published edit shows on the next visit (as before). The
 *     PUBLIC_CONTENT_TAG is also attached for any caller that wants to clear it by name.
 *   - Photos, overrides, DOH: tagged MENU_CACHE_TAG, cleared by revalidatePublicMenuSurfaces()
 *     (enrichment publish, intake, inventory edits) and otherwise within one minute.
 *   - Draft Mode (staff preview) never reads a snapshot: callers keep their original live read,
 *     and unstable_cache itself bypasses the cache in Draft Mode.
 *
 * FAILURE: a failed read THROWS inside the cached function, so a failure is never stored. The
 * wrappers here return null on any failure or when a table is over its cap; every caller then
 * falls back to its ORIGINAL keyed read. Slower, never wrong.
 *
 * NEVER MONEY: display data only. Nothing here feeds a price, a cart, stock, a sale or CCRS.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAll, chunkedIn, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { publicUrlForKey } from "@/lib/media/store";
import { MENU_CACHE_TAG } from "@/lib/menu/menu-cache-policy-core";
import {
  PUBLIC_CONTENT_TAG,
  PUBLIC_SNAPSHOT_TTL_SECONDS,
  SNAPSHOT_CAPS,
  indexContentBlocks,
  neededMediaIds,
  withinCap,
  type ContentBlockRow,
  type EnrichmentImageRow,
  type EnrichmentImageSnapshot,
} from "./public-snapshot-core";

/** Next.js refuses unstable_cache outside a request/build (e.g. plain unit tests): say so. */
function snapshotsAvailable(): boolean {
  return isSupabaseServiceConfigured;
}

async function exactCount(table: string, filter?: { col: string; val: string }): Promise<number> {
  const admin = createSupabaseAdminClient();
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (filter) q = q.eq(filter.col, filter.val);
  const { count, error } = await q;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// content_blocks
// ---------------------------------------------------------------------------

const contentSnapshotCached = unstable_cache(
  async (): Promise<ContentBlockRow[] | null> => {
    const n = await exactCount("content_blocks");
    if (!withinCap(n, SNAPSHOT_CAPS.contentBlocks)) return null;
    const admin = createSupabaseAdminClient();
    return pagedAll<ContentBlockRow>(async (from, to) => {
      const { data, error } = await admin
        .from("content_blocks")
        .select("block_key, published_value, draft_value, status")
        .order("block_key", { ascending: true })
        .range(from, to);
      if (error) throw new Error(`content_blocks read failed: ${error.message}`);
      return (data as ContentBlockRow[] | null) ?? [];
    });
  },
  ["public-snapshot", "content-blocks", "v1"],
  { revalidate: PUBLIC_SNAPSHOT_TTL_SECONDS, tags: [PUBLIC_CONTENT_TAG] },
);

/** The content-block index for PUBLIC renders, or null (caller uses its keyed read). */
export async function publicContentSnapshot(): Promise<Map<string, ContentBlockRow> | null> {
  if (!snapshotsAvailable()) return null;
  try {
    const rows = await contentSnapshotCached();
    return rows ? indexContentBlocks(rows) : null;
  } catch (err) {
    console.error("[public-snapshot] content snapshot unavailable; using the keyed read:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// product_enrichments (published) + their media URLs
// ---------------------------------------------------------------------------

const enrichmentImageSnapshotCached = unstable_cache(
  async (): Promise<EnrichmentImageSnapshot | null> => {
    const n = await exactCount("product_enrichments", { col: "status", val: "published" });
    if (!withinCap(n, SNAPSHOT_CAPS.enrichments)) return null;
    const admin = createSupabaseAdminClient();
    const rows = await pagedAll<EnrichmentImageRow>(async (from, to) => {
      const { data, error } = await admin
        .from("product_enrichments")
        .select("id, pos_product_key, status, updated_at, identity_key, primary_media_id, image_media_ids")
        .eq("status", "published")
        .order("id", { ascending: true })
        .range(from, to);
      if (error) throw new Error(`product_enrichments read failed: ${error.message}`);
      return (data as EnrichmentImageRow[] | null) ?? [];
    });
    type MediaRow = { id: string; storage_key: string; public_url: string | null };
    const ids = neededMediaIds(rows);
    let failed: string | null = null;
    const media = await chunkedIn<string, MediaRow>(
      ids,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("media_assets")
          .select("id, storage_key, public_url")
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          failed = error.message;
          return [];
        }
        return (data as MediaRow[] | null) ?? [];
      },
      { chunkSize: 300, concurrency: MENU_READ_CONCURRENCY },
    );
    if (failed) throw new Error(`media_assets read failed: ${failed}`);
    const mediaUrls: Array<[string, string]> = [];
    for (const m of media) {
      const url = publicUrlForKey(m.storage_key) ?? m.public_url ?? null;
      if (url) mediaUrls.push([m.id, url]);
    }
    return { rows, mediaUrls };
  },
  ["public-snapshot", "enrichment-images", "v1"],
  { revalidate: PUBLIC_SNAPSHOT_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

/** Every published enrichment image, or null (caller uses its keyed read). */
export async function enrichmentImageSnapshot(): Promise<EnrichmentImageSnapshot | null> {
  if (!snapshotsAvailable()) return null;
  try {
    return await enrichmentImageSnapshotCached();
  } catch (err) {
    console.error("[public-snapshot] enrichment image snapshot unavailable; using the keyed read:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// product_classification_overrides
// ---------------------------------------------------------------------------

export type OverrideSnapshotRow = {
  pos_product_key: string;
  website_category: string | null;
  house_type: string | null;
  note: string | null;
};

const overrideSnapshotCached = unstable_cache(
  async (): Promise<Array<[string, OverrideSnapshotRow]> | null> => {
    const n = await exactCount("product_classification_overrides");
    if (!withinCap(n, SNAPSHOT_CAPS.overrides)) return null;
    const admin = createSupabaseAdminClient();
    const rows = await pagedAll<OverrideSnapshotRow>(async (from, to) => {
      const { data, error } = await admin
        .from("product_classification_overrides")
        .select("pos_product_key, website_category, house_type, note")
        .order("pos_product_key", { ascending: true })
        .range(from, to);
      if (error) throw new Error(`product_classification_overrides read failed: ${error.message}`);
      return (data as OverrideSnapshotRow[] | null) ?? [];
    });
    return rows.map((r) => [r.pos_product_key, r]);
  },
  ["public-snapshot", "classification-overrides", "v1"],
  { revalidate: PUBLIC_SNAPSHOT_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

/** Every classification override as [key, row] pairs, or null (caller uses its keyed read). */
export async function classificationOverrideSnapshot(): Promise<Array<[string, OverrideSnapshotRow]> | null> {
  if (!snapshotsAvailable()) return null;
  try {
    return await overrideSnapshotCached();
  } catch (err) {
    console.error("[public-snapshot] override snapshot unavailable; using the keyed read:", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// medical_product_registry
// ---------------------------------------------------------------------------

const medicalSnapshotCached = unstable_cache(
  async (): Promise<Array<[string, string]> | null> => {
    const n = await exactCount("medical_product_registry");
    if (!withinCap(n, SNAPSHOT_CAPS.medicalRegistry)) return null;
    const admin = createSupabaseAdminClient();
    const rows = await pagedAll<{ pos_product_key: string; doh_category: string }>(async (from, to) => {
      const { data, error } = await admin
        .from("medical_product_registry")
        .select("pos_product_key, doh_category")
        .order("pos_product_key", { ascending: true })
        .range(from, to);
      if (error) throw new Error(`medical_product_registry read failed: ${error.message}`);
      return (data as { pos_product_key: string; doh_category: string }[] | null) ?? [];
    });
    return rows.map((r) => [r.pos_product_key, r.doh_category]);
  },
  ["public-snapshot", "medical-registry", "v1"],
  { revalidate: PUBLIC_SNAPSHOT_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

/** Every DOH registry entry as [key, category] pairs, or null (caller uses its keyed read). */
export async function medicalRegistrySnapshot(): Promise<Array<[string, string]> | null> {
  if (!snapshotsAvailable()) return null;
  try {
    return await medicalSnapshotCached();
  } catch (err) {
    console.error("[public-snapshot] DOH registry snapshot unavailable; using the keyed read:", err instanceof Error ? err.message : err);
    return null;
  }
}
