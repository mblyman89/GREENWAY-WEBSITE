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
import { setOrderStatus, updateStaffNote, getOrder, rerollOrderDisplayName } from "@/lib/orders/orders-store";
import {
  addPoolName,
  bulkAddPoolNames,
  updatePoolName,
  setPoolNameEnabled,
  deletePoolName,
  reorderPoolNames,
  listPoolNames,
} from "@/lib/orders/order-name-pool-store";
import { validateOrderName } from "@/lib/orders/order-name-pool-core";
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

// ---------------------------------------------------------------------------
// SLICE 113 — Order-NAME pool management + printer test (from the orders page)
// ---------------------------------------------------------------------------

const ORDERS_BASE = "/admin/orders";

/** Redirect back to /admin/orders with a success/error banner + the pool panel open. */
function poolRedirect(ok: boolean, message: string): never {
  const key = ok ? "poolMsg" : "poolErr";
  redirect(`${ORDERS_BASE}?pool=1&${key}=${encodeURIComponent(message.slice(0, 300))}`);
}

/** Add a name to the recycling pool. requires orders.manage; audited. */
export async function addPoolNameAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const raw = String(formData.get("name") ?? "");
  const existing = await listPoolNames();
  const check = validateOrderName(existing, raw);
  if (!check.ok) poolRedirect(false, check.error ?? "Could not add the name.");

  const res = await addPoolName(check.value);
  if (!res.ok) poolRedirect(false, res.error ?? "Could not add the name.");

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order_name_pool.add",
    entityType: "order_name_pool",
    entityId: check.value,
    after: { name: check.value },
  });
  revalidatePath(ORDERS_BASE);
  poolRedirect(true, `Added “${check.value}” to the pool.`);
}

/**
 * SLICE 23 — add a whole pasted list at once. requires orders.manage; audited.
 *
 * The owner asked to "upload a list to make it easier". The result message is
 * deliberately specific: it says how many went in AND names what was skipped
 * and why. A bulk import that quietly drops duplicates is worse than no bulk
 * import, because the owner walks away believing names are in the pool that
 * are not.
 */
export async function bulkAddPoolNamesAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const raw = String(formData.get("names") ?? "");

  const res = await bulkAddPoolNames(raw);
  if (res.error) poolRedirect(false, res.error);

  if (res.added.length > 0) {
    await recordAudit({
      actorId: session.profile.id,
      actorEmail: session.email,
      action: "order_name_pool.bulk_add",
      entityType: "order_name_pool",
      entityId: `bulk:${res.added.length}`,
      after: { added: res.added, skipped: res.skipped },
    });
    revalidatePath(ORDERS_BASE);
  }

  const addedPart =
    res.added.length > 0
      ? `Added ${res.added.length} name${res.added.length === 1 ? "" : "s"}.`
      : "Nothing added.";
  // Name the first few skips outright; a bare count would leave the owner
  // guessing which of his names didn't make it.
  const skippedPart =
    res.skipped.length > 0
      ? ` Skipped ${res.skipped.length}: ${res.skipped
          .slice(0, 5)
          .map((s) => `“${s.name}” (${s.reason})`)
          .join(", ")}${res.skipped.length > 5 ? ", …" : ""}`
      : "";

  poolRedirect(res.added.length > 0, `${addedPart}${skippedPart}`);
}

/** Rename an existing pool entry. requires orders.manage; audited. */
export async function updatePoolNameAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const id = String(formData.get("id") ?? "");
  const raw = String(formData.get("name") ?? "");
  if (!id) poolRedirect(false, "Missing name id.");

  const existing = await listPoolNames();
  const check = validateOrderName(existing, raw, id);
  if (!check.ok) poolRedirect(false, check.error ?? "Could not save the name.");

  const res = await updatePoolName(id, check.value);
  if (!res.ok) poolRedirect(false, res.error ?? "Could not save the name.");

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order_name_pool.update",
    entityType: "order_name_pool",
    entityId: id,
    after: { name: check.value },
  });
  revalidatePath(ORDERS_BASE);
  poolRedirect(true, `Renamed to “${check.value}”.`);
}

/** Enable/disable a pool name (toggle via a hidden "enabled" field). */
export async function togglePoolNameAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const id = String(formData.get("id") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!id) poolRedirect(false, "Missing name id.");

  const res = await setPoolNameEnabled(id, enabled);
  if (!res.ok) poolRedirect(false, res.error ?? "Could not update the name.");

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order_name_pool.toggle",
    entityType: "order_name_pool",
    entityId: id,
    after: { enabled },
  });
  revalidatePath(ORDERS_BASE);
  poolRedirect(true, enabled ? "Name enabled." : "Name disabled (kept in the list).");
}

/** Remove a pool name entirely. requires orders.manage; audited. */
export async function deletePoolNameAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) poolRedirect(false, "Missing name id.");

  const res = await deletePoolName(id);
  if (!res.ok) poolRedirect(false, res.error ?? "Could not remove the name.");

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order_name_pool.delete",
    entityType: "order_name_pool",
    entityId: id,
  });
  revalidatePath(ORDERS_BASE);
  poolRedirect(true, "Name removed from the pool.");
}

/** Persist a new manual order (comma-separated ids in the desired order). */
export async function reorderPoolNamesAction(formData: FormData): Promise<void> {
  const session = await requirePermission("orders.manage");
  const idsRaw = String(formData.get("ids") ?? "");
  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) poolRedirect(false, "Nothing to reorder.");

  const res = await reorderPoolNames(ids);
  if (!res.ok) poolRedirect(false, res.error ?? "Could not reorder the pool.");

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order_name_pool.reorder",
    entityType: "order_name_pool",
    entityId: "pool",
    after: { order: ids },
  });
  revalidatePath(ORDERS_BASE);
  poolRedirect(true, "Pool order saved.");
}

/**
 * Assign a DIFFERENT pool name to one order (the "reroll" flourish on the order
 * detail). Bound to the order id in the page. requires orders.manage; audited.
 */
export async function rerollOrderNameAction(orderId: string): Promise<void> {
  const session = await requirePermission("orders.manage");
  if (!orderId) return;

  const name = await rerollOrderDisplayName(orderId);
  if (!name) {
    redirect(
      `${ORDERS_BASE}/${orderId}?blocked=${encodeURIComponent("No pool name available — add names to your order-name pool (and apply migration 0147) first.")}`,
    );
  }

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "order.name_rerolled",
    entityType: "order",
    entityId: orderId,
    after: { display_name: name },
  });
  revalidatePath(`${ORDERS_BASE}/${orderId}`);
  redirect(`${ORDERS_BASE}/${orderId}?ok=${encodeURIComponent(`Order renamed to “${name}”.`)}`);
}

/**
 * Queue a sample receipt from the ORDERS page so staff can confirm the printer
 * is wired up without leaving the dashboard. Mirrors the Equipment test print
 * but redirects back here. requires settings.manage; audited.
 */
export async function testPrintFromOrdersAction(): Promise<void> {
  const session = await requirePermission("settings.manage");

  const { queueJob, formatReceipt } = await import("@/lib/printing/printer-store");
  const body = formatReceipt({
    orderNumber: "TEST-PRINT",
    placedAt: new Date().toISOString(),
    customerName: "Test Receipt",
    lines: [
      { productName: "Sample item A", brand: "Greenway", variantLabel: "1g", quantity: 1, priceMinorUnits: 1000 },
      { productName: "Sample item B", brand: "Greenway", variantLabel: "10pk", quantity: 2, priceMinorUnits: 1500 },
    ],
    subtotalMinorUnits: 4000,
    savingsMinorUnits: 0,
    estimatedTaxMinorUnits: 1480,
    totalMinorUnits: 5480,
    customerNote: "This is a CloudPRNT test print (from the Orders page).",
  });

  const id = await queueJob({ bodyText: body, title: "Test print" });

  await recordAudit({
    actorId: session.profile.id,
    actorEmail: session.email,
    action: "receipt_printer.test_print",
    entityType: "receipt_print_jobs",
    entityId: id ?? "n/a",
  });

  if (!id) {
    poolRedirect(false, "Could not queue test print — Supabase service role not configured.");
  }
  revalidatePath(ORDERS_BASE);
  redirect(`${ORDERS_BASE}?printTest=1`);
}
