/**
 * R72 S6 - paid Stripe order -> Printful DRAFT order -> owner confirms ->
 * Printful ships -> tracking email. (No fetch / env here; node:crypto only.)
 *
 * NO DATABASE, by design: the two systems that already have to hold the
 * order ARE the record. Stripe holds the payment + customer + shipping
 * address; Printful holds the production order, addressed by OUR order ref
 * (`external_id`, e.g. GET /orders/@gm-xxxx). The webhook is idempotent on
 * that ref, so Stripe retries can never create a second Printful order.
 *
 * Verified against Printful's v1 OpenAPI (developers.printful.com/docs/openapi.json):
 *  - POST /orders body {external_id, shipping, recipient{name,company,address1,
 *    address2,city,state_code,country_code,zip,phone,email}, items[{variant_id,
 *    quantity, retail_price "12.34", name, files[{type,url,position,options}],
 *    options}], retail_costs{currency,subtotal,discount,shipping,tax,total},
 *    packing_slip{email,phone,message,store_name,custom_order_id}}; required: recipient, items
 *  - ?confirm=false (default) => DRAFT: "You are charged only for confirmed orders"
 *  - POST /orders/{id}/confirm with id = "@<external_id>"
 *  - statuses draft|failed|inreview|pending|canceled|onhold|inprocess|partial|fulfilled
 *  - webhook bodies {type, created, retries, store, data}; package_shipped
 *    data{shipment{carrier,service,tracking_number,tracking_url}, order};
 *    order_failed / order_canceled / order_put_hold data{reason, order}
 * Stripe (docs.stripe.com, API 2025-03-31.basil):
 *  - Stripe-Signature "t=<unix>,v1=<hex>"; v1 = HMAC-SHA256(secret, `${t}.${rawBody}`);
 *    reject outside a 5-minute tolerance
 *  - basil: shipping lives in session.collected_information.shipping_details
 *    {name, address{line1,line2,city,state,postal_code,country}}
 */
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { decodeCartMeta, isOrderRef, priceCart, type MerchProduct } from "./catalog-core";
import { regionProblem } from "./region-core";

// ---------------------------------------------------------------------------
// Stripe webhook signature
// ---------------------------------------------------------------------------
export const STRIPE_SIG_TOLERANCE_SEC = 300;

export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec: number): boolean {
  if (!header || !secret) return false;
  let t = 0;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((s) => s.trim());
    if (k === "t" && /^\d+$/.test(v ?? "")) t = Number(v);
    if (k === "v1" && /^[a-f0-9]{64}$/.test(v ?? "")) v1.push(v);
  }
  if (!t || !v1.length || Math.abs(nowSec - t) > STRIPE_SIG_TOLERANCE_SEC) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex"), "utf8");
  return v1.some((sig) => { const b = Buffer.from(sig, "utf8"); return b.length === expected.length && timingSafeEqual(b, expected); });
}

/** Constant-time string compare via SHA-256 (lengths never leak). */
export function secretMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected || expected.length < 16) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
/** Value stored in the admin cookie (never the key itself). */
export const adminCookieValue = (key: string) => createHash("sha256").update(`gm-admin:${key}`).digest("hex");

// ---------------------------------------------------------------------------
// Stripe session -> Printful order
// ---------------------------------------------------------------------------
export interface StripeAddress { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; postal_code?: string | null; country?: string | null }
export interface StripeSessionLike {
  id: string;
  payment_status?: string;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  amount_subtotal?: number | null;
  amount_total?: number | null;
  total_details?: { amount_shipping?: number | null; amount_tax?: number | null; amount_discount?: number | null } | null;
  customer_details?: { email?: string | null; phone?: string | null; name?: string | null } | null;
  collected_information?: { shipping_details?: { name?: string | null; address?: StripeAddress | null } | null } | null;
  /** pre-basil location, accepted as a fallback */
  shipping_details?: { name?: string | null; address?: StripeAddress | null } | null;
}

export const dollars = (cents: number) => (Math.max(0, Math.round(cents)) / 100).toFixed(2);
const clip = (s: unknown, n: number) => (typeof s === "string" ? s : "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);

export interface PrintfulOrderPlan { orderRef: string; body: Record<string, unknown>; problems: string[]; email: string }

/**
 * `opts.captured` = the webhook has just verified the PaymentIntent is
 * `succeeded` (R73 S2 manual capture), so the money is ours even if the
 * session snapshot was read before capture.
 */
export function planPrintfulOrder(s: StripeSessionLike, products: readonly MerchProduct[], packing: { storeName: string; email: string; phone: string }, opts: { captured?: boolean } = {}): PrintfulOrderPlan {
  const problems: string[] = [];
  const orderRef = clip(s.metadata?.order_ref || s.client_reference_id, 32);
  if (!isOrderRef(orderRef)) problems.push("Session has no valid gm- order ref.");
  if (s.payment_status !== "paid" && !opts.captured) problems.push(`Session is not paid (payment_status=${s.payment_status ?? "missing"}).`);
  const ship = s.collected_information?.shipping_details ?? s.shipping_details ?? null;
  const a = ship?.address ?? null;
  const region = regionProblem(a);
  if (region) problems.push(`Outside our Washington-only sales area: ${region}`);
  if (!ship?.name || !a?.line1 || !a.city || !a.postal_code || !a.country) problems.push("Shipping name/address missing on the session.");
  if (a?.country === "US" && !a.state) problems.push("US address without a state.");
  const email = clip(s.customer_details?.email, 254);

  const lines = decodeCartMeta(s.metadata ?? null);
  if (!lines.length) problems.push("No cart lines in session metadata.");
  const priced = priceCart(lines, products);
  problems.push(...priced.problems.map((p) => `Catalog changed after payment: ${p}`));
  const items = priced.lines.map((l) => {
    if (l.product.orderItem.files.some((f) => !f.url)) problems.push(`${l.product.title}: a print file has no URL.`);
    return {
      external_id: `${orderRef}-${l.variant.id}`.slice(0, 32),
      variant_id: l.variant.id,
      quantity: l.qty,
      retail_price: dollars(l.unitCents),
      name: `${l.product.title} - ${l.variant.color} / ${l.variant.size}`.slice(0, 120),
      files: l.product.orderItem.files.map((f) => ({ type: f.type, url: f.url, ...(f.position ? { position: f.position } : {}), ...(f.options?.length ? { options: f.options } : {}) })),
      ...(l.product.orderItem.options.length ? { options: l.product.orderItem.options } : {}),
    };
  });

  const td = s.total_details ?? {};
  const body = {
    external_id: orderRef,
    shipping: "STANDARD",
    recipient: {
      name: clip(ship?.name, 100),
      address1: clip(a?.line1, 200),
      ...(a?.line2 ? { address2: clip(a.line2, 200) } : {}),
      city: clip(a?.city, 100),
      ...(a?.state ? { state_code: clip(a.state, 10) } : {}),
      country_code: clip(a?.country, 2),
      zip: clip(a?.postal_code, 20),
      ...(s.customer_details?.phone ? { phone: clip(s.customer_details.phone, 30) } : {}),
      ...(email ? { email } : {}),
    },
    items,
    retail_costs: {
      currency: "USD",
      subtotal: dollars(s.amount_subtotal ?? priced.subtotalCents),
      discount: dollars(td.amount_discount ?? 0),
      shipping: dollars(td.amount_shipping ?? 0),
      tax: dollars(td.amount_tax ?? 0),
      total: dollars(s.amount_total ?? 0),
    },
    packing_slip: {
      store_name: packing.storeName,
      custom_order_id: orderRef,
      ...(packing.email ? { email: packing.email } : {}),
      ...(packing.phone ? { phone: packing.phone } : {}),
      message: "Thanks for supporting Greenway! Made to order just for you.",
    },
  };
  return { orderRef, body, problems, email };
}

// ---------------------------------------------------------------------------
// Printful webhook -> what to do
// ---------------------------------------------------------------------------
export interface PrintfulEventAction { kind: "shipped" | "problem" | "ignore"; orderRef: string; email: string; name: string; carrier?: string; service?: string; trackingNumber?: string; trackingUrl?: string; reason?: string; type: string }

export function readPrintfulEvent(raw: unknown): PrintfulEventAction {
  const ev = (raw && typeof raw === "object" ? raw : {}) as { type?: unknown; data?: { order?: { external_id?: unknown; recipient?: { email?: unknown; name?: unknown } }; shipment?: Record<string, unknown>; reason?: unknown } };
  const type = clip(ev.type, 40);
  const order = ev.data?.order ?? {};
  const base = { type, orderRef: clip(order.external_id, 32), email: clip(order.recipient?.email, 254), name: clip(order.recipient?.name, 100) };
  if (type === "package_shipped") {
    const sh = ev.data?.shipment ?? {};
    const url = clip(sh.tracking_url, 500);
    return { ...base, kind: "shipped", carrier: clip(sh.carrier, 60), service: clip(sh.service, 80), trackingNumber: clip(sh.tracking_number, 80), trackingUrl: /^https:\/\//.test(url) ? url : "" };
  }
  if (type === "order_failed" || type === "order_canceled" || type === "order_put_hold") return { ...base, kind: "problem", reason: clip(ev.data?.reason, 500) };
  return { ...base, kind: "ignore" };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** R73 S3: owner-edited wording (Website -> Merchandise -> Order emails). {order} / {site} placeholders. */
export interface EmailWording { subject?: string; note?: string; signoff?: string }
const fillT = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? v[k] : m));

export function shippedEmail(a: PrintfulEventAction, site: { name: string; url: string; contactEmail: string }, w: EmailWording = {}): { subject: string; html: string; text: string } {
  const first = a.name.split(/\s+/)[0] || "there";
  const vars = { order: a.orderRef, site: site.name };
  const subject = w.subject?.trim() ? fillT(w.subject, vars) : `Your Greenway Merch order ${a.orderRef} has shipped`;
  const lines = [
    `Hi ${first},`,
    `Good news - your order ${a.orderRef} is on its way${a.carrier ? ` with ${a.carrier}${a.service ? ` (${a.service})` : ""}` : ""}.`,
    a.trackingNumber ? `Tracking number: ${a.trackingNumber}` : "",
    a.trackingUrl ? `Track it: ${a.trackingUrl}` : "",
    w.note !== undefined ? fillT(w.note, vars) : "If your order had several items, they may arrive in separate packages.",
    site.contactEmail ? `Questions? Reply to this email or write to ${site.contactEmail}.` : "",
    w.signoff?.trim() ? fillT(w.signoff, vars) : `- ${site.name}`,
  ].filter(Boolean);
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111">${lines
    .map((l) => (l.startsWith("Track it: ") && a.trackingUrl ? `<p><a href="${esc(a.trackingUrl)}" style="display:inline-block;background:#7ed957;color:#000;font-weight:bold;padding:12px 20px;border-radius:8px;text-decoration:none">Track your package</a></p>` : `<p>${esc(l)}</p>`))
    .join("")}<p style="font-size:12px;color:#666">${esc(site.url)}</p></div>`;
  return { subject, html, text: lines.join("\n\n") };
}


// ---------------------------------------------------------------------------
// Printful order list -> admin desk rows (GET /orders; costs are dollar strings)
// ---------------------------------------------------------------------------
export const CONFIRMABLE_STATUSES = new Set(["draft"]);
export const ADMIN_STATUS_FILTERS = ["draft", "failed", "onhold", "inreview", "pending", "inprocess", "partial", "fulfilled", "canceled"] as const;

/** "12.34" -> 1234 (cents); anything unparseable -> null (never a made-up 0). */
export function centsFromDollars(v: unknown): number | null {
  const s = typeof v === "number" ? v.toFixed(2) : typeof v === "string" ? v.trim() : "";
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export interface AdminOrderRow {
  id: number; orderRef: string; status: string; createdSec: number; customer: string; shipTo: string; itemCount: number;
  /** what Printful charges us (null until Printful has priced it) */
  costCents: number | null;
  /** what the customer paid (from retail_costs we sent) */
  retailCents: number | null;
  /** retail - cost; null if either side unknown */
  marginCents: number | null;
  confirmable: boolean;
  ours: boolean;
}

export function summarizeOrder(raw: unknown): AdminOrderRow | null {
  const o = (raw && typeof raw === "object" ? raw : null) as {
    id?: unknown; external_id?: unknown; status?: unknown; created?: unknown;
    recipient?: { name?: unknown; city?: unknown; state_code?: unknown };
    items?: { quantity?: unknown }[]; costs?: { total?: unknown }; retail_costs?: { total?: unknown };
  } | null;
  if (!o || typeof o.id !== "number") return null;
  const status = clip(o.status, 20);
  const orderRef = clip(o.external_id, 32);
  const costCents = centsFromDollars(o.costs?.total);
  const retailCents = centsFromDollars(o.retail_costs?.total);
  const r = o.recipient ?? {};
  return {
    id: o.id, orderRef, status,
    createdSec: typeof o.created === "number" ? o.created : 0,
    customer: clip(r.name, 100),
    shipTo: [clip(r.city, 60), clip(r.state_code, 10)].filter(Boolean).join(", "),
    itemCount: (o.items ?? []).reduce((n, i) => n + (typeof i?.quantity === "number" ? i.quantity : 0), 0),
    costCents, retailCents,
    marginCents: costCents != null && retailCents != null ? retailCents - costCents : null,
    confirmable: CONFIRMABLE_STATUSES.has(status),
    ours: isOrderRef(orderRef),
  };
}

// ---------------------------------------------------------------------------
export function __runOrdersCoreTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error(`FAIL merch-site orders-core: ${m}`); } };

  // signature
  const secret = "whsec_test_secret";
  const body = '{"id":"evt_1"}';
  const t = 1_700_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  ok(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t + 10), "valid signature accepted");
  ok(verifyStripeSignature(body, `t=${t},v1=${"0".repeat(64)},v1=${sig}`, secret, t), "any matching v1 accepted (secret rotation)");
  ok(!verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret, t), "tampered body refused");
  ok(!verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t + 301), "replay outside 5 min refused");
  ok(!verifyStripeSignature(body, `t=${t},v1=${sig}`, "", t) && !verifyStripeSignature(body, null, secret, t), "missing secret/header refused");
  ok(secretMatches("a-very-long-admin-key-123", "a-very-long-admin-key-123") && !secretMatches("x", "a-very-long-admin-key-123") && !secretMatches("short", "short"), "admin key compare (min 16 chars)");

  // order plan
  const product = {
    handle: "logo-tee", title: "Logo Tee", category: "tees", description: "", blankLabel: "", fabric: "", images: [], colors: ["Black"], sizes: ["M"],
    variants: [{ id: 4012, color: "Black", size: "M", priceCents: 3500, inStock: true }], minPriceCents: 3500, maxPriceCents: 3500,
    orderItem: { files: [{ type: "front", url: "https://greenwaymerch.com/print/a.png", position: { area_width: 1800, area_height: 2400, width: 1800, height: 1800, top: 0, left: 0 } }], options: [] }, designId: "d", order: 0,
  } satisfies MerchProduct;
  const session: StripeSessionLike = {
    id: "cs_test_1", payment_status: "paid", client_reference_id: "gm-abc123-xy",
    metadata: { order_ref: "gm-abc123-xy", cart_0: "logo-tee~4012~2" },
    amount_subtotal: 7000, amount_total: 7799, total_details: { amount_shipping: 799, amount_tax: 0, amount_discount: 0 },
    customer_details: { email: "pat@example.com", phone: "+13605550100", name: "Pat Doe" },
    collected_information: { shipping_details: { name: "Pat Doe", address: { line1: "1 Main St", line2: null, city: "Olympia", state: "WA", postal_code: "98501", country: "US" } } },
  };
  const plan = planPrintfulOrder(session, [product], { storeName: "Greenway Merch", email: "help@x.com", phone: "" });
  const b = plan.body as { external_id: string; recipient: Record<string, string>; items: { variant_id: number; quantity: number; retail_price: string; files: { position?: unknown }[] }[]; retail_costs: Record<string, string>; packing_slip: Record<string, string> };
  ok(plan.problems.length === 0, `clean plan (${plan.problems.join("; ")})`);
  ok(b.external_id === "gm-abc123-xy" && b.packing_slip.custom_order_id === "gm-abc123-xy", "order ref is the Printful external_id + packing slip id");
  ok(b.recipient.state_code === "WA" && b.recipient.country_code === "US" && b.recipient.zip === "98501" && !("address2" in b.recipient), "recipient from basil collected_information");
  ok(b.items[0].variant_id === 4012 && b.items[0].quantity === 2 && b.items[0].retail_price === "35.00" && !!b.items[0].files[0].position, "item: variant, qty, retail price, file position");
  ok(b.retail_costs.total === "77.99" && b.retail_costs.shipping === "7.99", "retail costs in dollars");
  ok(planPrintfulOrder({ ...session, payment_status: "unpaid" }, [product], { storeName: "", email: "", phone: "" }).problems.some((p) => p.includes("not paid")), "unpaid refused");
  ok(planPrintfulOrder({ ...session, payment_status: "unpaid" }, [product], { storeName: "", email: "", phone: "" }, { captured: true }).problems.length === 0, "R73 S2: webhook-verified capture counts as paid");
  const oregon = { name: "Pat Doe", address: { line1: "1 Main St", city: "Portland", state: "OR", postal_code: "97201", country: "US" } };
  ok(planPrintfulOrder({ ...session, collected_information: { shipping_details: oregon } }, [product], { storeName: "", email: "", phone: "" }).problems.some((p) => p.includes("Washington-only")), "R73 S2: non-WA address never reaches Printful");
  ok(planPrintfulOrder({ ...session, collected_information: null, shipping_details: session.collected_information!.shipping_details }, [product], { storeName: "", email: "", phone: "" }).problems.length === 0, "pre-basil shipping_details fallback");
  ok(planPrintfulOrder({ ...session, metadata: { order_ref: "gm-abc123-xy", cart_0: "gone~1~1" } }, [product], { storeName: "", email: "", phone: "" }).problems.some((p) => p.includes("Catalog changed")), "removed product flagged, not silently dropped");
  ok(planPrintfulOrder({ ...session, metadata: { cart_0: "logo-tee~4012~1" }, client_reference_id: "nope" }, [product], { storeName: "", email: "", phone: "" }).problems.some((p) => p.includes("order ref")), "bad order ref refused");

  // printful events
  const shipped = readPrintfulEvent({ type: "package_shipped", data: { order: { external_id: "gm-abc123-xy", recipient: { email: "pat@example.com", name: "Pat Doe" } }, shipment: { carrier: "USPS", service: "Ground Advantage", tracking_number: "9400", tracking_url: "https://tools.usps.com/x?y=1" } } });
  ok(shipped.kind === "shipped" && shipped.trackingUrl!.startsWith("https://") && shipped.orderRef === "gm-abc123-xy", "package_shipped parsed");
  ok(readPrintfulEvent({ type: "package_shipped", data: { shipment: { tracking_url: "javascript:alert(1)" } } }).trackingUrl === "", "non-https tracking url dropped");
  ok(readPrintfulEvent({ type: "order_failed", data: { reason: "Bad address", order: {} } }).kind === "problem", "order_failed -> owner alert");
  ok(readPrintfulEvent({ type: "stock_updated" }).kind === "ignore" && readPrintfulEvent(null).kind === "ignore", "other events ignored");
  const mail = shippedEmail({ ...shipped, name: "<b>Pat</b> Doe" }, { name: "Greenway Merch", url: "https://greenwaymerch.com", contactEmail: "help@x.com" });
  ok(mail.html.includes("&lt;b&gt;Pat&lt;/b&gt;") && !mail.html.includes("<b>Pat") && mail.html.includes('href="https://tools.usps.com/x?y=1"'), "email escapes names, links tracking");
  ok(mail.subject.includes("gm-abc123-xy") && mail.text.includes("9400"), "email subject + text");
  const mailW = shippedEmail(shipped, { name: "GM", url: "u", contactEmail: "" }, { subject: "Shipped: {order}", note: "", signoff: "Cheers, {site}" });
  ok(mailW.subject === "Shipped: gm-abc123-xy" && !mailW.text.includes("separate packages") && mailW.text.endsWith("Cheers, GM"), "R73 S3: owner email wording (blank note dropped)");
  ok(dollars(1) === "0.01" && dollars(-5) === "0.00", "dollars()");
  ok(centsFromDollars("12.34") === 1234 && centsFromDollars("7") === 700 && centsFromDollars("") === null && centsFromDollars("abc") === null && centsFromDollars(undefined) === null, "centsFromDollars parses, never invents");
  const row = summarizeOrder({ id: 13, external_id: "gm-abc123-xy", status: "draft", created: 1602607640, recipient: { name: "Pat Doe", city: "Olympia", state_code: "WA" }, items: [{ quantity: 2 }, { quantity: 1 }], costs: { total: "41.50" }, retail_costs: { total: "77.99" } });
  ok(!!row && row.itemCount === 3 && row.costCents === 4150 && row.retailCents === 7799 && row.marginCents === 3649 && row.confirmable && row.ours && row.shipTo === "Olympia, WA", "summarizeOrder: costs, margin, confirmable draft");
  const unpriced = summarizeOrder({ id: 14, external_id: "123", status: "fulfilled", costs: { total: null } });
  ok(!!unpriced && unpriced.costCents === null && unpriced.marginCents === null && !unpriced.confirmable && !unpriced.ours, "unpriced / not-ours / not confirmable");
  ok(summarizeOrder(null) === null && summarizeOrder({ id: "x" }) === null, "junk rows dropped");
  return { passed, failed };
}
