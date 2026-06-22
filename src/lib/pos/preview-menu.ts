import posMenuPreview from "@/data/pos-menu-sample-preview.json";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

export const posMenuPreviewItems = posMenuPreview as GreenwayMenuItem[];

export function getPosPreviewMenuItemById(id: string) {
  return posMenuPreviewItems.find((item) => item.id === id);
}
