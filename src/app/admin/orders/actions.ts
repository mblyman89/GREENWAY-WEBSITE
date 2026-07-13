"use server";

/**
 * Server actions for the Slice 7 order dashboard. Each mutating action checks
 * the staff permission, performs the change via the orders store, and records an
 * audit log entry. AI is not involved here — these are human-driven workflow
 * transitions.
 *
 * Phase A (GAP H-1 / H-2): the → completed transition is now a COMPLIANCE
 * GATE. Before an order can complete:
 *   - the stored money is recomputed from the lines (server truth; S-2b), and
 *   - the cart is re-evaluated against the WAC 314-55-095 sales limits with a
 *     HARD BLOCK when over (S-1b). A manager override requires the separate
 *     `sales_limit.override` permission + a written reason, and is logged to
 *     `sales_limit_events` for the owner's audit panel.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, getStaffSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/auth/audit";
import { setOrderStatus, updateStaffNote, getOrder } from "@/lib/orders/orders-store";
// POS Slice B1: the → completed compliance gate is EXTRACTED (verbatim) into
// src/lib/orders/completion-gate.ts so the POS sync route re-runs the exact
// same sequence for every synced register sale. This file now just calls it.
import { runCompletionGate } from "@/lib/orders/completion-gate";
import {
  applyCodeToOrder,
  applyTierToOrder,
  removeLoyaltyFromOrder,
} from "@/lib/loyalty/loyalty-sale-store";
import { customerMedicalStatus } from "@/lib/medical/store";
import { attachCardToOrder, detachCardFromOrder } from "@/lib/medical/sale-store";
import { clearExemptSalesForOrder } from "@/lib/medical/sale-store";
import type { OrderStatus } from "@/lib/orders/types";

const VALID_STATUSES: OrderStatus[] = [
  "new",
  "acknowledged",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "no_show",
];

function actorLabel(email: string, fullName: string | null): string {
  return fullName?.trim() ? `${fullName.trim()} (${email})` : email;
}

export async function setOrderStatusAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");

  const id = String(formData.get("id") ?? "");
  const toStatus = String(formData.get("status") ?? "") as OrderStatus;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id || !VALID_STATUSES.includes(toStatus)) return;

  // ── COMPLETION COMPLIANCE GATE (S-1b + S-2b) ───────────────────────────
  if (toStatus === "completed") {
    // Manager override: requires the SEPARATE permission + a written reason.
    const overrideRequested = String(formData.get("override") ?? "") === "1";
    const overrideReason = String(formData.get("overrideReason") ?? "").trim() || null;
    const fullSession = await getStaffSession();
    const overridePermitted =
      overrideRequested &&
      !!overrideReason &&
      !!fullSession &&
      can(fullSession.profile.role, "sales_limit.override");

    const refusal = await runCompletionGate({
      orderId: id,
      actorId: session.profile.id,
      overridePermitted,
      overrideReason,
    });

    if (refusal) {
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "order.completion_blocked",
        entityType: "order",
        entityId: id,
        after: { reason: refusal, overrideRequested },
      });
      revalidatePath(`/admin/orders/${id}`);
      redirect(`/admin/orders/${id}?blocked=${encodeURIComponent(refusal.slice(0, 500))}`);
    }

    if (overridePermitted) {
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "order.limit_override_applied",
        entityType: "order",
        entityId: id,
        after: { reason: overrideReason },
      });
    }
  }

  // ── S-15 lifecycle: any REVERSAL (reopening a closed order or moving
  //    backward) must carry a written reason; the store enforces the matrix.
  const reversalReason = String(formData.get("reversalReason") ?? "").trim() || null;

  const result = await setOrderStatus(id, toStatus, {
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
    note,
    reversalReason,
  });

  if (!result.ok) {
    // Task O — if the completion gate already wrote WAC 090(2) rows but the
    // lifecycle matrix then refused the completion, remove them: the ledger
    // may only describe sales that actually completed.
    if (toStatus === "completed") await clearExemptSalesForOrder(id);
    if (result.refusal) {
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "order.transition_blocked",
        entityType: "order",
        entityId: id,
        after: { attempted: toStatus, reason: result.refusal },
      });
      revalidatePath(`/admin/orders/${id}`);
      redirect(`/admin/orders/${id}?blocked=${encodeURIComponent(result.refusal.slice(0, 500))}`);
    }
    revalidatePath(`/admin/orders/${id}`);
    return;
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order.status_changed",
    entityType: "order",
    entityId: id,
    after: {
      status: toStatus,
      order_number: result.order.order_number,
      note,
      ...(reversalReason ? { reversalReason } : {}),
    },
  });

  // Task O — ledger hygiene: when an order LEAVES completed (logged S-15
  // reversal), its WAC 314-55-090(2) exempt-sale rows no longer describe a
  // standing sale, and the excise return sums the ledger by sale_date — stale
  // rows would overstate the Box 2 deduction. Clear them (no-op for orders
  // that never completed); they are re-derived if the order completes again.
  if (toStatus !== "completed") {
    const cleared = await clearExemptSalesForOrder(id);
    if (cleared > 0) {
      await recordAudit({
        actorId: session.profile.id,
        actorEmail: session.email,
        action: "medical.exempt_sales_cleared",
        entityType: "order",
        entityId: id,
        after: { cleared, reason: `Order left completed status (→ ${toStatus}).` },
      });
    }
  }

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${id}`);
}

export async function updateOrderNoteAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!id) return;

  const ok = await updateStaffNote(id, note, {
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
  });

  if (ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "order.note_updated",
      entityType: "order",
      entityId: id,
      after: { note },
    });
  }

  revalidatePath(`/admin/orders/${id}`);
}

// ---------------------------------------------------------------------------
// Task O — attach / detach a recognition card (medical sale)
// ---------------------------------------------------------------------------
/**
 * Attach a patient's ACTIVE recognition card to an open order. The card must
 * be valid RIGHT NOW to attach (fail fast at the counter); it is re-validated
 * again at completion. Requires orders.manage; audited.
 */
export async function attachMedicalCardAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const orderId = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  if (!orderId || !customerId) return;

  const order = await getOrder(orderId);
  if (!order) return;
  if (order.status === "completed" || order.status === "cancelled" || order.status === "no_show") {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent("This order is closed — reopen it (logged reversal) before changing its medical status.")}`);
  }

  const status = await customerMedicalStatus(customerId, new Date());
  if (!status.carded || !status.card) {
    redirect(
      `/admin/orders/${orderId}?blocked=${encodeURIComponent(`Cannot attach: ${status.reason ?? "the customer has no valid recognition card"}. Verify the card in the MCR and fix it on the patient's profile first.`)}`,
    );
  }

  const res = await attachCardToOrder(orderId, { id: status.card.id, customer_id: customerId });
  if (!res.ok) {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent(res.error ?? "Could not attach the card.")}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order.medical_card_attached",
    entityType: "order",
    entityId: orderId,
    after: {
      authorization_id: status.card.id,
      customer_id: customerId,
      upid: status.card.unique_patient_identifier,
    },
  });
  revalidatePath(`/admin/orders/${orderId}`);
}

/** Detach the recognition card from an open order (sale proceeds as recreational). */
export async function detachMedicalCardAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const orderId = String(formData.get("id") ?? "");
  if (!orderId) return;

  const order = await getOrder(orderId);
  if (!order) return;
  if (order.status === "completed" || order.status === "cancelled" || order.status === "no_show") {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent("This order is closed — reopen it (logged reversal) before changing its medical status.")}`);
  }

  const res = await detachCardFromOrder(orderId);
  if (res.ok) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "order.medical_card_detached",
      entityType: "order",
      entityId: orderId,
    });
  }
  revalidatePath(`/admin/orders/${orderId}`);
}

// ---------------------------------------------------------------------------
// Task S-a — loyalty at the register (docs/LOYALTY_COMPLIANCE.md)
// ---------------------------------------------------------------------------

/**
 * Apply a customer's redemption code (GW-XXXX-XXXX) to an open order. The
 * code is claimed atomically; its value is spread across the lines above the
 * statutory + acquisition-cost floors; only ONE loyalty application per order.
 */
export async function applyLoyaltyCodeAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const orderId = String(formData.get("id") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!orderId) return;
  if (!code) {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent("Enter the customer's loyalty code (GW-XXXX-XXXX).")}`);
  }

  const res = await applyCodeToOrder({
    orderId,
    code,
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
  });
  if (!res.ok) {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent(res.error.slice(0, 500))}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order.loyalty_code_applied",
    entityType: "order",
    entityId: orderId,
    after: { code: code.toUpperCase(), result: res.message },
  });
  revalidatePath(`/admin/orders/${orderId}`);
  redirect(`/admin/orders/${orderId}?ok=${encodeURIComponent(res.message)}`);
}

/**
 * Apply the linked member's TIER pricing to an open order — per-line
 * best-deal-wins vs the promo price, never stacked.
 */
export async function applyLoyaltyTierAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const orderId = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  if (!orderId || !customerId) return;

  const res = await applyTierToOrder({
    orderId,
    customerId,
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
  });
  if (!res.ok) {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent(res.error.slice(0, 500))}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order.loyalty_tier_applied",
    entityType: "order",
    entityId: orderId,
    after: { customer_id: customerId, result: res.message },
  });
  revalidatePath(`/admin/orders/${orderId}`);
  redirect(`/admin/orders/${orderId}?ok=${encodeURIComponent(res.message)}`);
}

/**
 * Remove the loyalty application from an open order: line prices restored
 * from the per-line snapshot; a code is released back to the customer.
 */
export async function removeLoyaltyAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const orderId = String(formData.get("id") ?? "");
  if (!orderId) return;

  const res = await removeLoyaltyFromOrder({
    orderId,
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
  });
  if (!res.ok) {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent(res.error.slice(0, 500))}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order.loyalty_removed",
    entityType: "order",
    entityId: orderId,
    after: { result: res.message },
  });
  revalidatePath(`/admin/orders/${orderId}`);
  redirect(`/admin/orders/${orderId}?ok=${encodeURIComponent(res.message)}`);
}

/**
 * STAFF-CONFIRMED customer↔order link (Task T / PR 4). Candidates are ranked
 * by exact normalized phone/email match, but linking is always a human click —
 * never automatic. Once linked, order completion accrues loyalty points for
 * the customer (existing hook in orders-store.setOrderStatus).
 */
export async function linkOrderCustomerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const orderId = String(formData.get("id") ?? "");
  const customerId = String(formData.get("customerId") ?? "");
  if (!orderId || !customerId) return;

  const { linkCustomerToOrder } = await import("@/lib/orders/customer-link-store");
  const res = await linkCustomerToOrder(orderId, customerId, {
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
  });
  if (!res.ok) {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent(res.error.slice(0, 500))}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order.customer_linked",
    entityType: "order",
    entityId: orderId,
    after: { customer_id: customerId },
  });
  revalidatePath(`/admin/orders/${orderId}`);
  redirect(`/admin/orders/${orderId}?ok=${encodeURIComponent("Customer linked — points will accrue on completion.")}`);
}

/** Remove a customer link (wrong match). */
export async function unlinkOrderCustomerAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const orderId = String(formData.get("id") ?? "");
  if (!orderId) return;

  const { unlinkCustomerFromOrder } = await import("@/lib/orders/customer-link-store");
  const res = await unlinkCustomerFromOrder(orderId, {
    actorId: session.profile.id,
    actorLabel: actorLabel(session.email, session.profile.full_name),
  });
  if (!res.ok) {
    redirect(`/admin/orders/${orderId}?blocked=${encodeURIComponent(res.error.slice(0, 500))}`);
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order.customer_unlinked",
    entityType: "order",
    entityId: orderId,
  });
  revalidatePath(`/admin/orders/${orderId}`);
  redirect(`/admin/orders/${orderId}?ok=${encodeURIComponent("Customer link removed.")}`);
}
