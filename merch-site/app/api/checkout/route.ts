/**
 * POST /api/checkout  {lines: [{handle, variantId, qty}], zip}
 *  -> re-prices the cart from the server catalog (browser prices are never
 *     used), creates a Stripe Checkout Session on Greenway Merchandising LLC's
 *     OWN Stripe account (STRIPE_SECRET_KEY in this Vercel project only), and
 *     returns {url} to redirect to.
 *  R73 S2: body also carries {zip}; non-Washington ZIPs are refused here.
 */
import { randomBytes } from "node:crypto";
import { freshProducts } from "@/lib/catalog";
import { cleanCart, makeOrderRef, priceCart } from "@/lib/catalog-core";
import { availabilityProblems, buildCheckoutForm, parseShippingConfig, STRIPE_API_VERSION } from "@/lib/checkout-core";
import { printfulV2Data } from "@/lib/fulfillment";
import { isWashingtonZip, WA_ONLY_MESSAGE } from "@/lib/region-core";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!/^(sk|rk)_(live|test)_/.test(key)) return json({ error: "Checkout isn't open yet. Please check back soon." }, 503);
  const ship = parseShippingConfig(process.env);
  if (!ship.config) { console.error(`[checkout] ${ship.problem}`); return json({ error: "Checkout isn't open yet. Please check back soon." }, 503); }

  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }
  // R73 S2: Washington only - first gate (Stripe Checkout can't limit states;
  // the webhook re-checks the real shipping address before capturing).
  if (!isWashingtonZip((body as { zip?: unknown })?.zip)) return json({ error: WA_ONLY_MESSAGE, code: "wa_only" }, 422);
  const lines = cleanCart((body as { lines?: unknown })?.lines);
  if (!lines.length) return json({ error: "Your cart is empty." }, 400);
  const priced = priceCart(lines, await freshProducts());
  if (priced.problems.length || !priced.lines.length) return json({ error: "Some items changed - please review your cart.", problems: priced.problems }, 409);
  // D285: live Printful v2 availability right before Stripe (5 s, fails open).
  const ids = [...new Set(priced.lines.map((l) => l.variant.id))].slice(0, 20);
  const answers = new Map(await Promise.all(ids.map(async (id) => [id, await printfulV2Data(`/v2/catalog-variants/${id}/availability?selling_region_name=north_america`, 5_000)] as const)));
  const sold = availabilityProblems(priced.lines.map((l) => ({ title: l.product.title, color: l.variant.color, size: l.variant.size, variantId: l.variant.id, techniques: l.product.techniques })), answers);
  if (sold.length) return json({ error: "Something in your cart just sold out.", problems: sold }, 409);

  const orderRef = makeOrderRef(Date.now(), randomBytes(6).toString("hex"));
  const form = buildCheckoutForm({
    lines: priced.lines,
    orderRef,
    origin: siteUrl(),
    shipping: ship.config,
    automaticTax: process.env.MERCH_STRIPE_AUTOMATIC_TAX === "true",
    nowSec: Math.floor(Date.now() / 1000),
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      "Idempotency-Key": orderRef,
    },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  }).catch(() => null);
  const data = res ? ((await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null) : null;
  if (!res?.ok || !data?.url) {
    console.error(`[checkout] Stripe ${res?.status ?? "network"}: ${data?.error?.message ?? "no url"}`);
    return json({ error: "We couldn't start checkout. Please try again in a minute." }, 502);
  }
  return json({ url: data.url, orderRef });
}
