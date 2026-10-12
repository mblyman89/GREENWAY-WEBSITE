/**
 * src/lib/menu/product-tags-store.ts - R49 S5 (owner: Michael)
 *
 * Server read/write for migration 0269 (tag_definitions,
 * product_tag_assignments, product_first_seen). Same graceful pattern as
 * product-classification-overrides.ts: before 0269 is applied (or without
 * Supabase) READS return "no tags" and the website behaves exactly as before;
 * WRITES return a friendly "apply migration 0269" message and never throw.
 *
 * All reads that use `.in()` are chunked AND paged (PostgREST silently caps a
 * response at db.max_rows = 1,000). NEVER touches CCRS/LCB data.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { chunkedIn, pagedAll, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  NEW_TAG_SLUG,
  sortTags,
  type TagAutoRule,
  type TagDefinition,
} from "@/lib/menu/product-tags-core";

export const TAGS_MIGRATION_MESSAGE =
  "Tags need database migration 0269 (supabase/migrations/0269_product_tags.sql). Apply it in the Supabase SQL editor, then reload this page.";

/** Postgres "relation does not exist" / PostgREST schema-cache miss. */
export function isMissingTagTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /relation .* does not exist|could not find the table|schema cache/i.test(err.message ?? "")
  );
}

type DefRow = {
  id: string;
  slug: string;
  label: string;
  color: string;
  auto_rule: string;
  window_days: number;
  sort_order: number;
  enabled: boolean;
  show_on_menu: boolean;
};

const DEF_COLUMNS = "id, slug, label, color, auto_rule, window_days, sort_order, enabled, show_on_menu";

function toDef(r: DefRow): TagDefinition {
  return {
    id: r.id,
    slug: r.slug,
    label: r.label,
    color: r.color,
    autoRule: (r.auto_rule === "new_window" ? "new_window" : "none") as TagAutoRule,
    windowDays: r.window_days,
    sortOrder: r.sort_order,
    enabled: r.enabled,
    showOnMenu: r.show_on_menu,
  };
}

export type TagDefsResult =
  | { ok: true; defs: TagDefinition[] }
  | { ok: false; missing: boolean; error: string };

/** Every tag (enabled or not), in the owner's order. */
export async function listTagDefinitions(): Promise<TagDefsResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, missing: false, error: "The database isn't configured." };
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.from("tag_definitions").select(DEF_COLUMNS).order("sort_order").range(0, 499);
    if (error) {
      if (isMissingTagTable(error)) return { ok: false, missing: true, error: TAGS_MIGRATION_MESSAGE };
      return { ok: false, missing: false, error: error.message };
    }
    return { ok: true, defs: sortTags(((data as DefRow[] | null) ?? []).map(toDef)) };
  } catch (err) {
    return { ok: false, missing: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Everything the menu overlay needs for a set of product keys: tag defs,
 * hand-applied tags and first-seen dates. Returns null (= "no tags") before
 * 0269 / unconfigured / on any read error, so the menu never breaks.
 */
export async function loadTagInputsForKeys(keys: readonly string[]): Promise<{
  defs: TagDefinition[];
  manual: Map<string, string[]>;
  firstSeen: Map<string, string>;
} | null> {
  const unique = Array.from(new Set(keys.filter((k) => typeof k === "string" && k.trim().length > 0)));
  if (!isSupabaseServiceConfigured || unique.length === 0) return null;
  const defsRes = await listTagDefinitions();
  if (!defsRes.ok) {
    if (!defsRes.missing) console.error("[product-tags] defs read failed:", defsRes.error);
    return null;
  }
  const defs = defsRes.defs.filter((d) => d.enabled);
  if (defs.length === 0) return null;
  try {
    const admin = createSupabaseAdminClient();
    let failed = false;
    const needFirstSeen = defs.some((d) => d.autoRule === "new_window");
    const [assignRows, seenRows] = await Promise.all([
      chunkedIn<string, { tag_id: string; pos_product_key: string }>(
        unique,
        async (chunk, from, to) => {
          const { data, error } = await admin
            .from("product_tag_assignments")
            .select("tag_id, pos_product_key")
            .in("pos_product_key", chunk)
            .order("id", { ascending: true })
            .range(from, to);
          if (error) {
            failed = true;
            return [];
          }
          return (data as { tag_id: string; pos_product_key: string }[] | null) ?? [];
        },
        { chunkSize: 300, concurrency: MENU_READ_CONCURRENCY },
      ),
      needFirstSeen
        ? chunkedIn<string, { pos_product_key: string; first_published_at: string }>(
            unique,
            async (chunk, from, to) => {
              const { data, error } = await admin
                .from("product_first_seen")
                .select("pos_product_key, first_published_at")
                .in("pos_product_key", chunk)
                .order("pos_product_key", { ascending: true })
                .range(from, to);
              if (error) {
                failed = true;
                return [];
              }
              return (data as { pos_product_key: string; first_published_at: string }[] | null) ?? [];
            },
            { chunkSize: 300, concurrency: MENU_READ_CONCURRENCY },
          )
        : Promise.resolve([]),
    ]);
    if (failed) {
      console.error("[product-tags] assignment / first-seen read failed; showing no tags this render");
      return null;
    }
    const manual = new Map<string, string[]>();
    for (const r of assignRows) {
      const list = manual.get(r.pos_product_key) ?? [];
      list.push(r.tag_id);
      manual.set(r.pos_product_key, list);
    }
    const firstSeen = new Map<string, string>();
    for (const r of seenRows) firstSeen.set(r.pos_product_key, r.first_published_at);
    return { defs, manual, firstSeen };
  } catch (err) {
    console.error("[product-tags] loadTagInputsForKeys failed:", err);
    return null;
  }
}

export type WriteResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function writeError(error: { code?: string; message?: string }): string {
  if (isMissingTagTable(error)) return TAGS_MIGRATION_MESSAGE;
  if (error.code === "23505") return "That tag already exists.";
  return error.message ?? "The database refused the change.";
}

export async function createTagDefinition(
  value: Omit<TagDefinition, "id">,
  actorId: string | null,
): Promise<WriteResult<TagDefinition>> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tag_definitions")
    .insert({
      slug: value.slug,
      label: value.label,
      color: value.color,
      auto_rule: value.autoRule,
      window_days: value.windowDays,
      sort_order: value.sortOrder,
      enabled: value.enabled,
      show_on_menu: value.showOnMenu,
      created_by: actorId,
    })
    .select(DEF_COLUMNS)
    .single();
  if (error) return { ok: false, error: writeError(error) };
  return { ok: true, value: toDef(data as DefRow) };
}

export async function updateTagDefinition(
  id: string,
  value: Omit<TagDefinition, "id" | "slug">,
): Promise<WriteResult<TagDefinition>> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured." };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("tag_definitions")
    .update({
      label: value.label,
      color: value.color,
      auto_rule: value.autoRule,
      window_days: value.windowDays,
      sort_order: value.sortOrder,
      enabled: value.enabled,
      show_on_menu: value.showOnMenu,
    })
    .eq("id", id)
    .select(DEF_COLUMNS)
    .single();
  if (error) return { ok: false, error: writeError(error) };
  return { ok: true, value: toDef(data as DefRow) };
}

/** Deletes a tag and (by FK cascade) every hand-applied use of it. The New tag cannot be deleted. */
export async function deleteTagDefinition(id: string): Promise<WriteResult<TagDefinition>> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured." };
  const admin = createSupabaseAdminClient();
  const { data: row, error: readErr } = await admin.from("tag_definitions").select(DEF_COLUMNS).eq("id", id).maybeSingle();
  if (readErr) return { ok: false, error: writeError(readErr) };
  if (!row) return { ok: false, error: "That tag no longer exists." };
  if ((row as DefRow).slug === NEW_TAG_SLUG) {
    return { ok: false, error: "The built-in New tag can't be deleted. Turn it off instead." };
  }
  const { error } = await admin.from("tag_definitions").delete().eq("id", id);
  if (error) return { ok: false, error: writeError(error) };
  return { ok: true, value: toDef(row as DefRow) };
}

/** Product keys that carry a tag by hand (paged; a tag can be on thousands of products). */
export async function listAssignmentsForTag(tagId: string): Promise<WriteResult<string[]>> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured." };
  const admin = createSupabaseAdminClient();
  let failure: string | null = null;
  const rows = await pagedAll<{ pos_product_key: string }>(async (from, to) => {
    const { data, error } = await admin
      .from("product_tag_assignments")
      .select("pos_product_key")
      .eq("tag_id", tagId)
      .order("pos_product_key", { ascending: true })
      .range(from, to);
    if (error) {
      failure = writeError(error);
      return [];
    }
    return (data as { pos_product_key: string }[] | null) ?? [];
  });
  if (failure) return { ok: false, error: failure };
  return { ok: true, value: rows.map((r) => r.pos_product_key) };
}

/** Apply a tag to products (idempotent: already-tagged products are left alone). */
export async function applyTagToProducts(
  tagId: string,
  keys: readonly string[],
  actorId: string | null,
): Promise<WriteResult<number>> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured." };
  const unique = Array.from(new Set(keys.map((k) => k.trim()).filter((k) => k.length > 0 && k.length <= 200)));
  if (unique.length === 0) return { ok: true, value: 0 };
  const admin = createSupabaseAdminClient();
  let applied = 0;
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500).map((k) => ({ tag_id: tagId, pos_product_key: k, applied_by: actorId }));
    const { error } = await admin
      .from("product_tag_assignments")
      .upsert(batch, { onConflict: "tag_id,pos_product_key", ignoreDuplicates: true });
    if (error) return { ok: false, error: writeError(error) };
    applied += batch.length;
  }
  return { ok: true, value: applied };
}

export async function removeTagFromProducts(tagId: string, keys: readonly string[]): Promise<WriteResult<number>> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "The database isn't configured." };
  const unique = Array.from(new Set(keys.map((k) => k.trim()).filter(Boolean)));
  if (unique.length === 0) return { ok: true, value: 0 };
  const admin = createSupabaseAdminClient();
  for (let i = 0; i < unique.length; i += 300) {
    const { error } = await admin
      .from("product_tag_assignments")
      .delete()
      .eq("tag_id", tagId)
      .in("pos_product_key", unique.slice(i, i + 300));
    if (error) return { ok: false, error: writeError(error) };
  }
  return { ok: true, value: unique.length };
}

/**
 * Stamp first-seen for every product on a just-published menu version.
 * insert ... on conflict do nothing: the FIRST publish a product appeared in
 * wins forever, so re-publishing never makes an old product "New" again.
 * Test versions are skipped. Best effort: never throws, never blocks publish.
 */
export async function stampFirstSeenForVersion(versionId: string): Promise<{ stamped: number; skipped?: string }> {
  if (!isSupabaseServiceConfigured || !versionId) return { stamped: 0, skipped: "unconfigured" };
  try {
    const admin = createSupabaseAdminClient();
    const { data: v, error: vErr } = await admin
      .from("menu_versions")
      .select("id, status, published_at, is_test")
      .eq("id", versionId)
      .maybeSingle();
    if (vErr || !v) return { stamped: 0, skipped: "version not readable" };
    const version = v as { status: string; published_at: string | null; is_test: boolean | null };
    if (version.is_test) return { stamped: 0, skipped: "test version" };
    if (version.status !== "published" || !version.published_at) return { stamped: 0, skipped: "not published" };
    let readFailed = false;
    const rows = await pagedAll<{ source_item_id: string }>(async (from, to) => {
      const { data, error } = await admin
        .from("menu_items")
        .select("source_item_id")
        .eq("menu_version_id", versionId)
        .order("id", { ascending: true })
        .range(from, to);
      if (error) {
        readFailed = true;
        return [];
      }
      return (data as { source_item_id: string }[] | null) ?? [];
    });
    if (readFailed) return { stamped: 0, skipped: "menu items not readable" };
    const keys = Array.from(new Set(rows.map((r) => r.source_item_id).filter((k) => k && k.length <= 200)));
    let stamped = 0;
    for (let i = 0; i < keys.length; i += 500) {
      const batch = keys.slice(i, i + 500).map((k) => ({ pos_product_key: k, first_published_at: version.published_at, source: "publish" }));
      const { error } = await admin
        .from("product_first_seen")
        .upsert(batch, { onConflict: "pos_product_key", ignoreDuplicates: true });
      if (error) {
        if (!isMissingTagTable(error)) console.error("[product-tags] first-seen stamp failed:", error.message);
        return { stamped, skipped: isMissingTagTable(error) ? "migration 0269 not applied" : error.message };
      }
      stamped += batch.length;
    }
    return { stamped };
  } catch (err) {
    console.error("[product-tags] stampFirstSeenForVersion failed:", err);
    return { stamped: 0, skipped: "exception" };
  }
}

/** Counts for the settings page header. */
export async function countFirstSeen(): Promise<number | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { count, error } = await admin.from("product_first_seen").select("pos_product_key", { count: "exact", head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/** The server clock for tag windows (one place, so pages never read the clock in render). */
export function tagClockNowMs(): number {
  return new Date().getTime();
}
