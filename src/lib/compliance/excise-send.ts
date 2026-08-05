/**
 * src/lib/compliance/excise-send.ts
 *
 * Server-only: email the completed LIQ-1295 to the WSLCB via the Resend REST
 * API, mirroring src/lib/purchasing/po-notify.ts. Env-gated + fail-soft — if
 * RESEND_API_KEY is not set (or the from address is empty) this returns a
 * structured "not configured" result and the UI falls back to manual download.
 *
 * Recipients (grounded in the WSLCB Cannabis Tax Reporting Guide + Michael's
 * request):
 *   to        = EXCISE_REPORT_EMAIL (cannabistaxes@lcb.wa.gov)
 *   cc        = EXCISE_SENDER_CC    (contact@greenwaymarijuana.com)
 *   from      = EXCISE_SENDER_FROM env → ORDER_EMAIL_FROM env → default
 *   reply_to  = the return's contact e-mail (identity.email) when present
 *
 * Env:
 *   RESEND_API_KEY     — Resend API key (shared with the orders/PO notifiers)
 *   EXCISE_SENDER_FROM — verified "from" address for excise filings (optional)
 *   ORDER_EMAIL_FROM   — fallback verified "from" (already used elsewhere)
 */
import "server-only";
import {
  EXCISE_REPORT_EMAIL,
  EXCISE_SENDER_CC,
  EXCISE_SENDER_FROM_DEFAULT,
} from "@/lib/compliance/excise-payment-core";
import { buildExciseEmail, type ExciseEmailInput } from "@/lib/compliance/excise-send-core";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type ExciseSendResult =
  | { sent: true; messageId: string | null; to: string; cc: string; from: string }
  | { sent: false; reason: string };

/** Resolve the verified "from" address (env override → PO env → default). */
export function resolveExciseSenderFrom(): string {
  return (
    process.env.EXCISE_SENDER_FROM?.trim() ||
    process.env.ORDER_EMAIL_FROM?.trim() ||
    EXCISE_SENDER_FROM_DEFAULT
  );
}

/** True when outbound email is configured (API key present). */
export function isExciseSendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export type SendExciseInput = {
  email: ExciseEmailInput;
  /** The filled LIQ-1295 .xlsx bytes. */
  xlsx: Buffer;
  /** Reply-to (the return's contact e-mail); omitted when blank. */
  replyTo?: string | null;
};

/**
 * Send the LIQ-1295 to the WSLCB. Never throws — always resolves to a result.
 * The caller records the outcome (audit + sent_at) only when `sent` is true.
 */
export async function sendExciseReturnEmail(input: SendExciseInput): Promise<ExciseSendResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return { sent: false, reason: "Email sending is not configured (RESEND_API_KEY is not set)." };
  }
  const from = resolveExciseSenderFrom();
  if (!from) {
    return { sent: false, reason: "No verified sender address is configured." };
  }

  const { subject, text, html } = buildExciseEmail(input.email);
  const attachmentBase64 = input.xlsx.toString("base64");

  const body: Record<string, unknown> = {
    from,
    to: [EXCISE_REPORT_EMAIL],
    cc: [EXCISE_SENDER_CC],
    subject,
    text,
    html,
    attachments: [
      {
        // Resend "local file" attachment: base64 content + filename.
        content: attachmentBase64,
        filename: input.email.fileName,
      },
    ],
  };
  const replyTo = input.replyTo?.trim();
  if (replyTo) body.reply_to = replyTo;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { message?: string; name?: string };
        if (j?.message) detail = j.message;
        else if (j?.name) detail = j.name;
      } catch {
        // ignore body parse failure
      }
      return { sent: false, reason: `The email service rejected the send: ${detail}` };
    }

    let messageId: string | null = null;
    try {
      const j = (await res.json()) as { id?: string };
      messageId = j?.id ?? null;
    } catch {
      // success without a parseable body — still sent
    }
    return { sent: true, messageId, to: EXCISE_REPORT_EMAIL, cc: EXCISE_SENDER_CC, from };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { sent: false, reason: `Could not reach the email service: ${msg}` };
  }
}
