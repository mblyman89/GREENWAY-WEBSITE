/**
 * src/lib/cms/shop-carousel-types.ts
 *
 * SLICE A (SHOP-1) — shared types for the staff-managed Shop (/menu) top-banner
 * carousel (migration 0148, table public.shop_carousel_slides). Mirrors the
 * migration columns. Unlike the home carousel (which spreads the slide's fields
 * across many columns), each Shop slide stores its ENTIRE look as one JSON blob
 * (published `presentation` + `draft_presentation`), shaped by
 * @/lib/cms/shop-carousel-core (ShopHeroPresentation) — so a new knob never
 * needs another migration.
 */
import type { PostStatus } from "./types";
import type { ShopHeroPresentation } from "./shop-carousel-core";

/** Raw row shape from Supabase (snake_case, nullable like the DB). */
export type ShopCarouselSlideRow = {
  id: string;
  slide_key: string;
  sort_order: number;
  status: PostStatus;
  enabled: boolean;
  draft_enabled: boolean;

  /** Published presentation JSON (already parsed to an object by the store). */
  presentation: ShopHeroPresentation;
  /** Draft presentation JSON, or null when never staged. */
  draft_presentation: ShopHeroPresentation | null;

  image_media_id: string | null;
  image_media_id_mobile: string | null;
  last_edited_by: string | null;
  last_published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * A resolved slide ready for rendering (draft-aware: in preview it reflects the
 * draft_presentation, otherwise the published one). Carries a stable key + the
 * fully-normalized presentation.
 */
export type ShopRenderSlide = {
  key: string;
  presentation: ShopHeroPresentation;
};

/**
 * Editor-facing view of a slide: the raw row plus a `dirty` flag (draft differs
 * from published) computed server-side so the UI can badge it.
 */
export type ShopSlideAdminVM = ShopCarouselSlideRow & {
  dirty: boolean;
};
