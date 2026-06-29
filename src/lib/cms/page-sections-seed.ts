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

  // --- Specials --------------------------------------------------------------
  // Mirrors the existing specials hero (eyebrow/title/subtitle). The public page
  // keeps its distinct pill-eyebrow styling for this PRIMARY hero; the builder
  // controls its copy + lets staff add extra banners below it.
  {
    page_slug: "specials",
    section_key: "specials.hero",
    kind: "banner",
    sort_order: 0,
    image: "/home/hero-banner.webp",
    image_alt: "Greenway Marijuana cannabis specials and daily deals",
    image_focus: "right",
    text_align: "left",
    eyebrow: "Deals every day",
    title: "Cannabis Specials",
    subtitle:
      "Check out our latest deals and save on premium cannabis products. New specials added regularly.",
    body: null,
    buttons: [],
  },

  // --- Vendors --------------------------------------------------------------
  // The two banners on /vendor-delivery were previously HARDCODED. Seeded here
  // faithfully so they become editable for the first time (exact current copy).
  {
    page_slug: "vendors",
    section_key: "vendors.grow",
    kind: "banner",
    sort_order: 0,
    image: "/vendors/vendor-hero.png",
    image_alt:
      "Premium cannabis products against a Pacific Northwest forest backdrop",
    image_focus: "right",
    text_align: "left",
    eyebrow: "Vendors & Partners",
    title: "Grow With Greenway",
    subtitle:
      "We partner with licensed Washington producers and processors who share our commitment to quality, consistency, and craft.",
    body: null,
    buttons: [],
    settings: { titleClassName: "text-[var(--orange)]" },
  },
  {
    page_slug: "vendors",
    section_key: "vendors.brands",
    kind: "banner",
    sort_order: 1,
    image: "/vendors/vendor-section-banner.png",
    image_alt: "A grid of partner cannabis brand emblems",
    image_focus: "right",
    text_align: "left",
    eyebrow: "Our Partners",
    title: "Brands We Carry",
    subtitle: "The producers and processors stocking Greenway shelves today.",
    body: null,
    buttons: [],
  },

  // --- Menu -----------------------------------------------------------------
  // Mirrors menu.hero.* content blocks. Public page keeps its bespoke decorated
  // hero band for the PRIMARY hero; builder controls copy + extra banners.
  {
    page_slug: "menu",
    section_key: "menu.hero",
    kind: "banner",
    sort_order: 0,
    image: "/home/category-banner.webp",
    image_alt: "Shop the full Greenway Marijuana cannabis menu",
    image_focus: "right",
    text_align: "left",
    eyebrow: null,
    title: "Shop the Menu",
    subtitle: "Flower, prerolls, vapes, edibles, concentrates & more.",
    body: null,
    buttons: [],
  },

  // --- Loyalty --------------------------------------------------------------
  // Mirrors loyalty.hero.* content blocks. Image-led hero; public page keeps its
  // distinct full-width image hero for the PRIMARY hero.
  {
    page_slug: "loyalty",
    section_key: "loyalty.hero",
    kind: "banner",
    sort_order: 0,
    image: "/brand/greenway-loyalty-points-hero-desktop.png",
    image_alt: "Greenway Marijuana loyalty rewards",
    image_focus: "center",
    text_align: "left",
    eyebrow: null,
    title: "Signup to get offers and discounts from Greenway Marijuana",
    subtitle: "Get updates on our promotions tailored to you.",
    body: null,
    buttons: [],
  },
];

/** Seeds for a given page slug. */
export function seedsForPage(pageSlug: string): SectionSeed[] {
  return PAGE_SECTION_SEEDS.filter((s) => s.page_slug === pageSlug);
}
