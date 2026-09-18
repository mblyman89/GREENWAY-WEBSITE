/**
 * src/lib/pos/pickup-store.ts  (POS Slice B28)
 *
 * Server flow for the register's ONLINE-ORDER PICKUP QUEUE: list website
 * pickup orders, show one order's lines at the counter, and LOAD an order
 * into a register sale.
 *
 * SLICE 17 - completion no longer happens here
 * --------------------------------------------
 * This module used to complete a handover directly (ID attestation checkbox
 * -> cash tender -> the shared completion gate). The owner asked for that
 * option to be removed: it decided a regulated handover on a boolean, while
 * the load-into-a-sale route put the same customer through the real ID gate
 * (id-scan-core: AAMVA parse, 21+, expiry, WAC 314-55-150 acceptable types,
 * audited manual entry).
 *
 * So a pickup is now finished by the ORDINARY sale path, which already does
 * everything the removed code did and does it after a verified ID: the day
 * ledger row, the inventory decrement, the loyalty accrual, the receipt
 * number the returns desk (B15/B16) and same-day void (B27) look up, and the
 * CCRS Sale.csv order row. Nothing is double-counted, because the register
 * sale supersedes the website order only when it completes (AM-D2).
 *
 * ONLINE-ONLY by design (the queue lives on the server). Money in MINOR
 * UNITS (cents) everywhere.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listOrders, getOrder } from "@/lib/orders/orders-store";
import {
  isPosMaterializedOrder,
  sortPickupQueue,
  toPickupQueueEntry,
  customerPickupLabel,
  type PickupQueueEntry,
} from "@/lib/pos/pickup-core";
import {
  toOrderOrigin,
  orderOriginLabel,
  isMarketplaceOrigin,
  type OrderOrigin,
} from "@/lib/orders/order-origin-core";
import { recordAudit } from "@/lib/auth/audit";
import { type LoadedOrderLine } from "@/lib/pos/order-to-cart-core";
import { getAccountByCustomer, listTiers } from "@/lib/loyalty/loyalty-store";
import { tierForPoints } from "@/lib/loyalty/engine";

// The queue only ever shows a screenful — the store is a single register shop.
const QUEUE_LIMIT = 50;

// ---------------------------------------------------------------------------
// Queue list
// ---------------------------------------------------------------------------

export type PickupQueueResult = { ok: true; queue: PickupQueueEntry[] } | { ok: false; error: string };

/**
 * Active website pickup orders for the register, counter-sorted (ready
 * first, oldest first). Register-materialized orders are excluded by the
 * staff_note contract; the per-order completion path re-checks against
 * pos_sale_events too (belt and suspenders).
 */
export async function listRegisterPickupQueue(): Promise<PickupQueueResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const orders = await listOrders({ status: "active", limit: QUEUE_LIMIT * 4 });
  const nowIso = new Date().toISOString();
  const entries = orders
    .filter((o) => !isPosMaterializedOrder(o.staff_note))
    .map((o) => toPickupQueueEntry(o, nowIso));
  return { ok: true, queue: sortPickupQueue(entries).slice(0, QUEUE_LIMIT) };
}

// ---------------------------------------------------------------------------
// Order detail (counter view)
// ---------------------------------------------------------------------------

export type PickupOrderDetail = {
  orderId: string;
  orderNumber: string;
  customerLabel: string;
  status: string;
  itemCount: number;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  customerNote: string | null;
  placedAtIso: string;
  lines: { productName: string; variantLabel: string | null; quantity: number; priceMinor: number }[];
  /**
   * SLICE L-12 - carried onto the counter view for the same reason it is
   * carried onto the queue tile: the budtender reading this pane is about to
   * hand cannabis to a human being, and whether Leafly or Greenway told that
   * human what to expect changes what the budtender should say.
   */
  origin: OrderOrigin;
  originLabel: string;
  isMarketplace: boolean;
};

export type PickupDetailResult = { ok: true; order: PickupOrderDetail } | { ok: false; error: string };

export async function getRegisterPickupOrder(orderId: string): Promise<PickupDetailResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const order = await getOrder(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isPosMaterializedOrder(order.staff_note)) {
    return { ok: false, error: "That order is a register sale, not a website pickup." };
  }
  const origin = toOrderOrigin(order.origin);
  return {
    ok: true,
    order: {
      orderId: order.id,
      orderNumber: order.order_number,
      customerLabel: customerPickupLabel(order.customer_first_name, order.customer_last_name),
      status: order.status,
      itemCount: order.item_count,
      subtotalMinor: order.subtotal_minor_units,
      taxMinor: order.estimated_tax_minor_units,
      totalMinor: order.total_minor_units,
      customerNote: (order.customer_note ?? "").trim() || null,
      placedAtIso: order.placed_at,
      lines: order.lines.map((l) => ({
        productName: l.product_name,
        variantLabel: l.variant_label,
        quantity: l.quantity,
        priceMinor: l.price_minor_units,
      })),
      origin,
      originLabel: orderOriginLabel(origin),
      isMarketplace: isMarketplaceOrigin(origin),
    },
  };
}

// ---------------------------------------------------------------------------
// Handover completion - REMOVED (SLICE 17)
// ---------------------------------------------------------------------------
//
// `completePickupAtRegister` used to finish a pickup straight from the queue,
// gated on `idConfirmed` - a checkbox. The owner asked for that option to be
// removed, and it was the weaker of two doors onto the same regulated act:
// the "load into a sale" route runs the real ID gate (id-scan-core: AAMVA
// parse, 21+, expiry, WAC 314-55-150 acceptable types, audited manual entry).
//
// The whole function is deleted rather than left unreferenced. An unused
// export that completes sales is a bypass waiting for a future caller; the
// only safe version of this code is the version that does not exist. Pickups
// now complete through the ordinary sale path, which already decrements
// inventory, accrues loyalty, writes the day ledger and prints the receipt.
//
// The route answers 410 Gone for the retired shape. See
// src/lib/pos/pickup-handover-core.ts and docs/slice-17-one-door-handover.md.


// ---------------------------------------------------------------------------
// Load into the register cart (Task AM-D)
// ---------------------------------------------------------------------------

export type LoadOrderResult =
  | {
      ok: true;
      /** The source website order's id — the register carries it and the sync
       *  supersedes this order ONLY when the register sale COMPLETES. */
      orderId: string;
      orderNumber: string;
      customerLabel: string;
      customerNote: string | null;
      /** Raw line ids + facts — the DEVICE rebuilds against its CURRENT bundle. */
      lines: LoadedOrderLine[];
      /**
       * The customer already linked to the order (customers.id), shaped like
       * a /api/pos/member hit so the register can attach them to the new
       * sale in one step. Null when the order has no linked profile.
       */
      member: { customerId: string; label: string; points: number; tierName: string | null } | null;
      /**
       * SLICE L-12 - origin follows the order INTO the sale.
       *
       * This is the field that matters most of the three, and it is the one
       * that is easiest to leave out, because by this point the order has
       * "become" a register sale and origin feels like history.
       *
       * It is not history. The owner asked what happens when "leafly cancels
       * an order already loaded into a register sale" - which is a question
       * that only has an answer if the sale still knows it came from Leafly.
       * `decideCancelPlan` (leafly/bridge-core.ts) encodes the enterprise
       * practice: never mutate a till mid-transaction, interrupt the cashier
       * with a blocking acknowledgement instead. An interruption cannot be
       * targeted at the right register if the register forgot which
       * marketplace it is serving.
       *
       * So the origin travels with the load, and the sale screen shows it for
       * as long as the sale is open.
       */
      origin: OrderOrigin;
      originLabel: string;
      isMarketplace: boolean;
    }
  | { ok: false; error: string };

/**
 * Load a website order INTO a register sale ("the customer is here and
 * wants to add items"). The order is NOT superseded at load time (owner
 * decision): loading is not selling, and cancelling on load LOST the order
 * and its revenue whenever the register sale was abandoned or the screen
 * locked before it was rung up. Instead the order stays ACTIVE and the
 * register carries its id (sourceOrderId) into the sale it is building; the
 * SYNC supersedes the website order (cancelled with the loud timeline note)
 * EXACTLY when the register sale COMPLETES and materializes its own order —
 * so the two can never both fulfill, and an abandoned load simply leaves the
 * website order untouched in the queue.
 *
 * The device rebuilds the cart lines against its CURRENT menu bundle
 * (order-to-cart-core.rebuildOrderCart) — fresh prices, live promotions,
 * vanished/out-of-stock lines dropped and reported. The website order's
 * prices are history, not a pricing source.
 */
export async function loadOrderIntoRegister(input: {
  orderId: string;
  deviceName: string;
  employeeName: string;
}): Promise<LoadOrderResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };

  const order = await getOrder(input.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isPosMaterializedOrder(order.staff_note)) {
    return { ok: false, error: "That order is a register sale, not a website pickup." };
  }
  const ACTIVE = new Set(["new", "acknowledged", "preparing", "ready"]);
  if (!ACTIVE.has(order.status)) {
    return { ok: false, error: `Order is ${order.status} — only an active website order can be loaded.` };
  }

  // ── Do NOT supersede on load (owner decision): the order stays ACTIVE and
  //    is only superseded when the register sale COMPLETES (sync-store), so a
  //    loaded-but-abandoned order is never lost. Leave a quiet timeline note
  //    that it was loaded so the timeline explains what happened next. ───────
  await recordAudit({
    actorId: null,
    actorEmail: `pos-load:${input.deviceName}`,
    action: "order.loaded_into_register",
    entityType: "order",
    entityId: order.id,
    after: {
      orderNumber: order.order_number,
      employeeName: input.employeeName,
      lineCount: order.lines.length,
      // The order is NOT superseded here; the register sale's completion does it.
      superseded: false,
    },
  });

  // ── Linked customer → one-tap member attach on the new sale ─────────────
  const admin = createSupabaseAdminClient();
  let member: { customerId: string; label: string; points: number; tierName: string | null } | null = null;
  const { data: orderRow } = await admin
    .from("orders")
    .select("customer_id")
    .eq("id", order.id)
    .maybeSingle<{ customer_id: string | null }>();
  if (orderRow?.customer_id) {
    const { data: c } = await admin
      .from("customers")
      .select("id, first_name, last_name")
      .eq("id", orderRow.customer_id)
      .maybeSingle<{ id: string; first_name: string; last_name: string | null }>();
    if (c) {
      try {
        const [account, tiers] = await Promise.all([getAccountByCustomer(c.id), listTiers()]);
        member = {
          customerId: c.id,
          label: customerPickupLabel(c.first_name, c.last_name),
          points: account?.balance_points ?? 0,
          tierName: tierForPoints(account?.lifetime_points ?? 0, tiers)?.name ?? null,
        };
      } catch {
        member = { customerId: c.id, label: customerPickupLabel(c.first_name, c.last_name), points: 0, tierName: null };
      }
    }
  }

  // The order's origin travels into the sale (L-12). Resolved from the SAME
  // row that was just validated above, not re-fetched, so the sale cannot
  // disagree with the queue tile the budtender tapped a second earlier.
  const loadedOrigin = toOrderOrigin(order.origin);

  return {
    ok: true,
    orderId: order.id,
    orderNumber: order.order_number,
    customerLabel: customerPickupLabel(order.customer_first_name, order.customer_last_name),
    customerNote: (order.customer_note ?? "").trim() || null,
    lines: order.lines.map((l) => ({
      productId: l.product_id,
      variantId: l.variant_id,
      productName: l.variant_label ? `${l.product_name} (${l.variant_label})` : l.product_name,
      quantity: l.quantity,
    })),
    member,
    origin: loadedOrigin,
    originLabel: orderOriginLabel(loadedOrigin),
    isMarketplace: isMarketplaceOrigin(loadedOrigin),
  };
}
