import "server-only";

/**
 * src/lib/leafly/staff-alert-server.ts
 *
 * STANDING OFFER 2 (round L-24) — the I/O half of the last-resort staff alert.
 * All judgement lives in `staff-alert-core.ts`; this file only gathers the
 * facts and, if the core says so, sends one email.
 *
 *
 * WHY THIS EXISTS AT ALL, GIVEN THE OWNER SAID HE DOES NOT WANT EMAILS
 * --------------------------------------------------------------------
 * Verbatim: "I don't need an email sent to us, the back office dashboard,
 * printer and speaker let us know an order has been placed."
 *
 * Correct, and this does not send that email. The core stays silent whenever
 * the bell rang and the paper printed — the overwhelmingly common case. It
 * speaks only when those exact channels have ALREADY FAILED, which is the one
 * situation his sentence does not cover: if the speaker was silent and the
 * printer produced nothing, then the three signals he relies on did not
 * happen, nobody knows an order exists, and Leafly's fifteen-minute
 * auto-cancel clock is running on a real customer's order. Email is then the
 * only channel left. It is rare by construction, and that rarity is the whole
 * point — a mailbox full of alerts nobody needs is a mailbox nobody reads.
 *
 *
 * WHY EMAILING STAFF IS PERMITTED WHEN EMAILING THE SHOPPER IS NOT
 * ----------------------------------------------------------------
 * Leafly's Order API spec restricts CONSUMER communications only: "Leafly will
 * be the sole originator of automated consumer facing communications related
 * to orders placed on the Leafly platform." Telling our own team that an order
 * arrived is not a consumer communication — and Leafly's own Help Center
 * article on enabling order email notifications is explicitly about employee
 * recipients. `mayEmailStaffForOrigin` already encodes this asymmetry.
 *
 * That permission is re-asserted here rather than assumed: every recipient is
 * filtered through `permittedStaffRecipients`, which refuses the shopper's
 * address. A staff alert that ever reached the shopper would be a contract
 * breach, so it is made structurally impossible instead of merely unlikely.
 *
 *
 * NEVER THROWS
 * ------------
 * The only caller is the Leafly webhook. A throw there would become a non-200,
 * Leafly would retry, and a retry can end with a real customer's order
 * auto-cancelled. No alert is worth that, so every failure — including a
 * malformed deadline or a dead Resend — comes back as a string.
 */

import { parseStaffEmailList } from "@/lib/orders/notify";
import { sendStaffAlertEmail } from "@/lib/orders/staff-alert-email";
import {
  decideStaffAlert,
  minutesUntilDeadline,
  permittedStaffRecipients,
  STAFF_ALERT_REASON_TEXT,
  type StaffAlertStage,
} from "./staff-alert-core";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type StaffAlertSendInput = {
  leaflyOrderId: string;
  stage: StaffAlertStage;
  announced: boolean;
  printed: boolean;
  bridgedToRegister: boolean;
  collectionFailed: boolean;
  acknowledgeBy: string | null;
  /** Injected so the contract guard is exercised with a real address. */
  customerEmail?: string | null;
};

/**
 * Decide, and send if warranted. Returns a note for the webhook log, or null
 * when there is genuinely nothing to report (the healthy case).
 */
export async function maybeSendLeaflyStaffAlert(
  input: StaffAlertSendInput,
): Promise<string | null> {
  try {
    const apiKey = process.env.RESEND_API_KEY ?? "";
    const from = process.env.ORDER_EMAIL_FROM ?? "";
    const configured = apiKey !== "" && from !== "";

    // Recipients are resolved BEFORE the decision, so "warranted but nobody to
    // tell" is reported as such rather than looking like a healthy order.
    const recipients = permittedStaffRecipients(
      parseStaffEmailList(process.env.ORDER_STAFF_EMAILS),
      input.customerEmail ?? null,
    );

    const decision = decideStaffAlert({
      leaflyOrderId: input.leaflyOrderId,
      stage: input.stage,
      announced: input.announced,
      printed: input.printed,
      bridgedToRegister: input.bridgedToRegister,
      collectionFailed: input.collectionFailed,
      minutesUntilDeadline: minutesUntilDeadline(input.acknowledgeBy, Date.now()),
      hasStaffRecipients: recipients.length > 0,
      providerConfigured: configured,
    });

    // Healthy: the owner's instruction. Say nothing, log nothing.
    if (!decision.send) {
      return decision.quietBecauseHealthy ? null : decision.summary;
    }

    const lines = decision.reasons.map((r) => STAFF_ALERT_REASON_TEXT[r]);
    const html = [
      `<p><strong>A Leafly order arrived and the shop may not know.</strong></p>`,
      `<p>Order <code>${escapeHtml(input.leaflyOrderId)}</code></p>`,
      `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`,
      `<p>Leafly auto-cancels orders that are not acknowledged within fifteen ` +
        `minutes. Open the Leafly order board and acknowledge it.</p>`,
      `<p style="color:#666;font-size:12px">You are receiving this only because ` +
        `the speaker and printer did not do their job. Working orders never ` +
        `generate this email.</p>`,
    ].join("");

    // The network call lives in `@/lib/orders/staff-alert-email` — see that
    // file's header for why it is not in this directory and why it is
    // time-bounded even though Resend is not Leafly.
    const sent = await sendStaffAlertEmail({
      apiKey,
      from,
      to: recipients,
      subject: decision.subject,
      html,
    });

    if (!sent.ok) {
      return `staff alert FAILED to send: ${sent.detail}`;
    }
    return `staff alert sent to ${sent.recipients} recipient(s): ${decision.summary}`;
  } catch (err) {
    return `staff alert error: ${err instanceof Error ? err.message : "unknown"}`;
  }
}
