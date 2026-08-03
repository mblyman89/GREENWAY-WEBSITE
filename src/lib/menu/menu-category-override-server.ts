/**
 * src/lib/menu/menu-category-override-server.ts
 *
 * Server overlay that applies the owner's per-product website-category
 * overrides (product_classification_overrides, migration 0150) to the live
 * customer menu. Slots into the /menu overlay chain exactly like
 * withDohCompliance / withDisplayKnowledge: it takes the fully-built menu items
 * and returns them with any re-filed card's category (and filterCategories)
 * swapped to the owner's choice.
 *
 * Degrades to identity (returns the items unchanged) when Supabase is
 * unconfigured, before migration 0150, or on ANY read error — the public menu
 * must never break because of this optional overlay. One batched read for the
 * whole menu (no per-card DB calls). NEVER writes; NEVER touches CCRS/LCB.
 */
import "server-only";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { getOverridesForKeys } from "@/lib/pos/product-classification-overrides";
import { applyCategoryOverrides } from "@/lib/menu/menu-category-override-core";

export async function withCategoryOverride(
  items: GreenwayMenuItem[],
): Promise<GreenwayMenuItem[]> {
  if (items.length === 0) return items;
  try {
    const overrides = await getOverridesForKeys(items.map((i) => i.id));
    if (overrides.size === 0) return items;
    const map = new Map<string, string | null>();
    for (const [key, row] of overrides) map.set(key, row.website_category);
    return applyCategoryOverrides(items, map);
  } catch (err) {
    console.error("[menu-category-override] withCategoryOverride failed:", err);
    return items;
  }
}
