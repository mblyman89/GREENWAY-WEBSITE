/**
 * src/lib/ai/kb/strain-lookup-core.ts
 *
 * PURE core for the Gemini STRAIN look-up on the Knowledge Base Strain Editor.
 *
 * Michael's brief: "one job — find strain info." Enter a strain name, Gemini
 * reads the live web, and we fill the roomy Add/Edit strain form for review
 * before anything is saved. Unlike the product look-up (which targets a whole
 * SKU: description, images, size, potency ratio, …), this look-up targets the
 * exact columns a `kb_strains` row has, and — critically — it parses a real
 * `terpenes[]` array so the colorful terpene pills on the product page actually
 * populate (even for edibles that reference the strain).
 *
 * This module is PURE and deterministic:
 *   • SHAPE_HINT / STRAIN_LOOKUP_SYSTEM — the prompt scaffolding.
 *   • coerceRawStrainLookup — tolerant parse of the model's JSON into a known shape.
 *   • postProcessStrainLookup — sanitize + compliance-gate the fields. The
 *     summary runs through checkCompliance (WA I-502: sensory/factual only, no
 *     medical/curative claims); a non-compliant summary is dropped, never
 *     "cleaned up" into a guess. Terpene/aroma/flavor lists are de-duped and
 *     lower-cased to match how the KB stores them. Nothing is invented: an empty
 *     field stays empty (honest miss) rather than being filled with a guess.
 *
 * No network, no server-only imports → safe to unit-test and to run in the pure
 * self-test harness. The server wrapper (strain-lookup.ts) supplies the actual
 * generateWebSearch call and hands the raw text here.
 */
import { checkCompliance, type ExtraBannedPhrase } from "@/lib/ai/compliance";
import { canonicalStrainType } from "@/lib/menu/strain-taxonomy";
import type { GreenwayStrainType } from "@/lib/leafly/types";

/** The raw, still-untrusted shape parsed from the model's JSON reply. */
export type RawStrainLookup = {
  strain_type: string;
  strain_type_confidence: number;
  lineage: string;
  aliases: string[];
  terpenes: string[];
  aroma_notes: string[];
  flavor_notes: string[];
  dominant_cannabinoid: string;
  potency_note: string;
  bud_structure: string;
  origin: string;
  summary: string;
  found: boolean;
  confidence?: number;
};

/** The sanitized, compliance-gated result the UI fills the form from. */
export type StrainLookupResult = {
  /** Canonical strain type (indica / sativa / hybrid / …-hybrid / cbd / unknown). */
  strainType: GreenwayStrainType;
  /** 0–100 confidence in the strain type specifically. */
  strainTypeConfidence: number;
  lineage: string;
  aliases: string[];
  terpenes: string[];
  aromaNotes: string[];
  flavorNotes: string[];
  dominantCannabinoid: string;
  potencyNote: string;
  budStructure: string;
  origin: string;
  /** Compliance-passed summary, or "" when missing/blocked. */
  summary: string;
  /** Any summary rejected for a medical/banned claim (for the honest banner). */
  rejectedSummary: string | null;
  /** True when the model reported a real find (post-sanitize sanity applied). */
  found: boolean;
  /** 0–100 overall confidence. */
  confidence: number;
  /** True when at least one factual field came back — drives "did we find anything". */
  hasAnyFindings: boolean;
};

/** Autofill / trust bar shared with the product look-up (90%). */
export const STRAIN_LOOKUP_AUTO_MIN_CONFIDENCE = 90;

/** Plain-English honest-miss message (mirrors the product look-up wording). */
export const STRAIN_LOOKUP_HONEST_MISS =
  "I couldn't find anything reliable about this strain, so I'm not going to guess. " +
  "Try a more specific or correctly-spelled strain name, or fill the fields in manually.";

/** System prompt — strain researcher, sensory/botanical/market-factual only. */
export const STRAIN_LOOKUP_SYSTEM = `
You are a meticulous cannabis STRAIN researcher for a licensed Washington State
retailer. You describe a single named strain using SENSORY, BOTANICAL and
MARKET-FACTUAL details only: strain type (indica/sativa/hybrid and the leaning
hybrids), parent lineage, aliases, dominant terpenes, aroma notes, flavor notes,
dominant cannabinoid, a factual potency note, bud structure, and geographic
origin — plus a short, tasteful, NON-MEDICAL summary.

HARD RULES:
- NEVER invent a specific fact. If you are not confident about a field, return
  it empty. A truthful "unknown" is required; a guess is forbidden.
- NO medical, therapeutic, or curative claims of ANY kind (Washington I-502
  advertising rules). Describe aroma, flavor, lineage and format — never health
  outcomes, symptom relief, or dosage advice.
- Terpenes, aroma and flavor must be short single words or short phrases
  (e.g. "myrcene", "limonene", "earthy", "citrus", "blueberry").
- Report ONLY facts about the SPECIFIC strain named. Do not blend in a different
  strain that merely shares part of the name.`.trim();

/** JSON shape hint appended to the user prompt (the web_search path has no
 *  response_format, so we ask for the shape explicitly and parse tolerantly). */
export const STRAIN_LOOKUP_SHAPE_HINT = `

Respond with ONLY a JSON object (no prose, no code fences) with EXACTLY these keys:
{
  "strain_type": "indica|sativa|hybrid|indica-hybrid|sativa-hybrid|cbd|unknown",
  "strain_type_confidence": 0.0,
  "lineage": "parent cross if verified, else empty string",
  "aliases": ["other spellings/nicknames, or []"],
  "terpenes": ["dominant terpenes as single words, or []"],
  "aroma_notes": ["sensory aroma words, or []"],
  "flavor_notes": ["sensory flavor words, or []"],
  "dominant_cannabinoid": "thc|cbd|balanced or empty string",
  "potency_note": "factual potency note like ~18-24% THC, or empty string",
  "bud_structure": "e.g. dense, frosty, or empty string",
  "origin": "e.g. United States, or empty string",
  "summary": "1-2 sentence sensory/factual NON-MEDICAL blurb, or empty string",
  "found": true,
  "confidence": 0.0
}`;

/** Build the user prompt for a single strain name. */
export function buildStrainLookupUserPrompt(strainName: string): string {
  const name = strainName.trim();
  return (
    `Research the cannabis strain named "${name}". Identify its strain type ` +
    `(indica/sativa/hybrid or a leaning hybrid), parent lineage, common aliases, ` +
    `dominant terpenes, aroma notes, flavor notes, dominant cannabinoid, a ` +
    `factual potency note, bud structure, and geographic origin. Fill only what ` +
    `you can verify; leave anything uncertain empty. Do not guess.`
  );
}

/** 0..1 or 0..100 → clamped 0..100 integer. */
export function toPct(conf: unknown): number {
  if (typeof conf !== "number" || !Number.isFinite(conf)) return 0;
  const scaled = conf <= 1 ? conf * 100 : conf;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/** De-dupe + trim a term list, lower-cased to match KB storage. Empty-safe. */
function cleanLowerTerms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const t = String(raw ?? "").trim().toLowerCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Tolerant coerce of any parsed JSON into a RawStrainLookup with safe defaults. */
export function coerceRawStrainLookup(parsed: unknown): RawStrainLookup {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const optNum = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  return {
    strain_type: String(o.strain_type ?? "unknown"),
    strain_type_confidence: num(o.strain_type_confidence),
    lineage: String(o.lineage ?? ""),
    aliases: arr(o.aliases),
    terpenes: arr(o.terpenes),
    aroma_notes: arr(o.aroma_notes),
    flavor_notes: arr(o.flavor_notes),
    dominant_cannabinoid: String(o.dominant_cannabinoid ?? ""),
    potency_note: String(o.potency_note ?? ""),
    bud_structure: String(o.bud_structure ?? ""),
    origin: String(o.origin ?? ""),
    summary: String(o.summary ?? ""),
    found: Boolean(o.found),
    confidence: optNum(o.confidence),
  };
}

/**
 * Sanitize + compliance-gate a raw strain lookup. NEVER guesses: empty stays
 * empty. The summary is compliance-checked; if it trips a medical/banned rule
 * it is dropped (surfaced via rejectedSummary) rather than published.
 */
export function postProcessStrainLookup(
  raw: RawStrainLookup,
  extraBanned: ExtraBannedPhrase[] = [],
): StrainLookupResult {
  const strainType = canonicalStrainType(raw?.strain_type);
  const strainTypeConfidence = toPct(raw?.strain_type_confidence);
  const overallRaw = raw?.confidence;
  const confidence = overallRaw !== undefined ? toPct(overallRaw) : strainTypeConfidence;

  const lineage = String(raw?.lineage ?? "").trim();
  const aliases = cleanLowerTerms(raw?.aliases);
  const terpenes = cleanLowerTerms(raw?.terpenes);
  const aromaNotes = cleanLowerTerms(raw?.aroma_notes);
  const flavorNotes = cleanLowerTerms(raw?.flavor_notes);
  const dominantCannabinoid = String(raw?.dominant_cannabinoid ?? "").trim().toLowerCase();
  const potencyNote = String(raw?.potency_note ?? "").trim();
  const budStructure = String(raw?.bud_structure ?? "").trim();
  const origin = String(raw?.origin ?? "").trim();

  // Summary is free prose → compliance-gate it. A blocked summary is dropped,
  // not repaired (we never invent a "safe" version).
  const summaryRaw = String(raw?.summary ?? "").trim();
  let summary = "";
  let rejectedSummary: string | null = null;
  if (summaryRaw) {
    const c = checkCompliance(summaryRaw, extraBanned);
    if (c.ok) summary = summaryRaw;
    else rejectedSummary = summaryRaw;
  }

  const hasAnyFindings =
    strainType !== "unknown" ||
    lineage.length > 0 ||
    aliases.length > 0 ||
    terpenes.length > 0 ||
    aromaNotes.length > 0 ||
    flavorNotes.length > 0 ||
    dominantCannabinoid.length > 0 ||
    potencyNote.length > 0 ||
    budStructure.length > 0 ||
    origin.length > 0 ||
    summary.length > 0;

  // A "find" only counts when the model said found AND something real survived.
  const found = Boolean(raw?.found) && hasAnyFindings;

  return {
    strainType,
    strainTypeConfidence,
    lineage,
    aliases,
    terpenes,
    aromaNotes,
    flavorNotes,
    dominantCannabinoid,
    potencyNote,
    budStructure,
    origin,
    summary,
    rejectedSummary,
    found,
    confidence,
    hasAnyFindings,
  };
}

// ---------------------------------------------------------------------------
// Pure self-tests (run by scripts/compliance/run-pure-selftests.ts + a vitest
// mirror). Bare console.log is intentional here (self-test core file).
// ---------------------------------------------------------------------------
export function __runStrainLookupCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`strain-lookup-core self-test FAILED: ${msg}`);
    passed++;
  };

  // toPct scales (0..1 -> 0..100) and clamps into 0..100.
  assert(toPct(0.9) === 90, "toPct 0.9 -> 90");
  assert(toPct(94) === 94, "toPct 94 -> 94 (already a percentage)");
  assert(toPct(150) === 100, "toPct clamps high");
  assert(toPct(-1) === 0, "toPct clamps low");
  assert(toPct("x") === 0, "toPct non-number -> 0");

  // A rich, compliant find survives whole; terpenes are lower-cased + de-duped.
  const good = postProcessStrainLookup(
    coerceRawStrainLookup({
      strain_type: "Indica-Hybrid",
      strain_type_confidence: 0.95,
      lineage: "Blueberry x Haze",
      aliases: ["BlueDream", "bluedream"],
      terpenes: ["Myrcene", "myrcene", "Pinene"],
      aroma_notes: ["Berry", "Sweet"],
      flavor_notes: ["Blueberry"],
      dominant_cannabinoid: "THC",
      potency_note: "~18-24% THC",
      bud_structure: "dense",
      origin: "United States",
      summary: "A balanced hybrid with a sweet berry aroma and smooth fruity flavor.",
      found: true,
      confidence: 0.95,
    }),
  );
  assert(good.strainType === "indica-hybrid", "canonicalizes leaning type");
  assert(good.strainTypeConfidence === 95, "strain type confidence 95");
  assert(good.terpenes.join(",") === "myrcene,pinene", "terpenes lower+dedupe");
  assert(good.aliases.join(",") === "bluedream", "aliases lower+dedupe");
  assert(good.aromaNotes.join(",") === "berry,sweet", "aroma lower");
  assert(good.dominantCannabinoid === "thc", "cannabinoid lower");
  assert(good.summary.startsWith("A balanced hybrid"), "compliant summary kept");
  assert(good.rejectedSummary === null, "no rejected summary");
  assert(good.found === true && good.hasAnyFindings === true, "good is a find");

  // A medical-claim summary is dropped (not published), other fields survive.
  const medical = postProcessStrainLookup(
    coerceRawStrainLookup({
      strain_type: "indica",
      strain_type_confidence: 0.9,
      terpenes: ["myrcene"],
      summary: "Cures anxiety and treats chronic pain.",
      found: true,
    }),
  );
  assert(medical.summary === "", "medical summary dropped");
  assert(medical.rejectedSummary !== null, "rejected summary surfaced");
  assert(medical.terpenes.join(",") === "myrcene", "other fields survive a blocked summary");
  assert(medical.hasAnyFindings === true, "still has findings via terpenes");

  // An empty / honest-miss result never invents anything.
  const miss = postProcessStrainLookup(
    coerceRawStrainLookup({ strain_type: "unknown", found: false }),
  );
  assert(miss.strainType === "unknown", "miss stays unknown");
  assert(miss.terpenes.length === 0 && miss.summary === "", "miss invents nothing");
  assert(miss.found === false && miss.hasAnyFindings === false, "miss is not a find");

  // found=true but nothing real -> NOT counted as a find (post-sanitize sanity).
  const emptyButFound = postProcessStrainLookup(
    coerceRawStrainLookup({ strain_type: "unknown", found: true }),
  );
  assert(emptyButFound.found === false, "found=true with no data is not a find");

  console.log(`strain-lookup-core self-tests: ${passed} passed`);
  return { passed };
}
