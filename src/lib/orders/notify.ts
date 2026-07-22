/**
 * src/lib/orders/notify.ts
 *
 * Best-effort order notifications via Resend (https://resend.com). Entirely
 * env-gated: if RESEND_API_KEY (and the from/staff addresses) are not set, this
 * is a silent no-op so checkout works during rollout without an email provider.
 *
 * Env:
 *   RESEND_API_KEY        — Resend API key
 *   ORDER_EMAIL_FROM      — verified "from" address, e.g. orders@greenway...
 *   ORDER_STAFF_EMAILS    — comma-separated staff recipients for new-order alerts
 *
 * No SDK dependency — uses the Resend REST API via fetch to avoid adding a
 * package before the provider is wired up. SMS is intentionally deferred.
 */
import "server-only";
import {
  describeSendFailure,
  summarizeNotifyOutcomes,
  type EmailAudience,
  type EmailSendOutcome,
  type NotifySummary,
} from "./notify-outcome-core";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function formatCurrency(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export type OrderPlacedNotification = {
  orderNumber: string;
  customerFirstName: string;
  customerEmail: string | null;
  itemCount: number;
  totalMinorUnits: number;
};

/**
 * GW-025: the Resend response is now CHECKED — a 401 (bad key), 422
 * (unverified from-address), or 429 (rate limit) becomes a structured
 * failure outcome instead of looking exactly like success. Throws are
 * absorbed into the same outcome shape; this function never rejects.
 */
async function sendEmail(params: {
  audience: EmailAudience;
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
}): Promise<EmailSendOutcome> {
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { audience: params.audience, status: "failed", detail: describeSendFailure(res.status, body) };
    }
    return { audience: params.audience, status: "sent" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "fetch failed";
    return { audience: params.audience, status: "failed", detail };
  }
}

/**
 * Attempt the customer confirmation + staff alert and return a structured
 * summary (GW-024/GW-025): the caller decides what to log and whether the
 * order's timeline needs a visible warning. Never throws.
 */
export async function notifyOrderPlaced(n: OrderPlacedNotification): Promise<NotifySummary> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from) {
    // Not configured — a deliberate, quiet skip (rollout posture).
    return summarizeNotifyOutcomes(n.orderNumber, [
      { audience: "customer", status: "skipped" },
      { audience: "staff", status: "skipped" },
    ]);
  }

  const total = formatCurrency(n.totalMinorUnits);
  const itemWord = n.itemCount === 1 ? "item" : "items";

  const tasks: Promise<EmailSendOutcome>[] = [];

  // Customer confirmation
  if (n.customerEmail) {
    tasks.push(
      sendEmail({
        audience: "customer",
        apiKey,
        from,
        to: [n.customerEmail],
        subject: `Your Greenway pickup order ${n.orderNumber} is confirmed`,
        html: `
          <div style="font-family:system-ui,Arial,sans-serif;color:#111">
            <h2 style="color:#12351f">Thanks, ${n.customerFirstName}!</h2>
            <p>Your pickup order <strong>${n.orderNumber}</strong> is confirmed.</p>
            <p>${n.itemCount} ${itemWord} &middot; estimated total ${total}</p>
            <p style="color:#555;font-size:13px">
              This is a pickup reservation only — no payment was taken. Final
              price, tax, and purchase limits are confirmed in store. Please
              bring a valid ID.
            </p>
          </div>`,
      }),
    );
  } else {
    tasks.push(Promise.resolve<EmailSendOutcome>({ audience: "customer", status: "skipped" }));
  }

  // Staff alert
  const staffEmails = (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (staffEmails.length) {
    tasks.push(
      sendEmail({
        audience: "staff",
        apiKey,
        from,
        to: staffEmails,
        subject: `New order ${n.orderNumber} — ${n.itemCount} ${itemWord} (${total})`,
        html: `
          <div style="font-family:system-ui,Arial,sans-serif;color:#111">
            <h3>New pickup order ${n.orderNumber}</h3>
            <p>Customer: ${n.customerFirstName}</p>
            <p>${n.itemCount} ${itemWord} &middot; ${total}</p>
            <p>Open the order dashboard to acknowledge and prepare it.</p>
          </div>`,
      }),
    );
  } else {
    tasks.push(Promise.resolve<EmailSendOutcome>({ audience: "staff", status: "skipped" }));
  }

  const outcomes = await Promise.all(tasks); // sendEmail never rejects
  return summarizeNotifyOutcomes(n.orderNumber, outcomes);
}
