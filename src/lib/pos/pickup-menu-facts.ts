/**
 * src/lib/pos/pickup-menu-facts.ts  (SLICE L-36)
 *
 * Server read: what the MENU knows about the products on an online order -
 * vendor, brand, detailed POS type and website category - for the register's
 * Online Orders window and the printed pick-and-bag ticket.
 *
 * Order lines snapshot product name, brand and (since 0096) category, but
 * never vendor or the detailed POS inventory type. Those live on
 * `menu_items`, keyed by `source_item_id` - the same key an order line
 * stores in `product_id`. The newest menu row per key wins, the same rule
 * the WA tax report's buildCategoryLookup uses.
 *
 * A Leafly cart item instead carries `integratorVariantId`: per the vendored
 * spec, "id assigned to variant when submitted through Leafly Menu API, if no
 * variant id was given, this will resolve to the id of the parent menu item".
 * We send `menu_variants.source_variant_id` as that id (syndication
 * menu-feed-core), so a key is tried as a variant id first and then as an
 * item id. Nothing is matched by NAME - a name match is a guess.
 *
 * ENRICHMENT, NEVER A BLOCKER: any failure returns an empty map and the
 * counter shows dashes. Losing a vendor name must never stop a handover or a
 * print.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import type { PickupMenuFacts } from "@/lib/pos/pickup-detail-core";

type MenuItemRow = {
  id: string;
  source_item_id: string;
  brand_name: string | null;
  vendor_name: string | null;
  category: string | null;
  pos_inventory_type: string | null;
  pos_inventory_category: string | null;
  created_at: string;
};

const ITEM_COLUMNS =
  "id, source_item_id, brand_name, vendor_name, category, pos_inventory_type, pos_inventory_category, created_at";

function toFacts(r: MenuItemRow): PickupMenuFacts {
  const t = (v: string | null) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
  return {
    vendorName: t(r.vendor_name),
    brandName: t(r.brand_name),
    inventoryType: t(r.pos_inventory_type) ?? t(r.pos_inventory_category),
    category: t(r.category),
  };
}

/** Newest row per source_item_id (rows must arrive created_at DESC). */
function newestBySource(rows: MenuItemRow[]): Map<string, MenuItemRow> {
  const m = new Map<string, MenuItemRow>();
  for (const r of rows) if (r.source_item_id && !m.has(r.source_item_id)) m.set(r.source_item_id, r);
  return m;
}

/**
 * Menu facts for `menu_items.source_item_id` keys (website order lines'
 * `product_id`). Missing keys are simply absent from the map.
 */
export async function loadMenuFactsByProductId(productIds: readonly (string | null | undefined)[]): Promise<Map<string, PickupMenuFacts>> {
  const out = new Map<string, PickupMenuFacts>();
  const ids = [...new Set(productIds.filter((v): v is string => typeof v === "string" && v.trim() !== ""))];
  if (!isSupabaseServiceConfigured || ids.length === 0) return out;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("menu_items")
      .select(ITEM_COLUMNS)
      .in("source_item_id", ids)
      .order("created_at", { ascending: false });
    if (error || !data) return out;
    for (const [k, r] of newestBySource(data as MenuItemRow[])) out.set(k, toFacts(r));
  } catch {
    // Enrichment only - see the header.
  }
  return out;
}

/**
 * Menu facts for Leafly `integratorVariantId` keys: tried as
 * `menu_variants.source_variant_id` first, then as a parent
 * `menu_items.source_item_id`. The map is keyed by the key AS GIVEN.
 */
export async function loadMenuFactsByLeaflyVariantId(keys: readonly (string | null | undefined)[]): Promise<Map<string, PickupMenuFacts>> {
  const out = new Map<string, PickupMenuFacts>();
  const ids = [...new Set(keys.filter((v): v is string => typeof v === "string" && v.trim() !== ""))];
  if (!isSupabaseServiceConfigured || ids.length === 0) return out;
  try {
    const admin = createSupabaseAdminClient();
    const { data: vRows } = await admin
      .from("menu_variants")
      .select("source_variant_id, menu_item_id, created_at")
      .in("source_variant_id", ids)
      .order("created_at", { ascending: false });
    const itemIdByVariant = new Map<string, string>();
    for (const v of (vRows as { source_variant_id: string; menu_item_id: string }[] | null) ?? []) {
      if (!itemIdByVariant.has(v.source_variant_id)) itemIdByVariant.set(v.source_variant_id, v.menu_item_id);
    }
    if (itemIdByVariant.size > 0) {
      const { data: iRows } = await admin
        .from("menu_items")
        .select(ITEM_COLUMNS)
        .in("id", [...new Set(itemIdByVariant.values())]);
      const byRowId = new Map(((iRows as MenuItemRow[] | null) ?? []).map((r) => [r.id, r]));
      for (const [variantKey, rowId] of itemIdByVariant) {
        const r = byRowId.get(rowId);
        if (r) out.set(variantKey, toFacts(r));
      }
    }
    const rest = ids.filter((k) => !out.has(k));
    if (rest.length > 0) {
      const parents = await loadMenuFactsByProductId(rest);
      for (const [k, f] of parents) out.set(k, f);
    }
  } catch {
    // Enrichment only - see the header.
  }
  return out;
}
