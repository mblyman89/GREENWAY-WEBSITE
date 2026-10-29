/**
 * src/lib/inventory/coa-bundle-core.ts  (Fix Phase 3.1a, PURE)
 *
 * Owner (message 6, verbatim): "The last one the system auto fetched had every
 * detailed needed, but for some reason didn't or couldn't attach the coa lab
 * results to the products in the receiving detail page. So I can't accept it
 * nor move it to onboarding. We need a supremely robust table and fetcher, it
 * needs to work every time for every invoice and manifest".
 *
 * ROOT CAUSE (verified on the real fixtures, tests/fixtures/coa/item*.unpdf.txt):
 * a GrowFlow `QA_<timestamp>.pdf` is a BUNDLE of individual lab certificates
 * (Confidence Analytics template 8: "Certificate of Analysis Batch #: GF…, ID:
 * WA-…, Sample Name: …"). The emailed-COA reader only knew the one-page
 * "COA Summary" layout (pdf-coa-core parseCoaSummaryRows: `Lot: … Sample: …
 * Tested: … Expires:` rows). `looksLikeCoaSummary` said yes ("Certificate of
 * Analysis" + "Lab Sample ID"), the row reader found 0 rows, the PDF path logged
 * "No COA lots could be read from the PDF." to the console only, and every line
 * staged with no lab result - so the activation gate (hasLabResult) held them.
 *
 * This core:
 *   1. splits a COA PDF's text into certificates ("Page k of k" closes one);
 *   2. reads each with the existing per-certificate reader (coa-pdf-text-core
 *      parseCoaPdfText: Confidence 7/8, Testing Technologies, GGL);
 *   3. matches certificates to manifest lines, strongest evidence first:
 *        id   - an id printed on the certificate (Lab Sample ID, Origin Sample
 *               ID, Parent Batch ID, Batch #, WSLCB Inventory ID) equals an id
 *               the line carries (lot / inventory id, product key, the
 *               transfer's lab_result_id / sample_source_id);
 *        name - ONLY when no id matched: a product phrase of the line (strain,
 *               or a " - " segment of the product name other than the brand)
 *               equals a segment of exactly ONE certificate's sample name, else
 *               appears as a whole phrase in exactly ONE certificate's name.
 *               A name match is never presented as fact - it is stamped
 *               `coa_matched_by: "name"` and the receiving page shows
 *               "matched by name - verify".
 *      Two candidates = no attach (ambiguous, with the reason). Nothing is
 *      ever guessed: an unreadable or unmatched certificate is reported.
 *   4. builds the ParsedLab for a certificate from PRINTED values only (no
 *      expiry is invented: these certificates print none).
 *
 * Verified against the transfer's own COA links (tests/fixtures/coa/
 * transfer.json): every name match the reader makes points at the same
 * certificate the vendor's transfer links (tests/compliance/
 * fix-p3-1a-coa-bundle.test.ts).
 */

import { parseCoaPdfText, normalizeCoaText, potencyRow, type CoaPdfDoc, type CoaTemplate } from "./coa-pdf-text-core";
import type { ParsedLab, ParsedLine, ParsedManifest } from "./intake-parser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoaCertificate = {
  /** Stable key inside one read: `<doc>#<n>` (1-based). */
  key: string;
  /** The document it came from (attachment filename). */
  docLabel: string;
  template: CoaTemplate | null;
  labName: string | null;
  /** The lab's own id ("WA-260902-019"); null when the layout prints none. */
  labSampleId: string | null;
  /** Every id printed on the certificate (lab sample, origin sample, batch, inventory). */
  ids: string[];
  sampleName: string | null;
  productType: string | null;
  passed: boolean | null;
  totalThcPct: number | null;
  totalCbdPct: number | null;
  totalCannabinoidsPct: number | null;
  potency: Record<string, number>;
  testedOn: string | null;
  releasedOn: string | null;
  /** False when neither an id nor a sample name could be read (cannot be matched). */
  identifiable: boolean;
  /** Why it is not identifiable / what the reader said. */
  reason: string | null;
};

export type CoaMatchBy = "id" | "name";

export type CoaLineInput = {
  /** Caller's stable key (line index for staging, lot id for the store). */
  key: string;
  lot_code: string | null;
  pos_product_key: string | null;
  product_name: string | null;
  strain_name: string | null;
  brand_name: string | null;
  /** Other ids the line carries (transfer lab_result_id, sample_source_id, vendor inventory id). */
  knownIds: string[];
  /** True when the line already has a lab result (never replaced). */
  hasLab: boolean;
};

export type CoaLineMatch = { lineKey: string; certKey: string; by: CoaMatchBy; evidence: string };

export type CoaBundlePlan = {
  matches: CoaLineMatch[];
  /** Lines (without a lab) no certificate matched. */
  unmatchedLines: string[];
  /** Lines with two or more equally strong candidates - nothing attached. */
  ambiguous: { lineKey: string; certKeys: string[]; by: CoaMatchBy }[];
  /** Readable certificates no line used. */
  unusedCerts: string[];
  /** Certificates with no id and no sample name. */
  unreadableCerts: string[];
  /** Lines skipped because they already have a lab result. */
  alreadyHadLab: number;
};

// ---------------------------------------------------------------------------
// 1. Split + read
// ---------------------------------------------------------------------------

/** A certificate closes on its last page footer "Page k of k". */
const LAST_PAGE = /Page\s+(\d{1,3})\s+of\s+(\d{1,3})\b/gi;
const MIN_CERT_CHARS = 300;

export function splitCoaCertificates(raw: string): string[] {
  const text = typeof raw === "string" ? raw : "";
  if (!text.trim()) return [];
  const cuts: number[] = [];
  for (const m of text.matchAll(LAST_PAGE)) {
    if (m[1] === m[2] && m.index !== undefined) cuts.push(m.index + m[0].length);
  }
  const chunks: string[] = [];
  let start = 0;
  for (const c of cuts) {
    chunks.push(text.slice(start, c));
    start = c;
  }
  chunks.push(text.slice(start));
  // A repeated footer ("Page 2 of 2 Page 2 of 2") or a trailing tail leaves a
  // sliver: fold it into the certificate before it.
  const out: string[] = [];
  for (const ch of chunks) {
    if (ch.trim().length < MIN_CERT_CHARS && out.length > 0) out[out.length - 1] += ch;
    else if (ch.trim().length > 0) out.push(ch);
  }
  // The first chunk may itself be a sliver (no certificate before it).
  if (out.length > 1 && out[0].trim().length < MIN_CERT_CHARS) {
    out[1] = out[0] + out[1];
    out.shift();
  }
  return out;
}

const ID_PATTERNS: RegExp[] = [
  /Lab Sample ID:\s*(WA-\d{6}-\d{3})/gi,
  /\bID:\s*(WA-\d{6}-\d{3})/g,
  /Origin Sample ID:\s*([A-Z0-9][A-Z0-9.-]{7,})/g,
  /Parent Batch ID:\s*([A-Z0-9][A-Z0-9.-]{7,})/g,
  /Batch #:\s*([A-Z0-9][A-Z0-9.-]{7,}?)(?:,|\s)/g,
  /WSLCB Inventory ID:\s*(\d{8,})/g,
  /\b(GF\d{14})\b/g,
  // GGL prints "Sample ID: GF41205305607131" (layout text / LlamaParse).
  /Sample ID:\s*([A-Z0-9][A-Z0-9.-]{7,})/g,
];

/** One certificate prints at most these ids (lab, origin, parent, batch, inventory). */
export const MAX_IDS_PER_CERT = 5;

export function certificateIds(text: string): string[] {
  const t = normalizeCoaText(text);
  const out = new Set<string>();
  for (const re of ID_PATTERNS) {
    for (const m of t.matchAll(re)) {
      const v = (m[1] ?? "").trim().replace(/[.,;]+$/, "");
      // An id always carries a digit ("Sample ID: ORIGINATION:" is a label run, not an id).
      if (v.length >= 8 && /\d/.test(v)) out.add(v.toUpperCase());
    }
  }
  return [...out];
}

function dateOnly(v: string | null | undefined): string | null {
  const m = typeof v === "string" ? v.match(/\d{4}-\d{2}-\d{2}/) : null;
  return m ? m[0] : null;
}

function potencyMap(doc: CoaPdfDoc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of doc.potency) {
    if (r.pct !== null && Number.isFinite(r.pct)) out[r.key] = r.pct;
  }
  return out;
}

/**
 * GGL prints "SAMPLE NAME:      Super Boof  TYPE: …" (layout text); the
 * per-certificate reader leaves its sampleName null. A label run with no value
 * ("SAMPLE NAME: TYPE:", the unpdf order) yields null - never a label.
 */
export function printedSampleName(text: string): string | null {
  const t = normalizeCoaText(text);
  const m = t.match(/SAMPLE NAME:\s*(.{2,120}?)\s+(?:TYPE|CATEGORY|Sample ID|LICENSE|ORIGINATION):/i);
  if (!m) return null;
  const v = m[1].trim();
  if (!v || /:$/.test(v) || /^(?:TYPE|CATEGORY|SOURCE)\b/i.test(v)) return null;
  return v;
}

/** Lab-certificate wording (any lab): never true for a manifest or an invoice. */
export function looksLikeCertificate(text: string): boolean {
  const t = normalizeCoaText(text);
  if (/\bManifest ID:|Transported Items|Internal Shipping Document|\bINVOICE\b/i.test(t) && !/Certificate of Analysis/i.test(t)) return false;
  return /Certificate of Analysis|Lab Sample ID:|TESTING SUMMARY|Batch Pass\/Fail/i.test(t);
}

/** Read one certificate's text. Never throws. */
export function readCertificate(text: string, docLabel: string, n: number): CoaCertificate {
  const key = `${docLabel}#${n}`;
  const ids = certificateIds(text);
  const parsed = parseCoaPdfText(text);
  if (!parsed.ok) {
    // A manifest / invoice prints GF ids too: text that is not a lab
    // certificate is NEVER a certificate (it would "match" every line by id).
    // A text that prints more ids than one certificate carries (lab sample,
    // origin sample, parent batch, batch, inventory) is a summary or a list:
    // it would "match" many lines at once, so it is never one certificate.
    const isCert = looksLikeCertificate(text) && ids.length <= MAX_IDS_PER_CERT;
    return {
      key, docLabel, template: null, labName: null,
      labSampleId: isCert ? ids.find((i) => /^WA-\d{6}-\d{3}$/.test(i)) ?? null : null,
      ids: isCert ? ids : [], sampleName: isCert ? printedSampleName(text) : null, productType: null, passed: null,
      totalThcPct: null, totalCbdPct: null, totalCannabinoidsPct: null, potency: {},
      testedOn: null, releasedOn: null,
      identifiable: isCert && ids.length > 0,
      reason: isCert
        ? parsed.reason
        : ids.length > MAX_IDS_PER_CERT
          ? `this page prints ${ids.length} different ids - a summary or a list, not one certificate`
          : "this text is not a lab certificate",
    };
  }
  const d = parsed.doc;
  if (d.labSampleId) ids.unshift(d.labSampleId.toUpperCase());
  if (d.batchId) ids.push(d.batchId.toUpperCase());
  const uniq = [...new Set(ids)];
  const sampleName = d.sampleName && d.sampleName.trim() ? d.sampleName.trim() : printedSampleName(text);
  const identifiable = uniq.length > 0 || sampleName !== null;
  return {
    key, docLabel, template: d.template, labName: d.labName || null,
    labSampleId: d.labSampleId ?? null,
    ids: uniq, sampleName, productType: d.productType ?? null,
    passed: d.batchPass === "pass" ? true : d.batchPass === "fail" ? false : null,
    totalThcPct: d.summary.totalThcPct ?? potencyRow(d, "total-thc")?.pct ?? null,
    totalCbdPct: d.summary.totalCbdPct ?? potencyRow(d, "total-cbd")?.pct ?? null,
    totalCannabinoidsPct: d.summary.totalCannabinoidsPct ?? potencyRow(d, "total-cannabinoids")?.pct ?? null,
    potency: potencyMap(d),
    testedOn: dateOnly(d.potencyDate),
    releasedOn: dateOnly(d.documentCreated) ?? dateOnly(d.potencyDate),
    identifiable,
    reason: identifiable ? null : "no id and no sample name could be read from this certificate",
  };
}

/** Split + read every certificate in one document's text. */
export function readCoaBundleText(raw: string, docLabel: string): CoaCertificate[] {
  return splitCoaCertificates(raw).map((chunk, i) => readCertificate(chunk, docLabel, i + 1));
}

/** How many certificates in a reading carry an identity (the "did it work" score). */
export function identifiableCount(certs: readonly CoaCertificate[]): number {
  return certs.filter((c) => c.identifiable).length;
}

// ---------------------------------------------------------------------------
// 2. Match
// ---------------------------------------------------------------------------

export function normPhrase(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** "3.5g", "(g)", "1g", "10pk", "50 mg", ".5g", "1/8 oz" - a size, never a product. */
const SIZE_LIKE = /^(?:\(?\s*\d*\.?\d+\s*(?:g|mg|oz|ml|pk|ct|pack|count|ea)?\s*\)?|\(\s*g\s*\)|\d+\s*\/\s*\d+\s*oz)$/i;

function segments(name: string | null | undefined): string[] {
  return String(name ?? "")
    .split(/\s+-\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !SIZE_LIKE.test(s));
}

/**
 * Category / form / potency words. A phrase made ONLY of these (plus numbers)
 * names a KIND of product, never one product: "flower", "pre roll", "rosin
 * cold cure", "ceramic tip infused", "cbg cbc cbd thc 2 2 2 1". Found by the
 * Fix 3.1a test: with two certificates in the email, "flower" singled out the
 * one flower certificate and three different flower lines took it. A product
 * phrase must carry at least one word outside this list.
 */
const GENERIC_WORDS = new Set(
  (
    "flower flowers bud buds bucked pre roll rolls preroll prerolls joint joints blunt blunts infused " +
    "rosin resin live cured cold cure hash kief wax shatter budder badder sauce diamonds crumble sugar " +
    "concentrate concentrates extract extracts cartridge cartridges cart carts vape vapes pod pods " +
    "disposable disposables ceramic glass tip tips edible edibles gummy gummies chocolate chocolates candy " +
    "chew chews beverage beverages drink drinks tincture tinctures topical topicals capsule capsules " +
    "pack packs pk mix grind ground shake trim smalls popcorn lot lots bho distillate hte co2 solventless " +
    "cbd cbg cbn cbc thc thca cbda thcv indica sativa hybrid x and of the with mg g oz ml gram grams " +
    "eighth quarter half ounce ratio multi single strain usable marijuana cannabis infusion"
  ).split(" "),
);

/** True when the phrase names a kind of product, not one product. */
export function isGenericPhrase(phrase: string): boolean {
  const words = phrase.split(" ").filter(Boolean);
  return words.length === 0 || words.every((w) => GENERIC_WORDS.has(w) || /^\d+[a-z]{0,3}$/.test(w));
}

/** The line's product phrases (brand / first segment excluded - a brand is not a product). */
export function linePhrases(line: Pick<CoaLineInput, "product_name" | "strain_name" | "brand_name">): string[] {
  const segs = segments(line.product_name);
  const body = segs.length >= 3 ? segs.slice(1) : segs;
  const brand = normPhrase(line.brand_name);
  const firstSeg = segs.length >= 3 ? normPhrase(segs[0]) : "";
  const out = new Set<string>();
  for (const p of [line.strain_name ?? "", ...body]) {
    const n = normPhrase(p);
    if (n.length < 3) continue;
    if (brand && n === brand) continue;
    if (firstSeg && n === firstSeg) continue;
    if (!/[a-z]/.test(n)) continue;
    if (isGenericPhrase(n)) continue; // a kind of product never identifies one
    out.add(n);
  }
  return [...out];
}

function containsPhrase(hay: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${hay} `.includes(` ${needle} `);
}

/** Every id a parsed line carries (WCIA raw: lab_result_data.lab_result_id, sample_source_id). */
export function lineKnownIds(line: Pick<ParsedLine, "raw" | "lab">): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim().length >= 8) out.add(v.trim().toUpperCase());
    if (typeof v === "number" && Number.isFinite(v)) out.add(String(v));
  };
  const raw = line.raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    add(r.sample_source_id);
    add(r.lab_result_id);
    add(r.labtest_external_identifier);
    const lab = r.lab_result_data;
    if (lab && typeof lab === "object" && !Array.isArray(lab)) {
      const l = lab as Record<string, unknown>;
      add(l.lab_result_id);
      add(l.sample_id);
    }
  }
  add(line.lab?.labtest_external_identifier ?? null);
  return [...out];
}

export function planCoaBundle(certs: readonly CoaCertificate[], lines: readonly CoaLineInput[]): CoaBundlePlan {
  const plan: CoaBundlePlan = { matches: [], unmatchedLines: [], ambiguous: [], unusedCerts: [], unreadableCerts: [], alreadyHadLab: 0 };
  const usable = certs.filter((c) => c.identifiable);
  for (const c of certs) if (!c.identifiable) plan.unreadableCerts.push(c.key);

  const certSegs = new Map<string, string[]>();
  const certName = new Map<string, string>();
  for (const c of usable) {
    certSegs.set(c.key, segments(c.sampleName).map(normPhrase).filter(Boolean));
    certName.set(c.key, normPhrase(c.sampleName));
  }

  const used = new Set<string>();
  for (const line of lines) {
    if (line.hasLab) {
      plan.alreadyHadLab += 1;
      continue;
    }
    // Tier 1: an id printed on the certificate equals an id the line carries.
    const lineIds = new Set(
      [line.lot_code, line.pos_product_key, ...line.knownIds]
        .filter((v): v is string => typeof v === "string" && v.trim().length >= 8)
        .map((v) => v.trim().toUpperCase()),
    );
    const byId = usable.filter((c) => c.ids.some((i) => lineIds.has(i)));
    if (byId.length === 1) {
      const hit = byId[0].ids.find((i) => lineIds.has(i)) as string;
      plan.matches.push({ lineKey: line.key, certKey: byId[0].key, by: "id", evidence: hit });
      used.add(byId[0].key);
      continue;
    }
    if (byId.length > 1) {
      plan.ambiguous.push({ lineKey: line.key, certKeys: byId.map((c) => c.key), by: "id" });
      continue;
    }

    // Tier 2: name. A phrase counts only when it singles out ONE certificate.
    const phrases = linePhrases(line);
    // `multi` = certificates a phrase hit together with others: if no phrase
    // singles one out, the line is AMBIGUOUS (said, never guessed).
    const pickBy = (test: (certKey: string, phrase: string) => boolean): { keys: Set<string>; multi: Set<string>; phrase: string | null } => {
      const keys = new Set<string>();
      const multi = new Set<string>();
      let phrase: string | null = null;
      for (const p of phrases) {
        const hits = usable.filter((c) => test(c.key, p));
        if (hits.length === 1) {
          keys.add(hits[0].key);
          phrase = phrase ?? p;
        } else if (hits.length > 1) {
          for (const h of hits) multi.add(h.key);
        }
      }
      return { keys, multi, phrase };
    };
    const exact = pickBy((k, p) => (certSegs.get(k) ?? []).includes(p));
    let tier = exact;
    if (tier.keys.size === 0) tier = pickBy((k, p) => p.length >= 5 && containsPhrase(certName.get(k) ?? "", p));
    if (tier.keys.size === 1) {
      const certKey = [...tier.keys][0];
      plan.matches.push({ lineKey: line.key, certKey, by: "name", evidence: tier.phrase ?? "" });
      used.add(certKey);
    } else if (tier.keys.size > 1) {
      plan.ambiguous.push({ lineKey: line.key, certKeys: [...tier.keys], by: "name" });
    } else if (exact.multi.size > 0 || tier.multi.size > 0) {
      plan.ambiguous.push({ lineKey: line.key, certKeys: [...new Set([...exact.multi, ...tier.multi])], by: "name" });
    } else {
      plan.unmatchedLines.push(line.key);
    }
  }
  for (const c of usable) if (!used.has(c.key)) plan.unusedCerts.push(c.key);
  return plan;
}

// ---------------------------------------------------------------------------
// 3. ParsedLab + manifest fold
// ---------------------------------------------------------------------------

export const EMAILED_COA_SOURCE = "emailed-coa-pdf";

/** Build the lab result for a certificate - printed values only. */
export function certificateToLab(c: CoaCertificate, by: CoaMatchBy | "manual", evidence: string): ParsedLab {
  const p = c.potency;
  return {
    labtest_external_identifier: c.labSampleId ?? c.ids[0] ?? null,
    lab_name: c.labName,
    tested_on: c.testedOn,
    thc_pct: p["d9-thc"] ?? null,
    cbd_pct: p["cbd"] ?? null,
    thca_pct: p["thca"] ?? null,
    cbda_pct: p["cbda"] ?? null,
    total_thc_pct: c.totalThcPct,
    total_cbd_pct: c.totalCbdPct,
    total_cannabinoids_pct: c.totalCannabinoidsPct,
    potency_json: Object.keys(p).length > 0 ? { ...p } : null,
    terpenes_json: null,
    analytes_json: null,
    passed: c.passed,
    coa_url: null, // the certificate is the emailed PDF itself (archived to the coa bucket)
    coa_release_date: c.releasedOn,
    coa_expire_date: null, // never invented: these certificates print no expiry
    raw: {
      source: EMAILED_COA_SOURCE,
      coa_matched_by: by,
      coa_match_evidence: evidence,
      document: c.docLabel,
      certificate: c.key,
      template: c.template,
      lab_sample_id: c.labSampleId,
      ids: c.ids,
      sample_name: c.sampleName,
      product_type: c.productType,
    },
  };
}

export type CoaFoldResult = {
  manifest: ParsedManifest;
  plan: CoaBundlePlan;
  attached: number;
  byId: number;
  byName: number;
  /** labtest ids attached, per source document (for archiving the right PDF). */
  labIdsByDoc: Record<string, string[]>;
};

/** Parsed manifest lines -> match inputs (key = line index). */
export function linesForMatch(manifest: Pick<ParsedManifest, "lines">): CoaLineInput[] {
  return manifest.lines.map((l, i) => ({
    key: String(i),
    lot_code: l.lot_code,
    pos_product_key: l.pos_product_key,
    product_name: l.product_name,
    strain_name: l.strain_name,
    brand_name: l.brand_name,
    knownIds: lineKnownIds(l),
    hasLab: l.lab != null,
  }));
}

/** Fill EMPTY line labs from the matched certificates (never replaces a lab). PURE. */
export function foldCoaBundle(manifest: ParsedManifest, certs: readonly CoaCertificate[]): CoaFoldResult {
  const plan = planCoaBundle(certs, linesForMatch(manifest));
  const byKey = new Map(certs.map((c) => [c.key, c]));
  const matchByLine = new Map(plan.matches.map((m) => [m.lineKey, m]));
  const labIdsByDoc: Record<string, string[]> = {};
  let byId = 0;
  let byName = 0;
  const lines = manifest.lines.map((line, i) => {
    const m = matchByLine.get(String(i));
    if (!m || line.lab) return line;
    const c = byKey.get(m.certKey);
    if (!c) return line;
    const lab = certificateToLab(c, m.by, m.evidence);
    if (m.by === "id") byId += 1;
    else byName += 1;
    if (lab.labtest_external_identifier) {
      (labIdsByDoc[c.docLabel] ??= []).push(lab.labtest_external_identifier);
    }
    const warnings = [...line.warnings];
    if (m.by === "name") {
      warnings.push(
        `COA matched by product name ("${m.evidence}") to certificate ${lab.labtest_external_identifier ?? c.key} ("${c.sampleName ?? ""}") - verify before accepting.`,
      );
    }
    return { ...line, lab, warnings };
  });
  return { manifest: { ...manifest, lines }, plan, attached: byId + byName, byId, byName, labIdsByDoc };
}

/** One plain sentence for the email log + the delivery timeline. */
export function coaBundleNote(input: {
  docs: number;
  certs: readonly CoaCertificate[];
  lineCount: number;
  plan: CoaBundlePlan;
  lineLabel?: (lineKey: string) => string;
}): string {
  const { plan } = input;
  const byId = plan.matches.filter((m) => m.by === "id").length;
  const byName = plan.matches.length - byId;
  const parts: string[] = [];
  parts.push(
    `COA: read ${input.certs.length} certificate${input.certs.length === 1 ? "" : "s"} from ${input.docs} lab document${input.docs === 1 ? "" : "s"}`,
  );
  const need = input.lineCount - plan.alreadyHadLab;
  if (need === 0) {
    parts.push(`every line already had a lab result (kept - an emailed certificate never replaces one)`);
    if (plan.unreadableCerts.length > 0) parts.push(`${plan.unreadableCerts.length} certificate(s) could not be read`);
    return parts.join("; ") + ".";
  }
  parts.push(
    `attached ${plan.matches.length} of ${need} line${need === 1 ? "" : "s"} without a lab result` +
      (plan.matches.length > 0 ? ` (${byId} by lab id, ${byName} by product name - verify)` : ""),
  );
  const label = input.lineLabel ?? ((k: string) => k);
  if (plan.unmatchedLines.length > 0) {
    const names = plan.unmatchedLines.slice(0, 4).map(label).join("; ");
    parts.push(
      `${plan.unmatchedLines.length} line${plan.unmatchedLines.length === 1 ? " has" : "s have"} no matching certificate (${names}${plan.unmatchedLines.length > 4 ? "; …" : ""}) - attach by hand on the delivery page`,
    );
  }
  if (plan.ambiguous.length > 0) parts.push(`${plan.ambiguous.length} line(s) matched more than one certificate - not attached, choose by hand`);
  if (plan.unreadableCerts.length > 0) parts.push(`${plan.unreadableCerts.length} certificate(s) could not be read`);
  if (plan.alreadyHadLab > 0) parts.push(`${plan.alreadyHadLab} line(s) already had a lab result (kept)`);
  return parts.join("; ") + ".";
}

/** True when the read left something for a person to do. */
export function coaBundleNeedsAttention(plan: CoaBundlePlan): boolean {
  return plan.unmatchedLines.length > 0 || plan.ambiguous.length > 0 || plan.unreadableCerts.length > 0 || plan.matches.some((m) => m.by === "name");
}

export const COA_ATTACH_EVENT = "coa_attach";
export const COA_ATTACH_INCOMPLETE_EVENT = "coa_attach_incomplete";

/** The receiving page's choice label for a certificate. */
export function certificateLabel(c: CoaCertificate): string {
  const id = c.labSampleId ?? c.ids[0] ?? c.key;
  const thc = c.totalThcPct != null ? ` · THC ${c.totalThcPct}%` : "";
  const pass = c.passed === true ? " · PASS" : c.passed === false ? " · FAIL" : "";
  return `${id} · ${c.sampleName ?? "(no sample name)"}${thc}${pass}`;
}

// ---------------------------------------------------------------------------
// 4. Email helpers (pure) - used by stageManifestsFromEmail and the re-read
// ---------------------------------------------------------------------------

/**
 * One label per lab document, unique inside the email (certificate keys are
 * `<label>#n`; two attachments both named "QA.pdf" must never share keys).
 */
export function uniqueDocLabels(names: readonly (string | null | undefined)[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = (n ?? "").trim() || "lab-document.pdf";
    const k = seen.get(base) ?? 0;
    seen.set(base, k + 1);
    return k === 0 ? base : `${base} (${k + 1})`;
  });
}

/** Lab documents that yielded no certificate at all - always said, never console-only. */
export function coaUnreadNote(failures: readonly { label: string; error: string | null }[]): string | null {
  if (failures.length === 0) return null;
  const list = failures
    .slice(0, 4)
    .map((f) => `${f.label}${f.error ? ` (${f.error})` : ""}`)
    .join("; ");
  return `COA: no certificate could be read from ${failures.length} lab document${failures.length === 1 ? "" : "s"}: ${list}${failures.length > 4 ? "; …" : ""} - open the delivery and use "Re-read COAs" or attach by hand.`;
}

/** The timeline event for one staging's COA outcome. */
export function coaAttachEventType(plan: CoaBundlePlan | null, unreadDocs: number): string {
  if (unreadDocs > 0) return COA_ATTACH_INCOMPLETE_EVENT;
  if (!plan) return COA_ATTACH_INCOMPLETE_EVENT;
  // Every line already had a lab (the JSON / a COA Summary carried them):
  // nothing was left to attach, so an unread page is no alarm.
  const open = plan.matches.length + plan.unmatchedLines.length + plan.ambiguous.length;
  if (open === 0 && plan.alreadyHadLab > 0) return COA_ATTACH_EVENT;
  return coaBundleNeedsAttention(plan) ? COA_ATTACH_INCOMPLETE_EVENT : COA_ATTACH_EVENT;
}

// ---------------------------------------------------------------------------
// 5. Receiving page (re-read + attach by hand) - pure parts
// ---------------------------------------------------------------------------

export type CoaLotRow = {
  id: string;
  product_name: string | null;
  lot_code: string | null;
  pos_product_key: string | null;
  strain_name: string | null;
  lab_result_id: string | null;
  status: string | null;
};

/**
 * A delivery's lots -> match inputs (key = lot id). A destroyed lot is never
 * offered a lab result (counted as "already has one" so it is never named
 * as missing either). `vendorIds` = the vendor's own inventory id per lot.
 */
export function lotsForMatch(lots: readonly CoaLotRow[], vendorIds?: ReadonlyMap<string, string | null>): CoaLineInput[] {
  return lots.map((l) => ({
    key: l.id,
    lot_code: l.lot_code,
    pos_product_key: l.pos_product_key,
    product_name: l.product_name,
    strain_name: l.strain_name,
    brand_name: null,
    knownIds: [vendorIds?.get(l.id) ?? null].filter((v): v is string => typeof v === "string" && v.trim().length >= 8).map((v) => v.trim().toUpperCase()),
    hasLab: l.lab_result_id != null || l.status === "destroyed",
  }));
}

/** What the COA cell says about where a line's lab result came from. */
export type LabProvenance = { source: string | null; matchedBy: string | null; evidence: string | null; sampleName: string | null; document: string | null };

export function labProvenance(source: string | null, raw: unknown): LabProvenance {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const s = (k: string) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim() : null);
  return { source, matchedBy: s("coa_matched_by"), evidence: s("coa_match_evidence"), sampleName: s("sample_name"), document: s("document") };
}

/** The COA cell's words: a name match always says "verify". */
export function coaCellText(p: LabProvenance | null | undefined): { text: string; verify: boolean } {
  if (!p) return { text: "\u2705", verify: false };
  if (p.matchedBy === "name") return { text: "\u2705 matched by name \u2014 verify", verify: true };
  if (p.matchedBy === "id") return { text: "\u2705 matched by lab id", verify: false };
  if (p.matchedBy === "manual") return { text: "\u2705 attached by hand", verify: false };
  return { text: "\u2705", verify: false };
}

/**
 * Pick the certificate a person chose. The form carries the key AND the lab
 * test id that was on screen: if the documents now read differently (a re-read
 * re-numbered them) the pick is refused - never attach a different certificate
 * than the one the person saw.
 */
export function pickCertificate(
  certs: readonly CoaCertificate[],
  key: string,
  shownLabtestId: string,
): { ok: true; cert: CoaCertificate } | { ok: false; reason: string } {
  const c = certs.find((x) => x.key === key);
  if (!c) return { ok: false, reason: "That certificate is no longer in this delivery's documents. Reload the page and choose again." };
  if (!c.identifiable) return { ok: false, reason: "That certificate could not be read (no lab id or sample name). Use the lot page to attach it by its lab test id." };
  const id = c.labSampleId ?? c.ids[0] ?? null;
  if (!id || id !== shownLabtestId) return { ok: false, reason: "The documents read differently than when the page was opened. Reload the page and choose again." };
  return { ok: true, cert: c };
}

/** The certificates a person may choose from (readable ones, document order). */
export function choosableCertificates(certs: readonly CoaCertificate[]): { key: string; labtestId: string; label: string }[] {
  return certs
    .filter((c) => c.identifiable && (c.labSampleId ?? c.ids[0]))
    .map((c) => ({ key: c.key, labtestId: (c.labSampleId ?? c.ids[0]) as string, label: certificateLabel(c) }));
}
