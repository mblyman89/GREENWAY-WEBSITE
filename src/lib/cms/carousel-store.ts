/**
 * src/lib/cms/carousel-store.ts
 *
 * Server-side service for the staff-managed home hero carousel
 * (table public.home_carousel_slides, migration 0011).
 *
 * Lifecycle mirrors content_blocks: each slide has published_* columns (what the
 * public sees) and draft_* columns (what the editor is staging). Saving a draft
 * never touches the live slide; publishing copies draft → published.
 *
 * Public reads return ENABLED + PUBLISHED slides, draft-aware in Draft Mode, and
 * fall back to CAROUSEL_FALLBACK_SLIDES if the table is empty / Supabase isn't
 * configured — so the homepage hero never renders blank.
 */
import "server-only";
import { draftMode } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  type CarouselSlideRow,
  type RenderSlide,
  type SlideAdminVM,
  type SlideCta,
  type SlideImageFocus,
  type SlideTextAlign,
  MAX_CAROUSEL_SLIDES,
} from "./carousel-types";
import { CAROUSEL_SEEDS, CAROUSEL_FALLBACK_SLIDES } from "./carousel-seed";
import { getBlurMap } from "@/lib/media/blur-server";
import { blurFor } from "@/lib/media/blur-placeholder-core";
import {
  isClassicEquivalent,
  isHomeSlideLiveAt,
  normalizeHomeSlideAdvanced,
  serializeHomeSlideAdvanced,
} from "./home-slide-advanced-core";

/**
 * R47: true when a write failed only because migration 0268 (the advanced /
 * draft_advanced columns) has not been applied yet. The caller then retries
 * without those keys so the classic fields still save.
 */
function isMissingAdvancedColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const m = (error.message ?? "").toLowerCase();
  return m.includes("advanced") && (m.includes("column") || m.includes("schema cache") || error.code === "PGRST204" || error.code === "42703");
}

const SELECT = "*";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeCtas(value: unknown): SlideCta[] {
  if (!Array.isArray(value)) return [];
  const out: SlideCta[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const href = typeof r.href === "string" ? r.href.trim() : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!href || !label) continue;
    const variant: SlideCta["variant"] =
      r.variant === "outline" ? "outline" : "solid";
    out.push({ href, label, variant });
    if (out.length >= 2) break; // max 2 CTAs per slide
  }
  return out;
}

function coerceRow(raw: Record<string, unknown>): CarouselSlideRow {
  return {
    ...(raw as unknown as CarouselSlideRow),
    ctas: normalizeCtas(raw.ctas),
    draft_ctas:
      raw.draft_ctas == null ? null : normalizeCtas(raw.draft_ctas),
  };
}

/** Has this slide's draft diverged from its published state? */
function isDirty(row: CarouselSlideRow): boolean {
  const fields: Array<keyof CarouselSlideRow> = [
    "image",
    "image_alt",
    "image_focus",
    "text_align",
    "eyebrow",
    "title",
    "description",
  ];
  for (const f of fields) {
    const draftKey = `draft_${f}` as keyof CarouselSlideRow;
    const draftVal = row[draftKey];
    if (draftVal != null && draftVal !== row[f]) return true;
  }
  if (row.draft_ctas != null) {
    if (JSON.stringify(row.draft_ctas) !== JSON.stringify(row.ctas ?? []))
      return true;
  }
  if (row.draft_enabled !== row.enabled) return true;
  // R47: advanced options (only when a draft copy exists).
  // The draft copy is the truth (null = classic slide), so compare whenever
  // the 0268 columns exist.
  if (row.draft_advanced !== undefined) {
    const d = serializeHomeSlideAdvanced(normalizeHomeSlideAdvanced(row.draft_advanced));
    const p = serializeHomeSlideAdvanced(normalizeHomeSlideAdvanced(row.advanced ?? null));
    if (d !== p) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export async function listCarouselSlides(): Promise<SlideAdminVM[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("home_carousel_slides")
    .select(SELECT)
    .order("sort_order", { ascending: true });
  const rows = ((data as Record<string, unknown>[] | null) ?? []).map(coerceRow);
  return rows.map((row) => ({ ...row, dirty: isDirty(row) }));
}

export async function getCarouselSlide(
  id: string,
): Promise<CarouselSlideRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("home_carousel_slides")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();
  return data ? coerceRow(data as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// Public render resolution (draft-aware, with fallback)
// ---------------------------------------------------------------------------

function resolveForRender(row: CarouselSlideRow, preview: boolean): RenderSlide {
  const pick = <T,>(draft: T | null | undefined, published: T): T =>
    preview && draft != null ? draft : published;

  return {
    key: row.slide_key,
    id: row.id,
    image: pick(row.draft_image, row.image ?? "") || "",
    imageAlt: pick(row.draft_image_alt, row.image_alt ?? "") || "",
    imageFocus: (pick(row.draft_image_focus, row.image_focus) ??
      "right") as SlideImageFocus,
    textAlign: (pick(row.draft_text_align, row.text_align) ??
      "left") as SlideTextAlign,
    eyebrow: pick(row.draft_eyebrow, row.eyebrow ?? "") || "",
    title: pick(row.draft_title, row.title ?? "") || "",
    description: pick(row.draft_description, row.description ?? "") || "",
    ctas: pick(row.draft_ctas, row.ctas ?? []) ?? [],
    // R47: draft-aware advanced options (null = classic slide).
    advanced: normalizeHomeSlideAdvanced(
      preview && row.draft_advanced !== undefined ? row.draft_advanced : (row.advanced ?? null),
    ),
  };
}

/**
 * Resolve the slides to show on the PUBLIC homepage hero.
 * - Draft Mode (staff preview): include draft-enabled slides and show draft values.
 * - Normally: published + enabled slides only.
 * - Empty / unconfigured: fall back to the seed slides so the hero never blanks.
 * Capped to MAX_CAROUSEL_SLIDES.
 */
export async function getCarouselForRender(): Promise<RenderSlide[]> {
  let preview = false;
  try {
    preview = (await draftMode()).isEnabled;
  } catch {
    preview = false;
  }

  if (!isSupabaseServiceConfigured) return CAROUSEL_FALLBACK_SLIDES;

  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("home_carousel_slides")
      .select(SELECT)
      .order("sort_order", { ascending: true });

    const rows = ((data as Record<string, unknown>[] | null) ?? []).map(
      coerceRow,
    );
    if (rows.length === 0) return CAROUSEL_FALLBACK_SLIDES;

    const visible = rows.filter((row) => {
      if (preview) {
        // In preview, show slides the staff has enabled in their draft.
        return row.draft_enabled;
      }
      return row.status === "published" && row.enabled;
    });

    const now = Date.now();
    const resolved = visible
      .map((row) => resolveForRender(row, preview))
      // R47: the optional Start / End window (outside it the slide is hidden;
      // staff preview shows it anyway so it can be checked before it starts).
      .filter((s) => preview || isHomeSlideLiveAt(s.advanced, now))
      // A slide with no image AND no text is not worth rendering.
      .filter((s) => s.image || s.title || s.eyebrow || s.description);

    if (resolved.length === 0) return CAROUSEL_FALLBACK_SLIDES;
    const shown = resolved.slice(0, MAX_CAROUSEL_SLIDES);
    // R45-S2: attach blur previews (one query; empty map on any problem).
    const blurs = await getBlurMap([
      ...shown.map((s) => s.image),
      ...shown.map((s) => s.advanced?.imageMobile ?? "").filter(Boolean),
    ]);
    return shown.map((s) => {
      const imageBlur = blurFor(s.image, blurs);
      const imageMobileBlur = s.advanced?.imageMobile ? blurFor(s.advanced.imageMobile, blurs) : undefined;
      return {
        ...s,
        ...(imageBlur ? { imageBlur } : {}),
        ...(imageMobileBlur ? { imageMobileBlur } : {}),
      };
    });
  } catch {
    return CAROUSEL_FALLBACK_SLIDES;
  }
}

// ---------------------------------------------------------------------------
// Lazy seed (mirrors ensureContentBlocksSeeded)
// ---------------------------------------------------------------------------

export async function ensureCarouselSeeded(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("home_carousel_slides")
    .select("slide_key");
  const existing = new Set(
    ((data as { slide_key: string }[] | null) ?? []).map((r) => r.slide_key),
  );
  const toInsert = CAROUSEL_SEEDS.filter(
    (s) => !existing.has(s.slide_key),
  ).map((s) => ({
    slide_key: s.slide_key,
    sort_order: s.sort_order,
    status: "published" as const,
    enabled: true,
    draft_enabled: true,
    image: s.image,
    image_alt: s.image_alt,
    image_focus: s.image_focus,
    text_align: s.text_align,
    eyebrow: s.eyebrow,
    title: s.title,
    description: s.description,
    ctas: s.ctas,
    // Seed drafts equal to published so nothing shows "unpublished" on day one.
    draft_image: s.image,
    draft_image_alt: s.image_alt,
    draft_image_focus: s.image_focus,
    draft_text_align: s.text_align,
    draft_eyebrow: s.eyebrow,
    draft_title: s.title,
    draft_description: s.description,
    draft_ctas: s.ctas,
  }));
  if (toInsert.length === 0) return 0;
  const { error } = await admin.from("home_carousel_slides").insert(toInsert);
  if (error) throw new Error(error.message);
  return toInsert.length;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type SlideDraftInput = {
  image?: string | null;
  image_alt?: string | null;
  image_focus?: SlideImageFocus;
  text_align?: SlideTextAlign;
  eyebrow?: string | null;
  title?: string | null;
  description?: string | null;
  ctas?: SlideCta[];
  draft_enabled?: boolean;
  /** R47: serialized advanced JSON (null clears it = classic slide). */
  advanced?: string | null;
};

/** Create a brand-new slide (draft-enabled, status=draft) at the end. */
export async function createCarouselSlide(
  editorId: string | null,
): Promise<{ id: string } | { error: string }> {
  const admin = createSupabaseAdminClient();

  const { count } = await admin
    .from("home_carousel_slides")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_CAROUSEL_SLIDES) {
    return {
      error: `You can have up to ${MAX_CAROUSEL_SLIDES} slides. Delete one before adding another.`,
    };
  }

  // Next sort_order + a unique slide_key.
  const { data: maxRow } = await admin
    .from("home_carousel_slides")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;
  const slideKey = `slide-${Date.now().toString(36)}`;

  const { data, error } = await admin
    .from("home_carousel_slides")
    .insert({
      slide_key: slideKey,
      sort_order: nextOrder,
      status: "draft",
      enabled: false,
      draft_enabled: true,
      image_focus: "right",
      text_align: "left",
      draft_image_focus: "right",
      draft_text_align: "left",
      draft_title: "New slide",
      draft_description: "Add your headline and copy, then publish.",
      ctas: [],
      draft_ctas: [],
      last_edited_by: editorId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}

/** Save the DRAFT values of a slide (never touches the live slide). */
export async function saveCarouselDraft(
  id: string,
  input: SlideDraftInput,
  editorId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = { last_edited_by: editorId };
  if (input.image !== undefined) patch.draft_image = input.image;
  if (input.image_alt !== undefined) patch.draft_image_alt = input.image_alt;
  if (input.image_focus !== undefined) patch.draft_image_focus = input.image_focus;
  if (input.text_align !== undefined) patch.draft_text_align = input.text_align;
  if (input.eyebrow !== undefined) patch.draft_eyebrow = input.eyebrow;
  if (input.title !== undefined) patch.draft_title = input.title;
  if (input.description !== undefined) patch.draft_description = input.description;
  if (input.ctas !== undefined) patch.draft_ctas = input.ctas;
  if (input.draft_enabled !== undefined) patch.draft_enabled = input.draft_enabled;
  if (input.advanced !== undefined) {
    patch.draft_advanced = input.advanced ? JSON.parse(input.advanced) : null;
  }

  let { error } = await admin
    .from("home_carousel_slides")
    .update(patch)
    .eq("id", id);
  if (error && "draft_advanced" in patch && isMissingAdvancedColumn(error)) {
    // Migration 0268 not applied yet: save the classic fields anyway.
    delete patch.draft_advanced;
    ({ error } = await admin.from("home_carousel_slides").update(patch).eq("id", id));
    if (!error && !isClassicEquivalent(normalizeHomeSlideAdvanced(input.advanced ?? null))) {
      throw new Error(
        "Saved the words and pictures, but the advanced options need database update 0268 (ask your developer / apply it in Supabase).",
      );
    }
  }
  if (error) throw new Error(error.message);
}

/** Publish a slide: copy draft_* → published columns, set status=published. */
export async function publishCarouselSlide(
  id: string,
  publisherId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const slide = await getCarouselSlide(id);
  if (!slide) throw new Error("That slide no longer exists.");

  const update: Record<string, unknown> = {
      status: "published",
      image: slide.draft_image ?? slide.image,
      image_alt: slide.draft_image_alt ?? slide.image_alt,
      image_focus: slide.draft_image_focus ?? slide.image_focus,
      text_align: slide.draft_text_align ?? slide.text_align,
      eyebrow: slide.draft_eyebrow ?? slide.eyebrow,
      title: slide.draft_title ?? slide.title,
      description: slide.draft_description ?? slide.description,
      ctas: slide.draft_ctas ?? slide.ctas ?? [],
      enabled: slide.draft_enabled,
      last_published_by: publisherId,
      published_at: new Date().toISOString(),
  };
  // R47: copy the advanced options only when the column exists (0268).
  if (slide.draft_advanced !== undefined || slide.advanced !== undefined) {
    // The draft is the truth: null there means "back to the classic slide".
    update.advanced = slide.draft_advanced ?? null;
  }
  const { error } = await admin
    .from("home_carousel_slides")
    .update(update)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Delete a slide outright. */
export async function deleteCarouselSlide(id: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("home_carousel_slides")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Move a slide up or down by swapping sort_order with its neighbour. */
export async function moveCarouselSlide(
  id: string,
  direction: "up" | "down",
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const slides = await listCarouselSlides();
  const index = slides.findIndex((s) => s.id === id);
  if (index < 0) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= slides.length) return;

  const a = slides[index];
  const b = slides[targetIndex];
  // Swap sort_order values.
  await admin
    .from("home_carousel_slides")
    .update({ sort_order: b.sort_order })
    .eq("id", a.id);
  await admin
    .from("home_carousel_slides")
    .update({ sort_order: a.sort_order })
    .eq("id", b.id);
}
