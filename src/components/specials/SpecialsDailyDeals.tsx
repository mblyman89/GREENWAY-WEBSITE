"use client";

import { useMemo } from "react";
import { ProductCard } from "@/components/menu/ProductCard";
import { SectionBanner } from "@/components/home/SectionBanner";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { useShuffleOrder } from "@/lib/home/useShuffleOrder";
import { DAILY_DEAL_FALLBACK } from "@/lib/specials/daily-deal-presentation";
import {
  dealPresentationFor,
  selectOnDealItems,
} from "@/lib/promotions/published-rules-core";
import {
  useActiveDealRules,
  usePublishedRules,
} from "@/components/promotions/PublishedRulesProvider";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";

const DEFAULT_LIMIT = 16;
const DEFAULT_BANNER_IMAGE = "/home/hero-banner.webp";

/**
 * Specials page "Today's Deals" block. Shows a wide SectionBanner reflecting
 * the active day, followed by N standard ProductCards of the day's actual
 * on-deal products (each resolving its own discount badge + sale price). Each
 * card links to the product / the day's filtered menu via the standard card.
 *
 * SLICE 111: staff can (in the Specials editor) swap the banner IMAGE, choose
 * how the banner TEXT sits over it, and set how many product cards show. All
 * props are optional and default to today's exact look (16 cards, built-in
 * banner art, left/center text) so the page is unchanged until edited.
 */
export function SpecialsDailyDeals({
  items,
  bannerImage,
  count,
  textAlign = "left",
  verticalAlign = "center",
}: {
  items: GreenwayMenuItem[];
  /** Optional banner background image; blank/omitted keeps the built-in art. */
  bannerImage?: string;
  /** Number of product cards to show (defaults to 16). */
  count?: number;
  /** Horizontal placement of the banner text (default "left"). */
  textAlign?: "left" | "center" | "right";
  /** Vertical placement of the banner text (default "center"). */
  verticalAlign?: "top" | "center" | "bottom";
}) {
  const LIMIT = count && Number.isFinite(count) && count > 0 ? Math.trunc(count) : DEFAULT_LIMIT;
  const bannerSrc = bannerImage && bannerImage.trim() ? bannerImage.trim() : DEFAULT_BANNER_IMAGE;
  const weekday = useStoreWeekday();
  // PROMOTIONS HARMONY (Task T / PR 1): banner copy + the on-deal product pool
  // derive from the back office's PUBLISHED promotion rules (seed fallback).
  const allRules = usePublishedRules();
  const activeRules = useActiveDealRules();

  const candidates = useMemo(
    () => (activeRules ? selectOnDealItems(items, activeRules, { limit: 64 }) : []),
    [items, activeRules],
  );

  // Fallback pool for days with NO per-item discount (e.g. Ice Cream Sunday is a
  // basket-level deal, so menuDiscountForItem returns undefined for every item
  // and `candidates` is empty). Without this the grid would render permanent
  // grey skeletons. We still want to showcase real products, so we fall back to
  // a representative cross-section of the menu. (Mirrors HomeDailyDeals.)
  const pool = useMemo(
    () => (candidates.length ? candidates : items),
    [candidates, items],
  );

  const shuffle = useShuffleOrder(
    `specials-deals-${weekday ?? "pending"}`,
    pool.map((item) => item.id),
  );

  const deals = useMemo(() => {
    if (!pool.length) return [];
    const ordered = [...pool].sort(
      (a, b) => (shuffle[a.id] ?? 0) - (shuffle[b.id] ?? 0),
    );
    return ordered.slice(0, LIMIT);
  }, [pool, shuffle, LIMIT]);

  // Only show skeletons during the brief first paint while the store weekday is
  // still resolving on the client. Once resolved we always have products to show
  // (the day's deals or the menu fallback) — never permanent grey tiles.
  const isResolvingWeekday = weekday === undefined;

  const presentation = weekday ? dealPresentationFor(allRules, weekday) : null;
  const title = presentation?.title ?? DAILY_DEAL_FALLBACK.title;
  const subtitle = presentation?.subtitle ?? DAILY_DEAL_FALLBACK.subtitle;

  return (
    <section aria-labelledby="todays-deals-title" className="mt-10 space-y-4 md:mt-14 md:space-y-6">
      <SectionBanner
        imageSrc={bannerSrc}
        imageAlt={`${title} daily deal products`}
        eyebrow="Today's Deal"
        title={title}
        subtitle={subtitle}
        textAlign={textAlign}
        verticalAlign={verticalAlign}
      />
      <h2 id="todays-deals-title" className="sr-only">
        {title} products
      </h2>

      {/* SLICE 43 (owner directive): ONE full-width card per row on mobile —
          matching the shop page's grid — instead of two cramped columns. */}
      {!isResolvingWeekday && deals.length ? (
        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {deals.map((item) => (
            <ProductCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="aspect-[3/4] animate-pulse rounded-2xl border border-white/10 bg-white/5"
              aria-hidden="true"
            />
          ))}
        </div>
      )}
    </section>
  );
}
