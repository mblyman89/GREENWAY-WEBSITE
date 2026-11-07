/**
 * src/lib/inventory/coa-gmail-search-core.ts   (D201, PURE)
 *
 * Owner (D201, verbatim in docs/sop-program/00-OWNER-REQUEST-VERBATIM.md):
 * "They will be in Stephen's Gmail address. Please build me a targeted search
 * for his email address ... Either the COA's will be PDFs, or they will be a
 * url inside the json ... Two buttons if possible, a fetch and attach buttons
 * ... Let me click a missing coa product and have that be a targeted search".
 *
 * The decisions, with no I/O:
 *   1. the exact Gmail questions for one delivery (manifest number, barcodes,
 *      vendor name inside the receive-date window), never the whole mailbox;
 *   2. which kept PDFs to open first (lab-looking names first; invoices,
 *      manifests, transfer logs and menus are never opened as certificates);
 *   3. the PDF certificate -> lot plan: ONLY an id printed on the certificate
 *      that EQUALS the lot's barcode (a GrowFlow QA "Child ID#" is the lot's
 *      own barcode). Never by name. Two different certificates for one barcode
 *      = left alone;
 *   4. the remembered search state (site_settings), the totals and the notes.
 */
import type { ParsedLab, ParsedLine } from "@/lib/inventory/intake-parser";
import type { WciaLinkPlan, WciaLot } from "@/lib/inventory/cultivera-wcia-core";
import { certificateToLab, looksLikeCertificate, looksLikeGrowFlowQaResults, type CoaCertificate } from "@/lib/inventory/coa-bundle-core";

// --- 1. The targeted Gmail questions ----------------------------------------------

export type GmailTargetLot = { id: string; lotCode: string | null };

/** One delivery that still has stocked lots with no COA. */
export type GmailTarget = {
  manifestId: string;
  manifestNumber: string | null;
  vendorLabel: string | null;
  /** YYYY-MM-DD (the manifest's transfer date, else its receive date). */
  transferDate: string | null;
  lots: GmailTargetLot[];
};

export type TargetQueryWhy = "manifest" | "barcodes" | "vendor" | "vendor-short";
export type TargetQuery = { why: TargetQueryWhy; q: string };

/** Barcodes per Gmail question (Gmail queries stay short and exact). */
export const BARCODES_PER_QUERY = 20;
/** The bulk search window around the transfer date (days before / after). */
export const BULK_WINDOW: readonly [number, number] = [10, 14];
/** The one-product search window (wider: stubborn ones). */
export const ONE_WINDOW: readonly [number, number] = [30, 30];

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{4,63}$/;

/** A manifest number / barcode safe to put in a Gmail query (letters, digits, . _ -). */
export function safeToken(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return TOKEN_RE.test(s) ? s : null;
}

const SUFFIX_RE = /[,.]?\s+(?:l\.?l\.?c\.?|inc\.?|corp\.?|co\.?|ltd\.?|llp|pllc|company)$/i;

/** "GREEN RESEARCH NETWORK, LLC" -> "GREEN RESEARCH NETWORK". null when too short to search. */
export function vendorSearchName(label: string | null | undefined): string | null {
  let s = (label ?? "").replace(/["“”{}()\\:]/g, " ").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3 && SUFFIX_RE.test(s); i++) s = s.replace(SUFFIX_RE, "").trim();
  s = s.replace(/[,.\s]+$/, "").trim();
  return s.replace(/[^A-Za-z0-9]/g, "").length >= 3 ? s : null;
}

/** The first two words of a longer vendor name ("NALLEY VALLEY PARTNERS" -> "NALLEY VALLEY"). */
export function vendorShortName(name: string | null): string | null {
  if (!name) return null;
  const words = name.split(" ").filter(Boolean);
  if (words.length <= 2) return null;
  const short = words.slice(0, 2).join(" ");
  return short.replace(/[^A-Za-z0-9]/g, "").length >= 5 ? short : null;
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** YYYY-MM-DD + days -> Gmail's YYYY/MM/DD (null for a bad date). */
export function gmailDayOffset(ymd: string | null | undefined, days: number): string | null {
  const m = YMD_RE.exec((ymd ?? "").trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + days * 86_400_000);
  if (d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 2100) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
}

export function chunkList<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += Math.max(1, n)) out.push(xs.slice(i, i + Math.max(1, n)));
  return out;
}

/**
 * The exact Gmail questions for one delivery. `bulk` = the Fetch button (the
 * vendor question only on emails with a document); `one` = a stubborn product
 * (wider window, any vendor email, and the short vendor name as well).
 * Every question ends in `-in:chats`. Gmail search is read-only.
 */
export function buildTargetQueries(t: GmailTarget, mode: "bulk" | "one", onlyLotIds?: ReadonlySet<string>): TargetQuery[] {
  const out: TargetQuery[] = [];
  const mn = safeToken(t.manifestNumber);
  if (mn) out.push({ why: "manifest", q: `{"${mn}" filename:${mn}} -in:chats` });
  const lots = onlyLotIds ? t.lots.filter((l) => onlyLotIds.has(l.id)) : t.lots;
  const codes = [...new Set(lots.map((l) => safeToken(l.lotCode)).filter((x): x is string => Boolean(x)))].sort();
  for (const part of chunkList(codes, BARCODES_PER_QUERY)) {
    out.push({ why: "barcodes", q: `{${part.map((c) => `"${c}"`).join(" ")}} -in:chats` });
  }
  const name = vendorSearchName(t.vendorLabel);
  const [back, fwd] = mode === "one" ? ONE_WINDOW : BULK_WINDOW;
  const after = gmailDayOffset(t.transferDate, -back);
  const before = gmailDayOffset(t.transferDate, fwd);
  if (name && after && before) {
    const docs = mode === "bulk" ? ` {has:attachment "transfer data" "with COA"}` : "";
    out.push({ why: "vendor", q: `"${name}" after:${after} before:${before}${docs} -in:chats` });
    const short = mode === "one" ? vendorShortName(name) : null;
    if (short) out.push({ why: "vendor-short", q: `"${short}" after:${after} before:${before} -in:chats` });
  }
  return out;
}

// --- 2. Which kept PDFs to open ---------------------------------------------------------

/** 0 = looks like a lab document (open first), 1 = unknown, 2 = never a certificate (not opened). */
export function pdfReadPriority(filename: string | null | undefined, sourceFormat?: string | null): 0 | 1 | 2 {
  const f = (filename ?? "").toLowerCase();
  if (sourceFormat === "pdf-manifest") return 2; // already read as a manifest
  if (/^qa[_ -]|\bcoa\b|coa[_ -]|certificate|\blab[_ -]?result|analysis|potency|\bqa\b/.test(f)) return 0;
  if (/^(?:ccrs_)?manifest|^invoice|transferlog|transfer[_ -]log|contingency|\bmenu\b|catalog|price[_ -]?list|order[_ -]?form|receipt|statement/.test(f)) return 2;
  return 1;
}

/** A PDF's own text says it is a lab certificate or a GrowFlow QA table. */
export function isCertificateText(text: string | null | undefined): boolean {
  const t = text ?? "";
  if (!t.trim()) return false;
  return looksLikeGrowFlowQaResults(t) || looksLikeCertificate(t);
}

// --- 3. PDF certificate -> lot (exact id only) -------------------------------------------

export type ReadCert = { cert: CoaCertificate; doc: string };

export type CertLinkPlan = {
  plan: WciaLinkPlan;
  /** lab test id -> the stored PDF it came from (to file it under the lab result). */
  docByExternalId: Map<string, string>;
  matched: number;
  ambiguous: number;
};

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
/** A barcode / printed id: 8+ characters, no spaces, at least one digit (never a product name). */
export const isIdLike = (s: string) => /^[A-Z0-9][A-Z0-9._-]{7,}$/.test(s) && /\d/.test(s);

/**
 * Lots (no lab, not destroyed) -> certificates whose PRINTED ids include the
 * lot's barcode. One distinct lab test id = link; two = ambiguous (left
 * alone); none = not found. Never by product name.
 */
export function planCertLinks(lots: readonly WciaLot[], certs: readonly ReadCert[]): CertLinkPlan {
  const byId = new Map<string, ReadCert[]>();
  for (const rc of certs) {
    if (!rc.cert.identifiable) continue;
    for (const id of new Set(rc.cert.ids.map(up))) {
      if (!isIdLike(id)) continue;
      const list = byId.get(id) ?? [];
      list.push(rc);
      byId.set(id, list);
    }
  }
  const links: WciaLinkPlan["links"] = [];
  const needs = new Map<string, { key: string; externalId: string | null; lab: ParsedLab }>();
  const docByExternalId = new Map<string, string>();
  const outcomes: WciaLinkPlan["outcomes"] = { link: 0, "has-lab": 0, destroyed: 0, "no-barcode": 0, "not-on-transfer": 0, "no-lab": 0, ambiguous: 0 };
  let ambiguous = 0;
  for (const lot of lots) {
    if (lot.status === "destroyed") {
      outcomes.destroyed += 1;
      continue;
    }
    if (lot.lab_result_id) {
      outcomes["has-lab"] += 1;
      continue;
    }
    const bc = up(lot.lot_code);
    if (!isIdLike(bc)) {
      outcomes["no-barcode"] += 1;
      continue;
    }
    const hits = byId.get(bc) ?? [];
    if (hits.length === 0) {
      outcomes["not-on-transfer"] += 1;
      continue;
    }
    const exts = new Map<string, ReadCert>();
    for (const h of hits) {
      const ext = up(h.cert.labSampleId ?? h.cert.ids[0] ?? "");
      if (ext && !exts.has(ext)) exts.set(ext, h);
    }
    if (exts.size !== 1) {
      outcomes.ambiguous += 1;
      ambiguous += 1;
      continue;
    }
    const [ext, rc] = [...exts][0];
    if (!needs.has(ext)) {
      const lab = certificateToLab(rc.cert, "id", bc);
      needs.set(ext, { key: ext, externalId: ext, lab: { ...lab, labtest_external_identifier: ext } });
      docByExternalId.set(ext, rc.doc);
    }
    links.push({ lotId: lot.id, labKey: ext });
    outcomes.link += 1;
  }
  const externalIds = [...needs.keys()].sort();
  return { plan: { links, needs: [...needs.values()], outcomes, externalIds }, docByExternalId, matched: links.length, ambiguous };
}

/** Kept JSON lines that carry lab data for one of the barcodes (one per barcode + lab id). */
export function jsonLinesForBarcodes(docs: readonly (readonly ParsedLine[])[], barcodes: ReadonlySet<string>): ParsedLine[] {
  const out: ParsedLine[] = [];
  const seen = new Set<string>();
  for (const lines of docs) {
    for (const line of lines) {
      const bc = (line.lot_code ?? "").trim();
      if (!bc || !barcodes.has(bc) || !line.lab) continue;
      const sig = `${bc}\u0000${line.lab.labtest_external_identifier ?? "?"}`;
      if (seen.has(sig) && line.lab.labtest_external_identifier) continue;
      seen.add(sig);
      out.push(line);
    }
  }
  return out;
}

// --- 4. Remembered search, totals, notes ----------------------------------------------------

export const COA_GMAIL_SETTING_KEY = "coa_gmail_search";
export const COA_GMAIL_SETTING_LABEL = "D201: the targeted Gmail COA search (emails it matched, deliveries it searched)";
export const COA_GMAIL_FETCH_AUDIT = "inventory.coa_gmail_search";
export const COA_GMAIL_ATTACH_AUDIT = "inventory.coa_gmail_attach";
export const COA_GMAIL_ONE_AUDIT = "inventory.coa_gmail_search_one";
/** New emails opened per Fetch click (the harvester stores each one). */
export const GMAIL_SEARCH_MAX_NEW = 40;
/** New emails opened by one product's search. */
export const GMAIL_ONE_MAX_NEW = 25;
export const GMAIL_SEARCH_BUDGET_MS = 200_000;
export const GMAIL_ONE_SEARCH_BUDGET_MS = 90_000;
export const GMAIL_ATTACH_BUDGET_MS = 210_000;
/** Emails remembered per delivery. */
export const GMAIL_HITS_PER_DELIVERY = 200;

/** manifest (or lot) id -> when it was searched and the Gmail ids the search matched. */
export type GmailSearchState = {
  version: 1;
  hits: Record<string, { at: string; ids: string[] }>;
  updatedAt: string | null;
};

const GMAIL_ID = /^[0-9a-zA-Z_-]{6,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyGmailSearchState(): GmailSearchState {
  return { version: 1, hits: {}, updatedAt: null };
}

const cleanIds = (xs: unknown): string[] =>
  Array.isArray(xs) ? [...new Set(xs.filter((x): x is string => typeof x === "string" && GMAIL_ID.test(x)))].slice(-GMAIL_HITS_PER_DELIVERY) : [];

export function parseGmailSearchState(raw: unknown): GmailSearchState {
  const s = emptyGmailSearchState();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return s;
  const o = raw as Record<string, unknown>;
  if (o.hits && typeof o.hits === "object" && !Array.isArray(o.hits)) {
    for (const [k, v] of Object.entries(o.hits as Record<string, unknown>)) {
      if (!UUID.test(k) || !v || typeof v !== "object" || Array.isArray(v)) continue;
      const e = v as Record<string, unknown>;
      s.hits[k.toLowerCase()] = { at: typeof e.at === "string" ? e.at.slice(0, 40) : "", ids: cleanIds(e.ids) };
    }
  }
  if (typeof o.updatedAt === "string") s.updatedAt = o.updatedAt.slice(0, 40);
  return s;
}

/** Remember one delivery's search (its matched ids are merged with earlier ones). */
export function recordSearch(s: GmailSearchState, manifestId: string, gmailIds: readonly string[], nowIso: string): GmailSearchState {
  if (!UUID.test(manifestId)) return s;
  const k = manifestId.toLowerCase();
  const ids = cleanIds([...(s.hits[k]?.ids ?? []), ...gmailIds]);
  return { version: 1, hits: { ...s.hits, [k]: { at: nowIso, ids } }, updatedAt: nowIso };
}

/** The remembered emails of the deliveries that still need a COA. */
export function hitIdsFor(s: GmailSearchState, manifestIds: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const m of manifestIds) for (const id of s.hits[m.toLowerCase()]?.ids ?? []) out.add(id);
  return [...out].sort();
}

/** Bulk order: never-searched deliveries first, then the longest-ago searched; most lots first. */
export function orderTargets<T extends GmailTarget>(targets: readonly T[], s: GmailSearchState): T[] {
  return [...targets].sort((a, b) => {
    const sa = s.hits[a.manifestId.toLowerCase()]?.at ?? "";
    const sb = s.hits[b.manifestId.toLowerCase()]?.at ?? "";
    if (sa !== sb) return sa < sb ? -1 : 1;
    return b.lots.length - a.lots.length || a.manifestId.localeCompare(b.manifestId);
  });
}

export type GmailSearchTotals = {
  deliveries: number;
  searched: number;
  coveredAlready: number;
  left: number;
  queries: number;
  matched: number;
  alreadyKept: number;
  newEmails: number;
  documents: number;
  deferred: number;
  stoppedBecause: string | null;
  errors: string[];
};

export function emptySearchTotals(): GmailSearchTotals {
  return { deliveries: 0, searched: 0, coveredAlready: 0, left: 0, queries: 0, matched: 0, alreadyKept: 0, newEmails: 0, documents: 0, deferred: 0, stoppedBecause: null, errors: [] };
}

export type GmailAttachTotals = {
  dryRun: boolean;
  missingBefore: number;
  jsonDocsRead: number;
  pdfsRead: number;
  certsRead: number;
  linkedFromJson: number;
  linkedFromPdf: number;
  created: number;
  reused: number;
  ambiguous: number;
  skippedChanged: number;
  pdfsFiled: number;
  pdfsLeft: number;
  stillMissing: number;
  stoppedForTime: boolean;
  errors: string[];
};

export function emptyAttachTotals(dryRun: boolean): GmailAttachTotals {
  return { dryRun, missingBefore: 0, jsonDocsRead: 0, pdfsRead: 0, certsRead: 0, linkedFromJson: 0, linkedFromPdf: 0, created: 0, reused: 0, ambiguous: 0, skippedChanged: 0, pdfsFiled: 0, pdfsLeft: 0, stillMissing: 0, stoppedForTime: false, errors: [] };
}

export function pushErr(t: { errors: string[] }, e: string): void {
  if (t.errors.length < 6) t.errors.push(e.slice(0, 200));
}

const s_ = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function searchNote(t: GmailSearchTotals): string {
  const parts = [
    `Searched Gmail for ${s_(t.searched, "delivery", "deliveries")} (${s_(t.queries, "question")}): ${s_(t.matched, "email")} matched, ${t.newEmails} newly kept (${s_(t.documents, "document")}), ${t.alreadyKept} already kept.`,
  ];
  if (t.coveredAlready > 0) parts.push(`${s_(t.coveredAlready, "delivery", "deliveries")} already had ${t.coveredAlready === 1 ? "its" : "their"} vendor files in the kept emails (no search needed).`);
  if (t.deferred > 0 || t.left > 0) parts.push(`More to do (${t.left > 0 ? `${s_(t.left, "delivery", "deliveries")} not searched yet` : `${s_(t.deferred, "email")} waiting`}): click Search again.`);
  if (t.stoppedBecause) parts.push(`Stopped: ${t.stoppedBecause}.`);
  if (t.errors.length > 0) parts.push(`Problems: ${t.errors.join("; ")}.`);
  parts.push("Then click Attach COAs from Gmail.");
  return parts.join(" ");
}

export function searchTone(t: GmailSearchTotals): "ok" | "warn" {
  return t.errors.length === 0 && !t.stoppedBecause ? "ok" : "warn";
}

export function attachNote(t: GmailAttachTotals): string {
  const linked = t.linkedFromJson + t.linkedFromPdf;
  const head = t.dryRun ? "Preview (nothing was written): would link" : "Linked";
  const parts = [
    `${head} ${s_(linked, "lot")} to a COA: ${t.linkedFromJson} from the vendor JSON files (lab data and COA link), ${t.linkedFromPdf} from emailed COA PDFs (${s_(t.certsRead, "certificate")} read in ${s_(t.pdfsRead, "PDF")}).`,
    `${t.created} new lab results, ${t.reused} already on file.`,
  ];
  if (t.pdfsFiled > 0) parts.push(`${s_(t.pdfsFiled, "PDF")} filed with ${t.pdfsFiled === 1 ? "its" : "their"} lab result.`);
  if (t.ambiguous > 0) parts.push(`${s_(t.ambiguous, "lot")} left alone: two different certificates name the same barcode.`);
  if (t.skippedChanged > 0) parts.push(`${s_(t.skippedChanged, "lot")} changed meanwhile and ${t.skippedChanged === 1 ? "was" : "were"} not touched.`);
  parts.push(`${s_(t.stillMissing, "lot")} with stock still ${t.stillMissing === 1 ? "has" : "have"} no COA (was ${t.missingBefore}).`);
  if (t.stoppedForTime || t.pdfsLeft > 0) parts.push(`Stopped for time with ${s_(t.pdfsLeft, "PDF")} still to read: click again.`);
  if (t.errors.length > 0) parts.push(`Problems: ${t.errors.join("; ")}.`);
  return parts.join(" ");
}

export function attachTone(t: GmailAttachTotals): "ok" | "warn" {
  return t.errors.length === 0 && !t.stoppedForTime && t.pdfsLeft === 0 ? "ok" : "warn";
}

// --- self-tests -----------------------------------------------------------------------------

export function __runCoaGmailSearchCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("FAIL coa-gmail-search-core: " + m);
    passed += 1;
  };
  // tokens + names
  ok(safeToken("GF41969000020558") === "GF41969000020558", "manifest number token");
  ok(safeToken("WA413287.TRWX0A") === "WA413287.TRWX0A", "dotted token");
  ok(safeToken('x" OR from:a') === null && safeToken("") === null && safeToken("abc") === null, "unsafe/short tokens refused");
  ok(vendorSearchName("GREEN RESEARCH NETWORK, LLC") === "GREEN RESEARCH NETWORK", "LLC stripped");
  ok(vendorSearchName("Alpha Crux Llc") === "Alpha Crux", "Llc stripped");
  ok(vendorSearchName('Fire "Bros." {}') === "Fire Bros", "quotes/braces removed");
  ok(vendorSearchName("A") === null && vendorSearchName(null) === null, "too short");
  ok(vendorShortName("NALLEY VALLEY PARTNERS") === "NALLEY VALLEY" && vendorShortName("CLARITY FARMS") === null, "short name only for 3+ words");
  // dates
  ok(gmailDayOffset("2026-10-21", -10) === "2026/10/11" && gmailDayOffset("2026-10-21", 14) === "2026/11/04", "window");
  ok(gmailDayOffset("2026-03-01", -1) === "2026/02/28", "month edge");
  ok(gmailDayOffset("bad", 1) === null && gmailDayOffset(null, 1) === null, "bad date");
  // queries
  const T: GmailTarget = {
    manifestId: "00000000-0000-4000-8000-000000000001",
    manifestNumber: "GF41969000020558",
    vendorLabel: "CLARITY FARMS",
    transferDate: "2026-10-21",
    lots: Array.from({ length: 25 }, (_, i) => ({ id: `l${i}`, lotCode: `GF4196900618${String(4400 + i)}` })).concat([{ id: "bad", lotCode: 'x" OR y' }]),
  };
  const q = buildTargetQueries(T, "bulk");
  ok(q[0].why === "manifest" && q[0].q === '{"GF41969000020558" filename:GF41969000020558} -in:chats', "manifest question");
  ok(q.filter((x) => x.why === "barcodes").length === 2, "25 barcodes -> 2 questions of 20");
  ok(!q.some((x) => x.q.includes(" OR y")), "unsafe barcode never in a query");
  const v = q.find((x) => x.why === "vendor");
  ok(Boolean(v && v.q.includes('"CLARITY FARMS" after:2026/10/11 before:2026/11/04') && v.q.includes("has:attachment")), "bulk vendor window with documents");
  ok(q.every((x) => x.q.endsWith("-in:chats")), "every question excludes chats");
  const one = buildTargetQueries({ ...T, vendorLabel: "NALLEY VALLEY PARTNERS LLC" }, "one", new Set(["l3"]));
  ok(one.filter((x) => x.why === "barcodes").length === 1 && one.find((x) => x.why === "barcodes")!.q === '{"GF41969006184403"} -in:chats', "one product: its own barcode");
  ok(Boolean(one.find((x) => x.why === "vendor")?.q.includes("after:2026/09/21 before:2026/11/20")) && !one.find((x) => x.why === "vendor")!.q.includes("has:attachment"), "one product: wider, any email");
  ok(one.some((x) => x.why === "vendor-short" && x.q.startsWith('"NALLEY VALLEY" ')), "one product: short vendor name");
  ok(buildTargetQueries({ ...T, manifestNumber: null, vendorLabel: null, lots: [] }, "bulk").length === 0, "nothing to ask");
  // pdf priority
  ok(pdfReadPriority("QA_2026-10-21T16:04:31.pdf") === 0 && pdfReadPriority("COA - Blue Dream.pdf") === 0, "lab names first");
  ok(pdfReadPriority("Invoice_2026-10-21.pdf") === 2 && pdfReadPriority("CCRS_Manifest_2026.pdf") === 2 && pdfReadPriority("TransferLog_x.pdf") === 2, "never a certificate");
  ok(pdfReadPriority("Clarity Farms Menu October.pdf") === 2 && pdfReadPriority("scan0001.pdf") === 1, "menus skipped, unknown opened later");
  ok(pdfReadPriority("QA.pdf", "pdf-manifest") === 2, "read as a manifest already");
  ok(isCertificateText("Certificate of Analysis Lab Sample ID: WA-1") && !isCertificateText("INVOICE total") && !isCertificateText(""), "certificate text");
  ok(isCertificateText("QA Results Strain Lab Sample ID# Parent ID# Child ID# Additional Details X"), "GrowFlow QA table");
  // cert plan
  const cert = (key: string, ids: string[], lab: string | null = ids[0] ?? null, identifiable = true): CoaCertificate => ({
    key, docLabel: "QA.pdf", template: "growflow-qa", labName: "Medicine Creek Analytics", labSampleId: lab, ids, sampleName: "Blue Dream", productType: null,
    passed: null, totalThcPct: 27.5, totalCbdPct: 0, totalCannabinoidsPct: null, potency: { "total-thc": 27.5 }, testedOn: null, releasedOn: null, identifiable, reason: null,
  });
  const lots: WciaLot[] = [
    { id: "a", lot_code: "GF41918905566988", status: "active", lab_result_id: null },
    { id: "b", lot_code: "GF41918905566980", status: "active", lab_result_id: null },
    { id: "c", lot_code: "GF41918905566981", status: "active", lab_result_id: "has" },
    { id: "d", lot_code: "GF41918905566982", status: "destroyed", lab_result_id: null },
    { id: "e", lot_code: "GF41918905566983", status: "active", lab_result_id: null },
    { id: "f", lot_code: "Blue", status: "active", lab_result_id: null },
    { id: "g", lot_code: "GF41918905566999", status: "active", lab_result_id: null },
  ];
  const certs: ReadCert[] = [
    { doc: "k1", cert: cert("1", ["GF41918900062114", "GF41918900062100", "GF41918905566988"]) },
    { doc: "k1", cert: cert("2", ["GF41918900057849", "GF41918900057833", "GF41918905566980"]) },
    { doc: "k2", cert: cert("3", ["GF41918900057849", "GF41918900057833", "GF41918905566980"]) }, // same certificate again
    { doc: "k1", cert: cert("4", ["GF41918900000001", "GF41918905566983"]) },
    { doc: "k2", cert: cert("5", ["GF41918900000002", "GF41918905566983"]) }, // a DIFFERENT certificate, same barcode
    { doc: "k1", cert: cert("6", ["GF41918905566982"]) },
    { doc: "k1", cert: cert("7", ["GF41918905566981"]) },
    { doc: "k1", cert: cert("8", ["GF41918905566999"], null, false) },
  ];
  const p = planCertLinks(lots, certs);
  ok(p.matched === 2 && p.plan.links.map((l) => l.lotId).join() === "a,b", "exact barcode = printed id links");
  ok(p.plan.links[0].labKey === "GF41918900062114", "the lab sample id is the lab test id");
  ok(p.ambiguous === 1 && p.plan.outcomes.ambiguous === 1, "two different certificates = left alone");
  ok(p.plan.outcomes["has-lab"] === 1 && p.plan.outcomes.destroyed === 1, "never replaces, never a destroyed lot");
  ok(p.plan.outcomes["no-barcode"] === 1 && p.plan.outcomes["not-on-transfer"] === 1, "no name matching; unidentifiable cert ignored");
  ok(isIdLike("GF41969006184460") && isIdLike("WA-261001-001") && !isIdLike("BLUE DREAM") && !isIdLike("BLUEDREAMS") && !isIdLike("A1"), "id-like: barcodes yes, names no");
  ok(p.docByExternalId.get("GF41918900062114") === "k1", "pdf remembered for filing");
  const lab = p.plan.needs[0].lab;
  ok(lab.total_thc_pct === 27.5 && (lab.raw as Record<string, unknown>).coa_matched_by === "id" && (lab.raw as Record<string, unknown>).source === "emailed-coa-pdf", "native emailed-coa lab, matched by id");
  // json lines
  const line = (bc: string, lab: string | null) => ({ lot_code: bc, lab: lab ? ({ labtest_external_identifier: lab } as ParsedLab) : null }) as unknown as ParsedLine;
  const jl = jsonLinesForBarcodes([[line("A", "L1"), line("B", null), line("Z", "LZ")], [line("A", "L1")]], new Set(["A", "B"]));
  ok(jl.length === 1 && jl[0].lot_code === "A", "json lines: lab data only, deduped");
  // state
  const M1 = "00000000-0000-4000-8000-000000000001";
  const st0 = parseGmailSearchState({ hits: { [M1]: { at: "t", ids: ["1a15f35068062ad2", "bad id!", 3] }, nope: { at: "x", ids: [] } } });
  ok(st0.hits[M1].ids.join() === "1a15f35068062ad2" && Object.keys(st0.hits).length === 1, "state parsed strictly");
  ok(Object.keys(parseGmailSearchState(null).hits).length === 0 && parseGmailSearchState([1]).version === 1, "empty state");
  const st1 = recordSearch(st0, M1, ["1a15f35068062ad2", "1a15f2445413d1d8"], "2026-11-07T00:00:00Z");
  ok(st1.hits[M1].ids.length === 2 && st1.hits[M1].at === "2026-11-07T00:00:00Z", "search recorded, ids merged");
  ok(recordSearch(st1, "not-a-uuid", ["1a15f35068062ad2"], "x") === st1, "bad key ignored");
  ok(hitIdsFor(st1, [M1, "00000000-0000-4000-8000-000000000009"]).length === 2 && hitIdsFor(st1, []).length === 0, "hits for the deliveries still missing");
  const T2 = { ...T, manifestId: "00000000-0000-4000-8000-000000000002", lots: T.lots.slice(0, 2) };
  ok(orderTargets([T, T2], st1)[0].manifestId === T2.manifestId, "never-searched first");
  // notes
  const st = emptySearchTotals();
  st.searched = 3; st.queries = 9; st.matched = 7; st.newEmails = 2; st.documents = 5; st.alreadyKept = 5; st.left = 4;
  ok(searchNote(st).includes("3 deliveries") && searchNote(st).includes("click Search again") && searchTone(st) === "ok", "search note");
  const at = emptyAttachTotals(true);
  at.linkedFromJson = 3; at.linkedFromPdf = 2; at.missingBefore = 10; at.stillMissing = 5;
  ok(attachNote(at).startsWith("Preview (nothing was written): would link 5 lots") && attachTone(at) === "ok", "attach note");
  at.pdfsLeft = 4;
  ok(attachTone(at) === "warn" && attachNote(at).includes("click again"), "unfinished says so");
  return { passed, failed: 0 };
}
