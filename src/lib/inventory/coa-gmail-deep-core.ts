/**
 * src/lib/inventory/coa-gmail-deep-core.ts   (D203, PURE)
 *
 * Owner (D203, verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 * "I was able to get all but 4 manifests. they are in stephens email ... really
 * deep dive and dig deep to find these last four. either they go way back, or
 * there is something tricky about them ... they came via a json ... tune the
 * email fetcher to find them please."
 *
 * Why the D201 search missed them (found in the data, 2026-11-07):
 *   - it asked for the vendor's LEGAL name ("ALIS GROUP"), but the emails say the
 *     brand ("Gasworks", "Fetti", "Kool Faid") or come from a rep's own Gmail
 *     ("Seattle Marijuana Co order Json link" from a personal address);
 *   - the JSON often arrives on a REPLY or a second email ("Updated JSON
 *     Enclosed") in the same thread, which no question named;
 *   - an email kept once is never opened again: a JSON inside a .zip, a .txt, an
 *     octet-stream attachment, the 11th+ attachment, or a link that is not shaped
 *     like a transfer link was never taken;
 *   - only Inbox/All Mail was asked (no Spam / Trash).
 *
 * The decisions here, with no I/O:
 *   1. the deep Gmail questions for ONE delivery (manifest-number variants, the
 *      LCB manifest ids from kept LCB PDFs, each barcode and its digit-only
 *      forms, the vendor's license number, the vendor and its brand words, the
 *      people who sent this vendor's mail before, any JSON / zip around the
 *      date), all with `in:anywhere`;
 *   2. which attachments of an already-kept email to take again (anything that
 *      may hold a JSON / PDF / CSV and was not kept the first time);
 *   3. which body links to try (every public link, never a picture / social /
 *      unsubscribe / private-network link; Drive and Dropbox share links turned
 *      into their download form);
 *   4. which zip entries to keep; the deep-dig memory; the per-delivery notes.
 *
 * Gmail is read-only. Linking stays the D201 attach: exact barcode, fill-only.
 */
import type { AttachmentRef } from "@/lib/compliance/ccrs-mail-core";
import { chunkList, gmailDayOffset, safeToken, vendorSearchName, vendorShortName, type GmailTarget } from "@/lib/inventory/coa-gmail-search-core";

// --- 1. the deep questions ---------------------------------------------------------------

export type DeepTarget = GmailTarget & {
  /** The vendor's state license number (inbound_manifests.vendor_id -> vendors.license_number). */
  vendorLicense: string | null;
  /** The vendor's email on file (vendors.email). */
  vendorEmail: string | null;
  /** Product names of the lots still missing a COA (brand words come from these). */
  productNames: readonly string[];
  /** From headers of emails already tied to this delivery or vendor (rep / platform senders). */
  knownFroms: readonly string[];
  /** Kept LCB manifest PDF names for this delivery ("Manifest_GF41244600011042-1694337-1_...pdf"). */
  lcbFilenames: readonly string[];
};

export type DeepQuery = { why: "manifest" | "lcb-id" | "barcodes" | "license" | "vendor" | "brand" | "sender" | "json-near-date"; q: string };

/** Every question asks Spam and Trash as well (chats never hold a vendor file). */
export const DEEP_SCOPE = "in:anywhere -in:chats";
/** Days around the transfer date for the name / brand / sender questions. */
export const DEEP_WINDOW: readonly [number, number] = [45, 21];
/** The narrow window for "any JSON / zip at all" (it matches every vendor). */
export const JSON_NEAR_WINDOW: readonly [number, number] = [4, 6];
export const DEEP_BARCODES_PER_QUERY = 12;
/** D207c: kept out of the broad (dated) questions; the exact manifest / barcode / LCB-id questions still look everywhere. */
export const DEEP_NO_JUNK = "-category:promotions -category:social";
/** The exact questions: an email they match is opened before any broad match. */
export const PRECISE_WHY: ReadonlySet<DeepQuery["why"]> = new Set(["manifest", "lcb-id", "barcodes"]);
export const DEEP_MAX_BRANDS = 6;
export const DEEP_MAX_SENDERS = 6;

/** Senders that send for MANY vendors: only asked together with this vendor's names. */
const PLATFORM_SENDER_RE = /@(?:getgrowflow\.com|growflow\.com|cultivera\.com|leaflink\.com|lcb\.wa\.gov|wcia\.us|wecomply\.com|mail\.)|no-?reply@|noreply@|notifications?@/i;
const OWN_DOMAIN_RE = /@greenwaymarijuana\.com$/i;

/** "Boyan Netsov <bnetsov83@gmail.com>" -> "bnetsov83@gmail.com" (null for anything else). */
export function senderAddress(from: string | null | undefined): string | null {
  const s = (from ?? "").trim();
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(s) ?? /^([^<>\s"]+@[^<>\s"]+)$/.exec(s);
  const a = (m?.[1] ?? "").toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(a) ? a : null;
}

export const isPlatformSender = (addr: string) => PLATFORM_SENDER_RE.test(addr);

/** Manifest-number forms a vendor or a spreadsheet may print: as is, without the letter prefix, without leading zeros. */
export function manifestVariants(mn: string | null | undefined): string[] {
  const s = safeToken(mn);
  if (!s) return [];
  const out = [s];
  const digits = s.replace(/^[A-Za-z]+/, "");
  if (digits !== s && /^\d{6,}$/.test(digits)) out.push(digits);
  const noZeros = digits.replace(/^0+/, "");
  if (noZeros !== digits && /^\d{6,}$/.test(noZeros)) out.push(noZeros);
  return [...new Set(out)];
}

/** A barcode as printed elsewhere: as is, without the letter prefix, without leading zeros. */
export function barcodeVariants(code: string | null | undefined): string[] {
  return manifestVariants(code);
}

/** The LCB manifest id inside a kept LCB PDF name: "Manifest_GF41244600011042-1694337-1_2026...pdf" -> "1694337". */
export function lcbIdsFromFilenames(names: readonly string[], manifestNumber: string | null): string[] {
  const mn = (manifestNumber ?? "").trim();
  const out = new Set<string>();
  for (const n of names) {
    const m = /Manifest_([A-Za-z0-9]+)-(\d{5,9})-\d+_/i.exec(n ?? "");
    if (m && (!mn || m[1].toUpperCase() === mn.toUpperCase())) out.add(m[2]);
  }
  return [...out].sort();
}

const BRAND_STOP = new Set(["the", "and", "with", "thc", "cbd", "cbn", "cbg", "low", "dose", "mg", "oz", "1g", "2g", "pack", "pre", "roll", "rolls", "prerolls", "preroll", "gummy", "gummies", "shot", "tall", "brand", "infused"]);

/**
 * Brand words from the missing lots' product names: the part before the first " - "
 * (else the first two words), the first word of that alone when it is distinctive,
 * most common first. Never a number-only or 2-letter word.
 */
export function brandWords(productNames: readonly string[], max = DEEP_MAX_BRANDS): string[] {
  const count = new Map<string, { label: string; n: number }>();
  const add = (raw: string, weight: number) => {
    const label = raw.replace(/["“”{}()\\:]/g, " ").replace(/\s+/g, " ").trim();
    const alnum = label.replace(/[^A-Za-z0-9]/g, "");
    if (alnum.length < 3 || /^\d+$/.test(alnum)) return;
    if (label.split(" ").length === 1 && BRAND_STOP.has(label.toLowerCase())) return;
    const k = label.toLowerCase();
    const c = count.get(k) ?? { label, n: 0 };
    c.n += weight;
    count.set(k, c);
  };
  for (const name of productNames) {
    const n = (name ?? "").trim();
    if (!n) continue;
    const head = (n.split(/\s+-\s+|\s+–\s+/)[0] ?? "").trim();
    const words = head.split(/\s+/).filter(Boolean);
    const lead = words.length > 3 ? words.slice(0, 2).join(" ") : head;
    add(lead, 2);
    if (words.length >= 2 && !/^\d+$/.test(words[0]) && words[0].length >= 3) add(words[0], 1);
  }
  return [...count.values()]
    .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
    .map((c) => c.label)
    .slice(0, max);
}

/**
 * The deep questions for one delivery. Undated: the manifest forms, LCB ids and
 * barcodes ("they go way back"). Dated (-45/+21 days): the license, vendor names,
 * brand words, known personal senders, and platform senders together with the
 * vendor names. Narrow (-4/+6 days): any JSON / zip / "json" email at all.
 */
export function buildDeepQueries(t: DeepTarget): DeepQuery[] {
  const out: DeepQuery[] = [];
  const S = DEEP_SCOPE;
  const mv = manifestVariants(t.manifestNumber);
  if (mv.length > 0) out.push({ why: "manifest", q: `{${mv.map((v) => `"${v}"`).join(" ")} filename:${mv[0]}} ${S}` });
  const lcb = lcbIdsFromFilenames(t.lcbFilenames, t.manifestNumber);
  if (lcb.length > 0) out.push({ why: "lcb-id", q: `{${lcb.map((v) => `"${v}"`).join(" ")}} ${S}` });
  const codes = [...new Set(t.lots.flatMap((l) => barcodeVariants(l.lotCode)))].sort();
  for (const part of chunkList(codes, DEEP_BARCODES_PER_QUERY)) out.push({ why: "barcodes", q: `{${part.map((c) => `"${c}"`).join(" ")}} ${S}` });

  const after = gmailDayOffset(t.transferDate, -DEEP_WINDOW[0]);
  const before = gmailDayOffset(t.transferDate, DEEP_WINDOW[1]);
  if (!after || !before) return out;
  const win = `after:${after} before:${before}`;
  const lic = safeToken(t.vendorLicense) ?? (/^\d{5,7}$/.test((t.vendorLicense ?? "").trim()) ? (t.vendorLicense ?? "").trim() : null);
  // D207c: the broad dated questions skip Gmail's Promotions/Social tabs (vendor
  // newsletters and menu blasts ate a whole click without ever carrying a COA).
  const NJ = DEEP_NO_JUNK;
  if (lic) out.push({ why: "license", q: `"${lic}" ${win} ${NJ} ${S}` });
  const name = vendorSearchName(t.vendorLabel);
  const names = [name, vendorShortName(name)].filter((x): x is string => Boolean(x));
  if (names.length > 0) out.push({ why: "vendor", q: `{${names.map((n) => `"${n}"`).join(" ")}} ${win} ${NJ} ${S}` });
  const brands = brandWords(t.productNames).filter((b) => !names.some((n) => n.toLowerCase() === b.toLowerCase()));
  if (brands.length > 0) out.push({ why: "brand", q: `{${brands.map((b) => `"${b}"`).join(" ")}} ${win} ${NJ} ${S}` });

  const senders = new Set<string>();
  const vendorMail = senderAddress(t.vendorEmail);
  if (vendorMail) senders.add(vendorMail);
  for (const f of t.knownFroms) {
    const a = senderAddress(f);
    if (a && !OWN_DOMAIN_RE.test(a)) senders.add(a);
  }
  const personal = [...senders].filter((a) => !isPlatformSender(a)).sort().slice(0, DEEP_MAX_SENDERS);
  const platform = [...senders].filter((a) => isPlatformSender(a) && !/lcb\.wa\.gov/i.test(a)).sort().slice(0, DEEP_MAX_SENDERS);
  if (personal.length > 0) out.push({ why: "sender", q: `{${personal.map((a) => `from:${a}`).join(" ")}} ${win} ${S}` });
  const words = [...names, ...brands].slice(0, 6);
  if (platform.length > 0 && words.length > 0)
    out.push({ why: "sender", q: `{${platform.map((a) => `from:${a}`).join(" ")}} {${words.map((w) => `"${w}"`).join(" ")}} ${win} ${NJ} ${S}` });

  const na = gmailDayOffset(t.transferDate, -JSON_NEAR_WINDOW[0]);
  const nb = gmailDayOffset(t.transferDate, JSON_NEAR_WINDOW[1]);
  if (na && nb) out.push({ why: "json-near-date", q: `{filename:json filename:zip filename:txt json "transfer data" wcia} after:${na} before:${nb} ${NJ} ${S}` });
  return out;
}

// --- 2. what to take again from an email --------------------------------------------------

export type DeepTake = "doc" | "zip" | "sniff";
export type DeepAttachment = { ref: AttachmentRef; take: DeepTake };

const DOC_EXT = new Set(["json", "pdf", "csv", "xlsx", "xls"]);
const ZIP_EXT = new Set(["zip"]);
const SNIFF_EXT = new Set(["txt", "dat", "wcia", "manifest", "bin", ""]);
const NEVER_MIME = /^(image|audio|video|font)\/|^text\/(?:calendar|x-vcard|vcard|html|css)$|^application\/(?:pkcs7|x-pkcs7|pgp)/i;
export const DEEP_MAX_ATTACHMENTS = 40;
export const DEEP_MAX_BYTES = 25_000_000;

const extOf = (name: string) => (/\.([a-z0-9]{1,8})$/i.exec((name ?? "").trim())?.[1] ?? "").toLowerCase();

/**
 * The attachments of an already-kept email to take again: anything that may hold a
 * vendor document and was NOT kept successfully the first time (by name). A zip is
 * opened; a .txt / octet-stream / nameless-type file is judged by its first bytes.
 */
export function planDeepAttachments(attachments: readonly AttachmentRef[], keptNames: ReadonlySet<string>): { take: DeepAttachment[]; ignored: number } {
  const take: DeepAttachment[] = [];
  let ignored = 0;
  const seen = new Set<string>();
  for (const a of attachments) {
    const name = (a.filename ?? "").trim();
    const mt = (a.mimeType ?? "").toLowerCase().split(";")[0].trim();
    const ext = extOf(name);
    const key = `${name.toLowerCase()}|${a.size}`;
    if (seen.has(key) || keptNames.has(name.toLowerCase()) || (!a.attachmentId && !a.inlineData) || a.size > DEEP_MAX_BYTES || NEVER_MIME.test(mt)) {
      ignored += 1;
      continue;
    }
    seen.add(key);
    let kind: DeepTake | null = null;
    if (DOC_EXT.has(ext)) kind = "doc";
    else if (ZIP_EXT.has(ext) || /zip/.test(mt)) kind = "zip";
    else if (SNIFF_EXT.has(ext) || /octet-stream|^text\/plain$|json/.test(mt)) kind = "sniff";
    if (!kind || take.length >= DEEP_MAX_ATTACHMENTS) {
      ignored += 1;
      continue;
    }
    take.push({ ref: a, take: kind });
  }
  return { take, ignored };
}

/** Zip entries worth keeping (documents only, no folders / macOS junk), at most 20. */
export function zipEntriesToKeep(names: readonly string[]): string[] {
  return names
    .filter((n) => !n.endsWith("/") && !/(^|\/)__MACOSX\/|(^|\/)\.[^/]*$/.test(n))
    .filter((n) => DOC_EXT.has(extOf(n)) || SNIFF_EXT.has(extOf(n)))
    .slice(0, 20);
}

// --- 3. which body links to try -------------------------------------------------------------

export const DEEP_MAX_LINKS_PER_EMAIL = 12;
const ANY_URL = /https?:\/\/[^\s"'<>()]+/gi;
const JUNK_HOST = /(^|\.)(facebook|instagram|twitter|x|linkedin|youtube|tiktok|pinterest|yelp|apple|w3|schema|gstatic|googleapis|fonts\.googleapis|list-manage|mailchimp|mcusercontent|sendgrid|hubspot|hs-analytics|doubleclick|google-analytics|gravatar|calendly|zoom|maps\.google|goo\.gl)\.(com|org|net|gl|us|io)$/i;
const JUNK_PATH = /unsubscribe|opt-?out|preferences|privacy|terms|\/track(ing)?\/|\/open\/|\/pixel|\/wf\/open|view-?in-?browser|\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf|mp4|mov)(\?|$)/i;

/** A link a server may fetch: http(s), a public host name (never localhost, a private IP or an internal name). */
export function publicUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^(localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/.test(h)) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.startsWith("[")) return null; // no IP literals at all
  if (u.username || u.password) return null;
  return u;
}

/** A Drive / Dropbox share link -> the direct download link (others unchanged). */
export function downloadForm(u: URL): string {
  const h = u.hostname.toLowerCase();
  if (h === "drive.google.com") {
    const id = /\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  if (h.endsWith("dropbox.com") && u.searchParams.has("dl")) {
    const c = new URL(u.toString());
    c.searchParams.set("dl", "1");
    return c.toString();
  }
  return u.toString();
}

export type DeepLink = { url: string; as: "pdf" | "json" };

/** Every public, non-junk link in the bodies (hrefs and plain text), unwrapped, at most 12. */
export function planDeepLinks(html: string, text: string, max = DEEP_MAX_LINKS_PER_EMAIL): DeepLink[] {
  const norm = (s: string) =>
    (s ?? "")
      .replace(/<wbr\s*\/?>/gi, "")
      .replace(/[\u00ad\u200b\u200c\u200d\u2060\ufeff]/g, "")
      .replace(/=\r?\n/g, "")
      .replace(/&amp;/gi, "&");
  const all = `${norm(html)}\n${norm(text)}`.match(ANY_URL) ?? [];
  const out: DeepLink[] = [];
  const seen = new Set<string>();
  for (const raw of all) {
    const u = publicUrl(raw.replace(/[.,;:)\]}>'"]+$/, ""));
    if (!u || JUNK_HOST.test(u.hostname) || JUNK_PATH.test(u.pathname + u.search)) continue;
    const url = downloadForm(u);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, as: /\.pdf$/i.test(u.pathname) ? "pdf" : "json" });
    if (out.length >= max) break;
  }
  return out;
}

/** Deep documents are numbered from 100 (the first harvest used 0..~20); the same email gives the same numbers again. */
export const DEEP_INDEX_BASE = 100;
export const deepIndex = (n: number) => (n >= 0 && n <= 899 ? DEEP_INDEX_BASE + n : null);

// --- 4. memory, totals, notes ----------------------------------------------------------------

export const COA_GMAIL_DEEP_KEY = "coa_gmail_deep";
export const COA_GMAIL_DEEP_LABEL = "D203: the deep Gmail dig (emails already re-read in full)";
export const COA_GMAIL_DEEP_AUDIT = "inventory.coa_gmail_deep_dig";
export const DEEP_SEARCH_BUDGET_MS = 140_000;
export const DEEP_ATTACH_BUDGET_MS = 110_000;
export const DEEP_MAX_EMAILS = 60;
export const DEEP_IDS_PER_QUERY = 80;
export const DEEP_MEMORY = 4000;

const GID = /^[0-9A-Za-z_-]{6,64}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** dug: email id -> when it was re-read in full; targets: delivery id -> when its deep questions were last asked. */
export type DeepState = { version: 1; dug: Record<string, string>; targets: Record<string, string>; updatedAt: string | null };

export function parseDeepState(v: unknown): DeepState {
  const out: DeepState = { version: 1, dug: {}, targets: {}, updatedAt: null };
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const o = v as { dug?: unknown; targets?: unknown; updatedAt?: unknown };
  const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? Object.entries(x as Record<string, unknown>) : []);
  for (const [k, at] of obj(o.dug)) if (GID.test(k) && typeof at === "string") out.dug[k] = at;
  for (const [k, at] of obj(o.targets)) if (UUID.test(k) && typeof at === "string") out.targets[k.toLowerCase()] = at;
  out.updatedAt = typeof o.updatedAt === "string" ? o.updatedAt : null;
  return out;
}

/** Remember that a delivery's deep questions were all asked (the next click starts with the others). */
export function markTarget(s: DeepState, manifestId: string, nowIso: string): DeepState {
  if (!UUID.test(manifestId)) return s;
  return { ...s, targets: { ...s.targets, [manifestId.toLowerCase()]: nowIso }, updatedAt: nowIso };
}

/**
 * D207c: one delivery's fair share of a click, so the delivery with the most lots
 * (and the most matched emails) can no longer eat every click while the others
 * are never reached. The share is what is left of the time and of the email cap,
 * split evenly over the deliveries not yet started (at least one email).
 */
export function deepShare(budgetMs: number, maxEmails: number, elapsedMs: number, opened: number, remainingTargets: number): { untilMs: number; emails: number } {
  const n = Math.max(1, Math.floor(remainingTargets));
  const leftMs = Math.max(0, budgetMs - Math.max(0, elapsedMs));
  const leftEmails = Math.max(0, maxEmails - Math.max(0, opened));
  return { untilMs: Math.max(0, elapsedMs) + Math.floor(leftMs / n), emails: leftEmails === 0 ? 0 : Math.max(1, Math.floor(leftEmails / n)) };
}

/** D207c: exact-question matches first (in their found order), then the broad ones. */
export function orderDeepQueue(precise: readonly string[], broad: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...precise, ...broad]) if (!seen.has(id)) {
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Never-dug deliveries first, then the longest-ago dug; most missing lots first. */
export function orderDeepTargets<T extends { manifestId: string; lots: readonly unknown[] }>(targets: readonly T[], s: DeepState): T[] {
  return [...targets].sort((a, b) => {
    const sa = s.targets[a.manifestId.toLowerCase()] ?? "";
    const sb = s.targets[b.manifestId.toLowerCase()] ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    return b.lots.length - a.lots.length || a.manifestId.localeCompare(b.manifestId);
  });
}

/**
 * A vendor JSON pasted into the email text itself ("JSON enclosed" with no file):
 * the outermost {...} of the body when it parses as JSON and names transfer items.
 */
export function jsonInBody(text: string | null | undefined): string | null {
  const t = (text ?? "").replace(/^\uFEFF/, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a < 0 || b <= a || b - a < 40 || b - a > 8_000_000) return null;
  const s = t.slice(a, b + 1);
  if (!/inventory_transfer_items|document_schema_version|"inventory_id"|"lot_number"|"barcode"/i.test(s)) return null;
  try {
    JSON.parse(s);
    return s;
  } catch {
    return null;
  }
}

/** Remember these emails as fully re-read; the oldest are forgotten past DEEP_MEMORY. */
export function markDug(s: DeepState, ids: readonly string[], nowIso: string): DeepState {
  const dug = { ...s.dug };
  for (const id of ids) if (GID.test(id)) dug[id] = nowIso;
  const keys = Object.keys(dug);
  if (keys.length > DEEP_MEMORY) for (const k of keys.sort((a, b) => dug[a].localeCompare(dug[b])).slice(0, keys.length - DEEP_MEMORY)) delete dug[k];
  return { ...s, version: 1, dug, updatedAt: nowIso };
}

export type DeepEmail = { at: string | null; from: string | null; subject: string };

export type DeepDelivery = {
  manifestId: string;
  vendorLabel: string | null;
  manifestNumber: string | null;
  transferDate: string | null;
  lotsBefore: number;
  lotsAfter: number | null;
  queries: number;
  matched: number;
  newEmails: number;
  reread: number;
  threadMates: number;
  newJson: number;
  newPdf: number;
  /** Kept vendor JSON files that name at least one of this delivery's missing barcodes. */
  jsonNamingLots: number;
  emails: DeepEmail[];
  /** D207c: this delivery's share of the click ran out before every matched email was re-read. */
  partial: boolean;
};

export type DeepTotals = {
  deliveries: DeepDelivery[];
  linkedFromJson: number;
  linkedFromPdf: number;
  stillMissing: number;
  stoppedBecause: string | null;
  unfinished: boolean;
  errors: string[];
};

export function emptyDeepTotals(): DeepTotals {
  return { deliveries: [], linkedFromJson: 0, linkedFromPdf: 0, stillMissing: 0, stoppedBecause: null, unfinished: false, errors: [] };
}

export function emptyDeepDelivery(t: Pick<GmailTarget, "manifestId" | "vendorLabel" | "manifestNumber" | "transferDate" | "lots">): DeepDelivery {
  return {
    manifestId: t.manifestId,
    vendorLabel: t.vendorLabel,
    manifestNumber: t.manifestNumber,
    transferDate: t.transferDate,
    lotsBefore: t.lots.length,
    lotsAfter: null,
    queries: 0,
    matched: 0,
    newEmails: 0,
    reread: 0,
    threadMates: 0,
    newJson: 0,
    newPdf: 0,
    jsonNamingLots: 0,
    emails: [],
    partial: false,
  };
}

const s_ = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One plain sentence (or three) per delivery: what was asked, what was found, what is still missing and what to do. */
export function deepDeliveryLine(d: DeepDelivery): string {
  const who = `${d.vendorLabel ?? "Unknown vendor"} ${d.manifestNumber ?? ""}`.trim();
  const linked = d.lotsAfter === null ? null : Math.max(0, d.lotsBefore - d.lotsAfter);
  const parts = [
    `${who}: ${s_(d.queries, "question")}, ${s_(d.matched, "email")} matched (${d.newEmails} newly kept, ${d.reread} re-read in full, ${s_(d.threadMates, "reply", "replies")} in their threads); ${s_(d.newJson, "new JSON")} and ${s_(d.newPdf, "new PDF")} found.`,
  ];
  if (linked !== null) parts.push(d.lotsAfter === 0 ? `All ${d.lotsBefore} lots now have their COA.` : `${linked} of ${d.lotsBefore} lots linked; ${d.lotsAfter} still missing.`);
  if (d.lotsAfter !== 0 && d.partial) parts.push("Its share of this click ran out before every matched email was re-read: click Deep dig again; it continues with the emails not read yet.");
  else if (d.lotsAfter !== 0) {
    if (d.jsonNamingLots > 0) parts.push(`A vendor JSON naming these barcodes IS kept (${s_(d.jsonNamingLots, "file")}) but it has no lab data for them: ask the vendor for the COAs.`);
    else if (d.matched === 0) parts.push("Stephen's mailbox has no email naming this manifest, its barcodes, its license, vendor, brands or sender around that date: the JSON was not sent to this mailbox; ask the vendor to resend it.");
    else parts.push("None of those emails carries a JSON or a COA with these exact barcodes: ask the vendor to resend the transfer JSON.");
  }
  if (d.emails.length > 0) parts.push(`Closest emails: ${d.emails.map((e) => `${(e.at ?? "").slice(0, 10)} ${e.from ? `${e.from.slice(0, 40)} ` : ""}"${e.subject.slice(0, 60)}"`).join("; ")}.`);
  return parts.join(" ");
}

export function deepNote(t: DeepTotals): string {
  const n = t.linkedFromJson + t.linkedFromPdf;
  const head =
    t.deliveries.length === 0
      ? "Deep dig: no delivery is missing a COA."
      : `Deep dig of ${s_(t.deliveries.length, "delivery", "deliveries")}: linked ${s_(n, "lot")} (${t.linkedFromJson} from vendor JSON, ${t.linkedFromPdf} from COA PDFs); ${t.stillMissing} still missing.`;
  const lines = [head, ...t.deliveries.map(deepDeliveryLine)];
  if (t.unfinished) lines.push(`Not finished in one click${t.stoppedBecause ? ` (${t.stoppedBecause})` : ""}: click Deep dig again; it continues where it stopped.`);
  if (t.errors.length > 0) lines.push(`Problems: ${t.errors.slice(0, 4).join("; ")}.`);
  return lines.join(" ");
}

export function deepTone(t: DeepTotals): "ok" | "warn" {
  return t.errors.length === 0 && !t.unfinished && t.stillMissing === 0 ? "ok" : "warn";
}

export function pushDeepErr(t: { errors: string[] }, e: string): void {
  if (t.errors.length < 6) t.errors.push(e.slice(0, 200));
}

// --- self-test ---------------------------------------------------------------------------------

export function __runCoaGmailDeepCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL coa-gmail-deep-core: " + m);
    passed += 1;
  };
  // senders
  ok(senderAddress("Boyan Netsov <bnetsov83@gmail.com>") === "bnetsov83@gmail.com", "sender in brackets");
  ok(senderAddress("sales@forevergreenherbal.com") === "sales@forevergreenherbal.com" && senderAddress("Hector") === null && senderAddress('x" OR <a b@c>') === null, "bare sender, junk refused");
  ok(isPlatformSender("info@getgrowflow.com") && isPlatformSender("support@cultivera.com") && isPlatformSender("info@lcb.wa.gov") && !isPlatformSender("hector@gasworksco.com"), "platform senders");
  // manifest + barcode forms
  ok(manifestVariants("M07825651675").join() === "M07825651675,07825651675,7825651675", "Evergreen manifest forms");
  ok(manifestVariants("GF41244600011042").join() === "GF41244600011042,41244600011042", "GrowFlow manifest forms");
  ok(manifestVariants("21055126467944359").join() === "21055126467944359" && manifestVariants('x" OR y').length === 0, "digits only / unsafe");
  ok(barcodeVariants("07825682875").join() === "07825682875,7825682875", "barcode without leading zero");
  ok(lcbIdsFromFilenames(["Manifest_GF41244600011042-1694337-1_2026102221.pdf", "Manifest_GF9-1-1_x.pdf", "Manifest_GF42904700003637-1695525-3_2026.pdf"], "GF41244600011042").join() === "1694337", "LCB id of this manifest only");
  // brand words
  const b = brandWords(["Kool Faid Nitro - Grapes Gone Wild - 1g AIO", "Kool Faid Nitro - Smerf Berries - 1g Tank", "Fetti Prerolls - Holy Grail Zours (H) - 2.5g"]);
  ok(b[0] === "Kool Faid Nitro" && b.includes("Fetti Prerolls") && b.includes("Kool") && b.includes("Fetti"), "brand words from names");
  const e = brandWords(["420 Brand - Organic Dark Chocolate", "BLAZE Gummy - Mango", "Blaze Gummy - Zero Sugar", "MAJOR Shot - Blueberry", "Major Shot Fruit Punch - 2oz"]);
  ok(e.includes("BLAZE Gummy") && e.includes("MAJOR Shot") && !e.includes("420") && e.filter((x) => x.toLowerCase() === "blaze gummy").length === 1, "case-folded, no number-only brand");
  ok(brandWords(["SMC - Infused Blunt"]).join() === "SMC" && brandWords(["", "ab - x"]).length === 0, "short brand kept, too short refused");
  // queries
  const T: DeepTarget = {
    manifestId: "00000000-0000-4000-8000-000000000001",
    manifestNumber: "GF41244600011042",
    vendorLabel: "MOUNTAIN HI",
    transferDate: "2026-10-23",
    lots: Array.from({ length: 14 }, (_, i) => ({ id: `l${i}`, lotCode: `GF412446056465${String(10 + i)}` })),
    vendorLicense: "412446",
    vendorEmail: null,
    productNames: ["SMC - Infused Blunt - 1g"],
    knownFroms: ["Boyan Netsov <bnetsov83@gmail.com>", "Mountain Hi <info@getgrowflow.com>", "<info@lcb.wa.gov>", "Stephen Benoit <Stephen@greenwaymarijuana.com>"],
    lcbFilenames: ["Manifest_GF41244600011042-1694337-1_2026102221.pdf"],
  };
  const q = buildDeepQueries(T);
  ok(q.every((x) => x.q.endsWith(DEEP_SCOPE)), "every question includes Spam and Trash");
  ok(q.some((x) => x.why === "manifest" && x.q.includes('"41244600011042"')), "manifest without prefix");
  ok(q.some((x) => x.why === "lcb-id" && x.q.includes('"1694337"')), "LCB manifest id");
  ok(q.filter((x) => x.why === "barcodes").length === 3, "28 barcode forms -> 3 questions of 12");
  ok(q.some((x) => x.why === "license" && x.q.startsWith('"412446" after:2026/09/08 before:2026/11/13')), "license in the wide window");
  ok(q.some((x) => x.why === "brand" && x.q.includes('"SMC"')), "brand question");
  const senders = q.filter((x) => x.why === "sender");
  ok(senders.some((x) => x.q.startsWith("{from:bnetsov83@gmail.com}")), "the rep's own Gmail asked alone");
  ok(senders.some((x) => x.q.includes("from:info@getgrowflow.com") && x.q.includes('"MOUNTAIN HI"')), "platform sender only with the vendor's names");
  ok(!q.some((x) => x.q.includes("lcb.wa.gov") || x.q.toLowerCase().includes("greenwaymarijuana")), "never the LCB or our own address");
  ok(q.some((x) => x.why === "json-near-date" && x.q.includes("after:2026/10/19 before:2026/10/29")), "any JSON near the date");
  ok(buildDeepQueries({ ...T, transferDate: null }).every((x) => ["manifest", "lcb-id", "barcodes"].includes(x.why)), "no date: undated questions only");
  ok(!buildDeepQueries({ ...T, vendorLabel: 'A" OR x', productNames: ['" OR in:inbox'] }).some((x) => /" OR /.test(x.q)), "quotes never break a question");
  // attachments
  const att = (filename: string, mimeType: string, size = 100, id: string | null = "a"): AttachmentRef => ({ filename, mimeType, size, attachmentId: id, inlineData: null });
  const p = planDeepAttachments(
    [att("Transfer.zip", "application/zip"), att("wcia.txt", "text/plain"), att("data", "application/octet-stream"), att("logo.png", "image/png"), att("QA.pdf", "application/pdf"), att("Invoice.pdf", "application/pdf"), att("x.json", "application/json", 30_000_000), att("y.json", "application/json", 10, null), att("invite.ics", "text/calendar")],
    new Set(["invoice.pdf"]),
  );
  ok(p.take.map((x) => `${x.ref.filename}:${x.take}`).join() === "Transfer.zip:zip,wcia.txt:sniff,data:sniff,QA.pdf:doc", "zip / txt / octet taken, kept / pictures / too big / no data not");
  ok(p.ignored === 5, "ignored counted");
  ok(zipEntriesToKeep(["a/", "__MACOSX/._t.json", "t.json", "QA.pdf", "pic.png", ".DS_Store", "readme.txt"]).join() === "t.json,QA.pdf,readme.txt", "zip entries");
  // links
  ok(publicUrl("https://files.cultivera.com/x.json") !== null && publicUrl("http://localhost/x") === null && publicUrl("http://10.0.0.1/x") === null && publicUrl("http://169.254.169.254/latest") === null, "no private hosts");
  ok(publicUrl("https://a:b@host.com/x") === null && publicUrl("ftp://host.com/x") === null && publicUrl("http://metadata.google.internal/") === null, "no credentials, no ftp, no metadata");
  ok(downloadForm(new URL("https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing")) === "https://drive.google.com/uc?export=download&id=1AbCdEfGhIjKlMn", "Drive share -> download");
  ok(downloadForm(new URL("https://www.dropbox.com/s/abc/t.json?dl=0")).endsWith("dl=1"), "Dropbox -> dl=1");
  const L = planDeepLinks(
    '<a href="https://go.growflow.com/wa/wcia/transfer?token=AB&amp;x=1">here</a> <img src="https://x.com/logo.png"> <a href="https://www.facebook.com/gasworks">fb</a> <a href="https://gasworksco.com/unsubscribe?u=1">u</a>',
    "JSON: https://www.dropbox.com/s/abc/transfer.json?dl=0. COA https://lab.example.com/coa/123.pdf, internal http://192.168.1.4/x",
  );
  ok(L.map((x) => x.as).join() === "json,json,pdf" && L[0].url.includes("token=AB&x=1") && L[2].url.endsWith(".pdf"), "every public link, junk and private dropped");
  ok(planDeepLinks(Array.from({ length: 30 }, (_, i) => `https://h${i}.example.com/f`).join(" "), "").length === DEEP_MAX_LINKS_PER_EMAIL, "links capped");
  ok(deepIndex(0) === 100 && deepIndex(899) === 999 && deepIndex(900) === null && deepIndex(-1) === null, "deep doc numbers 100..999");
  // memory
  const s0 = parseDeepState({ dug: { "1a1318d07aed68a2": "t1", "bad id!": "x", "1a13192079a5c29a": 5 } });
  ok(Object.keys(s0.dug).join() === "1a1318d07aed68a2", "memory parsed strictly");
  const s1 = markDug(s0, ["1a13192079a5c29a", "no!"], "2026-11-07T00:00:00Z");
  ok(Object.keys(s1.dug).length === 2 && s1.updatedAt === "2026-11-07T00:00:00Z", "emails remembered");
  const M1 = "00000000-0000-4000-8000-000000000001";
  const M2 = "00000000-0000-4000-8000-000000000002";
  const s2 = markTarget(s1, M1, "2026-11-07T01:00:00Z");
  ok(s2.targets[M1] === "2026-11-07T01:00:00Z" && markTarget(s2, "nope", "x") === s2 && Object.keys(s2.dug).length === 2, "delivery remembered");
  ok(parseDeepState(JSON.parse(JSON.stringify(s2))).targets[M1] === "2026-11-07T01:00:00Z", "memory round-trips");
  ok(orderDeepTargets([{ manifestId: M1, lots: [1] }, { manifestId: M2, lots: [1] }], s2)[0].manifestId === M2, "never-dug delivery first");
  // D207c: fair shares, junk filter, exact matches first, rotation
  const sh1 = deepShare(140_000, 60, 0, 0, 3);
  ok(sh1.untilMs === 46_666 && sh1.emails === 20, "3 deliveries: a third of the time and of the emails each");
  const sh2 = deepShare(140_000, 60, 100_000, 50, 2);
  ok(sh2.untilMs === 120_000 && sh2.emails === 5, "the share is of what is left");
  ok(deepShare(140_000, 60, 150_000, 60, 1).untilMs === 150_000 && deepShare(140_000, 60, 150_000, 60, 1).emails === 0, "nothing left: no share");
  ok(deepShare(140_000, 60, 0, 59, 5).emails === 1 && deepShare(1000, 10, 0, 0, 0).untilMs === 1000, "at least one email; zero targets never divides by zero");
  ok(q.filter((x) => ["license", "vendor", "brand", "json-near-date"].includes(x.why) || x.q.includes("getgrowflow")).every((x) => x.q.includes(DEEP_NO_JUNK)), "broad questions skip Promotions/Social");
  ok(q.some((x) => x.q.startsWith("{from:bnetsov83@gmail.com}") && !x.q.includes("category:")), "the rep's own address still looks in every tab");
  ok(q.filter((x) => PRECISE_WHY.has(x.why)).every((x) => !x.q.includes("category:")), "exact questions still look everywhere");
  ok(orderDeepQueue(["b", "a"], ["c", "a", "d"]).join() === "b,a,c,d", "exact matches opened first, no duplicates");
  const s3 = markTarget(markTarget(s2, M2, "2026-11-07T02:00:00Z"), M1, "2026-11-07T03:00:00Z");
  ok(orderDeepTargets([{ manifestId: M1, lots: [1, 2, 3] }, { manifestId: M2, lots: [1] }], s3)[0].manifestId === M2, "a delivery tried last click goes to the back (rotation)");
  const dp = emptyDeepDelivery({ manifestId: M1, vendorLabel: "GREEN RESEARCH", manifestNumber: "GF42904700003637", transferDate: "2026-10-02", lots: [] });
  dp.partial = true;
  dp.lotsAfter = 15;
  dp.lotsBefore = 15;
  ok(deepDeliveryLine(dp).includes("share of this click ran out") && !deepDeliveryLine(dp).includes("ask the vendor"), "partial: never blames the vendor yet");
  ok(jsonInBody('Hi, here it is:\n{"document_schema_version":"2.1.0","inventory_transfer_items":[]}\nThanks') === '{"document_schema_version":"2.1.0","inventory_transfer_items":[]}', "JSON pasted into the body");
  ok(jsonInBody("Order {see attached} thanks") === null && jsonInBody('{"a":1, "b": "not a transfer at all, just text"}') === null && jsonInBody('{"inventory_id": 1,') === null, "no JSON / not a transfer / broken");
  // notes
  const d = emptyDeepDelivery({ manifestId: T.manifestId, vendorLabel: "ALIS GROUP", manifestNumber: "21055126467944359", transferDate: "2026-10-02", lots: T.lots.slice(0, 6) });
  d.queries = 9;
  d.lotsAfter = 6;
  ok(deepDeliveryLine(d).includes("was not sent to this mailbox"), "nothing matched: says the JSON never reached the mailbox");
  d.matched = 3;
  d.emails = [{ at: "2026-10-01T10:00:00Z", from: "hector@gasworksco.com", subject: "Gasworks order proposal" }];
  ok(deepDeliveryLine(d).includes("resend the transfer JSON") && deepDeliveryLine(d).includes("Gasworks order proposal"), "matched but no JSON: names the emails");
  d.jsonNamingLots = 1;
  ok(deepDeliveryLine(d).includes("no lab data"), "JSON without lab data said plainly");
  d.lotsAfter = 0;
  ok(deepDeliveryLine(d).includes("All 6 lots now have their COA"), "all linked");
  const t = emptyDeepTotals();
  t.deliveries = [d];
  t.linkedFromJson = 6;
  ok(deepNote(t).startsWith("Deep dig of 1 delivery: linked 6 lots") && deepTone(t) === "ok", "note + tone");
  t.unfinished = true;
  ok(deepNote(t).includes("click Deep dig again") && deepTone(t) === "warn", "unfinished");
  ok(deepNote(emptyDeepTotals()).includes("no delivery is missing"), "nothing to do");
  return { passed, failed: 0 };
}
