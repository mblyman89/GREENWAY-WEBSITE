/**
 * src/lib/media/library-v2-server.ts   (D221 M5 + M6 + M7)
 *
 * Server reads/writes for the Media Library v2: collections, the search log,
 * the search summary, similar pictures (media_similar) and duplicate copies.
 * Every read degrades to an empty result plus an error message when the 0354
 * migration is not applied yet, so the library never breaks (it just hides the
 * new parts). Every {error} is read. Lists page with .range() (rule 15).
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { searchLogEntry, type SearchSurface } from "@/lib/media/library-v2-core";

export type MediaCollection = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  kind: "collection" | "brand-kit";
  vendor_id: string | null;
  archived_at: string | null;
  created_at: string;
  items: number;
};

export type SimilarHit = { media_id: string; score: number; reasons: string[] };

/** True when an error means "0354 is not applied" (missing table / function). */
export function isMissingObject(message: string | null | undefined): boolean {
  const m = String(message ?? "").toLowerCase();
  return m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache") || m.includes("pgrst202") || m.includes("pgrst205");
}

const PAGE = 500;

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    const got = (data as T[] | null) ?? [];
    rows.push(...got);
    if (got.length < PAGE) break;
  }
  return { rows, error: null };
}

/** Live (or all) collections with their live item counts. */
export async function loadCollections(opts: { includeArchived?: boolean } = {}): Promise<{ collections: MediaCollection[]; error: string | null; missing: boolean }> {
  if (!isSupabaseServiceConfigured) return { collections: [], error: null, missing: false };
  const admin = createSupabaseAdminClient();
  const cols = await pageAll<Omit<MediaCollection, "items">>((from, to) => {
    let q = admin.from("media_collections").select("id,name,slug,description,kind,vendor_id,archived_at,created_at").order("name", { ascending: true }).order("id", { ascending: true });
    if (!opts.includeArchived) q = q.is("archived_at", null);
    return q.range(from, to);
  });
  if (cols.error) return { collections: [], error: isMissingObject(cols.error) ? null : cols.error, missing: isMissingObject(cols.error) };
  const items = await pageAll<{ collection_id: string }>((from, to) =>
    admin.from("media_collection_items").select("collection_id").is("removed_at", null).order("collection_id", { ascending: true }).order("media_id", { ascending: true }).range(from, to),
  );
  const counts = new Map<string, number>();
  for (const r of items.rows) counts.set(r.collection_id, (counts.get(r.collection_id) ?? 0) + 1);
  return {
    collections: cols.rows.map((c) => ({ ...c, items: counts.get(c.id) ?? 0 })),
    error: items.error,
    missing: false,
  };
}

/** The live media ids in one collection. */
export async function loadCollectionMemberIds(collectionId: string): Promise<{ ids: Set<string>; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ids: new Set(), error: null };
  const admin = createSupabaseAdminClient();
  const r = await pageAll<{ media_id: string }>((from, to) =>
    admin.from("media_collection_items").select("media_id").eq("collection_id", collectionId).is("removed_at", null).order("position", { ascending: true }).order("media_id", { ascending: true }).range(from, to),
  );
  return { ids: new Set(r.rows.map((x) => x.media_id)), error: r.error && !isMissingObject(r.error) ? r.error : null };
}

/** The collections one picture is in. */
export async function loadCollectionsForMedia(mediaId: string): Promise<{ ids: Set<string>; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { ids: new Set(), error: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("media_collection_items").select("collection_id").eq("media_id", mediaId).is("removed_at", null).range(0, 499);
  if (error) return { ids: new Set(), error: isMissingObject(error.message) ? null : error.message };
  return { ids: new Set(((data as { collection_id: string }[] | null) ?? []).map((r) => r.collection_id)), error: null };
}

/** Log one search (best effort; a missing 0354 table is silently ignored). */
export async function logMediaSearch(surface: SearchSurface, query: unknown, filters: Record<string, unknown>, results: number, actorId: string | null): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const entry = searchLogEntry(surface, query, filters, results);
  if (!entry) return;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("media_search_log").insert({ ...entry, actor_id: actorId });
    if (error && !isMissingObject(error.message)) console.warn("[media] search log:", error.message);
  } catch (e) {
    console.warn("[media] search log failed:", e instanceof Error ? e.message : String(e));
  }
}

export type SearchSummaryRow = { query: string; searches: number; zero_hits: number; last_at: string };

export async function loadSearchSummary(days = 30): Promise<{ rows: SearchSummaryRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { rows: [], error: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("media_search_summary", { p_days: days });
  if (error) return { rows: [], error: isMissingObject(error.message) ? null : error.message };
  return {
    rows: ((data as SearchSummaryRow[] | null) ?? []).map((r) => ({ ...r, searches: Number(r.searches), zero_hits: Number(r.zero_hits) })),
    error: null,
  };
}

/** Pictures like this one (0354 media_similar). */
export async function loadSimilar(mediaId: string, limit = 24): Promise<{ hits: SimilarHit[]; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { hits: [], error: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("media_similar", { p_id: mediaId, p_limit: limit });
  if (error) return { hits: [], error: isMissingObject(error.message) ? null : error.message };
  return {
    hits: ((data as SimilarHit[] | null) ?? []).map((h) => ({ media_id: h.media_id, score: Number(h.score), reasons: Array.isArray(h.reasons) ? h.reasons : [] })),
    error: null,
  };
}

export type DuplicateRow = { id: string; storage_key: string; filename: string; title: string | null; status: string; mime_type: string | null; canonical_id: string | null };

/** The archived copies that point at this picture, and the original it points at (if it is a copy). */
export async function loadDuplicates(mediaId: string, canonicalId: string | null): Promise<{ copies: DuplicateRow[]; original: DuplicateRow | null; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { copies: [], original: null, error: null };
  const admin = createSupabaseAdminClient();
  const cols = "id,storage_key,filename,title,status,mime_type,canonical_id";
  const { data, error } = await admin.from("media_assets").select(cols).eq("canonical_id", mediaId).order("created_at", { ascending: true }).order("id", { ascending: true }).range(0, 99);
  if (error) return { copies: [], original: null, error: error.message };
  let original: DuplicateRow | null = null;
  if (canonicalId) {
    const o = await admin.from("media_assets").select(cols).eq("id", canonicalId).maybeSingle();
    if (o.error) return { copies: (data as DuplicateRow[] | null) ?? [], original: null, error: o.error.message };
    original = (o.data as DuplicateRow | null) ?? null;
  }
  return { copies: (data as DuplicateRow[] | null) ?? [], original, error: null };
}

/** Rows for a set of ids (similar / duplicates tiles). */
export async function loadMediaByIds(ids: readonly string[]): Promise<{ rows: DuplicateRow[]; error: string | null }> {
  if (!isSupabaseServiceConfigured || ids.length === 0) return { rows: [], error: null };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("media_assets").select("id,storage_key,filename,title,status,mime_type,canonical_id").in("id", ids.slice(0, 200)).range(0, 199);
  if (error) return { rows: [], error: error.message };
  return { rows: (data as DuplicateRow[] | null) ?? [], error: null };
}

/** Vendor id → display name for the facet panel and the bulk vendor menu. */
export async function loadVendorNames(): Promise<{ names: Map<string, string>; error: string | null }> {
  if (!isSupabaseServiceConfigured) return { names: new Map(), error: null };
  const admin = createSupabaseAdminClient();
  const r = await pageAll<{ id: string; display_name: string }>((from, to) =>
    admin.from("vendors").select("id,display_name").order("display_name", { ascending: true }).order("id", { ascending: true }).range(from, to),
  );
  return { names: new Map(r.rows.map((v) => [v.id.toLowerCase(), v.display_name])), error: r.error };
}
