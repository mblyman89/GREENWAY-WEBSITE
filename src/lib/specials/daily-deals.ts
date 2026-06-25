import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";

export type ActiveMenuDiscount = {
  label: string;
  discountPercent: number;
  multiItemDiscountPercent?: number;
  bonusNote?: string;
  salePriceMinorUnits: number;
};

// ---------------------------------------------------------------------------
// Day-of-week resolution (America/Los_Angeles — the store's local timezone).
// Computing the weekday from the store's timezone keeps the active deal correct
// regardless of the visitor's device/browser timezone.
// ---------------------------------------------------------------------------

const STORE_TIME_ZONE = "America/Los_Angeles";

export type StoreWeekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

const WEEKDAY_ORDER: StoreWeekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/**
 * Resolve the current weekday in the store's timezone. Falls back to the
 * runtime-local weekday if Intl timezone support is unavailable.
 */
export function getStoreWeekday(reference: Date = new Date()): StoreWeekday {
  try {
    const weekdayName = new Intl.DateTimeFormat("en-US", {
      timeZone: STORE_TIME_ZONE,
      weekday: "long",
    })
      .format(reference)
      .toLowerCase();
    const match = WEEKDAY_ORDER.find((day) => day === weekdayName);
    if (match) return match;
  } catch {
    // Intl may not support the timezone in some runtimes; fall through.
  }
  return WEEKDAY_ORDER[reference.getDay()];
}

// ---------------------------------------------------------------------------
// Per-deal category targeting (mirrors SpecialsPreview + previewSpecialCollections)
// ---------------------------------------------------------------------------

// Monday — Munchie Monday: edibles, RSO, drinks, tinctures.
const munchieMondayCategories: GreenwayCategory[] = [
  "edible-solid",
  "edible-liquid",
  "rso",
  "tincture",
];

// Tuesday — Doobie Tuesday: prerolls, blunts, infused, and multi-packs.
export const tuesdayDoobieCategories: GreenwayCategory[] = [
  "preroll",
  "blunt",
  "preroll-pack",
  "infused-preroll",
  "infused-blunt",
  "infused-preroll-pack",
];

// Wednesday — Wax Wednesday: concentrates + vapes.
const waxWednesdayCategories: GreenwayCategory[] = [
  "cartridge",
  "disposable-cartridge",
  "concentrate",
  "rso",
];

// Friday — Ounce Friday: flower families (priced per weight in store).
const ounceFridayCategories: GreenwayCategory[] = [
  "flower",
  "popcorn-bud",
  "infused-flower",
  "trim",
];

// Thursday — Top Shelf Thursday: brand-based. Greenway selects ~4–5 featured
// brands each week. Update this list to rotate the participating brands.
export const topShelfThursdayBrands: string[] = [
  "Lifted",
  "Phat Panda",
  "Buddies",
  "Clarity Farms",
  "Constellation",
];

function itemMatchesBrands(item: GreenwayMenuItem, brands: string[]) {
  if (!item.brand) return false;
  const itemBrand = item.brand.trim().toLowerCase();
  return brands.some((brand) => brand.trim().toLowerCase() === itemBrand);
}

export function isTopShelfThursdayItem(item: GreenwayMenuItem) {
  return itemMatchesBrands(item, topShelfThursdayBrands);
}

function itemCategoriesOf(item: GreenwayMenuItem): GreenwayCategory[] {
  return item.filterCategories?.length ? item.filterCategories : [item.category];
}

function itemMatchesCategories(item: GreenwayMenuItem, categories: GreenwayCategory[]) {
  const itemCategories = itemCategoriesOf(item);
  return itemCategories.some((category) => categories.includes(category));
}

export function isTuesdayDoobieItem(item: GreenwayMenuItem) {
  return itemMatchesCategories(item, tuesdayDoobieCategories);
}

export function discountPrice(priceMinorUnits: number, discountPercent: number) {
  return Math.round(priceMinorUnits * (1 - discountPercent / 100));
}

function buildDiscount(
  item: GreenwayMenuItem,
  config: Omit<ActiveMenuDiscount, "salePriceMinorUnits">,
): ActiveMenuDiscount {
  return {
    ...config,
    salePriceMinorUnits: discountPrice(item.priceMinorUnits, config.discountPercent),
  };
}

/**
 * Determine the active discount for a product card based on the CURRENT day of
 * week in the store's timezone and that day's published deal rules.
 *
 * Note: storewide deals (Saturday/Sunday) and multi-item / spend-threshold tiers
 * are finalized at checkout in store; cards display the baseline per-item rate.
 */
export function getActiveMenuDiscount(
  item: GreenwayMenuItem,
  weekday: StoreWeekday = getStoreWeekday(),
): ActiveMenuDiscount | undefined {
  switch (weekday) {
    case "monday": {
      if (!itemMatchesCategories(item, munchieMondayCategories)) return undefined;
      return buildDiscount(item, { label: "Munchie Monday", discountPercent: 25 });
    }
    case "tuesday": {
      if (!isTuesdayDoobieItem(item)) return undefined;
      return buildDiscount(item, {
        label: "Doobie Tuesday",
        discountPercent: 20,
        multiItemDiscountPercent: 25,
      });
    }
    case "wednesday": {
      if (!itemMatchesCategories(item, waxWednesdayCategories)) return undefined;
      return buildDiscount(item, {
        label: "Wax Wednesday",
        discountPercent: 20,
        bonusNote: "30% at $150+",
      });
    }
    case "thursday": {
      // Top Shelf Thursday is brand-based: only the featured brands are on deal.
      if (!isTopShelfThursdayItem(item)) return undefined;
      return buildDiscount(item, { label: "Top Shelf Thursday", discountPercent: 25 });
    }
    case "friday": {
      if (!itemMatchesCategories(item, ounceFridayCategories)) return undefined;
      // Flower scales 30% (oz) / 20% (half) / 15% (quarter) by weight in store.
      // Cards show the headline ounce rate.
      return buildDiscount(item, {
        label: "Ounce Friday",
        discountPercent: 30,
        bonusNote: "half 20% · quarter 15%",
      });
    }
    case "saturday": {
      // Super Saturday: 30% one item + 15% everything else storewide.
      // Cards display the storewide baseline (15%).
      return buildDiscount(item, {
        label: "Super Saturday",
        discountPercent: 15,
        bonusNote: "30% off one item",
      });
    }
    case "sunday": {
      // Ice Cream Sunday: buy 3 for the price of 2 storewide (~33%).
      return buildDiscount(item, {
        label: "Ice Cream Sunday",
        discountPercent: 33,
        bonusNote: "buy 3 for 2",
      });
    }
    default:
      return undefined;
  }
}

export function formatActiveDiscountBadge(discount: ActiveMenuDiscount) {
  if (discount.multiItemDiscountPercent) {
    return `${discount.label} · ${discount.discountPercent}% off · 4+ get ${discount.multiItemDiscountPercent}%`;
  }
  if (discount.bonusNote) {
    return `${discount.label} · ${discount.discountPercent}% off · ${discount.bonusNote}`;
  }
  return `${discount.label} · ${discount.discountPercent}% off`;
}
