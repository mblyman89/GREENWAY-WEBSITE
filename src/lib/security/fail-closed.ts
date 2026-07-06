/**
 * src/lib/security/fail-closed.ts  (S-9)
 *
 * Shared "fail CLOSED in production" posture for the unauthenticated HTTP
 * surfaces (webhooks + the CloudPRNT printer endpoint).
 *
 * Historically these endpoints skipped their signature/token checks with a
 * console.warn when the relevant secret was unset, so the owner could wire the
 * endpoint first and add the secret second. That is a set-and-forget risk: in
 * production an unset secret silently accepts ANY caller (and CloudPRNT
 * receipt bodies contain customer name/phone).
 *
 * New posture:
 *   - In PRODUCTION (NODE_ENV === "production"), a missing secret makes the
 *     endpoint refuse with 503 + a clear message naming the env var to set.
 *   - In development, the old warn-and-continue behavior remains so local
 *     testing works without secrets.
 *
 * `missingWebhookSecrets()` powers the admin-dashboard banner so a missing
 * secret is loudly visible instead of a silent hole.
 */

/** True when this process runs with production semantics. */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Should an endpoint refuse service because its secret is unset?
 * (Missing secret + production ⇒ refuse. Dev keeps warn-and-continue.)
 */
export function shouldRefuseWhenSecretMissing(secret: string | null | undefined): boolean {
  return !secret && isProductionRuntime();
}

export type MissingSecret = {
  /** Human name of the surface, e.g. "Resend events webhook". */
  surface: string;
  /** The env var(s) to set, e.g. "RESEND_WEBHOOK_SECRET". */
  envVar: string;
};

/**
 * Which webhook-verification secrets are currently unset. Only surfaces whose
 * endpoints exist unconditionally are listed; CloudPRNT's poll token lives in
 * the DB (printer settings), so it is checked separately by the caller.
 */
export function missingWebhookSecrets(): MissingSecret[] {
  const missing: MissingSecret[] = [];
  if (!process.env.RESEND_WEBHOOK_SECRET) {
    missing.push({ surface: "Resend events webhook", envVar: "RESEND_WEBHOOK_SECRET" });
  }
  // SendGrid events webhook is only a live surface if SendGrid is in use.
  if (process.env.SENDGRID_API_KEY && !process.env.SENDGRID_WEBHOOK_PUBLIC_KEY) {
    missing.push({ surface: "SendGrid events webhook", envVar: "SENDGRID_WEBHOOK_PUBLIC_KEY" });
  }
  const provider = (process.env.INBOUND_EMAIL_PROVIDER ?? "resend").trim().toLowerCase();
  if (provider === "sendgrid") {
    if (!process.env.SENDGRID_INBOUND_TOKEN) {
      missing.push({ surface: "Inbound email (SendGrid Parse)", envVar: "SENDGRID_INBOUND_TOKEN" });
    }
  } else if (!process.env.RESEND_INBOUND_SECRET && !process.env.RESEND_WEBHOOK_SECRET) {
    missing.push({
      surface: "Inbound email (Resend)",
      envVar: "RESEND_INBOUND_SECRET (or RESEND_WEBHOOK_SECRET)",
    });
  }
  return missing;
}
