/**
 * src/lib/menu/menu-card-fallback-server.ts  (D224)
 *
 * SERVER-ONLY. Reads and writes public.menu_card_fallback_images (0355): one
 * owner-chosen picture per website category, shown on every card in that
 * category that has no photo of its own. Decisions live in
 * menu-card-fallback-core.ts; this file only does I/O.
 *
 * READS (public pages)
 *   One small snapshot (at most 21 x 12 rows + their media URLs) held in the
 *   Next.js data cache for PUBLIC_SNAPSHOT_TTL_SECONDS, tagged MENU_CACHE_TAG,
 *   so every render answers from memory and a save (which calls
 *   revalidatePublicMenuSurfaces) shows on the next visit. A failed read
 *   THROWS inside the cached function so a failure is never stored; the
 *   wrapper then returns an empty map and the cards render exactly as before.
 *   Before 0355 is applied (42P01 / PGRST205) the map is empty: identity.
 *
 * WRITES (the admin page only, via its server actions)
 *   addMenuCardFallbacks / removeMenuCardFallback / reorderMenuCardFallbacks /
 *   clearMenuCardFallback (D225). Every {error} is read and
 *   classified (missing table vs permission vs other) so the page can say
 *   which one happened.
 *
 * D225 (0356): a category holds a LIST of pictures (sort_order). The snapshot
 * is now category -> URLs in owner order (cache key v2). Before 0356 is
 * applied the reads fall back to the 0355 columns (42703 = no such column)
 * and the page keeps working one picture per category.
 *
 * NEVER MONEY: display data only. Nothing here feeds a price, a cart, stock,
 * a sale or CCRS.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { publicUrlForKey } from "@/lib/media/store";
import { MENU_CACHE_TAG } from "@/lib/menu/menu-cache-policy-core";
import { PUBLIC_SNAPSHOT_TTL_SECONDS } from "@/lib/site/public-snapshot-core";
import { getOverridesForKeys } from "@/lib/pos/product-classification-overrides";
import {
  applyMenuCardFallbacks,
  fallbackUrlForKey,
  groupFallbackRows,
  parseFallbackCategory,
  roomFor,
  type FallbackableItem,
  type FallbackMedia,
  type FallbackRow,
} from "@/lib/menu/menu-card-fallback-core";

const TABLE = "menu_card_fallback_images";

type PgError = { code?: string | null; message?: string | null } | null | undefined;

/** 0355 not applied yet. */
export function isMissingFallbackTable(err: PgError): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .* does not exist|could not find the table|schema cache/i.test(err.message ?? "")
  );
}

/** 0356 not applied yet: the id / sort_order columns are missing. */
export function isMissingListColumns(err: PgError): boolean {
  if (!err) return false;
  return err.code === "42703" || /column .*(sort_order|\bid\b).* does not exist|could not find the .*column/i.test(err.message ?? "");
}

/** The service role lost its grant (should never happen after 0355). */
export function isFallbackPermissionError(err: PgError): boolean {
  return Boolean(err && (err.code === "42501" || /permission denied/i.test(err.message ?? "")));
}

export type FallbackWriteResult =
  | { ok: true; added?: number; skipped?: number }
  | { ok: false; reason: "missing_table" | "missing_0356" | "permission" | "full" | "error"; message: string };

function classify(err: NonNullable<PgError>): FallbackWriteResult {
  if (isMissingFallbackTable(err)) {
    return { ok: false, reason: "missing_table", message: "Migration 0355 (menu_card_fallback_images) is not applied yet." };
  }
  if (isFallbackPermissionError(err)) {
    return { ok: false, reason: "permission", message: "The server is not allowed to write menu_card_fallback_images (42501). Re-run migration 0355." };
  }
  return { ok: false, reason: "error", message: err.message || "The database refused the change." };
}

type MediaRow = { id: string; storage_key: string; public_url: string | null; title: string | null; filename: string | null; status: string | null };

async function readMedia(ids: readonly string[]): Promise<MediaRow[]> {
  if (ids.length === 0) return [];
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_assets")
    .select("id, storage_key, public_url, title, filename, status")
    .in("id", Array.from(new Set(ids)));
  if (error) throw new Error(`media_assets read failed: ${error.message}`);
  return (data as MediaRow[] | null) ?? [];
}

function urlOf(m: MediaRow): string | null {
  return publicUrlForKey(m.storage_key) ?? m.public_url ?? null;
}

/** none = before 0355, single = 0355 only (one per category), multi = 0356. */
export type FallbackSchema = "none" | "single" | "multi";
type RowsRead = { schema: FallbackSchema; rows: FallbackRow[] };

async function readRows(category?: string): Promise<RowsRead> {
  const admin = createSupabaseAdminClient();
  let q = admin.from(TABLE).select("id, website_category, media_id, sort_order, updated_at");
  if (category) q = q.eq("website_category", category);
  const { data, error } = await q.order("website_category", { ascending: true }).order("sort_order", { ascending: true });
  if (!error) return { schema: "multi", rows: (data as FallbackRow[] | null) ?? [] };
  if (isMissingFallbackTable(error)) return { schema: "none", rows: [] };
  if (!isMissingListColumns(error)) throw new Error(`${TABLE} read failed (${error.code ?? "?"}): ${error.message}`);
  // 0355 only: one row per category, no id / sort_order yet.
  let q1 = admin.from(TABLE).select("website_category, media_id, updated_at");
  if (category) q1 = q1.eq("website_category", category);
  const old = await q1.order("website_category", { ascending: true });
  if (old.error) {
    if (isMissingFallbackTable(old.error)) return { schema: "none", rows: [] };
    throw new Error(`${TABLE} read failed (${old.error.code ?? "?"}): ${old.error.message}`);
  }
  return { schema: "single", rows: (old.data as FallbackRow[] | null) ?? [] };
}

// ---------------------------------------------------------------------------
// Public snapshot
// ---------------------------------------------------------------------------

const fallbackSnapshotCached = unstable_cache(
  async (): Promise<Array<[string, string[]]>> => {
    const { rows } = await readRows();
    if (rows.length === 0) return [];
    const media = await readMedia(rows.map((r) => r.media_id));
    const urlById = new Map<string, string>();
    for (const m of media) {
      const u = urlOf(m);
      if (u) urlById.set(m.id, u);
    }
    const out: Array<[string, string[]]> = [];
    for (const [cat, ids] of groupFallbackRows(rows)) {
      const urls = ids.map((id) => urlById.get(id)).filter((u): u is string => Boolean(u));
      if (urls.length > 0) out.push([cat, urls]);
    }
    return out;
  },
  // D225: v2 - the value is now a URL LIST per category.
  ["public-snapshot", "menu-card-fallbacks", "v2"],
  { revalidate: PUBLIC_SNAPSHOT_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

/** website category -> public URLs in owner order. Empty on any failure, unconfigured, or pre-0355. */
export async function menuCardFallbackLists(): Promise<Map<string, string[]>> {
  if (!isSupabaseServiceConfigured) return new Map();
  try {
    return new Map(await fallbackSnapshotCached());
  } catch (err) {
    console.error("[menu-card-fallback] snapshot unavailable; cards keep their current image:", err instanceof Error ? err.message : err);
    return new Map();
  }
}

/**
 * D225: the lists the browser needs to rotate cards, ONLY for categories with
 * two or more pictures (the rest never rotate). Sent once per page by the
 * site layout, never per card. Never throws.
 */
export async function menuCardRotationLists(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const [cat, urls] of await menuCardFallbackLists()) {
    if (urls.length >= 2) out[cat] = urls;
  }
  return out;
}

/** The fallback URL for one product in one website category (stable pick), or null. */
export async function menuCardFallbackUrlFor(
  category: string | null | undefined,
  productKey?: string | null,
): Promise<string | null> {
  const cat = parseFallbackCategory(category);
  if (!cat) return null;
  return fallbackUrlForKey(productKey ?? "", (await menuCardFallbackLists()).get(cat) ?? []);
}

/**
 * One product (the register info card, the admin product page): the card's
 * FINAL website category is the owner's re-file when there is one, else its
 * own category, so the picture matches the one the shop shows. D225: with
 * many pictures it is the product's stable pick (the same first picture its
 * product page shows). Never throws.
 */
export async function menuCardFallbackUrlForProduct(
  posKey: string | null | undefined,
  category: string | null | undefined,
): Promise<string | null> {
  try {
    let finalCategory = category ?? null;
    const key = (posKey ?? "").trim();
    if (key) {
      const ov = (await getOverridesForKeys([key])).get(key);
      if (ov?.website_category) finalCategory = ov.website_category;
    }
    return await menuCardFallbackUrlFor(finalCategory, key);
  } catch {
    return null;
  }
}

/**
 * The overlay every public card surface runs AFTER withCategoryOverride (so
 * the card's final website category decides) and after the image resolver
 * (so a product's own photo always wins). Never throws: any failure returns
 * the items unchanged.
 */
export async function withMenuCardFallbacks<T extends FallbackableItem>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  try {
    const lists = await menuCardFallbackLists();
    if (lists.size === 0) return items;
    return applyMenuCardFallbacks(items, lists);
  } catch (err) {
    console.error("[menu-card-fallback] withMenuCardFallbacks failed:", err);
    return items;
  }
}

// ---------------------------------------------------------------------------
// Admin reads + writes
// ---------------------------------------------------------------------------

export type FallbackAdminRead =
  | { ok: true; schema: FallbackSchema; rows: FallbackRow[]; media: FallbackMedia[] }
  | { ok: false; schema: FallbackSchema; rows: []; media: []; message: string };

/** Live (uncached) read for the admin page: rows + their pictures. */
export async function readMenuCardFallbacksForAdmin(): Promise<FallbackAdminRead> {
  if (!isSupabaseServiceConfigured) return { ok: true, schema: "none", rows: [], media: [] };
  try {
    const { schema, rows } = await readRows();
    const media = await readMedia(rows.map((r) => r.media_id));
    return {
      ok: true,
      schema,
      rows,
      media: media.map((m) => ({ id: m.id, url: urlOf(m), title: m.title || m.filename || null, status: m.status })),
    };
  } catch (err) {
    return { ok: false, schema: "multi", rows: [], media: [], message: err instanceof Error ? err.message : String(err) };
  }
}

/** The category list right now (owner order) and which schema is live. */
export async function currentFallbackList(category: string): Promise<{ schema: FallbackSchema; mediaIds: string[] }> {
  const cat = parseFallbackCategory(category);
  if (!cat) return { schema: "multi", mediaIds: [] };
  const { schema, rows } = await readRows(cat);
  return { schema, mediaIds: groupFallbackRows(rows).get(cat) ?? [] };
}

/** Is this an image row in the media library (not archived)? */
export async function fallbackMediaExists(mediaId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("media_assets")
    .select("id, mime_type, status")
    .eq("id", mediaId)
    .maybeSingle();
  if (error || !data) return false;
  const row = data as { id: string; mime_type: string | null; status: string | null };
  return (row.mime_type ?? "").startsWith("image/") && row.status !== "archived";
}

/**
 * D225: add pictures to the END of a category list (owner order), skipping
 * any already in it and stopping at MAX_FALLBACKS_PER_CATEGORY. Before 0356
 * (one picture per category) the first picture replaces the current one,
 * exactly as D224 did.
 */
export async function addMenuCardFallbacks(
  category: string,
  mediaIds: readonly string[],
  staffProfileId: string | null,
): Promise<FallbackWriteResult> {
  const admin = createSupabaseAdminClient();
  let current: { schema: FallbackSchema; mediaIds: string[] };
  try {
    current = await currentFallbackList(category);
  } catch (err) {
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : String(err) };
  }
  if (current.schema === "none") return classify({ code: "42P01", message: "missing" });
  const now = new Date().toISOString();
  const fresh = Array.from(new Set(mediaIds)).filter((id) => !current.mediaIds.includes(id));
  if (fresh.length === 0) return { ok: true, added: 0, skipped: mediaIds.length };

  if (current.schema === "single") {
    const { error } = await admin
      .from(TABLE)
      .upsert({ website_category: category, media_id: fresh[0], updated_by: staffProfileId, updated_at: now }, { onConflict: "website_category" });
    if (error) return classify(error);
    return { ok: true, added: 1, skipped: mediaIds.length - 1 };
  }

  const room = roomFor(current.mediaIds.length, fresh.length);
  if (room === 0) return { ok: false, reason: "full", message: "This category already has the most pictures it can hold." };
  const take = fresh.slice(0, room);
  const start = current.mediaIds.length;
  const { error } = await admin.from(TABLE).upsert(
    take.map((id, i) => ({ website_category: category, media_id: id, sort_order: start + i, updated_by: staffProfileId, updated_at: now })),
    { onConflict: "website_category,media_id", ignoreDuplicates: true },
  );
  if (error) return classify(error);
  return { ok: true, added: take.length, skipped: mediaIds.length - take.length };
}

/** D225: take ONE picture out of a category list (the rest keep their order). */
export async function removeMenuCardFallback(category: string, mediaId: string): Promise<FallbackWriteResult> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from(TABLE).delete().eq("website_category", category).eq("media_id", mediaId);
  if (error) return classify(error);
  return { ok: true };
}

/** D225: save a new owner order (0356 only). At most 12 small updates. */
export async function reorderMenuCardFallbacks(category: string, order: readonly string[]): Promise<FallbackWriteResult> {
  const admin = createSupabaseAdminClient();
  const now = new Date().toISOString();
  for (let i = 0; i < order.length; i += 1) {
    const { error } = await admin
      .from(TABLE)
      .update({ sort_order: i, updated_at: now })
      .eq("website_category", category)
      .eq("media_id", order[i]!);
    if (error) {
      if (isMissingListColumns(error)) {
        return { ok: false, reason: "missing_0356", message: "Migration 0356 (many pictures per category) is not applied yet." };
      }
      return classify(error);
    }
  }
  return { ok: true };
}

/** Remove EVERY picture from a category. */
export async function clearMenuCardFallback(category: string): Promise<FallbackWriteResult> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from(TABLE).delete().eq("website_category", category);
  if (error) return classify(error);
  return { ok: true };
}
