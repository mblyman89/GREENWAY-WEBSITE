/**
 * POST /api/webhooks/inbound-email  (Slice 99)
 *
 * Single, provider-agnostic endpoint for the inbound vendor_intake@ mailbox
 * (a Google Workspace/Gmail address). The provider that forwards mail to us is
 * chosen with the env var `INBOUND_EMAIL_PROVIDER`:
 *
 *   INBOUND_EMAIL_PROVIDER=resend    (default) — Resend Inbound posts JSON,
 *       Svix-signed. We verify with RESEND_INBOUND_SECRET (falls back to
 *       RESEND_WEBHOOK_SECRET) using the same Svix HMAC as our event webhook.
 *
 *   INBOUND_EMAIL_PROVIDER=sendgrid  — SendGrid Inbound Parse posts
 *       multipart/form-data (from,to,subject,text,html,attachmentN files).
 *       Inbound Parse does NOT sign requests, so we authenticate with a shared
 *       secret you put in the webhook URL query (?token=...) matched against
 *       SENDGRID_INBOUND_TOKEN. This is the "easy way to plug it in" once your
 *       SendGrid credentials arrive: set the two envs and point the Parse MX +
 *       webhook URL here. No code change required.
 *
 * SECURITY (S-9, fail closed): if the relevant secret/token is configured, a
 * bad/missing signature or token is rejected 401. In PRODUCTION an unset
 * secret/token makes the endpoint refuse with 503 — it never silently accepts
 * unauthenticated mail. In development only, an unset secret skips the check
 * with a warning so local testing works.
 *
 * DRAFTS-ONLY (standing rule): every arrival is logged to inbound_email_log;
 * any attachment that parses as a vendor manifest (JSON transfer or CCRS CSV) is
 * staged as a PENDING draft in /admin/inventory/intake for a human to validate.
 * Nothing here activates stock or files anything with CCRS. Always returns 200
 * on accepted payloads so the provider does not retry-storm.
 */
import { NextResponse } from "next/server";
import { verifyResendSignature } from "@/lib/cms/email-events/verify-core";
import { shouldRefuseWhenSecretMissing } from "@/lib/security/fail-closed";
import { timingSafeEqualStr } from "@/lib/security/constant-time";
import {
  normalizeInboundEmail,
  type InboundProvider,
  type NormalizedInboundEmail,
} from "@/lib/inbound-email/inbound-normalize-core";
import {
  claimInboundDelivery,
  releaseInboundDelivery,
} from "@/lib/inbound-email/inbound-store";
import { routeAndStage } from "@/lib/inbound-email/inbound-ingest";
import { extractEmailIdFromWebhook } from "@/lib/inbound-email/resend-receiving-core";
import { claimResponse, deliveryKey } from "@/lib/inventory/inbound-dedupe-core";
import { enrichResendInbound } from "@/lib/inbound-email/resend-receiving-fetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// R36 #2: staging fetches attachments and may run LlamaParse, which can take
// minutes. Give the function the same 300 s the intake pages have, so a slow
// run is not killed half-way (a killed run is what left a broken twin row).
// Duplicate deliveries are stopped by the delivery claim below, not by speed.
export const maxDuration = 300;

function resolveProvider(): InboundProvider {
  const raw = (process.env.INBOUND_EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
  return raw === "sendgrid" ? "sendgrid" : "resend";
}

export async function POST(request: Request) {
  const provider = resolveProvider();
  return provider === "sendgrid"
    ? handleSendgrid(request)
    : handleResend(request);
}

// ── Resend Inbound (JSON, Svix-signed) ──────────────────────────────────────
async function handleResend(request: Request) {
  const rawBody = await request.text();

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  const secret =
    process.env.RESEND_INBOUND_SECRET ?? process.env.RESEND_WEBHOOK_SECRET ?? "";

  // S-9: fail CLOSED in production — never accept unsigned inbound mail.
  if (shouldRefuseWhenSecretMissing(secret)) {
    return NextResponse.json(
      { ok: false, error: "inbound secret not configured (set RESEND_INBOUND_SECRET)" },
      { status: 503 },
    );
  }

  let signatureOk: boolean | null = null;
  if (secret) {
    signatureOk = verifyResendSignature({
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      secret,
    });
    if (!signatureOk) {
      return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 401 });
    }
  } else {
    console.warn("[inbound-email] RESEND_INBOUND_SECRET not set — skipping signature check.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const raw =
    parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

  // Resend's inbound webhook is METADATA ONLY — no body, no attachment bytes
  // (docs/webhooks/emails/received). The old normalizer assumed inline base64
  // `content`, so real inbound mail (incl. Gmail-forwarded vendor emails) staged
  // 0 attachments. For the received event we now fetch the real content
  // out-of-band via the receiving API (RESEND_API_KEY): the email body (to pull
  // the WCIA Transfer Data Link) + each attachment's signed download_url. Other
  // event shapes (or when the API key is unset) fall back to metadata-only.
  const type = typeof raw.type === "string" ? raw.type.toLowerCase() : "";
  const isReceived = type.includes("received") || type.includes("inbound");

  if (isReceived) {
    // R36 #2 - idempotency claim BEFORE any slow work. Svix retries a
    // delivery that is not answered in time and keeps the same message id;
    // the Resend email_id is the same on every retry and on a dashboard
    // replay. Exactly one request may process this email.
    const key = deliveryKey({ emailId: extractEmailIdFromWebhook(raw), svixId });
    const claim = await claimInboundDelivery({ provider: "resend", key });
    if (claim.kind === "duplicate") {
      const res = claimResponse(claim.decision);
      return NextResponse.json(res.body, { status: res.status });
    }
    const logId = claim.kind === "claimed" ? claim.logId : null;
    try {
      const enriched = await enrichResendInbound(raw);
      return await finish(enriched.email, signatureOk, enriched.fetchNote, logId);
    } catch (err) {
      // Give the claim back so the provider's retry can take over at once.
      if (logId) await releaseInboundDelivery(logId);
      throw err;
    }
  }

  // Non-received Resend payloads (or a bare data object): metadata-only path.
  const email = normalizeInboundEmail("resend", raw);
  return finish(email, signatureOk);
}

// ── SendGrid Inbound Parse (multipart/form-data, token-authenticated) ────────
async function handleSendgrid(request: Request) {
  // Shared-secret token in the URL query (Inbound Parse cannot sign requests).
  const token = process.env.SENDGRID_INBOUND_TOKEN ?? "";

  // S-9: fail CLOSED in production — never accept unauthenticated inbound mail.
  if (shouldRefuseWhenSecretMissing(token)) {
    return NextResponse.json(
      { ok: false, error: "inbound token not configured (set SENDGRID_INBOUND_TOKEN)" },
      { status: 503 },
    );
  }

  let signatureOk: boolean | null = null;
  if (token) {
    const url = new URL(request.url);
    const provided = url.searchParams.get("token") ?? request.headers.get("x-inbound-token");
    // GW-022: constant-time compare so response timing can't leak token prefixes.
    signatureOk = timingSafeEqualStr(provided, token);
    if (!signatureOk) {
      return NextResponse.json({ ok: false, error: "invalid token" }, { status: 401 });
    }
  } else {
    console.warn("[inbound-email] SENDGRID_INBOUND_TOKEN not set — skipping token check.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid form" }, { status: 400 });
  }

  // Extract the standard Inbound Parse fields + file parts into a plain object
  // so the pure normalizer can consume it. File parts are attachment1..N.
  const attachments: Array<{ filename: string | null; type: string | null; content: string; text?: string }> = [];
  for (const [key, value] of form.entries()) {
    if (!/^attachment\d+$/.test(key)) continue;
    if (typeof value === "string") continue;
    const file = value as File;
    const buf = Buffer.from(await file.arrayBuffer());
    const type = file.type || null;
    const isTextual =
      /json|text|csv|xml/i.test(type ?? "") || /\.(json|csv|txt|xml)$/i.test(file.name ?? "");
    attachments.push({
      filename: file.name || null,
      type,
      content: buf.toString("base64"),
      text: isTextual ? buf.toString("utf8") : undefined,
    });
  }

  const raw: Record<string, unknown> = {
    from: form.get("from"),
    to: form.get("to"),
    subject: form.get("subject"),
    text: form.get("text"),
    html: form.get("html"),
    attachments,
  };

  const email = normalizeInboundEmail("sendgrid", raw);
  return finish(email, signatureOk);
}

// ── Shared: route + stage + log ─────────────────────────────────────────────
// Fix Phase 3.2a (G-17): the routing / staging / logging moved to
// src/lib/inbound-email/inbound-ingest.ts (routeAndStage) so the mailbox
// check, Try again and Find an email run the very same steps.
async function finish(
  email: NormalizedInboundEmail | null,
  signatureOk: boolean | null,
  fetchNote?: string,
  /** R36 #2: the delivery-claim row to complete (null = no claim taken). */
  logId: string | null = null,
) {
  const out = await routeAndStage(email, signatureOk, fetchNote, logId, "webhook");
  return NextResponse.json(out.body, { status: 200 });
}
