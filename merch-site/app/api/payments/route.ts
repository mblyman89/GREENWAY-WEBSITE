/**
 * /api/payments  (back office -> greenwaymerch.com), D232 M-7 (G-86, G-84).
 *
 * Owner (D232, verbatim): "Q4: guidance first, but build the button too
 * please and all that goes with it."
 *
 *   GET  ?ref=gm-...            -> that order's Stripe payment (status, amount,
 *                                  captured, refunded, what may be done now).
 *                                  Read-only. Bearer MERCH_HEALTH_TOKEN (the
 *                                  same read token as /api/health).
 *   POST {ref, action}          -> action "release" (drop an uncaptured card
 *                                  hold) or "refund" (refund the full charged
 *                                  amount). Bearer MERCH_PAYMENTS_TOKEN, its
 *                                  own 32+ character token, because this one
 *                                  moves money. Not set -> 404 (no button).
 *
 * The payment is always re-read from Stripe first and the step is refused
 * unless Stripe's CURRENT status allows it (lib/payments-core.ts). Every
 * Stripe write carries a fixed Idempotency-Key per PaymentIntent, so a double
 * click or a retry can never refund twice. The back office audits each press.
 * Missing / wrong token -> 404, like the catalog feed and /api/health.
 */
import { secretMatches } from "@/lib/orders-core";
import { STRIPE_API_VERSION } from "@/lib/checkout-core";
import { isPaymentAction, ORDER_REF_RE, paymentSearchQuery, planPaymentAction, readPayment, type PaymentSummary } from "@/lib/payments-core";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const notFound = () => new Response("Not found", { status: 404, headers: HEADERS });

function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

function allowed(req: Request, envName: "MERCH_HEALTH_TOKEN" | "MERCH_PAYMENTS_TOKEN"): boolean {
  const expected = (process.env[envName] ?? "").trim();
  return expected.length >= 32 && secretMatches(bearer(req), expected);
}

async function lookup(key: string, ref: string): Promise<{ status: number; payment: PaymentSummary | null; problem: string }> {
  const q = paymentSearchQuery(ref);
  if (!q) return { status: 400, payment: null, problem: "Not a gm- order reference." };
  const url = `https://api.stripe.com/v1/payment_intents/search?query=${encodeURIComponent(q)}&limit=10&expand[]=data.latest_charge`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION }, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const body = (await res.json().catch(() => null)) as { data?: unknown; error?: { message?: string } } | null;
    if (!res.ok) return { status: res.status, payment: null, problem: `Stripe answered ${res.status}: ${body?.error?.message ?? "no message"}` };
    return { status: 200, payment: readPayment(body?.data, ref), problem: "" };
  } catch {
    return { status: 0, payment: null, problem: "Could not reach Stripe (network error or timeout)." };
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!allowed(req, "MERCH_HEALTH_TOKEN")) return notFound();
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return Response.json({ ok: false, problem: "STRIPE_SECRET_KEY is not set in the merch project." }, { status: 503, headers: HEADERS });
  const ref = new URL(req.url).searchParams.get("ref") ?? "";
  const r = await lookup(key, ref);
  return Response.json({ ok: r.status === 200, payment: r.payment, problem: r.problem, buttons: (process.env.MERCH_PAYMENTS_TOKEN ?? "").trim().length >= 32 }, { status: r.status === 200 ? 200 : r.status === 400 ? 400 : 502, headers: HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  if (!allowed(req, "MERCH_PAYMENTS_TOKEN")) return notFound();
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return Response.json({ ok: false, problem: "STRIPE_SECRET_KEY is not set in the merch project." }, { status: 503, headers: HEADERS });
  const body = (await req.json().catch(() => null)) as { ref?: unknown; action?: unknown } | null;
  const ref = typeof body?.ref === "string" ? body.ref : "";
  if (!ORDER_REF_RE.test(ref) || !isPaymentAction(body?.action)) return Response.json({ ok: false, problem: "Send {ref: gm-..., action: release | refund}." }, { status: 400, headers: HEADERS });
  const action = body.action;

  const before = await lookup(key, ref);
  if (!before.payment) return Response.json({ ok: false, problem: before.problem }, { status: 502, headers: HEADERS });
  const plan = planPaymentAction(before.payment, action, ref);
  if (!plan.ok) return Response.json({ ok: false, problem: plan.problem, payment: before.payment }, { status: 409, headers: HEADERS });

  const form = new URLSearchParams(plan.form);
  const res = await fetch(`https://api.stripe.com${plan.path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_API_VERSION, "Idempotency-Key": plan.idempotencyKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const answer = res ? ((await res.json().catch(() => null)) as { id?: string; status?: string; error?: { message?: string } } | null) : null;
  if (!res?.ok) {
    console.error(`[payments] ${action} ${ref} failed: ${res?.status ?? "network"} ${answer?.error?.message ?? ""}`);
    return Response.json({ ok: false, problem: `Stripe refused: ${answer?.error?.message ?? (res ? `HTTP ${res.status}` : "network error")}`, payment: before.payment }, { status: 502, headers: HEADERS });
  }
  console.log(`[payments] ${action} ${ref} -> ${answer?.id ?? "?"} (${answer?.status ?? "?"})`);
  const after = await lookup(key, ref);
  return Response.json({ ok: true, stripeId: answer?.id ?? "", stripeStatus: answer?.status ?? "", before: before.payment, payment: after.payment ?? before.payment }, { headers: HEADERS });
}
