import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";
import { getActiveMenuDiscount, type StoreWeekday } from "./daily-deals";

// ---------------------------------------------------------------------------
// Presentation layer shared by the home page + specials page.
//
// Maps the store's current weekday to:
//   - a customer-facing section title (the day's deal name)
//   - a short subtitle / offer line
//   - the menu "lane" link that pre-filters the shop to that day's eligible items
//
// The actual per-item discount + badge still comes from getActiveMenuDiscount /
// formatActiveDiscountBadge so cards stay the single source of truth for pricing.
// ---------------------------------------------------------------------------

export type DailyDealPresentation = {
  weekday: StoreWeekday;
  /** Customer-facing deal name, e.g. "Top Shelf Thursday". */
  title: string;
  /** Short offer line, e.g. "25% off select top shelf". */
  subtitle: string;
  /** Menu lane that pre-filters the shop to the day's eligible products. */
  menuHref: string;
};

const PRESENTATION: Record<StoreWeekday, Omit<DailyDealPresentation, "weekday">> = {
  monday: {
    title: "Munchie Monday",
    subtitle: "25% off all edibles, RSO, drinks & tinctures",
    menuHref: "/menu?categories=edible-solid,edible-liquid,rso,tincture",
  },
  tuesday: {
    title: "Doobie Tuesday",
    subtitle: "20% off prerolls & blunts · 25% off 4+",
    menuHref: "/menu?categories=preroll,blunt,preroll-pack,infused-preroll,infused-blunt,infused-preroll-pack",
  },
  wednesday: {
    title: "Wax Wednesday",
    subtitle: "20% off concentrates & vapes · 30% at $150+",
    menuHref: "/menu?categories=cartridge,disposable-cartridge,concentrate,rso",
  },
  thursday: {
    title: "Top Shelf Thursday",
    subtitle: "25% off select top shelf products & brands",
    menuHref: "/menu?categories=flower,infused-flower,concentrate,cartridge,disposable-cartridge",
  },
  friday: {
    title: "Ounce Friday",
    subtitle: "30% off ounces · 20% half · 15% quarter",
    menuHref: "/menu?categories=flower,popcorn-bud,infused-flower,trim",
  },
  saturday: {
    title: "Super Saturday",
    subtitle: "30% off one item · 15% off everything else",
    menuHref: "/menu",
  },
  sunday: {
    title: "Ice Cream Sunday",
    subtitle: "Buy 3 for the price of 2 storewide",
    menuHref: "/menu",
  },
};

/** Stable fallback used for the server render / first client paint. */
export const DAILY_DEAL_FALLBACK = {
  title: "Today's Deals",
  subtitle: "Daily discounts updated every day in store",
  menuHref: "/specials",
};

export function getDailyDealPresentation(weekday: StoreWeekday): DailyDealPresentation {
  return { weekday, ...PRESENTATION[weekday] };
}

// ---------------------------------------------------------------------------
// On-deal product selection
// ---------------------------------------------------------------------------

/**
 * Return the items eligible for the active day's discount. Storewide days
 * (Saturday/Sunday) match every item, so we return a representative cross
 * section sized to `limit`. Deterministic by default; pass a shuffle map for
 * a fresh order each visit.
 */
export function selectDailyDealItems(
  items: GreenwayMenuItem[],
  weekday: StoreWeekday,
  options: { limit?: number; order?: Record<string, number> } = {},
): GreenwayMenuItem[] {
  const { limit = 16, order } = options;
  const eligible = items.filter((item) => getActiveMenuDiscount(item, weekday) !== undefined);
  const ordered = order
    ? [...eligible].sort((a, b) => (order[a.id] ?? 0) - (order[b.id] ?? 0))
    : eligible;
  return ordered.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Home "Shop by Category" lanes (fixed, customer-friendly groupings)
// ---------------------------------------------------------------------------

export type CategoryLane = {
  key: string;
  label: string;
  categories: GreenwayCategory[];
  href: string;
};

const laneHref = (categories: GreenwayCategory[]) => `/menu?categories=${categories.join(",")}`;

const laneDefinitions: Omit<CategoryLane, "href">[] = [
  { key: "flower", label: "Flower", categories: ["flower", "popcorn-bud", "infused-flower"] },
  {
    key: "prerolls",
    label: "Prerolls",
    categories: ["preroll", "blunt", "preroll-pack", "infused-preroll", "infused-blunt", "infused-preroll-pack"],
  },
  { key: "concentrates", label: "Concentrates", categories: ["concentrate", "rso"] },
  { key: "edibles", label: "Edibles", categories: ["edible-solid"] },
  { key: "liquids", label: "Liquids", categories: ["edible-liquid", "tincture"] },
  { key: "topicals", label: "Topicals", categories: ["topical"] },
];

export const categoryLanes: CategoryLane[] = laneDefinitions.map((lane) => ({
  ...lane,
  href: laneHref(lane.categories),
}));

/** First item whose category set intersects the lane's categories. */
export function representativeItemForLane(items: GreenwayMenuItem[], lane: CategoryLane) {
  return items.find((item) => {
    const itemCats = item.filterCategories?.length ? item.filterCategories : [item.category];
    return itemCats.some((c) => lane.categories.includes(c));
  });
}
