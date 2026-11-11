/**
 * src/lib/merch/merch-payments-server.ts  (D232 slice M-7, SOP-11 G-84 / G-86)
 *
 * Owner (D232, verbatim): "Q4: guidance first, but build the button too
 * please and all that goes with it."
 *
 * Server-only. Talks to the shop, never to Stripe directly (Stripe belongs to
 * Greenway Merchandising LLC and its key lives only in the merch project):
 *   - readOrderPayment(ref): GET  {shop}/api/payments?ref=  (Bearer MERCH_HEALTH_TOKEN)
 *   - movePayment(ref, action): POST {shop}/api/payments    (Bearer MERCH_PAYMENTS_TOKEN)
 *     The shop re-reads Stripe and refuses unless the step still applies, and
 *     uses a fixed Idempotency-Key, so nothing can be refunded twice.
 *   - sendHeldReminders: the day-3 / day-5 card-hold emails (cron only), each
 *     claimed once in compliance_reminder_log (merch-held:<pi>:<stage>).
 * Never follows a redirect (it would drop the token, F-11-1). Never throws.
 */
import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import { publicSiteOrigin } from "@/lib/site/site-domain-core";
import { merchShopOrigin } from "./merch-shop-origin";
import { heldReminders, readShopPayment, stripeDashboardUrl, type HeldItem, type PaymentRead, type ShopPayment } from "./merch-payments-core";

const TIMEOUT_MS = 15_000;

function tokenOk(name: "MERCH_HEALTH_TOKEN" | "MERCH_PAYMENTS_TOKEN"): string | null {
  const t = (process.env[name] ?? "").trim();
  return t.length >= 32 ? t : null;
}

/** Is the refund / release button switched on in THIS (main) project? */
export const paymentButtonsConfigured = (): boolean => tokenOk("MERCH_PAYMENTS_TOKEN") !== null;

async function call(method: "GET" | "POST", path: string, token: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null; problem: string }> {
  try {
    const res = await fetch(`${merchShopOrigin()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) return { status: res.status, json: null, problem: `The shop redirected to ${res.headers.get("location") ?? "another address"}; set MERCH_SHOP_URL to the final address.` };
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, json, problem: "" };
  } catch (e) {
    return { status: 0, json: null, problem: (e as { name?: string })?.name === "TimeoutError" ? "The shop did not answer in time." : "Could not reach the shop (network error)." };
  }
}

const words = (status: number, json: Record<string, unknown> | null, problem: string, tokenName: string): string =>
  problem ||
  (status === 404
    ? `The shop answered 404: ${tokenName} is missing in one of the two Vercel projects, shorter than 32 characters, not the same value in both, or the shop has not redeployed since M-7.`
    : typeof json?.problem === "string" && json.problem
      ? json.problem
      : `The shop answered ${status}.`);

export async function readOrderPayment(ref: string): Promise<PaymentRead> {
  const token = tokenOk("MERCH_HEALTH_TOKEN");
  if (!token) return { ok: false, problem: "MERCH_HEALTH_TOKEN is not set in this project, so the Stripe half can't be read. Use Stripe by hand." };
  const r = await call("GET", `/api/payments?ref=${encodeURIComponent(ref)}`, token);
  if (r.status !== 200 || !r.json) return { ok: false, problem: words(r.status, r.json, r.problem, "MERCH_HEALTH_TOKEN") };
  return { ok: true, payment: readShopPayment(r.json.payment), buttons: r.json.buttons === true };
}

export type MoveResult = { ok: true; before: ShopPayment; after: ShopPayment; stripeId: string } | { ok: false; problem: string };

export async function movePayment(ref: string, action: "release" | "refund"): Promise<MoveResult> {
  const token = tokenOk("MERCH_PAYMENTS_TOKEN");
  if (!token) return { ok: false, problem: "The refund button is off: MERCH_PAYMENTS_TOKEN is not set (32+ characters, the same value in both Vercel projects). Use the Stripe link instead." };
  const r = await call("POST", "/api/payments", token, { ref, action });
  if (r.status !== 200 || !r.json || r.json.ok !== true) return { ok: false, problem: words(r.status, r.json, r.problem, "MERCH_PAYMENTS_TOKEN") };
  return { ok: true, before: readShopPayment(r.json.before), after: readShopPayment(r.json.payment), stripeId: typeof r.json.stripeId === "string" ? r.json.stripeId.slice(0, 60) : "" };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Cron only (runMerchHealth source "cron"): one email per hold per stage. */
export async function sendHeldReminders(admin: ReturnType<typeof createSupabaseAdminClient>, held: readonly HeldItem[]): Promise<string[]> {
  const notes: string[] = [];
  const due = heldReminders(held);
  if (due.length === 0) return notes;
  const to = (process.env.ORDER_STAFF_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from || to.length === 0) return [`${due.length} card hold reminder(s) due but staff email is not configured`];
  const origin = publicSiteOrigin(process.env);
  for (const h of due) {
    const subject = `Merch card hold ${h.stage === "day5" ? "expires in about 2 days" : "is 3 days old"}: ${h.ref || h.id}`;
    try {
      const { error } = await admin.from("compliance_reminder_log").insert({ dedupe_key: h.key, stage: "merch_held", week_key: null, channel: "email", subject, recipients: "pending" });
      if (error && error.code === "23505") continue;
      if (error) { notes.push(`could not claim ${h.key}; skipped`); continue; }
    } catch {
      notes.push(`could not claim ${h.key}; skipped`);
      continue;
    }
    const order = h.ref ? `${origin}/admin/orders/merch/${encodeURIComponent(h.ref)}` : "";
    const html = `<p>A greenwaymerch.com card is only <strong>authorized</strong> (not charged) and is ${h.days} day(s) old. Stripe drops the hold after about 7 days, and then the money is gone.</p>`
      + `<p>Order: <strong>${esc(h.ref || "(no gm- reference)")}</strong> \u00b7 ${(h.amountCents / 100).toFixed(2)} USD</p>`
      + `<p>Capture it in Stripe if you will fill it (a Washington order you have fixed), or release the hold for free.</p>`
      + `<p><a href="${esc(stripeDashboardUrl(h.id, h.livemode))}">Open it in Stripe</a>${order ? ` \u00b7 <a href="${esc(order)}">Open the order</a>` : ""}</p>`
      + `<p>SOP-11 \u00a74.20.</p>`;
    const r = await sendStaffAlertEmail({ apiKey, from, to, subject, html });
    if (!r.ok) notes.push(`hold email ${h.key} failed: ${r.detail}`);
    else {
      try {
        await admin.from("compliance_reminder_log").update({ recipients: to.join(", ").slice(0, 1000) }).eq("dedupe_key", h.key);
      } catch {
        // best effort
      }
    }
  }
  return notes;
}
