/**
 * src/lib/cms/shop-carousel-store.ts
 *
 * SLICE A (SHOP-1) — server-side service for the staff-managed Shop (/menu)
 * top-banner carousel (table public.shop_carousel_slides, migration 0148).
 *
 * Lifecycle mirrors the home carousel + content_blocks: each slide has a
 * published `presentation` (what the public sees) and a `draft_presentation`
 * (what the editor is staging). Saving a draft never touches the live slide;
 * publishing copies draft → published.
 *
 * Public reads return ENABLED + PUBLISHED slides, draft-aware in Draft Mode, and
 * fall back to SHOP_CAROUSEL_FALLBACK_SLIDES if the table is empty / missing /
 * Supabase isn't configured — so the Shop banner NEVER renders blank and the
 * page stays effectively identical to the old static banner until staff edit +
 * publish. This is what keeps the code WORKING PRE-MIGRATION (a missing table
 * throws inside the try and we return the fallback).
 */
import "server-only";
import { draftMode } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  type ShopHeroPresentation,
  MAX_SHOP_CAROUSEL_SLIDES,
  defaultShopHeroPresentation,
  normalizeShopHeroPresentation,
  serializeShopHeroPresentation,
  slideHasContent,
} from "./shop-carousel-core";
import {
  type ShopCarouselSlideRow,
  type ShopRenderSlide,
  type ShopSlideAdminVM,
} from "./shop-carousel-types";
import { SHOP_CAROUSEL_SEEDS, SHOP_CAROUSEL_FALLBACK_SLIDES } from "./shop-carousel-seed";

const SELECT = "*";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** jsonb may come back as an object OR a JSON string depending on the driver. */
function coercePresentation(value: unknown): ShopHeroPresentation {
  if (value == null) return defaultShopHeroPresentation();
  if (typeof value === "string") {
    try {
      return normalizeShopHeroPresentation(JSON.parse(value));
    } catch {
      return defaultShopHeroPresentation();
    }
  }
  return normalizeShopHeroPresentation(value);
}

function coerceDraft(value: unknown): ShopHeroPresentation | null {
  if (value == null) return null;
  return coercePresentation(value);
}

function coerceRow(raw: Record<string, unknown>): ShopCarouselSlideRow {
  return {
    ...(raw as unknown as ShopCarouselSlideRow),
    presentation: coercePresentation(raw.presentation),
    draft_presentation: coerceDraft(raw.draft_presentation),
  };
}

/** Has this slide's draft diverged from its published state? */
function isDirty(row: ShopCarouselSlideRow): boolean {
  if (row.draft_enabled !== row.enabled) return true;
  if (row.draft_presentation == null) return false;
  return (
    serializeShopHeroPresentation(row.draft_presentation) !==
    serializeShopHeroPresentation(row.presentation)
  );
}

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

export async function listShopCarouselSlides(): Promise<ShopSlideAdminVM[]> {
  if (!isSupabaseServiceConfigured) return [];
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("shop_carousel_slides")
      .select(SELECT)
      .order("sort_order", { ascending: true });
    const rows = ((data as Record<string, unknown>[] | null) ?? []).map(coerceRow);
    return rows.map((row) => ({ ...row, dirty: isDirty(row) }));
  } catch {
    // Table not migrated yet — editor shows an empty list + a seed prompt.
    return [];
  }
}

export async function getShopCarouselSlide(
  id: string,
): Promise<ShopCarouselSlideRow | null> {
  if (!isSupabaseServiceConfigured) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("shop_carousel_slides")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();
    return data ? coerceRow(data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public render resolution (draft-aware, with fallback)
// ---------------------------------------------------------------------------

function resolveForRender(
  row: ShopCarouselSlideRow,
  preview: boolean,
): ShopRenderSlide {
  const pres =
    preview && row.draft_presentation != null
      ? row.draft_presentation
      : row.presentation;
  return { key: row.slide_key, presentation: pres };
}

/**
 * Resolve the slides to show in the PUBLIC Shop banner.
 * - Draft Mode (staff preview): include draft-enabled slides + show draft values.
 * - Normally: published + enabled slides only.
 * - Empty / unconfigured / table-missing: fall back to the seed so it never blanks.
 * Capped to MAX_SHOP_CAROUSEL_SLIDES.
 */
export async function getShopCarouselForRender(): Promise<ShopRenderSlide[]> {
  let preview = false;
  try {
    preview = (await draftMode()).isEnabled;
  } catch {
    preview = false;
  }

  if (!isSupabaseServiceConfigured) return SHOP_CAROUSEL_FALLBACK_SLIDES;

  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("shop_carousel_slides")
      .select(SELECT)
      .order("sort_order", { ascending: true });

    // A missing table (pre-migration) surfaces as an error — fall back safely.
    if (error) return SHOP_CAROUSEL_FALLBACK_SLIDES;

    const rows = ((data as Record<string, unknown>[] | null) ?? []).map(coerceRow);
    if (rows.length === 0) return SHOP_CAROUSEL_FALLBACK_SLIDES;

    const visible = rows.filter((row) =>
      preview ? row.draft_enabled : row.status === "published" && row.enabled,
    );

    const resolved = visible
      .map((row) => resolveForRender(row, preview))
      .filter((s) => slideHasContent(s.presentation));

    if (resolved.length === 0) return SHOP_CAROUSEL_FALLBACK_SLIDES;
    return resolved.slice(0, MAX_SHOP_CAROUSEL_SLIDES);
  } catch {
    return SHOP_CAROUSEL_FALLBACK_SLIDES;
  }
}

// ---------------------------------------------------------------------------
// Lazy seed (mirrors ensureCarouselSeeded)
// ---------------------------------------------------------------------------

export async function ensureShopCarouselSeeded(): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("shop_carousel_slides")
      .select("slide_key");
    if (error) return 0; // table not migrated yet
    const existing = new Set(
      ((data as { slide_key: string }[] | null) ?? []).map((r) => r.slide_key),
    );
    const toInsert = SHOP_CAROUSEL_SEEDS.filter(
      (s) => !existing.has(s.slide_key),
    ).map((s) => {
      const pres = serializeShopHeroPresentation(s.presentation);
      return {
        slide_key: s.slide_key,
        sort_order: s.sort_order,
        status: "published" as const,
        enabled: true,
        draft_enabled: true,
        presentation: JSON.parse(pres),
        // Seed draft equal to published so nothing shows "unpublished" day one.
        draft_presentation: JSON.parse(pres),
      };
    });
    if (toInsert.length === 0) return 0;
    const { error: insErr } = await admin
      .from("shop_carousel_slides")
      .insert(toInsert);
    if (insErr) return 0;
    return toInsert.length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a brand-new slide (draft-enabled, status=draft) at the end. */
export async function createShopCarouselSlide(
  editorId: string | null,
): Promise<{ id: string } | { error: string }> {
  const admin = createSupabaseAdminClient();

  const { count } = await admin
    .from("shop_carousel_slides")
    .select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_SHOP_CAROUSEL_SLIDES) {
    return {
      error: `You can have up to ${MAX_SHOP_CAROUSEL_SLIDES} slides. Delete one before adding another.`,
    };
  }

  const { data: maxRow } = await admin
    .from("shop_carousel_slides")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxRow as { sort_order: number } | null)?.sort_order ?? -1) + 1;
  const slideKey = `shop-slide-${Date.now().toString(36)}`;

  // A fresh slide starts from the default look so the editor + preview are never
  // blank; staff then style it and publish.
  const pres = JSON.parse(
    serializeShopHeroPresentation(defaultShopHeroPresentation()),
  );

  const { data, error } = await admin
    .from("shop_carousel_slides")
    .insert({
      slide_key: slideKey,
      sort_order: nextOrder,
      status: "draft",
      enabled: false,
      draft_enabled: true,
      presentation: pres,
      draft_presentation: pres,
      last_edited_by: editorId,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}

/** Save the DRAFT presentation of a slide (never touches the live slide). */
export async function saveShopCarouselDraft(
  id: string,
  presentation: ShopHeroPresentation,
  draftEnabled: boolean | undefined,
  editorId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const patch: Record<string, unknown> = {
    last_edited_by: editorId,
    draft_presentation: JSON.parse(serializeShopHeroPresentation(presentation)),
  };
  if (draftEnabled !== undefined) patch.draft_enabled = draftEnabled;

  const { error } = await admin
    .from("shop_carousel_slides")
    .update(patch)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Publish a slide: copy draft_presentation → presentation, set status=published. */
export async function publishShopCarouselSlide(
  id: string,
  publisherId: string | null,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const slide = await getShopCarouselSlide(id);
  if (!slide) throw new Error("That slide no longer exists.");

  const nextPres = slide.draft_presentation ?? slide.presentation;
  const { error } = await admin
    .from("shop_carousel_slides")
    .update({
      status: "published",
      presentation: JSON.parse(serializeShopHeroPresentation(nextPres)),
      enabled: slide.draft_enabled,
      last_published_by: publisherId,
      published_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Delete a slide outright. */
export async function deleteShopCarouselSlide(id: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("shop_carousel_slides")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Move a slide up or down by swapping sort_order with its neighbour. */
export async function moveShopCarouselSlide(
  id: string,
  direction: "up" | "down",
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const slides = await listShopCarouselSlides();
  const index = slides.findIndex((s) => s.id === id);
  if (index < 0) return;
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= slides.length) return;

  const a = slides[index];
  const b = slides[targetIndex];
  await admin
    .from("shop_carousel_slides")
    .update({ sort_order: b.sort_order })
    .eq("id", a.id);
  await admin
    .from("shop_carousel_slides")
    .update({ sort_order: a.sort_order })
    .eq("id", b.id);
}
