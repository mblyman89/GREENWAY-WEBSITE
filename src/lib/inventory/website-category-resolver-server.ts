/**
 * src/lib/inventory/website-category-resolver-server.ts
 *
 * Server-side companion to website-category-resolver.ts. It supplies the
 * precedence inputs the pure core can't compute on its own:
 *
 *   (0) product_classification_overrides by pos_product_key — the OWNER's
 *       per-product re-filing from the Inventory Detail corrections section.
 *       HIGHEST precedence (beats even a published menu_items.category). Empty /
 *       ignored until migration 0150 has been run.
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
import { chunkedIn, MENU_READ_CONCURRENCY } from "@/lib/supabase/chunked-in";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { listInventoryTypes, listWebsiteCategoryTypes } from "@/lib/pos/types-store";
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";
import { getOverridesForKeys } from "@/lib/pos/product-classification-overrides";
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
    // R38 S1: chunked AND paged. menu_items has no unique (version, source)
    // constraint (0002 only indexes it), so a 300-key chunk is not provably
    // under PostgREST's silent 1,000-row cap. The inventory table now resolves
    // EVERY lot through here, so the read must never truncate.
    const rows = await chunkedIn<string, { source_item_id: string; category: string | null }>(
      unique,
      async (chunk, from, to) => {
        const { data, error } = await admin
          .from("menu_items")
          .select("source_item_id, category")
          .eq("menu_version_id", published.id)
          .in("source_item_id", chunk)
          .order("source_item_id", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to);
        if (error) {
          console.error("[website-category-resolver] menu_items lookup error:", error.message);
          return [];
        }
        return (data as Array<{ source_item_id: string; category: string | null }> | null) ?? [];
      },
      { chunkSize: 300, concurrency: MENU_READ_CONCURRENCY },
    );
    for (const row of rows) {
      if (row.source_item_id && row.category && !out.has(row.source_item_id)) out.set(row.source_item_id, row.category);
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
  opts: ResolveManyOptions = {},
): Promise<WebsiteCategoryResolution[]> {
  return (await resolveWebsiteCategoriesWithLiveKeys(lots, opts)).resolutions;
}

export type ResolveManyOptions = {
  /**
   * R34 - also accept categories the owner created in Settings -> Types
   * (active rows of website_category_types that are not built-in). Off by
   * default so every existing caller behaves exactly as before.
   */
  includeCustomCategories?: boolean;
};

/**
 * R34 - owner-created categories (value -> label): ACTIVE registry rows whose
 * value is not a built-in taxonomy value. Empty on any failure (the registry
 * read already falls back to the built-in taxonomy, which yields no extras).
 */
export async function loadCustomCategoryMap(): Promise<Map<string, string>> {
  const builtIn = new Set<string>(websiteCategoryDefinitions.map((c) => c.value as string));
  const out = new Map<string, string>();
  try {
    const rows = await listWebsiteCategoryTypes({ includeInactive: false });
    for (const r of rows) {
      const v = String(r.value ?? "").trim();
      if (v && !builtIn.has(v)) out.set(v, String(r.label ?? "").trim() || v);
    }
  } catch (err) {
    console.error("[website-category-resolver] loadCustomCategoryMap failed:", err);
  }
  return out;
}

/**
 * S02 — the same resolution, plus WHICH of the keys are a card on the
 * published menu. The published-menu read already happens inside (step (a)
 * above), so this answers "is it live?" at zero extra queries. menu_items.
 * category is NOT NULL (0002), so every live key has an entry.
 */
export async function resolveWebsiteCategoriesWithLiveKeys<T extends ResolvableLot>(
  lots: T[],
  opts: ResolveManyOptions = {},
): Promise<{ resolutions: WebsiteCategoryResolution[]; liveKeys: Set<string> }> {
  if (lots.length === 0) return { resolutions: [], liveKeys: new Set() };
  const keys = lots.map((l) => l.posProductKey);
  const [inventoryTypeMap, menuCategories, overrides, extraCategories] = await Promise.all([
    loadInventoryTypeMap(),
    loadMenuCategoriesForKeys(keys),
    getOverridesForKeys(keys),
    opts.includeCustomCategories ? loadCustomCategoryMap() : Promise.resolve(undefined),
  ]);
  const resolutions = lots.map((lot) =>
    resolveWebsiteCategory(lot, {
      overrideCategory: lot.posProductKey
        ? overrides.get(lot.posProductKey)?.website_category ?? null
        : null,
      menuItemCategory: lot.posProductKey ? menuCategories.get(lot.posProductKey) ?? null : null,
      inventoryTypeMap,
      ...(extraCategories && extraCategories.size ? { extraCategories } : {}),
    }),
  );
  return { resolutions, liveKeys: new Set(menuCategories.keys()) };
}

/** Resolve a single lot (loads DB inputs; prefer the batch version for lists). */
export async function resolveWebsiteCategoryForLot(
  lot: ResolvableLot,
): Promise<WebsiteCategoryResolution> {
  const [only] = await resolveWebsiteCategories([lot]);
  return only;
}
