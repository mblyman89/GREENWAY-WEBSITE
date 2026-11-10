/**
 * src/lib/inbound-email/odd-format-core.ts  (D229)
 *
 * The PURE half of reading vendor emails that send their papers "in some
 * weird way". Grounded in the real Evergreen Herbal email (Manifest
 * #M07825652483, evidence in docs/intake-evidence/2026-11-10-evergreen/):
 *
 *   - every document was a Google Drive SHARE link (".../file/d/<id>/view").
 *     That link answers with Drive's HTML viewer, never the file, so every
 *     fetch said "didn't return a PDF". directDocumentUrl turns a share link
 *     into the direct download link Google itself redirects to.
 *   - the "CCRS Manifest" link was a CSV (the official CCRS manifest file),
 *     not a PDF. sniffDocument decides what a fetched file IS from its bytes
 *     (PDF magic, JSON, CCRS manifest CSV, HTML page), never from the label.
 *   - the WCIA transfer was behind "JSON link:" on a line of its own, with the
 *     URL lines later. labelThenLinkUrls finds a URL that follows a label line.
 *   - the CSV and the JSON describe the SAME delivery. collapseSameDelivery
 *     keeps one manifest per manifest number (the richest source) and folds
 *     the others' transport in, so one delivery never stages twice.
 *
 * NEVER GUESS: everything here only decides what to FETCH or how to NAME it.
 * A fetched file still has to pass the strict gates downstream (PDF magic
 * bytes, strict WCIA JSON, a CCRS CSV with items) before anything stages, and
 * staging is always a DRAFT for a person to review.
 */
import { foldTransport } from "@/lib/inventory/manifest-merge-core";
import type { ParsedManifest } from "@/lib/inventory/intake-parser";

// ---------------------------------------------------------------------------
// 1) File-share links -> the direct download
// ---------------------------------------------------------------------------

const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;

/**
 * A file-share link -> the URL that returns the FILE itself, or null when the
 * link is not a recognised single-file share (then it is fetched as is).
 *   drive.google.com/file/d/<id>/view?usp=drivesdk | /open?id= | /uc?id=
 *   docs.google.com/file/d/<id>/...                 (old Drive form)
 *   drive.usercontent.google.com/download?id=<id>   (kept, export=download)
 *   www.dropbox.com/...?dl=0                         -> dl=1
 * A Drive FOLDER, a Google Doc / Sheet editor link, or no id -> null.
 * PURE.
 */
export function directDocumentUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (host === "drive.google.com" || host === "docs.google.com" || host === "drive.usercontent.google.com") {
    const fromPath = /^\/file\/d\/([^/]+)/.exec(u.pathname)?.[1] ?? null;
    const id = fromPath ?? u.searchParams.get("id");
    if (!id || !DRIVE_ID.test(id)) return null;
    if (host === "drive.usercontent.google.com" && u.pathname !== "/download") return null;
    if (!fromPath && !["/open", "/uc", "/download"].includes(u.pathname)) return null;
    return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  }
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    if (!/^\/(?:s|scl\/fi)\//.test(u.pathname)) return null;
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2) What did the link actually return?
// ---------------------------------------------------------------------------

export type SniffedKind = "pdf" | "json" | "ccrs-csv" | "csv" | "html" | "other";

/** `attachment; filename="x.pdf"` / filename*=UTF-8''x.pdf -> x.pdf. PURE. */
export function filenameFromContentDisposition(h: string | null | undefined): string | null {
  if (!h) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(h);
  if (star) {
    try {
      return cleanName(decodeURIComponent(star[1].trim().replace(/^"|"$/g, "")));
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(h);
  if (!plain) return null;
  return cleanName((plain[2] ?? plain[1]).trim());
}

function cleanName(s: string): string | null {
  const base = s.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim() ?? "";
  return base.length > 0 && base.length <= 200 ? base : null;
}

/** Does this text look like the official CCRS manifest CSV? PURE. */
export function looksLikeCcrsManifestCsv(text: string | null | undefined): boolean {
  if (!text) return false;
  const head = text.replace(/^\ufeff/, "").slice(0, 4000);
  return /(^|\n)\s*"?InventoryExternalIdentifier"?\s*,\s*"?PlantExternalIdentifier"?/i.test(head) &&
    /(^|\n)\s*"?(SubmittedBy|ExternalManifestIdentifier)"?\s*,/i.test(head);
}

/**
 * Decide what a fetched file IS, from its first bytes (the label in the email
 * and the server's content type are both often wrong). PURE.
 */
export function sniffDocument(bytes: Uint8Array, contentType: string | null | undefined): SniffedKind {
  if (bytes.byteLength >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.byteLength, 4096))).replace(/^\ufeff/, "");
  const t = head.trimStart();
  if (/^<(?:!doctype\s+html|html|head|body)\b/i.test(t)) return "html";
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (looksLikeCcrsManifestCsv(head)) return "ccrs-csv";
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("csv")) return "csv";
  if (ct.includes("json")) return "json";
  return "other";
}

/** A plain-words reason for a fetched file that is not usable. PURE. */
export function unusableReason(kind: SniffedKind, host: string): string {
  if (kind === "html") {
    return /google\.com$/.test(host)
      ? "Google Drive answered with a web page, not the file (the file may not be shared with anyone who has the link)"
      : "the link answered with a web page, not a document";
  }
  return "the link did not return a PDF, a CCRS manifest CSV or JSON";
}

// ---------------------------------------------------------------------------
// 3) A URL that sits under (or after) its label
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s"'<>()]+/i;

function stripTrailingPunct(u: string): string {
  return u.replace(/[.,;:)\]}>'"]+$/, "");
}

/** HTML or text -> visual lines; each anchor is replaced by its href. PURE. */
export function bodyLines(html: string | null | undefined, text: string | null | undefined): string[] {
  const h = (html ?? "")
    .replace(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi, " $1 ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|td|tr|li|h[1-6]|table|ul|ol|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
  return `${h}\n${text ?? ""}`
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s>]+/, "").trim());
}

/**
 * Every URL presented under a label that matches `label`:
 *   - on the SAME line as the label ("JSON link: https://..."), or
 *   - on one of the next 4 non-empty lines when the label line has no URL
 *     ("JSON link:" / blank / blank / "https://...").
 * Stops at the next line that is itself a label ("Something:" with no URL).
 * Order-preserved, de-duplicated. PURE.
 */
export function labelThenLinkUrls(html: string | null | undefined, text: string | null | undefined, label: RegExp): string[] {
  const lines = bodyLines(html, text);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!label.test(line)) continue;
    const same = line.match(URL_RE);
    if (same) {
      out.push(stripTrailingPunct(same[0]));
      continue;
    }
    let seen = 0;
    for (let j = i + 1; j < lines.length && seen < 4; j++) {
      const next = lines[j];
      if (!next) continue;
      seen += 1;
      const m = next.match(URL_RE);
      if (m) {
        out.push(stripTrailingPunct(m[0]));
        break;
      }
      if (/:\s*$/.test(next)) break; // the next label: this one had no link
    }
  }
  return Array.from(new Set(out));
}

/** The label of a "JSON link" (a WCIA transfer behind a plain JSON label). */
export const JSON_LINK_LABEL = /\bjson\b(?:\s*(?:link|file|data|url))?\s*:/i;

// ---------------------------------------------------------------------------
// 4) One delivery, many files -> one manifest
// ---------------------------------------------------------------------------

const SOURCE_RANK: Record<ParsedManifest["source_format"], number> = {
  wcia: 0, // names, prices, lab data
  "pdf-manifest": 1,
  generic: 2,
  "ccrs-csv": 3, // ids, quantities and transport only
};

function numberKey(n: string | null | undefined): string | null {
  const k = (n ?? "").trim().toUpperCase();
  return k.length > 0 ? k : null;
}

function lotSet(m: ParsedManifest): Set<string> {
  return new Set(m.lines.map((l) => (l.lot_code ?? "").trim()).filter(Boolean));
}

/**
 * Collapse manifests read from different files of ONE email that carry the
 * SAME manifest number into one: the richest source is kept (WCIA JSON first,
 * a CCRS CSV last), every other copy donates its transport (fill-only-empty,
 * conflicts become review warnings) and a warning names any lot that one file
 * lists and the other does not. Manifests with no number, or different
 * numbers, are returned untouched. `keep[i]` is the index of the kept input.
 * PURE.
 */
export function collapseSameDelivery(manifests: readonly ParsedManifest[]): { manifests: ParsedManifest[]; keep: number[] } {
  const groups = new Map<string, number[]>();
  const order: (string | number)[] = [];
  manifests.forEach((m, i) => {
    const k = numberKey(m.manifest_number);
    if (!k) {
      order.push(i);
      return;
    }
    if (!groups.has(k)) {
      groups.set(k, []);
      order.push(k);
    }
    groups.get(k)!.push(i);
  });
  const out: ParsedManifest[] = [];
  const keep: number[] = [];
  for (const o of order) {
    if (typeof o === "number") {
      out.push(manifests[o]);
      keep.push(o);
      continue;
    }
    const idx = groups.get(o)!;
    const sorted = [...idx].sort((a, b) => SOURCE_RANK[manifests[a].source_format] - SOURCE_RANK[manifests[b].source_format] || a - b);
    const primaryIdx = sorted[0];
    let primary = manifests[primaryIdx];
    for (const other of sorted.slice(1)) {
      const m = manifests[other];
      primary = foldTransport(primary, m.transport);
      const a = lotSet(primary);
      const b = lotSet(m);
      const onlyOther = [...b].filter((x) => !a.has(x));
      const onlyPrimary = [...a].filter((x) => !b.has(x));
      const warnings = [...primary.warnings];
      warnings.push(`The same delivery also came as a ${m.source_format} file (${m.lines.length} line(s)); it was read once, from the ${primary.source_format} file.`);
      if (onlyOther.length) warnings.push(`The ${m.source_format} file lists lot(s) the ${primary.source_format} file does not: ${onlyOther.join(", ")} - check them on arrival.`);
      if (onlyPrimary.length) warnings.push(`The ${primary.source_format} file lists lot(s) the ${m.source_format} file does not: ${onlyPrimary.join(", ")} - check them on arrival.`);
      if (!primary.vendor_license && m.vendor_license) primary = { ...primary, vendor_license: m.vendor_license };
      primary = { ...primary, warnings };
    }
    out.push(primary);
    keep.push(primaryIdx);
  }
  return { manifests: out, keep };
}

// ---------------------------------------------------------------------------
// Self-tests (scripts/compliance/run-pure-selftests.ts + vitest)
// ---------------------------------------------------------------------------

export function __runOddFormatTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`odd-format-core FAIL: ${name}`);
    }
  };
  const ID = "1XxfQGPD3ak_Qxx4_euyu2kifQTJfioZS";
  ok(directDocumentUrl(`https://drive.google.com/file/d/${ID}/view?usp=drivesdk`) === `https://drive.usercontent.google.com/download?id=${ID}&export=download&confirm=t`, "Drive share -> direct");
  ok(directDocumentUrl(`https://drive.google.com/open?id=${ID}`) !== null, "Drive open?id");
  ok(directDocumentUrl("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp") === null, "folder refused");
  ok(directDocumentUrl("http://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view") === null, "http refused");
  ok(directDocumentUrl("https://www.dropbox.com/s/abc/manifest.csv?dl=0")?.endsWith("dl=1") === true, "Dropbox dl=1");
  ok(directDocumentUrl("https://vendor.example.com/x.pdf") === null, "other hosts untouched");
  ok(filenameFromContentDisposition('attachment; filename="manifest_078256_20261109222938.csv"') === "manifest_078256_20261109222938.csv", "content-disposition");
  ok(filenameFromContentDisposition("attachment; filename*=UTF-8''Shipment%20Invoice.pdf") === "Shipment Invoice.pdf", "content-disposition utf-8");
  const enc = (s: string) => new TextEncoder().encode(s);
  ok(sniffDocument(enc("%PDF-1.7 x"), "application/octet-stream") === "pdf", "pdf by magic");
  ok(sniffDocument(enc("\ufeff{\"a\":1}"), "application/octet-stream") === "json", "json behind a BOM");
  ok(sniffDocument(enc("<!DOCTYPE html><html>"), "text/html") === "html", "html page");
  const csv = "SubmittedBy,admin admin,,\r\nExternalManifestIdentifier,M1,,\r\nInventoryExternalIdentifier,PlantExternalIdentifier,Quantity\r\n1,,2\r\n";
  ok(sniffDocument(enc(csv), "application/octet-stream") === "ccrs-csv", "CCRS CSV by content");
  ok(looksLikeCcrsManifestCsv(csv) && !looksLikeCcrsManifestCsv("a,b,c\n1,2,3"), "CCRS CSV detector");
  const text = "Proforma Invoice: https://drive.google.com/file/d/AAAAAAAAAAAA/view\nJSON link:\n\n\nhttps://evergreen-links.conflabs.com/?id=14aTiN1\n\nHere are your DOH COAs:";
  ok(labelThenLinkUrls(null, text, JSON_LINK_LABEL).join() === "https://evergreen-links.conflabs.com/?id=14aTiN1", "JSON link on a later line");
  ok(labelThenLinkUrls(null, "JSON link: https://x.example.com/t?id=1", JSON_LINK_LABEL).length === 1, "JSON link same line");
  ok(labelThenLinkUrls(null, "JSON link:\nInvoice:\nhttps://x.example.com/i", JSON_LINK_LABEL).length === 0, "stops at the next label");
  ok(labelThenLinkUrls('<div>JSON link:</div><div><br></div><div><a href="https://h.example.com/?id=9">here</a></div>', null, JSON_LINK_LABEL).join() === "https://h.example.com/?id=9", "HTML anchor href under the label");
  const base = { vendor_label: null, vendor_license: null, transfer_date: null, warnings: [] as string[] };
  const line = (lot: string) => ({ lot_code: lot }) as unknown as ParsedManifest["lines"][number];
  const json = { ...base, manifest_number: "M07825652483", vendor_label: "EVERGREEN HERBAL", source_format: "wcia", lines: [line("1"), line("2")] } as ParsedManifest;
  const ccrs = { ...base, manifest_number: "m07825652483", vendor_license: "078256", source_format: "ccrs-csv", lines: [line("1"), line("3")], transport: { driver_name: "Cory Barkley", vehicle_plate: "D33571K" } } as unknown as ParsedManifest;
  const c = collapseSameDelivery([ccrs, json]);
  ok(c.manifests.length === 1 && c.keep[0] === 1, "CSV + JSON of one delivery -> the JSON is kept");
  ok(c.manifests[0].transport?.driver_name === "Cory Barkley" && c.manifests[0].vendor_license === "078256", "the CSV donates transport + license");
  ok(c.manifests[0].warnings.some((w) => w.includes("lot(s) the wcia file does not: 3")), "lot differences are named");
  const other = { ...json, manifest_number: "M2" } as ParsedManifest;
  ok(collapseSameDelivery([json, other]).manifests.length === 2, "different numbers stay separate");
  return { passed, failed };
}
