/**
 * src/lib/pos/pickup-store.ts  (POS Slice B28)
 *
 * Server flow for the register's ONLINE-ORDER PICKUP QUEUE: list website
 * pickup orders, show one order's lines at the counter, and complete the
 * handover — ID attestation → cash tender → the SAME server completion gate
 * every sale runs (runCompletionGate: hours, money recompute, loyalty code,
 * medical card, high-THC, sales limits, exempt ledger) → setOrderStatus
 * "completed" (which fires the B19 inventory decrement and loyalty accrual
 * exactly like every other completion path).
 *
 * The day ledger — why a processed pos_sale_events row is written
 * ---------------------------------------------------------------
 * The register's X/Z day report (B22) and expected-drawer-cash math read
 * pos_sale_events for the register's business day. A pickup handover takes
 * CASH INTO THAT DRAWER, so it must appear in that ledger or every day
 * report and drawer reconciliation would silently understate. We write one
 * already-`processed` ledger row (order_id set, payload carrying the same
 * totals/tender shape register sales use plus a `pickup` block naming the
 * order). This ALSO makes the whole post-sale machinery uniform: the
 * printed receipt number is the row's client_uuid suffix, so the returns
 * desk (B15/B16) and the same-day void (B27) find pickup sales exactly like
 * register sales. Replay never touches it: ingest only processes `pending`
 * rows. `sequence` is 0 — server-materialized rows sit outside the device's
 * offline ordering (the index is non-unique; nothing joins on it).
 *
 * NOT double-counted anywhere: CCRS Sale.csv reads orders (one order row),
 * the day report reads pos_sale_events (one row), inventory decrements via
 * the idempotent order_events marker, loyalty accrues once per order.
 *
 * ONLINE-ONLY by design (the queue lives on the server). Money in MINOR
 * UNITS (cents) everywhere.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { listOrders, getOrder, setOrderStatus } from "@/lib/orders/orders-store";
import { runCompletionGate } from "@/lib/orders/completion-gate";
import {
  evaluatePickupCompletion,
  isPosMaterializedOrder,
  sortPickupQueue,
  toPickupQueueEntry,
  customerPickupLabel,
  type PickupQueueEntry,
} from "@/lib/pos/pickup-core";
import { getPosReceiptConfig } from "@/lib/pos/receipt-config-store";
import { normalizePosReceiptConfig, receiptAddressLines } from "@/lib/pos/receipt-config-core";
import { buildPosReceiptHtml, receiptNumber } from "@/lib/pos/receipt-core";
import { recordAudit } from "@/lib/auth/audit";
import { supersedeNote, type LoadedOrderLine } from "@/lib/pos/order-to-cart-core";
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
};

export type PickupDetailResult = { ok: true; order: PickupOrderDetail } | { ok: false; error: string };

export async function getRegisterPickupOrder(orderId: string): Promise<PickupDetailResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, error: "Database not configured." };
  const order = await getOrder(orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (isPosMaterializedOrder(order.staff_note)) {
    return { ok: false, error: "That order is a register sale, not a website pickup." };
  }
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
    },
  };
}

// ---------------------------------------------------------------------------
// Handover completion
// ---------------------------------------------------------------------------

export type CompletePickupInput = {
  orderId: string;
  /** employees.id of the budtender whose PIN unlocked the register. */
  employeeId: string;
  /** Cash the customer handed over, minor units. */
  tenderedMinor: number;
  /** The budtender's explicit at-the-counter ID attestation. */
  idConfirmed: boolean;
  deviceId: string;
  deviceName: string;
  registerId: string;
  /** The open drawer session the cash goes into. */
  drawerSessionId: string;
};

export type CompletePickupResult =
  | { ok: true; changeMinor: number; receiptHtml: string; orderNumber: string; receiptNumber: string }
  | { ok: false; errors: string[] };

export async function completePickupAtRegister(input: CompletePickupInput): Promise<CompletePickupResult> {
  if (!isSupabaseServiceConfigured) return { ok: false, errors: ["Database not configured."] };
  const admin = createSupabaseAdminClient();

  const order = await getOrder(input.orderId);
  if (!order) return { ok: false, errors: ["Order not found."] };

  // Belt and suspenders on the POS-materialized exclusion: the staff_note
  // contract AND the sale-event link (a register sale always has one).
  let isPosSale = isPosMaterializedOrder(order.staff_note);
  if (!isPosSale) {
    const { data: linked } = await admin
      .from("pos_sale_events")
      .select("id")
      .eq("order_id", order.id)
      .limit(1);
    isPosSale = !!linked && linked.length > 0;
  }

  const verdict = evaluatePickupCompletion({
    orderStatus: order.status,
    isPosSale,
    idConfirmed: input.idConfirmed,
    totalMinor: order.total_minor_units,
    tenderedMinor: input.tenderedMinor,
  });
  if (!verdict.ok) return { ok: false, errors: verdict.errors };

  // The employee on the hook for the handover must be a real, active human.
  const { data: emp } = await admin
    .from("employees")
    .select("id, full_name, active")
    .eq("id", input.employeeId)
    .maybeSingle<{ id: string; full_name: string; active: boolean }>();
  if (!emp || !emp.active) return { ok: false, errors: ["Unknown or inactive employee — unlock the register again."] };

  // ── The SAME completion gate every sale runs (no override at handover) ──
  const refusal = await runCompletionGate({
    orderId: order.id,
    actorId: null,
    overridePermitted: false,
    overrideReason: null,
  });
  if (refusal) return { ok: false, errors: [refusal] };

  const completed = await setOrderStatus(order.id, "completed", {
    actorLabel: `POS pickup · ${emp.full_name}`,
    note: `Picked up at the register (${input.deviceName}). ID checked at handover by ${emp.full_name}. Paid cash.`,
  });
  if (!completed.ok) {
    return { ok: false, errors: [completed.refusal ?? "Could not complete the order."] };
  }

  // ── Day ledger row: the drawer took this cash (see module header) ────────
  const saleClientUuid = crypto.randomUUID();
  const changeMinor = verdict.changeMinor;
  const { error: ledgerError } = await admin.from("pos_sale_events").insert({
    client_uuid: saleClientUuid,
    device_id: input.deviceId,
    register_id: input.registerId,
    employee_id: emp.id,
    sequence: 0, // server-materialized; outside the device's offline ordering
    occurred_at: new Date().toISOString(),
    event_type: "sale",
    status: "processed",
    processed_at: new Date().toISOString(),
    order_id: order.id,
    payload: {
      lines: order.lines.map((l) => ({
        productId: l.product_id ?? "",
        productName: l.product_name,
        category: l.category ?? "unknown",
        quantity: l.quantity,
        unitPriceMinor: l.price_minor_units,
        regularPriceMinor: l.regular_price_minor_units ?? l.price_minor_units,
        ...(l.variant_id ? { variantId: l.variant_id } : {}),
      })),
      totalMinor: order.total_minor_units,
      subtotalMinor: order.subtotal_minor_units,
      taxMinor: order.estimated_tax_minor_units,
      paymentMethod: "cash",
      tenderedMinor: input.tenderedMinor,
      changeMinor,
      drawerSessionId: input.drawerSessionId,
      // Website pickup, not a register ring — the ID gate ran at HANDOVER.
      pickup: { orderNumber: order.order_number, idConfirmedByEmployeeId: emp.id },
    },
  });
  if (ledgerError) {
    // The sale is complete and legal; the day report would just undercount.
    // Leave a loud trail instead of failing the customer's handover.
    await admin
      .from("order_events")
      .insert({
        order_id: order.id,
        event_type: "note",
        note: `Pickup completed but the register day-ledger row FAILED to write: ${ledgerError.message}. The X/Z report undercounts this cash — reconcile manually.`.slice(0, 2000),
        actor_label: "system",
      })
      .then(() => {}, () => {});
  }

  await recordAudit({
    actorId: null,
    actorEmail: `pos-device:${input.deviceId}`,
    action: "register.pickup_completed",
    entityType: "order",
    entityId: order.id,
    after: {
      orderNumber: order.order_number,
      employeeId: emp.id,
      employeeName: emp.full_name,
      totalMinor: order.total_minor_units,
      tenderedMinor: input.tenderedMinor,
      changeMinor,
      idConfirmed: true,
      ledger: ledgerError ? `FAILED: ${ledgerError.message}` : "written",
    },
  });

  // ── Printable receipt (owner's B13 customization applies) ────────────────
  const config = normalizePosReceiptConfig(await getPosReceiptConfig());
  const savingsMinor = order.lines.reduce(
    (s, l) => s + Math.max(0, ((l.regular_price_minor_units ?? l.price_minor_units) - l.price_minor_units) * l.quantity),
    0,
  );
  const receiptHtml = buildPosReceiptHtml({
    saleClientUuid,
    soldAtIso: new Date().toISOString(),
    registerLabel: input.deviceName,
    headerText: config.headerText,
    footerText: config.footerText,
    addressLines: receiptAddressLines(config),
    servedBy: config.showEmployee ? emp.full_name : null,
    hideSavings: !config.showSavings,
    lines: order.lines.map((l) => ({
      productName: l.variant_label ? `${l.product_name} (${l.variant_label})` : l.product_name,
      quantity: l.quantity,
      unitPriceMinor: l.price_minor_units,
      regularPriceMinor: l.regular_price_minor_units ?? l.price_minor_units,
    })),
    subtotalMinor: order.subtotal_minor_units,
    taxMinor: order.estimated_tax_minor_units,
    totalMinor: order.total_minor_units,
    savingsMinor,
    medicalSavingsMinor: 0,
    medicalSale: false,
    tenderedMinor: input.tenderedMinor,
    changeMinor,
  });

  return {
    ok: true,
    changeMinor,
    receiptHtml,
    orderNumber: order.order_number,
    receiptNumber: receiptNumber(saleClientUuid),
  };
}

// ---------------------------------------------------------------------------
// Load into the register cart (Task AM-D)
// ---------------------------------------------------------------------------

export type LoadOrderResult =
  | {
      ok: true;
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
    }
  | { ok: false; error: string };

/**
 * Load a website order INTO a register sale ("the customer is here and
 * wants to add items"). The order is SUPERSEDED — cancelled with a loud
 * timeline note — the moment it is loaded, because the register sale
 * materializes its OWN order at sync: if both stayed live, both could
 * complete (double inventory decrement, double loyalty accrual, two CCRS
 * sales). Cancelling first makes the failure mode safe: if the register
 * sale never happens, the order sits cancelled with a note saying exactly
 * why, and the back office can reopen it via the reasoned-reversal path.
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

  // ── Supersede FIRST (see above): cancel with the loud note ───────────────
  const cancelled = await setOrderStatus(order.id, "cancelled", {
    actorLabel: `POS load · ${input.employeeName}`,
    note: supersedeNote(input.deviceName, input.employeeName),
  });
  if (!cancelled.ok) {
    return { ok: false, error: cancelled.refusal ?? "Could not supersede the order — load it again or use the pickup queue." };
  }

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
      superseded: true,
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

  return {
    ok: true,
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
  };
}
