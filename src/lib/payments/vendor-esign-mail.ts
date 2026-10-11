/**
 * src/lib/payments/vendor-esign-mail.ts  (R39 S7)
 *
 * One bounded Resend call for the vendor e-sign emails (invite link, code,
 * receipts, the countersigned copy). staff-alert-email.ts cannot carry a
 * plain-text part or an attachment, and the countersigned notice promises the
 * PDF is attached, so this sends both. Same rules as staff-alert-email:
 *   - never throws (every failure is a value the caller shows),
 *   - an AbortController bounds the call, so a hung provider cannot hang a
 *     vendor's "Email me a code" press,
 *   - at most 3 recipients, each checked, so a typo cannot fan out.
 * Resend documents 10 requests/second per team (docs/api-reference/rate-limit);
 * the bulk invite sends one at a time with a pause (VENDOR_BULK_PAUSE_MS).
 */
import "server-only";
import { checkEmail } from "@/lib/payments/ach-esign-core";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const VENDOR_MAIL_TIMEOUT_MS = 10_000;

export type VendorMail = {
  subject: string;
  html: string;
  text?: string;
  attachments?: { filename: string; content: Uint8Array }[];
};

export type VendorMailer = (to: string[], msg: VendorMail) => Promise<{ ok: true } | { ok: false; detail: string }>;

/** The production mailer: RESEND_API_KEY + ORDER_EMAIL_FROM (already set in Vercel). */
export function resendVendorMailer(env: Readonly<Record<string, string | undefined>> = process.env): VendorMailer {
  return async (to, msg) => {
    const apiKey = (env.RESEND_API_KEY ?? "").trim();
    const from = (env.ORDER_EMAIL_FROM ?? "").trim();
    if (!apiKey || !from) return { ok: false, detail: "RESEND_API_KEY or ORDER_EMAIL_FROM is not set" };
    const list: string[] = [];
    for (const t of to) {
      const e = checkEmail(t);
      if (e.ok && !list.includes(e.email)) list.push(e.email);
    }
    if (list.length === 0) return { ok: false, detail: "no valid recipient" };
    if (list.length > 3) return { ok: false, detail: "too many recipients" };
    const body: Record<string, unknown> = { from, to: list, subject: msg.subject.replace(/[\r\n]+/g, " ").slice(0, 200), html: msg.html };
    if (msg.text) body.text = msg.text;
    if (msg.attachments?.length) {
      body.attachments = msg.attachments.map((a) => ({
        filename: a.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100),
        content: Buffer.from(a.content).toString("base64"),
      }));
    }
    const controller = new AbortController();
    let weAborted = false;
    const timer = setTimeout(() => {
      weAborted = true;
      controller.abort();
    }, VENDOR_MAIL_TIMEOUT_MS);
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, detail: `provider returned ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}` };
      }
      return { ok: true };
    } catch (err) {
      if (weAborted) return { ok: false, detail: `timed out after ${VENDOR_MAIL_TIMEOUT_MS}ms` };
      return { ok: false, detail: err instanceof Error ? err.message : "send failed" };
    } finally {
      clearTimeout(timer);
    }
  };
}
