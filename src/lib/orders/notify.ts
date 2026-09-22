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
import {
  DEFAULT_ORDER_ORIGIN,
  mayEmailCustomerForOrigin,
  mayEmailStaffForOrigin,
  toOrderOrigin,
  type OrderOrigin,
} from "./order-origin-core";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * SLICE L-19 — the staff recipient list, parsed in ONE place.
 *
 * Exported so the compliance test can prove that the copy in the pure
 * `email-readiness-core.ts` (which imports nothing, and so cannot import this)
 * agrees with it on a shared corpus of hostile inputs. Proving the duplicate
 * has not drifted is worth more than asserting that it has not.
 *
 * It matters because `assessEmailReadiness` reports "no staff addresses are
 * configured" as a FAULT. If these two disagreed about whether `" , "` is a
 * recipient, the dashboard would warn about a problem that does not exist, or
 * stay silent about one that does.
 */
export function parseStaffEmailList(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatCurrency(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

export type OrderPlacedNotification = {
  orderNumber: string;
  customerFirstName: string;
  customerEmail: string | null;
  itemCount: number;
  totalMinorUnits: number;
  /**
   * SLICE L-5 — where the order came from.
   *
   * Optional, and absent means `greenway`, so every existing call site keeps
   * its current behaviour unchanged. It exists because Leafly's Order API
   * specification states, verbatim:
   *
   *   "Leafly will be the sole originator of automated consumer facing
   *    communications related to orders placed on the Leafly platform. That is,
   *    Leafly shoppers should receive _no_ automated emails or text messages
   *    from a partner system with regard to order confirmation, status updates,
   *    etc."
   *
   * Sending our own confirmation for a Leafly order is therefore a breach of
   * the integration agreement, not merely a duplicate email — and it is the
   * kind of breach that is invisible to us, because the complaint goes to
   * Leafly.
   */
  origin?: OrderOrigin | string | null;
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
  // SLICE L-5. Resolve the origin FIRST, before any provider check, so the
  // marketplace rule holds even on a deployment where Resend is unconfigured
  // today and configured tomorrow. `toOrderOrigin` normalises anything unknown
  // to the default rather than throwing; `mayEmailCustomerForOrigin` then asks
  // "is this origin explicitly PERMITTED?", so a future marketplace that nobody
  // remembers to whitelist stays silent instead of emailing.
  const origin: OrderOrigin =
    n.origin === undefined || n.origin === null
      ? DEFAULT_ORDER_ORIGIN
      : toOrderOrigin(n.origin);
  const customerAllowed = mayEmailCustomerForOrigin(origin);
  const staffAllowed = mayEmailStaffForOrigin(origin);

  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  if (!apiKey || !from) {
    // SLICE L-19 — this used to be a SILENT skip, and that was the bug.
    //
    // The rollout posture that justified silence ("checkout must work before
    // the email provider is wired up") was correct in its day and is now the
    // reason the owner placed a real order, received no confirmation, and
    // found nothing on the timeline, nothing in the logs and nothing on screen
    // to tell him why. Not sending is still the right behaviour; saying
    // nothing about it is not.
    //
    // The skip now carries its reason, so `summarizeNotifyOutcomes` can tell
    // this — a fault — apart from a Leafly order, which is a contractual
    // requirement and must stay quiet. See email-readiness-core.ts.
    return summarizeNotifyOutcomes(n.orderNumber, [
      { audience: "customer", status: "skipped", skipReason: "provider_unconfigured" },
      { audience: "staff", status: "skipped", skipReason: "provider_unconfigured" },
    ]);
  }

  const total = formatCurrency(n.totalMinorUnits);
  const itemWord = n.itemCount === 1 ? "item" : "items";

  const tasks: Promise<EmailSendOutcome>[] = [];

  // Customer confirmation.
  //
  // `customerAllowed` is checked BEFORE the address, so a Leafly order is
  // recorded as a deliberate suppression rather than looking like an order that
  // merely happened to have no email on file. The two are very different when
  // someone is later asking why no confirmation went out.
  if (!customerAllowed) {
    console.log(
      `[orders/notify] ${n.orderNumber}: customer email SUPPRESSED — origin "${origin}". ` +
        `Leafly is the sole originator of consumer order communications for orders placed ` +
        `on its platform, so sending our own confirmation would breach the integration.`,
    );
    tasks.push(
      Promise.resolve<EmailSendOutcome>({
        audience: "customer",
        status: "skipped",
        // CORRECT BEHAVIOUR, NOT A FAULT. This one must never raise a warning:
        // a warning on every Leafly order teaches staff to ignore warnings.
        skipReason: "marketplace_origin",
      }),
    );
  } else if (n.customerEmail) {
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
    // No address on file. Normal — not every order has one.
    tasks.push(
      Promise.resolve<EmailSendOutcome>({
        audience: "customer",
        status: "skipped",
        skipReason: "no_customer_address",
      }),
    );
  }

  // Staff alert
  const staffEmails = parseStaffEmailList(process.env.ORDER_STAFF_EMAILS);
  // Staff alert. Note the ASYMMETRY with the customer branch above, which is
  // the whole point of having two separate predicates: Leafly's restriction is
  // about the CONSUMER relationship, so telling our own team that a Leafly
  // order just arrived is not only permitted, it is how the shop finds out.
  if (staffAllowed && staffEmails.length) {
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
    // Two different situations, and they are not the same thing: policy says
    // this audience may not be emailed (correct), versus nobody configured an
    // address to email (a fault — an order arrives and the shop never hears).
    tasks.push(
      Promise.resolve<EmailSendOutcome>({
        audience: "staff",
        status: "skipped",
        skipReason: !staffAllowed ? "not_permitted" : "no_staff_addresses",
      }),
    );
  }

  const outcomes = await Promise.all(tasks); // sendEmail never rejects
  return summarizeNotifyOutcomes(n.orderNumber, outcomes);
}
