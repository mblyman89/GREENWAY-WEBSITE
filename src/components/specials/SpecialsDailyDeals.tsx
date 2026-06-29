"use client";

import { useMemo } from "react";
import { ProductCard } from "@/components/menu/ProductCard";
import { SectionBanner } from "@/components/home/SectionBanner";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { useShuffleOrder } from "@/lib/home/useShuffleOrder";
import {
  DAILY_DEAL_FALLBACK,
  getDailyDealPresentation,
  selectDailyDealItems,
} from "@/lib/specials/daily-deal-presentation";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";

const LIMIT = 16;

/**
 * Specials page "Today's Deals" block. Shows a wide SectionBanner reflecting
 * the active day, followed by 16 standard ProductCards of the day's actual
 * on-deal products (each resolving its own discount badge + sale price). Each
 * card links to the product / the day's filtered menu via the standard card.
 */
export function SpecialsDailyDeals({ items }: { items: GreenwayMenuItem[] }) {
  const weekday = useStoreWeekday();

  const candidates = useMemo(
    () => (weekday ? selectDailyDealItems(items, weekday, { limit: 64 }) : []),
    [items, weekday],
  );

  // Fallback pool for days with NO per-item discount (e.g. Ice Cream Sunday is a
  // basket-level deal, so getActiveMenuDiscount returns undefined for every item
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
  }, [pool, shuffle]);

  // Only show skeletons during the brief first paint while the store weekday is
  // still resolving on the client. Once resolved we always have products to show
  // (the day's deals or the menu fallback) — never permanent grey tiles.
  const isResolvingWeekday = weekday === undefined;

  const presentation = weekday ? getDailyDealPresentation(weekday) : null;
  const title = presentation?.title ?? DAILY_DEAL_FALLBACK.title;
  const subtitle = presentation?.subtitle ?? DAILY_DEAL_FALLBACK.subtitle;

  return (
    <section aria-labelledby="todays-deals-title" className="mt-10 space-y-4 md:mt-14 md:space-y-6">
      <SectionBanner
        imageSrc="/home/hero-banner.webp"
        imageAlt={`${title} daily deal products`}
        eyebrow="Today's Deal"
        title={title}
        subtitle={subtitle}
      />
      <h2 id="todays-deals-title" className="sr-only">
        {title} products
      </h2>

      {!isResolvingWeekday && deals.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
          {deals.map((item) => (
            <ProductCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
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
