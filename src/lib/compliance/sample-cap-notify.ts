/**
 * src/lib/compliance/sample-cap-notify.ts
 *
 * Server helper that emails a processor when we had to refuse a sample delivery
 * that would exceed the WAC 314-55-096 quarterly incoming cap (Slice B block).
 * Mirrors src/lib/purchasing/po-notify.ts: env-gated + best-effort via the
 * Resend REST API (no SDK). Silent no-op when unconfigured.
 *
 * Owner-approved routing: TO the vendor's email; a COPY to ORDER_STAFF_EMAILS
 * so there is an internal record. If the vendor has no email on file, only the
 * internal copy is sent (and we report that back to the caller).
 *
 * Env reused from the orders / PO notifier:
 *   RESEND_API_KEY     — Resend API key
 *   ORDER_EMAIL_FROM   — verified "from" address
 *   ORDER_STAFF_EMAILS — comma-separated internal recipients (the copy)
 */
import "server-only";
import {
  buildSampleCapNotice,
  type SampleCapNoticeInput,
} from "@/lib/compliance/sample-cap-notice-core";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

async function postEmail(args: {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
}): Promise<boolean> {
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        subject: args.subject,
        html: args.html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function staffEmails(): string[] {
  return (process.env.ORDER_STAFF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export type SampleCapNotifyResult = {
  /** true when the notice was emailed to the vendor. */
  sentToVendor: boolean;
  /** true when the internal copy was emailed to staff. */
  sentToStaff: boolean;
  /** true when RESEND_API_KEY + ORDER_EMAIL_FROM are configured. */
  configured: boolean;
  /** true when we had no vendor email address to send to. */
  missingVendorEmail: boolean;
};

/**
 * Send the sample-cap notice to the processor (and an internal staff copy).
 * Best-effort — returns what happened so the caller can surface it. Never
 * throws.
 */
export async function sendSampleCapVendorNotice(args: {
  vendorEmail: string | null;
  notice: SampleCapNoticeInput;
}): Promise<SampleCapNotifyResult> {
  const apiKey = process.env.RESEND_API_KEY ?? "";
  const from = process.env.ORDER_EMAIL_FROM ?? "";
  const configured = Boolean(apiKey && from);

  const vendorEmail = (args.vendorEmail ?? "").trim() || null;
  const result: SampleCapNotifyResult = {
    sentToVendor: false,
    sentToStaff: false,
    configured,
    missingVendorEmail: !vendorEmail,
  };
  if (!configured) return result;

  const built = buildSampleCapNotice(args.notice);

  if (vendorEmail) {
    result.sentToVendor = await postEmail({
      apiKey,
      from,
      to: [vendorEmail],
      subject: built.subject,
      html: built.html,
    });
  }

  const staff = staffEmails();
  if (staff.length > 0) {
    // Internal copy: prefix the subject so staff can tell it apart from the
    // vendor-facing message, and note whether the vendor was reachable.
    const internalSubject = `[internal] ${built.subject}${
      vendorEmail ? "" : " — NO VENDOR EMAIL ON FILE"
    }`;
    const internalHtml = `
      <div style="font-family:system-ui,Arial,sans-serif;color:#111">
        <p style="color:#555;font-size:13px">
          Internal record of a sample-cap refusal notice.${
            vendorEmail
              ? ` Sent to the vendor at ${vendorEmail}.`
              : " The vendor has no email on file — this copy was NOT delivered to the vendor."
          }
        </p>
        ${built.html}
      </div>`;
    result.sentToStaff = await postEmail({
      apiKey,
      from,
      to: staff,
      subject: internalSubject,
      html: internalHtml,
    });
  }

  return result;
}
