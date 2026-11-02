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
 *
 * Fix Phase 1.4 (G-44): each row also carries `held_qty` (migration 0308),
 * the units held for a customer-return destruction. Callers plan the draw on
 * sellableQty(on_hand_qty, held_qty), so a sale never takes a held unit.
 * Before 0308 the read retries without it (held_qty = 0, the old behaviour).
 *
 * Fix Phase 1.6b (G-24 req 2): the draw is FEFO, First-Expired First-Out:
 * the soonest-expiring Active lot first, lots with no expiry date after every
 * dated lot, then oldest created first (the old FIFO) as the tie-break. The
 * planner (sale-decrement-core buildLotDecrementPlan) consumes lots in the
 * order this read returns them, so both callers draw FEFO.
 */
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isMissingSizeLinkColumnError } from "@/lib/inventory/lot-size-link-store";
// Fix Phase 1.4 (G-44): held units (customer-return Destroy) are never drawn.
import { isMissingHeldQtyColumnError, toHeldNumber } from "@/lib/inventory/held-stock-core";

/**
 * register-sell-everything-fix-later - the lot statuses a sale draws from:
 * Active, Sold out (a stale count) and Quarantine (sold now, fixed later).
 * Recalled and Destroyed are never drawn.
 */
export const SALE_DRAW_LOT_STATUSES = ["active", "sold_out", "quarantine"] as const;

export type SaleLotRow = {
  id: string;
  pos_product_key: string | null;
  on_hand_qty: number;
  ccrs_inventory_external_id: string | null;
  lot_code: string | null;
  unit_cost_minor_units: number | null;
  menu_source_variant_id: string | null;
  /** Fix Phase 1.4 (G-44): units held for destruction (0 before migration 0308). */
  held_qty: number;
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
      // register-sell-sold-out-stock: a lot the Oct-30 count zeroed is
      // flipped back to Active by apply_lot_delta when units return; a
      // Sold out lot that still holds units is drawn like an Active one.
      // register-sell-everything-fix-later: the owner, "Everything must
      // sell. No exceptions." A lot still in Quarantine from intake (no COA,
      // manifest not finalized) is on the shelf and sells; it is on the
      // back office Fix later list. Recalled / destroyed are never drawn.
      .in("status", [...SALE_DRAW_LOT_STATUSES])
      // Fix Phase 0.2 (G-51): a sale never draws a trade sample lot, even
      // when it shares the product key (WAC 314-55-096(1)(i)).
      .eq("is_sample", false)
      .gt("on_hand_qty", 0)
      // Fix Phase 1.6b (G-24): FEFO, then the old FIFO as the tie-break.
      .order("expires_on", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
  // Try the fullest column set first; drop a column only when the error says
  // that exact column is missing (0294 size link, 0308 held quantity).
  let withHeld = true;
  let withSize = true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const cols = `${BASE}${withHeld ? ", held_qty" : ""}${withSize ? ", menu_source_variant_id" : ""}`;
    const res = await run(cols);
    if (!res.error) {
      const rows = ((res.data as unknown as Partial<SaleLotRow>[] | null) ?? []).map((r) => ({
        ...(r as SaleLotRow),
        menu_source_variant_id: withSize ? (r.menu_source_variant_id ?? null) : null,
        held_qty: withHeld ? toHeldNumber(r.held_qty) : 0,
      }));
      return { ok: true, rows, sizeLinkPending: !withSize };
    }
    if (withHeld && isMissingHeldQtyColumnError(res.error)) {
      withHeld = false;
      continue;
    }
    if (withSize && isMissingSizeLinkColumnError(res.error)) {
      withSize = false;
      continue;
    }
    return { ok: false, error: res.error.message };
  }
  return { ok: false, error: "Could not read the lots to draw from." };
}
