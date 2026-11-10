/**
 * src/lib/menu/menu-card-fallback-server.ts  (D224)
 *
 * SERVER-ONLY. Reads and writes public.menu_card_fallback_images (0355): one
 * owner-chosen picture per website category, shown on every card in that
 * category that has no photo of its own. Decisions live in
 * menu-card-fallback-core.ts; this file only does I/O.
 *
 * READS (public pages)
 *   One small snapshot (21 rows at most + their media URLs) held in the
 *   Next.js data cache for PUBLIC_SNAPSHOT_TTL_SECONDS, tagged MENU_CACHE_TAG,
 *   so every render answers from memory and a save (which calls
 *   revalidatePublicMenuSurfaces) shows on the next visit. A failed read
 *   THROWS inside the cached function so a failure is never stored; the
 *   wrapper then returns an empty map and the cards render exactly as before.
 *   Before 0355 is applied (42P01 / PGRST205) the map is empty: identity.
 *
 * WRITES (the admin page only, via its server actions)
 *   setMenuCardFallback / clearMenuCardFallback. Every {error} is read and
 *   classified (missing table vs permission vs other) so the page can say
 *   which one happened.
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
import {
  applyMenuCardFallbacks,
  parseFallbackCategory,
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

/** The service role lost its grant (should never happen after 0355). */
export function isFallbackPermissionError(err: PgError): boolean {
  return Boolean(err && (err.code === "42501" || /permission denied/i.test(err.message ?? "")));
}

export type FallbackWriteResult = { ok: true } | { ok: false; reason: "missing_table" | "permission" | "error"; message: string };

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

type RowsRead = { migrated: boolean; rows: FallbackRow[] };

async function readRows(): Promise<RowsRead> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(TABLE)
    .select("website_category, media_id, updated_at")
    .order("website_category", { ascending: true });
  if (error) {
    if (isMissingFallbackTable(error)) return { migrated: false, rows: [] };
    throw new Error(`${TABLE} read failed (${error.code ?? "?"}): ${error.message}`);
  }
  return { migrated: true, rows: (data as FallbackRow[] | null) ?? [] };
}

// ---------------------------------------------------------------------------
// Public snapshot
// ---------------------------------------------------------------------------

const fallbackSnapshotCached = unstable_cache(
  async (): Promise<Array<[string, string]>> => {
    const { rows } = await readRows();
    if (rows.length === 0) return [];
    const media = await readMedia(rows.map((r) => r.media_id));
    const urlById = new Map<string, string>();
    for (const m of media) {
      const u = urlOf(m);
      if (u) urlById.set(m.id, u);
    }
    const out: Array<[string, string]> = [];
    for (const r of rows) {
      const cat = parseFallbackCategory(r.website_category);
      const url = urlById.get(r.media_id);
      if (cat && url) out.push([cat, url]);
    }
    return out;
  },
  ["public-snapshot", "menu-card-fallbacks", "v1"],
  { revalidate: PUBLIC_SNAPSHOT_TTL_SECONDS, tags: [MENU_CACHE_TAG] },
);

/** website category -> public URL. Empty on any failure, unconfigured, or pre-0355. */
export async function menuCardFallbackUrls(): Promise<Map<string, string>> {
  if (!isSupabaseServiceConfigured) return new Map();
  try {
    return new Map(await fallbackSnapshotCached());
  } catch (err) {
    console.error("[menu-card-fallback] snapshot unavailable; cards keep their current image:", err instanceof Error ? err.message : err);
    return new Map();
  }
}

/** The fallback URL for one website category, or null. */
export async function menuCardFallbackUrlFor(category: string | null | undefined): Promise<string | null> {
  const cat = parseFallbackCategory(category);
  if (!cat) return null;
  return (await menuCardFallbackUrls()).get(cat) ?? null;
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
    const urls = await menuCardFallbackUrls();
    if (urls.size === 0) return items;
    return applyMenuCardFallbacks(items, urls);
  } catch (err) {
    console.error("[menu-card-fallback] withMenuCardFallbacks failed:", err);
    return items;
  }
}

// ---------------------------------------------------------------------------
// Admin reads + writes
// ---------------------------------------------------------------------------

export type FallbackAdminRead =
  | { ok: true; migrated: boolean; rows: FallbackRow[]; media: FallbackMedia[] }
  | { ok: false; migrated: boolean; rows: []; media: []; message: string };

/** Live (uncached) read for the admin page: rows + their pictures. */
export async function readMenuCardFallbacksForAdmin(): Promise<FallbackAdminRead> {
  if (!isSupabaseServiceConfigured) return { ok: true, migrated: false, rows: [], media: [] };
  try {
    const { migrated, rows } = await readRows();
    const media = await readMedia(rows.map((r) => r.media_id));
    return {
      ok: true,
      migrated,
      rows,
      media: media.map((m) => ({ id: m.id, url: urlOf(m), title: m.title || m.filename || null, status: m.status })),
    };
  } catch (err) {
    return { ok: false, migrated: true, rows: [], media: [], message: err instanceof Error ? err.message : String(err) };
  }
}

/** The current picture for a category (for the audit "before"), or null. */
export async function currentFallbackMediaId(category: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from(TABLE).select("media_id").eq("website_category", category).maybeSingle();
  if (error) return null;
  return (data as { media_id: string } | null)?.media_id ?? null;
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

/** One picture per category: an upsert on the category key. */
export async function setMenuCardFallback(category: string, mediaId: string, staffProfileId: string | null): Promise<FallbackWriteResult> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from(TABLE)
    .upsert(
      { website_category: category, media_id: mediaId, updated_by: staffProfileId, updated_at: new Date().toISOString() },
      { onConflict: "website_category" },
    );
  if (error) return classify(error);
  return { ok: true };
}

export async function clearMenuCardFallback(category: string): Promise<FallbackWriteResult> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from(TABLE).delete().eq("website_category", category);
  if (error) return classify(error);
  return { ok: true };
}
