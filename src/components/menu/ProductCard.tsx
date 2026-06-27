"use client";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { getActiveMenuDiscount } from "@/lib/specials/daily-deals";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";
import { ProductCardVisual } from "./ProductCardVisual";

export function ProductCard({ item }: { item: GreenwayMenuItem }) {
  const weekday = useStoreWeekday();
  const activeDiscount = weekday ? getActiveMenuDiscount(item, weekday) : undefined;
  // The daily-deal promo text is intentionally NOT shown on cards. Customers
  // recognize the discount from the struck "before" price + the discounted
  // price shown by ProductCardPriceSelector.
  return (
    <ProductCardVisual
      item={item}
      salePriceMinorUnits={activeDiscount?.cardPreviewSalePriceMinorUnits}
    />
  );
}
