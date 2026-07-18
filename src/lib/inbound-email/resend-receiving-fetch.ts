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
import { parseRecipients, classifyAttachmentRole } from "@/lib/inbound-email/inbound-normalize-core";
import {
  extractEmailIdFromWebhook,
  extractTransferLinksFromBody,
  extractAllTransferLinksFromBody,
  mapReceivingAttachments,
  decodeDataUriHtml,
  planLinkPdfFetches,
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

  // 3) The WCIA Transfer Data Link(s) (.json / tokenized endpoint) + invoice /
  //    manifest links from the body. Gmail-forwarded vendor emails typically
  //    carry these as LINKS, not files — this is the fix for "forwarded shows 0
  //    attachments". The transfer JSON is the richest source.
  //
  //    H16b-8(b) MULTI-VENDOR: one email can bundle SEVERAL distinct vendor
  //    transfers as multiple body links (the real Lilac / Kush Family / Mako
  //    edge case — the old single-link picker grabbed only Lilac). We now
  //    harvest EVERY recognized transfer link and fetch each as its own JSON
  //    attachment, so stageManifestsFromEmail stages ONE manifest per transfer.
  //    The H16b-7 dedupe guard protects against an accidental duplicate; genuine
  //    distinct transfers carry distinct manifest numbers and all stage.
  const links = extractTransferLinksFromBody(html, text);
  const allTransferLinks = extractAllTransferLinksFromBody(html, text);
  // Only fetch transfer JSON links if we don't already have a JSON manifest
  // attachment from a real MIME attachment (a healthy direct send).
  const alreadyHaveJson = attachments.some(
    (a) => (a.contentType ?? "").toLowerCase().includes("json") && a.text != null,
  );
  if (!alreadyHaveJson && allTransferLinks.length > 0) {
    // De-dupe by the CLEANED URL (collapses the doubled-prefix link bug) so the
    // same transfer echoed as anchor + plaintext is fetched once.
    const seen = new Set<string>();
    let fetchedTransfers = 0;
    let idx = 0;
    for (const rawLink of allTransferLinks) {
      const cleaned = cleanUrl(rawLink) ?? rawLink;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      const res = await fetchTransferJson(cleaned);
      if (res.ok) {
        // Guarantee a distinct filename even for two GrowFlow endpoints that
        // both resolve to a path ending in "transfer" (no per-link filename).
        const base = filenameFromUrl(cleaned) ?? "transfer";
        const filename = base.toLowerCase().endsWith(".json")
          ? base
          : `${base}-${idx + 1}.json`;
        attachments.push({
          filename,
          contentType: "application/json",
          text: res.jsonText,
          base64: Buffer.from(res.jsonText, "utf8").toString("base64"),
        });
        fetchedTransfers += 1;
      } else {
        notes.push(`transfer link found but fetch failed (${res.error})`);
      }
      idx += 1;
    }
    if (fetchedTransfers > 0) {
      notes.push(
        fetchedTransfers === 1
          ? "fetched WCIA Transfer Data Link JSON"
          : `fetched ${fetchedTransfers} WCIA Transfer Data Link JSONs (multi-vendor email)`,
      );
    }
  }
  if (links.invoiceUrl) notes.push(`invoice link: ${links.invoiceUrl}`);
  if (links.manifestUrl) notes.push(`manifest link: ${links.manifestUrl}`);

  // 4) LINKED-PDF FETCH (H18, supersedes the H16b-6 "only when nothing
  //    parseable" guard). THE PRODUCTION BUG: the real Cultivera email LINKS
  //    (not attaches) everything, so once the WCIA transfer JSON was fetched
  //    above, the old guard skipped the manifest PDF link — the ONLY document
  //    carrying driver / vehicle / plate / VIN (the JSON's transporter fields
  //    are null). Result: transport stayed empty on the review form while the
  //    JSON's est-times/route filled. Now each linked document is fetched
  //    INDEPENDENTLY whenever no PDF attachment of that ROLE exists yet
  //    (mirroring the COA always-fetch pattern below), and the bytes are
  //    stored under a role-classifying filename so staging can parse the
  //    manifest PDF as a transport donor / the invoice PDF as a price+transport
  //    donor. Healthy direct sends (real MIME PDFs) plan nothing — no dup work.
  for (const planned of planLinkPdfFetches(attachments, links)) {
    const cleanedLink = cleanUrl(planned.url) ?? planned.url;
    const pdf = await fetchPdfBytes(cleanedLink);
    if (pdf.ok) {
      // Prefer the URL's own filename when it already classifies as the
      // planned role; otherwise force the role-classifying name.
      const urlName = filenameFromUrl(cleanedLink);
      const filename =
        urlName &&
        classifyAttachmentRole({ filename: urlName, contentType: null, text: null, base64: null }) ===
          planned.label
          ? urlName
          : planned.filename;
      attachments.push({
        filename,
        contentType: pdf.contentType || "application/pdf",
        text: null,
        base64: pdf.base64,
      });
      notes.push(`fetched ${planned.label} PDF from link (${pdf.bytes} bytes)`);
    } else {
      notes.push(`${planned.label} link found but PDF fetch failed (${pdf.error})`);
    }
  }

  // 5) COA LINK FALLBACK (H16b-3). Independently of the manifest/invoice
  //    fallback above, if the body offers a COA / lab-results DOWNLOAD link and
  //    the email carried no COA-role attachment, fetch it server-side and add it
  //    so staging reads + merges its potency/PASS/expiry by Lot ID and archives
  //    the certificate (H16b-2). We ALWAYS try this when a COA is missing —
  //    even on an otherwise-healthy manifest send — because a COA is a distinct
  //    document from the manifest/invoice and its absence is what we're fixing.
  const haveCoaAttachment = attachments.some(
    (a) => classifyAttachmentRole(a) === "coa",
  );
  if (!haveCoaAttachment && links.coaUrl) {
    const cleanedCoa = cleanUrl(links.coaUrl) ?? links.coaUrl;
    const pdf = await fetchPdfBytes(cleanedCoa);
    if (pdf.ok) {
      // Force a COA-classifying filename so classifyAttachmentRole tags it "coa"
      // regardless of the signed-URL path (a generic path would misclassify).
      const urlName = filenameFromUrl(cleanedCoa);
      const filename =
        urlName && classifyAttachmentRole({ filename: urlName, contentType: null, text: null, base64: null }) === "coa"
          ? urlName
          : "coa.pdf";
      attachments.push({
        filename,
        contentType: pdf.contentType || "application/pdf",
        text: null,
        base64: pdf.base64,
      });
      notes.push(`fetched coa PDF from link (${pdf.bytes} bytes)`);
    } else {
      notes.push(`coa link found but PDF fetch failed (${pdf.error})`);
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
