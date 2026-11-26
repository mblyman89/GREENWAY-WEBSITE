import "server-only";
/**
 * OI-ACC S5 - public reads of Other Inventory for the shop's accessory cards
 * and the per-type detail page. Scoped columns (rule 18), every error read
 * (rule 15). A failed read returns [] with the reason, so the shop simply
 * hides the cards instead of breaking the cannabis menu.
 */
import { cache } from "react";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { readNcTypes } from "@/lib/noncannabis/types-store";
import { readPaged } from "@/lib/noncannabis/register-stock";
import {
  NC_SHOP_COLUMNS,
  buildAccessoryShopCards,
  accessoryTypeItems,
  type AccessoryShopCard,
  type AccessoryShopItem,
  type NcShopRow,
} from "@/lib/noncannabis/shop-cards-core";
import type { NcTypeRow } from "@/lib/noncannabis/types-core";

type RowsRead = { rows: NcShopRow[]; error: string | null };

const readShopRows = cache(async (type: string | null): Promise<RowsRead> => {
  if (!isSupabaseServiceConfigured) return { rows: [], error: null };
  try {
    const admin = createSupabaseAdminClient();
    // Paged in 1000s (PostgREST cap; SLICE 5C rule) with a unique order.
    const read = await readPaged<NcShopRow>((from, to) => {
      let q = admin
        .from("noncannabis_products")
        .select(NC_SHOP_COLUMNS)
        .eq("status", "active")
        .gt("qty_on_hand", 0)
        .gt("price_minor_units", 0);
      if (type) q = q.eq("type", type);
      return q.order("id").range(from, to);
    }, 5000);
    if (!read.ok) return { rows: [], error: read.error };
    return { rows: read.rows, error: null };
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
});

/** The shop's accessory cards: published live non-merch types WITH stock. */
export async function loadAccessoryShopCards(): Promise<AccessoryShopCard[]> {
  const [types, rows] = await Promise.all([readNcTypes(), readShopRows(null)]);
  if (rows.error) console.error("[accessory-cards] stock read failed:", rows.error);
  return buildAccessoryShopCards(types.rows, rows.rows);
}

/** One type's detail page data; null when the type is unknown/archived/merch. */
export async function loadAccessoryTypePage(
  value: string,
): Promise<{ type: NcTypeRow; items: AccessoryShopItem[] } | null> {
  const types = await readNcTypes();
  const type = types.rows.find((t) => t.value === value && !t.archived_at && t.menu_group !== "merch");
  if (!type) return null;
  const rows = await readShopRows(value);
  if (rows.error) console.error("[accessory-type] stock read failed:", rows.error);
  return { type, items: accessoryTypeItems(rows.rows, value) };
}
