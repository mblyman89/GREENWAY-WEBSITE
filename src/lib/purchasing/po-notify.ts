/**
 * src/lib/purchasing/po-notify.ts
 *
 * Best-effort purchase-order delivery via Resend REST API, mirroring
 * src/lib/orders/notify.ts. Env-gated: if RESEND_API_KEY / ORDER_EMAIL_FROM are
 * not set, this is a silent no-op and returns false (the PO is still marked
 * "sent" so the manager can export/print it manually).
 *
 * Env reused from the orders notifier:
 *   RESEND_API_KEY    — Resend API key
 *   ORDER_EMAIL_FROM  — verified "from" address
 */
import "server-only";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Email a purchase order to the vendor. Returns true if an email was actually
 * sent, false if not configured or no recipient.
 */
export async function sendPurchaseOrderEmail(params: {
  to: string | null;
  poNumber: string;
  bodyText: string;
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from || !params.to) return false;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: `Purchase Order ${params.poNumber} — Greenway Marijuana`,
        html: `
          <div style="font-family:system-ui,Arial,sans-serif;color:#111">
            <h2 style="color:#12351f">Purchase Order ${escapeHtml(params.poNumber)}</h2>
            <p>Please find our purchase order below. Reply to confirm availability and delivery.</p>
            <pre style="background:#f6f6f4;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap">${escapeHtml(params.bodyText)}</pre>
            <p style="color:#555;font-size:13px">Thank you,<br/>Greenway Marijuana Purchasing</p>
          </div>`,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
