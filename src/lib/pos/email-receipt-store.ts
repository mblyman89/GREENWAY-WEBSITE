/**
 * src/lib/pos/email-receipt-store.ts
 *
 * Server-side digital-receipt sender for the POS (Slice B30). Follows the
 * repo's Resend pattern (orders/notify.ts, purchasing/po-notify.ts): REST
 * fetch, env-gated on RESEND_API_KEY + ORDER_EMAIL_FROM, no SDK.
 *
 * Privacy: the customer's address is used ONCE and never persisted — the
 * audit row records a masked form ("j***@gmail.com") plus the receipt
 * number, so the paper trail shows a receipt was emailed without keeping
 * the address. This is opt-in transactional mail (the customer asked for
 * it at the register), not marketing — WAC 314-55-155 advertising rules
 * are not in play, and the email body carries no marketing content.
 */
import "server-only";

import { recordAudit } from "@/lib/auth/audit";
import { receiptNumber, type PosReceiptInput } from "@/lib/pos/receipt-core";
import {
  buildEmailReceiptHtml,
  emailReceiptSubject,
  maskEmailForAudit,
} from "@/lib/pos/email-receipt-core";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export type EmailReceiptResult =
  | { ok: true; receiptNumber: string }
  | { ok: false; error: string };

/** True when the email provider is configured (register shows/hides the option). */
export function isEmailReceiptConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.ORDER_EMAIL_FROM);
}

/**
 * Send the receipt email. `email` must already be normalized by
 * `normalizeReceiptEmail`; `receipt` must already be validated by
 * `validateEmailReceiptSnapshot`. Audits success AND provider failure —
 * never throws.
 */
export async function sendEmailReceipt(params: {
  email: string;
  receipt: PosReceiptInput;
  deviceId: string;
  deviceName: string;
}): Promise<EmailReceiptResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from) {
    return { ok: false, error: "Email receipts are not configured — print the paper receipt." };
  }

  const number = receiptNumber(params.receipt.saleClientUuid);
  let sent = false;
  let providerError: string | null = null;
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.email],
        subject: emailReceiptSubject(params.receipt),
        html: buildEmailReceiptHtml(params.receipt),
      }),
    });
    sent = res.ok;
    if (!res.ok) providerError = `Provider responded ${res.status}.`;
  } catch {
    providerError = "Could not reach the email provider.";
  }

  await recordAudit({
    actorId: null,
    actorEmail: `pos-device:${params.deviceId}`,
    action: sent ? "register.receipt_emailed" : "register.receipt_email_failed",
    entityType: "pos_sale",
    entityId: params.receipt.saleClientUuid,
    after: {
      receiptNumber: number,
      emailMasked: maskEmailForAudit(params.email),
      device: params.deviceName,
      totalMinor: params.receipt.totalMinor,
      ...(providerError ? { providerError } : {}),
    },
  });

  if (!sent) {
    return { ok: false, error: "Email did not go through — offer the paper receipt instead." };
  }
  return { ok: true, receiptNumber: number };
}
