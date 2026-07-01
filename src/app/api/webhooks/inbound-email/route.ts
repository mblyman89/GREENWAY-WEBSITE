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
 * SECURITY: if the relevant secret/token is configured, a bad/missing signature
 * or token is rejected 401. If it is NOT set, we skip the check with a warning
 * so the endpoint can be wired first — but ALWAYS set it in production.
 *
 * DRAFTS-ONLY (standing rule): every arrival is logged to inbound_email_log;
 * any attachment that parses as a vendor manifest (JSON transfer or CCRS CSV) is
 * staged as a PENDING draft in /admin/inventory/intake for a human to validate.
 * Nothing here activates stock or files anything with CCRS. Always returns 200
 * on accepted payloads so the provider does not retry-storm.
 */
import { NextResponse } from "next/server";
import { verifyResendSignature } from "@/lib/cms/email-events/verify-core";
import {
  normalizeInboundEmail,
  isForIntakeMailbox,
  type InboundProvider,
  type NormalizedInboundEmail,
} from "@/lib/inbound-email/inbound-normalize-core";
import {
  logInboundEmail,
  stageManifestsFromEmail,
  type InboundDisposition,
} from "@/lib/inbound-email/inbound-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resolveProvider(): InboundProvider {
  const raw = (process.env.INBOUND_EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
  return raw === "sendgrid" ? "sendgrid" : "resend";
}

function intakeMailbox(): string {
  return (process.env.VENDOR_INTAKE_MAILBOX ?? "vendor_intake").trim();
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
  const email = normalizeInboundEmail("resend", raw);
  return finish(email, signatureOk);
}

// ── SendGrid Inbound Parse (multipart/form-data, token-authenticated) ────────
async function handleSendgrid(request: Request) {
  // Shared-secret token in the URL query (Inbound Parse cannot sign requests).
  const token = process.env.SENDGRID_INBOUND_TOKEN ?? "";
  let signatureOk: boolean | null = null;
  if (token) {
    const url = new URL(request.url);
    const provided = url.searchParams.get("token") ?? request.headers.get("x-inbound-token");
    signatureOk = provided === token;
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
async function finish(email: NormalizedInboundEmail | null, signatureOk: boolean | null) {
  if (!email) {
    return NextResponse.json({ ok: true, ignored: "not-an-email" }, { status: 200 });
  }

  const toIntake = isForIntakeMailbox(email, intakeMailbox());
  if (!toIntake) {
    await logInboundEmail({
      email,
      signatureOk,
      toIntake: false,
      disposition: "ignored",
      manifestId: null,
      note: "not addressed to the intake mailbox",
    });
    return NextResponse.json({ ok: true, ignored: "not-intake-mailbox" }, { status: 200 });
  }

  // Stage any manifest attachments as DRAFTS (webhook has no signed-in user).
  const staged = await stageManifestsFromEmail(email, null);

  let disposition: InboundDisposition;
  if (staged.staged > 0) disposition = "staged";
  else if (staged.parseFailures > 0) disposition = "parse_failed";
  else disposition = "no_manifest";

  await logInboundEmail({
    email,
    signatureOk,
    toIntake: true,
    disposition,
    manifestId: staged.manifestIds[0] ?? null,
    note:
      staged.staged > 0
        ? `staged ${staged.staged} draft manifest(s)`
        : staged.parseFailures > 0
          ? `${staged.parseFailures} attachment(s) failed to parse`
          : "no manifest attachment found",
  });

  return NextResponse.json(
    { ok: true, staged: staged.staged, manifestIds: staged.manifestIds },
    { status: 200 },
  );
}
