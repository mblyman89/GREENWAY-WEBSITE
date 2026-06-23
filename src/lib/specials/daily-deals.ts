import type { GreenwayCategory, GreenwayMenuItem } from "@/lib/leafly/types";

export type ActiveMenuDiscount = {
  label: string;
  discountPercent: number;
  multiItemDiscountPercent?: number;
  salePriceMinorUnits: number;
};

export const tuesdayDoobieCategories: GreenwayCategory[] = [
  "preroll",
  "preroll-pack",
  "infused-preroll",
  "infused-preroll-pack",
];

export function isTuesdayDoobieItem(item: GreenwayMenuItem) {
  const itemCategories = item.filterCategories?.length ? item.filterCategories : [item.category];
  return itemCategories.some((category) => tuesdayDoobieCategories.includes(category));
}

export function discountPrice(priceMinorUnits: number, discountPercent: number) {
  return Math.round(priceMinorUnits * (1 - discountPercent / 100));
}

export function getActiveMenuDiscount(item: GreenwayMenuItem): ActiveMenuDiscount | undefined {
  if (!isTuesdayDoobieItem(item)) return undefined;

  return {
    label: "Doobie Tuesday",
    discountPercent: 20,
    multiItemDiscountPercent: 25,
    salePriceMinorUnits: discountPrice(item.priceMinorUnits, 20),
  };
}

export function formatActiveDiscountBadge(discount: ActiveMenuDiscount) {
  const multiItemText = discount.multiItemDiscountPercent ? ` · 4+ get ${discount.multiItemDiscountPercent}%` : "";
  return `${discount.label} · ${discount.discountPercent}% off${multiItemText}`;
}
