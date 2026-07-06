/**
 * POST /api/webhooks/sendgrid  (Slice 50)
 *
 * Receives SendGrid Event Webhook batches (processed, delivered, open, click,
 * bounce, blocked, dropped, deferred, spamreport, unsubscribe) and stores them
 * in newsletter_email_events for the newsletter statistics suite. SendGrid is a
 * first-class second provider alongside Resend — both feed the same normalized
 * table, so the stats work with either.
 *
 * Security (S-9, fail closed): verifies the Signed Event Webhook ECDSA
 * signature using SENDGRID_WEBHOOK_PUBLIC_KEY (the account's verification
 * public key, base64 DER or PEM). Bad/missing signatures are rejected (401).
 * In PRODUCTION an unset key makes the endpoint refuse with 503 — it never
 * silently accepts unsigned traffic. In development only, an unset key skips
 * verification with a warning so local testing works.
 *
 * Idempotent: dedup on sg_event_id.
 */
import { NextResponse } from "next/server";
import { verifySendgridSignature } from "@/lib/cms/email-events/verify-core";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { mapSendgridBatch } from "@/lib/cms/email-events/normalize-core";
import { ingestEmailEvents } from "@/lib/cms/email-events/ingest-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNATURE_HEADER = "x-twilio-email-event-webhook-signature";
const TIMESTAMP_HEADER = "x-twilio-email-event-webhook-timestamp";

export async function POST(request: Request) {
  const rawBody = await request.text();

  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY ?? "";

  // S-9: fail CLOSED in production — never accept unsigned traffic.
  if (shouldRefuseWhenSecretMissing(publicKey)) {
    return NextResponse.json(
      { ok: false, error: "webhook key not configured (set SENDGRID_WEBHOOK_PUBLIC_KEY)" },
      { status: 503 },
    );
  }

  if (publicKey) {
    const ok = verifySendgridSignature({ rawBody, signature, timestamp, publicKey });
    if (!ok) {
      return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
    }
  } else {
     
    console.warn("[sendgrid webhook] SENDGRID_WEBHOOK_PUBLIC_KEY not set — skipping signature check.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const events = mapSendgridBatch(parsed);
  const result = await ingestEmailEvents(events);
  return NextResponse.json({ ok: true, received: events.length, ...result }, { status: 200 });
}
