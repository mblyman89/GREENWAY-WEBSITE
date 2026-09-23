import "server-only";

/**
 * src/lib/orders/staff-alert-email.ts
 *
 * The one network call behind the Leafly last-resort staff alert.
 *
 *
 * WHY THIS LIVES IN `orders/` AND NOT IN `leafly/`
 * ------------------------------------------------
 * It was originally written inside `src/lib/leafly/staff-alert-server.ts`, and
 * `tests/compliance/leafly-deadline.test.ts` rejected it:
 *
 *   expected [ "staff-alert-server.ts:149: const res = await fetch(...)" ]
 *   to deeply equal []
 *
 * That test enforces "ZERO raw fetch() calls outside the deadline helper"
 * across the whole Leafly library, and it was right to fire. But the fix is
 * NOT to route this through `leaflyFetchWithDeadline`: that helper's budgets
 * are indexed by `LeaflyOperation`, and every one of them describes a call TO
 * LEAFLY. This is a call to Resend. Forcing it through would have meant
 * inventing a fake Leafly operation, which would corrupt the timeout table
 * that the same test file exists to protect — trading a real boundary for a
 * green check.
 *
 * So the call moves to where it belongs. The Leafly library keeps its
 * invariant honestly (no network call there that is not a bounded Leafly
 * call), and the email boundary sits next to `notify.ts`, which is already the
 * home of Resend in this codebase.
 *
 *
 * WHY IT IS BOUNDED ANYWAY
 * ------------------------
 * The sole caller is the Leafly order webhook, and it AWAITS this. That is
 * deliberate — a serverless function that has already returned may be frozen
 * before background work runs, so an unawaited alert is an alert that may
 * never send. But awaiting an unbounded request inside a webhook is how a
 * hung third party turns into a hung handler, and a hung handler on this
 * particular path means Leafly retries, which can end with a real customer's
 * order auto-cancelled.
 *
 * `notify.ts` uses a bare `fetch` for the same provider and has not been
 * changed here: it runs on the website checkout path, where nothing is
 * counting down. This path is different, so it carries its own timer.
 *
 * The budget is small on purpose. This email exists because the speaker and
 * printer already failed and a fifteen-minute clock is running; spending
 * thirty seconds waiting on a mail API would be spending the very thing the
 * alert is trying to save.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Milliseconds allowed for the Resend call.
 *
 * Eight seconds: comfortably more than a healthy API round trip, and a small
 * enough fraction of Leafly's fifteen-minute acknowledgement window that a
 * dead mail provider cannot meaningfully eat into it. Named, not inlined, so
 * the reasoning is reviewable and the test can assert the real value.
 */
export const STAFF_ALERT_TIMEOUT_MS = 8_000;

export type StaffAlertEmailResult =
  | { ok: true; recipients: number }
  | { ok: false; detail: string; didTimeout: boolean };

/**
 * Send one staff alert. NEVER THROWS — every failure, including our own
 * timeout, comes back as a value, because the caller is a webhook whose
 * non-200 would trigger a Leafly retry.
 */
export async function sendStaffAlertEmail(params: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
}): Promise<StaffAlertEmailResult> {
  if (params.to.length === 0) {
    return { ok: false, detail: "no permitted recipients", didTimeout: false };
  }

  const controller = new AbortController();
  // Set before we abort and read after the throw, so the timeout is reported
  // as a FACT rather than inferred by sniffing the error message for the word
  // "abort" — the same reasoning deadline-fetch.ts documents.
  let weAborted = false;
  const timer = setTimeout(() => {
    weAborted = true;
    controller.abort();
  }, STAFF_ALERT_TIMEOUT_MS);

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
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        detail: `provider returned ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        didTimeout: false,
      };
    }
    return { ok: true, recipients: params.to.length };
  } catch (err) {
    if (weAborted) {
      return {
        ok: false,
        detail: `timed out after ${STAFF_ALERT_TIMEOUT_MS}ms`,
        didTimeout: true,
      };
    }
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "send failed",
      didTimeout: false,
    };
  } finally {
    // Unconditional. A stray timer on a serverless function keeps the lambda
    // warm for nothing and can abort a controller a later path still holds.
    clearTimeout(timer);
  }
}
