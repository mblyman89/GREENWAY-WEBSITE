/**
 * src/lib/cms/content-store.ts
 *
 * Server-side service for the controlled site-text editor (content_blocks) and
 * SEO entries (seo_entries). Public reads return the published value with a
 * static default fallback so the front end never renders empty.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type {
  ContentBlockRow,
  ContentRevisionRow,
  SeoEntryRow,
  PostStatus,
} from "./types";
import { CONTENT_BLOCK_SEEDS } from "./content-blocks-seed";

const SEED_DEFAULTS = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s.defaultValue]));

// ---------------------------------------------------------------------------
// Content blocks
// ---------------------------------------------------------------------------

export async function listContentBlocks(): Promise<ContentBlockRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("content_blocks")
    .select("*")
    .order("page", { ascending: true })
    .order("block_key", { ascending: true });
  return (data as ContentBlockRow[] | null) ?? [];
}

export async function getContentBlock(blockKey: string): Promise<ContentBlockRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("content_blocks")
    .select("*")
    .eq("block_key", blockKey)
    .maybeSingle();
  return (data as ContentBlockRow | null) ?? null;
}

/**
 * Public value for a content block: published_value when the row exists and is
 * published, otherwise the committed seed default. Never returns empty for a
 * known key.
 */
export async function getPublishedContent(blockKey: string): Promise<string | null> {
  const fallback = SEED_DEFAULTS.get(blockKey) ?? null;
  if (!isSupabaseServiceConfigured) return fallback;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("content_blocks")
    .select("published_value, status")
    .eq("block_key", blockKey)
    .maybeSingle();
  const row = data as { published_value: string | null; status: PostStatus } | null;
  if (row && row.status === "published" && row.published_value != null) {
    return row.published_value;
  }
  return fallback;
}

/** Save the draft value of a content block (does not publish). */
export async function saveContentDraft(
  blockKey: string,
  draftValue: string,
  actorId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("content_blocks")
    .update({ draft_value: draftValue, last_edited_by: actorId })
    .eq("block_key", blockKey);
  if (error) throw new Error(error.message);
}

/**
 * Publish the current draft value of a content block and snapshot the
 * published value into content_revisions (migration 0010) so it can be
 * reviewed or restored later. The snapshot is best-effort — a failure to log
 * history must never block the publish itself.
 */
export async function publishContentBlock(
  blockKey: string,
  actorId: string | null,
  options?: { actorEmail?: string | null; note?: string | null },
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const block = await getContentBlock(blockKey);
  if (!block) throw new Error(`content block ${blockKey} not found`);
  const value = block.draft_value ?? block.published_value ?? "";
  const { error } = await admin
    .from("content_blocks")
    .update({
      published_value: value,
      status: "published" as PostStatus,
      last_published_by: actorId,
      published_at: new Date().toISOString(),
    })
    .eq("block_key", blockKey);
  if (error) throw new Error(error.message);

  // Snapshot the now-live value into the revision history (best-effort).
  try {
    await admin.from("content_revisions").insert({
      block_key: blockKey,
      value,
      field_type: block.field_type,
      label: block.label,
      note: options?.note ?? null,
      actor_id: actorId,
      actor_email: options?.actorEmail ?? null,
    });
  } catch {
    // History is non-critical; ignore failures (e.g. migration not yet run).
  }
}

/** List the published-value history for a block, newest first. */
export async function listContentRevisions(
  blockKey: string,
  limit = 20,
): Promise<ContentRevisionRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("content_revisions")
    .select("*")
    .eq("block_key", blockKey)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as ContentRevisionRow[] | null) ?? [];
}

/** Fetch a single revision by id (used to restore its value into the draft). */
export async function getContentRevision(
  revisionId: string,
): Promise<ContentRevisionRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("content_revisions")
    .select("*")
    .eq("id", revisionId)
    .maybeSingle();
  return (data as ContentRevisionRow | null) ?? null;
}

/**
 * Restore a revision's value into a block's DRAFT (does not auto-publish).
 * Staff then review the draft and publish when ready — keeps a human in the
 * loop and reuses the normal publish→snapshot path.
 */
export async function restoreContentRevisionToDraft(
  revisionId: string,
  actorId: string | null,
): Promise<{ blockKey: string; value: string } | null> {
  const revision = await getContentRevision(revisionId);
  if (!revision) return null;
  await saveContentDraft(revision.block_key, revision.value, actorId);
  return { blockKey: revision.block_key, value: revision.value };
}

/**
 * Publish ALL blocks that currently have an unpublished draft (draft_value
 * differs from published_value). Returns the list of block_keys published.
 * Snapshots each one into history via publishContentBlock.
 */
export async function publishAllDrafts(
  actorId: string | null,
  actorEmail: string | null,
): Promise<string[]> {
  if (!isSupabaseServiceConfigured) return [];
  const blocks = await listContentBlocks();
  const pending = blocks.filter(
    (b) =>
      (b.draft_value ?? "") !== (b.published_value ?? "") ||
      b.status !== "published",
  );
  const published: string[] = [];
  for (const b of pending) {
    await publishContentBlock(b.block_key, actorId, {
      actorEmail,
      note: "Bulk publish",
    });
    published.push(b.block_key);
  }
  return published;
}

/**
 * Discard ALL drafts: reset every block's draft_value back to its currently
 * published value. Returns the list of block_keys reset.
 */
export async function discardAllDrafts(
  actorId: string | null,
): Promise<string[]> {
  if (!isSupabaseServiceConfigured) return [];
  const blocks = await listContentBlocks();
  const dirty = blocks.filter(
    (b) => (b.draft_value ?? "") !== (b.published_value ?? ""),
  );
  const admin = createSupabaseAdminClient();
  const reset: string[] = [];
  for (const b of dirty) {
    const { error } = await admin
      .from("content_blocks")
      .update({ draft_value: b.published_value, last_edited_by: actorId })
      .eq("block_key", b.block_key);
    if (!error) reset.push(b.block_key);
  }
  return reset;
}

/** Count blocks that currently have unpublished changes (a draft != live). */
export async function countPendingDrafts(): Promise<number> {
  const blocks = await listContentBlocks();
  return blocks.filter(
    (b) =>
      (b.draft_value ?? "") !== (b.published_value ?? "") ||
      b.status !== "published",
  ).length;
}

/**
 * Idempotently ensure all seeded content blocks exist (lazy seed on first
 * admin visit). Uses default value for both published + draft.
 */
export async function ensureContentBlocksSeeded(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("content_blocks").select("block_key");
  const existing = new Set(((data as { block_key: string }[] | null) ?? []).map((r) => r.block_key));
  const toInsert = CONTENT_BLOCK_SEEDS.filter((s) => !existing.has(s.block_key)).map((s) => ({
    block_key: s.block_key,
    page: s.page,
    section: s.section,
    label: s.label,
    help_text: s.help_text ?? null,
    field_type: s.field_type,
    published_value: s.defaultValue,
    draft_value: s.defaultValue,
    seo_impact: s.seo_impact ?? false,
    status: "published" as PostStatus,
  }));
  if (toInsert.length === 0) return 0;
  const { error } = await admin.from("content_blocks").insert(toInsert);
  if (error) throw new Error(error.message);
  return toInsert.length;
}

// ---------------------------------------------------------------------------
// SEO entries
// ---------------------------------------------------------------------------

export async function listSeoEntries(): Promise<SeoEntryRow[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("seo_entries")
    .select("*")
    .order("path", { ascending: true, nullsFirst: false });
  return (data as SeoEntryRow[] | null) ?? [];
}

export async function getSeoByPath(path: string): Promise<SeoEntryRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("seo_entries").select("*").eq("path", path).maybeSingle();
  return (data as SeoEntryRow | null) ?? null;
}

export type UpsertSeoInput = {
  path: string;
  seo_title?: string | null;
  seo_description?: string | null;
  canonical?: string | null;
  noindex?: boolean;
  sitemap_include?: boolean;
  updatedBy: string | null;
};

export async function upsertSeoEntry(input: UpsertSeoInput): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("seo_entries").upsert(
    {
      path: input.path,
      entity_type: "page",
      seo_title: input.seo_title ?? null,
      seo_description: input.seo_description ?? null,
      canonical: input.canonical ?? null,
      noindex: input.noindex ?? false,
      sitemap_include: input.sitemap_include ?? true,
      status: "published" as PostStatus,
      updated_by: input.updatedBy,
    },
    { onConflict: "path" },
  );
  if (error) throw new Error(error.message);
}
