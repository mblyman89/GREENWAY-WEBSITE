import "server-only";
/**
 * src/lib/inventory/sale-lot-read.ts  (R74 S31)
 *
 * The ONE read of the lots a sale may draw from. Both the stock decrement
 * (sale-decrement.ts) and the cost replan (sale-posting-service.ts) call it,
 * so "same lines + same lots + same planner = the same draw" holds by
 * construction rather than by two queries kept in step by hand.
 *
 * Filters are the long-standing ones: the keys, status active, on hand > 0,
 * oldest first. S31 adds each lot's menu SIZE link (0294,
 * menu_source_variant_id). Before 0294 is applied the read retries without
 * it and reports `sizeLinkPending` (the draw is then exactly the pre-S31 FIFO).
 */
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingSizeLinkColumnError } from "@/lib/inventory/lot-size-link-store";

export type SaleLotRow = {
  id: string;
  pos_product_key: string | null;
  on_hand_qty: number;
  ccrs_inventory_external_id: string | null;
  lot_code: string | null;
  unit_cost_minor_units: number | null;
  menu_source_variant_id: string | null;
};

export type SaleLotRead =
  | { ok: true; rows: SaleLotRow[]; sizeLinkPending: boolean }
  | { ok: false; error: string };

const BASE = "id, pos_product_key, on_hand_qty, ccrs_inventory_external_id, lot_code, unit_cost_minor_units";

export async function readSaleLots(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  keys: readonly string[],
): Promise<SaleLotRead> {
  if (keys.length === 0) return { ok: true, rows: [], sizeLinkPending: false };
  const run = (cols: string) =>
    admin
      .from("inventory_lots")
      .select(cols)
      .in("pos_product_key", [...keys])
      .eq("status", "active")
      // Fix Phase 0.2 (G-51): a sale never draws a trade sample lot, even
      // when it shares the product key (WAC 314-55-096(1)(i)).
      .eq("is_sample", false)
      .gt("on_hand_qty", 0)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
  const first = await run(`${BASE}, menu_source_variant_id`);
  if (!first.error) {
    return { ok: true, rows: (first.data as unknown as SaleLotRow[] | null) ?? [], sizeLinkPending: false };
  }
  if (!isMissingSizeLinkColumnError(first.error)) return { ok: false, error: first.error.message };
  const second = await run(BASE);
  if (second.error) return { ok: false, error: second.error.message };
  const rows = ((second.data as unknown as Omit<SaleLotRow, "menu_source_variant_id">[] | null) ?? []).map((r) => ({
    ...r,
    menu_source_variant_id: null,
  }));
  return { ok: true, rows, sizeLinkPending: true };
}
