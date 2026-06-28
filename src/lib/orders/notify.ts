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

async function sendEmail(params: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  await fetch(RESEND_ENDPOINT, {
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
}

export async function notifyOrderPlaced(n: OrderPlacedNotification): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from) return; // not configured — silent no-op

  const total = formatCurrency(n.totalMinorUnits);
  const itemWord = n.itemCount === 1 ? "item" : "items";

  const tasks: Promise<void>[] = [];

  // Customer confirmation
  if (n.customerEmail) {
    tasks.push(
      sendEmail({
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
      }).catch(() => {}),
    );
  }

  // Staff alert
  const staffEmails = (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (staffEmails.length) {
    tasks.push(
      sendEmail({
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
      }).catch(() => {}),
    );
  }

  await Promise.allSettled(tasks);
}
