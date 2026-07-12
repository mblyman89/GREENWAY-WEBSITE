"use client";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { menuDiscountForItem } from "@/lib/promotions/published-rules-core";
import { useActiveDealRules } from "@/components/promotions/PublishedRulesProvider";
import { ProductCardVisual } from "./ProductCardVisual";

export function ProductCard({ item }: { item: GreenwayMenuItem }) {
  // PROMOTIONS HARMONY (Task T / PR 1): the card preview derives from the back
  // office's PUBLISHED promotion rules (seed fallback) — the same rules the
  // cart and the register charge with.
  const activeRules = useActiveDealRules();
  const activeDiscount = activeRules ? menuDiscountForItem(item, activeRules) : undefined;
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
