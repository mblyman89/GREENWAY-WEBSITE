/**
 * src/lib/promotions/daily-deal-seed.ts
 *
 * The hardcoded Mon–Sun daily deals + Thursday brands, expressed as seed rows
 * for the promotions tables. This is the single source of truth for the
 * migration of src/lib/specials/daily-deals.ts into the database, and it
 * doubles as the static FALLBACK the public reader maps when the DB is empty
 * or unconfigured (zero-blank guarantee — the storefront always shows deals).
 *
 * Categories/brands/percentages here intentionally match daily-deals.ts so the
 * front-end behaviour is identical until staff edit a deal in the back office.
 */
import type { GreenwayCategory } from "@/lib/leafly/types";
import type { DiscountType, Weekday } from "./types";

export type DailyDealSeed = {
  promoKey: string;
  title: string;
  description: string;
  weekday: Weekday;
  discountType: DiscountType;
  discountPercent: number;
  multiItemPercent?: number;
  perItemSale: boolean;
  bonusNote?: string;
  priority: number;
  targetCategories?: GreenwayCategory[];
  targetBrands?: string[];
  storewide?: boolean;
};

// Thursday — Top Shelf Thursday featured brands (Greenway rotates ~4–5 weekly).
export const TOP_SHELF_THURSDAY_BRANDS: string[] = [
  "Lifted",
  "Phat Panda",
  "Buddies",
  "Clarity Farms",
  "Constellation",
];

export const DAILY_DEAL_SEEDS: DailyDealSeed[] = [
  {
    promoKey: "daily.monday",
    title: "Munchie Monday",
    description: "25% off edibles, RSO, drinks, and tinctures all day Monday.",
    weekday: 1,
    discountType: "percent",
    discountPercent: 25,
    perItemSale: true,
    priority: 10,
    targetCategories: ["edible-solid", "edible-liquid", "rso", "tincture"],
  },
  {
    promoKey: "daily.tuesday",
    title: "Doobie Tuesday",
    description:
      "Quantity-tiered savings on prerolls, blunts, and packs — buy 2+ to save, 4+ get 25%.",
    weekday: 2,
    discountType: "multi_item_tier",
    discountPercent: 25,
    multiItemPercent: 25,
    perItemSale: false,
    bonusNote: "buy 2+ to save",
    priority: 10,
    targetCategories: [
      "preroll",
      "blunt",
      "preroll-pack",
      "infused-preroll",
      "infused-blunt",
      "infused-preroll-pack",
    ],
  },
  {
    promoKey: "daily.wednesday",
    title: "Wax Wednesday",
    description: "Spend-tiered savings on concentrates and vapes — up to 30% off at $150+.",
    weekday: 3,
    discountType: "threshold_spend",
    discountPercent: 30,
    perItemSale: false,
    bonusNote: "up to 30% off",
    priority: 10,
    targetCategories: ["cartridge", "disposable-cartridge", "concentrate", "rso"],
  },
  {
    promoKey: "daily.thursday",
    title: "Top Shelf Thursday",
    description: "25% off featured premium brands — a clean flat per-item deal.",
    weekday: 4,
    discountType: "percent",
    discountPercent: 25,
    perItemSale: true,
    priority: 10,
    targetBrands: TOP_SHELF_THURSDAY_BRANDS,
  },
  {
    promoKey: "daily.friday",
    title: "Ounce Friday",
    description:
      "Weight-tiered flower savings — up to 30% by the ounce (20% half / 15% quarter).",
    weekday: 5,
    discountType: "weight_tier",
    discountPercent: 30,
    perItemSale: false,
    bonusNote: "up to 30% by the ounce",
    priority: 10,
    targetCategories: ["flower", "popcorn-bud", "infused-flower", "trim"],
  },
  {
    promoKey: "daily.saturday",
    title: "Super Saturday",
    description: "30% off one item + 15% off everything else storewide.",
    weekday: 6,
    discountType: "basket",
    discountPercent: 30,
    perItemSale: false,
    bonusNote: "30% one item + 15% storewide",
    priority: 10,
    storewide: true,
  },
  {
    promoKey: "daily.sunday",
    title: "Ice Cream Sunday",
    description: "Buy 3 for the price of 2 — a basket-level deal finalized in store.",
    weekday: 0,
    discountType: "basket",
    discountPercent: 0,
    perItemSale: false,
    bonusNote: "buy 3 for 2",
    priority: 10,
    storewide: true,
  },
];
