import posMenuPreview from "@/data/pos-menu-preview.json";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

const allItems = posMenuPreview as GreenwayMenuItem[];

/** Visible menu items — hidden items (no matching product master or inventory) are excluded. */
export const posMenuPreviewItems = allItems.filter((item) => !item.hidden);

export function getPosPreviewMenuItemById(id: string) {
  return posMenuPreviewItems.find((item) => item.id === id);
}
