/**
 * src/lib/cms/shop-carousel-seed.ts
 *
 * SLICE A (SHOP-1) — the single slide that recreates the OLD static Shop (/menu)
 * top banner. Used to:
 *   1. lazily populate shop_carousel_slides on first visit to the manager
 *      (ensureShopCarouselSeeded), and
 *   2. provide a safe fallback for the public Shop banner when the table is
 *      empty / Supabase isn't configured yet — so the Shop page never renders a
 *      blank banner and stays effectively identical until staff edit + publish.
 *
 * The default look has NO background photo (the old banner was a gradient blob,
 * not a picture), a bold white "Shop the Menu" title, and a soft-light subtitle.
 * Staff can add a picture, restyle the text, add CTA buttons, and add more
 * slides from the editor.
 */
import {
  defaultShopHeroPresentation,
  type ShopHeroPresentation,
} from "./shop-carousel-core";
import type { ShopRenderSlide } from "./shop-carousel-types";

export type ShopCarouselSeed = {
  slide_key: string;
  sort_order: number;
  presentation: ShopHeroPresentation;
};

export const SHOP_CAROUSEL_SEEDS: ShopCarouselSeed[] = [
  {
    slide_key: "shop-welcome",
    sort_order: 0,
    presentation: defaultShopHeroPresentation(),
  },
];

/** The seeds resolved to public ShopRenderSlide shape (used as the empty fallback). */
export const SHOP_CAROUSEL_FALLBACK_SLIDES: ShopRenderSlide[] = SHOP_CAROUSEL_SEEDS.map(
  (s) => ({ key: s.slide_key, presentation: s.presentation }),
);
