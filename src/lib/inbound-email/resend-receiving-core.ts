/**
 * src/lib/inbound-email/resend-receiving-core.ts  (H14-attachments-fetch)
 *
 * PURE, I/O-free helpers for turning Resend's INBOUND ("receiving") API responses
 * into the same shapes the rest of the inbound pipeline already understands, plus
 * link extraction from the email body. No SDK, no `server-only`, no network — so
 * this is unit-testable with tsx (run via __runResendReceivingTests).
 *
 * WHY THIS EXISTS
 * ---------------
 * Resend's `email.received` webhook is METADATA ONLY — it carries no body, no
 * headers, and no attachment bytes (see docs/webhooks/emails/received: "Webhooks
 * do not include the email body, headers, or attachments, only their metadata.
 * You must call the Received emails API or the Attachments API to retrieve
 * them."). The prior Slice-99 normalizer assumed the webhook body contained
 * inline base64 `content`, which the real API never provides. The result: real
 * inbound mail (including Gmail-forwarded vendor emails) logged with 0
 * attachments / "no manifest".
 *
 * The fix fetches the real content out-of-band via two documented endpoints:
 *   GET https://api.resend.com/emails/receiving/:email_id
 *       -> { id, from, to[], subject, html, html_format, text, headers,
 *            received_for[], attachments:[{id,filename,content_type,...}] }
 *   GET https://api.resend.com/emails/receiving/:email_id/attachments
 *       -> { object:"list", data:[{id,filename,content_type,download_url,...}] }
 * then downloads each attachment's signed `download_url` to bytes.
 *
 * This module does the PURE parts:
 *   1) extractEmailIdFromWebhook   — pull data.email_id from the webhook payload.
 *   2) extractTransferLinksFromBody — find the WCIA "Transfer Data Link" (.json
 *      import URL) + invoice/manifest "download here" links in the html/text body.
 *   3) mapReceivingAttachments      — receiving-API attachment metadata -> a plain
 *      shape the fetcher fills with bytes.
 *   4) decodeDataUriHtml            — Resend serves inline images as data: URIs and
 *      can serve the whole html body as a data_uri; normalize to plain HTML text.
 *
 * The server-only fetcher (resend-receiving-fetch.ts) does the network I/O and
 * assembles a NormalizedInboundEmail from these pieces.
 */

/** The WCIA Transfer Data Link + the invoice/manifest download links found in a body. */
export type ExtractedTransferLinks = {
  /** The WCIA Transfer Data Link — a Cultivera .json import URL (the full manifest). */
  transferJsonUrl: string | null;
  /** "Click here to download the invoice" href, when present. */
  invoiceUrl: string | null;
  /** "Click here to download the manifest" href, when present. */
  manifestUrl: string | null;
  /**
   * A COA / lab-results download link, when the body offers one instead of
   * attaching the PDF (H16b-3). Matched on COA-ish anchor text ("COA", "lab
   * results", "certificate of analysis", "lab"). Never the WCIA transfer JSON.
   */
  coaUrl: string | null;
};

/** Attachment metadata from Resend's receiving API, pre-download. PURE shape. */
export type ReceivingAttachmentMeta = {
  id: string;
  filename: string | null;
  contentType: string | null;
  /** Signed CDN URL to download the bytes (valid ~1hr). */
  downloadUrl: string | null;
};

/**
 * Pull the received-email id out of a Resend `email.received` webhook payload.
 * Tolerates both the documented `data.email_id` and a couple of plausible
 * aliases (`data.id`, top-level `email_id`) so a minor payload change doesn't
 * silently break the fetch. Returns null when nothing usable is present. PURE.
 */
export function extractEmailIdFromWebhook(raw: Record<string, unknown>): string | null {
  const data =
    raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : {};
  const candidates = [data.email_id, data.id, raw.email_id, raw.id];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/**
 * If a string is a `data:...;base64,....` or `data:...,<url-encoded>` URI (the
 * form Resend uses when `html_format` is the default `data_uri`), decode it to
 * plain text. Otherwise return the string unchanged. PURE (Node Buffer only).
 */
export function decodeDataUriHtml(value: string | null | undefined): string {
  const s = typeof value === "string" ? value : "";
  if (!s.startsWith("data:")) return s;
  const comma = s.indexOf(",");
  if (comma === -1) return s;
  const meta = s.slice(5, comma); // between "data:" and ","
  const payload = s.slice(comma + 1);
  try {
    if (/;base64/i.test(meta)) {
      return Buffer.from(payload, "base64").toString("utf8");
    }
    return decodeURIComponent(payload);
  } catch {
    return s;
  }
}

// A WCIA "Transfer Data Link" points at the full transfer JSON. Different vendor
// back-office systems serve that link three verified ways (all confirmed against
// real Greenway vendor emails):
//   1) Cultivera / SUBX:  https://files.cultivera.com/<id>/import/<n>/<file>_ORD-<order>_<license>.json
//   2) OpenTHC ("old"):   https://app.openfhc.com/pub/b2b/<id>/wcia.json
//   3) GrowFlow:          https://go.growflow.com/wa/wcia/transfer?token=<token>   (NO .json extension)
// (1) and (2) end in `.json`; (3) is a tokenized endpoint that returns raw WCIA
// JSON 2.1.0 when fetched (owner verified: opening it shows raw JSON). So we can
// no longer require a `.json` extension — we must also match known WCIA transfer
// endpoints. The fetch layer (fetchTransferJson) fetches any URL and validates by
// JSON.parse, so once the link is *found* here, all three vendors flow through.
//
// The link also arrives doubled sometimes (https://host/https://host/...);
// callers collapse it with cleanUrl before fetching.
const JSON_URL_RE = /https?:\/\/[^\s"'<>()]+\.json(?:\?[^\s"'<>()]*)?/gi;
// Known WCIA transfer endpoints that serve JSON without a `.json` extension.
// Matched on the URL path so query strings/tokens are included. Extensible: add
// new vendor endpoint shapes here as they are verified against a real email.
const WCIA_ENDPOINT_RE =
  /https?:\/\/[^\s"'<>()]*\/(?:wa\/)?wcia\/transfer\?[^\s"'<>()]+/gi;
const ANY_URL_RE = /https?:\/\/[^\s"'<>()]+/gi;

// Hosts/paths we recognize as WCIA transfer sources. Used to PREFER a real
// transfer link over an unrelated `.json` (e.g. a tracking-pixel config).
// Verified vendors: Cultivera (files.cultivera.com), WCIA, WeComply, LeafTrack,
// GrowFlow (go.growflow.com), OpenTHC (app.openfhc.com / openthc.pub).
function hostLooksVendor(url: string): boolean {
  return /cultivera|wcia|wecomply|leaftrack|growflow|openfhc|openthc/i.test(url);
}

/**
 * Extract the WCIA Transfer Data Link and the invoice/manifest download links
 * from an email body. Accepts BOTH the HTML body (preferred — anchors carry the
 * real hrefs) and the plaintext body (fallback). PURE.
 *
 * Strategy, grounded in the real vendor email:
 *  - transferJsonUrl: the first https URL ending in `.json`. Prefer a vendor host
 *    (cultivera/wcia). This is the single link that contains every product + COA.
 *  - invoiceUrl / manifestUrl: the href of the anchor whose visible text or
 *    surrounding words mention "invoice"/"manifest" (the "Click here to download
 *    the invoice/manifest." lines). Best-effort; may be null when forwarding
 *    strips them.
 */
/**
 * H16b-8(b) — harvest EVERY distinct WCIA Transfer Data Link in a body, not just
 * the single best one. One vendor email sometimes bundles THREE different vendor
 * transfers as three body links (the real Lilac / Kush Family / Mako edge case:
 * a Cultivera `.json` + two GrowFlow `.../wcia/transfer?token=` endpoints). The
 * old single-link picker returned only the first, silently dropping the other
 * two transfers. This returns all recognized transfer links, order-preserved and
 * de-duplicated, so the caller can fetch + stage one manifest PER transfer.
 *
 * A link qualifies as a transfer link when it is EITHER a `.json` URL OR a WCIA
 * transfer endpoint AND its host is a recognized vendor. We intentionally do NOT
 * include unrelated `.json` URLs (tracking-pixel configs, etc.) here — the
 * single-link picker keeps its last-resort "any .json" fallback for the common
 * one-transfer email, but the multi-link harvest must be conservative so we
 * never fan out staging on noise. PURE.
 */
export function extractAllTransferLinksFromBody(
  html: string | null | undefined,
  text: string | null | undefined,
): string[] {
  const htmlStr = decodeDataUriHtml(html);
  const textStr = typeof text === "string" ? text : "";
  const combined = `${htmlStr}\n${textStr}`;

  const jsonMatches = (combined.match(JSON_URL_RE) ?? []).map(stripTrailingPunct);
  const endpointMatches = (combined.match(WCIA_ENDPOINT_RE) ?? []).map(stripTrailingPunct);

  // Only VENDOR-recognized links are treated as distinct transfers to fan out on.
  // Order-preserve as they appear (json first, then endpoints — matching how the
  // single-link picker prioritizes), de-duplicated.
  const vendorLinks = [...jsonMatches, ...endpointMatches].filter(hostLooksVendor);
  return Array.from(new Set(vendorLinks));
}

export function extractTransferLinksFromBody(
  html: string | null | undefined,
  text: string | null | undefined,
): ExtractedTransferLinks {
  const htmlStr = decodeDataUriHtml(html);
  const textStr = typeof text === "string" ? text : "";
  const combined = `${htmlStr}\n${textStr}`;

  // 1) Transfer Data Link — accept BOTH `.json` URLs (Cultivera, OpenTHC) AND
  //    known WCIA transfer endpoints that serve JSON without a `.json` extension
  //    (GrowFlow's `.../wcia/transfer?token=...`). Prefer a recognized vendor
  //    link; among those, prefer a `.json` (richest/most direct) over an endpoint,
  //    else fall back to the first candidate found.
  let transferJsonUrl: string | null = null;
  const jsonMatches = (combined.match(JSON_URL_RE) ?? []).map(stripTrailingPunct);
  const endpointMatches = (combined.match(WCIA_ENDPOINT_RE) ?? []).map(
    stripTrailingPunct,
  );
  // De-dupe while preserving order; a URL can match both regexes only rarely.
  const allCandidates = Array.from(new Set([...jsonMatches, ...endpointMatches]));
  transferJsonUrl =
    // Priority (most trustworthy first):
    //   1) a vendor-recognized `.json` (Cultivera / OpenTHC — the direct file),
    //   2) a vendor-recognized transfer endpoint (GrowFlow token URL),
    //   3) any transfer endpoint (structurally a WCIA transfer, even if the host
    //      isn't on our vendor list yet — still beats an unrelated `.json`),
    //   4) any `.json` at all (last-resort fallback),
    //   5) the first candidate found.
    jsonMatches.find(hostLooksVendor) ??
    endpointMatches.find(hostLooksVendor) ??
    endpointMatches[0] ??
    jsonMatches[0] ??
    allCandidates[0] ??
    null;

  // 2) invoice / manifest DOWNLOAD links (PDFs). Prefer parsing HTML anchors so we
  //    read the real href behind the word "here"; fall back to nearby-URL
  //    heuristics on text.
  //
  //    CRITICAL (H15-PRE-b): the invoice/manifest links are meant to be the
  //    downloadable PDFs, NOT the WCIA transfer JSON. In some vendor emails (e.g.
  //    High End Farms / OpenTHC) the body reads "...The invoice and lab COAs are
  //    attached." immediately before the "JSON link:" anchor, so a naive keyword
  //    window would return the transfer .json URL as the "invoice" link — which is
  //    why clicking Invoice in the back office opened raw JSON. We exclude the
  //    transfer link (and any WCIA transfer URL) from the invoice/manifest results.
  const excluded = new Set<string>();
  if (transferJsonUrl) excluded.add(transferJsonUrl);
  const invoiceUrl = findLabeledLink(htmlStr, textStr, "invoice", excluded);
  const manifestUrl = findLabeledLink(htmlStr, textStr, "manifest", excluded);

  // 3) COA / lab-results DOWNLOAD link (H16b-3). Some vendor emails link the
  //    lab COAs rather than attaching them. Exclude the invoice/manifest URLs we
  //    already claimed so a shared "here" anchor isn't double-counted. Try the
  //    most specific COA phrasing first, then broaden to "lab".
  const coaExcluded = new Set(excluded);
  if (invoiceUrl) coaExcluded.add(invoiceUrl);
  if (manifestUrl) coaExcluded.add(manifestUrl);
  const coaUrl =
    findLabeledLink(htmlStr, textStr, "certificate of analysis", coaExcluded) ??
    findLabeledLink(htmlStr, textStr, "lab results", coaExcluded) ??
    findLabeledLink(htmlStr, textStr, "coa", coaExcluded) ??
    findLabeledLink(htmlStr, textStr, "lab", coaExcluded);

  return { transferJsonUrl, invoiceUrl, manifestUrl, coaUrl };
}

/** Trim trailing punctuation that regexes commonly over-capture (., ), etc.). */
function stripTrailingPunct(u: string): string {
  return u.replace(/[.,;:)\]}>'"]+$/, "");
}

/**
 * Find the href of a download link associated with `keyword` (invoice|manifest).
 * Reads HTML <a href> anchors first: an anchor counts when the keyword appears in
 * the anchor text OR within ~60 chars before the anchor (covers "Click here to
 * download the invoice." where "here" is the anchor text). Falls back to scanning
 * the plaintext for a URL on/adjacent to a line mentioning the keyword.
 */
function findLabeledLink(
  html: string,
  text: string,
  keyword: string,
  excluded?: Set<string>,
): string | null {
  const kw = keyword.toLowerCase();

  // A labeled invoice/manifest link must be a downloadable document, NOT the WCIA
  // transfer data (a `.json` file or a `.../wcia/transfer?...` endpoint). Reject
  // those and anything explicitly excluded (e.g. the already-chosen transfer link).
  const isUsable = (url: string): boolean => {
    const clean = stripTrailingPunct(url);
    if (!/^https?:\/\//i.test(clean)) return false;
    if (excluded?.has(clean)) return false;
    if (isWciaTransferUrl(clean)) return false;
    return true;
  };

  // HTML anchors with context window.
  // Note: [\s\S] instead of the `s` (dotAll) flag — the project's TS target
  // predates es2018, so the `s` flag isn't available.
  const anchorRe = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1];
    const inner = stripTags(m[2]).toLowerCase();
    const start = m.index;
    const end = m.index + m[0].length;
    // "Click here to download the invoice." puts the keyword AFTER the anchor,
    // so scan a window on both sides of the <a>...</a> (plus the anchor text).
    const before = html.slice(Math.max(0, start - 60), start).toLowerCase();
    const after = html.slice(end, Math.min(html.length, end + 60)).toLowerCase();
    if (
      (inner.includes(kw) || before.includes(kw) || after.includes(kw)) &&
      isUsable(href)
    ) {
      return stripTrailingPunct(href);
    }
  }

  // Plaintext fallback: a URL on a line that mentions the keyword.
  for (const line of text.split(/\r?\n/)) {
    if (!line.toLowerCase().includes(kw)) continue;
    const urls = line.match(ANY_URL_RE) ?? [];
    for (const url of urls) {
      if (isUsable(url)) return stripTrailingPunct(url);
    }
  }
  return null;
}

/**
 * True when a URL is a WCIA transfer-data link (the manifest JSON), not a
 * downloadable invoice/manifest PDF. Covers both `.json` files and tokenized
 * transfer endpoints (GrowFlow). PURE.
 */
function isWciaTransferUrl(url: string): boolean {
  const clean = stripTrailingPunct(url);
  if (/\.json(?:\?|$)/i.test(clean)) return true;
  if (/\/(?:wa\/)?wcia\/transfer\?/i.test(clean)) return true;
  return false;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").trim();
}

/**
 * Map the `data[]` array from the receiving Attachments API into our pre-download
 * shape. Skips entries with no id. PURE.
 */
export function mapReceivingAttachments(apiListData: unknown): ReceivingAttachmentMeta[] {
  const arr = Array.isArray(apiListData) ? apiListData : [];
  const out: ReceivingAttachmentMeta[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const id = typeof a.id === "string" ? a.id : null;
    if (!id) continue;
    out.push({
      id,
      filename: typeof a.filename === "string" ? a.filename : null,
      contentType: typeof a.content_type === "string" ? a.content_type : null,
      downloadUrl: typeof a.download_url === "string" ? a.download_url : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx). PURE — no I/O.
// ---------------------------------------------------------------------------
export function __runResendReceivingTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  // extractEmailIdFromWebhook
  ok(
    extractEmailIdFromWebhook({ type: "email.received", data: { email_id: "abc-123" } }) ===
      "abc-123",
    "email_id from data.email_id",
  );
  ok(
    extractEmailIdFromWebhook({ data: { id: "xyz" } }) === "xyz",
    "email_id falls back to data.id",
  );
  ok(extractEmailIdFromWebhook({ data: {} }) === null, "no email_id -> null");

  // decodeDataUriHtml
  const b64 = Buffer.from("<p>Hello</p>", "utf8").toString("base64");
  ok(
    decodeDataUriHtml(`data:text/html;base64,${b64}`) === "<p>Hello</p>",
    "decode base64 data uri",
  );
  ok(
    decodeDataUriHtml("data:text/html,%3Cp%3EHi%3C%2Fp%3E") === "<p>Hi</p>",
    "decode url-encoded data uri",
  );
  ok(decodeDataUriHtml("<p>plain</p>") === "<p>plain</p>", "plain html passthrough");
  ok(decodeDataUriHtml(null) === "", "null html -> empty");

  // extractTransferLinksFromBody — grounded in the REAL vendor email layout.
  const realHtml = `
    <p>Dear Greenway Marijuana,</p>
    <p>Attached is the final invoice for Order# - 17635 from SUBX.</p>
    <p>Copy and paste the following
      <a href="https://files.cultivera.com/4355253420573363534/import/2621/M93YNE081YSEODZA/Cultivera_ORD-17635_413541.json">WCIA Transfer Data Link</a>
      into your system to import your order:</p>
    <p>https://files.cultivera.com/4355253420573363534/import/2621/M93YNE081YSEODZA/Cultivera_ORD-17635_413541.json</p>
    <p>Click <a href="https://files.cultivera.com/dl/invoice/2796.pdf">here</a> to download the invoice.</p>
    <p>Click <a href="https://files.cultivera.com/dl/manifest/2796.pdf">here</a> to download the manifest.</p>
  `;
  const links = extractTransferLinksFromBody(realHtml, null);
  ok(
    links.transferJsonUrl ===
      "https://files.cultivera.com/4355253420573363534/import/2621/M93YNE081YSEODZA/Cultivera_ORD-17635_413541.json",
    "transfer .json link extracted",
  );
  ok(
    links.invoiceUrl === "https://files.cultivera.com/dl/invoice/2796.pdf",
    "invoice download link extracted from anchor context",
  );
  ok(
    links.manifestUrl === "https://files.cultivera.com/dl/manifest/2796.pdf",
    "manifest download link extracted from anchor context",
  );

  // Plaintext fallback (forwarded emails sometimes deliver only text).
  const textOnly = [
    "Copy and paste the following WCIA Transfer Data Link into your system:",
    "https://files.cultivera.com/abc/import/9/Cultivera_ORD-1_413541.json",
    "Click here to download the invoice. https://x.cultivera.com/inv/1.pdf",
    "Click here to download the manifest. https://x.cultivera.com/man/1.pdf",
  ].join("\n");
  const tlinks = extractTransferLinksFromBody(null, textOnly);
  ok(tlinks.transferJsonUrl?.endsWith(".json") === true, "text: transfer json found");
  ok(tlinks.invoiceUrl === "https://x.cultivera.com/inv/1.pdf", "text: invoice url found");
  ok(tlinks.manifestUrl === "https://x.cultivera.com/man/1.pdf", "text: manifest url found");

  // Trailing punctuation is stripped (json URL followed by a period).
  const punct = extractTransferLinksFromBody(
    "See https://files.cultivera.com/a/b/c.json.",
    null,
  );
  ok(punct.transferJsonUrl === "https://files.cultivera.com/a/b/c.json", "trailing period stripped");

  // Prefer a vendor host over an unrelated .json.
  const twoJson = extractTransferLinksFromBody(
    "cfg https://cdn.example.com/tracking.json and https://files.cultivera.com/real.json",
    null,
  );
  ok(twoJson.transferJsonUrl === "https://files.cultivera.com/real.json", "vendor host preferred");

  // GrowFlow: tokenized WCIA endpoint with NO `.json` extension. Verified from a
  // real Greenway GrowFlow order email ("New order INV-29127"); opening the link
  // shows raw WCIA JSON 2.1.0. This is the format that PARSE FAILED before H15-PRE-a.
  const growflowHtml = `
    <div>growflow</div>
    <p>Please find the transfer documentation from Green Labs for INV-29127 attached.</p>
    <p><strong>WCIA Transfer Data Link (JSON):</strong></p>
    <p>Copy entire link in the box below and paste into your system</p>
    <p>https://go.growflow.com/wa/wcia/transfer?token=EAAAAAITSbL7TP6d2qbsaRvzc2l0Oh8vN2Fa0k</p>
  `;
  const gf = extractTransferLinksFromBody(growflowHtml, null);
  ok(
    gf.transferJsonUrl ===
      "https://go.growflow.com/wa/wcia/transfer?token=EAAAAAITSbL7TP6d2qbsaRvzc2l0Oh8vN2Fa0k",
    "growflow tokenized transfer endpoint (no .json) extracted",
  );

  // GrowFlow endpoint present as an anchor href (HTML anchor form).
  const gfAnchor = extractTransferLinksFromBody(
    `<a href="https://go.growflow.com/wa/wcia/transfer?token=ABC123">WCIA Transfer Data Link</a>`,
    null,
  );
  ok(
    gfAnchor.transferJsonUrl ===
      "https://go.growflow.com/wa/wcia/transfer?token=ABC123",
    "growflow transfer endpoint from anchor href extracted",
  );

  // OpenTHC / High End Farms "old method": `.json` on a non-Cultivera host.
  // Verified from a real "High End Farms Delivery 4/29" email. Must be treated as
  // a vendor transfer link (host is now recognized), not passed over.
  const openThcText = [
    "Your order is scheduled to be delivered Wednesday, 4/29. The invoice and lab COAs are attached.",
    "JSON link: https://app.openfhc.com/pub/b2b/01KQ7GS6EXA3DV5MSHHXWVAZRB/wcia.json",
    "Order total: $1,146.00",
  ].join("\n");
  const oth = extractTransferLinksFromBody(null, openThcText);
  ok(
    oth.transferJsonUrl ===
      "https://app.openfhc.com/pub/b2b/01KQ7GS6EXA3DV5MSHHXWVAZRB/wcia.json",
    "openthc .json transfer link extracted",
  );
  ok(hostLooksVendor(oth.transferJsonUrl ?? "") === true, "openthc host recognized as vendor");

  // Prefer a real `.json` over a GrowFlow endpoint when both appear (json is the
  // most direct/richest); and prefer the transfer endpoint over an unrelated json.
  const mixPref = extractTransferLinksFromBody(
    "cfg https://cdn.example.com/tracking.json see https://go.growflow.com/wa/wcia/transfer?token=Z9",
    null,
  );
  ok(
    mixPref.transferJsonUrl === "https://go.growflow.com/wa/wcia/transfer?token=Z9",
    "growflow endpoint preferred over unrelated tracking.json",
  );

  // No links at all -> all null.
  const none = extractTransferLinksFromBody("<p>Just a note, no links.</p>", null);
  ok(
    none.transferJsonUrl === null && none.invoiceUrl === null && none.manifestUrl === null,
    "no links -> nulls",
  );

  // extractAllTransferLinksFromBody (H16b-8b) — the REAL 3-vendor edge case:
  // ONE email from Alec (Cascade Green Distribution) bundling THREE distinct
  // vendor transfers as three body links (Lilac Labs = Cultivera .json; Kush
  // Family Originals + Mako Farms = GrowFlow tokenized endpoints). The old
  // single-link picker returned only Lilac; this must return all three.
  const threeVendorHtml = `
    <p>Hi Greenway, here are three transfers for delivery:</p>
    <p>Lilac Labs: <a href="https://files.cultivera.com/aaa/import/1/Cultivera_ORD-7208_413541.json">Transfer Data Link</a></p>
    <p>Kush Family Originals: <a href="https://go.growflow.com/wa/wcia/transfer?token=KUSHTOKEN111">Transfer Data Link</a></p>
    <p>Mako Farms: <a href="https://go.growflow.com/wa/wcia/transfer?token=MAKOTOKEN222">Transfer Data Link</a></p>
  `;
  const allLinks = extractAllTransferLinksFromBody(threeVendorHtml, null);
  ok(allLinks.length === 3, "three distinct vendor transfers harvested");
  ok(
    allLinks.includes("https://files.cultivera.com/aaa/import/1/Cultivera_ORD-7208_413541.json"),
    "harvest includes Lilac Cultivera .json",
  );
  ok(
    allLinks.includes("https://go.growflow.com/wa/wcia/transfer?token=KUSHTOKEN111"),
    "harvest includes Kush GrowFlow endpoint",
  );
  ok(
    allLinks.includes("https://go.growflow.com/wa/wcia/transfer?token=MAKOTOKEN222"),
    "harvest includes Mako GrowFlow endpoint",
  );
  // json listed before endpoints (order-preserved by regex group).
  ok(allLinks[0].endsWith(".json"), "harvest lists the .json first");

  // De-dupe: the same transfer link repeated (anchor href + plaintext echo) is
  // returned once — so we never stage the same transfer twice from one email.
  const dupEcho = extractAllTransferLinksFromBody(
    `<a href="https://files.cultivera.com/x/Cultivera_ORD-1_413541.json">link</a>
     https://files.cultivera.com/x/Cultivera_ORD-1_413541.json`,
    null,
  );
  ok(dupEcho.length === 1, "repeated identical transfer link de-duped to one");

  // Conservative: an UNRELATED (non-vendor) .json is NOT harvested as a transfer
  // (tracking config etc.) — only vendor-recognized transfer links fan out.
  const noisy = extractAllTransferLinksFromBody(
    `cfg https://cdn.example.com/tracking.json and https://files.cultivera.com/real.json`,
    null,
  );
  ok(
    noisy.length === 1 && noisy[0] === "https://files.cultivera.com/real.json",
    "unrelated .json excluded; only the vendor transfer link harvested",
  );

  // No links -> empty array (never null).
  ok(extractAllTransferLinksFromBody("<p>no links here</p>", null).length === 0, "no links -> empty harvest");

  // mapReceivingAttachments
  const mapped = mapReceivingAttachments([
    {
      id: "att-1",
      filename: "manifest.pdf",
      content_type: "application/pdf",
      download_url: "https://inbound-cdn.resend.com/e/attachments/att-1?sig=x",
    },
    { filename: "no-id.pdf" }, // skipped (no id)
    { id: "att-2", filename: null, content_type: "application/json", download_url: null },
  ]);
  ok(mapped.length === 2, "map skips entries without id");
  ok(mapped[0].downloadUrl?.includes("inbound-cdn") === true, "map keeps download_url");
  ok(mapped[1].contentType === "application/json", "map keeps content_type");

  if (failed === 0) console.log(`resend-receiving-core: all ${passed} tests passed`);
  return { passed, failed };
}
