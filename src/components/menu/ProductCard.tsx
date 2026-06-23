import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { formatActiveDiscountBadge, getActiveMenuDiscount } from "@/lib/specials/daily-deals";
import { ProductCardVisual } from "./ProductCardVisual";

export function ProductCard({ item }: { item: GreenwayMenuItem }) {
  const activeDiscount = getActiveMenuDiscount(item);
  return <ProductCardVisual item={item} salePriceMinorUnits={activeDiscount?.salePriceMinorUnits} saleBadgeLabel={activeDiscount ? formatActiveDiscountBadge(activeDiscount) : undefined} />;
}
