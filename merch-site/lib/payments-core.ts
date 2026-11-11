/**
 * D232 M-7 (G-84, G-86, SOP-11 §4.19 / §4.20) - the shop's view of ONE
 * order's Stripe payment, and the two money steps the back office may ask
 * for. PURE: no fetch, no env. app/api/payments/route.ts does the calls.
 *
 * Owner (D232, verbatim): "Q4: guidance first, but build the button too
 * please and all that goes with it."
 *
 *   release  POST /v1/payment_intents/{id}/cancel   - only while the card is
 *            only AUTHORIZED (requires_capture): the hold is dropped, no fee.
 *   refund   POST /v1/refunds payment_intent={id}    - only once it was
 *            charged (succeeded) and not already fully refunded. Always the
 *            FULL remaining amount (no partial refunds from the back office).
 * Both use a fixed Idempotency-Key per PaymentIntent, so a double click, a
 * retry or a stale page can never move money twice.
 */

export const ORDER_REF_RE = /^gm-[a-z0-9]{6,12}-[a-z0-9]{1,8}$/;
export const PAYMENT_ACTIONS = ["release", "refund"] as const;
export type PaymentAction = (typeof PAYMENT_ACTIONS)[number];

export interface PaymentSummary {
  found: boolean;
  /** pi_... (not a secret). */
  id: string;
  status: string;
  amountCents: number;
  capturedCents: number;
  refundedCents: number;
  currency: string;
  createdSec: number;
  livemode: boolean | null;
  /** What the back office may do now. */
  canRelease: boolean;
  canRefund: boolean;
}

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);

export const notFoundPayment = (): PaymentSummary => ({ found: false, id: "", status: "", amountCents: 0, capturedCents: 0, refundedCents: 0, currency: "usd", createdSec: 0, livemode: null, canRelease: false, canRefund: false });

/** The Stripe search query for one order (the ref is validated first, so nothing can be injected). */
export function paymentSearchQuery(ref: string): string | null {
  return ORDER_REF_RE.test(ref) ? `metadata['order_ref']:'${ref}'` : null;
}

/**
 * Stripe search `data` (PaymentIntents, latest_charge expanded) -> the newest
 * one whose metadata.order_ref is exactly this ref.
 */
export function readPayment(data: unknown, ref: string): PaymentSummary {
  const list = (Array.isArray(data) ? data : []).filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
  const mine = list
    .filter((p) => (p.metadata as { order_ref?: unknown } | null)?.order_ref === ref && typeof p.id === "string" && /^pi_[A-Za-z0-9]+$/.test(p.id))
    .sort((a, b) => int(b.created) - int(a.created))[0];
  if (!mine) return notFoundPayment();
  const charge = mine.latest_charge && typeof mine.latest_charge === "object" ? (mine.latest_charge as Record<string, unknown>) : null;
  const status = String(mine.status ?? "");
  const amount = int(mine.amount);
  const captured = status === "succeeded" ? int(mine.amount_received) || amount : 0;
  const refunded = charge ? int(charge.amount_refunded) : 0;
  return {
    found: true,
    id: String(mine.id),
    status,
    amountCents: amount,
    capturedCents: captured,
    refundedCents: refunded,
    currency: String(mine.currency ?? "usd"),
    createdSec: int(mine.created),
    livemode: typeof mine.livemode === "boolean" ? mine.livemode : null,
    canRelease: status === "requires_capture",
    canRefund: status === "succeeded" && captured > refunded,
  };
}

export type PaymentPlan =
  | { ok: true; path: string; form: [string, string][]; idempotencyKey: string }
  | { ok: false; problem: string };

/** Which Stripe call, if any, an action means for this payment right now. */
export function planPaymentAction(p: PaymentSummary, action: PaymentAction, ref: string): PaymentPlan {
  if (!p.found) return { ok: false, problem: "No Stripe payment was found for this order." };
  if (action === "release") {
    if (!p.canRelease) return { ok: false, problem: `Stripe says this payment is "${p.status}", so there is no card hold to release.` };
    return { ok: true, path: `/v1/payment_intents/${p.id}/cancel`, form: [["cancellation_reason", "requested_by_customer"]], idempotencyKey: `gm-cancel-${p.id}` };
  }
  if (!p.canRefund) {
    return { ok: false, problem: p.status === "succeeded" ? "This payment is already fully refunded." : `Stripe says this payment is "${p.status}", so there is nothing charged to refund${p.status === "requires_capture" ? " (release the hold instead)" : ""}.` };
  }
  return {
    ok: true,
    path: "/v1/refunds",
    form: [["payment_intent", p.id], ["reason", "requested_by_customer"], ["metadata[order_ref]", ref], ["metadata[source]", "greenway-back-office"]],
    idempotencyKey: `gm-refund-${p.id}`,
  };
}

export function isPaymentAction(v: unknown): v is PaymentAction {
  return typeof v === "string" && (PAYMENT_ACTIONS as readonly string[]).includes(v);
}

export function __runPaymentsCoreTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-site payments-core: ${m}`); } };
  const ref = "gm-abc123-xy";
  ok(paymentSearchQuery(ref) === "metadata['order_ref']:'gm-abc123-xy'", "search query");
  ok(paymentSearchQuery("gm-x' OR '1") === null && paymentSearchQuery("") === null, "bad ref refused (no injection)");
  const held = readPayment([{ id: "pi_old", status: "canceled", created: 1, amount: 100, metadata: { order_ref: ref } }, { id: "pi_new", status: "requires_capture", created: 5, amount: 2599, metadata: { order_ref: ref }, livemode: true }, { id: "pi_other", status: "succeeded", created: 9, metadata: { order_ref: "gm-zzz999-aa" } }], ref);
  ok(held.found && held.id === "pi_new" && held.canRelease && !held.canRefund && held.capturedCents === 0 && held.livemode === true, "newest PI for this ref; hold can be released");
  const rel = planPaymentAction(held, "release", ref);
  ok(rel.ok && rel.path === "/v1/payment_intents/pi_new/cancel" && rel.idempotencyKey === "gm-cancel-pi_new", "release -> cancel, same key as the shop webhook");
  ok(!planPaymentAction(held, "refund", ref).ok, "cannot refund a hold");
  const paid = readPayment([{ id: "pi_p", status: "succeeded", created: 2, amount: 3000, amount_received: 3000, metadata: { order_ref: ref }, latest_charge: { amount_refunded: 0 } }], ref);
  ok(paid.canRefund && !paid.canRelease && paid.capturedCents === 3000, "charged -> refundable");
  const rf = planPaymentAction(paid, "refund", ref);
  ok(rf.ok && rf.path === "/v1/refunds" && rf.idempotencyKey === "gm-refund-pi_p" && rf.form.some(([k, v]) => k === "payment_intent" && v === "pi_p"), "refund -> full refund, fixed key");
  ok(!planPaymentAction(paid, "release", ref).ok, "cannot release a charged payment");
  const done = readPayment([{ id: "pi_d", status: "succeeded", created: 2, amount: 3000, amount_received: 3000, metadata: { order_ref: ref }, latest_charge: { amount_refunded: 3000 } }], ref);
  ok(!done.canRefund && !planPaymentAction(done, "refund", ref).ok, "fully refunded -> no second refund");
  ok(!readPayment(null, ref).found && !planPaymentAction(readPayment([], ref), "refund", ref).ok, "nothing found");
  ok(!readPayment([{ id: "ch_x", status: "succeeded", metadata: { order_ref: ref } }], ref).found, "only pi_ ids");
  ok(isPaymentAction("refund") && isPaymentAction("release") && !isPaymentAction("capture"), "only release and refund");
  return { passed, failed };
}
