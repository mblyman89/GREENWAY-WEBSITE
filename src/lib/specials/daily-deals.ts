import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";

export type ActiveMenuDiscount = {
  label: string;
  discountPercent: number;
  multiItemDiscountPercent?: number;
  bonusNote?: string;
  salePriceMinorUnits: number;
  /**
   * When true, the card may show a genuine struck "before" price and the
   * discounted per-item price (the deal applies cleanly to the listed price).
   * When false, the deal varies by weight / spend-threshold / storewide and
   * cannot be expressed as an accurate single per-item sale price, so the card
   * shows ONLY an informational badge (no fake struck price).
   */
  perItemSalePrice: boolean;
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
// Per-deal category targeting (mirrors SpecialsContent + previewSpecialCollections)
// ---------------------------------------------------------------------------

// Monday — Munchie Monday: edibles, RSO, drinks, tinctures.
export const munchieMondayCategories: GreenwayCategory[] = [
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
export const waxWednesdayCategories: GreenwayCategory[] = [
  "cartridge",
  "disposable-cartridge",
  "concentrate",
  "rso",
];

// Friday — Ounce Friday: flower families (priced per weight in store).
export const ounceFridayCategories: GreenwayCategory[] = [
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
  config: Omit<ActiveMenuDiscount, "salePriceMinorUnits" | "perItemSalePrice"> & {
    perItemSalePrice?: boolean;
  },
): ActiveMenuDiscount {
  const perItemSalePrice = config.perItemSalePrice ?? true;
  return {
    ...config,
    perItemSalePrice,
    // Only compute a struck/sale price when the deal applies cleanly per item.
    // Otherwise keep the regular price so no inaccurate discount is shown.
    salePriceMinorUnits: perItemSalePrice
      ? discountPrice(item.priceMinorUnits, config.discountPercent)
      : item.priceMinorUnits,
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
      // Quantity-tiered (2+ = 15%, 4+ = 25%): a single preroll earns nothing, so
      // the card shows ONLY an informational note — the real discount is applied
      // in the cart once the qty threshold is reached.
      return buildDiscount(item, {
        label: "Doobie Tuesday",
        discountPercent: 25,
        multiItemDiscountPercent: 25,
        bonusNote: "buy 2+ to save",
        perItemSalePrice: false,
      });
    }
    case "wednesday": {
      if (!itemMatchesCategories(item, waxWednesdayCategories)) return undefined;
      // Spend-tiered (up to 30% at $150+): a single item may not hit the tier, so
      // the card shows an informational note; the cart applies the real rate.
      return buildDiscount(item, {
        label: "Wax Wednesday",
        discountPercent: 30,
        bonusNote: "up to 30% off",
        perItemSalePrice: false,
      });
    }
    case "thursday": {
      // Top Shelf Thursday is brand-based: only the featured brands are on deal.
      // This is a clean flat per-item 25%, so a genuine struck price is honest.
      if (!isTopShelfThursdayItem(item)) return undefined;
      return buildDiscount(item, { label: "Top Shelf Thursday", discountPercent: 25 });
    }
    case "friday": {
      if (!itemMatchesCategories(item, ounceFridayCategories)) return undefined;
      // Ounce Friday scales by WEIGHT in store: 30% (oz) / 20% (half) / 15%
      // (quarter). A single 3.5g/1g bag earns NOTHING — only quantities that add
      // up to a quarter ounce or more qualify. So cards show an informational
      // note (no fake struck price); the cart engine applies the real tier.
      return buildDiscount(item, {
        label: "Ounce Friday",
        discountPercent: 30,
        bonusNote: "up to 30% by the ounce",
        perItemSalePrice: false,
      });
    }
    case "saturday":
      // Super Saturday: 30% off ONE item + 15% off everything else storewide.
      // Because the 30% only applies to a single item, the per-item card shows an
      // informational note; the cart applies 30% to the top item + 15% to the rest.
      return buildDiscount(item, {
        label: "Super Saturday",
        discountPercent: 30,
        bonusNote: "30% one item + 15% storewide",
        perItemSalePrice: false,
      });
    case "sunday":
      // Ice Cream Sunday: buy 3 for the price of 2 (a basket-level deal). The
      // effective savings depend on basket composition and are finalized in
      // store, so cards show no struck per-item price.
      return undefined;
    default:
      return undefined;
  }
}

export function formatActiveDiscountBadge(discount: ActiveMenuDiscount) {
  // Weight-based / non-per-item deals (e.g. Ounce Friday): show ONLY the
  // informational note — never a flat "X% off" implying a per-unit price cut.
  if (!discount.perItemSalePrice) {
    return discount.bonusNote
      ? `${discount.label} · ${discount.bonusNote}`
      : discount.label;
  }
  if (discount.multiItemDiscountPercent) {
    return `${discount.label} · ${discount.discountPercent}% off · 4+ get ${discount.multiItemDiscountPercent}%`;
  }
  if (discount.bonusNote) {
    return `${discount.label} · ${discount.discountPercent}% off · ${discount.bonusNote}`;
  }
  return `${discount.label} · ${discount.discountPercent}% off`;
}
