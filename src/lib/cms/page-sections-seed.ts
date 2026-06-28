/**
 * src/lib/cms/page-sections-seed.ts
 *
 * Faithful seeds of the CURRENT editable banners/sections on each page, so when
 * page_sections (migration 0013) is first populated the public site looks
 * identical to today. Each page's existing banner copy/images are reproduced
 * here. New sections an editor adds go on top of these.
 *
 * NOTE: the homepage "daily special highlights" top section is intentionally NOT
 * seeded here — it stays a locked, non-editable section rendered by
 * <HomeDailyDeals> directly. Only the editable sections below it live in the DB.
 */
import type {
  SectionButton,
  SectionImageFocus,
  SectionKind,
  SectionTextAlign,
} from "./page-sections-types";

export type SectionSeed = {
  page_slug: string;
  section_key: string;
  kind: SectionKind;
  sort_order: number;
  locked?: boolean;
  image: string | null;
  image_alt: string | null;
  image_focus: SectionImageFocus;
  text_align: SectionTextAlign;
  eyebrow: string | null;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  buttons: SectionButton[];
  settings?: Record<string, unknown>;
};

/**
 * Home page editable sections (the two promo banners below the locked daily-deal
 * highlights). Values mirror the home.category.* / home.brand.* content blocks
 * so the rendered banners are unchanged on first publish.
 */
export const PAGE_SECTION_SEEDS: SectionSeed[] = [
  {
    page_slug: "home",
    section_key: "home.category",
    kind: "banner",
    sort_order: 0,
    image: "/home/category-banner.webp",
    image_alt: "Shop Greenway by product category",
    image_focus: "center",
    text_align: "left",
    eyebrow: "Find your vibe",
    title: "Shop by Category",
    subtitle: "Flower, prerolls, vapes, edibles, concentrates & more — all in one place.",
    body: null,
    buttons: [
      { label: "Browse the menu", href: "/menu", variant: "solid", enabled: true },
    ],
    settings: { lanes: "category" },
  },
  {
    page_slug: "home",
    section_key: "home.brand",
    kind: "banner",
    sort_order: 1,
    image: "/home/brand-banner.webp",
    image_alt: "Shop Greenway by brand",
    image_focus: "center",
    text_align: "left",
    eyebrow: "Trusted growers",
    title: "Shop by Brand",
    subtitle: "Explore the Washington brands we proudly carry.",
    body: null,
    buttons: [
      { label: "See all brands", href: "/vendor-delivery", variant: "outline", enabled: true },
    ],
    settings: { lanes: "brand" },
  },
];

/** Seeds for a given page slug. */
export function seedsForPage(pageSlug: string): SectionSeed[] {
  return PAGE_SECTION_SEEDS.filter((s) => s.page_slug === pageSlug);
}
