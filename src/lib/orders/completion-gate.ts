/**
 * src/lib/orders/completion-gate.ts  (POS Slice B1)
 *
 * The → completed COMPLIANCE GATE, extracted VERBATIM from
 * src/app/admin/orders/actions.ts so that BOTH callers run the identical
 * sequence:
 *   1. the admin order dashboard (setOrderStatusAction), and
 *   2. the POS sync ingest route (every synced register sale re-runs this
 *      gate server-side before it may complete — POS_SEAM_AUDIT Seam 2).
 *
 * Gate sequence (order matters; see docs/POS_SEAM_AUDIT.md §Seam 2):
 *   1. idempotent re-complete (already completed → allow)
 *   2. S-12 sales-hours gate (WAC 314-55-147) — HARD, no override
 *   3. AN-7 recall-hold HARD gate — a line whose product has ANY lot in
 *      `recalled` status may not sell; NO override. Fail-CLOSED: if recall
 *      status cannot be read, the sale is refused rather than guessed safe.
 *   4. S-2b money recompute gate (verifyStoredOrderForCompletion)
 *   5. Task S-a loyalty-code consistency gate
 *   6. Task O attached-card re-validation (invalid card BLOCKS)
 *   7. Task O DOH 246-70 high-THC HARD gate — statutory, NO override
 *   8. S-1b sales-limit HARD gate (WAC 314-55-095) — logged override only
 *   9. Task O WAC 314-55-090(2) exempt-sale ledger write-or-block
 *
 * Returns null when the order may complete, or a human-readable refusal.
 * The CALLER is responsible for permission checks (sales_limit.override) and
 * for auditing refusals (order.completion_blocked) — this module never trusts
 * a client flag.
 */
import "server-only";
import { getOrder } from "@/lib/orders/orders-store";
import { verifyStoredOrderForCompletion } from "@/lib/orders/order-pricing";
import { checkLoyaltyCodeForCompletion } from "@/lib/loyalty/loyalty-sale-core";
import { getOrderLoyaltyContext } from "@/lib/loyalty/loyalty-sale-store";
import { enforceSalesLimitForSale } from "@/lib/compliance/sales-limits";
import { evaluateSalesHours } from "@/lib/compliance/sales-hours-core";
import { getSalesHoursWindow } from "@/lib/compliance/sales-hours-store";
import { authorizationValidityAt } from "@/lib/medical/medical-authorization-core";
import { toRecognitionCard, getMedTaxSettings, getEndorsementConfig } from "@/lib/medical/store";
import {
  getOrderMedicalContext,
  getMedicalRegistryForKeys,
  recordExemptSalesForOrder,
} from "@/lib/medical/sale-store";
import {
  buildOrderExemptionPlan,
  buildExemptSaleDrafts,
  type PlanLine,
} from "@/lib/medical/medical-sale-core";
import { findHeldLines, recallHoldRefusal } from "@/lib/pos/recall-hold-core";
import { recalledProductKeys } from "@/lib/pos/recall-hold-store";

export type CompletionGateOptions = {
  orderId: string;
  /**
   * staff_profiles id for audit rows. NULL for POS-synced sales made by a
   * floor employee with no back-office login (the pos_sale_events row still
   * pins the employees.id).
   */
  actorId: string | null;
  /** Caller-verified result of the sales_limit.override permission check. */
  overridePermitted: boolean;
  overrideReason: string | null;
  /**
   * AN-3(a) — the instant the SALE OCCURRED, for the sales-hours gate.
   * Defaults to now (back-office and pickup complete in real time). POS sync
   * passes the event's occurredAt: an offline sale rung at 11 PM that
   * flushes at 2 AM was LEGAL and must not be refused for arriving late —
   * and a sale actually rung at 2 AM must be refused even if it syncs at
   * noon. The statute governs when the SALE happened, not when it synced.
   */
  hoursAt?: Date | string;
};

/**
 * The → completed compliance gate. Returns null when the order may complete,
 * or a human-readable refusal message when it must not.
 */
export async function runCompletionGate(opts: CompletionGateOptions): Promise<string | null> {
  const order = await getOrder(opts.orderId);
  if (!order) return "Order not found.";
  if (order.status === "completed") return null; // idempotent re-complete

  // ── S-12: sales-hours gate (WAC 314-55-147) ─────────────────────────────────
  // A sale may only complete 8:00 AM–midnight on the STORE's (Pacific) wall
  // clock; the owner may configure a TIGHTER window in Settings → Sales hours.
  // This is a HARD block — the statute has no override; a tighter owner
  // window is widened in Settings, never bypassed at the register.
  const hoursWindow = await getSalesHoursWindow();
  const hoursVerdict = evaluateSalesHours(opts.hoursAt ?? new Date(), hoursWindow);
  if (!hoursVerdict.allowed) {
    return `Sale blocked outside sales hours. ${hoursVerdict.reason}`;
  }

  // ── AN-7: recall-hold HARD gate ────────────────────────────────────────────
  // A product with ANY lot in `recalled` status may not sell — recalled
  // product must be segregated and held (LCB recall discipline; same posture
  // as the DOH high-THC gate: NO override). Fail-CLOSED: if the recall table
  // cannot be read we refuse rather than guess the product is safe. Routine
  // `quarantine` lots (intake holds, 72h destruction holds) never trip this —
  // see recall-hold-core.ts.
  try {
    const held = await recalledProductKeys({ failClosed: true });
    if (held.size > 0) {
      const heldNames = findHeldLines(
        order.lines.map((l) => ({ productId: l.product_id, productName: l.product_name })),
        held,
      );
      const refusal = recallHoldRefusal(heldNames);
      if (refusal) return refusal;
    }
  } catch {
    return "Sale blocked: the recall-hold status of this order's products could not be verified (inventory read failed). Try again; if it persists, contact the administrator. Selling cannot proceed while recall status is unknown.";
  }

  // ── S-2b: money recompute gate ───────────────────────────────────────────────
  const check = await verifyStoredOrderForCompletion(order);
  if (!check.ok) {
    return `Money check failed — fix the order first. ${check.problems.join(" ")}`;
  }

  // ── Task S-a: loyalty-code consistency gate ──────────────────────────────────
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

  // ── S-1b: sales-limit HARD gate ──────────────────────────────────────────────
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
