/**
 * src/lib/cms/carousel-seed.ts
 *
 * The three slides that previously lived hardcoded in Hero.tsx. Used to:
 *   1. lazily populate home_carousel_slides on first visit to the manager
 *      (ensureCarouselSeeded), and
 *   2. provide a safe fallback for the public hero when the table is empty /
 *      Supabase isn't configured yet — so the homepage never renders blank.
 *
 * Keep these in sync with the brand. Images are textless background art under
 * /public/home/ so the editor's text layer stays crisp + editable.
 */
import type { SlideCta, SlideImageFocus, SlideTextAlign } from "./carousel-types";

export type CarouselSeed = {
  slide_key: string;
  sort_order: number;
  image: string;
  image_alt: string;
  image_focus: SlideImageFocus;
  text_align: SlideTextAlign;
  eyebrow: string;
  title: string;
  description: string;
  ctas: SlideCta[];
};

export const CAROUSEL_SEEDS: CarouselSeed[] = [
  {
    slide_key: "welcome",
    sort_order: 0,
    image: "/home/hero-banner.webp",
    image_alt: "Greenway Marijuana premium cannabis selection",
    image_focus: "right",
    text_align: "left",
    eyebrow: "Greenway Marijuana",
    title: "Premium Cannabis, Everyday Deals",
    description:
      "Fresh daily discounts, top brands, and the full menu — all in one place.",
    ctas: [
      { href: "/menu", label: "Shop the Menu", variant: "solid" },
      { href: "/specials", label: "Today's Specials", variant: "outline" },
    ],
  },
  {
    slide_key: "daily-deal",
    sort_order: 1,
    image: "/home/hero-dailydeal.webp",
    image_alt: "Today's featured cannabis daily deal at Greenway Marijuana",
    image_focus: "left",
    text_align: "right",
    eyebrow: "Deal of the Day",
    title: "A New Daily Deal, Every Day",
    description:
      "From Munchie Monday to Ounce Friday — rotating discounts on the categories you love.",
    ctas: [
      { href: "/specials", label: "See Today's Deal", variant: "solid" },
      { href: "/menu", label: "Browse the Menu", variant: "outline" },
    ],
  },
  {
    slide_key: "car-show",
    sort_order: 2,
    image: "/home/hero-carshow.webp",
    image_alt: "Greenway Summer Car Show event banner",
    image_focus: "right",
    text_align: "left",
    eyebrow: "Special Event · July 25, 2026",
    title: "Greenway Summer Car Show",
    description:
      "Classic rides, food, and community — join us July 25th, 2026 for a free day of horsepower and good vibes.",
    ctas: [
      { href: "/blog", label: "Event Details", variant: "solid" },
      { href: "/locations", label: "Get Directions", variant: "outline" },
    ],
  },
];

/** The seeds resolved to public RenderSlide shape (used as the empty fallback). */
export const CAROUSEL_FALLBACK_SLIDES = CAROUSEL_SEEDS.map((s) => ({
  key: s.slide_key,
  image: s.image,
  imageAlt: s.image_alt,
  imageFocus: s.image_focus,
  textAlign: s.text_align,
  eyebrow: s.eyebrow,
  title: s.title,
  description: s.description,
  ctas: s.ctas,
}));
