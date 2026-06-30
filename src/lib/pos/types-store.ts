/**
 * src/lib/pos/types-store.ts
 *
 * Server-side read/write helpers for the two DB-backed type registries added in
 * Slice 23:
 *
 *   * website_category_types  -- curated grouping taxonomy for the public menu.
 *   * inventory_types         -- canonical POS inventory_type / inventory_category
 *                                strings, optionally mapped to a website category.
 *
 * Design notes:
 *   * Graceful fallback. When the DB isn't configured yet, OR the table is empty,
 *     reads fall back to the hardcoded `websiteCategoryDefinitions` so the menu
 *     keeps working exactly like before the migration ran.
 *   * Deletion guards live here. A category/type that is referenced by live data
 *     is DEACTIVATED (is_active=false), never hard-deleted, so historical rows
 *     keep resolving. Only never-used, non-system rows may be hard-deleted.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { websiteCategoryDefinitions } from "@/lib/pos/category-taxonomy";

export type WebsiteCategoryType = {
  value: string;
  label: string;
  helper: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
  created_at?: string;
  updated_at?: string;
};

export type InventoryType = {
  id: string;
  key: string;
  label: string;
  notes: string | null;
  website_category: string | null;
  is_active: boolean;
  is_system: boolean;
  created_at?: string;
  updated_at?: string;
};

/** The hardcoded taxonomy rendered as table rows (fallback + first-run seed shape). */
export function fallbackWebsiteCategories(): WebsiteCategoryType[] {
  return websiteCategoryDefinitions.map((c, i) => ({
    value: c.value,
    label: c.label,
    helper: c.helper,
    sort_order: (i + 1) * 10,
    is_active: true,
    is_system: true,
  }));
}

/**
 * List website category types. Falls back to the hardcoded taxonomy when the DB
 * is not configured or the table has not been seeded yet.
 */
export async function listWebsiteCategoryTypes(opts?: {
  includeInactive?: boolean;
}): Promise<WebsiteCategoryType[]> {
  if (!isSupabaseServiceConfigured) return fallbackWebsiteCategories();
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("website_category_types")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("label", { ascending: true });
  if (!opts?.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error || !data || data.length === 0) return fallbackWebsiteCategories();
  return data as WebsiteCategoryType[];
}

/** Get one website category type by value (DB first, then hardcoded fallback). */
export async function getWebsiteCategoryType(
  value: string,
): Promise<WebsiteCategoryType | null> {
  if (isSupabaseServiceConfigured) {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("website_category_types")
      .select("*")
      .eq("value", value)
      .maybeSingle();
    if (data) return data as WebsiteCategoryType;
  }
  return fallbackWebsiteCategories().find((c) => c.value === value) ?? null;
}

/** List canonical inventory types. Empty when DB not configured. */
export async function listInventoryTypes(opts?: {
  includeInactive?: boolean;
}): Promise<InventoryType[]> {
  if (!isSupabaseServiceConfigured) return [];
  const admin = createSupabaseAdminClient();
  let q = admin
    .from("inventory_types")
    .select("*")
    .order("label", { ascending: true });
  if (!opts?.includeInactive) q = q.eq("is_active", true);
  const { data } = await q;
  return (data as InventoryType[] | null) ?? [];
}

/** Get one inventory type by id. */
export async function getInventoryType(id: string): Promise<InventoryType | null> {
  if (!isSupabaseServiceConfigured) return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("inventory_types")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as InventoryType | null) ?? null;
}

/**
 * Count how many live inventory lots reference a given website category, so the
 * UI can warn before deactivating / refuse to hard-delete an in-use category.
 */
export async function countWebsiteCategoryUsage(value: string): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  // menu_items.category and inventory_types.website_category both reference it.
  const [{ count: menuCount }, { count: invTypeCount }] = await Promise.all([
    admin
      .from("menu_items")
      .select("source_item_id", { count: "exact", head: true })
      .eq("category", value),
    admin
      .from("inventory_types")
      .select("id", { count: "exact", head: true })
      .eq("website_category", value),
  ]);
  return (menuCount ?? 0) + (invTypeCount ?? 0);
}

/**
 * Count how many live inventory lots reference a given inventory-type key (by
 * the free-text inventory_lots.category, normalised). Used by the deletion guard.
 */
export async function countInventoryTypeUsage(key: string): Promise<number> {
  if (!isSupabaseServiceConfigured) return 0;
  const admin = createSupabaseAdminClient();
  // inventory_lots.category is free-text; match case-insensitively on the key.
  const { count } = await admin
    .from("inventory_lots")
    .select("id", { count: "exact", head: true })
    .ilike("category", key);
  return count ?? 0;
}

/** Normalise a raw inventory-type string into its canonical key. */
export function normalizeInventoryTypeKey(raw: string): string {
  return raw.trim().toLowerCase();
}
