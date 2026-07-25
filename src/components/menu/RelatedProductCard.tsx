"use client";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  formatMenuDealBadge,
  menuCardDiscountForItem,
} from "@/lib/promotions/published-rules-core";
import { useActiveDealRules } from "@/components/promotions/PublishedRulesProvider";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";
import { ProductCardVisual } from "./ProductCardVisual";

type RelatedProductCardProps = {
  item: GreenwayMenuItem;
  className?: string;
};

/**
 * Client wrapper used on the (statically generated) product detail page so the
 * daily-deal badge/sale price resolves from the live store weekday at render
 * time rather than freezing at build time. PROMOTIONS HARMONY (Task T / PR 1):
 * the deal derives from the back office's PUBLISHED promotion rules.
 *
 * SLICE 40 (owner directive): Friday/Saturday/Sunday show the regular price on
 * cards (basket-dependent deals finalize in the cart); Monday–Thursday keep
 * the struck price + badge. menuCardDiscountForItem applies that policy.
 */
export function RelatedProductCard({ item, className }: RelatedProductCardProps) {
  const activeRules = useActiveDealRules();
  const weekday = useStoreWeekday();
  const activeDiscount = menuCardDiscountForItem(item, activeRules, weekday);
  return (
    <ProductCardVisual
      item={item}
      salePriceMinorUnits={activeDiscount?.cardPreviewSalePriceMinorUnits}
      saleBadgeLabel={activeDiscount ? formatMenuDealBadge(activeDiscount) : undefined}
      className={className}
    />
  );
}
