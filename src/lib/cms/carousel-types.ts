/**
 * src/lib/cms/carousel-types.ts
 *
 * Shared types for the staff-managed home hero carousel (migration 0011,
 * table public.home_carousel_slides). Mirrors the migration columns. Each
 * slide carries its own published + draft copy/image so it can be edited and
 * previewed before going live, exactly like content_blocks.
 */
import type { PostStatus } from "./types";

/** Maximum number of slides shown publicly + the editor's add cap. */
export const MAX_CAROUSEL_SLIDES = 6;

export type SlideImageFocus = "left" | "center" | "right";
export type SlideTextAlign = "left" | "right";
export type CtaVariant = "solid" | "outline";

export type SlideCta = {
  href: string;
  label: string;
  variant: CtaVariant;
};

/** Raw row shape from Supabase (snake_case, nullable like the DB). */
export type CarouselSlideRow = {
  id: string;
  slide_key: string;
  sort_order: number;
  status: PostStatus;
  enabled: boolean;
  draft_enabled: boolean;

  image: string | null;
  image_alt: string | null;
  image_focus: SlideImageFocus;
  text_align: SlideTextAlign;
  eyebrow: string | null;
  title: string | null;
  description: string | null;
  ctas: SlideCta[] | null;

  draft_image: string | null;
  draft_image_alt: string | null;
  draft_image_focus: SlideImageFocus | null;
  draft_text_align: SlideTextAlign | null;
  draft_eyebrow: string | null;
  draft_title: string | null;
  draft_description: string | null;
  draft_ctas: SlideCta[] | null;

  image_media_id: string | null;
  last_edited_by: string | null;
  last_published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * A resolved slide ready for rendering (draft-aware: in preview it reflects the
 * draft_* values, otherwise the published ones). All fields non-null with
 * sensible fallbacks.
 */
export type RenderSlide = {
  key: string;
  image: string;
  imageAlt: string;
  imageFocus: SlideImageFocus;
  textAlign: SlideTextAlign;
  eyebrow: string;
  title: string;
  description: string;
  ctas: SlideCta[];
};

/**
 * Editor-facing view of a slide: the raw row plus a `dirty` flag (draft differs
 * from published) computed server-side so the UI can badge it.
 */
export type SlideAdminVM = CarouselSlideRow & {
  dirty: boolean;
};
