/**
 * src/lib/inbound-email/resend-receiving-fetch.ts  (H14-attachments-fetch)
 *
 * SERVER-ONLY. The network side of the inbound-attachment fix. Given a Resend
 * `email.received` webhook payload (metadata only), this fetches the REAL email
 * content out-of-band and returns a fully-populated NormalizedInboundEmail whose
 * `attachments` actually carry bytes/text — so the existing drafts-only staging
 * (stageManifestsFromEmail) can parse the manifest PDF, invoice PDF, and the WCIA
 * Transfer Data Link JSON.
 *
 * Why the webhook alone isn't enough: Resend's inbound webhook carries no body,
 * headers, or attachment bytes (docs/webhooks/emails/received). We must call:
 *   GET https://api.resend.com/emails/receiving/:email_id            (body + meta)
 *   GET https://api.resend.com/emails/receiving/:email_id/attachments (download_urls)
 * then download each signed `download_url`. We also pull the WCIA Transfer Data
 * Link (.json) out of the email body and fetch it — that single link contains
 * every product + COA, so it is the richest manifest source when the vendor only
 * links (rather than attaches) files, which is exactly what Gmail forwarding does.
 *
 * Auth: raw fetch with `Authorization: Bearer $RESEND_API_KEY`, matching the
 * existing send-side pattern (orders/notify.ts, loyalty/signup.ts, po-notify.ts,
 * newsletter-send-store.ts). No `resend` SDK dependency is added.
 *
 * Fail-soft: if RESEND_API_KEY is unset or any fetch fails, we return the
 * metadata-only email (never throw) so the caller still logs the arrival — the
 * inbound-email panel then shows the email with a note rather than 500-ing the
 * webhook (which would make Resend retry-storm).
 *
 * DRAFTS-ONLY: nothing here activates stock. It only assembles the email so the
 * existing human-reviewed staging path can run.
 */
import "server-only";
import type {
  NormalizedInboundEmail,
  NormalizedAttachment,
} from "@/lib/inbound-email/inbound-normalize-core";
import { parseRecipients } from "@/lib/inbound-email/inbound-normalize-core";
import {
  extractEmailIdFromWebhook,
  extractTransferLinksFromBody,
  mapReceivingAttachments,
  decodeDataUriHtml,
  type ReceivingAttachmentMeta,
} from "@/lib/inbound-email/resend-receiving-core";
import { fetchTransferJson, fetchPdfBytes } from "@/lib/inventory/transfer-fetch";
import { cleanUrl } from "@/lib/inventory/intake-parser";

const RESEND_API = "https://api.resend.com";
const FETCH_TIMEOUT_MS = 20_000;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB per attachment guard.

/** Result of enriching a webhook payload with real content. */
export type EnrichResult = {
  email: NormalizedInboundEmail;
  /** Human-readable trail of what we fetched (for the inbound_email_log note). */
  fetchNote: string;
};

function looksTextualCt(ct: string | null, fn: string | null): boolean {
  const c = (ct ?? "").toLowerCase();
  const f = (fn ?? "").toLowerCase();
  return (
    c.includes("json") ||
    c.includes("text") ||
    c.includes("csv") ||
    c.includes("xml") ||
    /\.(json|csv|txt|xml)$/.test(f)
  );
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

/** GET the received email body + attachment metadata. Returns null on any failure. */
async function getReceivedEmail(
  emailId: string,
  apiKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await timedFetch(`${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) {
      console.error(`[inbound-email] receiving.get ${emailId} -> HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error("[inbound-email] receiving.get failed:", err);
    return null;
  }
}

/** GET the signed attachment download URLs for a received email. Returns [] on failure. */
async function listReceivedAttachments(
  emailId: string,
  apiKey: string,
): Promise<ReceivingAttachmentMeta[]> {
  try {
    const res = await timedFetch(
      `${RESEND_API}/emails/receiving/${encodeURIComponent(emailId)}/attachments`,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
    );
    if (!res.ok) {
      console.error(`[inbound-email] receiving.attachments ${emailId} -> HTTP ${res.status}`);
      return [];
    }
    const body = (await res.json()) as Record<string, unknown>;
    return mapReceivingAttachments(body.data);
  } catch (err) {
    console.error("[inbound-email] receiving.attachments failed:", err);
    return [];
  }
}

/** Download one attachment's bytes from its signed URL -> base64 (+ decoded text when textual). */
async function downloadAttachment(
  meta: ReceivingAttachmentMeta,
): Promise<NormalizedAttachment | null> {
  if (!meta.downloadUrl) return null;
  try {
    const res = await timedFetch(meta.downloadUrl, { method: "GET" });
    if (!res.ok) {
      console.error(`[inbound-email] attachment ${meta.id} download -> HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
      console.warn(`[inbound-email] attachment ${meta.id} too large (${buf.byteLength} bytes) — skipped`);
      return null;
    }
    const base64 = buf.toString("base64");
    const text = looksTextualCt(meta.contentType, meta.filename) ? buf.toString("utf8") : null;
    return { filename: meta.filename, contentType: meta.contentType, text, base64 };
  } catch (err) {
    console.error(`[inbound-email] attachment ${meta.id} download failed:`, err);
    return null;
  }
}

/**
 * Enrich a Resend `email.received` webhook payload into a NormalizedInboundEmail
 * with real content. NEVER throws — on any failure it falls back to a
 * metadata-only email so the arrival is still logged and the webhook returns 200.
 */
export async function enrichResendInbound(
  raw: Record<string, unknown>,
): Promise<EnrichResult> {
  const data =
    raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : raw;

  // Baseline metadata email (what the old code produced). We upgrade it below.
  const baseFrom = typeof data.from === "string" ? data.from : "";
  const baseTo = parseRecipients(data.to);
  const baseSubject = typeof data.subject === "string" ? data.subject : "";
  const baseReceivedAt =
    typeof data.created_at === "string"
      ? data.created_at
      : typeof raw.created_at === "string"
        ? raw.created_at
        : new Date().toISOString();

  const metadataOnly: NormalizedInboundEmail = {
    provider: "resend",
    from: baseFrom.trim(),
    to: baseTo,
    subject: baseSubject,
    receivedAt: baseReceivedAt,
    attachments: [],
  };

  const apiKey = process.env.RESEND_API_KEY ?? "";
  const emailId = extractEmailIdFromWebhook(raw);
  if (!apiKey) {
    return {
      email: metadataOnly,
      fetchNote: "RESEND_API_KEY not set — could not fetch email body/attachments",
    };
  }
  if (!emailId) {
    return { email: metadataOnly, fetchNote: "webhook had no email_id — nothing to fetch" };
  }

  const notes: string[] = [];

  // 1) Body + authoritative from/to/subject.
  const full = await getReceivedEmail(emailId, apiKey);
  const from = full && typeof full.from === "string" ? full.from : baseFrom;
  const to = full ? parseRecipients(full.to) : baseTo;
  const subject = full && typeof full.subject === "string" ? full.subject : baseSubject;
  const html = full ? decodeDataUriHtml((full.html as string) ?? null) : "";
  const text = full && typeof full.text === "string" ? full.text : "";

  const attachments: NormalizedAttachment[] = [];

  // 2) MIME attachments the email actually carried (direct sends usually have these).
  const attMetas = await listReceivedAttachments(emailId, apiKey);
  let fetched = 0;
  for (const meta of attMetas) {
    const att = await downloadAttachment(meta);
    if (att) {
      attachments.push(att);
      fetched += 1;
    }
  }
  if (attMetas.length > 0) {
    notes.push(`downloaded ${fetched}/${attMetas.length} attachment(s)`);
  }

  // 3) The WCIA Transfer Data Link (.json) + invoice/manifest links from the body.
  //    Gmail-forwarded vendor emails typically carry these as LINKS, not files —
  //    this is the fix for "forwarded shows 0 attachments". The .json is richest.
  const links = extractTransferLinksFromBody(html, text);
  if (links.transferJsonUrl) {
    const cleaned = cleanUrl(links.transferJsonUrl) ?? links.transferJsonUrl;
    // Only fetch if we don't already have a JSON manifest attachment.
    const alreadyHaveJson = attachments.some(
      (a) => (a.contentType ?? "").toLowerCase().includes("json") && a.text != null,
    );
    if (!alreadyHaveJson) {
      const res = await fetchTransferJson(cleaned);
      if (res.ok) {
        attachments.push({
          filename: filenameFromUrl(cleaned) ?? "transfer.json",
          contentType: "application/json",
          text: res.jsonText,
          base64: Buffer.from(res.jsonText, "utf8").toString("base64"),
        });
        notes.push("fetched WCIA Transfer Data Link JSON");
      } else {
        notes.push(`transfer link found but fetch failed (${res.error})`);
      }
    }
  }
  if (links.invoiceUrl) notes.push(`invoice link: ${links.invoiceUrl}`);
  if (links.manifestUrl) notes.push(`manifest link: ${links.manifestUrl}`);

  // 4) LINK-ONLY PDF FALLBACK (H16b-6). When the WCIA transfer JSON is dead or
  //    absent AND the email carried no usable PDF/JSON attachment (Gmail
  //    forwarding stripped the files but left the "download the invoice/manifest"
  //    links), fetch those PDF links server-side and add them as attachments so
  //    staging can parse + merge them exactly like a direct send. We only reach
  //    for this fallback when we don't already have something parseable, to avoid
  //    duplicate work on healthy direct-send emails.
  const haveParseableAttachment = attachments.some((a) => {
    const ct = (a.contentType ?? "").toLowerCase();
    if (ct.includes("json") && a.text != null) return true;
    if (ct.includes("pdf") && a.base64) return true;
    return false;
  });
  if (!haveParseableAttachment) {
    for (const [label, rawLink] of [
      ["manifest", links.manifestUrl],
      ["invoice", links.invoiceUrl],
    ] as const) {
      if (!rawLink) continue;
      const cleanedLink = cleanUrl(rawLink) ?? rawLink;
      const pdf = await fetchPdfBytes(cleanedLink);
      if (pdf.ok) {
        attachments.push({
          filename: filenameFromUrl(cleanedLink) ?? `${label}.pdf`,
          contentType: pdf.contentType || "application/pdf",
          text: null,
          base64: pdf.base64,
        });
        notes.push(`fetched ${label} PDF from link (${pdf.bytes} bytes)`);
      } else {
        notes.push(`${label} link found but PDF fetch failed (${pdf.error})`);
      }
    }
  }

  const email: NormalizedInboundEmail = {
    provider: "resend",
    from: (from || "").trim(),
    to: to.length > 0 ? to : baseTo,
    subject: subject || baseSubject,
    receivedAt: baseReceivedAt,
    attachments,
  };

  return {
    email,
    fetchNote: notes.length > 0 ? notes.join("; ") : "no attachments or transfer link found",
  };
}

function filenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last && last.length > 0 ? last : null;
  } catch {
    return null;
  }
}
