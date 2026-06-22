import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { ProductCardVisual } from "@/components/menu/ProductCardVisual";

function salePrice(item: GreenwayMenuItem, discount: number) {
  return Math.round(item.priceMinorUnits * (1 - discount / 100));
}

export function HomeProductCard({ item, discount }: { item: GreenwayMenuItem; discount: number }) {
  return <ProductCardVisual item={item} salePriceMinorUnits={salePrice(item, discount)} />;
}
