import "server-only";

/**
 * src/lib/notifications/sms.ts   (D182, round slice S5)
 *
 * The one network call behind staff text messages. Twilio's REST API, no SDK.
 *
 * OWNER (2026-11-04): "Nudges by admin screens only for now, it build the
 * email and text options so I can use it if needed. They will listen if they
 * are nagged on their phones."
 *
 * So this is BUILT and OFF. It sends nothing unless BOTH are true:
 *   1. the three env vars are set on Vercel:
 *        TWILIO_ACCOUNT_SID   (starts AC...)
 *        TWILIO_AUTH_TOKEN
 *        TWILIO_FROM          (the Twilio number, +1..., or a Messaging Service SID MG...)
 *   2. the owner switched texts on at /admin/registers/night-watch.
 *
 * Bounded (8 s per message, like the staff alert email) and it NEVER throws:
 * a dead text provider must not break the morning report or anything else.
 */

const TIMEOUT_MS = 8_000;

export function isSmsConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

export type SmsResult = { sent: number; failed: { to: string; detail: string }[] };

async function sendOne(sid: string, token: string, from: string, to: string, body: string): Promise<string | null> {
  const controller = new AbortController();
  let weAborted = false;
  const timer = setTimeout(() => {
    weAborted = true;
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const form = new URLSearchParams({ To: to, Body: body });
    if (from.startsWith("MG")) form.set("MessagingServiceSid", from);
    else form.set("From", from);
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return `provider returned ${res.status}${t ? `: ${t.slice(0, 160)}` : ""}`;
    }
    return null;
  } catch (e) {
    if (weAborted) return `timed out after ${TIMEOUT_MS}ms`;
    return e instanceof Error ? e.message : "send failed";
  } finally {
    clearTimeout(timer);
  }
}

/** Text every number. Returns counts; never throws. */
export async function sendStaffSms(to: readonly string[], body: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const from = process.env.TWILIO_FROM ?? "";
  if (!sid || !token || !from) return { sent: 0, failed: to.map((t) => ({ to: t, detail: "text service not set up" })) };
  const out: SmsResult = { sent: 0, failed: [] };
  for (const n of to) {
    const err = await sendOne(sid, token, from, n, body);
    if (err) out.failed.push({ to: n, detail: err });
    else out.sent++;
  }
  return out;
}
