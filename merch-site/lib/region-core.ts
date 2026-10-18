/**
 * R73 S2 - greenwaymerch.com sells to WASHINGTON STATE ONLY (PURE: no fetch/env).
 *
 * Why: Printful does NOT collect or remit the shopper's sales tax (it only
 * charges the store owner tax on Printful's own charges unless a resale
 * certificate is on file). So Greenway Merchandising LLC is the seller of
 * record and must collect + file sales tax itself. Selling only into WA means
 * one tax authority (WA DOR) and nothing else.
 *
 * Stripe-hosted Checkout can only limit COUNTRIES (allowed_countries), not
 * states, so WA-only is enforced in three layers (all verified on docs.stripe.com):
 *   1. cart: shopper enters a ZIP; /api/checkout refuses non-WA ZIPs.
 *   2. Checkout: custom_text[shipping_address][message] tells them again, and
 *      payment_intent_data[capture_method]=manual only AUTHORIZES the card
 *      (PaymentIntent -> requires_capture; holds last ~7 days for cards).
 *   3. webhook: shipping state must be WA -> POST /v1/payment_intents/{id}/capture,
 *      else POST /v1/payment_intents/{id}/cancel. Cancelling an uncaptured
 *      payment releases the hold and costs nothing (refunds after capture do not
 *      return Stripe's fee - which is why we never capture first).
 * WA 3-digit ZIP prefixes (USPS): 980-986 and 988-994 (987 is unassigned).
 */

export const SELL_STATE = "WA";
export const SELL_STATE_NAME = "Washington";
export const WA_ONLY_MESSAGE = "We currently ship to Washington State addresses only. Orders to other states are cancelled automatically and your card is never charged.";

/** 5-digit or ZIP+4 in Washington. */
export function isWashingtonZip(zip: unknown): boolean {
  const m = typeof zip === "string" ? /^\s*(\d{3})\d{2}(?:-?\d{4})?\s*$/.exec(zip) : null;
  if (!m) return false;
  const p = Number(m[1]);
  return p >= 980 && p <= 994 && p !== 987;
}

export interface ShipAddress { state?: string | null; country?: string | null; postal_code?: string | null }

/** null = OK to sell; otherwise the reason (shown to the owner / customer). */
export function regionProblem(a: ShipAddress | null | undefined): string | null {
  if (!a) return "No shipping address on the order.";
  const country = (a.country ?? "").trim().toUpperCase();
  const state = (a.state ?? "").trim().toUpperCase();
  if (country !== "US") return `Ships to ${country || "an unknown country"} - we only sell in ${SELL_STATE_NAME}.`;
  if (state !== SELL_STATE && state !== "WASHINGTON") return `Ships to ${state || "an unknown state"} - we only sell in ${SELL_STATE_NAME}.`;
  if (!isWashingtonZip(a.postal_code ?? "")) return `ZIP ${a.postal_code || "(missing)"} is not a ${SELL_STATE_NAME} ZIP.`;
  return null;
}

/**
 * What the Stripe webhook should do with a session, decided from the
 * PaymentIntent status (the authoritative money state) - not from the
 * session's payment_status, whose value under manual capture we don't rely on.
 *   requires_capture + WA      -> capture, then send to Printful
 *   requires_capture + not WA  -> cancel (free) + tell the customer
 *   succeeded                  -> already captured (retry / legacy) -> Printful
 *   anything else              -> wait (processing, requires_action...) / ignore
 */
export type PaymentDecision = { action: "capture" | "fulfill" | "cancel" | "wait"; reason: string };

export function decidePayment(piStatus: string | null | undefined, sessionPaid: boolean, ship: ShipAddress | null | undefined): PaymentDecision {
  const region = regionProblem(ship);
  if (piStatus === "requires_capture") return region ? { action: "cancel", reason: region } : { action: "capture", reason: "authorized, Washington address" };
  if (piStatus === "succeeded" || (!piStatus && sessionPaid)) return { action: "fulfill", reason: region ? `already charged - ${region}` : "already charged" };
  return { action: "wait", reason: `payment is ${piStatus || "not authorized yet"}` };
}

export function outOfStateEmail(o: { name: string; orderRef: string; reason: string }, site: { name: string; url: string; contactEmail: string }): { subject: string; html: string; text: string } {
  const first = o.name.split(/\s+/)[0] || "there";
  const lines = [
    `Hi ${first},`,
    `Thanks for your order ${o.orderRef}. Right now ${site.name} can only ship to addresses in ${SELL_STATE_NAME} State, so we cancelled this order.`,
    "Your card was NOT charged - the temporary hold has been released. Depending on your bank, the pending amount can take a few days to disappear.",
    site.contactEmail ? `Questions? Reply to this email or write to ${site.contactEmail}.` : "",
    `- ${site.name}`,
  ].filter(Boolean);
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return {
    subject: `Your ${site.name} order ${o.orderRef} was cancelled (Washington only)`,
    text: lines.join("\n\n"),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p style="font-size:12px;color:#666">${esc(site.url)}</p></div>`,
  };
}

// ---------------------------------------------------------------------------
export function __runRegionCoreTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-site region-core: ${m}`); } };
  ok(isWashingtonZip("98501") && isWashingtonZip("99403") && isWashingtonZip("98004-1234") && isWashingtonZip(" 98101 "), "WA ZIPs (980-994, ZIP+4)");
  ok(!isWashingtonZip("97201") && !isWashingtonZip("99501") && !isWashingtonZip("98700") && !isWashingtonZip("9850") && !isWashingtonZip(98501) && !isWashingtonZip(""), "OR/AK/987/short/number refused");
  const wa = { state: "WA", country: "US", postal_code: "98501" };
  ok(regionProblem(wa) === null && regionProblem({ ...wa, state: "wa" }) === null, "WA address ok (case-insensitive)");
  ok(/OR/.test(regionProblem({ ...wa, state: "OR", postal_code: "97201" }) ?? ""), "Oregon refused with reason");
  ok(/not a Washington ZIP/.test(regionProblem({ ...wa, postal_code: "97201" }) ?? ""), "WA state + non-WA ZIP refused");
  ok(/CA/.test(regionProblem({ ...wa, country: "CA" }) ?? "") && regionProblem(null) !== null, "non-US / missing refused");
  ok(decidePayment("requires_capture", false, wa).action === "capture", "authorized WA -> capture");
  ok(decidePayment("requires_capture", false, { ...wa, state: "ID", postal_code: "83701" }).action === "cancel", "authorized non-WA -> cancel (free)");
  ok(decidePayment("succeeded", true, wa).action === "fulfill" && decidePayment(null, true, wa).action === "fulfill", "already captured -> fulfill (retry/legacy)");
  ok(decidePayment("processing", false, wa).action === "wait" && decidePayment("requires_payment_method", false, wa).action === "wait" && decidePayment(null, false, wa).action === "wait", "not authorized -> wait");
  const m = outOfStateEmail({ name: "<i>Sam</i> Lee", orderRef: "gm-abc123-xy", reason: "x" }, { name: "Greenway Merch", url: "https://greenwaymerch.com", contactEmail: "orders@greenwaymerch.com" });
  ok(m.html.includes("&lt;i&gt;Sam") && !m.html.includes("<i>Sam") && /NOT charged/.test(m.text) && m.subject.includes("gm-abc123-xy"), "customer email escaped + says not charged");
  return { passed, failed };
}
