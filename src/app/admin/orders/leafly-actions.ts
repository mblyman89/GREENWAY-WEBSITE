"use server";

/**
 * src/app/admin/orders/leafly-actions.ts
 *
 * SLICE L-6 — THE TWO BUTTONS THAT TALK TO LEAFLY.
 *
 * ===========================================================================
 * WHY A SEPARATE FILE FROM actions.ts
 * ===========================================================================
 * `./actions.ts` is 680 lines of Greenway's own order workflow: the WAC
 * 314-55-095 completion gate, the loyalty and medical-card attachments, the
 * name pool, the printer. None of that applies to a Leafly order, and a Leafly
 * order applies to none of it.
 *
 * More importantly, the two have different failure semantics. A Greenway status
 * change either happens in our database or it does not. A Leafly status change
 * is a network call to a third party whose dashboard has gone read-only because
 * we told them we are the source of truth — so "it failed" has five distinct
 * meanings (retry, fix a credential, fix the request, the order is gone, or it
 * actually worked and our own bookkeeping failed afterwards). Interleaving
 * those five outcomes with the completion gate's compliance refusals in one
 * file would make both harder to reason about at the exact moment someone is
 * under pressure.
 *
 * ===========================================================================
 * WHAT THESE ACTIONS DO NOT DECIDE
 * ===========================================================================
 * Nothing. Every rule — may this be acknowledged, is this transition forward,
 * is this cancel reason legal outbound, is 403 retryable — lives in
 * `order-ack-core.ts` and is exercised by 382 assertions in CI without a
 * Leafly account. These functions do four things: check the permission, re-read
 * the row, call the server layer, and write an audit entry.
 *
 * ===========================================================================
 * THE RE-READ IS THE POINT
 * ===========================================================================
 * The browser posts a Leafly order id and nothing else that matters. The
 * order's current status and acknowledgement state are re-read from the
 * database here, never taken from the form. Two tablets at the counter can
 * easily be showing the same order thirty seconds apart, and trusting the
 * posted state would let the second one send a transition that Leafly rejects —
 * or send a second acknowledgement, which is a call we are told to make exactly
 * once. Re-reading makes the decision use the database's truth, not the
 * screen's memory.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  acknowledgeLeaflyOrder,
  setLeaflyOrderStatus,
  type OutboundResult,
} from "@/lib/leafly/order-ack-server";
import { getLeaflyBoardOrder } from "@/lib/leafly/order-board-server";
// SLICE L-24 — the detail view the acknowledge warning has always pointed at.
import type {
  LeaflyOrderDetail,
  MediaAccessVerdict,
} from "@/lib/leafly/order-detail-core";
import { loadLeaflyOrderDetail } from "@/lib/leafly/order-detail-server";

/**
 * Where to send the operator afterwards, carrying the outcome.
 *
 * The message travels in the URL rather than in a cookie or a module variable
 * because this is a server action behind a plain `<form>`: after the redirect,
 * a fresh server render is the only thing that will run, and it has no memory
 * of this call. A module-level variable would also be shared between
 * simultaneous users, which is how one budtender ends up seeing another's
 * error message.
 *
 * `slice(0, 500)` mirrors the existing convention in ./actions.ts for the
 * completion-gate refusals, so both kinds of message are bounded the same way.
 */
function backTo(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `/admin/orders${qs ? `?${qs}` : ""}`;
}

/**
 * Turn an OutboundResult into the URL params that will render it.
 *
 * `leaflyErr` vs `leaflyMsg` is not cosmetic: a refusal and a success must be
 * visually distinct, and the code is carried separately so the page can offer
 * the RIGHT next step. "missing_integration_key" wants a link to the
 * Integrations page; "not_acknowledged" wants the acknowledge button; "retry"
 * wants the same button again. A single flattened string could not do that.
 */
function resultParams(result: OutboundResult): Record<string, string> {
  const base: Record<string, string> = {
    leaflyCode: result.code.slice(0, 80),
  };
  if (result.ok) {
    base.leaflyMsg = result.message.slice(0, 500);
    if (result.warning) base.leaflyWarn = result.warning.slice(0, 500);
  } else {
    base.leaflyErr = result.message.slice(0, 500);
    if (result.assessment) {
      base.leaflyFix = result.assessment.disposition.slice(0, 40);
    }
  }
  return base;
}

/**
 * Acknowledge a Leafly order. ONE WAY DOOR.
 *
 * Per the spec, verbatim: "Once an order has been acknowledged, access to an
 * order's associated media is revoked." So this call permanently ends our
 * ability to see the customer's government and medical ID images. The UI
 * confirms before calling this; the confirmation is not repeated here because a
 * server action cannot ask a question — but the audit entry records who did it,
 * which is the part that matters after the fact.
 *
 * Requires `orders.manage`, the same permission as advancing one of Greenway's
 * own orders. Deliberately not a new permission: this IS order handling, and
 * inventing a separate `leafly.manage` right would mean the person working the
 * counter could move a Greenway order but not the Leafly order sitting next to
 * it, which is not a distinction the shop floor has.
 */
export async function acknowledgeLeaflyOrderAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");

  const leaflyOrderId = String(formData.get("leaflyOrderId") ?? "").trim();
  if (!leaflyOrderId) {
    redirect(
      backTo({
        leaflyErr: "No Leafly order was identified, so nothing was sent.",
        leaflyCode: "missing_order_id",
      }),
    );
  }

  // Re-read. See the file header.
  const order = await getLeaflyBoardOrder(leaflyOrderId);
  if (!order) {
    redirect(
      backTo({
        leaflyErr:
          "That Leafly order is no longer in our records, so nothing was sent to Leafly.",
        leaflyCode: "not_found_locally",
      }),
    );
  }

  const result = await acknowledgeLeaflyOrder({
    order: {
      leafly_order_id: order.leafly_order_id,
      leafly_status: order.leafly_status,
      acknowledged_at: order.acknowledged_at,
    },
    staffId: session.profile.id,
  });

  // Audited either way. A refused acknowledgement is as interesting as a
  // successful one — "why did nobody acknowledge this?" is answered by the
  // refusal record, and without it the answer is a shrug.
  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: result.ok
      ? "leafly.order_acknowledged"
      : "leafly.order_acknowledge_failed",
    entityType: "leafly_order",
    entityId: leaflyOrderId,
    after: {
      code: result.code,
      httpStatus: result.httpStatus,
      refused: result.refused,
      disposition: result.assessment?.disposition ?? null,
      message: result.message,
    },
  });

  revalidatePath("/admin/orders");
  redirect(backTo(resultParams(result)));
}

/**
 * Advance (or cancel) a Leafly order's status.
 *
 * The next status arrives from the form, and that is fine: it is validated by
 * `decideStatusChange()` inside the server layer against Leafly's five
 * documented transition rules before a byte leaves the building. A forged or
 * stale value produces a refusal with a specific reason, not a bad request to
 * Leafly. That is why no allow-list is re-implemented here — house rule 11, and
 * a second list would be the one that goes stale.
 */
export async function setLeaflyOrderStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");

  const leaflyOrderId = String(formData.get("leaflyOrderId") ?? "").trim();
  const nextStatus = String(formData.get("nextStatus") ?? "").trim();
  // Empty string becomes null, NOT Leafly's default. The default (`dispensary`)
  // is Leafly's documented behaviour when the field is absent, and the pure
  // core reports it as `effectiveCancelReason` — so sending it explicitly here
  // would be us inventing a value we were told we do not need to send.
  const reason = String(formData.get("cancelationReasonCode") ?? "").trim() || null;

  if (!leaflyOrderId || !nextStatus) {
    redirect(
      backTo({
        leaflyErr: "That request was incomplete, so nothing was sent to Leafly.",
        leaflyCode: "incomplete_request",
      }),
    );
  }

  const order = await getLeaflyBoardOrder(leaflyOrderId);
  if (!order) {
    redirect(
      backTo({
        leaflyErr:
          "That Leafly order is no longer in our records, so nothing was sent to Leafly.",
        leaflyCode: "not_found_locally",
      }),
    );
  }

  const result = await setLeaflyOrderStatus({
    order: {
      leafly_order_id: order.leafly_order_id,
      leafly_status: order.leafly_status,
      acknowledged_at: order.acknowledged_at,
    },
    nextStatus,
    cancelationReasonCode: reason,
    staffId: session.profile.id,
  });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: result.ok ? "leafly.order_status_pushed" : "leafly.order_status_failed",
    entityType: "leafly_order",
    entityId: leaflyOrderId,
    after: {
      requested: nextStatus,
      // The status we believed the order was in when the decision was made.
      // Recorded because a refused "backwards" transition is only explicable
      // alongside the from-status, and the row will have moved on by the time
      // anyone reads this.
      from: order.leafly_status,
      cancelationReasonCode: reason,
      code: result.code,
      httpStatus: result.httpStatus,
      refused: result.refused,
      disposition: result.assessment?.disposition ?? null,
      message: result.message,
    },
  });

  revalidatePath("/admin/orders");
  redirect(backTo(resultParams(result)));
}

/* ------------------------------------------------------------------------- *
 * SLICE L-24 — opening an order
 * ------------------------------------------------------------------------- */

/**
 * Load one Leafly order's full detail for the expandable panel.
 *
 * ── WHY THIS IS A CALLABLE ACTION AND NOT PART OF THE PAGE LOAD ────────────
 * Because `raw_order` is a whole order payload per row, and the board renders
 * every open order at once. `order-board-server.ts` deliberately excludes it
 * from the list query for exactly that reason, its own comment saying "The
 * detail view can fetch it for one order." This is that fetch. Loading it for
 * the whole board to support a panel that is usually closed would move
 * megabytes on every page view of the busiest screen in the shop.
 *
 * ── WHY IT RETURNS INSTEAD OF REDIRECTING ──────────────────────────────────
 * Every other action in this file redirects, because every other action
 * CHANGES something and the operator must land on a screen that reflects the
 * change. This one only reads. Redirecting would collapse the panel the
 * operator just opened and scroll them away from the order they are reading,
 * on a screen where the whole point is to read before pressing a one-way door.
 *
 * ── WHY THERE IS NO AUDIT ENTRY FOR THE DETAIL ITSELF ──────────────────────
 * It is a read of data we already hold, by someone who already has
 * `orders.manage` and can see most of it on the card. The ID IMAGES are a
 * different matter and ARE logged, in the image route — that is the access
 * worth recording, because it is the one that leaves the building.
 */
export async function loadLeaflyOrderDetailAction(
  leaflyOrderId: string,
): Promise<{
  ok: boolean;
  detail: LeaflyOrderDetail | null;
  mediaAccess: MediaAccessVerdict | null;
  error: string | null;
}> {
  await requirePermission("orders.manage");

  const id = typeof leaflyOrderId === "string" ? leaflyOrderId.trim() : "";
  if (id === "") {
    return {
      ok: false,
      detail: null,
      mediaAccess: null,
      error: "No Leafly order was identified.",
    };
  }

  const result = await loadLeaflyOrderDetail(id);
  return {
    ok: result.ok,
    detail: result.detail,
    mediaAccess: result.mediaAccess,
    error: result.error,
  };
}
