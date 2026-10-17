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
 * Permanent problems (bad address, catalog changed...) -> owner alert + 200
 * (so Stripe doesn't retry forever). Transient failures (Printful down) -> 500
 * so Stripe retries with backoff (up to 3 days).
 */
import { allProducts } from "@/lib/catalog";
import { STRIPE_API_VERSION } from "@/lib/checkout-core";
import { alertOwner, printful, printfulConfigured } from "@/lib/fulfillment";
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
  const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION }, cache: "no-store",
  }).catch(() => null);
  if (!r?.ok) { console.error(`[stripe-webhook] session fetch ${r?.status ?? "network"} for ${sessionId}`); return Response.json({ error: "Retry." }, { status: 500 }); }
  const session = (await r.json()) as StripeSessionLike;
  if (session.metadata?.site !== "greenwaymerch") return ok("not a greenwaymerch session");
  if (session.payment_status !== "paid") return ok(`waiting for payment (${session.payment_status ?? "?"})`);

  const c = contact();
  const plan = planPrintfulOrder(session, allProducts(), { storeName: SITE_NAME, email: c.email, phone: c.phone });
  const who = [`Order ${plan.orderRef || "(no ref)"} - Stripe session ${session.id}`, `Customer: ${plan.email || "(no email)"}`];
  if (plan.problems.length) {
    await alertOwner(`Order ${plan.orderRef || session.id} needs you - NOT sent to Printful`, [...who, ...plan.problems.map((p) => `- ${p}`), "Fix it by hand in Printful (or refund in Stripe)."]);
    return ok("problems - owner alerted");
  }
  if (!printfulConfigured()) {
    await alertOwner(`Order ${plan.orderRef} paid but Printful isn't connected`, [...who, "Set PRINTFUL_API_TOKEN in Vercel, then resend this event from the Stripe dashboard (Developers > Webhooks > event > Resend)."]);
    return Response.json({ error: "Printful not configured." }, { status: 500 });
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
