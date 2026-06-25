"use client";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { formatActiveDiscountBadge, getActiveMenuDiscount } from "@/lib/specials/daily-deals";
import { useStoreWeekday } from "@/lib/specials/useStoreWeekday";
import { ProductCardVisual } from "./ProductCardVisual";

type RelatedProductCardProps = {
  item: GreenwayMenuItem;
  className?: string;
};

/**
 * Client wrapper used on the (statically generated) product detail page so the
 * daily-deal badge/sale price resolves from the live store weekday at render
 * time rather than freezing at build time.
 */
export function RelatedProductCard({ item, className }: RelatedProductCardProps) {
  const weekday = useStoreWeekday();
  const activeDiscount = weekday ? getActiveMenuDiscount(item, weekday) : undefined;
  return (
    <ProductCardVisual
      item={item}
      salePriceMinorUnits={activeDiscount?.salePriceMinorUnits}
      saleBadgeLabel={activeDiscount ? formatActiveDiscountBadge(activeDiscount) : undefined}
      className={className}
    />
  );
}
