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

  const shuffle = useShuffleOrder(
    `specials-deals-${weekday ?? "pending"}`,
    candidates.map((item) => item.id),
  );

  const deals = useMemo(() => {
    if (!candidates.length) return [];
    const ordered = [...candidates].sort(
      (a, b) => (shuffle[a.id] ?? 0) - (shuffle[b.id] ?? 0),
    );
    return ordered.slice(0, LIMIT);
  }, [candidates, shuffle]);

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

      {deals.length ? (
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
