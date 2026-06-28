/**
 * src/lib/cms/page-sections-store.ts
 *
 * Server-side service for the generic per-page section builder
 * (table public.page_sections, migration 0013).
 *
 * Lifecycle mirrors content_blocks + the home carousel: each section has
 * published_* columns (what the public sees) and draft_* columns (what the
 * editor is staging). Saving a draft never touches the live section; publishing
 * copies draft → published.
 *
 * Public reads return ENABLED + PUBLISHED sections for a page, draft-aware in
 * Draft Mode. Per-page caps (e.g. home = 4) are enforced here, not in the DB.
 */
import "server-only";
import { draftMode } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  type PageSectionRow,
  type RenderSection,
  type SectionAdminVM,
  type SectionButton,
  type SectionButtonVariant,
  type SectionImageFocus,
  type SectionTextAlign,
  sectionCapFor,
} from "./page-sections-types";
import { seedsForPage } from "./page-sections-seed";

const SELECT = "*";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeButtons(value: unknown): SectionButton[] {
  if (!Array.isArray(value)) return [];
  const out: SectionButton[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim() : "";
    const href = typeof r.href === "string" ? r.href.trim() : "";
    if (!label) continue;
    const variant: SectionButtonVariant =
      r.variant === "outline" ? "outline" : r.variant === "ghost" ? "ghost" : "solid";
    const enabled = r.enabled === false ? false : true;
    out.push({ label, href, variant, enabled });
    if (out.length >= 4) break; // up to 4 buttons per section
  }
  return out;
}

function coerceRow(raw: Record<string, unknown>): PageSectionRow {
  return {
    ...(raw as unknown as PageSectionRow),
    buttons: normalizeButtons(raw.buttons),
    draft_buttons:
      raw.draft_buttons == null ? null : normalizeButtons(raw.draft_buttons),
    settings: (raw.settings as Record<string, unknown> | null) ?? {},
    draft_settings: (raw.draft_settings as Record<string, unknown> | null) ?? null,
  };
}

function isDirty(row: PageSectionRow): boolean {
  const fields: Array<keyof PageSectionRow> = [
    "image",
    "image_alt",
    "image_focus",
    "text_align",
    "eyebrow",
    "title",
    "subtitle",
    "body",
  ];
  for (const f of fields) {
    const draftKey = `draft_${f}` as keyof PageSectionRow;
    const draftVal = row[draftKey];
    if (draftVal != null && draftVal !== row[f]) return true;
  }
  if (row.draft_buttons != null) {
    if (JSON.stringify(row.draft_buttons) !== JSON.stringify(row.buttons ?? []))
      return true;
  }
  if (row.draft_settings != null) {
    if (JSON.stringify(row.draft_settings) !== JSON.stringify(row.settings ?? {}))
      return true;
  }
  if (row.draft_enabled !== row.enabled) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export async function listSections(pageSlug: string): Promise<SectionAdminVM[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("page_sections")
    .select(SELECT)
    .eq("page_slug", pageSlug)
    .order("sort_order", { ascending: true });
  const rows = ((data as Record<string, unknown>[] | null) ?? []).map(coerceRow);
  return rows.map((row) => ({ ...row, dirty: isDirty(row) }));
}

export async function getSection(id: string): Promise<PageSectionRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("page_sections")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  return data ? coerceRow(data as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// Public render resolution (draft-aware)
// ---------------------------------------------------------------------------

function resolveForRender(row: PageSectionRow, preview: boolean): RenderSection {
  const pick = <T,>(draft: T | null | undefined, published: T): T =>
    preview && draft != null ? draft : published;

  return {
    key: row.section_key,
    kind: row.kind,
    image: pick(row.draft_image, row.image ?? "") || "",
    imageAlt: pick(row.draft_image_alt, row.image_alt ?? "") || "",
    imageFocus: (pick(row.draft_image_focus, row.image_focus) ??
      "center") as SectionImageFocus,
    textAlign: (pick(row.draft_text_align, row.text_align) ??
      "left") as SectionTextAlign,
    eyebrow: pick(row.draft_eyebrow, row.eyebrow ?? "") || "",
    title: pick(row.draft_title, row.title ?? "") || "",
    subtitle: pick(row.draft_subtitle, row.subtitle ?? "") || "",
    body: pick(row.draft_body, row.body ?? "") || "",
    buttons: pick(row.draft_buttons, row.buttons ?? []) ?? [],
    settings: pick(row.draft_settings, row.settings ?? {}) ?? {},
  };
}

/**
 * Resolve the sections to render on a PUBLIC page.
 * - Draft Mode (staff preview): include draft-enabled sections, show draft values.
 * - Normally: published + enabled sections only.
 * Returns [] when none — callers keep their existing static markup as fallback.
 */
export async function getSectionsForRender(
  pageSlug: string,
): Promise<RenderSection[]> {
  let preview = false;
  try {
    preview = (await draftMode()).isEnabled;
  } catch {
    preview = false;
  }

  if (!isSupabaseServiceConfigured) return [];

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("page_sections")
      .select(SELECT)
      .eq("page_slug", pageSlug)
      .order("sort_order", { ascending: true });

    const rows = ((data as Record<string, unknown>[] | null) ?? []).map(coerceRow);
    const visible = rows.filter((row) =>
      preview ? row.draft_enabled : row.status === "published" && row.enabled,
    );
    return visible.map((row) => resolveForRender(row, preview));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Lazy seed
// ---------------------------------------------------------------------------

export async function ensureSectionsSeeded(pageSlug: string): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const seeds = seedsForPage(pageSlug);
  if (seeds.length === 0) return 0;

  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("page_sections")
    .select("section_key")
    .eq("page_slug", pageSlug);
  const existing = new Set(
    ((data as { section_key: string }[] | null) ?? []).map((r) => r.section_key),
  );

  const toInsert = seeds
    .filter((s) => !existing.has(s.section_key))
    .map((s) => ({
      page_slug: s.page_slug,
      section_key: s.section_key,
      kind: s.kind,
      sort_order: s.sort_order,
      status: "published" as const,
      enabled: true,
      draft_enabled: true,
      locked: s.locked ?? false,
      image: s.image,
      image_alt: s.image_alt,
      image_focus: s.image_focus,
      text_align: s.text_align,
      eyebrow: s.eyebrow,
      title: s.title,
      subtitle: s.subtitle,
      body: s.body,
      buttons: s.buttons,
      settings: s.settings ?? {},
      // Seed drafts equal to published so nothing reads "unpublished" on day one.
      draft_image: s.image,
      draft_image_alt: s.image_alt,
      draft_image_focus: s.image_focus,
      draft_text_align: s.text_align,
      draft_eyebrow: s.eyebrow,
      draft_title: s.title,
      draft_subtitle: s.subtitle,
      draft_body: s.body,
      draft_buttons: s.buttons,
      draft_settings: s.settings ?? {},
    }));

  if (toInsert.length === 0) return 0;
  const { error } = await admin.from("page_sections").insert(toInsert);
  if (error) throw new Error(error.message);
  return toInsert.length;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type SectionDraftInput = {
  image?: string | null;
  image_alt?: string | null;
  image_focus?: SectionImageFocus;
  text_align?: SectionTextAlign;
  eyebrow?: string | null;
  title?: string | null;
  subtitle?: string | null;
  body?: string | null;
  buttons?: SectionButton[];
  settings?: Record<string, unknown>;
  draft_enabled?: boolean;
};

/** Create a new (draft) section at the end, respecting the page's cap. */
export async function createSection(
  pageSlug: string,
  editorId: string | null,
): Promise<{ id: string } | { error: string }> {
  const admin = createSupabaseAdminClient();
  const cap = sectionCapFor(pageSlug);

  const { count } = await admin
    .from("page_sections")
    .select("id", { count: "exact", head: true })
    .eq("page_slug", pageSlug);
  if ((count ?? 0) >= cap) {
    return {
      error: `You can have up to ${cap} sections on this page. Delete one before adding another.`,
    };
  }

  const { data: maxRow } = await admin
    .from("page_sections")
    .select("sort_order")
    .eq("page_slug", pageSlug)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;
  const sectionKey = `${pageSlug}.section-${Date.now().toString(36)}`;

  const { data, error } = await admin
    .from("page_sections")
    .insert({
      page_slug: pageSlug,
      section_key: sectionKey,
      kind: "banner",
      sort_order: nextOrder,
      status: "draft",
      enabled: false,
      draft_enabled: true,
      locked: false,
      image_focus: "center",
      text_align: "left",
      draft_image_focus: "center",
      draft_text_align: "left",
      draft_title: "New section",
      draft_subtitle: "Add your headline, copy, image and buttons, then publish.",
      buttons: [],
      draft_buttons: [],
      settings: {},
      draft_settings: {},
      last_edited_by: editorId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}

/** Save the DRAFT values of a section (never touches the live section). */
export async function saveSectionDraft(
  id: string,
  input: SectionDraftInput,
  editorId: string | null,
): Promise<{ error?: string }> {
  const section = await getSection(id);
  if (!section) return { error: "That section no longer exists." };
  if (section.locked) return { error: "This section is locked and cannot be edited." };

  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { last_edited_by: editorId };
  if (input.image !== undefined) patch.draft_image = input.image;
  if (input.image_alt !== undefined) patch.draft_image_alt = input.image_alt;
  if (input.image_focus !== undefined) patch.draft_image_focus = input.image_focus;
  if (input.text_align !== undefined) patch.draft_text_align = input.text_align;
  if (input.eyebrow !== undefined) patch.draft_eyebrow = input.eyebrow;
  if (input.title !== undefined) patch.draft_title = input.title;
  if (input.subtitle !== undefined) patch.draft_subtitle = input.subtitle;
  if (input.body !== undefined) patch.draft_body = input.body;
  if (input.buttons !== undefined) patch.draft_buttons = input.buttons;
  if (input.settings !== undefined) patch.draft_settings = input.settings;
  if (input.draft_enabled !== undefined) patch.draft_enabled = input.draft_enabled;

  const { error } = await admin.from("page_sections").update(patch).eq("id", id);
  if (error) return { error: error.message };
  return {};
}

/** Publish a section: copy draft_* → published columns, set status=published. */
export async function publishSection(
  id: string,
  publisherId: string | null,
): Promise<{ error?: string }> {
  const section = await getSection(id);
  if (!section) return { error: "That section no longer exists." };
  if (section.locked) return { error: "This section is locked." };

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("page_sections")
    .update({
      status: "published",
      image: section.draft_image ?? section.image,
      image_alt: section.draft_image_alt ?? section.image_alt,
      image_focus: section.draft_image_focus ?? section.image_focus,
      text_align: section.draft_text_align ?? section.text_align,
      eyebrow: section.draft_eyebrow ?? section.eyebrow,
      title: section.draft_title ?? section.title,
      subtitle: section.draft_subtitle ?? section.subtitle,
      body: section.draft_body ?? section.body,
      buttons: section.draft_buttons ?? section.buttons ?? [],
      settings: section.draft_settings ?? section.settings ?? {},
      enabled: section.draft_enabled,
      last_published_by: publisherId,
      published_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return {};
}

/** Delete a section (locked sections cannot be deleted). */
export async function deleteSection(id: string): Promise<{ error?: string }> {
  const section = await getSection(id);
  if (!section) return {};
  if (section.locked) return { error: "This section is locked and cannot be deleted." };
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("page_sections").delete().eq("id", id);
  if (error) return { error: error.message };
  return {};
}

/** Move a section up/down by swapping sort_order with its neighbour. */
export async function moveSection(
  id: string,
  direction: "up" | "down",
): Promise<void> {
  const section = await getSection(id);
  if (!section) return;
  const admin = createSupabaseAdminClient();
  const list = await listSections(section.page_slug);
  const index = list.findIndex((s) => s.id === id);
  if (index < 0) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= list.length) return;

  const a = list[index];
  const b = list[targetIndex];
  await admin.from("page_sections").update({ sort_order: b.sort_order }).eq("id", a.id);
  await admin.from("page_sections").update({ sort_order: a.sort_order }).eq("id", b.id);
}
