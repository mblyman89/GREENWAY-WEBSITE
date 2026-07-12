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
import { verifyStoredOrderForCompletion } from "@/lib/orders/order-pricing";
import { checkLoyaltyCodeForCompletion } from "@/lib/loyalty/loyalty-sale-core";
import {
  applyCodeToOrder,
  applyTierToOrder,
  removeLoyaltyFromOrder,
  getOrderLoyaltyContext,
} from "@/lib/loyalty/loyalty-sale-store";
import { enforceSalesLimitForSale } from "@/lib/compliance/sales-limits";
import { evaluateSalesHours } from "@/lib/compliance/sales-hours-core";
import { getSalesHoursWindow } from "@/lib/compliance/sales-hours-store";
import { authorizationValidityAt } from "@/lib/medical/medical-authorization-core";
import {
  toRecognitionCard,
  getMedTaxSettings,
  getEndorsementConfig,
  customerMedicalStatus,
} from "@/lib/medical/store";
import { attachCardToOrder, detachCardFromOrder } from "@/lib/medical/sale-store";
import {
  getOrderMedicalContext,
  getMedicalRegistryForKeys,
  recordExemptSalesForOrder,
  clearExemptSalesForOrder,
} from "@/lib/medical/sale-store";
import {
  buildOrderExemptionPlan,
  buildExemptSaleDrafts,
  type PlanLine,
} from "@/lib/medical/medical-sale-core";
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

/**
 * The → completed compliance gate. Returns null when the order may complete,
 * or a human-readable refusal message when it must not.
 */
async function runCompletionGate(opts: {
  orderId: string;
  actorId: string;
  overridePermitted: boolean;
  overrideReason: string | null;
}): Promise<string | null> {
  const order = await getOrder(opts.orderId);
  if (!order) return "Order not found.";
  if (order.status === "completed") return null; // idempotent re-complete

  // ── S-12: sales-hours gate (WAC 314-55-147) ─────────────────────────────
  // A sale may only complete 8:00 AM–midnight on the STORE's (Pacific) wall
  // clock; the owner may configure a TIGHTER window in Settings → Sales hours.
  // This is a HARD block — the statute has no override; a tighter owner
  // window is widened in Settings, never bypassed at the register.
  const hoursWindow = await getSalesHoursWindow();
  const hoursVerdict = evaluateSalesHours(new Date(), hoursWindow);
  if (!hoursVerdict.allowed) {
    return `Sale blocked outside sales hours. ${hoursVerdict.reason}`;
  }

  // ── S-2b: money recompute gate ─────────────────────────────────────────
  const check = await verifyStoredOrderForCompletion(order);
  if (!check.ok) {
    return `Money check failed — fix the order first. ${check.problems.join(" ")}`;
  }

  // ── Task S-a: loyalty-code consistency gate ────────────────────────────────
  // An order carrying a loyalty CODE may only complete while the redemption
  // row is consumed by THIS order (catches released/re-used codes after a
  // reopen). Pure check; loyalty value already lives in the line prices so
  // the money gate above covers the totals.
  const loyaltyCtx = await getOrderLoyaltyContext(opts.orderId);
  const loyaltyCheck = checkLoyaltyCodeForCompletion(
    {
      id: opts.orderId,
      loyaltyKind: loyaltyCtx.kind,
      loyaltyRedemptionId: loyaltyCtx.redemption?.id ?? null,
    },
    loyaltyCtx.redemption,
  );
  if (!loyaltyCheck.ok) {
    return loyaltyCheck.reason;
  }

  // ── S-1b: sales-limit HARD gate ────────────────────────────────────────
  // Task O — medical context first (attached recognition card). If staff
  // attached a card to this order, RE-validate it on the completion date
  // (tax.cardValidity via authorizationValidityAt — the single source of
  // truth). An attached-but-invalid card BLOCKS completion: staff must fix the
  // card or detach it so the sale knowingly completes as recreational.
  const medCtx = await getOrderMedicalContext(opts.orderId);
  let cardedValid = false;
  if (medCtx) {
    const validity = authorizationValidityAt(toRecognitionCard(medCtx.authorization), new Date());
    if (!validity.valid) {
      return `The attached recognition card for ${medCtx.customerName} is NOT valid: ${validity.reason ?? "unknown reason"}. Fix the card on the patient's profile or detach it before completing (an invalid card grants no exemption, and completing anyway would misreport the sale).`;
    }
    cardedValid = true;
  }

  // Task O — DOH 246-70 exemption plan + high-THC statutory gate. Built from
  // the STORED lines (category snapshot) and the durable product registry.
  // The plan is the SAME pure math the order-detail preview shows — no drift
  // between what staff saw and what the gate enforces.
  const [medSettings, endorsement] = await Promise.all([getMedTaxSettings(), getEndorsementConfig()]);
  const registry = await getMedicalRegistryForKeys(order.lines.map((l) => l.product_id));
  const planLines: PlanLine[] = order.lines.map((l) => ({
    productId: l.product_id,
    productName: l.product_name,
    category: l.category ?? null,
    quantity: l.quantity,
    unitPriceMinorUnits: l.price_minor_units,
  }));
  const plan = buildOrderExemptionPlan(planLines, {
    registry,
    cardedValid,
    endorsed: medSettings.medicallyEndorsed,
    saleDate: new Date().toISOString().slice(0, 10),
    exciseExemptionUntil: endorsement?.exciseExemptionUntil ?? "2029-06-30",
  });

  // HIGH-THC HARD GATE (chapter 246-70 WAC): these products sell ONLY to a
  // buyer with a valid recognition card. Statutory — NO override exists.
  if (plan.highThcViolations.length > 0) {
    const names = plan.highThcViolations.map((n) => `"${n}"`).join(", ");
    return `Sale blocked: ${names} ${plan.highThcViolations.length === 1 ? "is a DOH High-THC product" : "are DOH High-THC products"} (chapter 246-70 WAC) and may ONLY be sold to a patient with a valid recognition card. Attach the patient's card, or remove the item. There is no override for this rule.`;
  }

  // S-1b sales-limit HARD gate: a VALID attached recognition card evaluates
  // against the 3× medical limits (WAC 314-55-095(2)(d)); otherwise recreational.
  const { verdict } = await enforceSalesLimitForSale(
    check.limitLines,
    cardedValid ? "medical" : "recreational",
    {
      orderId: opts.orderId,
      actorId: opts.actorId,
      override: opts.overridePermitted
        ? { permitted: true, reason: opts.overrideReason }
        : null,
    },
  );

  if (!verdict.allowed) {
    const reasons = verdict.reasons.length ? verdict.reasons.join(" ") : "Cart exceeds a statutory limit.";
    return `Sale blocked by WAC 314-55-095 limits: ${reasons} Reduce quantities, or a manager can apply a logged override with a reason.`;
  }

  // Task O — WAC 314-55-090(2) exempt-sale ledger (write-or-block). Every
  // claimed exemption MUST have its 5-year record row; otherwise the excise
  // "shall be presumed to have been incorrectly exempted" and the store remits
  // it plus penalties (WAC 314-55-090(3)). Failure to write = refuse to complete.
  if (medCtx && cardedValid && plan.claimedLineCount > 0) {
    const draftsResult = buildExemptSaleDrafts(plan, {
      uniquePatientIdentifier: medCtx.authorization.unique_patient_identifier,
      effectiveOn: medCtx.authorization.effective_on ?? medCtx.authorization.issued_on,
      expiresOn: medCtx.authorization.expires_on,
    });
    if (!draftsResult.ok) {
      return `Medical exempt-sale records could not be prepared: ${draftsResult.error}`;
    }
    const written = await recordExemptSalesForOrder(opts.orderId, draftsResult.drafts, {
      customerId: medCtx.authorization.customer_id,
      authorizationId: medCtx.authorization.id,
      actorId: opts.actorId,
    });
    if (!written.ok) {
      return `Sale blocked — the WAC 314-55-090(2) exempt-sale records could not be written (${written.error}). Without these records the exemption is presumed invalid and the store owes the tax, so completion is refused.`;
    }
  }
  return null;
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
