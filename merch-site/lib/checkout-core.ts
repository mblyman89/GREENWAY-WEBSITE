/**
 * R72 S5 - greenwaymerch.com checkout (PURE: no fetch, no env reads, no crypto).
 *
 * Stripe-hosted Checkout (the shopper types card + shipping address on
 * checkout.stripe.com - card data never touches our servers, so PCI scope is
 * SAQ-A). The session is created by POST /v1/checkout/sessions with a
 * form-encoded body; this module builds that body from a SERVER-priced cart.
 *
 * Verified against docs.stripe.com (API 2025-03-31.basil):
 *  - line_items[n][price_data][currency|unit_amount|product_data[name|images|metadata|tax_code]]
 *  - shipping_address_collection[allowed_countries][]  (we ship to US only)
 *  - shipping_options[n][shipping_rate_data][display_name|type=fixed_amount|
 *    fixed_amount[amount|currency]|delivery_estimate|tax_code|tax_behavior]  (max 5)
 *  - metadata values <= 500 chars; client_reference_id; success_url with
 *    {CHECKOUT_SESSION_ID}; expires_at 30 min .. 24 h from now
 *  - tax codes: txcd_30011000 "Clothing and Footwear", txcd_92010001 "Shipping"
 *
 * Shipping price is the OWNER's decision, so it is NOT guessed here: it comes
 * from env (MERCH_SHIP_FLAT_CENTS required; optional per-extra-item and
 * free-shipping threshold). Missing config = checkout refuses with a clear
 * message instead of charging a made-up amount.
 */
import { encodeCartMeta, type CartLine, type PricedLine } from "./catalog-core";
import { WA_ONLY_MESSAGE } from "./region-core";

export const STRIPE_API_VERSION = "2025-03-31.basil";
export const TAX_CODE_CLOTHING = "txcd_30011000";
export const TAX_CODE_SHIPPING = "txcd_92010001";
export const SESSION_TTL_SECONDS = 60 * 60; // 1 h (Stripe allows 30 min .. 24 h)

export interface ShippingConfig { flatCents: number; extraItemCents: number; freeOverCents: number; minDays: number; maxDays: number }

const nonNegInt = (s: string | undefined): number | null => {
  const t = (s ?? "").trim();
  return /^\d{1,6}$/.test(t) ? Number(t) : null;
};

/** Env strings -> config, or the reason checkout is closed. */
export function parseShippingConfig(env: Readonly<Record<string, string | undefined>>): { config: ShippingConfig | null; problem: string | null } {
  const flat = nonNegInt(env.MERCH_SHIP_FLAT_CENTS);
  if (flat === null) return { config: null, problem: "Shipping price is not set up yet (MERCH_SHIP_FLAT_CENTS)." };
  const minDays = nonNegInt(env.MERCH_SHIP_MIN_DAYS) ?? 0;
  const maxDays = nonNegInt(env.MERCH_SHIP_MAX_DAYS) ?? 0;
  return {
    config: {
      flatCents: flat,
      extraItemCents: nonNegInt(env.MERCH_SHIP_EXTRA_ITEM_CENTS) ?? 0,
      freeOverCents: nonNegInt(env.MERCH_FREE_SHIP_OVER_CENTS) ?? 0,
      minDays: minDays > 0 && maxDays >= minDays ? minDays : 0,
      maxDays: minDays > 0 && maxDays >= minDays ? maxDays : 0,
    },
    problem: null,
  };
}

export function shippingCents(cfg: ShippingConfig, subtotalCents: number, units: number): number {
  if (cfg.freeOverCents > 0 && subtotalCents >= cfg.freeOverCents) return 0;
  return cfg.flatCents + Math.max(0, units - 1) * cfg.extraItemCents;
}

export interface SessionInput {
  lines: readonly PricedLine[];
  orderRef: string;
  origin: string;
  shipping: ShippingConfig;
  automaticTax: boolean;
  nowSec: number;
}

/** -> [key, value] pairs for application/x-www-form-urlencoded. */
export function buildCheckoutForm(i: SessionInput): [string, string][] {
  const f: [string, string][] = [];
  const add = (k: string, v: string | number) => f.push([k, String(v)]);
  const origin = i.origin.replace(/\/+$/, "");
  add("mode", "payment");
  add("client_reference_id", i.orderRef);
  add("success_url", `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`);
  add("cancel_url", `${origin}/cart?canceled=1`);
  add("expires_at", i.nowSec + SESSION_TTL_SECONDS);
  add("shipping_address_collection[allowed_countries][0]", "US");
  // R73 S2: Washington only. Checkout can't limit states, so say it on the
  // address step and only AUTHORIZE the card; the webhook captures WA orders
  // and cancels (free) anything else. See lib/region-core.ts.
  add("custom_text[shipping_address][message]", WA_ONLY_MESSAGE);
  add("payment_intent_data[capture_method]", "manual");
  add("phone_number_collection[enabled]", "true"); // carriers + Printful use it for delivery problems
  add("billing_address_collection", "auto");
  add("submit_type", "pay");
  i.lines.forEach((l, n) => {
    const p = `line_items[${n}]`;
    add(`${p}[quantity]`, l.qty);
    add(`${p}[price_data][currency]`, "usd");
    add(`${p}[price_data][unit_amount]`, l.unitCents);
    if (i.automaticTax) add(`${p}[price_data][tax_behavior]`, "exclusive");
    add(`${p}[price_data][product_data][name]`, `${l.product.title} - ${l.variant.color} / ${l.variant.size}`.slice(0, 250));
    add(`${p}[price_data][product_data][tax_code]`, TAX_CODE_CLOTHING);
    add(`${p}[price_data][product_data][metadata][handle]`, l.product.handle);
    add(`${p}[price_data][product_data][metadata][printful_variant_id]`, l.variant.id);
    const img = l.product.images[0];
    if (img) add(`${p}[price_data][product_data][images][0]`, /^https:\/\//.test(img) ? img : `${origin}${img}`);
  });
  const subtotal = i.lines.reduce((s, l) => s + l.lineCents, 0);
  const units = i.lines.reduce((s, l) => s + l.qty, 0);
  const ship = shippingCents(i.shipping, subtotal, units);
  const s = "shipping_options[0][shipping_rate_data]";
  add(`${s}[type]`, "fixed_amount");
  add(`${s}[display_name]`, ship === 0 ? "Free shipping" : "Standard shipping");
  add(`${s}[fixed_amount][amount]`, ship);
  add(`${s}[fixed_amount][currency]`, "usd");
  add(`${s}[tax_code]`, TAX_CODE_SHIPPING);
  if (i.automaticTax) add(`${s}[tax_behavior]`, "exclusive");
  if (i.shipping.minDays > 0) {
    add(`${s}[delivery_estimate][minimum][unit]`, "business_day");
    add(`${s}[delivery_estimate][minimum][value]`, i.shipping.minDays);
    add(`${s}[delivery_estimate][maximum][unit]`, "business_day");
    add(`${s}[delivery_estimate][maximum][value]`, i.shipping.maxDays);
  }
  if (i.automaticTax) add("automatic_tax[enabled]", "true");
  add("metadata[order_ref]", i.orderRef);
  add("metadata[site]", "greenwaymerch");
  const cartMeta = encodeCartMeta(i.lines.map((l): CartLine => ({ handle: l.product.handle, variantId: l.variant.id, qty: l.qty })));
  for (const [k, v] of Object.entries(cartMeta)) add(`metadata[${k}]`, v);
  add("payment_intent_data[metadata][order_ref]", i.orderRef);
  add("payment_intent_data[description]", `Greenway Merch order ${i.orderRef}`);
  return f;
}

// ---------------------------------------------------------------------------
export function __runCheckoutCoreTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-site checkout-core: ${m}`); } };

  ok(parseShippingConfig({}).config === null && /MERCH_SHIP_FLAT_CENTS/.test(parseShippingConfig({}).problem ?? ""), "no shipping env -> checkout closed, never a guessed price");
  ok(parseShippingConfig({ MERCH_SHIP_FLAT_CENTS: "5.99" }).config === null, "dollars refused (cents only)");
  const cfg = parseShippingConfig({ MERCH_SHIP_FLAT_CENTS: "599", MERCH_SHIP_EXTRA_ITEM_CENTS: "200", MERCH_FREE_SHIP_OVER_CENTS: "10000", MERCH_SHIP_MIN_DAYS: "3", MERCH_SHIP_MAX_DAYS: "8" }).config!;
  ok(shippingCents(cfg, 3500, 1) === 599 && shippingCents(cfg, 7000, 3) === 999, "flat + per extra item");
  ok(shippingCents(cfg, 10000, 3) === 0, "free over threshold");
  ok(parseShippingConfig({ MERCH_SHIP_FLAT_CENTS: "0", MERCH_SHIP_MIN_DAYS: "9", MERCH_SHIP_MAX_DAYS: "3" }).config!.minDays === 0, "bad delivery window dropped");

  const product = { handle: "logo-tee", title: "Logo Tee", images: ["/products/logo-tee-1.jpg"] } as PricedLine["product"];
  const lines: PricedLine[] = [{ product, variant: { id: 101, color: "Black", size: "M", priceCents: 3500, inStock: true }, qty: 2, unitCents: 3500, lineCents: 7000 }];
  const form = buildCheckoutForm({ lines, orderRef: "gm-abc123-xy", origin: "https://greenwaymerch.com/", shipping: cfg, automaticTax: false, nowSec: 1_000_000 });
  const get = (k: string) => form.find(([a]) => a === k)?.[1];
  ok(get("mode") === "payment" && get("client_reference_id") === "gm-abc123-xy" && get("metadata[order_ref]") === "gm-abc123-xy", "order ref on session + metadata");
  ok(get("line_items[0][price_data][unit_amount]") === "3500" && get("line_items[0][quantity]") === "2", "server price + qty");
  ok(get("line_items[0][price_data][product_data][tax_code]") === TAX_CODE_CLOTHING && get("shipping_options[0][shipping_rate_data][tax_code]") === TAX_CODE_SHIPPING, "tax codes");
  ok(get("line_items[0][price_data][product_data][images][0]") === "https://greenwaymerch.com/products/logo-tee-1.jpg", "relative image made absolute");
  ok(get("shipping_options[0][shipping_rate_data][fixed_amount][amount]") === "799", "shipping 599 + 200 for the 2nd unit");
  ok(get("shipping_address_collection[allowed_countries][0]") === "US", "US shipping only");
  ok(get("payment_intent_data[capture_method]") === "manual", "R73 S2: authorize only - webhook captures WA orders, cancels the rest for free");
  ok(/Washington/.test(get("custom_text[shipping_address][message]") ?? ""), "R73 S2: Washington-only note on the address step");
  ok(get("metadata[cart_0]") === "logo-tee~101~2", "cart in metadata for the webhook");
  ok(get("success_url") === "https://greenwaymerch.com/checkout/success?session_id={CHECKOUT_SESSION_ID}", "success url template kept literal");
  ok(get("expires_at") === String(1_000_000 + 3600), "session expiry inside Stripe's window");
  ok(get("automatic_tax[enabled]") === undefined && get("line_items[0][price_data][tax_behavior]") === undefined, "no Stripe Tax unless switched on");
  const taxed = buildCheckoutForm({ lines, orderRef: "gm-abc123-xy", origin: "https://greenwaymerch.com", shipping: cfg, automaticTax: true, nowSec: 0 });
  ok(taxed.some(([k, v]) => k === "automatic_tax[enabled]" && v === "true") && taxed.some(([k, v]) => k === "shipping_options[0][shipping_rate_data][tax_behavior]" && v === "exclusive"), "Stripe Tax switch adds exclusive tax behaviour");
  ok(form.find(([k]) => k === "shipping_options[0][shipping_rate_data][delivery_estimate][minimum][value]")?.[1] === "3", "delivery estimate");
  return { passed, failed };
}
