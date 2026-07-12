/**
 * src/lib/promotions/storefront-bridge.ts
 *
 * Server-side bridge between the DB-backed promotions (managed in
 * /admin/promotions) and the storefront's deal presentation.
 *
 * PROMOTIONS HARMONY (Task T / PR 1): the presentation logic now lives in the
 * PURE shared module (published-rules-core.ts — dealPresentationFor /
 * weeklyDealPresentations / weeklyDealSummaries) so the client components can
 * derive the same views from the serialized snapshot. This bridge keeps thin
 * async wrappers for server callers plus the Thursday brand reader.
 *
 * Everything falls back to the committed daily-deal seeds / static
 * presentation when the DB is empty or unconfigured, so the storefront never
 * goes blank and behaviour is identical to today until staff publish an
 * override.
 */
import "server-only";
import { getPublishedPromotions } from "./promotions-store";
import type { Weekday } from "./types";
import type { DailyDealPresentation } from "@/lib/specials/daily-deal-presentation";
import { getStoreWeekday, type StoreWeekday } from "@/lib/specials/daily-deals";
import { TOP_SHELF_THURSDAY_BRANDS } from "./daily-deal-seed";
import { loadPublishedRuleSnapshots } from "./discount-engine";
import {
  dealPresentationFor,
  weeklyDealPresentations,
  INDEX_TO_STORE_WEEKDAY,
  STORE_WEEKDAY_TO_INDEX,
} from "./published-rules-core";

// Back-compat aliases for existing importers.
const WEEKDAY_TO_STORE: Record<Weekday, StoreWeekday> = INDEX_TO_STORE_WEEKDAY;
const STORE_TO_WEEKDAY: Record<StoreWeekday, Weekday> = STORE_WEEKDAY_TO_INDEX;

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
  const snapshots = await loadPublishedRuleSnapshots();
  const view = dealPresentationFor(snapshots, storeWeekday);
  return {
    weekday: storeWeekday,
    title: view.title,
    subtitle: view.subtitle,
    menuHref: view.menuHref,
    fromDatabase: view.fromDatabase,
  };
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
  const snapshots = await loadPublishedRuleSnapshots();
  return weeklyDealPresentations(snapshots).map((v) => ({
    weekday: v.weekday,
    title: v.title,
    subtitle: v.subtitle,
    menuHref: v.menuHref,
  }));
}

export { WEEKDAY_TO_STORE, STORE_TO_WEEKDAY };
