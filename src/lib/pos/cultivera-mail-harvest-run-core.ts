/**
 * src/lib/pos/cultivera-mail-harvest-run-core.ts — R74 S7 (PURE).
 *
 * Owner (R74 round 2, #2/#5): "every Cultivera manifest was sent to stephen@. Please go as far back
 * as you are allowed to go." and "Whatever Cultivera doesn't find, the email will."
 *
 * S5 built the sign-in, the search, the resumable cursor and the attachment plan. S6 built the
 * barcode match. This core is the brain of the harvest RUN that joins them: one batch reads the next
 * emails of stephen@, keeps every vendor document it finds, and parses each one with the parsers the
 * site already uses for deliveries, so S6 can place the lots Cultivera could not.
 *
 *   pagePlan              which ids of the current Gmail page to open now (already-read ids are
 *                         skipped: the database row is the memory), and whether the page is finished
 *                         so the cursor may move on. A page is only left when every id on it is read.
 *   planMessageDocs       per email: the attachments to download (S5 harvestAttachmentPlan), the
 *                         WCIA "Transfer Data Link"s in the body (the real Cultivera emails LINK the
 *                         JSON rather than attach it; the same extractor the inbound email uses), and
 *                         a numbered row for every skip. An email with nothing gets ONE row saying so,
 *                         so it is never opened again.
 *   harvestDocKey         the private storage key: pos-raw/mail-harvest/<mailbox>/<gmail id>/<n>-<name>
 *   parseHarvestedDoc     JSON -> parseVendorJson (WCIA or generic); CSV -> the CCRS manifest CSV
 *                         parser; PDF / spreadsheet -> kept, marked "stored" (read later, never
 *                         guessed). A file without barcodes is "unreadable" with the reason.
 *   transientError        a Gmail 429 / 5xx / timeout stops the batch (retry later) instead of being
 *                         recorded as a permanent failure.
 *   mailDocsFromRows      stored rows -> S6's MailDoc[] (only parsed documents with barcodes).
 *
 * Reads nothing, writes nothing. Money in cents (unit_cost_minor_units from the parsers).
 */

import { header, type AttachmentRef, type GmailMessage, type GmailPart } from "@/lib/compliance/ccrs-mail-core";
import { parseVendorJson, type ParsedManifest } from "@/lib/inventory/intake-parser";
import { ccrsToParsedManifest, parseCcrsManifestCsv } from "@/lib/inventory/ccrs-manifest-csv-core";
import { extractAllTransferLinksFromBody } from "@/lib/inbound-email/resend-receiving-core";
import { harvestAttachmentPlan, messagesPerRun, SKIP_REASON_TEXT, type HarvestKind } from "@/lib/pos/cultivera-mail-harvest-core";
import type { MailDoc } from "@/lib/pos/cultivera-mail-match-core";

/* ------------------------------------------------------------------ *
 *  Constants
 * ------------------------------------------------------------------ */

/** site_settings key holding the S5 HarvestCursor between batches. */
export const HARVEST_CURSOR_KEY = "cultivera_mail_harvest_cursor";
export const HARVEST_CURSOR_LABEL = "Cultivera email harvest: where the walk of the vendor mailbox stopped (R74 S7)";
/** The table (migration 0293). */
export const HARVEST_DOCS_TABLE = "cultivera_mail_docs";
/** The private bucket the import's workbooks and WCIA files already live in. */
export const HARVEST_BUCKET = "pos-raw";
/** Emails opened per batch: Gmail's per-user minute budget with two downloads each (S5: 47). */
export const HARVEST_RUN_MAX_MESSAGES = messagesPerRun(2);
/** Stop starting new emails after this long, so a batch always ends inside the 300 s function. */
export const HARVEST_RUN_TIME_BUDGET_MS = 200_000;
/** Transfer links fetched per email (one Cultivera email = one transfer; a bundle rarely has more). */
export const HARVEST_MAX_LINKS_PER_MESSAGE = 4;
/** Line facts kept per document (a WCIA transfer has tens of lines; a runaway file is capped and says so). */
export const HARVEST_MAX_LINES_PER_DOC = 2000;

export const GMAIL_ID_RE = /^[0-9a-zA-Z_-]{6,64}$/;

export type DocKind = HarvestKind | "link-json" | "none";
export type DocSource = "attachment" | "link" | "email";
export type DocStatus = "parsed" | "stored" | "unreadable" | "skipped" | "failed" | "no_documents";
export const DOC_STATUSES: readonly DocStatus[] = ["parsed", "stored", "unreadable", "skipped", "failed", "no_documents"];

export const DOC_STATUS_TEXT: Record<DocStatus, string> = {
  parsed: "read: barcodes found",
  stored: "kept, not read yet (PDF or spreadsheet)",
  unreadable: "kept, but no barcodes in it",
  skipped: "not downloaded (named reason)",
  failed: "could not be fetched",
  no_documents: "email had no vendor document",
};

/* ------------------------------------------------------------------ *
 *  Page plan
 * ------------------------------------------------------------------ */

export type PagePlan = { fetch: string[]; known: number; invalid: number; deferred: number; pageComplete: boolean };

/**
 * The ids of the current page to open now. `known` = already stored (never opened twice). The page is
 * complete (the cursor may move to the next page) only when nothing on it is left unread.
 */
export function pagePlan(pageIds: readonly string[], known: ReadonlySet<string>, max = HARVEST_RUN_MAX_MESSAGES): PagePlan {
  const seen = new Set<string>();
  const todo: string[] = [];
  let invalid = 0;
  let knownN = 0;
  for (const id of pageIds) {
    if (!GMAIL_ID_RE.test(id)) {
      invalid += 1;
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    if (known.has(id)) knownN += 1;
    else todo.push(id);
  }
  const cap = Math.max(0, Math.floor(max));
  const fetch = todo.slice(0, cap);
  const deferred = todo.length - fetch.length;
  return { fetch, known: knownN, invalid, deferred, pageComplete: deferred === 0 };
}

/* ------------------------------------------------------------------ *
 *  One email -> its documents
 * ------------------------------------------------------------------ */

/** The raw html and plain text bodies (links live in the html href, which walkMessage's text drops). */
export function messageBodies(payload: GmailPart | undefined): { html: string; text: string } {
  let html = "";
  let text = "";
  const visit = (p: GmailPart | undefined, depth: number) => {
    if (!p || depth > 20) return;
    const mt = (p.mimeType ?? "").toLowerCase();
    const named = (p.filename ?? "").trim() !== "";
    if (!named && p.body?.data) {
      const s = Buffer.from(p.body.data, "base64url").toString("utf8");
      if (mt === "text/html" && !html) html = s;
      else if (mt === "text/plain" && !text) text = s;
    }
    for (const c of p.parts ?? []) visit(c, depth + 1);
  };
  visit(payload, 0);
  return { html, text };
}

export type MessageMeta = { emailAt: string | null; from: string | null; subject: string };

export function messageMeta(msg: GmailMessage): MessageMeta {
  const ms = Number(msg.internalDate);
  const emailAt = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
  const hs = msg.payload?.headers;
  return { emailAt, from: header(hs, "From"), subject: (header(hs, "Subject") ?? "").slice(0, 500) };
}

export type PlannedDownload = { index: number; ref: AttachmentRef; kind: HarvestKind };
export type PlannedLink = { index: number; url: string };
export type PlannedSkip = { index: number; filename: string; note: string };
export type MessageDocPlan = { downloads: PlannedDownload[]; links: PlannedLink[]; skips: PlannedSkip[]; nothing: boolean };

/**
 * Number every document of one email: downloads first, then body transfer links (only when no JSON
 * is attached, as the inbound email does), then skips. `nothing` = record ONE "no_documents" row.
 */
export function planMessageDocs(attachments: readonly AttachmentRef[], bodies: { html: string; text: string }): MessageDocPlan {
  const plan = harvestAttachmentPlan(attachments);
  let i = 0;
  const downloads = plan.download.map((d) => ({ index: i++, ref: d.ref, kind: d.kind }));
  const haveJson = downloads.some((d) => d.kind === "json");
  const links: PlannedLink[] = [];
  const skips: PlannedSkip[] = [];
  if (!haveJson) {
    const all = extractAllTransferLinksFromBody(bodies.html, bodies.text).filter((u) => /^https?:\/\//i.test(u));
    for (const url of all.slice(0, HARVEST_MAX_LINKS_PER_MESSAGE)) links.push({ index: i++, url });
    for (const url of all.slice(HARVEST_MAX_LINKS_PER_MESSAGE)) skips.push({ index: i++, filename: linkFilename(url), note: `more than ${HARVEST_MAX_LINKS_PER_MESSAGE} transfer links on one email` });
  }
  // Non-documents (logos, signatures) are counted on the email row, not given a row each.
  const named = plan.skipped.filter((s) => s.reason !== "not_a_document");
  for (const s of named) skips.push({ index: i++, filename: s.filename, note: SKIP_REASON_TEXT[s.reason] });
  return { downloads, links, skips, nothing: downloads.length === 0 && links.length === 0 && skips.length === 0 };
}

/** A filename for a fetched transfer link: the URL's last path part, as .json. */
export function linkFilename(url: string): string {
  let last = "transfer";
  try {
    const p = new URL(url).pathname.split("/").filter(Boolean).pop();
    if (p) last = decodeURIComponent(p);
  } catch {
    /* keep "transfer" */
  }
  return safeFilename(/\.json$/i.test(last) ? last : `${last}.json`);
}

/* ------------------------------------------------------------------ *
 *  Storage key
 * ------------------------------------------------------------------ */

/** Storage-safe name: [A-Za-z0-9._-] only, no leading dots, at most 80 characters, never empty. */
export function safeFilename(name: string): string {
  const s = (name ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "");
  const cut = s.length > 80 ? s.slice(s.length - 80).replace(/^[._]+/, "") : s;
  return cut || "file";
}

/** pos-raw key for one harvested document; null for an unsafe mailbox / id / index. */
export function harvestDocKey(mailbox: string, gmailId: string, index: number, filename: string): string | null {
  const mb = (mailbox ?? "").trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(mb)) return null;
  if (!GMAIL_ID_RE.test(gmailId)) return null;
  if (!Number.isInteger(index) || index < 0 || index > 999) return null;
  return `mail-harvest/${mb.replace(/[^a-z0-9._-]/g, "_")}/${gmailId}/${index}-${safeFilename(filename)}`;
}

export function contentTypeFor(kind: DocKind): string {
  switch (kind) {
    case "json":
    case "link-json":
      return "application/json";
    case "pdf":
      return "application/pdf";
    case "csv":
      return "text/csv";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

/* ------------------------------------------------------------------ *
 *  Parse one document with the existing parsers
 * ------------------------------------------------------------------ */

/** [barcode, qty, product name, inventory type, unit cost in cents] — what S6 needs, nothing more. */
export type DocLine = [string, number, string | null, string | null, number | null];

export type ParsedDocSummary = {
  status: Extract<DocStatus, "parsed" | "stored" | "unreadable">;
  sourceFormat: ParsedManifest["source_format"] | null;
  manifestNumber: string | null;
  vendorLabel: string | null;
  vendorLicense: string | null;
  transferDate: string | null;
  lines: DocLine[];
  note: string | null;
};

const EMPTY: Omit<ParsedDocSummary, "status" | "note"> = { sourceFormat: null, manifestNumber: null, vendorLabel: null, vendorLicense: null, transferDate: null, lines: [] };

function decodeText(bytes: Uint8Array): string {
  const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

export function summarizeManifest(m: Pick<ParsedManifest, "manifest_number" | "vendor_label" | "vendor_license" | "transfer_date" | "source_format" | "lines">, what: string): ParsedDocSummary {
  const lines: DocLine[] = [];
  let dropped = 0;
  for (const l of m.lines ?? []) {
    const bc = (l.lot_code ?? "").trim();
    if (!bc) continue;
    if (lines.length >= HARVEST_MAX_LINES_PER_DOC) {
      dropped += 1;
      continue;
    }
    const qty = Number(l.received_qty);
    const cost = typeof l.unit_cost_minor_units === "number" && Number.isFinite(l.unit_cost_minor_units) ? Math.round(l.unit_cost_minor_units) : null;
    lines.push([bc, Number.isFinite(qty) ? qty : 0, (l.product_name ?? "").trim() || null, (l.inventory_type ?? "").trim() || null, cost]);
  }
  const head = {
    sourceFormat: m.source_format,
    manifestNumber: (m.manifest_number ?? "").trim() || null,
    vendorLabel: (m.vendor_label ?? "").trim() || null,
    vendorLicense: (m.vendor_license ?? "").trim() || null,
    transferDate: (m.transfer_date ?? "").trim() || null,
  };
  if (lines.length === 0) return { ...head, lines, status: "unreadable", note: `${what} has no barcodes (it may be a lab result or a price list)` };
  return { ...head, lines, status: "parsed", note: dropped > 0 ? `only the first ${HARVEST_MAX_LINES_PER_DOC} lines were kept (${dropped} more)` : null };
}

export function parseHarvestedDoc(kind: Exclude<DocKind, "none">, bytes: Uint8Array): ParsedDocSummary {
  if (kind === "pdf") return { ...EMPTY, status: "stored", note: "PDF kept; it is read later (no guessing from a PDF here)" };
  if (kind === "xlsx") return { ...EMPTY, status: "stored", note: "spreadsheet kept; it is read later" };
  const text = decodeText(bytes);
  if (kind === "json" || kind === "link-json") {
    const r = parseVendorJson(text);
    if (!r.ok) return { ...EMPTY, status: "unreadable", note: r.error };
    return summarizeManifest(r.manifest, r.manifest.source_format === "wcia" ? "this WCIA transfer" : "this JSON");
  }
  // csv
  const p = parseCcrsManifestCsv(text);
  if (!p.ok) return { ...EMPTY, status: "unreadable", note: `not a CCRS manifest CSV (${p.error})` };
  return summarizeManifest(ccrsToParsedManifest(p), "this CCRS manifest CSV");
}

/* ------------------------------------------------------------------ *
 *  Rows (migration 0293)
 * ------------------------------------------------------------------ */

export type HarvestDocRow = {
  mailbox: string;
  gmail_id: string;
  doc_index: number;
  email_at: string | null;
  from_header: string | null;
  subject: string;
  filename: string;
  kind: DocKind;
  source: DocSource;
  storage_key: string | null;
  bytes: number | null;
  sha256: string | null;
  status: DocStatus;
  note: string | null;
  source_format: string | null;
  manifest_number: string | null;
  vendor_label: string | null;
  vendor_license: string | null;
  transfer_date: string | null;
  line_count: number;
  lines: DocLine[];
  barcodes: string[];
};

type Base = { mailbox: string; gmailId: string; meta: MessageMeta };

function baseRow(b: Base, index: number, filename: string, kind: DocKind, source: DocSource): Omit<HarvestDocRow, "status" | "note"> {
  return {
    mailbox: b.mailbox.toLowerCase(),
    gmail_id: b.gmailId,
    doc_index: index,
    email_at: b.meta.emailAt,
    from_header: b.meta.from ? b.meta.from.slice(0, 300) : null,
    subject: b.meta.subject,
    filename: filename.slice(0, 300),
    kind,
    source,
    storage_key: null,
    bytes: null,
    sha256: null,
    source_format: null,
    manifest_number: null,
    vendor_label: null,
    vendor_license: null,
    transfer_date: null,
    line_count: 0,
    lines: [],
    barcodes: [],
  };
}

/** A document that was downloaded / fetched and stored. */
export function storedDocRow(b: Base, index: number, filename: string, kind: Exclude<DocKind, "none">, source: DocSource, stored: { key: string; bytes: number; sha256: string }, parsed: ParsedDocSummary): HarvestDocRow {
  const barcodes = [...new Set(parsed.lines.map((l) => l[0]))].sort();
  return {
    ...baseRow(b, index, filename, kind, source),
    storage_key: stored.key,
    bytes: stored.bytes,
    sha256: stored.sha256,
    status: parsed.status,
    note: parsed.note,
    source_format: parsed.sourceFormat,
    manifest_number: parsed.manifestNumber,
    vendor_label: parsed.vendorLabel,
    vendor_license: parsed.vendorLicense,
    transfer_date: parsed.transferDate,
    line_count: parsed.lines.length,
    lines: parsed.lines,
    barcodes,
  };
}

export function skippedDocRow(b: Base, s: PlannedSkip): HarvestDocRow {
  return { ...baseRow(b, s.index, s.filename, "none", "attachment"), status: "skipped", note: s.note };
}

export function failedDocRow(b: Base, index: number, filename: string, kind: Exclude<DocKind, "none">, source: DocSource, why: string): HarvestDocRow {
  return { ...baseRow(b, index, filename, kind, source), status: "failed", note: why.slice(0, 300) };
}

export function noDocumentsRow(b: Base, ignored: number): HarvestDocRow {
  return {
    ...baseRow(b, 0, "", "none", "email"),
    status: "no_documents",
    note: ignored > 0 ? `${ignored} attachment(s) that are not vendor documents (pictures, signatures)` : "no attachment and no transfer link",
  };
}

/* ------------------------------------------------------------------ *
 *  Errors
 * ------------------------------------------------------------------ */

/** Rate limits, server errors and timeouts: stop the batch and retry later; never record as a failure. */
export function transientError(message: string): boolean {
  return /HTTP (429|5\d\d)\b|rate limit|timed out|timeout|aborted|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
}

/* ------------------------------------------------------------------ *
 *  The batch report
 * ------------------------------------------------------------------ */

export type HarvestBatchResult = {
  ok: boolean;
  mailbox: string | null;
  opened: number;
  stored: number;
  documents: number;
  parsed: number;
  failedEmails: number;
  deferred: number;
  pageComplete: boolean;
  cursorLine: string;
  stoppedBecause: string | null;
  errors: string[];
  /** R74 S18: set when the press ran a new-mail pass on a finished walk. */
  newMailPass?: "continues" | "finished";
};

export function harvestBatchLine(r: HarvestBatchResult): string {
  if (!r.ok && r.opened === 0) return `Email harvest did not run: ${r.stoppedBecause ?? r.errors[0] ?? "unknown error"}`;
  const head = `Email harvest of ${r.mailbox}: ${r.opened} email${r.opened === 1 ? "" : "s"} read, ${r.documents} vendor document${r.documents === 1 ? "" : "s"} kept (${r.parsed} with barcodes).`;
  const fails = r.failedEmails > 0 ? ` ${r.failedEmails} email${r.failedEmails === 1 ? "" : "s"} could not be read and will be tried again: ${r.errors[0] ?? ""}` : "";
  const stop = r.stoppedBecause ? ` Stopped early: ${r.stoppedBecause}.` : "";
  const more = r.deferred > 0 || !r.pageComplete || r.newMailPass === "continues" ? " Press the button again for the next batch." : "";
  const fresh = r.newMailPass === "finished" ? (r.opened > 0 ? " Checked for new emails: up to date now." : " Checked for new emails: none since the last press.") : "";
  return `${head}${fails}${stop} ${r.cursorLine}${fresh}${more}`.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ *
 *  Stored rows -> S6 documents
 * ------------------------------------------------------------------ */

export type StoredDocFacts = Pick<HarvestDocRow, "gmail_id" | "email_at" | "filename" | "status" | "source_format" | "manifest_number" | "vendor_label" | "vendor_license" | "transfer_date" | "lines">;

const FORMATS = new Set<string>(["wcia", "generic", "ccrs-csv", "pdf-manifest"]);

/** Only parsed documents with a known parser format become MailDocs; lines are re-shaped to ParsedLine facts. */
export function mailDocsFromRows(rows: readonly StoredDocFacts[]): MailDoc[] {
  const out: MailDoc[] = [];
  for (const r of rows) {
    if (r.status !== "parsed" || !r.source_format || !FORMATS.has(r.source_format) || !Array.isArray(r.lines)) continue;
    const lines = r.lines
      .filter((l): l is DocLine => Array.isArray(l) && typeof l[0] === "string" && l[0] !== "")
      .map((l) => ({
        lot_code: l[0],
        received_qty: Number(l[1]) || 0,
        product_name: l[2] ?? null,
        inventory_type: l[3] ?? null,
        unit_cost_minor_units: typeof l[4] === "number" ? l[4] : null,
      }));
    if (lines.length === 0) continue;
    out.push({
      messageId: r.gmail_id,
      emailAt: r.email_at,
      filename: r.filename,
      manifest: {
        manifest_number: r.manifest_number,
        vendor_label: r.vendor_label,
        vendor_license: r.vendor_license,
        transfer_date: r.transfer_date,
        source_format: r.source_format as ParsedManifest["source_format"],
        lines: lines as unknown as ParsedManifest["lines"],
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
 * ------------------------------------------------------------------ */

export function __runCultiveraMailHarvestRunCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL cultivera-mail-harvest-run-core: " + msg);
    passed += 1;
  };
  const enc = (s: string) => new TextEncoder().encode(s);
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

  // ---- constants ----
  ok(HARVEST_RUN_MAX_MESSAGES === 47, "batch size is S5's measured 47 emails");
  ok(HARVEST_RUN_TIME_BUDGET_MS < 300_000, "time budget inside the 300 s function");

  // ---- pagePlan ----
  {
    const p = pagePlan(["aaaaaa1", "aaaaaa2", "aaaaaa2", "bad id", "aaaaaa3"], new Set(["aaaaaa2"]), 47);
    ok(p.fetch.join(",") === "aaaaaa1,aaaaaa3", "known and repeated ids are not opened");
    ok(p.known === 1 && p.invalid === 1 && p.deferred === 0 && p.pageComplete, "page complete when nothing is left");
    const q = pagePlan(["aaaaaa1", "aaaaaa2", "aaaaaa3"], new Set(), 2);
    ok(q.fetch.length === 2 && q.deferred === 1 && !q.pageComplete, "over the cap: page not complete, cursor stays");
    const r = pagePlan(["aaaaaa1"], new Set(["aaaaaa1"]), 0);
    ok(r.fetch.length === 0 && r.pageComplete, "all known: page complete with no Gmail opens");
    ok(pagePlan([], new Set()).pageComplete, "empty page is complete");
  }

  // ---- bodies + meta ----
  {
    const msg: GmailMessage = {
      id: "m1",
      internalDate: String(Date.UTC(2024, 7, 30, 18, 0, 0)),
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "Vendor <orders@vendor.com>" },
          { name: "Subject", value: "Manifest 0009001" },
        ],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/plain", body: { data: b64("see link") } },
              { mimeType: "text/html", body: { data: b64('<a href="https://app.cultivera.com/x/0009001.json">Transfer Data Link</a>') } },
            ],
          },
          { mimeType: "image/png", filename: "logo.png", body: { attachmentId: "A1", size: 10 } },
        ],
      },
    };
    const b = messageBodies(msg.payload);
    ok(b.html.includes("href=") && b.text === "see link", "html href kept, text kept");
    const m = messageMeta(msg);
    ok(m.emailAt === "2024-08-30T18:00:00.000Z" && m.subject === "Manifest 0009001" && (m.from ?? "").includes("vendor.com"), "meta");
    ok(messageMeta({}).emailAt === null && messageMeta({}).subject === "", "meta of an empty message");
  }

  // ---- planMessageDocs ----
  const att = (filename: string, size = 100, mimeType = "", id: string | null = "X"): AttachmentRef => ({ filename, mimeType, size, attachmentId: id, inlineData: null });
  {
    const p = planMessageDocs([att("0009001.json"), att("invoice.pdf"), att("logo.png")], { html: '<a href="https://app.cultivera.com/x/1.json">Transfer Data Link</a>', text: "" });
    ok(p.downloads.length === 2 && p.downloads[0].index === 0 && p.downloads[1].index === 1, "downloads numbered first");
    ok(p.links.length === 0, "an attached JSON wins: body links are not fetched");
    ok(p.skips.length === 0 && !p.nothing, "logos are not rows");
  }
  {
    const p = planMessageDocs([att("manifest.pdf")], { html: '<p><a href="https://app.cultivera.com/x/0009001.json">Transfer Data Link</a></p>', text: "" });
    ok(p.links.length === 1 && p.links[0].index === 1 && p.links[0].url.endsWith("0009001.json"), "a linked transfer JSON is planned after the PDF");
  }
  {
    const many = Array.from({ length: 6 }, (_, i) => `<a href="https://app.cultivera.com/x/${i}.json">Transfer Data Link</a>`).join(" ");
    const p = planMessageDocs([], { html: many, text: "" });
    ok(p.links.length === HARVEST_MAX_LINKS_PER_MESSAGE && p.skips.length === 2 && /more than 4/.test(p.skips[0].note), "links capped, the rest named");
    ok(new Set([...p.links.map((l) => l.index), ...p.skips.map((s) => s.index)]).size === 6, "every index unique");
  }
  {
    const p = planMessageDocs([att("logo.png"), att("big.pdf", 30_000_000), att("x.pdf", 10, "", null)], { html: "", text: "" });
    ok(p.downloads.length === 0 && p.skips.length === 2 && p.skips[0].note === SKIP_REASON_TEXT.too_large, "too large and no data are named skips");
    ok(!p.nothing, "skips are rows, so the email is recorded");
    ok(planMessageDocs([att("logo.png")], { html: "hello", text: "" }).nothing, "only a logo: one no-documents row");
  }

  // ---- names and keys ----
  ok(safeFilename("Invoice #12 (final).pdf") === "Invoice_12_final_.pdf", "safe filename");
  ok(safeFilename("../../etc/passwd") === "etc_passwd", "no path escape");
  ok(safeFilename("") === "file" && safeFilename("...") === "file", "never empty");
  ok(safeFilename("a".repeat(200) + ".pdf").length === 80 && safeFilename("a".repeat(200) + ".pdf").endsWith(".pdf"), "long names keep the extension");
  ok(harvestDocKey("Stephen@GreenwayMarijuana.com", "18f2a3b4c5d6", 2, "0009001.json") === "mail-harvest/stephen_greenwaymarijuana.com/18f2a3b4c5d6/2-0009001.json", "storage key");
  ok(harvestDocKey("not a mailbox", "18f2a3b4c5d6", 0, "a") === null && harvestDocKey("s@x.com", "../x", 0, "a") === null && harvestDocKey("s@x.com", "18f2a3b4c5d6", -1, "a") === null, "unsafe keys refused");
  ok(linkFilename("https://app.cultivera.com/x/0009001.json") === "0009001.json" && linkFilename("https://growflow.com/wa/wcia/transfer?token=1") === "transfer.json", "link filenames");
  ok(contentTypeFor("pdf") === "application/pdf" && contentTypeFor("link-json") === "application/json", "content types");

  // ---- parseHarvestedDoc ----
  const wcia = JSON.stringify({
    document_schema_version: "2.1.0",
    transfer_id: "0009001",
    from_license_number: "412345",
    from_license_name: "CANNA ORGANIX LLC",
    inventory_transfer_items: [
      { inventory_id: "1234567890123456", product_name: "Blue Dream 3.5g", inventory_type: "Usable Marijuana", qty: "10", line_price: "45.00", uom: "each" },
      { inventory_id: "9999999999999999", product_name: "Sold Out 1g", qty: "5", line_price: "10.00" },
    ],
  });
  {
    const p = parseHarvestedDoc("json", enc("\ufeff" + wcia));
    ok(p.status === "parsed" && p.sourceFormat === "wcia", "WCIA JSON parsed (BOM tolerated)");
    ok(p.manifestNumber === "0009001" && p.vendorLicense === "412345" && p.vendorLabel === "CANNA ORGANIX LLC", "WCIA header facts");
    ok(p.lines.length === 2 && p.lines[0][0] === "1234567890123456" && p.lines[0][1] === 10, "WCIA lines with barcode and qty");
    ok(p.lines[0][4] === 450 && p.lines[1][4] === 200, "unit cost in cents (WCIA line_price / qty)");
    ok(parseHarvestedDoc("link-json", enc(wcia)).status === "parsed", "a fetched link is parsed the same way");
  }
  ok(parseHarvestedDoc("json", enc("{not json")).status === "unreadable", "broken JSON is unreadable, named");
  ok(/no barcodes/.test(parseHarvestedDoc("json", enc('{"lab":"x"}')).note ?? ""), "JSON without barcodes is named");
  ok(parseHarvestedDoc("pdf", enc("%PDF-1.4")).status === "stored", "PDF kept for later, never guessed");
  ok(parseHarvestedDoc("xlsx", new Uint8Array([0x50, 0x4b, 3, 4])).status === "stored", "spreadsheet kept for later");
  ok(/not a CCRS manifest CSV/.test(parseHarvestedDoc("csv", enc("a,b\n1,2")).note ?? ""), "a random CSV is named");

  // ---- rows ----
  const base: Base = { mailbox: "Stephen@greenwaymarijuana.com", gmailId: "18f2a3b4c5d6", meta: { emailAt: "2024-08-30T18:00:00.000Z", from: "v@x.com", subject: "S" } };
  {
    const parsed = parseHarvestedDoc("json", enc(wcia));
    const row = storedDocRow(base, 0, "0009001.json", "json", "attachment", { key: "k", bytes: 10, sha256: "h" }, parsed);
    ok(row.mailbox === "stephen@greenwaymarijuana.com" && row.status === "parsed" && row.line_count === 2, "stored row");
    ok(row.barcodes.join(",") === "1234567890123456,9999999999999999", "barcodes sorted for the index");
    const s = skippedDocRow(base, { index: 3, filename: "big.pdf", note: "larger than 25 MB" });
    ok(s.status === "skipped" && s.doc_index === 3 && s.storage_key === null, "skipped row");
    const f = failedDocRow(base, 1, "t.json", "link-json", "link", "HTTP 404 ".repeat(100));
    ok(f.status === "failed" && (f.note ?? "").length === 300, "failed row, note capped");
    const n = noDocumentsRow(base, 2);
    ok(n.doc_index === 0 && n.status === "no_documents" && /2 attachment/.test(n.note ?? ""), "no-documents row");
  }

  // ---- transient errors ----
  ok(transientError("Gmail messages.get: HTTP 429: quota") && transientError("Gmail x: HTTP 503") && transientError("The operation was aborted"), "transient");
  ok(!transientError("Gmail messages.get: HTTP 404: Not Found") && !transientError("named .pdf but is not a PDF"), "permanent");

  // ---- batch line ----
  {
    const r: HarvestBatchResult = { ok: true, mailbox: "s@x.com", opened: 3, stored: 3, documents: 4, parsed: 2, failedEmails: 0, deferred: 5, pageComplete: false, cursorLine: "In progress.", stoppedBecause: null, errors: [] };
    const line = harvestBatchLine(r);
    ok(/3 emails read, 4 vendor documents kept \(2 with barcodes\)/.test(line) && /next batch/.test(line), "batch line");
    ok(/did not run: Not set up/.test(harvestBatchLine({ ...r, ok: false, opened: 0, stoppedBecause: "Not set up" })), "not-run line");
    ok(/1 email could not be read/.test(harvestBatchLine({ ...r, failedEmails: 1, errors: ["m1: x"] })), "failure is loud");
    // R74 S18: the new-mail pass says what it found
    const fin = { ...r, deferred: 0, pageComplete: true, cursorLine: "Finished." };
    ok(/none since the last press/.test(harvestBatchLine({ ...fin, opened: 0, newMailPass: "finished" })) && !/again/.test(harvestBatchLine({ ...fin, opened: 0, newMailPass: "finished" })), "no new mail: says so, no press-again");
    ok(/up to date now/.test(harvestBatchLine({ ...fin, newMailPass: "finished" })), "new mail kept: up to date");
    ok(/press the button again/i.test(harvestBatchLine({ ...fin, newMailPass: "continues" })), "a pass that continues asks for another press");
    ok(!/new emails/.test(harvestBatchLine(fin)), "the walk's own batch line is unchanged");
  }

  // ---- mailDocsFromRows ----
  {
    const parsed = parseHarvestedDoc("json", enc(wcia));
    const row = storedDocRow(base, 0, "0009001.json", "json", "attachment", { key: "k", bytes: 10, sha256: "h" }, parsed);
    const docs = mailDocsFromRows([row, { ...row, status: "stored" }, { ...row, source_format: "nope" }, { ...row, lines: [] }]);
    ok(docs.length === 1, "only parsed rows with a known format and lines");
    ok(docs[0].manifest.manifest_number === "0009001" && docs[0].manifest.lines[0].lot_code === "1234567890123456" && docs[0].manifest.lines[0].unit_cost_minor_units === 450, "MailDoc facts");
  }

  return { passed, failed: 0 };
}
