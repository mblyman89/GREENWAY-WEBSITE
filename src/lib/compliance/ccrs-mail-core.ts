/**
 * src/lib/compliance/ccrs-mail-core.ts  (CCRS Bible v2 slice S-18a). PURE.
 *
 * Reads the CCRS emails that land in the submitting mailbox
 * (michael@greenwaymarijuana.com, a Google Workspace mailbox: the domain's MX
 * is aspmx.l.google.com) and turns each into a fact the hub can show and the
 * owner can apply with one click. Nothing here writes the ledger; the hub's
 * Apply buttons call the same 0249 path as the paste boxes (standing rule 3:
 * machine output is drafts-only).
 *
 * WHAT THE EVIDENCE SAYS, AND HOW EACH FACT IS USED
 *
 *  1. CCRS sends confirmation AND error mail to the address that submitted
 *     the file: "it is the email that submits the file will get confirmation
 *     and error messages" [EXAM L0098].
 *  2. Success (observed 45 times: 10 + 28 + 7, PREprod 2026-09-17, 10-06, 10-07): from
 *     info@lcb.wa.gov, subject "PRE: CCRS Processing Successful", body
 *     "PRE The file <Type>_<lic>_<stamp>_<token>.csv you submitted has been
 *     processed. Date Submitted: <M/D/YYYY h:mm:ss AM|PM> ...". The name is
 *     read by the S-12c parser (parseSuccessEmails), token removed.
 *  3. PRODUCTION success mail has never been seen. Asked whether production
 *     mail is the same "minus the PRE prefix", the examiner answered "yes"
 *     [EXAM L0538] (U-20). No production email has been captured, so the
 *     exact subject is still U-65. A success without "PRE" is reported as
 *     production with envVerified=false (one portal check, then apply), and
 *     anything else is env=null: the owner chooses, nothing is guessed.
 *  4. Errors (observed 15 times) are a CSV ATTACHMENT, named
 *     `<Type>__<timestamp>.csv` (Strain uses ONE underscore), echoing rows
 *     with an `ErrorMessage` column whose position moves between types
 *     (Part 04 H). The owner remembers it the same way (2026-10-20). The
 *     SUBJECT and BODY of an error email were never captured (U-66), so an
 *     error is recognised by its attachment alone, never by its wording.
 *  5. Which uploaded file an error CSV answers is PROVEN, not guessed: every
 *     echo line must tie to exactly one row of that file (classifyEcho,
 *     S-12c). pickEchoFile tries every uploaded file of the type; exactly one
 *     must accept it, else the owner picks.
 *  6. The FAQ warns error mail may be filtered to spam [FAQ L0102], so the
 *     search includes Spam/Trash and the result says where it was found.
 *  7. lcb.wa.gov publishes DMARC p=none (DNS, 2026-10-20), so a forged From
 *     is delivered. The Authentication-Results header is recorded and shown;
 *     what a REAL CCRS mail's header says is not known (U-67), so it warns
 *     and never blocks. The human Apply step is the control.
 *
 * GMAIL API (developers.google.com, read 2026-10-20):
 *  - users.messages.list `q` "Supports the same query format as the Gmail
 *    search box"; dates in q are midnight PST unless given "in seconds", so
 *    the lookback is an epoch-seconds `after:`; includeSpamTrash param.
 *  - Scope gmail.readonly is enough for list, get and attachments.get.
 *  - Service account: JWT RS256, aud https://oauth2.googleapis.com/token,
 *    exp "a maximum of 1 hour after the issued time", `sub` = the mailbox
 *    (domain-wide delegation, granted by a super administrator in Admin
 *    console > Security > API controls > Domain-wide delegation).
 *  - Grant type urn:ietf:params:oauth:grant-type:jwt-bearer.
 *  - Quota (re-read 2026-10-20): messages.list 5 units; messages.get 20, but
 *    60 "when format is full, raw, or html" (we use full); attachments.get 20;
 *    6,000 units per minute per user per project. Worst tick: 5 list pages
 *    (25) + MAX_NEW_PER_TICK 25 x 60 (1,500) + 25 x MAX_CSV_PER_MESSAGE 5 x
 *    20 (2,500) = 4,025, under 6,000 even if the whole tick ran in one minute.
 */
import { parseSuccessEmails, type SuccessNotice } from "./ccrs-lifecycle-core";
import { notProcessedAdvice, parseNotProcessed } from "./ccrs-whole-file-core";
import { CCRS_KNOWN_MESSAGES, classifyEcho, CcrsEchoError, echoHeaderLooksRight, type EchoVerdict, type OurRow } from "./ccrs-outcome-core";
import { ccrsReaderSplit, type CcrsRetailerFileType } from "./ccrs-batch-core";
import type { LedgerEnv } from "./ccrs-ledger-core";

/* ------------------------------------------------------------------ *
 * Configuration (env vars). Two auth modes; nothing is half-configured.
 * ------------------------------------------------------------------ */
export const CCRS_SENDER = "info@lcb.wa.gov";
/** The submitting mailbox the owner named (2026-10-20). Override with CCRS_MAILBOX_ADDRESS. */
export const DEFAULT_CCRS_MAILBOX = "michael@greenwaymarijuana.com";
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const JWT_BEARER_GRANT = "urn:ietf:params:oauth:grant-type:jwt-bearer";
/** Default lookback for each poll; dedupe by Gmail id makes overlap harmless. */
export const DEFAULT_LOOKBACK_HOURS = 72;
export const MAX_LOOKBACK_HOURS = 24 * 30;
/** At most this many new messages are fetched per tick (the rest wait for the next tick). */
export const MAX_NEW_PER_TICK = 25;
/** An attachment larger than this is not downloaded (a 10,000-row echo is far smaller). */
export const MAX_ATTACHMENT_BYTES = 8_000_000;
/** CSVs downloaded per message. Every real error email carried one; more are named as skipped for a human. */
export const MAX_CSV_PER_MESSAGE = 5;

export type MailAuthMode = "service-account" | "oauth-refresh" | "workload-identity";
export const MAIL_AUTH_MODES: readonly MailAuthMode[] = ["service-account", "oauth-refresh", "workload-identity"];
/** R6-5: keyless sign-in. Vercel's OIDC token -> Workload Identity Federation -> the service account signs the DWD JWT (no key file). */
export type WorkloadIdentityConfig = { serviceAccountEmail: string; projectNumber: string; poolId: string; providerId: string };
export type MailConfig =
  | {
      configured: true;
      mode: MailAuthMode;
      mailbox: string;
      lookbackHours: number;
      serviceAccount?: { clientEmail: string; privateKey: string };
      oauth?: { clientId: string; clientSecret: string; refreshToken: string };
      workloadIdentity?: WorkloadIdentityConfig;
    }
  | { configured: false; mailbox: string; missing: string[]; problem: string | null };

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function mailConfigFromEnv(env: Readonly<Record<string, string | undefined>>): MailConfig {
  const v = (k: string) => (env[k] ?? "").trim();
  const mailbox = (v("CCRS_MAILBOX_ADDRESS") || DEFAULT_CCRS_MAILBOX).toLowerCase();
  if (!EMAIL_RE.test(mailbox)) return { configured: false, mailbox, missing: [], problem: "CCRS_MAILBOX_ADDRESS is not an email address." };
  const rawLb = v("CCRS_MAIL_LOOKBACK_HOURS");
  let lookbackHours = DEFAULT_LOOKBACK_HOURS;
  if (rawLb !== "") {
    const n = Number(rawLb);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LOOKBACK_HOURS) {
      return { configured: false, mailbox, missing: [], problem: `CCRS_MAIL_LOOKBACK_HOURS must be a whole number from 1 to ${MAX_LOOKBACK_HOURS}.` };
    }
    lookbackHours = n;
  }
  const sa = { clientEmail: v("GMAIL_SA_CLIENT_EMAIL"), privateKey: v("GMAIL_SA_PRIVATE_KEY").replace(/\\n/g, "\n") };
  const oa = { clientId: v("GMAIL_OAUTH_CLIENT_ID"), clientSecret: v("GMAIL_OAUTH_CLIENT_SECRET"), refreshToken: v("GMAIL_OAUTH_REFRESH_TOKEN") };
  const wi: WorkloadIdentityConfig = {
    serviceAccountEmail: v("GMAIL_WIF_SERVICE_ACCOUNT_EMAIL").toLowerCase(),
    projectNumber: v("GMAIL_WIF_PROJECT_NUMBER"),
    poolId: v("GMAIL_WIF_POOL_ID"),
    providerId: v("GMAIL_WIF_PROVIDER_ID"),
  };
  const saAny = !!(sa.clientEmail || sa.privateKey);
  const oaAny = !!(oa.clientId || oa.clientSecret || oa.refreshToken);
  const wiAny = !!(wi.serviceAccountEmail || wi.projectNumber || wi.poolId || wi.providerId);
  if ([saAny, oaAny, wiAny].filter(Boolean).length > 1) {
    const sets = [saAny && "service-account (GMAIL_SA_*)", oaAny && "OAuth (GMAIL_OAUTH_*)", wiAny && "keyless (GMAIL_WIF_*)"].filter(Boolean) as string[];
    const head = sets.length === 2 ? `Both the ${sets[0]} and the ${sets[1]}` : `The ${sets.join(", ")}`;
    return { configured: false, mailbox, missing: [], problem: `${head} variables are set. Keep one set only.` };
  }
  if (wiAny) {
    const missing = [
      !wi.serviceAccountEmail && "GMAIL_WIF_SERVICE_ACCOUNT_EMAIL",
      !wi.projectNumber && "GMAIL_WIF_PROJECT_NUMBER",
      !wi.poolId && "GMAIL_WIF_POOL_ID",
      !wi.providerId && "GMAIL_WIF_PROVIDER_ID",
    ].filter(Boolean) as string[];
    if (missing.length) return { configured: false, mailbox, missing, problem: null };
    const problem = workloadIdentityProblem(wi);
    if (problem) return { configured: false, mailbox, missing: [], problem };
    return { configured: true, mode: "workload-identity", mailbox, lookbackHours, workloadIdentity: wi };
  }
  if (saAny) {
    const missing = [!sa.clientEmail && "GMAIL_SA_CLIENT_EMAIL", !sa.privateKey && "GMAIL_SA_PRIVATE_KEY"].filter(Boolean) as string[];
    if (missing.length) return { configured: false, mailbox, missing, problem: null };
    if (!sa.privateKey.includes("-----BEGIN PRIVATE KEY-----")) {
      return { configured: false, mailbox, missing: [], problem: "GMAIL_SA_PRIVATE_KEY is not a PEM private key (it must start with -----BEGIN PRIVATE KEY-----)." };
    }
    return { configured: true, mode: "service-account", mailbox, lookbackHours, serviceAccount: sa };
  }
  if (oaAny) {
    const missing = [!oa.clientId && "GMAIL_OAUTH_CLIENT_ID", !oa.clientSecret && "GMAIL_OAUTH_CLIENT_SECRET", !oa.refreshToken && "GMAIL_OAUTH_REFRESH_TOKEN"].filter(
      Boolean,
    ) as string[];
    if (missing.length) return { configured: false, mailbox, missing, problem: null };
    return { configured: true, mode: "oauth-refresh", mailbox, lookbackHours, oauth: oa };
  }
  // Nothing set: name the recommended (keyless) way. New Google organisations block key files.
  return { configured: false, mailbox, missing: [...WIF_VARS], problem: null };
}

export const WIF_VARS = ["GMAIL_WIF_SERVICE_ACCOUNT_EMAIL", "GMAIL_WIF_PROJECT_NUMBER", "GMAIL_WIF_POOL_ID", "GMAIL_WIF_PROVIDER_ID"] as const;

/* ------------------------------------------------------------------ *
 * R6-5 keyless sign-in (Workload Identity Federation + domain-wide delegation).
 *
 * Why: Google's "secure by default" organisation policy
 * iam.disableServiceAccountKeyCreation blocks key files in new organisations,
 * so option A's GMAIL_SA_PRIVATE_KEY cannot be made. No key is needed:
 *
 *   1. Vercel gives each function run a short-lived OIDC token
 *      (iss https://oidc.vercel.com/<team>, aud https://vercel.com/<team>,
 *      sub owner:<team>:project:<project>:environment:<env>; vercel.com/docs/oidc/reference).
 *   2. Google STS swaps it for a federated token (sts.googleapis.com/v1/token,
 *      token-exchange grant, audience //iam.googleapis.com/<provider>, scope cloud-platform).
 *   3. With that token, IAM Credentials signJwt has the service account sign the
 *      SAME domain-wide-delegation claims option A signs locally
 *      (iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/<email>:signJwt;
 *      needs roles/iam.serviceAccountTokenCreator for the Vercel principal).
 *   4. The signed JWT goes to oauth2.googleapis.com/token (jwt-bearer) as before.
 * The same flow is what google-github-actions/auth does for access_token_subject.
 * ------------------------------------------------------------------ */
export const STS_TOKEN_URL = "https://sts.googleapis.com/v1/token";
export const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const WIF_ID_RE = /^[a-z0-9-]{4,32}$/;
const SA_EMAIL_RE = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

/** A human sentence when a WIF value is malformed, else null. Values are never echoed whole. */
export function workloadIdentityProblem(wi: WorkloadIdentityConfig): string | null {
  if (!SA_EMAIL_RE.test(wi.serviceAccountEmail)) {
    return "GMAIL_WIF_SERVICE_ACCOUNT_EMAIL must be the service account's email (it ends in .iam.gserviceaccount.com).";
  }
  if (!/^[0-9]{6,20}$/.test(wi.projectNumber)) {
    return "GMAIL_WIF_PROJECT_NUMBER must be the project NUMBER (digits only, from the Google Cloud dashboard), not the project ID or name.";
  }
  for (const [k, val] of [["GMAIL_WIF_POOL_ID", wi.poolId], ["GMAIL_WIF_PROVIDER_ID", wi.providerId]] as const) {
    // "4-32 characters, and may contain the characters [a-z0-9-]. The prefix gcp- is reserved" (IAM REST reference).
    if (!WIF_ID_RE.test(val) || val.startsWith("gcp-")) return `${k} must be the ID (4-32 lowercase letters, digits or hyphens), not the display name.`;
  }
  return null;
}

/** The STS audience: the provider's full resource name with the //iam.googleapis.com/ prefix. */
export function wifAudience(wi: WorkloadIdentityConfig): string {
  return `//iam.googleapis.com/projects/${wi.projectNumber}/locations/global/workloadIdentityPools/${wi.poolId}/providers/${wi.providerId}`;
}

/** Body of the STS token exchange (JSON). No Authorization header: the Vercel token IS the credential. */
export function stsExchangeBody(wi: WorkloadIdentityConfig, vercelOidcToken: string): Record<string, string> {
  return {
    audience: wifAudience(wi),
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    scope: CLOUD_PLATFORM_SCOPE,
    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    subjectToken: vercelOidcToken,
  };
}

/** The signJwt call: the DWD claims (sub = mailbox, gmail.readonly, 1 hour), signed by Google with the service account's Google-held key. */
export function signJwtRequest(wi: WorkloadIdentityConfig, mailbox: string, nowSec: number): { url: string; body: { payload: string } } {
  const { claims } = serviceAccountJwtParts({ clientEmail: wi.serviceAccountEmail, subject: mailbox, nowSec });
  return {
    url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(wi.serviceAccountEmail)}:signJwt`,
    body: { payload: JSON.stringify(claims) },
  };
}

/** The issuer, audience and subject a Vercel OIDC token carries (decoded, NOT verified: for error messages only). */
export function oidcTokenFacts(token: string): { iss: string | null; aud: string | null; sub: string | null } {
  try {
    const part = token.split(".")[1] ?? "";
    const o = JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
    const s = (x: unknown) => (typeof x === "string" ? x : Array.isArray(x) && typeof x[0] === "string" ? (x[0] as string) : null);
    return { iss: s(o.iss), aud: s(o.aud), sub: s(o.sub) };
  } catch {
    return { iss: null, aud: null, sub: null };
  }
}

/** First non-empty source, in @vercel/oidc 4.x order: request header, then VERCEL_OIDC_TOKEN_FILE, then VERCEL_OIDC_TOKEN. */
export function pickVercelOidcToken(sources: { header?: string | null; file?: string | null; env?: string | null }): string | null {
  for (const t of [sources.header, sources.file, sources.env]) {
    const v = (t ?? "").trim();
    if (v) return v;
  }
  return null;
}

/** Strict decode of the STS answer, with the most likely fix. */
export function decodeStsResponse(status: number, body: unknown, facts: { iss: string | null; aud: string | null; sub: string | null }): { ok: true; token: string } | { ok: false; error: string } {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status === 200 && typeof o.access_token === "string" && o.access_token !== "") return { ok: true, token: o.access_token };
  if (status === 200) return { ok: false, error: "Google STS answer has no access_token" };
  const err = typeof o.error === "string" ? o.error : `HTTP ${status}`;
  const desc = typeof o.error_description === "string" ? `: ${o.error_description}` : "";
  const seen = ` Vercel's token says issuer ${facts.iss ?? "?"}, audience ${facts.aud ?? "?"}, subject ${facts.sub ?? "?"}.`;
  // Order matters: invalid_target ("the audience PARAMETER does not exist") is OUR provider path, not Vercel's aud claim.
  const hint =
    err === "invalid_target" || /not found|does not exist|disabled/i.test(desc)
      ? " (check GMAIL_WIF_PROJECT_NUMBER, GMAIL_WIF_POOL_ID and GMAIL_WIF_PROVIDER_ID, and that the pool and provider are enabled)"
      : /audience/i.test(desc)
        ? ` (the provider's Allowed audience must be exactly ${facts.aud ?? "https://vercel.com/<team>"})`
        : /issuer|\biss\b/i.test(desc)
          ? ` (the provider's Issuer URL must be exactly ${facts.iss ?? "https://oidc.vercel.com/<team>"})`
          : "";
  return { ok: false, error: `Google STS refused Vercel's token: ${err}${desc}${hint}.${seen}` };
}

/** Strict decode of the signJwt answer, with the most likely fix. */
export function decodeSignJwtResponse(status: number, body: unknown, ctx: { serviceAccountEmail: string; principal: string | null }): { ok: true; signedJwt: string } | { ok: false; error: string } {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status === 200 && typeof o.signedJwt === "string" && o.signedJwt.split(".").length === 3) return { ok: true, signedJwt: o.signedJwt };
  if (status === 200) return { ok: false, error: "signJwt answer has no signedJwt" };
  const e = o.error && typeof o.error === "object" ? (o.error as { message?: unknown }) : null;
  const msg = typeof e?.message === "string" ? e.message : typeof o.error === "string" ? o.error : "";
  const hint =
    /has not been used|is disabled|SERVICE_DISABLED/i.test(msg)
      ? " (turn on the IAM Service Account Credentials API in the Google Cloud project)"
      : status === 403 || /signJwt|PERMISSION_DENIED/i.test(msg)
        ? ` (on service account ${ctx.serviceAccountEmail}, give ${ctx.principal ?? "the Vercel principal"} the role Service Account Token Creator)`
        : status === 404
          ? " (GMAIL_WIF_SERVICE_ACCOUNT_EMAIL does not name a service account in this project)"
          : "";
  return { ok: false, error: `Google signJwt failed: HTTP ${status}${msg ? `: ${msg}` : ""}${hint}` };
}

/** The principal to grant, built from the provider and the token's subject (shown in errors). */
export function wifPrincipal(wi: WorkloadIdentityConfig, subject: string | null): string | null {
  return subject ? `principal://iam.googleapis.com/projects/${wi.projectNumber}/locations/global/workloadIdentityPools/${wi.poolId}/subject/${subject}` : null;
}

/* ------------------------------------------------------------------ *
 * Service-account JWT (RFC 7519 / Google server-to-server guide).
 * The signer is injected so this stays pure and testable.
 * ------------------------------------------------------------------ */
export const b64url = (s: string | Uint8Array): string => Buffer.from(s).toString("base64url");

export function serviceAccountJwtParts(opts: { clientEmail: string; subject: string; nowSec: number }): { header: object; claims: Record<string, string | number>; signingInput: string } {
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: opts.clientEmail,
    sub: opts.subject,
    scope: GMAIL_READONLY_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: opts.nowSec,
    // "a maximum of 1 hour after the issued time"
    exp: opts.nowSec + 3600,
  };
  return { header, claims, signingInput: `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}` };
}

/** Strict decode of the token endpoint's answer. */
export function decodeTokenResponse(status: number, body: unknown): { ok: true; accessToken: string; expiresIn: number } | { ok: false; error: string } {
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (status !== 200) {
    const err = typeof o.error === "string" ? o.error : `HTTP ${status}`;
    const desc = typeof o.error_description === "string" ? `: ${o.error_description}` : "";
    const hint =
      err === "invalid_grant"
        ? " (OAuth: the refresh token was revoked, unused for 6 months, or the password changed; service account: domain-wide delegation is not granted for gmail.readonly, or the clock is off)"
        : err === "unauthorized_client"
          ? " (the client is not authorised for this scope: add gmail.readonly to its domain-wide delegation in the Admin console)"
          : "";
    return { ok: false, error: `${err}${desc}${hint}` };
  }
  if (typeof o.access_token !== "string" || o.access_token === "") return { ok: false, error: "token response has no access_token" };
  const exp = typeof o.expires_in === "number" && o.expires_in > 0 ? o.expires_in : 0;
  if (!exp) return { ok: false, error: "token response has no expires_in" };
  return { ok: true, accessToken: o.access_token, expiresIn: exp };
}

/** The Gmail search: only CCRS's sender, newer than the lookback, as epoch SECONDS (q dates are midnight PST otherwise). */
export function buildCcrsQuery(nowMs: number, lookbackHours: number): string {
  const after = Math.floor((nowMs - lookbackHours * 3_600_000) / 1000);
  return `from:${CCRS_SENDER} after:${after}`;
}

/* ------------------------------------------------------------------ *
 * Gmail message -> normalized mail.
 * ------------------------------------------------------------------ */
export type GmailHeader = { name?: string; value?: string };
export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { attachmentId?: string; size?: number; data?: string };
  parts?: GmailPart[];
};
export type GmailMessage = { id?: string; threadId?: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart; snippet?: string };

export type AttachmentRef = { filename: string; mimeType: string; size: number; attachmentId: string | null; inlineData: string | null };

export function header(headers: readonly GmailHeader[] | undefined, name: string): string | null {
  const h = (headers ?? []).find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h && typeof h.value === "string" ? h.value : null;
}
export function headersAll(headers: readonly GmailHeader[] | undefined, name: string): string[] {
  return (headers ?? []).filter((x) => (x.name ?? "").toLowerCase() === name.toLowerCase()).map((x) => x.value ?? "");
}

/** Decode a Gmail body `data` (base64url; quoted-printable already undone by the API). */
export function decodeBodyData(data: string | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

/** Walk the MIME tree: the first text/plain (else text/html stripped) and every named attachment. */
export function walkMessage(payload: GmailPart | undefined): { text: string; attachments: AttachmentRef[] } {
  let plain: string | null = null;
  let html: string | null = null;
  const attachments: AttachmentRef[] = [];
  const visit = (p: GmailPart | undefined, depth: number) => {
    if (!p || depth > 20) return;
    const mt = (p.mimeType ?? "").toLowerCase();
    const name = (p.filename ?? "").trim();
    if (name) {
      attachments.push({
        filename: name,
        mimeType: mt,
        size: typeof p.body?.size === "number" ? p.body.size : 0,
        attachmentId: p.body?.attachmentId ?? null,
        inlineData: p.body?.attachmentId ? null : (p.body?.data ?? null),
      });
    } else if (mt === "text/plain" && plain === null && p.body?.data) plain = decodeBodyData(p.body.data);
    else if (mt === "text/html" && html === null && p.body?.data) html = decodeBodyData(p.body.data);
    for (const c of p.parts ?? []) visit(c, depth + 1);
  };
  visit(payload, 0);
  const text = plain ?? (html !== null ? htmlToText(html) : "");
  return { text, attachments };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** The address inside `Name <addr>` (or a bare address), lower-case; null when none. */
export function senderAddress(from: string | null): string | null {
  if (!from) return null;
  const angle = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from.trim());
  const addr = angle ? angle[1] : from.trim();
  return EMAIL_RE.test(addr) ? addr.toLowerCase() : null;
}

/**
 * Should this attachment be downloaded? Any name ending .csv, within the size
 * cap. The MIME type is NOT checked: the type CCRS sends was never captured
 * (U-66), and a wrong guess would silently drop the error file. Reading text
 * is harmless; readErrorAttachment decides what it is.
 */
export function wantAttachment(a: AttachmentRef): boolean {
  return /\.csv$/i.test(a.filename) && a.size <= MAX_ATTACHMENT_BYTES;
}

/* ------------------------------------------------------------------ *
 * Sender authentication (shown, never blocking: U-67).
 * ------------------------------------------------------------------ */
export type AuthVerdict = "aligned-pass" | "not-aligned" | "dmarc-fail" | "absent";

export function authVerdict(authResults: readonly string[]): AuthVerdict {
  if (authResults.length === 0) return "absent";
  const all = authResults.join(" ; ").toLowerCase();
  if (/\bdmarc=fail\b/.test(all)) return "dmarc-fail";
  if (/\bdmarc=pass\b/.test(all)) return "aligned-pass";
  const dkimAligned = /\bdkim=pass\b[^;]*header\.(?:d|i)=@?(?:[a-z0-9-]+\.)*lcb\.wa\.gov(?![a-z0-9.-])/.test(all);
  const spfAligned = /\bspf=pass\b[^;]*smtp\.mailfrom=(?:[^\s;@]*@)?(?:[a-z0-9-]+\.)*lcb\.wa\.gov(?![a-z0-9.-])/.test(all);
  return dkimAligned || spfAligned ? "aligned-pass" : "not-aligned";
}

export const AUTH_TEXT: Record<AuthVerdict, string> = {
  "aligned-pass": "Google checked the sender: it really came from lcb.wa.gov.",
  "not-aligned": "Google could not tie this message to lcb.wa.gov's mail servers. What a real CCRS email shows here is not yet known (U-67); check before applying.",
  "dmarc-fail": "Google reports DMARC FAIL for this sender. lcb.wa.gov does not reject forged mail (p=none). Treat as suspect: do not apply without checking the CCRS portal.",
  absent: "No authentication result on this message.",
};

/* ------------------------------------------------------------------ *
 * Classification.
 * ------------------------------------------------------------------ */
export type ErrorAttachment = {
  filename: string;
  fileType: CcrsRetailerFileType | null;
  /** Why fileType is null (name and header disagree, unknown name, ...). */
  typeProblem: string | null;
  header: string[];
  dataLines: number;
  messages: string[];
  csv: string;
};

export type MailKind = "success" | "error" | "unknown" | "not-ccrs";

export type MailAnalysis = {
  kind: MailKind;
  env: LedgerEnv | null;
  /** True only for the observed PREprod format. */
  envVerified: boolean;
  successes: SuccessNotice[];
  errors: ErrorAttachment[];
  /** CSV attachments that are not CCRS error files (no ErrorMessage column). */
  otherAttachments: string[];
  inSpam: boolean;
  auth: AuthVerdict;
  /** Plain-language reasons the owner must look (empty when it is a clean, known format). */
  needsHuman: string[];
};

export type NormalizedMail = {
  gmailId: string;
  threadId: string | null;
  receivedAt: string | null;
  from: string | null;
  subject: string;
  text: string;
  labelIds: string[];
  authResults: string[];
  /** Downloaded CSV attachments (text), plus names of the ones not downloaded. */
  csvs: { filename: string; text: string }[];
  skippedAttachments: string[];
};

const TYPE_FROM_NAME = /^(InventoryAdjustment|InventoryTransfer|Inventory|Product|Strain|Area|Sale)_/;
const PROCESSED_RE = /you submitted has been processed/i;

/** The file type of an error CSV: its name and its header must agree, else null with the reason. */
export function errorFileType(filename: string, headerCells: readonly string[]): { type: CcrsRetailerFileType | null; problem: string | null } {
  const m = TYPE_FROM_NAME.exec(filename);
  if (!m) return { type: null, problem: `the name "${filename}" does not start with a CCRS file type` };
  const t = m[1] as CcrsRetailerFileType;
  if (!echoHeaderLooksRight(t, headerCells)) return { type: null, problem: `the name says ${t} but the header lacks the ${t} identity columns` };
  return { type: t, problem: null };
}

/** The longest CCRS_KNOWN_MESSAGES text inside a line, or null (same rule as classifyEcho's knownMessageIn). */
export function knownCcrsMessage(line: string): string | null {
  let best: string | null = null;
  for (const m of CCRS_KNOWN_MESSAGES) if (line.includes(m.text) && (!best || m.text.length > best.length)) best = m.text;
  return best;
}

function splitLines(text: string): string[] {
  return text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter((l) => l.trim() !== "");
}

export function readErrorAttachment(filename: string, text: string): ErrorAttachment | null {
  const lines = splitLines(text);
  if (lines.length === 0) return null;
  const head = ccrsReaderSplit(lines[0]).map((h) => h.trim());
  if (!head.includes("ErrorMessage")) return null;
  const at = head.indexOf("ErrorMessage");
  const msgs: string[] = [];
  for (const l of lines.slice(1)) {
    // Known text first (longest match), exactly as classifyEcho reads it: a shifted
    // row (comma inside a value, P20261005A) still names its message that way.
    const km = knownCcrsMessage(l);
    const cells = ccrsReaderSplit(l);
    const cell = cells.length === head.length ? (cells[at] ?? "").trim() : "";
    const msg = km ?? (cell || "(message not readable: the row has a different number of cells than the header)");
    if (!msgs.includes(msg)) msgs.push(msg);
  }
  const { type, problem } = errorFileType(filename, head);
  return { filename, fileType: type, typeProblem: problem, header: head, dataLines: lines.length - 1, messages: msgs, csv: text };
}

export function subjectEnv(subject: string, kind: "success" | "error"): { env: LedgerEnv | null; verified: boolean } {
  const s = subject.trim();
  if (kind === "success") {
    if (/^PRE:\s*CCRS Processing Successful$/i.test(s)) return { env: "preprod", verified: true };
    // U-65: production mail never captured; "minus the PRE prefix" is the examiner's answer [EXAM L0538] (U-20).
    if (/^CCRS Processing Successful$/i.test(s)) return { env: "prod", verified: false };
    return { env: null, verified: false };
  }
  // U-66: error subjects never captured. A leading "PRE" is a hint only.
  if (/^PRE\b/i.test(s)) return { env: "preprod", verified: false };
  return { env: null, verified: false };
}

export function classifyCcrsMail(m: NormalizedMail): MailAnalysis {
  const inSpam = m.labelIds.includes("SPAM");
  const auth = authVerdict(m.authResults);
  const base = { inSpam, auth, otherAttachments: [] as string[], needsHuman: [] as string[] };
  if (senderAddress(m.from) !== CCRS_SENDER) {
    return { ...base, kind: "not-ccrs", env: null, envVerified: false, successes: [], errors: [], needsHuman: [`sent by ${m.from ?? "(no From)"}, not ${CCRS_SENDER}`] };
  }
  const successes = PROCESSED_RE.test(m.text) ? parseSuccessEmails(m.text) : [];
  const errors: ErrorAttachment[] = [];
  const other: string[] = [];
  for (const c of m.csvs) {
    const e = readErrorAttachment(c.filename, c.text);
    if (e) errors.push(e);
    else other.push(c.filename);
  }
  const needsHuman: string[] = [];
  if (inSpam) needsHuman.push("Gmail put this in Spam. Mark it \"Not spam\" so the next one reaches the inbox [FAQ L0102].");
  if (auth === "dmarc-fail") needsHuman.push(AUTH_TEXT["dmarc-fail"]);
  if (m.skippedAttachments.length) needsHuman.push(`not downloaded (not a CSV, too large, or more than ${MAX_CSV_PER_MESSAGE} CSVs): ${m.skippedAttachments.join(", ")}`);
  if (other.length) needsHuman.push(`CSV without an ErrorMessage column: ${other.join(", ")}`);

  let kind: MailKind;
  let env: LedgerEnv | null = null;
  let envVerified = false;
  if (successes.length > 0 && errors.length === 0) {
    kind = "success";
    ({ env, verified: envVerified } = subjectEnv(m.subject, "success"));
    if (!env) needsHuman.push(`unfamiliar subject "${m.subject}": choose PREprod or production before applying`);
    else if (!envVerified) needsHuman.push("first production-style confirmation: the subject without \"PRE\" has never been seen before (U-65). Check the file in the CCRS portal once.");
  } else if (errors.length > 0 && successes.length === 0) {
    kind = "error";
    ({ env, verified: envVerified } = subjectEnv(m.subject, "error"));
    for (const e of errors) if (e.typeProblem) needsHuman.push(`${e.filename}: ${e.typeProblem}`);
  } else {
    kind = "unknown";
    needsHuman.push(
      successes.length && errors.length
        ? "this email both confirms a file and carries an error file; that has never been seen. Read it in Gmail."
        : PROCESSED_RE.test(m.text)
          ? "says a file was processed, but the file name is not in the shape this system emits (for example a renamed copy with an extra _1). Read it in Gmail and record it by hand."
          : parseNotProcessed(m.text).length > 0
            ? notProcessedAdvice(parseNotProcessed(m.text))
            : "from CCRS, but neither a confirmation nor an error file. Read it in Gmail.",
    );
  }
  return { ...base, kind, env, envVerified, successes, errors, otherAttachments: other, needsHuman };
}

/* ------------------------------------------------------------------ *
 * Which uploaded file does an error CSV answer? Proven by classifyEcho.
 * ------------------------------------------------------------------ */
export type EchoCandidate = { fileId: string; fileName: string; env: LedgerEnv; fileType: string; state: string; rows: OurRow[] };
export type EchoPick =
  | { kind: "unique"; fileId: string; fileName: string; env: LedgerEnv; verdict: EchoVerdict }
  | { kind: "ambiguous"; files: { fileId: string; fileName: string; env: LedgerEnv }[] }
  | { kind: "none"; reasons: string[] };

export function pickEchoFile(e: ErrorAttachment, candidates: readonly EchoCandidate[], env: LedgerEnv | null): EchoPick {
  if (!e.fileType) return { kind: "none", reasons: [e.typeProblem ?? "file type unknown"] };
  // R74 S48: a file still "emitted" (handed out, never marked uploaded) is a
  // candidate too: the CCRS email is the proof it was uploaded, and the Apply
  // marks it uploaded (logged) before recording the answer.
  const pool = candidates.filter((c) => c.fileType === e.fileType && (c.state === "uploaded" || c.state === "emitted") && (env === null || c.env === env));
  if (pool.length === 0) {
    return { kind: "none", reasons: [`no ${e.fileType} file${env ? ` in ${env}` : ""} is waiting for an answer (every one is already answered or abandoned)`] };
  }
  const ok: { c: EchoCandidate; v: EchoVerdict }[] = [];
  const reasons: string[] = [];
  for (const c of pool) {
    try {
      ok.push({ c, v: classifyEcho(e.fileType, c.rows, e.csv) });
    } catch (err) {
      reasons.push(`${c.fileName}: ${err instanceof CcrsEchoError ? err.message : String(err)}`);
    }
  }
  if (ok.length === 1) return { kind: "unique", fileId: ok[0].c.fileId, fileName: ok[0].c.fileName, env: ok[0].c.env, verdict: ok[0].v };
  if (ok.length > 1) return { kind: "ambiguous", files: ok.map(({ c }) => ({ fileId: c.fileId, fileName: c.fileName, env: c.env })) };
  return { kind: "none", reasons };
}

/* ------------------------------------------------------------------ *
 * From a Gmail message (format=full) plus the downloaded CSVs to the
 * NormalizedMail the classifier reads. Pure: the fetch module downloads.
 * ------------------------------------------------------------------ */
/** Which attachments to download, and which to name as skipped. */
export function attachmentPlan(msg: GmailMessage): { download: AttachmentRef[]; skipped: string[] } {
  const { attachments } = walkMessage(msg.payload);
  const wanted = attachments.filter((a) => wantAttachment(a));
  const download = wanted.slice(0, MAX_CSV_PER_MESSAGE);
  const skipped = [...attachments.filter((a) => !wantAttachment(a)), ...wanted.slice(MAX_CSV_PER_MESSAGE)].map((a) => a.filename);
  return { download, skipped };
}

export function normalizeGmailMessage(msg: GmailMessage, csvs: readonly { filename: string; text: string }[], skipped: readonly string[]): NormalizedMail {
  if (!msg.id) throw new Error("Gmail message has no id");
  const hs = msg.payload?.headers;
  const ms = Number(msg.internalDate);
  return {
    gmailId: msg.id,
    threadId: msg.threadId ?? null,
    // internalDate: epoch ms, "more reliable than the Date header" (Gmail API Message resource).
    receivedAt: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    from: header(hs, "From"),
    subject: header(hs, "Subject") ?? "",
    text: walkMessage(msg.payload).text,
    labelIds: [...(msg.labelIds ?? [])],
    authResults: headersAll(hs, "Authentication-Results"),
    csvs: csvs.map((c) => ({ filename: c.filename, text: c.text })),
    skippedAttachments: [...skipped],
  };
}

/** The ids a tick should fetch: listed, not yet stored, oldest first, at most MAX_NEW_PER_TICK. */
export function idsToFetch(listed: readonly string[], known: ReadonlySet<string>, max = MAX_NEW_PER_TICK): { fetch: string[]; deferred: number } {
  // messages.list returns newest first; reverse so a capped tick takes the oldest and none is starved.
  const fresh = [...new Set(listed)].filter((id) => !known.has(id)).reverse();
  return { fetch: fresh.slice(0, max), deferred: Math.max(0, fresh.length - max) };
}

/** What is stored per message (0282 ccrs_mail_messages). Body text capped; CSVs kept whole for Apply. */
export const MAX_STORED_BODY_CHARS = 20_000;
export type CcrsMailRow = {
  mailbox: string;
  gmail_id: string;
  thread_id: string | null;
  received_at: string | null;
  from_header: string | null;
  subject: string;
  kind: MailKind;
  env: LedgerEnv | null;
  env_verified: boolean;
  auth: AuthVerdict;
  in_spam: boolean;
  body_text: string;
  analysis: Omit<MailAnalysis, "errors"> & { errors: Omit<ErrorAttachment, "csv">[] };
  csvs: { filename: string; text: string }[];
};

export function toMailRow(mailbox: string, m: NormalizedMail, a: MailAnalysis): CcrsMailRow {
  return {
    mailbox,
    gmail_id: m.gmailId,
    thread_id: m.threadId,
    received_at: m.receivedAt,
    from_header: m.from,
    subject: m.subject.slice(0, 500),
    kind: a.kind,
    env: a.env,
    env_verified: a.envVerified,
    auth: a.auth,
    in_spam: a.inSpam,
    body_text: m.text.slice(0, MAX_STORED_BODY_CHARS),
    analysis: { ...a, errors: a.errors.map((e) => ({ filename: e.filename, fileType: e.fileType, typeProblem: e.typeProblem, header: e.header, dataLines: e.dataLines, messages: e.messages })) },
    csvs: m.csvs,
  };
}

/**
 * The time an Apply records: CCRS's own "Date Submitted" (success) or the
 * mail's arrival (error), never before our recorded upload and never in the
 * future. Same rule as the paste box (recordSuccessAction). Null when there is
 * no time at all to use.
 */
export function applyTimeISO(uploadedAt: string | null, emailTime: string | null, nowMs: number): string | null {
  const up = uploadedAt ? Date.parse(uploadedAt) : NaN;
  const em = emailTime ? Date.parse(emailTime) : NaN;
  if (!Number.isFinite(up)) return null;
  const t = Number.isFinite(em) ? Math.max(up, em) : nowMs;
  return new Date(Math.min(nowMs, t)).toISOString();
}

/* ------------------------------------------------------------------ *
 * Apply planning (the owner pressed a button; the server re-checks).
 * ------------------------------------------------------------------ */
/**
 * Which env a success email is applied to. A verified subject decides it; an
 * unverified one (first production-style subject, U-65) needs the owner's
 * tick; no env at all needs the owner's choice. Never guessed.
 */
export function planSuccessEnv(a: Pick<MailAnalysis, "kind" | "env" | "envVerified">, chosen: string | null, confirmed: boolean): { ok: true; env: LedgerEnv } | { ok: false; error: string } {
  if (a.kind !== "success") return { ok: false, error: "This email is not a CCRS confirmation." };
  const pick = chosen === "preprod" || chosen === "prod" ? chosen : null;
  if (a.env && a.envVerified) {
    if (pick && pick !== a.env) return { ok: false, error: `The subject says ${a.env}; it cannot be applied to ${pick}.` };
    return { ok: true, env: a.env };
  }
  if (a.env && !a.envVerified) {
    if (pick && pick !== a.env) return { ok: false, error: `The subject points to ${a.env}; it cannot be applied to ${pick}.` };
    if (!confirmed) return { ok: false, error: "Tick the box to confirm you checked this file in the CCRS portal (this subject has never been seen before, U-65)." };
    return { ok: true, env: a.env };
  }
  if (!pick) return { ok: false, error: "Choose PREprod or production: the subject does not say which." };
  if (!confirmed) return { ok: false, error: "Tick the box to confirm you checked this file in the CCRS portal." };
  return { ok: true, env: pick };
}

/**
 * The file an error attachment is applied to. With no choice, pickEchoFile
 * must find exactly one. With the owner's choice (after an ambiguous pick),
 * that file must be in the pool AND accept the echo row by row.
 */
export function resolveEchoPick(e: ErrorAttachment, candidates: readonly EchoCandidate[], chosenFileId: string | null): EchoPick {
  const auto = pickEchoFile(e, candidates, null);
  if (!chosenFileId) return auto;
  if (auto.kind === "unique") {
    return auto.fileId === chosenFileId ? auto : { kind: "none", reasons: [`the rows prove this answers ${auto.fileName}, not the file chosen`] };
  }
  if (auto.kind === "none") return auto;
  const c = candidates.find((x) => x.fileId === chosenFileId);
  if (!c || !auto.files.some((f) => f.fileId === chosenFileId)) return { kind: "none", reasons: ["the chosen file is not one the rows fit"] };
  return { kind: "unique", fileId: c.fileId, fileName: c.fileName, env: c.env, verdict: classifyEcho(e.fileType!, c.rows, e.csv) };
}

/** Rebuild the ErrorAttachment list from a stored row (the CSVs are kept whole). */
export function errorsFromStored(csvs: readonly { filename: string; text: string }[]): ErrorAttachment[] {
  const out: ErrorAttachment[] = [];
  for (const c of csvs) {
    const e = readErrorAttachment(c.filename, c.text);
    if (e) out.push(e);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Heartbeat: write on change, or when the last OK is older than 30 min.
 * ------------------------------------------------------------------ */
export type MailHeartbeat = {
  lastRunAt: string;
  lastOkAt: string | null;
  ok: boolean;
  error: string | null;
  mode: MailAuthMode | null;
  newMessages: number;
  /** S-18c: when the current run of failed checks began (configured monitor only); null while healthy or not set up. */
  failingSince?: string | null;
};

/**
 * S-18c: the start of the current outage. Carried over while the same
 * configured monitor keeps failing; restarts when the mode changes (a new
 * setup is a new outage); null when healthy or not set up ("not set up" is
 * not an outage and never alerts).
 */
export function nextFailingSince(prev: MailHeartbeat | null, ok: boolean, mode: MailAuthMode | null, nowIso: string): string | null {
  if (ok || !mode) return null;
  if (prev && !prev.ok && prev.mode === mode && prev.failingSince) return prev.failingSince;
  return nowIso;
}
export const HEARTBEAT_REFRESH_MINUTES = 30;

export function shouldWriteHeartbeat(prev: MailHeartbeat | null, next: MailHeartbeat, nowMs: number): boolean {
  if (!prev) return true;
  if (prev.ok !== next.ok || prev.error !== next.error || prev.mode !== next.mode) return true;
  if ((prev.failingSince ?? null) !== (next.failingSince ?? null)) return true; // S-18c: the outage start is persisted at once
  if (next.newMessages > 0) return true;
  const last = Date.parse(prev.lastRunAt);
  return !Number.isFinite(last) || nowMs - last >= HEARTBEAT_REFRESH_MINUTES * 60_000;
}

/** Is the monitor stale? Two missed 5-minute ticks plus the refresh window. */
export function heartbeatStale(hb: MailHeartbeat | null, nowMs: number): boolean {
  if (!hb) return true;
  const t = Date.parse(hb.lastRunAt);
  return !Number.isFinite(t) || nowMs - t > (HEARTBEAT_REFRESH_MINUTES + 15) * 60_000;
}

export function heartbeatFromSetting(v: unknown): MailHeartbeat | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.lastRunAt !== "string" || typeof o.ok !== "boolean") return null;
  return {
    lastRunAt: o.lastRunAt,
    lastOkAt: typeof o.lastOkAt === "string" ? o.lastOkAt : null,
    ok: o.ok,
    error: typeof o.error === "string" ? o.error : null,
    mode: (MAIL_AUTH_MODES as readonly unknown[]).includes(o.mode) ? (o.mode as MailAuthMode) : null,
    newMessages: typeof o.newMessages === "number" ? o.newMessages : 0,
    failingSince: typeof o.failingSince === "string" ? o.failingSince : null,
  };
}

/* ------------------------------------------------------------------ *
 * Self-tests.
 * ------------------------------------------------------------------ */
export function __runCcrsMailCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, msg: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };
  // config
  ok(!mailConfigFromEnv({}).configured, "nothing set -> not configured");
  ok(mailConfigFromEnv({}).mailbox === DEFAULT_CCRS_MAILBOX, "default mailbox is the owner's");
  const sa = mailConfigFromEnv({ GMAIL_SA_CLIENT_EMAIL: "x@y.iam.gserviceaccount.com", GMAIL_SA_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nAB\\n-----END PRIVATE KEY-----" });
  ok(sa.configured && sa.mode === "service-account" && sa.serviceAccount!.privateKey.includes("\nAB\n"), "SA mode, \\n unescaped");
  const half = mailConfigFromEnv({ GMAIL_OAUTH_CLIENT_ID: "a" });
  ok(!half.configured && half.missing.includes("GMAIL_OAUTH_REFRESH_TOKEN"), "half OAuth lists what is missing");
  const both = mailConfigFromEnv({ GMAIL_OAUTH_CLIENT_ID: "a", GMAIL_SA_CLIENT_EMAIL: "b" });
  ok(!both.configured && !!both.problem, "both modes refused");
  ok(!mailConfigFromEnv({ CCRS_MAIL_LOOKBACK_HOURS: "0", GMAIL_OAUTH_CLIENT_ID: "a", GMAIL_OAUTH_CLIENT_SECRET: "b", GMAIL_OAUTH_REFRESH_TOKEN: "c" }).configured, "lookback 0 refused");
  // R6-5 keyless
  const WI = { GMAIL_WIF_SERVICE_ACCOUNT_EMAIL: "ccrs-mail@gw-1.iam.gserviceaccount.com", GMAIL_WIF_PROJECT_NUMBER: "123456789012", GMAIL_WIF_POOL_ID: "vercel", GMAIL_WIF_PROVIDER_ID: "vercel" };
  const wiCfg = mailConfigFromEnv(WI);
  ok(wiCfg.configured && wiCfg.mode === "workload-identity" && wiCfg.workloadIdentity!.poolId === "vercel", "WIF mode");
  const nothing = mailConfigFromEnv({});
  ok(!nothing.configured && nothing.missing.join() === WIF_VARS.join(), "nothing set names the keyless variables");
  ok(!mailConfigFromEnv({ ...WI, GMAIL_WIF_PROJECT_NUMBER: "gw-1" }).configured, "project id instead of number refused");
  ok(!mailConfigFromEnv({ ...WI, GMAIL_SA_CLIENT_EMAIL: "x" }).configured, "WIF + SA refused");
  ok(wifAudience(wiCfg.configured ? wiCfg.workloadIdentity! : (WI as never)) === "//iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/vercel/providers/vercel", "STS audience");
  ok(pickVercelOidcToken({ header: " ", file: null, env: "e" }) === "e" && pickVercelOidcToken({}) === null, "token source order");
  // query
  ok(buildCcrsQuery(Date.UTC(2026, 10, 8, 12), 72) === `from:info@lcb.wa.gov after:${Date.UTC(2026, 10, 5, 12) / 1000}`, "query uses epoch seconds");
  // jwt
  const j = serviceAccountJwtParts({ clientEmail: "sa@p.iam.gserviceaccount.com", subject: "michael@greenwaymarijuana.com", nowSec: 1000 });
  ok(j.claims.exp === 4600 && j.claims.aud === GOOGLE_TOKEN_URL && j.claims.sub === "michael@greenwaymarijuana.com" && j.claims.scope === GMAIL_READONLY_SCOPE, "JWT claims");
  ok(j.signingInput.split(".").length === 2, "signing input is header.claims");
  // token
  ok(decodeTokenResponse(200, { access_token: "t", expires_in: 3599 }).ok, "token ok");
  const bad = decodeTokenResponse(400, { error: "invalid_grant" });
  ok(!bad.ok && /refresh token was revoked/.test(bad.error), "invalid_grant explained");
  ok(!decodeTokenResponse(200, { access_token: "" }).ok, "empty token refused");
  // sender
  ok(senderAddress("info@lcb.wa.gov <info@lcb.wa.gov>") === CCRS_SENDER, "angle form");
  ok(senderAddress("INFO@LCB.WA.GOV") === CCRS_SENDER, "bare, case folded");
  ok(senderAddress("LCB <info@lcb.wa.gov.evil.com>") !== CCRS_SENDER, "look-alike domain is not CCRS");
  // auth
  ok(authVerdict([]) === "absent", "no header");
  ok(authVerdict(["mx.google.com; dkim=pass header.i=@lcb.wa.gov; spf=pass"]) === "aligned-pass", "dkim aligned");
  ok(authVerdict(["mx.google.com; dkim=pass header.i=@amazonses.com; spf=pass smtp.mailfrom=x@amazonses.com"]) === "not-aligned", "SES not aligned");
  ok(authVerdict(["mx.google.com; dmarc=fail (p=NONE) header.from=lcb.wa.gov"]) === "dmarc-fail", "dmarc fail");
  // subject env
  ok(subjectEnv("PRE: CCRS Processing Successful", "success").verified, "PRE verified");
  const pe = subjectEnv("CCRS Processing Successful", "success");
  ok(pe.env === "prod" && !pe.verified, "prod inferred, not verified");
  ok(subjectEnv("Something else", "success").env === null, "unknown subject -> env null");
  ok(subjectEnv("Whatever", "error").env === null, "error subject never decides env");
  // error file type
  ok(errorFileType("Strain_20260917T125413969.csv", ["LicenseNumber", "Strain", "ErrorMessage"]).type === "Strain", "Strain single underscore");
  ok(errorFileType("InventoryAdjustment__x.csv", ["LicenseNumber", "ExternalIdentifier", "ErrorMessage"]).type === "InventoryAdjustment", "longest type first");
  ok(errorFileType("Inventory__x.csv", ["LicenseNumber", "Strain", "ErrorMessage"]).type === null, "header disagrees -> null");
  // heartbeat
  const hb: MailHeartbeat = { lastRunAt: new Date(0).toISOString(), lastOkAt: null, ok: true, error: null, mode: "service-account", newMessages: 0 };
  ok(!shouldWriteHeartbeat(hb, { ...hb }, 5 * 60_000), "quiet tick within 30 min writes nothing");
  ok(shouldWriteHeartbeat(hb, { ...hb }, 30 * 60_000), "refresh at 30 min");
  ok(shouldWriteHeartbeat(hb, { ...hb, ok: false, error: "x" }, 60_000), "state change writes");
  ok(heartbeatStale(hb, 46 * 60_000) && !heartbeatStale(hb, 44 * 60_000), "stale after 45 min");
  ok(nextFailingSince(hb, false, "service-account", "T1") === "T1", "first failure starts the outage");
  ok(nextFailingSince({ ...hb, ok: false, failingSince: "T0" }, false, "service-account", "T1") === "T0", "outage start carried");
  ok(nextFailingSince({ ...hb, ok: false, failingSince: "T0" }, false, "oauth-refresh", "T1") === "T1", "mode change restarts");
  ok(nextFailingSince({ ...hb, ok: false, failingSince: "T0" }, true, "service-account", "T1") === null, "healthy clears");
  ok(nextFailingSince(null, false, null, "T1") === null, "not set up is not an outage");
  ok(shouldWriteHeartbeat({ ...hb, ok: false, error: "x" }, { ...hb, ok: false, error: "x", failingSince: "T0" }, 60_000), "an outage start from an old-shape heartbeat is written at once");
  return { passed, failed };
}
