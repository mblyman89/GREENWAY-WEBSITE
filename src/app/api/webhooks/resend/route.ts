/**
 * POST /api/webhooks/resend  (Slice 50)
 *
 * Receives Resend email engagement events (delivered, opened, clicked,
 * bounced, complained, delivery_delayed, failed) and stores them in
 * newsletter_email_events for the newsletter statistics suite.
 *
 * Security (S-9, fail closed): verifies the Svix signature using
 * RESEND_WEBHOOK_SECRET. A bad/missing signature is rejected (401). In
 * PRODUCTION an unset secret makes the endpoint refuse with 503 — it never
 * silently accepts unsigned traffic. In development only, an unset secret
 * skips verification with a warning so local testing works.
 *
 * Idempotent: dedup on the Svix message id. Always returns 200 on accepted
 * payloads so Resend does not retry storms; returns 401 only on signature
 * failure.
 */
import { NextResponse } from "next/server";
import { verifyResendSignature } from "@/lib/cms/email-events/verify-core";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { mapResendEvent } from "@/lib/cms/email-events/normalize-core";
import { ingestEmailEvents } from "@/lib/cms/email-events/ingest-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";

  // S-9: fail CLOSED in production — never accept unsigned traffic.
  if (shouldRefuseWhenSecretMissing(secret)) {
    return NextResponse.json(
      { ok: false, error: "webhook secret not configured (set RESEND_WEBHOOK_SECRET)" },
      { status: 503 },
    );
  }

  if (secret) {
    const ok = verifyResendSignature({
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      secret,
    });
    if (!ok) {
      return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
    }
  } else {
     
    console.warn("[resend webhook] RESEND_WEBHOOK_SECRET not set — skipping signature check.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  // Resend posts a single event object per request (Svix). Be tolerant of
  // arrays too in case of batching.
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const events = items
    .map((item) =>
      item && typeof item === "object"
        ? mapResendEvent(item as Record<string, unknown>, svixId)
        : null,
    )
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const result = await ingestEmailEvents(events);
  return NextResponse.json({ ok: true, received: events.length, ...result }, { status: 200 });
}
