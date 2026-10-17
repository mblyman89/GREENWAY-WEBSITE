/**
 * Server-only REST clients for fulfillment (no SDKs, no database):
 *   - Printful v1 (https://api.printful.com) - orders are created as DRAFTS
 *     with external_id = our gm- order ref, so Printful + Stripe are the
 *     system of record and retries are idempotent (?update_existing=true).
 *   - Resend (https://api.resend.com/emails) - shipped emails + owner alerts.
 * Every call fails soft: it returns {ok:false, error} and never throws.
 * Imported only by route handlers / server components (never by "use client").
 */

const env = (k: string) => (process.env[k] ?? "").trim();
const PRINTFUL = "https://api.printful.com";

export const printfulConfigured = () => env("PRINTFUL_API_TOKEN").length > 0;

export interface PrintfulResult<T = unknown> { ok: boolean; status: number; result?: T; error?: string; paging?: { total?: number; offset?: number; limit?: number } }

export async function printful<T = unknown>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<PrintfulResult<T>> {
  const token = env("PRINTFUL_API_TOKEN");
  if (!token) return { ok: false, status: 0, error: "PRINTFUL_API_TOKEN is not set." };
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  // Only needed for account-level tokens; store-level tokens ignore it.
  if (env("PRINTFUL_STORE_ID")) headers["X-PF-Store-Id"] = env("PRINTFUL_STORE_ID");
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${PRINTFUL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  }).catch((e: unknown) => ({ error: e instanceof Error ? e.message : "network error" }) as const);
  if ("error" in res) return { ok: false, status: 0, error: res.error };
  const data = (await res.json().catch(() => null)) as { result?: T; error?: { message?: string }; paging?: PrintfulResult["paging"] } | null;
  if (!res.ok) {
    const msg = data?.error?.message ?? (typeof data?.result === "string" ? data.result : `HTTP ${res.status}`);
    return { ok: false, status: res.status, error: msg };
  }
  return { ok: true, status: res.status, result: data?.result, paging: data?.paging };
}

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<{ ok: boolean; error?: string }> {
  const key = env("RESEND_API_KEY");
  const from = env("MERCH_EMAIL_FROM");
  if (!key || !from) return { ok: false, error: "RESEND_API_KEY / MERCH_EMAIL_FROM not set." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.to)) return { ok: false, error: "Bad recipient address." };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) }),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return { ok: false, error: `Resend ${res?.status ?? "network"}` };
  return { ok: true };
}

/** Owner alert (MERCH_ORDER_ALERT_EMAIL). Always also logged so Vercel logs show it. */
export async function alertOwner(subject: string, lines: string[]): Promise<void> {
  console.error(`[merch-alert] ${subject} :: ${lines.join(" | ")}`);
  const to = env("MERCH_ORDER_ALERT_EMAIL");
  if (!to) return;
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  await sendEmail({
    to,
    subject: `[Greenway Merch] ${subject}`,
    text: lines.join("\n"),
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`,
  });
}
