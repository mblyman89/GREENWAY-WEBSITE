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
 * R33: also applies the owner's TYPE override (house_type) to the card's type
 * label, and is now used by EVERY public surface that shows a card - the shop
 * (/menu, /menu/[category]), the product page and its related rail, the home
 * page and /specials - so a re-filed product reads the same everywhere.
 *
 * Degrades to identity (returns the items unchanged) when Supabase is
 * unconfigured, before migration 0150, or on ANY read error — the public menu
 * must never break because of this optional overlay. One batched read for the
 * whole menu (no per-card DB calls). NEVER writes; NEVER touches CCRS/LCB.
 */
import "server-only";
import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { getOverridesForKeys } from "@/lib/pos/product-classification-overrides";
import { applyCategoryOverrides, applyHouseTypeOverrides } from "@/lib/menu/menu-category-override-core";
// DB HEALTH A (owner 2026-11-06): public renders read one shared override snapshot per minute
// (cleared by revalidatePublicMenuSurfaces) instead of re-querying every menu key per render.
import { classificationOverrideSnapshot } from "@/lib/site/public-snapshot-server";
import { pickKeys } from "@/lib/site/public-snapshot-core";

export async function withCategoryOverride(
  items: GreenwayMenuItem[],
): Promise<GreenwayMenuItem[]> {
  if (items.length === 0) return items;
  try {
    const keys = items.map((i) => i.id);
    const snap = await classificationOverrideSnapshot();
    const overrides = snap ? pickKeys(snap, keys) : await getOverridesForKeys(keys);
    if (overrides.size === 0) return items;
    const map = new Map<string, string | null>();
    // R33: the TYPE half of the owner's re-file (house_type) was saved but
    // never reached the website. Category first (it decides the fan-out
    // base), then the type label on top of the re-filed category.
    const types = new Map<string, string | null>();
    for (const [key, row] of overrides) {
      map.set(key, row.website_category);
      types.set(key, row.house_type);
    }
    return applyHouseTypeOverrides(applyCategoryOverrides(items, map), types);
  } catch (err) {
    console.error("[menu-category-override] withCategoryOverride failed:", err);
    return items;
  }
}
