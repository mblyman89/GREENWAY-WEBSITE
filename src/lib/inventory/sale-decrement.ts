import "server-only";

/**
 * src/lib/inventory/sale-decrement.ts  (POS Slice B19)
 *
 * Server wrapper that applies the pure decrement plans when an order
 * COMPLETES. Called from setOrderStatus (completed transition) so EVERY
 * completion path — POS sync, back-office order screen, anything future —
 * reduces stock through one funnel, exactly like loyalty accrual.
 *
 * DESIGN RULES (mirrors accrueForOrder):
 *   - IDEMPOTENT per order: an `inventory_decremented` order_event is the
 *     marker; a re-complete (or the gate's idempotent short-circuit) never
 *     double-decrements.
 *   - NEVER BLOCKS COMPLETION: the sale legally happened at the counter; a
 *     stock-write hiccup must not strand the order. Failures are recorded on
 *     the order's event feed for humans.
 *   - Two layers, both best-effort and independently applied:
 *       menu_variants.inventory_level (+ item inventory_status recompute) on
 *       the PUBLISHED version, and inventory_lots.on_hand_qty FIFO by
 *       pos_product_key (lots flip status → 'sold_out' when drained, matching
 *       the intake-store vocabulary).
 *   - Sales deliberately do NOT write inventory_adjustments rows: migration
 *     0023 scopes that ledger to "every change to on-hand that ISN'T a sale";
 *     the completed order's own lines are the sale audit trail.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { getPublishedVersion } from "@/lib/pos/menu-version";
import {
  buildVariantDecrementPlan,
  buildLotDecrementPlan,
  summarizeDecrement,
  type SaleLineForDecrement,
  type ItemForDecrement,
  type VariantForDecrement,
  type LotForDecrement,
} from "@/lib/inventory/sale-decrement-core";
import { deriveInventoryExternalId } from "@/lib/compliance/ccrs-identifiers";
import { isCustomLineProductId } from "@/lib/pos/custom-sale-core";
// GW-011/GW-012: DB-latched idempotency marker + atomic quantity deltas.
import { isUniqueViolation } from "@/lib/db/rpc-fallback-core";
import { applyLotDelta, applyVariantDelta } from "@/lib/inventory/atomic-quantity";
// Product Mastering Slice 1: sold lines resolve the VARIANT's own lot key
// (mastered cards carry one lot per size) before the product_id fallback.
import { lotKeyForSaleLine, lotKeysForLines } from "@/lib/pos/variant-lot-core";
// R74 S31: one lot read shared with the cost replan (sale-posting-service).
import { readSaleLots } from "@/lib/inventory/sale-lot-read";
import { sellableQty } from "@/lib/inventory/held-stock-core";
// Fix Phase 4 (G-29 item 3; F-05b-1): Other Inventory lines ("nc-<uuid>")
// lower the catalog On hand with a ledger row, never a cannabis lot.
import { isNonCannabisProductId } from "@/lib/noncannabis/pos-catalog-core";
import { moveNcStockForOrder } from "@/lib/noncannabis/register-stock";

const EVENT_TYPE = "inventory_decremented";

export async function decrementInventoryForOrder(orderId: string): Promise<void> {
  if (!isSupabaseServiceConfigured) return;
  const admin = createSupabaseAdminClient();

  // Hoisted so the catch block can RELEASE a claimed-but-unfinished marker —
  // otherwise a mid-work crash would leave the latch held and a retry would
  // skip the decrement forever.
  let claimId: string | null = null;

  try {
    // ── Idempotency: one decrement per order, ever ─────────────────────────
    // Fast path: a SELECT spares the common re-complete the insert below.
    const { data: marker } = await admin
      .from("order_events")
      .select("id")
      .eq("order_id", orderId)
      .eq("event_type", EVENT_TYPE)
      .limit(1);
    if (marker && marker.length > 0) return;

    // GW-011: CLAIM the marker FIRST. Migration 0129's partial unique index
    // on (order_id, event_type) makes this insert the real latch — two
    // concurrent completions can both pass the SELECT above, but only ONE
    // can own this row; the loser sees 23505 and walks away without touching
    // stock. The plain-English summary is stamped onto this row at the end.
    const { data: claim, error: claimError } = await admin
      .from("order_events")
      .insert({
        order_id: orderId,
        event_type: EVENT_TYPE,
        note: "Inventory decrement in progress…",
        actor_label: "system",
      })
      .select("id")
      .single();
    if (claimError) {
      if (isUniqueViolation(claimError)) return; // another runner owns it
      throw new Error(`Could not claim the decrement marker: ${claimError.message}`);
    }
    claimId = (claim as { id: string }).id;

    const { data: lineRows } = await admin
      .from("order_lines")
      .select("id, product_id, variant_id, product_name, quantity")
      .eq("order_id", orderId);
    const allLines: SaleLineForDecrement[] = ((lineRows as
      | {
          id: string;
          product_id: string | null;
          variant_id: string | null;
          product_name: string;
          quantity: number;
        }[]
      | null) ?? [])
      // POS B39: keypad custom lines (reserved "pos-custom-*" keys) track no
      // stock by design - skip them so they never emit UNMATCHED noise or
      // burn lot inventory that was never behind them.
      .filter((r) => !isCustomLineProductId(r.product_id))
      .map((r) => ({
        lineId: r.id,
        productId: r.product_id,
        variantId: r.variant_id,
        productName: r.product_name,
        quantity: r.quantity,
      }));
    // Fix Phase 4 (G-29 item 3): Other Inventory lines move the catalog On
    // hand (one statement each, idempotent per line) and never reach the
    // cannabis menu / lot plans below.
    const ncMove = await moveNcStockForOrder(admin, orderId, allLines, "sale");
    const lines = allLines.filter((l) => !isNonCannabisProductId(l.productId));
    if (lines.length === 0) {
      await admin
        .from("order_events")
        .update({ note: (ncMove.summary || "Inventory decrement: no stock-tracked lines on this order.").slice(0, 2000) })
        .eq("id", claimId);
      return;
    }

    const productKeys = [...new Set(lines.map((l) => l.productId).filter((k): k is string => !!k))];

    // ── Layer 1: published menu ────────────────────────────────────────────
    let items: ItemForDecrement[] = [];
    let variants: VariantForDecrement[] = [];
    const version = await getPublishedVersion();
    if (version && productKeys.length > 0) {
      const { data: itemRows } = await admin
        .from("menu_items")
        .select("id, source_item_id, inventory_status")
        .eq("menu_version_id", version.id)
        .in("source_item_id", productKeys);
      items = ((itemRows as { id: string; source_item_id: string; inventory_status: string }[] | null) ?? []).map(
        (r) => ({ rowId: r.id, sourceItemId: r.source_item_id, inventoryStatus: r.inventory_status }),
      );
      if (items.length > 0) {
        const { data: variantRows } = await admin
          .from("menu_variants")
          .select("id, menu_item_id, source_variant_id, label, inventory_level")
          .in("menu_item_id", items.map((i) => i.rowId));
        variants = ((variantRows as
          | { id: string; menu_item_id: string; source_variant_id: string; label: string; inventory_level: number }[]
          | null) ?? []).map((r) => ({
          rowId: r.id,
          menuItemRowId: r.menu_item_id,
          sourceVariantId: r.source_variant_id,
          label: r.label,
          inventoryLevel: r.inventory_level,
        }));
      }
    }
    const variantPlan = buildVariantDecrementPlan(lines, items, variants);
    for (const u of variantPlan.variantUpdates) {
      // GW-012: atomic DB delta (deltas combine under concurrency; the old
      // absolute write let two overlapping sales overwrite each other).
      // Falls back to the plan's absolute pre-0129.
      await applyVariantDelta(admin, {
        variantRowId: u.rowId,
        delta: u.delta,
        fallbackAbsoluteLevel: u.newLevel,
      });
    }
    for (const u of variantPlan.itemStatusUpdates) {
      await admin.from("menu_items").update({ inventory_status: u.newStatus }).eq("id", u.rowId);
    }

    // ── Layer 2: inventory lots (FIFO oldest-first, active only) ──────────
    // Mastering Slice 1: load lots for BOTH the card keys and each variant's
    // own encoded lot key (single-lot cards: identical set, so nothing new
    // is fetched; mastered cards: every size's lot is present for the plan).
    const lotKeys = lotKeysForLines(lines);
    let lots: LotForDecrement[] = [];
    // R74 S31: the shared reader (the cost replan uses the same one) also
    // carries each lot's size link (0294) so a sold size draws from its own lots.
    let sizeLinkPending = false;
    const heldByLot = new Map<string, number>();
    if (lotKeys.length > 0) {
      const read = await readSaleLots(admin, lotKeys);
      if (!read.ok) throw new Error(`Could not read the lots to draw from: ${read.error}`);
      sizeLinkPending = read.sizeLinkPending;
      for (const r of read.rows) if (r.held_qty > 0) heldByLot.set(r.id, r.held_qty);
      lots = read.rows
        .filter((r) => !!r.pos_product_key)
        .map((r) => ({
          id: r.id,
          posProductKey: r.pos_product_key as string,
          // Fix Phase 1.4 (G-44): plan on SELLABLE units; held units are never drawn.
          onHandQty: sellableQty(r.on_hand_qty, r.held_qty),
          // The lot's canonical CCRS id — identical derivation to the weekly
          // Sale.csv builder's lot index (explicit → lot_code → key → LOT-id).
          ccrsExternalId: deriveInventoryExternalId({
            ccrs_inventory_external_id: r.ccrs_inventory_external_id,
            pos_product_key: r.pos_product_key,
            lot_code: r.lot_code,
            id: r.id,
          }),
          sizeId: r.menu_source_variant_id,
        }));
    }
    const lotPlan = buildLotDecrementPlan(lines, lots);
    for (const u of lotPlan.lotUpdates) {
      // GW-012: atomic clamped delta; the DB flips active→sold_out at 0
      // itself. Falls back to the plan's absolute + status pre-0129.
      // Fix Phase 1.4 (G-44): the plan ran on sellable units, so the absolute
      // fallback adds the held units back (they stay on hand) and a lot that
      // still holds units is never marked Sold out.
      const held = heldByLot.get(u.id) ?? 0;
      await applyLotDelta(admin, {
        lotId: u.id,
        delta: u.delta,
        clamp: true,
        fallbackAbsolute:
          u.soldOut && held <= 0
            ? { onHandQty: u.newOnHand, status: "sold_out" }
            : { onHandQty: u.newOnHand + held },
      });
    }

    // ── POS B20: stamp each line's CCRS InventoryExternalIdentifier ───────
    // The FIRST (oldest) lot the FIFO consumption drew from is the id the
    // weekly Sale.csv should carry — resolveSaleInventoryExternalId then
    // reports source "line" (exact) instead of the product_key fallback.
    // Only fills blanks: an explicit per-line override is never overwritten.
    for (const line of lines) {
      // Same key the plan aggregated the line's demand under (variant-first).
      // R74 S31: the line's own size group first (two sizes of one card stamp
      // their own lots), then the per-key id (the pre-S31 behaviour).
      const key = lotKeyForSaleLine(line);
      const extId = lotPlan.lineExternalIdsByLine?.get(line.lineId) ?? (key ? lotPlan.lineExternalIds.get(key) : undefined);
      if (!extId) continue;
      await admin
        .from("order_lines")
        .update({ ccrs_inventory_external_id: extId })
        .eq("id", line.lineId)
        .is("ccrs_inventory_external_id", null);
    }

    // ── Human trail: stamp the claimed marker with the real summary ───────
    // (The latch row itself was inserted FIRST — see the claim above.)
    await admin
      .from("order_events")
      .update({
        note: (
          summarizeDecrement({ variantPlan, lotPlan, lineCount: lines.length }) +
          (ncMove.summary ? ` ${ncMove.summary}` : "") +
          (sizeLinkPending ? " (Lot sizes not read: database update 0294 is not applied, so stock came from the oldest lots of the product.)" : "")
        ).slice(0, 2000),
      })
      .eq("id", claimId);
  } catch (err) {
    // Never block or throw past completion — leave a visible failure note.
    const reason = err instanceof Error ? err.message : String(err);
    try {
      if (claimId) {
        // The latch was claimed and SOME quantities may already be written.
        // Keep the latch held (releasing it would let a retry decrement the
        // already-applied part AGAIN) and stamp it with the failure so the
        // timeline tells staff exactly what to do.
        await admin
          .from("order_events")
          .update({
            note: `Inventory decrement FAILED partway (${reason}). The latch is kept so a retry cannot double-decrement — reconcile this order's stock with a cycle count.`.slice(0, 2000),
          })
          .eq("id", claimId);
      } else {
        await admin.from("order_events").insert({
          order_id: orderId,
          event_type: "note",
          note: `Inventory decrement FAILED (stock not reduced — run a cycle count or retry): ${reason}`.slice(0, 2000),
          actor_label: "system",
        });
      }
    } catch {
      // Swallow — completion must survive even a note failure.
    }
  }
}
