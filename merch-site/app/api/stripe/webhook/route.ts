/**
 * POST /api/stripe/webhook  (Stripe -> greenwaymerch.com)
 *
 * Listens for checkout.session.completed / checkout.session.async_payment_succeeded
 * on Greenway Merchandising LLC's Stripe account and turns each paid session
 * into a Printful order:
 *   1. verify the Stripe-Signature header (STRIPE_WEBHOOK_SECRET, 5-min tolerance)
 *   2. re-fetch the session from Stripe at our pinned API version (so the
 *      shipping-address shape is guaranteed, whatever version the endpoint uses)
 *   3. re-price the cart lines from the server catalog -> Printful order body
 *   4. POST /orders?update_existing=true  (external_id = gm- ref => retries are
 *      idempotent). DRAFT by default - the owner reviews + confirms in
 *      /admin/orders. MERCH_PRINTFUL_AUTO_CONFIRM=true sends it straight to
 *      production instead.
 * R73 S2 - WASHINGTON ONLY: sessions are created with capture_method=manual,
 * so the card is only AUTHORIZED. Here (lib/region-core.ts decidePayment):
 *   WA address      -> check the order plan, POST /v1/payment_intents/{id}/capture, then Printful
 *   other address   -> POST /v1/payment_intents/{id}/cancel (hold released, no fee) + email the shopper
 *   plan problems   -> NOT captured; owner alerted (the hold lasts ~7 days, so
 *                      the owner can capture or cancel it in the Stripe dashboard)
 * Permanent problems (bad address, catalog changed...) -> owner alert + 200
 * (so Stripe doesn't retry forever). Transient failures (Printful down) -> 500
 * so Stripe retries with backoff (up to 3 days).
 */
import { allProducts } from "@/lib/catalog";
import { STRIPE_API_VERSION } from "@/lib/checkout-core";
import { getMerchContent } from "@/lib/site-content";
import { alertOwner, printful, printfulConfigured, sendEmail } from "@/lib/fulfillment";
import { decidePayment, outOfStateEmail } from "@/lib/region-core";
import { planPrintfulOrder, verifyStripeSignature, type StripeSessionLike } from "@/lib/orders-core";
import { contact, siteUrl, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

const ok = (note: string) => Response.json({ received: true, note });
const HANDLED = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

export async function POST(req: Request) {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!secret || !key) return Response.json({ error: "Webhook not configured." }, { status: 503 });

  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret, Math.floor(Date.now() / 1000))) {
    return Response.json({ error: "Bad signature." }, { status: 400 });
  }
  let event: { id?: string; type?: string; data?: { object?: { id?: string; object?: string } } };
  try { event = JSON.parse(raw); } catch { return Response.json({ error: "Bad JSON." }, { status: 400 }); }
  if (!HANDLED.has(event.type ?? "")) return ok("ignored event type");
  const sessionId = event.data?.object?.id ?? "";
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return ok("no session id");

  // Only sessions this site created carry metadata.site=greenwaymerch.
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=payment_intent`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION }, cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) { console.error(`[stripe-webhook] session fetch ${r?.status ?? "network"} for ${sessionId}`); return Response.json({ error: "Retry." }, { status: 500 }); }
  const session = (await r.json()) as StripeSessionLike & { payment_intent?: string | { id?: string; status?: string } | null };
  if (session.metadata?.site !== "greenwaymerch") return ok("not a greenwaymerch session");

  const pi = session.payment_intent && typeof session.payment_intent === "object" ? session.payment_intent : null;
  const ship = session.collected_information?.shipping_details ?? session.shipping_details ?? null;
  const decision = decidePayment(pi?.status, session.payment_status === "paid", ship?.address);
  if (decision.action === "wait") return ok(`waiting: ${decision.reason}`);

  const c = contact();
  const orderRef = session.metadata?.order_ref || session.client_reference_id || session.id;
  const email = session.customer_details?.email ?? "";
  const who = [`Order ${orderRef} - Stripe session ${session.id}`, `Customer: ${email || "(no email)"}`];
  const stripePost = (path: string, idem: string) => fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION, "Idempotency-Key": idem }, cache: "no-store",
  }).then(async (res) => ({ ok: res.ok, status: res.status, body: (await res.json().catch(() => null)) as { status?: string; error?: { message?: string } } | null })).catch(() => ({ ok: false, status: 0, body: null }));

  if (decision.action === "cancel") {
    const res = await stripePost(`payment_intents/${pi!.id}/cancel`, `gm-cancel-${pi!.id}`);
    if (!res.ok && res.body?.status !== "canceled") {
      if (res.status === 0 || res.status >= 500) return Response.json({ error: "Retry." }, { status: 500 });
      await alertOwner(`Out-of-state order ${orderRef} - could NOT cancel the card hold`, [...who, decision.reason, `Stripe said: ${res.body?.error?.message ?? res.status}`, "Cancel the payment by hand in the Stripe dashboard (Payments > the order > Cancel)."]);
      return ok("cancel failed - owner alerted");
    }
    if (email) {
      const w = await getMerchContent();
      const m = outOfStateEmail({ name: ship?.name ?? session.customer_details?.name ?? "", orderRef, reason: decision.reason }, { name: SITE_NAME, url: siteUrl(), contactEmail: c.email }, { subject: w["merch.email.cancelled.subject"], signoff: w["merch.email.signoff"] });
      await sendEmail({ to: email, ...m, replyTo: c.email || undefined });
    }
    await alertOwner(`Out-of-state order ${orderRef} cancelled automatically (not charged)`, [...who, decision.reason, "The card hold was released for free - nothing to do."]);
    return ok("outside Washington - authorization cancelled");
  }

  const plan = planPrintfulOrder(session, allProducts(), { storeName: SITE_NAME, email: c.email, phone: c.phone }, { captured: true });
  if (plan.problems.length) {
    const held = decision.action === "capture";
    await alertOwner(`Order ${plan.orderRef || session.id} needs you - NOT sent to Printful`, [
      ...who, ...plan.problems.map((p) => `- ${p}`),
      held ? "The card is only AUTHORIZED (not charged). In Stripe: capture it once fixed, or cancel it for free. Holds expire after about 7 days." : "Fix it by hand in Printful (or refund in Stripe).",
    ]);
    return ok("problems - owner alerted");
  }
  if (!printfulConfigured()) {
    await alertOwner(`Order ${plan.orderRef} paid but Printful isn't connected`, [...who, "Set PRINTFUL_API_TOKEN in Vercel, then resend this event from the Stripe dashboard (Developers > Webhooks > event > Resend)."]);
    return Response.json({ error: "Printful not configured." }, { status: 500 });
  }
  if (decision.action === "capture") {
    const res = await stripePost(`payment_intents/${pi!.id}/capture`, `gm-capture-${pi!.id}`);
    if (!res.ok && res.body?.status !== "succeeded") {
      if (res.status === 0 || res.status >= 500) return Response.json({ error: "Retry." }, { status: 500 });
      await alertOwner(`Order ${plan.orderRef} - card capture FAILED, not sent to Printful`, [...who, `Stripe said: ${res.body?.error?.message ?? res.status}`]);
      return ok("capture failed - owner alerted");
    }
  }

  const confirm = process.env.MERCH_PRINTFUL_AUTO_CONFIRM === "true";
  const res = await printful<{ id?: number; status?: string }>(`/orders?update_existing=true${confirm ? "&confirm=true" : ""}`, { method: "POST", body: plan.body });
  if (!res.ok) {
    const transient = res.status === 0 || res.status === 429 || res.status >= 500;
    await alertOwner(`Printful ${transient ? "is unreachable" : "rejected"} order ${plan.orderRef}`, [...who, `Printful said: ${res.error ?? res.status}`, transient ? "Stripe will retry automatically." : `Fix it in Printful, or review at ${siteUrl()}/admin/orders.`]);
    return transient ? Response.json({ error: "Retry." }, { status: 500 }) : ok("printful rejected - owner alerted");
  }
  console.log(`[stripe-webhook] ${plan.orderRef} -> Printful #${res.result?.id ?? "?"} (${res.result?.status ?? "?"})`);
  return ok(`printful ${res.result?.status ?? "created"}`);
}
