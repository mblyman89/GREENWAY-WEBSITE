"use client";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import {
  formatMenuDealBadge,
  menuDiscountForItem,
} from "@/lib/promotions/published-rules-core";
import { useActiveDealRules } from "@/components/promotions/PublishedRulesProvider";
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
 */
export function RelatedProductCard({ item, className }: RelatedProductCardProps) {
  const activeRules = useActiveDealRules();
  const activeDiscount = activeRules ? menuDiscountForItem(item, activeRules) : undefined;
  return (
    <ProductCardVisual
      item={item}
      salePriceMinorUnits={activeDiscount?.cardPreviewSalePriceMinorUnits}
      saleBadgeLabel={activeDiscount ? formatMenuDealBadge(activeDiscount) : undefined}
      className={className}
    />
  );
}
