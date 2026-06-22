import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { ProductCardVisual } from "./ProductCardVisual";

export function ProductCard({ item }: { item: GreenwayMenuItem }) {
  return <ProductCardVisual item={item} />;
}
