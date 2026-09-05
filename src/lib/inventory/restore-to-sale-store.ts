import "server-only";

/**
 * src/lib/inventory/restore-to-sale-store.ts   (SLICE 18)
 *
 * The write side of "restore to sale" — the undo the 86 button never had.
 *
 * Owner: "I will test that while you build the proper restore to sale button."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 *
 * Finds the product's card on the PUBLISHED menu version, reads the live lots
 * behind it, and hands both to the pure `decideRestore`. If (and only if) the
 * pure core says yes, it writes the RECOMPUTED status — the one derived from
 * the units that actually exist — and audits the change with the same shape
 * the 86 itself records, so the two halves of the story sit together in the
 * audit log.
 *
 * WHAT IT REFUSES TO DO
 *
 * Invent stock. The original `/api/pos/stock-flag` was one-way precisely so a
 * register could never manufacture inventory, and that instinct was right.
 * This keeps the property: the status written is computed by `statusForUnits`
 * from active lots, so restoring an item with an empty shelf recomputes to
 * "unavailable" and the call reports, truthfully, that nothing changed.
 *
 * Every failure is reported as a refusal with a reason. Nothing here guesses.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pagedAll } from "@/lib/supabase/chunked-in";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import { recalledProductKeys } from "@/lib/pos/recall-hold-store";
import { recordAudit } from "@/lib/auth/audit";
import {
  decideRestore,
  restoreSummary,
  type RestoreLotFact,
} from "@/lib/inventory/restore-to-sale-core";

export type RestoreToSaleResult =
  | { ok: true; message: string; productName: string; nextStatus: string; units: number }
  | { ok: false; message: string };

type MenuItemRow = {
  id: string;
  name: string | null;
  source_item_id: string | null;
  inventory_status: string | null;
  hidden: boolean | null;
};

type LotRow = { status: string | null; on_hand_qty: number | string | null };

/**
 * Put an 86'd product back on sale, at a status computed from live stock.
 *
 * @param productKey the card's `source_item_id` (== `inventory_lots.pos_product_key`)
 * @param actor      who is doing this, for the audit row
 */
export async function restoreProductToSale(
  productKey: string,
  actor: { userId: string | null; email: string | null },
): Promise<RestoreToSaleResult> {
  const key = (productKey ?? "").trim();
  if (!key) return { ok: false, message: "No product was specified." };
  if (!isSupabaseServiceConfigured) {
    return { ok: false, message: "Database not configured — cannot restore." };
  }

  const version = await getPublishedVersion();
  if (!version) {
    return { ok: false, message: "There is no published menu to update." };
  }

  const admin = createSupabaseAdminClient();

  // ── The card on the published snapshot ────────────────────────────────────
  const { data: itemRows, error: itemError } = await admin
    .from("menu_items")
    .select("id, name, source_item_id, inventory_status, hidden")
    .eq("menu_version_id", version.id)
    .eq("source_item_id", key)
    .limit(2);

  if (itemError) {
    return { ok: false, message: `Could not read the menu item: ${itemError.message}` };
  }
  const items = (itemRows as MenuItemRow[] | null) ?? [];
  const item = items[0];
  if (!item) {
    return {
      ok: false,
      message: "That product is not on the published menu — publish the menu first, then restore it.",
    };
  }

  // ── Live lots behind that card ────────────────────────────────────────────
  // Paged: PostgREST caps a response at 1,000 rows regardless of .limit(),
  // and a product with many lots must not be judged on a truncated read.
  // A read error here must NOT be read as "no stock" - that would produce a
  // wrong refusal. `lotReadFailed` makes the failure explicit and we refuse
  // to decide at all rather than decide on incomplete facts.
  let lotReadFailed = false;
  const lotRows = await pagedAll<LotRow>(async (from, to) => {
    const { data, error } = await admin
      .from("inventory_lots")
      .select("status, on_hand_qty")
      .eq("pos_product_key", key)
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      lotReadFailed = true;
      return [];
    }
    return (data as LotRow[] | null) ?? [];
  });
  if (lotReadFailed) {
    return { ok: false, message: "Could not read this product's inventory lots - try again in a moment." };
  }
  const lots: RestoreLotFact[] = lotRows.map((r) => ({ status: r.status, onHandQty: r.on_hand_qty }));

  // ── AN-7 recall holds ─────────────────────────────────────────────────────
  let recalled = false;
  try {
    // failClosed: a truncated or failed recall read THROWS instead of
    // quietly returning an empty set. Putting a product back on sale is
    // exactly the moment never to assume "probably not recalled".
    const keys = await recalledProductKeys({ failClosed: true });
    recalled = keys.has(key);
  } catch {
    // A recall check that FAILS must not be read as "not recalled". Refuse.
    return {
      ok: false,
      message: "Could not confirm this product is free of recall holds — not restoring. Try again in a moment.",
    };
  }

  // ── The decision is entirely pure and entirely tested ─────────────────────
  const productName = (item.name ?? "").trim() || "That product";
  const decision = decideRestore({
    currentStatus: item.inventory_status,
    lots,
    recalled,
    hidden: item.hidden === true,
  });

  if (!decision.restore) {
    return { ok: false, message: restoreSummary(productName, decision) };
  }

  // Snapshot the OLD status before the write. The audit's whole value is that
  // it records what the card looked like beforehand, so that value must be
  // captured while it is still true rather than re-read off `item` afterwards.
  const previousStatus = item.inventory_status;

  const { error: updateError } = await admin
    .from("menu_items")
    .update({ inventory_status: decision.nextStatus })
    .eq("id", item.id);
  if (updateError) {
    return { ok: false, message: `Could not update the item: ${updateError.message}` };
  }

  // Mirrors the `pos.stock_flag` audit shape so the kill and the undo read as
  // one story in the log.
  await recordAudit({
    actorId: actor.userId,
    actorEmail: actor.email ?? "admin",
    action: "inventory.restore_to_sale",
    entityType: "menu_item",
    entityId: item.id,
    after: {
      via: "back_office",
      productKey: key,
      productName: item.name,
      previousStatus,
      newStatus: decision.nextStatus,
      // The evidence the decision rested on, so the audit row can be checked
      // later without re-deriving it.
      sellableUnits: decision.units,
      activeLotCount: lots.filter((l) => (l.status ?? "").trim().toLowerCase() === "active").length,
    },
  });

  return {
    ok: true,
    message: restoreSummary(productName, decision),
    productName,
    nextStatus: decision.nextStatus,
    units: decision.units,
  };
}
