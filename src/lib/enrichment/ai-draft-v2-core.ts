/**
 * src/lib/enrichment/ai-draft-v2-core.ts  (D244 E-4 - AI drafting v2)
 *
 * Owner (D244, verbatim): "Please complete another 3 slices. Follow the
 * standing rules."  Strategy doc docs/sop-program/D244-enrichment-powerhouse-strategy.md
 * slice E-4: one "Enrich this product" call that drafts EVERY field at once,
 * with per-field confidence, the evidence each field rests on, a "best guess"
 * flag, a diff against what is on record, and "Accept all >= 85%".
 *
 * Also closes two retrieval findings:
 *   F-09   strain matching was a raw substring test ("dream" inside anything);
 *          now word-boundary hits first, then the fuzzy matcher with a strict
 *          floor + lead so typos only match when unambiguous.
 *   F-09b  the KB product lookup needed the EXACT slug; now it also tries the
 *          name without the pack size and without the brand prefix.
 *
 * Owner answers (D244 round 2, verbatim):
 *   Q3: "lets drop it to 80%."  -> ACCEPT_ALL_THRESHOLD = 80.
 *   Q4: "best guesses should auto accepted, but flagged so we can take a
 *       closer look once we have time to." -> accept-all now includes best
 *       guesses; each stays flagged (`|best-guess` on the accepted row) and
 *       is listed under "Needs a closer look" until a person marks it
 *       checked (`|checked`).
 *   Calibration: "I have noticed there are times where the ai is 100%
 *       accurate yet gives itself a 50% confidence result. if you can make it
 *       trust itself better would be great." -> calibrateConfidence: a field
 *       resting on direct evidence for THIS product (and not flagged a guess
 *       by the model) is raised to a floor of 80 + 5 per extra direct source.
 *
 * Pure: no I/O. Self-tests at the bottom (registered in
 * scripts/compliance/run-pure-selftests.ts with an exact floor).
 */

import { dashedSlug } from "@/lib/catalog/slug-core";
import {
  matchStrainToKb,
  similarity,
  type MatchableStrain,
  type StrainMatchResult,
} from "@/lib/ai/kb/strain-matcher";

/** "Accept all >= N%". Owner Q3 answered (round 2): "lets drop it to 80%." */
export const ACCEPT_ALL_THRESHOLD = 80;
/** Calibration: one direct source raises a confident answer to this floor... */
export const DIRECT_EVIDENCE_FLOOR = 80;
/** ...plus this much per extra distinct direct source... */
export const DIRECT_EVIDENCE_STEP = 5;
/** ...never above this (the model can still say 100 itself). */
export const DIRECT_EVIDENCE_FLOOR_MAX = 95;
/** Below this the model is voicing a real doubt; we keep its number. */
export const CALIBRATION_MIN_RAW = 50;
/** A best guess (no direct evidence, or model-flagged) never scores above this. */
export const BEST_GUESS_CAP = 70;
/** A field that cites no offered evidence at all never scores above this. */
export const NO_EVIDENCE_CAP = 40;
/**
 * Fuzzy strain floor. Measured: "Blue Dreem" scores Blue Diamond 0.91 and
 * Blue Dream 0.826 - a 0.9 floor would have picked the WRONG strain. 0.94
 * only lets near-identical spellings through ("Lemon Hazee" -> Lemon Haze 0.986).
 */
export const STRAIN_MIN_SCORE = 0.94;
/** The top fuzzy candidate must beat the next different strain by this much. */
export const STRAIN_MIN_LEAD = 0.03;
/** Aliases shorter than this (single word) are too generic to trust. */
export const STRAIN_ALIAS_MIN = 5;
/** Most evidence ids kept per field. */
export const MAX_EVIDENCE_PER_FIELD = 6;
/** Most attached photos fed to the prompt. */
export const MAX_PHOTOS = 3;

export const ALL_FIELDS = [
  "display_name",
  "description",
  "short_description",
  "seo",
  "sensory",
  "effects",
  "tags",
  // D244 R-2 (owner: "draft strain type and potency from the lot/ coa"):
  "strain_type",
  "potency",
] as const;
export type DraftFieldKey = (typeof ALL_FIELDS)[number];

export const FIELD_LABEL: Record<DraftFieldKey, string> = {
  display_name: "Display name",
  description: "Description",
  short_description: "Short description",
  seo: "SEO title + meta",
  sensory: "Aroma / flavor / terpenes",
  effects: "Effects",
  tags: "Tags",
  strain_type: "Strain type",
  potency: "Potency (THC / CBD)",
};

/**
 * D244 R-2: label facts. Potency is printed on the card next to the price,
 * so a guessed number is never taken by "Accept all"; a person accepts it
 * (or types the right one on the grid). Strain type best guesses follow the
 * owner's round-2 rule (accepted, flagged).
 */
export const NEVER_AUTO_GUESS: ReadonlySet<string> = new Set(["potency"]);

export function isDraftFieldKey(v: unknown): v is DraftFieldKey {
  return typeof v === "string" && (ALL_FIELDS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Strain matching (F-09)
// ---------------------------------------------------------------------------

/** lowercase; every non-alphanumeric run -> one space; trimmed. */
function plain(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function wordHit(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Pick from a fuzzy matcher result: its own confident `best`, else the top
 * candidate only when it clears STRAIN_MIN_SCORE AND leads the next DIFFERENT
 * strain by STRAIN_MIN_LEAD. Otherwise null (ambiguous -> no strain facts).
 */
export function chooseStrainMatch<T extends MatchableStrain>(r: StrainMatchResult<T> | null | undefined): T | null {
  if (!r) return null;
  if (r.best) return r.best.strain;
  const top = r.candidates[0];
  if (!top || top.score < STRAIN_MIN_SCORE) return null;
  const next = r.candidates.find((c) => c.strain.slug !== top.strain.slug);
  if (next && top.score - next.score < STRAIN_MIN_LEAD) return null;
  return top.strain;
}

export type StrainTextMatch<T> = { strain: T; confidence: number; method: "word" | "alias" | "fuzzy" };

/**
 * Find the strain named in the strain field / product name. Word-boundary name
 * or slug hits first (longest name wins, so "Blue Dream" beats "Dream"), then
 * long aliases, then the strict fuzzy fallback.
 */
export function strainMatchFromText<T extends MatchableStrain>(
  strains: T[],
  facts: { strainName?: string | null; name?: string | null },
): StrainTextMatch<T> | null {
  const haystack = `${plain(facts.strainName)} ${plain(facts.name)}`.trim();
  if (!haystack) return null;
  const sorted = [...strains].sort((a, b) => b.name.length - a.name.length);
  for (const s of sorted) {
    const keys = [plain(s.name), plain(s.slug)].filter((k) => k.length >= 3);
    if (keys.some((k) => wordHit(haystack, k))) return { strain: s, confidence: 1, method: "word" };
  }
  for (const s of sorted) {
    for (const a of s.aliases ?? []) {
      const k = plain(a);
      const multi = k.includes(" ");
      if (!(k.length >= STRAIN_ALIAS_MIN || (multi && k.length >= 4))) continue;
      if (wordHit(haystack, k)) return { strain: s, confidence: 0.95, method: "alias" };
    }
  }
  const raw = matchStrainToKb({ strainName: facts.strainName ?? null, productName: facts.name ?? null }, strains);
  // The matcher's own "contained"/"alias" hits are exactly the loose substring
  // + short-alias behaviour F-09 removes ("Daydreamer" contains "Dream",
  // alias "bd" in "BD Cart"). So every candidate is RE-SCORED on whole-query
  // spelling similarity, aliases dropped, and the strict floor/lead applied.
  const q = raw.normalizedQuery;
  const candidates = raw.candidates
    .filter((c) => c.method !== "alias")
    .map((c) => ({ ...c, score: similarity(q, plain(c.strain.name)), method: "fuzzy" as const }))
    .sort((a, b) => b.score - a.score);
  const r: StrainMatchResult<T> = { ...raw, best: null, candidates };
  const picked = chooseStrainMatch(r);
  if (!picked) return null;
  const score = r.candidates.find((c) => c.strain.slug === picked.slug)?.score ?? STRAIN_MIN_SCORE;
  return { strain: picked, confidence: Math.min(score, 0.9), method: "fuzzy" };
}

// ---------------------------------------------------------------------------
// KB product slug candidates (F-09b)
// ---------------------------------------------------------------------------

const SIZE_RE =
  /\b\d+(?:\.\d+)?\s*(?:g|gram|grams|mg|ml|oz|ounce|pk|pack|ct|count)\b|\b\d+\/\d+\s*(?:oz)?\b|\(\s*\d+\s*(?:pk|pack|ct)?\s*\)/gi;

function stripSize(name: string): string {
  return name.replace(SIZE_RE, " ").replace(/\s+/g, " ").trim();
}

function stripBrand(name: string, brand: string | null | undefined): string {
  const b = String(brand ?? "").trim();
  if (!b) return name;
  const esc = b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return name.replace(new RegExp(`^\\s*${esc}\\s*[-:|/–—]*\\s*`, "i"), "").trim();
}

/**
 * kb_products.product_slug candidates for a POS name, most specific first:
 * raw, without pack size, without the brand/vendor prefix, without both.
 */
export function kbProductSlugCandidates(
  name: string | null | undefined,
  brand?: string | null,
  vendor?: string | null,
): string[] {
  const raw = String(name ?? "").trim();
  if (!raw) return [];
  const noSize = stripSize(raw);
  const forms = [raw, noSize];
  for (const who of [brand, vendor]) {
    if (!who) continue;
    forms.push(stripBrand(raw, who), stripBrand(noSize, who));
  }
  const out: string[] = [];
  for (const f of forms) {
    const s = dashedSlug(f);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Photo evidence
// ---------------------------------------------------------------------------

export type PhotoFacts = {
  visible_text?: string | null;
  product_name?: string | null;
  pack_size?: string | null;
  ai_description?: string | null;
  ai_caption?: string | null;
};

function clip(s: string | null | undefined, n: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Prompt lines for up to MAX_PHOTOS attached photos; each is evidence `photo:N`. */
export function photoFactLines(photos: PhotoFacts[]): { lines: string[]; ids: string[] } {
  const lines: string[] = [];
  const ids: string[] = [];
  let n = 0;
  for (const p of photos) {
    if (n >= MAX_PHOTOS) break;
    const parts: string[] = [];
    const vt = clip(p.visible_text, 200);
    if (vt) parts.push(`the package reads "${vt}"`);
    const pn = clip(p.product_name, 80);
    if (pn) parts.push(`filed as "${pn}"`);
    const ps = clip(p.pack_size, 30);
    if (ps) parts.push(`pack size ${ps}`);
    const desc = clip(p.ai_description || p.ai_caption, 240);
    if (desc) parts.push(`it shows: ${desc}`);
    if (parts.length === 0) continue;
    n += 1;
    lines.push(`[photo:${n}] Attached photo ${n}: ${parts.join("; ")}`);
    ids.push(`photo:${n}`);
  }
  return { lines, ids };
}

// ---------------------------------------------------------------------------
// Per-field normalization
// ---------------------------------------------------------------------------

/** Evidence that actually states facts about THIS product (vs category norms). */
export function isDirectEvidence(id: string): boolean {
  return (
    id === "pos" ||
    id === "vendor" ||
    id.startsWith("photo:") ||
    id.startsWith("kb:product:") ||
    id.startsWith("kb:brand") ||
    // D244 R-2: this product's own lots and lab certificates.
    id.startsWith("lot:") ||
    id.startsWith("coa:")
  );
}

export type DraftMeta = { confidence: number; evidence: string[]; bestGuess: boolean };

/**
 * Round 2 calibration. Models under-state confidence on facts they copied
 * straight from the evidence (the owner saw "100% accurate" fields at 50%).
 * When a field cites direct evidence for THIS product, the model did not
 * call it a guess, and its own number is >= CALIBRATION_MIN_RAW, raise it to
 * 80 (+5 per extra distinct direct source, max 95). Never lowers a number.
 */
export function calibrateConfidence(raw: number, directSources: number, modelSaidGuess: boolean): number {
  if (modelSaidGuess || directSources < 1 || raw < CALIBRATION_MIN_RAW) return raw;
  const floor = Math.min(DIRECT_EVIDENCE_FLOOR_MAX, DIRECT_EVIDENCE_FLOOR + DIRECT_EVIDENCE_STEP * (directSources - 1));
  return Math.max(raw, floor);
}

/**
 * Clamp what the model said about a field into something we can trust:
 * evidence limited to ids we actually offered; confidence on a 0..100 scale;
 * calibrated up when direct evidence backs it (calibrateConfidence); best
 * guess when the model said so OR nothing direct backs it (capped at 70);
 * no evidence at all caps at 40.
 */
export function normalizeDraftField(
  _key: DraftFieldKey,
  raw: { confidence?: unknown; evidence?: unknown; best_guess?: unknown },
  offered: string[],
): DraftMeta {
  const offeredSet = new Set(offered);
  const ev = Array.isArray(raw.evidence) ? raw.evidence : [];
  const evidence: string[] = [];
  for (const e of ev) {
    const id = String(e ?? "").trim();
    if (id && offeredSet.has(id) && !evidence.includes(id)) evidence.push(id);
    if (evidence.length >= MAX_EVIDENCE_PER_FIELD) break;
  }
  let c = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? raw.confidence : 0;
  if (c > 0 && c <= 1) c *= 100;
  c = Math.max(0, Math.min(100, Math.round(c)));
  const direct = evidence.filter(isDirectEvidence).length;
  const bestGuess = raw.best_guess === true || direct === 0;
  c = calibrateConfidence(c, direct, raw.best_guess === true);
  if (bestGuess) c = Math.min(c, BEST_GUESS_CAP);
  if (evidence.length === 0) c = Math.min(c, NO_EVIDENCE_CAP);
  return { confidence: c, evidence, bestGuess };
}

/** ai_suggestions.source for a v2 draft: `ai2:<ids,…>` plus `|best-guess`. */
export function encodeEvidenceSource(meta: Pick<DraftMeta, "evidence" | "bestGuess">): string {
  return `ai2:${meta.evidence.join(",")}${meta.bestGuess ? "|best-guess" : ""}`;
}

/** Flags after the evidence list: `|best-guess` (from the draft), `|checked` (a person looked). */
export const CHECKED_FLAG = "checked";

export function parseEvidenceSource(source: string | null | undefined): {
  v2: boolean;
  evidence: string[];
  bestGuess: boolean;
  checked: boolean;
  /** D244 R-2: a person typed over the draft before accepting it. */
  edited: boolean;
} {
  const s = String(source ?? "");
  if (!s.startsWith("ai2:")) return { v2: false, evidence: [], bestGuess: false, checked: false, edited: false };
  const [list, ...flags] = s.slice(4).split("|");
  return {
    v2: true,
    evidence: (list ?? "").split(",").map((x) => x.trim()).filter(Boolean),
    bestGuess: flags.includes("best-guess"),
    checked: flags.includes(CHECKED_FLAG),
    edited: flags.includes("edited"),
  };
}

/** The source after a person pressed "Looks right" on an accepted best guess. */
export function markCheckedSource(source: string | null | undefined): string | null {
  const s = String(source ?? "");
  if (!s.startsWith("ai2:")) return null;
  return parseEvidenceSource(s).checked ? s : `${s}|${CHECKED_FLAG}`;
}

/** An accepted (now live) best guess nobody has looked at yet. */
export function needsCloserLook(r: { status: string; source?: string | null }): boolean {
  if (r.status !== "accepted") return false;
  const ev = parseEvidenceSource(r.source);
  return ev.v2 && ev.bestGuess && !ev.checked;
}

/** Human chip label for an evidence id. */
export function evidenceLabel(id: string): string {
  if (id === "pos") return "POS record";
  if (id === "vendor") return "Vendor";
  if (id.startsWith("photo:")) return `Photo ${id.slice(6)}`;
  if (id.startsWith("lot:")) return `Lot ${id.slice(4)}`;
  if (id.startsWith("coa:")) return `Lab certificate ${id.slice(4)}`;
  if (id.startsWith("kb:product:")) return id.endsWith("draft") ? "KB product (draft)" : "KB product";
  if (id.startsWith("kb:brand")) return "KB brand";
  if (id.startsWith("kb:strain:")) return `Strain: ${id.slice(10)}`;
  if (id.startsWith("kb:category:")) return `Category: ${id.slice(12)}`;
  if (id.startsWith("kb:terpene:")) return `Terpene: ${id.slice(11)}`;
  if (id.startsWith("kb:effect:")) return `Effect: ${id.slice(10)}`;
  if (id.startsWith("kb:")) return `KB ${id.slice(3).split(":")[0]}`;
  return id;
}

// ---------------------------------------------------------------------------
// Accept all >= threshold
// ---------------------------------------------------------------------------

export type SuggestionLite = {
  id: string;
  field_key: string;
  status: string;
  confidence?: number | null;
  source?: string | null;
  created_at: string;
};

/**
 * Is ONE pending v2 draft taken by "Accept all"? A best guess always is
 * (owner Q4, round 2: "best guesses should auto accepted, but flagged"),
 * unless the caller turns that off; anything else needs >= threshold%.
 */
export function isAcceptAllCandidate(
  r: { confidence?: number | null; source?: string | null; field_key?: string },
  threshold = ACCEPT_ALL_THRESHOLD,
  opts: { bestGuesses?: boolean } = {},
): boolean {
  const ev = parseEvidenceSource(r.source);
  if (!ev.v2) return false;
  if (ev.bestGuess) return opts.bestGuesses !== false && !NEVER_AUTO_GUESS.has(String(r.field_key ?? ""));
  return Math.round((r.confidence ?? 0) * 100) >= threshold;
}

/**
 * Ids to accept for "Accept all >= N%": the NEWEST pending v2 suggestion per
 * field when isAcceptAllCandidate says so. Best guesses are included and stay
 * flagged on the accepted row (see needsCloserLook).
 */
export function acceptAllEligible(rows: SuggestionLite[], threshold = ACCEPT_ALL_THRESHOLD, opts: { bestGuesses?: boolean } = {}): string[] {
  const newest = new Map<string, SuggestionLite>();
  for (const r of rows) {
    if (r.status !== "pending" || !isDraftFieldKey(r.field_key)) continue;
    const cur = newest.get(r.field_key);
    if (!cur || r.created_at > cur.created_at) newest.set(r.field_key, r);
  }
  const out: string[] = [];
  for (const key of ALL_FIELDS) {
    const r = newest.get(key);
    if (!r) continue;
    if (isAcceptAllCandidate(r, threshold, opts)) out.push(r.id);
  }
  return out;
}

/** A stored sensory JSON value as one readable line ("" when unreadable/empty). */
export function sensoryText(value: string | null | undefined): string {
  try {
    const v = JSON.parse(String(value ?? "")) as Record<string, unknown>;
    const list = (k: string) => (Array.isArray(v?.[k]) ? (v[k] as unknown[]).map(String).filter(Boolean) : []);
    const parts = [
      list("aroma_notes").length ? `Aroma: ${list("aroma_notes").join(", ")}` : "",
      list("flavor_notes").length ? `Flavor: ${list("flavor_notes").join(", ")}` : "",
      list("terpenes").length ? `Terpenes: ${list("terpenes").join(", ")}` : "",
    ].filter(Boolean);
    return parts.join(" · ");
  } catch {
    return "";
  }
}

/** Compare a proposed value with what is on record. */
export function fieldDiff(current: string | null | undefined, proposed: string | null | undefined): "new" | "same" | "changed" {
  const c = String(current ?? "").replace(/\s+/g, " ").trim();
  const p = String(proposed ?? "").replace(/\s+/g, " ").trim();
  if (!c) return "new";
  return c.toLowerCase() === p.toLowerCase() ? "same" : "changed";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runAiDraftV2Tests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`ai-draft-v2-core FAIL: ${label}`);
    }
  };
  const eq = (a: unknown, b: unknown, label: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

  const S: MatchableStrain[] = [
    { slug: "blue dream", name: "Blue Dream", aliases: ["bd"] },
    { slug: "blue diamond", name: "Blue Diamond", aliases: [] },
    { slug: "dream", name: "Dream", aliases: [] },
    { slug: "lemon haze", name: "Lemon Haze", aliases: [] },
    { slug: "girl scout cookies", name: "Girl Scout Cookies", aliases: ["gsc", "cookies kush"] },
    { slug: "og kush", name: "OG Kush", aliases: ["og"] },
  ];

  // strain matching
  eq(strainMatchFromText(S, { name: "Phat Panda Blue Dream 3.5g" })?.strain.slug, "blue dream", "longest word hit");
  eq(strainMatchFromText(S, { name: "Phat Panda Blue Dream 3.5g" })?.confidence, 1, "word hit conf 1");
  eq(strainMatchFromText(S, { strainName: "Blue Dream", name: "Flower" })?.strain.slug, "blue dream", "strain field");
  eq(strainMatchFromText(S, { name: "Daydreamer Pre-Roll" }), null, "no substring 'dream' inside daydreamer");
  eq(strainMatchFromText(S, { name: "Cookies Kush 1g" })?.method, "alias", "multi-word alias");
  eq(strainMatchFromText(S, { name: "BD Cart" }), null, "short alias ignored");
  eq(strainMatchFromText(S, { name: "Lemon Hazee 1g" })?.strain.slug, "lemon haze", "typo fuzzy");
  eq(strainMatchFromText(S, { name: "Lemon Hazee 1g" })?.method, "fuzzy", "typo method");
  ok((strainMatchFromText(S, { name: "Lemon Hazee 1g" })?.confidence ?? 1) <= 0.9, "fuzzy conf capped");
  eq(strainMatchFromText(S, { name: "Blue Dreem" }), null, "ambiguous typo -> null");
  eq(strainMatchFromText(S, { name: "" }), null, "empty");
  eq(strainMatchFromText(S, { name: "OG Kush" })?.strain.slug, "og kush", "og kush word");

  const cand = (slug: string, score: number) => ({ strain: { slug, name: slug }, score, method: "fuzzy" as const, reason: "" });
  eq(chooseStrainMatch(null), null, "choose null");
  eq(chooseStrainMatch({ best: cand("a", 0.99), candidates: [cand("a", 0.99)], needsReview: false, normalizedQuery: "" })?.slug, "a", "choose best");
  eq(chooseStrainMatch({ best: null, candidates: [cand("a", 0.95), cand("b", 0.8)], needsReview: true, normalizedQuery: "" })?.slug, "a", "choose clear lead");
  eq(chooseStrainMatch({ best: null, candidates: [cand("a", 0.95), cand("b", 0.94)], needsReview: true, normalizedQuery: "" }), null, "choose no lead");
  eq(chooseStrainMatch({ best: null, candidates: [cand("a", 0.93)], needsReview: true, normalizedQuery: "" }), null, "choose below floor");
  eq(chooseStrainMatch({ best: null, candidates: [cand("a", 0.96), cand("a", 0.955), cand("b", 0.5)], needsReview: true, normalizedQuery: "" })?.slug, "a", "lead vs next different slug");

  // slug candidates
  eq(kbProductSlugCandidates("Phat Panda Blue Dream 3.5g", "Phat Panda"), ["phat-panda-blue-dream-3-5g", "phat-panda-blue-dream", "blue-dream-3-5g", "blue-dream"], "slugs brand+size");
  eq(kbProductSlugCandidates("Fweedom - Blue Dream", "Fweedom"), ["fweedom-blue-dream", "blue-dream"], "slugs dash brand");
  eq(kbProductSlugCandidates("Blue Dream", null, null), ["blue-dream"], "slugs plain");
  eq(kbProductSlugCandidates("", "x"), [], "slugs empty");
  eq(kbProductSlugCandidates("Grower X Gummies 100mg (10pk)", null, "Grower X").includes("gummies"), true, "vendor prefix + size");

  // photos
  const ph = photoFactLines([
    { visible_text: "BLUE DREAM 3.5G", product_name: "Blue Dream", pack_size: "3.5g", ai_description: "A jar of green flower" },
    {},
    { ai_caption: "Pre-roll pack" },
    { visible_text: "x" },
    { visible_text: "y" },
  ]);
  eq(ph.ids, ["photo:1", "photo:2", "photo:3"], "photo ids skip empty, max 3");
  ok(ph.lines[0].startsWith('[photo:1] Attached photo 1: the package reads "BLUE DREAM 3.5G"; filed as "Blue Dream"; pack size 3.5g; it shows: A jar'), "photo line 1");
  ok(ph.lines[1].includes("it shows: Pre-roll pack"), "caption fallback");
  eq(photoFactLines([]).lines.length, 0, "no photos");

  // evidence
  ok(isDirectEvidence("pos") && isDirectEvidence("photo:2") && isDirectEvidence("kb:product:published") && isDirectEvidence("kb:brand:x"), "direct ids");
  ok(!isDirectEvidence("kb:strain:blue dream") && !isDirectEvidence("kb:category:flower"), "indirect ids");
  const offered = ["pos", "vendor", "photo:1", "kb:strain:blue dream"];
  eq(normalizeDraftField("description", { confidence: 0.92, evidence: ["pos", "kb:strain:blue dream", "made-up"] }, offered), { confidence: 92, evidence: ["pos", "kb:strain:blue dream"], bestGuess: false }, "norm 0..1 scale + filter");
  // round 2 calibration: "100% accurate yet ... 50% confidence"
  eq(normalizeDraftField("display_name", { confidence: 50, evidence: ["pos"] }, offered).confidence, 80, "calibrate: one direct source -> 80");
  eq(normalizeDraftField("display_name", { confidence: 55, evidence: ["pos", "photo:1"] }, offered).confidence, 85, "calibrate: two direct -> 85");
  eq(normalizeDraftField("display_name", { confidence: 40, evidence: ["pos", "photo:1"] }, offered).confidence, 40, "calibrate: real doubt (<50) kept");
  eq(normalizeDraftField("display_name", { confidence: 60, evidence: ["pos"], best_guess: true }, offered).confidence, 60, "calibrate: model-said guess never raised");
  eq([calibrateConfidence(97, 1, false), calibrateConfidence(50, 9, false), calibrateConfidence(70, 0, false)], [97, 95, 70], "calibrate never lowers, caps 95, needs direct");
  eq(normalizeDraftField("description", { confidence: 95, evidence: ["kb:strain:blue dream"] }, offered), { confidence: 70, evidence: ["kb:strain:blue dream"], bestGuess: true }, "indirect -> best guess cap");
  eq(normalizeDraftField("tags", { confidence: 90, evidence: [] }, offered), { confidence: 40, evidence: [], bestGuess: true }, "no evidence cap");
  eq(normalizeDraftField("seo", { confidence: 99, evidence: ["pos"], best_guess: true }, offered).confidence, 70, "model best guess cap");
  eq(normalizeDraftField("seo", { confidence: 250, evidence: ["pos"] }, offered).confidence, 100, "clamp high");
  eq(normalizeDraftField("seo", { confidence: "x", evidence: "pos" }, offered).confidence, 0, "junk input");
  eq(encodeEvidenceSource({ evidence: ["pos", "photo:1"], bestGuess: true }), "ai2:pos,photo:1|best-guess", "encode");
  eq(parseEvidenceSource("ai2:pos,photo:1|best-guess"), { v2: true, evidence: ["pos", "photo:1"], bestGuess: true, checked: false, edited: false }, "parse");
  eq(parseEvidenceSource("ai"), { v2: false, evidence: [], bestGuess: false, checked: false, edited: false }, "parse legacy");
  eq(parseEvidenceSource("ai2:pos|best-guess|checked"), { v2: true, evidence: ["pos"], bestGuess: true, checked: true, edited: false }, "parse checked");
  eq([markCheckedSource("ai2:pos|best-guess"), markCheckedSource("ai2:pos|best-guess|checked"), markCheckedSource("ai")], ["ai2:pos|best-guess|checked", "ai2:pos|best-guess|checked", null], "mark checked idempotent");
  eq(
    [needsCloserLook({ status: "accepted", source: "ai2:pos|best-guess" }), needsCloserLook({ status: "pending", source: "ai2:pos|best-guess" }), needsCloserLook({ status: "accepted", source: "ai2:pos|best-guess|checked" }), needsCloserLook({ status: "accepted", source: "ai2:pos" })],
    [true, false, false, false],
    "needs a closer look = accepted + best guess + not checked",
  );
  // D244 R-2: lots + lab certificates are direct evidence; a guessed potency is never auto-accepted.
  ok(isDirectEvidence("lot:1") && isDirectEvidence("coa:2"), "R-2 lot/coa direct");
  eq([evidenceLabel("lot:1"), evidenceLabel("coa:2")], ["Lot 1", "Lab certificate 2"], "R-2 lot/coa labels");
  ok(!isAcceptAllCandidate({ field_key: "potency", confidence: 0.7, source: "ai2:kb:category:flower|best-guess" }), "R-2 guessed potency not auto");
  ok(isAcceptAllCandidate({ field_key: "potency", confidence: 0.9, source: "ai2:coa:1" }), "R-2 lab potency auto at 90");
  ok(isAcceptAllCandidate({ field_key: "strain_type", confidence: 0.6, source: "ai2:kb:strain:x|best-guess" }), "R-2 strain-type guess follows owner rule");
  ok(parseEvidenceSource("ai2:pos|best-guess|checked|edited").edited && !needsCloserLook({ status: "accepted", source: "ai2:pos|best-guess|checked|edited" }), "R-2 edited = checked");
  eq(ALL_FIELDS.slice(-2), ["strain_type", "potency"], "R-2 fields");
  eq([evidenceLabel("pos"), evidenceLabel("photo:2"), evidenceLabel("kb:strain:blue dream"), evidenceLabel("kb:product:draft")], ["POS record", "Photo 2", "Strain: blue dream", "KB product (draft)"], "labels");

  // accept-all
  const rows: SuggestionLite[] = [
    { id: "a", field_key: "description", status: "pending", confidence: 0.9, source: "ai2:pos", created_at: "2025-01-02" },
    { id: "a0", field_key: "description", status: "pending", confidence: 0.99, source: "ai2:pos", created_at: "2025-01-01" },
    { id: "b", field_key: "tags", status: "pending", confidence: 0.84, source: "ai2:pos", created_at: "2025-01-02" },
    { id: "c", field_key: "seo", status: "pending", confidence: 0.7, source: "ai2:pos|best-guess", created_at: "2025-01-02" },
    { id: "d", field_key: "effects", status: "pending", confidence: 0.95, source: "ai", created_at: "2025-01-02" },
    { id: "e", field_key: "display_name", status: "accepted", confidence: 0.99, source: "ai2:pos", created_at: "2025-01-02" },
    { id: "f", field_key: "short_description", status: "pending", confidence: 0.85, source: "ai2:photo:1", created_at: "2025-01-02" },
  ];
  eq(acceptAllEligible(rows), ["a", "f", "c", "b"], "accept-all: newest, >=80, best guesses included (flagged), v2 only, ALL_FIELDS order");
  eq(acceptAllEligible(rows, 85, { bestGuesses: false }), ["a", "f"], "threshold + best guesses off");
  eq(ACCEPT_ALL_THRESHOLD, 80, "owner Q3: 80");
  eq([fieldDiff("", "x"), fieldDiff("Hello  world", "hello world"), fieldDiff("a", "b")], ["new", "same", "changed"], "diff");

  eq(sensoryText('{"aroma_notes":["citrus"],"flavor_notes":[],"terpenes":["limonene"]}'), "Aroma: citrus · Terpenes: limonene", "sensory text");
  eq([sensoryText("nope"), sensoryText(null)], ["", ""], "sensory text junk");

  return { passed, failed };
}
