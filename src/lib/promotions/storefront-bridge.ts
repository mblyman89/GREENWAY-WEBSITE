/**
 * src/lib/promotions/storefront-bridge.ts
 *
 * Slice 6 follow-on — the server-side bridge between the DB-backed promotions
 * (managed in /admin/promotions) and the storefront's existing daily-deal
 * presentation layer.
 *
 * Why a bridge (and not a rewrite): the live cart engine + product-card pricing
 * in src/lib/specials/* are battle-tested, synchronous, and shared across many
 * client components. Rewiring all of them to async DB reads would be a large,
 * risky change. Instead this bridge reads PUBLISHED promotions on the server and
 * derives the few customer-facing values staff actually edit week to week:
 *
 *   - the active day's deal TITLE + SUBTITLE (shown on home + specials hero)
 *   - the Top Shelf Thursday BRAND list (the headline editable field)
 *   - the menu "lane" link for the day
 *
 * Everything falls back to the committed daily-deal seeds / static presentation
 * when the DB is empty or unconfigured, so the storefront never goes blank and
 * behaviour is identical to today until staff publish an override.
 *
 * The exact per-item discount math stays in src/lib/specials/* (the single
 * source of truth for what a customer is charged) — unchanged by this bridge.
 */
import "server-only";
import { getPublishedPromotions } from "./promotions-store";
import type { PublishedPromotion, Weekday } from "./types";
import {
  getDailyDealPresentation,
  type DailyDealPresentation,
} from "@/lib/specials/daily-deal-presentation";
import { getStoreWeekday, type StoreWeekday } from "@/lib/specials/daily-deals";
import { TOP_SHELF_THURSDAY_BRANDS } from "./daily-deal-seed";

const WEEKDAY_TO_STORE: Record<Weekday, StoreWeekday> = {
  0: "sunday",
  1: "monday",
  2: "tuesday",
  3: "wednesday",
  4: "thursday",
  5: "friday",
  6: "saturday",
};

const STORE_TO_WEEKDAY: Record<StoreWeekday, Weekday> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function buildMenuHref(promo: PublishedPromotion): string {
  if (promo.targetBrands.length > 0) {
    return `/menu?brands=${promo.targetBrands.map((b) => encodeURIComponent(b)).join(",")}`;
  }
  if (promo.targetCategories.length > 0) {
    return `/menu?categories=${promo.targetCategories.join(",")}`;
  }
  return "/menu";
}

export type ActiveDealView = {
  weekday: StoreWeekday;
  title: string;
  subtitle: string;
  menuHref: string;
  /** True when this view came from a DB-published promotion (vs the static map). */
  fromDatabase: boolean;
};

/**
 * The active day's deal presentation, preferring a DB-published promotion for
 * the current store weekday and falling back to the static presentation map.
 */
export async function getActiveDealView(reference: Date = new Date()): Promise<ActiveDealView> {
  const storeWeekday = getStoreWeekday(reference);
  const weekday = STORE_TO_WEEKDAY[storeWeekday];

  const published = await getPublishedPromotions();
  // Pick the highest-priority published promo matching today's weekday.
  const match = published
    .filter((p) => p.weekday === weekday)
    .sort((a, b) => b.priority - a.priority)[0];

  if (match) {
    const fallback = getDailyDealPresentation(storeWeekday);
    return {
      weekday: storeWeekday,
      title: match.title || fallback.title,
      subtitle: match.description || match.bonusNote || fallback.subtitle,
      menuHref: buildMenuHref(match),
      fromDatabase: !match.id.startsWith("seed-"),
    };
  }

  // No match at all → static presentation for the day.
  const fallback = getDailyDealPresentation(storeWeekday);
  return { ...fallback, weekday: storeWeekday, fromDatabase: false };
}

/**
 * The Top Shelf Thursday brand list, preferring the DB-published Thursday promo
 * (the headline field staff edit weekly) and falling back to the committed
 * seed brands. Returned brands are deduped + trimmed.
 */
export async function getThursdayBrands(): Promise<string[]> {
  const published = await getPublishedPromotions();
  const thursday = published
    .filter((p) => p.weekday === 4 && p.targetBrands.length > 0)
    .sort((a, b) => b.priority - a.priority)[0];
  const brands = thursday?.targetBrands?.length ? thursday.targetBrands : TOP_SHELF_THURSDAY_BRANDS;
  return Array.from(new Set(brands.map((b) => b.trim()).filter(Boolean)));
}

/**
 * A full week of deal presentations (for the specials page "Weekly Deals"
 * grid), DB-preferred with static fallback per day.
 */
export async function getWeeklyDealViews(): Promise<DailyDealPresentation[]> {
  const published = await getPublishedPromotions();
  const order: StoreWeekday[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ];
  return order.map((storeWeekday) => {
    const weekday = STORE_TO_WEEKDAY[storeWeekday];
    const match = published
      .filter((p) => p.weekday === weekday)
      .sort((a, b) => b.priority - a.priority)[0];
    const fallback = getDailyDealPresentation(storeWeekday);
    if (!match) return fallback;
    return {
      weekday: storeWeekday,
      title: match.title || fallback.title,
      subtitle: match.description || match.bonusNote || fallback.subtitle,
      menuHref: buildMenuHref(match),
    };
  });
}

export { WEEKDAY_TO_STORE, STORE_TO_WEEKDAY };
