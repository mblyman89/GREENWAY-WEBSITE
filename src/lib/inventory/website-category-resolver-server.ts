/**
 * src/lib/inventory/website-category-resolver-server.ts
 *
 * Server-side companion to website-category-resolver.ts. It supplies the two
 * precedence inputs the pure core can't compute on its own:
 *
 *   (a) menu_items.category by pos_product_key — AUTHORITATIVE. This is exactly
 *       the website category transform.ts already computed on import, so a lot
 *       that matches a published menu item inherits the menu's own category.
 *   (b) inventory_types DB overlay — the owner-managed map at
 *       /admin/settings/types wins over the static catalog.
 *
 * Everything degrades gracefully: with no Supabase config (or on any error) it
 * falls back to the static catalog + heuristic so back-office pages still render.
 *
 * NEVER writes. NEVER touches raw LCB/CCRS columns. Read + resolve only.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { listInventoryTypes } from "@/lib/pos/types-store";
import {
  buildStaticInventoryTypeMap,
  resolveWebsiteCategory,
  type ResolvableLot,
  type WebsiteCategoryResolution,
} from "@/lib/inventory/website-category-resolver";

/**
 * Build the inventory_type → website_category map from the DB (overlaid on the
 * static catalog). DB rows win by canonical key. Falls back to the static
 * catalog on any failure.
 */
export async function loadInventoryTypeMap(): Promise<Map<string, string>> {
  const map = buildStaticInventoryTypeMap();
  try {
    const rows = await listInventoryTypes({ includeInactive: false });
    for (const r of rows) {
      const key = (r.key || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (key && r.website_category) map.set(key, r.website_category);
    }
  } catch (err) {
    console.error("[website-category-resolver] loadInventoryTypeMap failed:", err);
  }
  return map;
}

/**
 * Fetch menu_items.category for a set of POS product keys from the currently
 * published menu version, keyed by source_item_id. Empty map on any failure.
 */
export async function loadMenuCategoriesForKeys(
  keys: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(
    new Set(keys.filter((k): k is string => typeof k === "string" && k.trim().length > 0)),
  );
  if (!isSupabaseServiceConfigured || unique.length === 0) return out;
  try {
    const published = await getPublishedVersion();
    if (!published) return out;
    const admin = createSupabaseAdminClient();
    const CHUNK = 300;
    for (let i = 0; i < unique.length; i += CHUNK) {
      const slice = unique.slice(i, i + CHUNK);
      const { data, error } = await admin
        .from("menu_items")
        .select("source_item_id, category")
        .eq("menu_version_id", published.id)
        .in("source_item_id", slice);
      if (error) {
        console.error("[website-category-resolver] menu_items lookup error:", error.message);
        continue;
      }
      for (const row of (data as Array<{ source_item_id: string; category: string | null }> | null) ?? []) {
        if (row.source_item_id && row.category) out.set(row.source_item_id, row.category);
      }
    }
  } catch (err) {
    console.error("[website-category-resolver] loadMenuCategoriesForKeys failed:", err);
  }
  return out;
}

/**
 * Resolve OUR website category for many lots in one pass (batches the two DB
 * reads). Returns resolutions in the same order as the input lots.
 */
export async function resolveWebsiteCategories<T extends ResolvableLot>(
  lots: T[],
): Promise<WebsiteCategoryResolution[]> {
  if (lots.length === 0) return [];
  const [inventoryTypeMap, menuCategories] = await Promise.all([
    loadInventoryTypeMap(),
    loadMenuCategoriesForKeys(lots.map((l) => l.posProductKey)),
  ]);
  return lots.map((lot) =>
    resolveWebsiteCategory(lot, {
      menuItemCategory: lot.posProductKey ? menuCategories.get(lot.posProductKey) ?? null : null,
      inventoryTypeMap,
    }),
  );
}

/** Resolve a single lot (loads DB inputs; prefer the batch version for lists). */
export async function resolveWebsiteCategoryForLot(
  lot: ResolvableLot,
): Promise<WebsiteCategoryResolution> {
  const [only] = await resolveWebsiteCategories([lot]);
  return only;
}
