"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ProductCard } from "@/components/menu/ProductCard";
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
 * Home "Daily Deals" section. Replaces the old static "50% OFF CLEARANCE"
 * block. The section title + offer line + shop link all reflect the store's
 * current weekday (Munchie Monday, Doobie Tuesday, ... Ice Cream Sunday) and
 * the cards show the actual on-deal products via the standard ProductCard,
 * so every card resolves its own daily discount badge + sale price.
 */
export function HomeDailyDeals({ items }: { items: GreenwayMenuItem[] }) {
  const weekday = useStoreWeekday();

  // Stable, on-deal candidate pool for the active day (deterministic order).
  const candidates = useMemo(
    () => (weekday ? selectDailyDealItems(items, weekday, { limit: 64 }) : []),
    [items, weekday],
  );

  const shuffle = useShuffleOrder(
    `home-deals-${weekday ?? "pending"}`,
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
  const menuHref = presentation?.menuHref ?? DAILY_DEAL_FALLBACK.menuHref;

  return (
    <section className="bg-black px-4 py-6 md:px-8 md:py-8" aria-label="Today's daily deals">
      <div className="mx-auto max-w-[88rem]">
        <div className="mb-4 flex items-end justify-between gap-4 md:mb-6">
          <div>
            <p className="text-[0.6rem] font-black uppercase tracking-[0.22em] text-[var(--greenway)] md:text-xs">
              Today&apos;s Deal
            </p>
            <h2 className="mt-1 text-2xl font-black uppercase leading-none tracking-tight text-white md:text-4xl">
              {title}
            </h2>
            <p className="mt-1.5 text-xs font-semibold leading-5 text-zinc-400 md:text-sm">
              {subtitle}
            </p>
          </div>
          <Link
            href={menuHref}
            className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-white/15 px-3 text-center text-[0.62rem] font-black uppercase tracking-[0.12em] text-white transition hover:border-[var(--orange)] hover:text-[var(--orange)] md:h-auto md:px-4 md:py-2 md:text-xs"
          >
            Shop All
          </Link>
        </div>

        {deals.length ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
            {deals.map((item) => (
              <ProductCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          // First paint / no active deals: keep height stable, no layout shift.
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
      </div>
    </section>
  );
}
