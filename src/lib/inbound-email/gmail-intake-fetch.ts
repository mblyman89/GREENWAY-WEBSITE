/**
 * src/lib/inbound-email/gmail-intake-fetch.ts  (Fix Phase 3.2a, G-17). I/O ONLY.
 *
 * The vendor_intake@ mailbox read as a SOURCE OF TRUTH for Receiving. The
 * owner (verbatim): "Every manifest comes via email. ... If an invoice and
 * manifest don't make it to the table and I know it's in the email account
 * because I have it open and looking at it, I need a way to ask the system to
 * grab the ones it missed or failed to get. ... I want this table to receive
 * every manifest, no exceptions."
 *
 * Same Gmail sign-in as the CCRS monitor and the Cultivera harvest (the four
 * GMAIL_WIF_* variables; one domain-wide approval covers every mailbox,
 * ccrs-mail-fetch.ts L1-L24), read-only (gmail.readonly). Endpoints:
 *   GET .../users/{mailbox}/messages?q=...&includeSpamTrash=true   (listMessageIds)
 *   GET .../users/{mailbox}/messages/{id}?format=metadata&metadataHeaders=...
 *   GET .../users/{mailbox}/messages/{id}?format=full              (getMessage)
 *   GET .../messages/{id}/attachments/{attachmentId}                (getAttachmentBytes)
 *
 * The full read ends in completeInboundEmail, the SAME link harvest / .eml
 * explode / transfer-JSON fetch the Resend webhook runs, so an email pulled
 * in from Gmail is read exactly as a webhook delivery is. Never throws past
 * its result type.
 */
import "server-only";

import { mailConfigFromEnv, type MailConfig } from "@/lib/compliance/ccrs-mail-core";
import { getAttachmentBytes, getGmailAccessToken, getMessage, listMessageIds } from "@/lib/compliance/ccrs-mail-fetch";
import {
  gmailHeader,
  gmailRecipients,
  gmailIntakeVerdict,
  gmailToSource,
  gmailWrittenRecipients,
  normalizeMessageId,
  reconcileMailbox,
  walkGmailForIntake,
  type GmailPartLike,
  type SourceEmail,
} from "./inbound-reconcile-core";
import { bytesToAttachment, completeInboundEmail, type EnrichResult } from "./resend-receiving-fetch";
import type { NormalizedAttachment, NormalizedInboundEmail } from "./inbound-normalize-core";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users";
const META_TIMEOUT_MS = 15_000;
/** A manifest email carries a few files; more than this is not a manifest email. */
const MAX_ATTACHMENTS = 25;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type GmailIntakeConfig = { configured: true; cfg: Extract<MailConfig, { configured: true }>; mailbox: string } | { configured: false; mailbox: string | null; problem: string };

/** The Gmail sign-in for the intake mailbox (INBOUND_RECONCILE_MAILBOX, else vendor_intake@). */
export function gmailIntakeConfig(env: Readonly<Record<string, string | undefined>> = process.env): GmailIntakeConfig {
  const mailbox = reconcileMailbox(env);
  if (!mailbox) return { configured: false, mailbox: null, problem: "INBOUND_RECONCILE_MAILBOX is not an email address." };
  const cfg = mailConfigFromEnv({ ...env, CCRS_MAILBOX_ADDRESS: mailbox, CCRS_MAIL_LOOKBACK_HOURS: undefined });
  if (!cfg.configured) {
    return { configured: false, mailbox, problem: cfg.problem ?? `Gmail sign-in not set up (missing ${cfg.missing.join(", ")}).` };
  }
  return { configured: true, cfg, mailbox };
}

async function getMessageMetadata(token: string, mailbox: string, id: string): Promise<{ id?: string; internalDate?: string; payload?: GmailPartLike }> {
  const u = new URL(`${GMAIL_BASE}/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}`);
  u.searchParams.set("format", "metadata");
  for (const h of ["From", "To", "Cc", "Delivered-To", "X-Forwarded-To", "Subject", "Date", "Message-ID"]) u.searchParams.append("metadataHeaders", h);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), META_TIMEOUT_MS);
  try {
    const res = await fetch(u.toString(), { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) throw new Error(`Gmail messages.get ${id} (metadata): HTTP ${res.status}`);
    return (await res.json()) as { id?: string; internalDate?: string; payload?: GmailPartLike };
  } finally {
    clearTimeout(t);
  }
}

export type GmailListResult =
  | { ok: true; mailbox: string; items: SourceEmail[]; truncated: boolean; token: string; /** Fix 3.5: listed but sent to another of our addresses (not read). */ notIntake: number }
  | { ok: false; mailbox: string | null; configured: boolean; error: string };

/**
 * Every email in the mailbox matching `q` (Spam and Trash included, so a
 * manifest Gmail filed as spam is still found), as SourceEmail metadata.
 * `maxItems` caps the metadata reads (5 quota units each).
 */
export async function listGmailIntake(q: string, maxItems = 200): Promise<GmailListResult> {
  const conf = gmailIntakeConfig();
  if (!conf.configured) return { ok: false, mailbox: conf.mailbox, configured: false, error: conf.problem };
  try {
    const token = await getGmailAccessToken(conf.cfg);
    const listed = await listMessageIds(token, conf.mailbox, q);
    const ids = listed.ids.slice(0, maxItems);
    const items: SourceEmail[] = [];
    let notIntake = 0;
    // Small parallel batches: fast, and well under Gmail's per-user rate.
    for (let i = 0; i < ids.length; i += 10) {
      const batch = await Promise.all(
        ids.slice(i, i + 10).map(async (id) => {
          try {
            const meta = await getMessageMetadata(token, conf.mailbox, id);
            // Fix 3.5 (owner: "It should only target vendor_intake@ and none of
            // my other @greenwaymarijuana.com addresses."): mail that reached
            // the box through another of our addresses is never pulled in.
            if (!gmailIntakeVerdict(meta.payload).ok) {
              notIntake += 1;
              return null;
            }
            return gmailToSource(meta);
          } catch {
            // An unreadable header read still counts: it is listed with no
            // identity beyond its id, so it is pulled in (and read in full) rather
            // than silently skipped.
            return { source: "gmail" as const, ref: id, messageId: null, from: null, subject: null, receivedAt: new Date(0).toISOString(), to: [] };
          }
        }),
      );
      for (const s of batch) if (s) items.push(s);
    }
    return { ok: true, mailbox: conf.mailbox, items, truncated: listed.truncated || listed.ids.length > ids.length, token, notIntake };
  } catch (err) {
    return { ok: false, mailbox: conf.mailbox, configured: true, error: err instanceof Error ? err.message : String(err) };
  }
}

export type GmailFetchResult =
  | { ok: true; result: EnrichResult }
  | { ok: false; error: string; notIntake?: undefined }
  /** Fix 3.5: the message was sent to another of our addresses: not read, never staged. */
  | { ok: false; error: string; notIntake: true; email: NormalizedInboundEmail };

/**
 * Read one Gmail message in full and hand it to the shared intake fetch.
 * `token` is reused from the list when there is one. NEVER throws: a failure
 * comes back as { ok:false } so the caller can record it on the row.
 */
export async function fetchGmailInboundById(
  gmailId: string,
  token?: string | null,
): Promise<GmailFetchResult> {
  const conf = gmailIntakeConfig();
  if (!conf.configured) return { ok: false, error: conf.problem };
  try {
    const tok = token || (await getGmailAccessToken(conf.cfg));
    const msg = await getMessage(tok, conf.mailbox, gmailId);
    const payload = msg.payload as GmailPartLike | undefined;
    const verdict = gmailIntakeVerdict(payload);
    if (!verdict.ok) {
      const ms0 = Number(msg.internalDate);
      return {
        ok: false,
        notIntake: true,
        error: `not read: ${verdict.reason} (Receiving only reads mail sent to vendor_intake@)`,
        email: {
          provider: "gmail",
          from: gmailHeader(payload, "from") ?? "",
          to: gmailWrittenRecipients(payload),
          subject: gmailHeader(payload, "subject") ?? "",
          receivedAt: Number.isFinite(ms0) && ms0 > 0 ? new Date(ms0).toISOString() : new Date().toISOString(),
          attachments: [],
          messageId: normalizeMessageId(gmailHeader(payload, "message-id")),
          sourceRef: gmailId,
        },
      };
    }
    const walked = walkGmailForIntake(payload);
    const notes: string[] = [`read from Gmail ${conf.mailbox} (message ${gmailId})`];
    if (walked.skippedImages > 0) notes.push(`${walked.skippedImages} inline image(s) skipped`);
    const attachments: NormalizedAttachment[] = [];
    for (const a of walked.attachments.slice(0, MAX_ATTACHMENTS)) {
      if (a.size > MAX_ATTACHMENT_BYTES) {
        notes.push(`attachment ${a.filename} skipped (over 20 MB)`);
        continue;
      }
      try {
        const bytes = await getAttachmentBytes(tok, conf.mailbox, gmailId, a);
        const att = bytesToAttachment(a.filename, a.mimeType || null, Buffer.from(bytes));
        if (att) attachments.push(att);
        else notes.push(`attachment ${a.filename} skipped (too large)`);
      } catch (err) {
        notes.push(`could not fetch attachment ${a.filename}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (walked.attachments.length > MAX_ATTACHMENTS) notes.push(`${walked.attachments.length - MAX_ATTACHMENTS} more attachment(s) not read (cap ${MAX_ATTACHMENTS})`);
    const ms = Number(msg.internalDate);
    const result = await completeInboundEmail({
      provider: "gmail",
      from: gmailHeader(payload, "from") ?? "",
      // Fix 3.5: intakeVerdict passed (To/Cc name vendor_intake@, or a Bcc
      // delivered to it with none of our other addresses on To/Cc), so it routes to intake.
      to: [...new Set([...gmailRecipients(payload), conf.mailbox])],
      subject: gmailHeader(payload, "subject") ?? "",
      receivedAt: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date().toISOString(),
      html: walked.html,
      text: walked.text,
      attachments,
      notes,
      messageId: normalizeMessageId(gmailHeader(payload, "message-id")),
      sourceRef: gmailId,
    });
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: `could not fetch the Gmail message: ${err instanceof Error ? err.message : String(err)}` };
  }
}
