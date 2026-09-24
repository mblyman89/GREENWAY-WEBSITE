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
import { listOrders, getOrder, setOrderStatus } from "@/lib/orders/orders-store";
import { resolveOrderDisplay } from "@/lib/orders/order-name-pool-core";
import {
  buildPickupDetailBreakdown,
  readLeaflyCart,
  registerCancelReasonLabel,
  type PickupDetailLine,
  type PickupLineInput,
  type RegisterCancelReason,
} from "@/lib/pos/pickup-detail-core";
import { exciseTaxLabel, salesTaxLabel } from "@/lib/pos/receipt-tax-core";
import { loadMenuFactsByProductId, loadMenuFactsByLeaflyVariantId } from "@/lib/pos/pickup-menu-facts";
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
import {
  leaflyStatusForTarget,
  localStatusForLeafly,
  planLeaflyPushes,
  registerAdvanceActorLabel,
  registerAdvanceVerdict,
  type RegisterAdvanceTarget,
} from "@/lib/pos/pickup-progress-core";
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
 * Active website pickup orders for the register, NEWEST FIRST (SLICE L-36). Register-materialized orders are excluded by the
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
  /**
   * SLICE L-36 - the full breakdown the owner asked for. `lines` above is
   * kept exactly as it was so a register still running an older bundle keeps
   * working; `items` is the rich version.
   */
  displayName: string;
  items: PickupDetailLine[];
  /** What the items would have cost with no discounts. */
  regularTotalMinor: number;
  dealDiscountMinor: number;
  loyaltyDiscountMinor: number;
  /** "Loyalty code ABC123" / "Gold tier pricing", when a loyalty discount applied. */
  loyaltyLabel: string | null;
  /** Savings the order recorded at placement (orders.savings_minor_units). */
  savingsMinor: number;
  /**
   * Itemized tax lines summing to taxMinor, or null when the split cannot be
   * trusted (then the single taxMinor figure is the whole truth).
   * Website: excise vs state+local sales (RCW 69.50.535(1)(a)).
   * Leafly: Leafly's own tax components, as Leafly charged them.
   */
  taxLines: { label: string; amountMinor: number }[] | null;
  /** True when line prices EXCLUDE tax (Leafly), false when tax-inclusive (ours). */
  pricesExcludeTax: boolean;
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
  const marketplace = isMarketplaceOrigin(origin);
  const rich = await buildRichDetail(order, marketplace);
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
      isMarketplace: marketplace,
      displayName: resolveOrderDisplay(order.display_name ?? null, order.order_number),
      savingsMinor: Math.max(0, order.savings_minor_units ?? 0),
      ...rich,
    },
  };
}

type LoyaltyColumns = {
  loyalty_kind?: string | null;
  loyalty_code?: string | null;
  loyalty_tier_label?: string | null;
  loyalty_discount_minor_units?: number | null;
};

/**
 * The rich half of the counter view.
 *
 * WEBSITE orders: the stored lines (tax-inclusive prices, regular price and
 * per-unit loyalty snapshots) + the menu row each line was sold from.
 *
 * LEAFLY orders: the local order lines are a bare copy (name, size, qty,
 * price), so the breakdown is read from Leafly's own stored payload instead -
 * brand, category, original price, savings and deal title per item, and
 * Leafly's tax components. Leafly's subtotal is "before taxes", so its prices
 * exclude tax and our inclusive-price excise split is NOT applied to them;
 * Leafly's own itemization is shown instead. If the payload cannot be read,
 * the local lines are shown with dashes - never invented detail.
 */
async function buildRichDetail(
  order: Awaited<ReturnType<typeof getOrder>> & object,
  marketplace: boolean,
): Promise<Pick<
  PickupOrderDetail,
  "items" | "regularTotalMinor" | "dealDiscountMinor" | "loyaltyDiscountMinor" | "loyaltyLabel" | "taxLines" | "pricesExcludeTax"
>> {
  const loyalty = order as unknown as LoyaltyColumns;
  const loyaltyLabel =
    (loyalty.loyalty_discount_minor_units ?? 0) > 0
      ? loyalty.loyalty_kind === "code" && loyalty.loyalty_code
        ? `Loyalty code ${loyalty.loyalty_code}`
        : loyalty.loyalty_kind === "tier" && loyalty.loyalty_tier_label
          ? `${loyalty.loyalty_tier_label} tier pricing`
          : "Loyalty discount"
      : null;

  if (marketplace) {
    const cart = await readLeaflyCartForLocalOrder(order.id);
    if (cart && cart.lines.length > 0) {
      const menu = await loadMenuFactsByLeaflyVariantId(cart.lines.map((l) => l.integratorVariantId));
      const inputs: PickupLineInput[] = cart.lines.map((l) => {
        const facts = l.integratorVariantId ? menu.get(l.integratorVariantId) : undefined;
        return {
          productId: l.integratorVariantId,
          productName: l.name,
          brand: l.brandName,
          variantLabel: l.variantLabel,
          // OUR category from the matched menu row; Leafly's word is shown
          // only as a fallback label and never drives tax logic.
          category: facts?.category ?? null,
          categoryLabelFallback: l.leaflyCategory,
          quantity: l.quantity,
          lineTotalMinor: l.lineTotalMinor,
          regularLineTotalMinor: l.regularLineTotalMinor,
          loyaltyLineMinor: null,
          dealLabel: l.dealTitle,
        };
      });
      const b = buildPickupDetailBreakdown(inputs, menu, order.estimated_tax_minor_units, { splitTax: false });
      const taxSum = cart.taxes.reduce((a, t) => a + t.amountMinor, 0);
      return {
        items: b.lines,
        regularTotalMinor: b.regularTotalMinor,
        dealDiscountMinor: b.dealDiscountMinor,
        loyaltyDiscountMinor: 0,
        loyaltyLabel: null,
        // Shown only when Leafly's components add up to the tax on the order.
        taxLines: cart.taxes.length > 0 && taxSum === order.estimated_tax_minor_units ? cart.taxes.map((t) => ({ label: t.label, amountMinor: t.amountMinor })) : null,
        pricesExcludeTax: true,
      };
    }
  }

  const menu = marketplace ? new Map() : await loadMenuFactsByProductId(order.lines.map((l) => l.product_id));
  const lineLoyalty = (l: unknown) => {
    const v = (l as { loyalty_discount_minor_units?: number | null }).loyalty_discount_minor_units;
    return typeof v === "number" && v > 0 ? v : 0;
  };
  const inputs: PickupLineInput[] = order.lines.map((l) => ({
    productId: l.product_id,
    productName: l.product_name,
    brand: l.brand,
    variantLabel: l.variant_label,
    category: l.category ?? null,
    quantity: l.quantity,
    lineTotalMinor: l.price_minor_units * l.quantity,
    regularLineTotalMinor: l.regular_price_minor_units == null ? null : l.regular_price_minor_units * l.quantity,
    loyaltyLineMinor: lineLoyalty(l) * l.quantity,
  }));
  const b = buildPickupDetailBreakdown(inputs, menu, order.estimated_tax_minor_units, { splitTax: !marketplace });
  const taxLines: { label: string; amountMinor: number }[] = [];
  if (b.taxSplit) {
    if (b.taxSplit.anyExcise) taxLines.push({ label: exciseTaxLabel(), amountMinor: b.taxSplit.exciseMinor });
    if (b.taxSplit.anySales) taxLines.push({ label: salesTaxLabel(), amountMinor: b.taxSplit.salesMinor });
  }
  return {
    items: b.lines,
    regularTotalMinor: b.regularTotalMinor,
    dealDiscountMinor: b.dealDiscountMinor,
    loyaltyDiscountMinor: b.loyaltyDiscountMinor,
    loyaltyLabel,
    taxLines: b.taxSplit && taxLines.length > 0 ? taxLines : null,
    pricesExcludeTax: marketplace,
  };
}

/** Leafly's stored cart for the local order it became, or null. */
async function readLeaflyCartForLocalOrder(localOrderId: string): Promise<ReturnType<typeof readLeaflyCart> | null> {
  try {
    const admin = createSupabaseAdminClient();
    const { data } = await admin
      .from("leafly_orders")
      .select("raw_order")
      .eq("local_order_id", localOrderId)
      .limit(1)
      .maybeSingle<{ raw_order: unknown }>();
    return data ? readLeaflyCart(data.raw_order) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cancel from the register (SLICE L-36)
// ---------------------------------------------------------------------------

export type CancelPickupResult =
  | { ok: true; orderNumber: string; displayName: string; message: string }
  | { ok: false; error: string };

/**
 * Cancel an ACTIVE online order from the register, after the route has
 * verified a manager/lead PIN.
 *
 * WEBSITE orders go through `setOrderStatus(..., "cancelled")` - the SAME
 * store call the back-office dashboard uses, so the lifecycle matrix, the
 * order timeline event and the loyalty-code release all happen exactly as
 * they would there.
 *
 * LEAFLY orders are cancelled AT LEAFLY first, through the same
 * `setLeaflyOrderStatus` the back-office board uses. That call records the
 * outbound attempt (which the Online Orders report reads), stores Leafly's
 * post-change order (so the report sees `canceled`), and closes our local
 * order through `onLeaflyOrderClosed`. If Leafly refuses or cannot be
 * reached, NOTHING is cancelled locally and the budtender is told why:
 * cancelling only our copy would leave the customer holding a live Leafly
 * order that we silently dropped.
 */
export async function cancelPickupAtRegister(input: {
  orderId: string;
  reason: RegisterCancelReason;
  approverName: string;
  deviceName: string;
  employeeName: string;
}): Promise<CancelPickupResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const order = await getOrder(input.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isPosMaterializedOrder(order.staff_note)) {
    return { ok: false, error: "That order is a register sale, not an online order - use Returns / Void instead." };
  }
  const ACTIVE = new Set(["new", "acknowledged", "preparing", "ready"]);
  if (!ACTIVE.has(order.status)) {
    return { ok: false, error: `Order is already ${order.status} - only an active online order can be cancelled.` };
  }

  const displayName = resolveOrderDisplay(order.display_name ?? null, order.order_number);
  const reasonLabel = registerCancelReasonLabel(input.reason);
  const actorLabel = `${input.approverName} (manager PIN) at ${input.deviceName}, requested by ${input.employeeName}`;
  const note = `Cancelled at the register: ${reasonLabel}.`;
  const origin = toOrderOrigin(order.origin);
  let message = `${displayName} cancelled.`;
  let leaflyOutcome: string | null = null;

  if (isMarketplaceOrigin(origin)) {
    const admin = createSupabaseAdminClient();
    const { data: lf } = await admin
      .from("leafly_orders")
      .select("leafly_order_id, leafly_status, acknowledged_at")
      .eq("local_order_id", order.id)
      .limit(1)
      .maybeSingle<{ leafly_order_id: string; leafly_status: string | null; acknowledged_at: string | null }>();
    if (!lf) {
      return {
        ok: false,
        error: "This Leafly order has no Leafly record linked to it, so it was NOT cancelled. Cancel it from the back-office Orders board.",
      };
    }
    const already = (lf.leafly_status ?? "").trim().toLowerCase();
    if (already === "canceled" || already === "expired") {
      leaflyOutcome = `already ${already} at Leafly`;
    } else {
      const { setLeaflyOrderStatus } = await import("@/lib/leafly/order-ack-server");
      const pushed = await setLeaflyOrderStatus({
        order: { leafly_order_id: lf.leafly_order_id, leafly_status: lf.leafly_status, acknowledged_at: lf.acknowledged_at },
        nextStatus: "canceled",
        cancelationReasonCode: input.reason,
        // staff_profiles FK - a register PIN is an employees row, not a staff
        // profile, so the attempt is attributed through the audit log instead.
        staffId: null,
      });
      if (!pushed.ok) {
        await recordAudit({
          actorId: null,
          actorEmail: `pos-cancel:${input.deviceName}`,
          action: "order.register_cancel_failed",
          entityType: "order",
          entityId: order.id,
          after: { orderNumber: order.order_number, displayName, reason: input.reason, approver: input.approverName, employee: input.employeeName, leafly: pushed.message },
        });
        return { ok: false, error: `Leafly did not accept the cancel, so nothing was changed: ${pushed.message}` };
      }
      leaflyOutcome = "cancelled at Leafly";
      if (pushed.warning) message += ` Note: ${pushed.warning}`;
    }
  }

  // Close OUR order. For a Leafly order the push above normally already did
  // (onLeaflyOrderClosed); setOrderStatus then reports a no-op, which is
  // fine. For a website order this is the whole cancel.
  const closed = await setOrderStatus(order.id, "cancelled", { actorId: null, actorLabel, note });
  if (!closed.ok) {
    const { data: now } = await createSupabaseAdminClient()
      .from("orders")
      .select("status")
      .eq("id", order.id)
      .maybeSingle<{ status: string }>();
    if (now?.status !== "cancelled") {
      return {
        ok: false,
        error: `${leaflyOutcome ? `Leafly: ${leaflyOutcome}. ` : ""}Our copy of the order could not be closed (${closed.refusal ?? "database error"}). Close it from the back office.`,
      };
    }
  }

  await recordAudit({
    actorId: null,
    actorEmail: `pos-cancel:${input.deviceName}`,
    action: "order.cancelled_at_register",
    entityType: "order",
    entityId: order.id,
    after: {
      orderNumber: order.order_number,
      displayName,
      origin,
      reason: input.reason,
      approver: input.approverName,
      employee: input.employeeName,
      leafly: leaflyOutcome,
    },
  });

  if (leaflyOutcome) message += ` Leafly: ${leaflyOutcome}.`;
  return { ok: true, orderNumber: order.order_number, displayName, message };
}

// ---------------------------------------------------------------------------
// Confirm / Ready from the register (SLICE L-37)
// ---------------------------------------------------------------------------

export type AdvancePickupResult =
  | { ok: true; orderNumber: string; displayName: string; status: string; message: string }
  | { ok: false; error: string };

/**
 * Move an ACTIVE online order forward from the register: Confirm
 * (-> acknowledged) or Mark ready (-> ready). Any budtender may do this - it
 * is the same step anyone with the back office open does with one click, and
 * it moves no money and releases no product.
 *
 * LEAFLY FIRST, then ours - the same order as the L-36 cancel, for the same
 * reason: telling OUR board "ready" while Leafly still tells the shopper
 * "confirmed" is the two-sets-of-books problem L-31 fixed. Leafly is walked
 * one step at a time (planLeaflyPushes): a still-pending order being marked
 * ready is sent `confirmed` and then `ready`, because the shopper's emails
 * hang off each step. If Leafly refuses a step, our order moves only as far as
 * Leafly actually went, and the budtender is told exactly where it stopped.
 *
 * WEBSITE orders are a single `setOrderStatus` call - the SAME store call the
 * back-office "Mark ..." button uses - so the timeline event, the lifecycle
 * matrix and the timestamps are identical to a back-office press, with the
 * register named as the actor.
 */
export async function advancePickupAtRegister(input: {
  orderId: string;
  to: RegisterAdvanceTarget;
  deviceName: string;
  employeeName: string;
}): Promise<AdvancePickupResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const order = await getOrder(input.orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isPosMaterializedOrder(order.staff_note)) {
    return { ok: false, error: "That order is a register sale, not an online order." };
  }
  const verdict = registerAdvanceVerdict(order.status, input.to);
  if (!verdict.allowed) return { ok: false, error: verdict.reason };

  const displayName = resolveOrderDisplay(order.display_name ?? null, order.order_number);
  const origin = toOrderOrigin(order.origin);
  const actorLabel = registerAdvanceActorLabel(input.employeeName, input.deviceName);
  const auditFail = async (why: string, extra: Record<string, unknown> = {}) => {
    await recordAudit({
      actorId: null,
      actorEmail: `pos-advance:${input.deviceName}`,
      action: "order.register_advance_failed",
      entityType: "order",
      entityId: order.id,
      after: { orderNumber: order.order_number, displayName, to: input.to, employee: input.employeeName, why, ...extra },
    });
  };

  // How far the LOCAL order may move. Website: all the way. Leafly: as far
  // as Leafly actually went.
  let localTarget: RegisterAdvanceTarget = input.to;
  let leaflyOutcome: string | null = null;
  let partialError: string | null = null;
  const warnings: string[] = [];

  if (isMarketplaceOrigin(origin)) {
    const admin = createSupabaseAdminClient();
    const { data: lf } = await admin
      .from("leafly_orders")
      .select("leafly_order_id, leafly_status, acknowledged_at")
      .eq("local_order_id", order.id)
      .limit(1)
      .maybeSingle<{ leafly_order_id: string; leafly_status: string | null; acknowledged_at: string | null }>();
    if (!lf) {
      await auditFail("no linked Leafly record");
      return {
        ok: false,
        error: "This Leafly order has no Leafly record linked to it, so nothing was changed. Move it from the back-office Orders board.",
      };
    }
    if ((lf.acknowledged_at ?? "").trim() === "") {
      await auditFail("Leafly order not acknowledged");
      return {
        ok: false,
        error: "Leafly has not acknowledged this order yet, so Leafly will not accept a status change. Acknowledge it on the back-office Orders board first (it normally happens automatically within a minute or two).",
      };
    }
    const plan = planLeaflyPushes(lf.leafly_status, leaflyStatusForTarget(input.to));
    if (plan.terminal) {
      await auditFail(`Leafly status is final (${lf.leafly_status})`);
      return {
        ok: false,
        error: `Leafly already has this order as "${lf.leafly_status}", which is final - nothing was changed. Check the order on the back-office board.`,
      };
    }
    if (plan.alreadyThere) {
      leaflyOutcome = `already ${lf.leafly_status} at Leafly`;
    } else {
      const { setLeaflyOrderStatus } = await import("@/lib/leafly/order-ack-server");
      let current = lf.leafly_status;
      let reached: RegisterAdvanceTarget | null = null;
      for (const step of plan.pushes) {
        const pushed = await setLeaflyOrderStatus({
          order: { leafly_order_id: lf.leafly_order_id, leafly_status: current, acknowledged_at: lf.acknowledged_at },
          nextStatus: step,
          staffId: null,
        });
        if (!pushed.ok) {
          partialError = `Leafly did not accept "${step}": ${pushed.message}`;
          break;
        }
        if (pushed.warning) warnings.push(pushed.warning);
        current = step;
        reached = localStatusForLeafly(step) ?? reached;
      }
      if (reached === null) {
        await auditFail("Leafly refused", { leafly: partialError, leaflyStatus: lf.leafly_status });
        return { ok: false, error: `${partialError ?? "Leafly did not accept the change"}. Nothing was changed.` };
      }
      localTarget = reached;
      leaflyOutcome = `now ${current} at Leafly`;
    }
  }

  // Our order - forward only. If Leafly stopped short of where ours already
  // is, ours is left alone.
  let finalStatus: string = order.status;
  if (registerAdvanceVerdict(order.status, localTarget).allowed) {
    const moved = await setOrderStatus(order.id, localTarget, { actorId: null, actorLabel });
    if (!moved.ok) {
      await auditFail(`local status change refused: ${moved.refusal ?? "database error"}`, { leafly: leaflyOutcome });
      return {
        ok: false,
        error: `${leaflyOutcome ? `Leafly: ${leaflyOutcome}. ` : ""}Our copy of the order could not be moved (${moved.refusal ?? "database error"}). Move it from the back office.`,
      };
    }
    finalStatus = moved.order.status;
  }

  await recordAudit({
    actorId: null,
    actorEmail: `pos-advance:${input.deviceName}`,
    action: "order.advanced_at_register",
    entityType: "order",
    entityId: order.id,
    after: {
      orderNumber: order.order_number,
      displayName,
      origin,
      from: order.status,
      requested: input.to,
      to: finalStatus,
      employee: input.employeeName,
      leafly: leaflyOutcome,
      ...(partialError ? { leaflyPartial: partialError } : {}),
    },
  });

  const label = finalStatus === "ready" ? "ready for pickup" : finalStatus === "acknowledged" ? "confirmed" : finalStatus;
  if (partialError) {
    return { ok: false, error: `${displayName} is now ${label}, but it could not go further: ${partialError}` };
  }
  let message = `${displayName} is now ${label}.`;
  if (leaflyOutcome) message += ` Leafly: ${leaflyOutcome}.`;
  if (warnings.length > 0) message += ` Note: ${warnings.join(" ")}`;
  return { ok: true, orderNumber: order.order_number, displayName, status: finalStatus, message };
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
