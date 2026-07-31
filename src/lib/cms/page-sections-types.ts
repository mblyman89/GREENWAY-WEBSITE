/**
 * src/lib/cms/page-sections-types.ts
 *
 * Shared types for the generic per-page "section builder" (migration 0013,
 * table public.page_sections). This generalizes the home carousel pattern so
 * EVERY page (home, menu, loyalty, vendors, faq, about, locations,
 * price-match) can have editable banners/sections: text, image, and
 * add/delete/style call-to-action buttons. Each row carries its own published +
 * draft copy so it can be edited + previewed before going live. (Specials was
 * retired from this builder in SLICE 122 / SET-3 in favor of the dedicated
 * /admin/specials editor; see PAGE_SECTION_CONFIG below.)
 */
import type { PostStatus } from "./types";

export type SectionImageFocus = "center" | "top" | "bottom" | "left" | "right";
export type SectionTextAlign = "left" | "center" | "right";
export type SectionButtonVariant = "solid" | "outline" | "ghost";
export type SectionKind = "banner" | "highlight" | "feature";

/** A single call-to-action button on a section (add/delete/style/label-able). */
export type SectionButton = {
  label: string;
  href: string;
  variant: SectionButtonVariant;
  enabled: boolean;
};

/**
 * Pages that support the section builder + their hard caps (total sections,
 * including any locked sections that the editor shows read-only). Enforced in
 * the store layer.
 */
export const PAGE_SECTION_CONFIG: Record<
  string,
  { label: string; previewPath: string; cap: number }
> = {
  // Home's cap is 5 (not 4) to account for the locked, non-visible "home.settings"
  // config section (SLICE 112) so the owner still has room for up to 4 real banners.
  home: { label: "Home", previewPath: "/", cap: 5 },
  menu: { label: "Menu", previewPath: "/menu", cap: 4 },
  loyalty: { label: "Loyalty", previewPath: "/loyalty", cap: 4 },
  // Specials is retired from the Pages builder (SLICE 122 / SET-3): the dedicated
  // /admin/specials editor now owns the hero image + placement, the weekly deal
  // cards, and the Today's Deal banner (each with live previews). Removing the
  // slug here makes /admin/pages/specials -> notFound so there is one clear place
  // to edit Specials. The specials.hero content copy (eyebrow/title/subtitle) is
  // still seeded + edited via Site Content and read by the editor's graceful
  // fallback, so the public page is unchanged.
  vendors: { label: "Vendors", previewPath: "/vendor-delivery", cap: 4 },
  faq: { label: "FAQ", previewPath: "/faq", cap: 4 },
  about: { label: "About", previewPath: "/about", cap: 4 },
  locations: { label: "Locations", previewPath: "/locations", cap: 4 },
  "price-match": { label: "Price Match", previewPath: "/price-match", cap: 4 },
};

export type PageSlug = keyof typeof PAGE_SECTION_CONFIG;

export function isValidPageSlug(slug: string): slug is PageSlug {
  return Object.prototype.hasOwnProperty.call(PAGE_SECTION_CONFIG, slug);
}

export function sectionCapFor(pageSlug: string): number {
  return PAGE_SECTION_CONFIG[pageSlug]?.cap ?? 4;
}

/** Raw row shape from Supabase (snake_case, nullable like the DB). */
export type PageSectionRow = {
  id: string;
  page_slug: string;
  section_key: string;
  kind: SectionKind;
  sort_order: number;
  status: PostStatus;
  enabled: boolean;
  draft_enabled: boolean;
  locked: boolean;

  image: string | null;
  image_alt: string | null;
  image_focus: SectionImageFocus;
  text_align: SectionTextAlign;
  eyebrow: string | null;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  buttons: SectionButton[] | null;
  settings: Record<string, unknown> | null;

  draft_image: string | null;
  draft_image_alt: string | null;
  draft_image_focus: SectionImageFocus | null;
  draft_text_align: SectionTextAlign | null;
  draft_eyebrow: string | null;
  draft_title: string | null;
  draft_subtitle: string | null;
  draft_body: string | null;
  draft_buttons: SectionButton[] | null;
  draft_settings: Record<string, unknown> | null;

  image_media_id: string | null;
  last_edited_by: string | null;
  last_published_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Resolved section ready for rendering (draft-aware: in preview reflects the
 * draft_* values, otherwise published). All fields non-null with fallbacks.
 */
export type RenderSection = {
  key: string;
  kind: SectionKind;
  image: string;
  imageAlt: string;
  imageFocus: SectionImageFocus;
  textAlign: SectionTextAlign;
  eyebrow: string;
  title: string;
  subtitle: string;
  body: string;
  buttons: SectionButton[];
  settings: Record<string, unknown>;
};

/** Editor-facing view: the raw row plus a `dirty` flag (draft != published). */
export type SectionAdminVM = PageSectionRow & { dirty: boolean };
