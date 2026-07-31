/**
 * menu-doh-server.ts — SLICE D (SHOP-4): server-side DOH-compliance attachment
 * for the live public menu.
 *
 * Reads the durable medical_product_registry (migration 0113) for the menu's
 * item ids and overlays `dohCompliant` + `dohCategory` onto each public menu
 * item via the pure core. The registry is keyed by the STABLE POS product key
 * (= the item's `id` = menu_items.source_item_id), the same key the medical
 * checkout uses, so the public flag and the register agree by construction.
 *
 * Degrades gracefully: getMedicalRegistryForKeys() already returns an EMPTY map
 * when Supabase is not configured OR migration 0113 has not been applied yet
 * (it swallows the missing-schema error), so an un-migrated build simply marks
 * every item not-compliant — the honest default, no badge until a product is
 * actually verified. Ships WORKING pre-migration.
 *
 * Kept separate from menu-doh-core.ts (the pure overlay + labels) so the core
 * stays client-safe and unit-testable without server-only imports — the same
 * split as strain-terpenes-server.ts vs strain-terpenes.ts.
 */
import "server-only";

import type { GreenwayMenuItem } from "@/lib/leafly/types";
import { getMedicalRegistryForKeys } from "@/lib/medical/sale-store";
import { attachDohCompliance } from "@/lib/menu/menu-doh-core";

/**
 * Attach DOH-compliance to menu items using the durable registry. One batched,
 * chunked read keyed by the items' ids; degrades to "no DOH" on an
 * unconfigured / un-migrated build. Non-mutating (the pure core returns new
 * objects).
 */
export async function withDohCompliance<T extends GreenwayMenuItem>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;
  const registry = await getMedicalRegistryForKeys(items.map((item) => item.id));
  return attachDohCompliance(items, registry);
}
