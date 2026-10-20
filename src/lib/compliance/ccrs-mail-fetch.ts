/**
 * src/lib/compliance/ccrs-mail-fetch.ts  (CCRS Bible v2 slice S-18a). I/O ONLY.
 *
 * The Gmail API calls, nothing else. Every decision (which mail, what it
 * says, what to store) is in the PURE ccrs-mail-core.
 *
 * Endpoints (developers.google.com/workspace/gmail/api/reference/rest, read
 * 2026-10-20):
 *   GET  https://gmail.googleapis.com/gmail/v1/users/{userId}/messages
 *        ?q=...&maxResults=...&pageToken=...&includeSpamTrash=true
 *   GET  .../users/{userId}/messages/{id}?format=full
 *   GET  .../users/{userId}/messages/{messageId}/attachments/{id}
 *        -> MessagePartBody { size, data (base64url) }
 *   POST https://oauth2.googleapis.com/token
 *        service account: grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<JWT RS256>
 *        OAuth:           grant_type=refresh_token&client_id&client_secret&refresh_token
 *
 * Every request has a hard timeout, so a slow Google cannot hold the cron
 * past maxDuration. Errors are returned as text, never thrown past the tick.
 */
import "server-only";

import { createSign } from "node:crypto";
import {
  GOOGLE_TOKEN_URL,
  JWT_BEARER_GRANT,
  b64url,
  decodeBodyData,
  decodeTokenResponse,
  serviceAccountJwtParts,
  type AttachmentRef,
  type GmailMessage,
  type MailConfig,
} from "./ccrs-mail-core";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users";
const TIMEOUT_MS = 15_000;
/** messages.list maxResults ceiling is 500; a 72-hour CCRS window holds far fewer. */
const LIST_PAGE = 100;
const LIST_MAX_PAGES = 5;

type Configured = Extract<MailConfig, { configured: true }>;

async function fetchJson(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal, cache: "no-store" });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: `non-JSON answer (${text.slice(0, 120)})` };
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

function gmailError(what: string, status: number, body: unknown): Error {
  const o = body && typeof body === "object" ? (body as { error?: { message?: string } | string }) : {};
  const msg = typeof o.error === "string" ? o.error : (o.error?.message ?? "");
  const hint =
    status === 403 && /has not been used|disabled/i.test(msg)
      ? " (turn on the Gmail API for the Google Cloud project)"
      : status === 401
        ? " (the access token was refused)"
        : status === 429
          ? " (Gmail rate limit; the next tick retries)"
          : "";
  return new Error(`Gmail ${what}: HTTP ${status}${msg ? `: ${msg}` : ""}${hint}`);
}

/** An access token for gmail.readonly on the configured mailbox. */
export async function getGmailAccessToken(cfg: Configured, nowMs = Date.now()): Promise<string> {
  let form: URLSearchParams;
  if (cfg.mode === "service-account") {
    const sa = cfg.serviceAccount!;
    const { signingInput } = serviceAccountJwtParts({ clientEmail: sa.clientEmail, subject: cfg.mailbox, nowSec: Math.floor(nowMs / 1000) });
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const sig = b64url(signer.sign(sa.privateKey));
    form = new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion: `${signingInput}.${sig}` });
  } else {
    const o = cfg.oauth!;
    form = new URLSearchParams({ grant_type: "refresh_token", client_id: o.clientId, client_secret: o.clientSecret, refresh_token: o.refreshToken });
  }
  const { status, body } = await fetchJson(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const t = decodeTokenResponse(status, body);
  if (!t.ok) throw new Error(`Google sign-in for ${cfg.mailbox} failed: ${t.error}`);
  return t.accessToken;
}

/** Every message id matching q, newest first, Spam and Trash included [FAQ L0102]. */
export async function listMessageIds(token: string, mailbox: string, q: string): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < LIST_MAX_PAGES; page += 1) {
    const u = new URL(`${GMAIL_BASE}/${encodeURIComponent(mailbox)}/messages`);
    u.searchParams.set("q", q);
    u.searchParams.set("maxResults", String(LIST_PAGE));
    u.searchParams.set("includeSpamTrash", "true");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const { status, body } = await fetchJson(u.toString(), { headers: { authorization: `Bearer ${token}` } });
    if (status !== 200) throw gmailError("messages.list", status, body);
    const o = (body ?? {}) as { messages?: { id?: string }[]; nextPageToken?: string };
    for (const m of o.messages ?? []) if (typeof m.id === "string") ids.push(m.id);
    pageToken = typeof o.nextPageToken === "string" && o.nextPageToken ? o.nextPageToken : undefined;
    if (!pageToken) return { ids, truncated: false };
  }
  return { ids, truncated: true };
}

export async function getMessage(token: string, mailbox: string, id: string): Promise<GmailMessage> {
  const u = `${GMAIL_BASE}/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?format=full`;
  const { status, body } = await fetchJson(u, { headers: { authorization: `Bearer ${token}` } });
  if (status !== 200) throw gmailError(`messages.get ${id}`, status, body);
  return body as GmailMessage;
}

/** The text of one attachment (inline data, or attachments.get). */
export async function getAttachmentText(token: string, mailbox: string, messageId: string, a: AttachmentRef): Promise<string> {
  if (a.inlineData) return decodeBodyData(a.inlineData);
  if (!a.attachmentId) return "";
  const u = `${GMAIL_BASE}/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.attachmentId)}`;
  const { status, body } = await fetchJson(u, { headers: { authorization: `Bearer ${token}` } });
  if (status !== 200) throw gmailError(`attachments.get ${a.filename}`, status, body);
  const data = (body as { data?: string } | null)?.data;
  return decodeBodyData(typeof data === "string" ? data : undefined);
}
