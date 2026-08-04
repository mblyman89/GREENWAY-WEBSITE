/**
 * src/lib/inventory/product-lookup-core.ts
 *
 * PURE CORE for the AI Product/Strain Lookup on the Product Onboarding page
 * (T-314). No network, no server-only imports — fully unit-testable offline.
 *
 * What this module owns:
 *  - The no-guessing, WA I-502-compliant SYSTEM PROMPT the model receives.
 *  - The USER prompt builder from a product name + optional vendor/brand + any
 *    hint the operator typed into the Google-style box.
 *  - The output SCHEMA (flat — the schema DSL has no nested-object arrays).
 *  - postProcessLookup(): sanitizes the raw model output into a safe, typed
 *    result. It (a) coerces the strain type to a canonical value, (b) filters
 *    effects through the compliance allow-list (experiential OK, medical/curative
 *    OUT — e.g. "reduces inflammation" is rejected), (c) filters free text
 *    (summary) through the compliance linter, (d) grades AUTOFILL eligibility on
 *    the >= 90% bar shared with SLICE 93.
 *
 * Standing rules honored: never guess (low confidence → honest miss, never a
 * made-up field), money-agnostic, sensory + allowed-effects only, reuse the
 * SLICE 93 confidence bar and the existing compliance engine.
 */

import {
  STRAIN_TYPE_AUTO_MIN_CONFIDENCE,
  type StrainTypeSuggestion,
} from "@/lib/inventory/strain-type-intel-core";
import {
  checkEffects,
  lintCopy,
  type ExtraBannedPhrase,
} from "@/lib/ai/compliance";
import type { GreenwayStrainType } from "@/lib/leafly/types";

/** Canonical strain-type values the picker + KB understand. */
export const LOOKUP_STRAIN_TYPES: readonly GreenwayStrainType[] = [
  "indica",
  "sativa",
  "hybrid",
  "indica-hybrid",
  "sativa-hybrid",
  "cbd",
  "unknown",
] as const;

/** The >= 90% autofill bar (shared with the SLICE 93 strain-type engine). */
export const LOOKUP_AUTO_MIN_CONFIDENCE = STRAIN_TYPE_AUTO_MIN_CONFIDENCE; // 90

/**
 * The RAW shape we ask the model to return. All fields optional-ish in spirit;
 * the schema enforces types and the post-processor sanitizes. `confidence` is
 * 0..1 (model-native); we convert to 0..100 for the UI/autofill bar.
 */
export type RawProductLookup = {
  /** Best strain type, or "unknown" when not a flower/strain or not found. */
  strain_type: string;
  /** 0..1 — the model's own confidence in the strain_type specifically. */
  strain_type_confidence: number;
  /** Sensory/experiential summary (NO medical claims). Empty when nothing found. */
  summary: string;
  /** Experiential effect words (filtered against the allow-list downstream). */
  effects: string[];
  /** Aroma descriptors. */
  aroma_notes: string[];
  /** Flavor descriptors. */
  flavor_notes: string[];
  /** Lineage/parentage when known (plain text), else empty. */
  lineage: string;
  /** True when the model located the product OR found web/community info on it. */
  found: boolean;
  /** 0..1 OVERALL confidence in the whole result (distinct from strain_type). */
  confidence?: number;

  // -------------------------------------------------------------------------
  // T-315 ALL-INCLUSIVE fields (additive). Populated for ANY product type so a
  // single search also stages the ENRICHMENT assets. All optional in spirit;
  // the post-processor compliance-gates and sanitizes each one.
  // -------------------------------------------------------------------------
  /** Full marketing description (sensory/experiential ONLY, no medical claims). */
  description?: string;
  /** A one-line short description / tagline (same compliance rules). */
  short_description?: string;
  /** Product family we can verify: flower, vape, edible, beverage, concentrate,
   *  pre-roll, tincture, topical, accessory, other. "" when unsure. */
  category?: string;
  /** Cannabinoid ratio when stated on packaging, e.g. "1:1", "20:1". "" if none. */
  potency_ratio?: string;
  /** Net size/quantity as printed, e.g. "12oz", "3.5g", "10pk". "" if unsure. */
  size?: string;
  /** Candidate PRODUCT image URLs from the web (reviewable; never auto-imported). */
  image_candidates?: string[];
};

/** The sanitized, UI-ready lookup result. */
export type ProductLookupResult = {
  /** Canonical strain type (never a raw/unknown token). */
  strainType: GreenwayStrainType;
  /** 0..100 confidence in the strain type. */
  strainTypeConfidence: number;
  /** True when strainType is real AND confidence >= the autofill bar. */
  autofillStrainType: boolean;
  /** Compliance-safe summary (medical/curative copy dropped), or "". */
  summary: string;
  /** Effects that passed the experiential allow-list. */
  effects: string[];
  /** Effects the model proposed that were rejected (for transparency). */
  rejectedEffects: { effect: string; reason: string }[];
  aromaNotes: string[];
  flavorNotes: string[];
  lineage: string;
  /** The model located the product OR found web/community info on it. */
  found: boolean;
  /**
   * 0..100 OVERALL confidence in the whole result (community-inclusive). Falls
   * back to the strain-type confidence when the model omits an overall score.
   * This is what the UI shows as the headline confidence %.
   */
  confidence: number;
  /**
   * True when the model returned ANY usable content at all (a real strain type,
   * summary, effects, aroma, flavor, lineage, description, short description,
   * category, ratio, size, or an image candidate) — REGARDLESS of `found`.
   * The UI uses this to decide whether to SHOW the findings (so community info
   * is surfaced for the owner to review, never silently suppressed). Distinct
   * from hasKbDraft / hasEnrichmentDraft, which gate the auto-save path.
   */
  hasAnyFindings: boolean;
  /**
   * True when there is worthwhile detail to offer as a "Save to KB?" draft
   * (a real strain type and/or summary/effects/aroma/flavor/lineage).
   */
  hasKbDraft: boolean;

  // -------------------------------------------------------------------------
  // T-315 ALL-INCLUSIVE, sanitized fields (additive). These feed ENRICHMENT.
  // -------------------------------------------------------------------------
  /** Compliance-safe full description (medical/curative copy dropped), or "". */
  description: string;
  /** Compliance-safe short description / tagline, or "". */
  shortDescription: string;
  /** Verified product family, lowercased, from a fixed allow-list, or "". */
  category: string;
  /** Cannabinoid ratio as printed (e.g. "1:1"), digits/colon only, or "". */
  potencyRatio: string;
  /** Net size as printed (e.g. "12oz"), or "". */
  size: string;
  /** Clean, deduped, http(s)-only candidate product image URLs (never .svg). */
  imageCandidates: string[];
  /**
   * True when there is enrichment-worthy content to stage (a description,
   * short description, or at least one image candidate). Distinct from
   * hasKbDraft, which is about strain-KB worthiness.
   */
  hasEnrichmentDraft: boolean;
};

/**
 * Verified product families we accept (T-315). The model must pick from these
 * or return "" (never invent a category). Kept broad but closed.
 */
export const LOOKUP_PRODUCT_CATEGORIES: readonly string[] = [
  "flower",
  "pre-roll",
  "vape",
  "concentrate",
  "edible",
  "beverage",
  "tincture",
  "topical",
  "capsule",
  "accessory",
  "other",
] as const;

/** Max product-image candidates staged from one lookup (mirrors research-core). */
export const LOOKUP_MAX_IMAGE_CANDIDATES = 12;

/**
 * Filename fragments that almost always mean "not the product shot" — logos,
 * icons, sprites, avatars, badges, tracking pixels, placeholders. Executive
 * value-add: keeps the reviewable candidate list clean so Michael isn't sifting
 * through brand logos. Candidates only; nothing is ever auto-imported.
 */
const IMAGE_JUNK_HINTS: readonly string[] = [
  "logo",
  "icon",
  "sprite",
  "favicon",
  "avatar",
  "badge",
  "placeholder",
  "spacer",
  "pixel",
  "banner",
  "thumb", // low-res thumbnails; prefer full images
  "swatch",
];

/**
 * Sanitize candidate product image URLs: http(s) only, de-duped, order
 * preserved, drop .svg (logos/icons) and obvious junk-named assets, capped.
 * NEVER fabricates a URL. Returns [] when nothing survives.
 */
export function cleanImageCandidates(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      continue; // not an absolute URL
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (!parsed.hostname.includes(".")) continue;
    const lower = parsed.toString().toLowerCase();
    if (lower.endsWith(".svg")) continue;
    const path = parsed.pathname.toLowerCase();
    if (IMAGE_JUNK_HINTS.some((h) => path.includes(h))) continue;
    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed.toString());
    if (out.length >= LOOKUP_MAX_IMAGE_CANDIDATES) break;
  }
  return out;
}

/** Coerce a raw category token to the allow-list, else "" (never guess). */
export function coerceCategory(raw: unknown): string {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "";
  const hit = LOOKUP_PRODUCT_CATEGORIES.find((c) => c === v);
  if (hit) return hit;
  // Common synonyms mapped conservatively; anything unmatched -> "".
  if (/pre[\s-]?roll|joint/.test(v)) return "pre-roll";
  if (/cart|cartridge|vape|pen|disposable/.test(v)) return "vape";
  if (/gummy|gummies|chocolate|candy|cookie|edible|chew/.test(v)) return "edible";
  if (/drink|soda|lemonade|seltzer|beverage|shot/.test(v)) return "beverage";
  if (/wax|shatter|rosin|resin|dab|concentrate|budder|badder|sauce|diamond/.test(v))
    return "concentrate";
  if (/tincture/.test(v)) return "tincture";
  if (/lotion|balm|salve|topical|cream/.test(v)) return "topical";
  if (/cap|capsule|softgel|pill|tablet/.test(v)) return "capsule";
  if (/flower|bud|nug|eighth|ounce/.test(v)) return "flower";
  return "";
}

/** Keep only digits, colon(s), and dot in a ratio like "1:1" / "20:1"; else "". */
export function coercePotencyRatio(raw: unknown): string {
  const v = String(raw ?? "").trim();
  const m = v.match(/\d+(?:\.\d+)?(?::\d+(?:\.\d+)?)+/);
  return m ? m[0] : "";
}

/**
 * SYSTEM PROMPT. Baked-in compliance + no-guessing. This is the single place
 * the model's behavior is defined for the lookup feature.
 */
export const PRODUCT_LOOKUP_SYSTEM = `
You are a thorough cannabis product research assistant for a licensed
Washington State (I-502) retailer. You look up a specific product (often a
flower strain, but sometimes an edible, vape, concentrate, pre-roll, beverage,
tincture, topical, or accessory) and report what the internet and the cannabis
community say about it. Search widely: brand sites, licensed menus, Leafly,
AllBud, dispensary listings, review sites, and community forums all count.

YOUR JOB — BE GENEROUS BUT HONEST:
- REPORT WHAT YOU FIND. If reputable sources or the community describe this
  product, gather it and report it. Community consensus is valuable — you do
  NOT need an official "from the manufacturer" source to report a detail.
- Do not hold back useful information just because it is not 100% certain.
  Instead, tell the truth about HOW confident you are (see confidence below).
  The retailer reviews everything and decides what to keep — your job is to
  surface the findings, not to censor them.
- Fill "found": true whenever you locate the product OR find community/web
  information describing it. Only set "found": false when you genuinely find
  NOTHING at all about this specific product after searching.
- The ONE thing you must never do is INVENT a specific fact (a made-up lineage,
  a fake potency number, a fabricated image URL). Reporting what sources say =
  good. Making up a fact from nothing = not allowed. When unsure of a single
  field, lower that field's confidence or leave that one field blank — but
  still report everything else you did find.

CONFIDENCE (be honest, not shy):
- "strain_type_confidence": 0..1, your confidence in the STRAIN TYPE specifically.
- "confidence": 0..1, your OVERALL confidence in the whole result. High (>=0.85)
  when multiple sources agree; medium (0.5–0.85) for solid single-source or
  strong community consensus; low (<0.5) for thin or conflicting info — but
  STILL report what you found at low confidence so the retailer can review it.

WASHINGTON I-502 COMPLIANCE (never violate — this is the law, not a preference):
- NO health, medical, therapeutic, or curative claims. Do NOT say a product
  treats, cures, heals, relieves, prevents, or reduces any condition, symptom,
  disease, pain, anxiety, inflammation, etc.
- You MAY describe EXPERIENTIAL character with plain adjectives (relaxed, calm,
  sleepy, uplifted, happy, focused, creative, energetic, euphoric, giggly,
  talkative, hungry, mellow, etc.) framed as the general vibe — never as a
  treatment.
- NO dosing advice, no safety/efficacy claims, nothing appealing to minors, no
  alcohol/tobacco/vehicle associations.
- Keep copy sensory and tasteful: aroma, flavor, format, lineage/strain type,
  and general experiential character.

STRAIN TYPE: one of exactly — indica, sativa, hybrid, indica-hybrid,
sativa-hybrid, cbd, unknown. Use "unknown" for non-flower products or when the
type is genuinely not established anywhere.

ALL PRODUCTS (flower AND non-flower — edibles, beverages, vapes, concentrates,
pre-rolls, tinctures, topicals, accessories). In addition to the strain fields,
also report everything you can find:
- "description": a rich, tasteful marketing description (sensory, format,
  flavor, lineage, experiential vibe). NO medical/curative claims.
- "short_description": a single catchy line under ~120 chars, same rules.
- "category": exactly one of — flower, pre-roll, vape, concentrate, edible,
  beverage, tincture, topical, capsule, accessory, other. "" only if truly unclear.
- "potency_ratio": the cannabinoid ratio as printed/reported, e.g. "1:1" or
  "20:1". "" if none is stated. Do NOT invent a ratio.
- "size": the net size/quantity as printed, e.g. "12oz", "3.5g", "10pk". "".
- "image_candidates": up to a dozen DIRECT image URLs (http/https) that clearly
  show THIS product from reputable sources (the maker's site, the brand page,
  a licensed menu). Absolute URLs only. Do NOT include logos, icons, banners,
  or unrelated images. Do NOT fabricate URLs — return [] if you have none.

Return your findings in the exact JSON shape requested. Favor giving the
retailer MORE to review (honestly graded by confidence) over giving them a bare
"nothing found." Only a fabricated fact is off-limits — reporting what the web
and community say is exactly your purpose.
`.trim();

/** Build the user prompt from the operator's search box + row context. */
export function buildLookupUserPrompt(input: {
  /** What the operator typed in the Google-style box (already includes name). */
  query: string;
  /** Optional explicit product name (row context). */
  productName?: string | null;
  /** Optional vendor/brand (row context). */
  vendorOrBrand?: string | null;
}): string {
  const lines: string[] = [];
  const query = String(input.query ?? "").trim();
  const name = String(input.productName ?? "").trim();
  const vendor = String(input.vendorOrBrand ?? "").trim();

  lines.push(`Search request: ${query || name || "(none)"}`);
  if (name && name.toLowerCase() !== query.toLowerCase()) {
    lines.push(`Product name on the manifest: ${name}`);
  }
  if (vendor) lines.push(`Vendor / brand: ${vendor}`);
  lines.push("");
  lines.push(
    "Look this up thoroughly across brand sites, licensed menus, Leafly, AllBud, " +
      "dispensary listings, and community/review sources. If it is a cannabis " +
      "flower strain, identify its strain type plus lineage, aroma, flavor, and " +
      "general experiential character as reported by sources and the community. " +
      "If it is a non-flower product (edible, vape, concentrate, pre-roll, " +
      "beverage, tincture, topical, accessory), set strain_type to \"unknown\" " +
      "and describe the product richly from what you find. For EVERY product " +
      "also fill description, short_description, category, potency_ratio, size, " +
      "and image_candidates from what sources and the community report. Report " +
      "everything you find and grade your confidence honestly; the retailer " +
      "reviews and edits it. The only hard rule: never fabricate a specific fact " +
      "(a made-up lineage, fake number, or invented URL) — leave that one field " +
      "blank instead, but still return everything else you found.",
  );
  return lines.join("\n");
}

/** Coerce any raw model token to a canonical strain type. */
export function coerceStrainType(raw: unknown): GreenwayStrainType {
  const v = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  const found = LOOKUP_STRAIN_TYPES.find((t) => t === v);
  return found ?? "unknown";
}

/** Clamp a 0..1 model confidence into a 0..100 integer. */
export function toPct(conf: unknown): number {
  const n = typeof conf === "number" && Number.isFinite(conf) ? conf : 0;
  const clamped = Math.max(0, Math.min(1, n));
  return Math.round(clamped * 100);
}

/**
 * Sanitize the raw model output into a safe, typed result. This is where the
 * compliance gate + the 90% autofill bar are enforced. `extraBanned` layers the
 * owner's kb_banned_phrases (same source the rest of the app uses).
 */
export function postProcessLookup(
  raw: RawProductLookup,
  extraBanned: ExtraBannedPhrase[] = [],
): ProductLookupResult {
  const strainType = coerceStrainType(raw?.strain_type);
  const strainTypeConfidence = toPct(raw?.strain_type_confidence);
  const found = Boolean(raw?.found);
  // Overall confidence: prefer the model's explicit overall score; fall back to
  // the strain-type confidence when it's absent. Community-inclusive headline.
  const overallRaw = typeof raw?.confidence === "number" ? raw.confidence : undefined;
  const confidence = overallRaw !== undefined ? toPct(overallRaw) : strainTypeConfidence;

  // Effects: keep only allow-listed experiential words; medical/curative OUT.
  const effectsIn = Array.isArray(raw?.effects) ? raw.effects.map((e) => String(e)) : [];
  const effectCheck = checkEffects(effectsIn, extraBanned);

  // Summary: drop it entirely if it carries a true medical/curative claim.
  const summaryLint = lintCopy(raw?.summary ?? "", extraBanned);
  const summary = summaryLint.disposition === "block" ? "" : (summaryLint.publicText ?? "");

  const aromaNotes = cleanTerms(raw?.aroma_notes);
  const flavorNotes = cleanTerms(raw?.flavor_notes);
  const lineage = String(raw?.lineage ?? "").trim();

  // T-315: description / short_description are compliance-gated just like the
  // summary — any true medical/curative claim drops the whole field.
  const descLint = lintCopy(raw?.description ?? "", extraBanned);
  const description = descLint.disposition === "block" ? "" : (descLint.publicText ?? "");
  const shortLint = lintCopy(raw?.short_description ?? "", extraBanned);
  const shortDescription =
    shortLint.disposition === "block" ? "" : (shortLint.publicText ?? "");
  const category = coerceCategory(raw?.category);
  const potencyRatio = coercePotencyRatio(raw?.potency_ratio);
  const size = String(raw?.size ?? "").trim().slice(0, 40);
  const imageCandidates = cleanImageCandidates(raw?.image_candidates);

  // Autofill the strain type only when it is real AND clears the 90% bar.
  const autofillStrainType =
    found &&
    strainType !== "unknown" &&
    strainTypeConfidence >= LOOKUP_AUTO_MIN_CONFIDENCE;

  const hasKbDraft =
    found &&
    (strainType !== "unknown" ||
      summary.length > 0 ||
      effectCheck.allowed.length > 0 ||
      aromaNotes.length > 0 ||
      flavorNotes.length > 0 ||
      lineage.length > 0);

  // T-315: enrichment-worthiness is separate — it's about the marketing copy
  // and images we can stage on the enrichment page for ANY product.
  const hasEnrichmentDraft =
    found &&
    (description.length > 0 || shortDescription.length > 0 || imageCandidates.length > 0);

  // "Any findings" is content-driven and does NOT depend on `found`. This is
  // what lets the UI surface community/low-confidence info for the owner to
  // review instead of silently hiding it behind an honest-miss. If the model
  // gathered anything usable, we show it (clearly graded by confidence).
  const hasAnyFindings =
    strainType !== "unknown" ||
    summary.length > 0 ||
    effectCheck.allowed.length > 0 ||
    aromaNotes.length > 0 ||
    flavorNotes.length > 0 ||
    lineage.length > 0 ||
    description.length > 0 ||
    shortDescription.length > 0 ||
    category.length > 0 ||
    potencyRatio.length > 0 ||
    size.length > 0 ||
    imageCandidates.length > 0;

  return {
    strainType,
    strainTypeConfidence,
    autofillStrainType,
    summary,
    effects: effectCheck.allowed,
    rejectedEffects: effectCheck.rejected,
    aromaNotes,
    flavorNotes,
    lineage,
    found,
    confidence,
    hasAnyFindings,
    hasKbDraft,
    description,
    shortDescription,
    category,
    potencyRatio,
    size,
    imageCandidates,
    hasEnrichmentDraft,
  };
}

/** Trim + de-dupe a string[] of short descriptors, dropping empties. */
function cleanTerms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** The plain-English honest-miss message when nothing reliable was found. */
export const LOOKUP_HONEST_MISS =
  "I couldn't find anything reliable about this product, so I'm not going to guess. " +
  "Try adding the brand or a more specific name, or fill the field in manually.";

/**
 * Turn a lookup result into a SLICE 93-style suggestion for the strain picker,
 * so the onboarding UI can present the AI's strain type using the same widget.
 * Returns null when there is nothing confident to suggest.
 */
export function lookupToStrainSuggestion(
  result: ProductLookupResult,
): StrainTypeSuggestion | null {
  if (!result.found || result.strainType === "unknown") return null;
  if (result.strainTypeConfidence <= 0) return null;
  return {
    value: result.strainType,
    confidence: result.strainTypeConfidence,
    source: "product name", // closest existing provenance label; AI-derived
    evidence: `AI lookup (${result.strainTypeConfidence}% confidence)`,
  };
}

// ---------------------------------------------------------------------------
// PURE SELF-TEST — registered in scripts/compliance/run-pure-selftests.ts.
// Offline: exercises coercion, the 90% bar, compliance filtering (inflammation
// stays OUT, relaxing stays IN), and the honest-miss path.
// ---------------------------------------------------------------------------
export function __runProductLookupTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`product-lookup-core self-test failed: ${msg}`);
    passed++;
  };

  // Coercion.
  assert(coerceStrainType("Indica") === "indica", "coerce Indica");
  assert(coerceStrainType("sativa hybrid") === "sativa-hybrid", "coerce sativa hybrid");
  assert(coerceStrainType("gibberish") === "unknown", "coerce unknown");
  assert(toPct(0.94) === 94, "toPct 0.94");
  assert(toPct(2) === 100, "toPct clamps high");
  assert(toPct(-1) === 0, "toPct clamps low");

  // High-confidence flower autofills.
  const hi = postProcessLookup({
    strain_type: "indica",
    strain_type_confidence: 0.95,
    summary: "Earthy and sweet with a relaxing, mellow character.",
    effects: ["relaxed", "sleepy", "hungry"],
    aroma_notes: ["earthy", "sweet"],
    flavor_notes: ["berry"],
    lineage: "GDP x OG",
    found: true,
  });
  assert(hi.autofillStrainType === true, "hi autofills");
  assert(hi.strainType === "indica", "hi strain type");
  assert(hi.effects.includes("relaxed") && hi.effects.includes("hungry"), "hi keeps experiential");
  assert(hi.summary.length > 0, "hi keeps clean summary");
  assert(hi.hasKbDraft === true, "hi has kb draft");

  // Medical claim in summary is dropped; medical effect rejected.
  const med = postProcessLookup({
    strain_type: "hybrid",
    strain_type_confidence: 0.92,
    summary: "This strain reduces inflammation and cures anxiety.",
    effects: ["relaxed", "inflammation"],
    aroma_notes: [],
    flavor_notes: [],
    lineage: "",
    found: true,
  });
  assert(med.summary === "", "medical summary dropped");
  assert(med.effects.includes("relaxed"), "keeps relaxed");
  assert(!med.effects.includes("inflammation"), "drops inflammation effect");
  assert(med.rejectedEffects.some((r) => r.effect === "inflammation"), "inflammation rejected reason");

  // Low confidence does NOT autofill.
  const lo = postProcessLookup({
    strain_type: "sativa",
    strain_type_confidence: 0.55,
    summary: "",
    effects: [],
    aroma_notes: [],
    flavor_notes: [],
    lineage: "",
    found: true,
  });
  assert(lo.autofillStrainType === false, "low conf no autofill");

  // Not found = honest miss, no draft.
  const miss = postProcessLookup({
    strain_type: "unknown",
    strain_type_confidence: 0,
    summary: "",
    effects: [],
    aroma_notes: [],
    flavor_notes: [],
    lineage: "",
    found: false,
  });
  assert(miss.autofillStrainType === false, "miss no autofill");
  assert(miss.hasKbDraft === false, "miss no draft");
  assert(miss.strainType === "unknown", "miss unknown");

  // Prompt builders produce non-empty text. The prompt now forbids FABRICATION
  // (report what the community/web says; only invented facts are off-limits).
  assert(PRODUCT_LOOKUP_SYSTEM.includes("INVENT"), "system forbids inventing facts");
  assert(PRODUCT_LOOKUP_SYSTEM.includes("community"), "system embraces community info");
  assert(PRODUCT_LOOKUP_SYSTEM.includes("I-502"), "system keeps I-502 rails");
  assert(
    buildLookupUserPrompt({ query: "Blue Dream", vendorOrBrand: "Acme" }).includes("Blue Dream"),
    "user prompt has query",
  );

  // ---- Un-suppression: findings show even when found=false ----------------
  // A low-confidence community hit (found=false) with real content must still
  // be surfaced via hasAnyFindings, so the owner can review it. The overall
  // `confidence` reflects the model's honest overall score when provided.
  const community = postProcessLookup({
    strain_type: "hybrid",
    strain_type_confidence: 0.4,
    summary: "Community reports a sweet, earthy, mellow character.",
    effects: ["relaxed", "happy"],
    aroma_notes: ["sweet", "earthy"],
    flavor_notes: [],
    lineage: "",
    found: false,
    confidence: 0.6,
  });
  assert(community.hasAnyFindings === true, "community hit surfaces findings");
  assert(community.found === false, "community hit still found=false");
  assert(community.autofillStrainType === false, "low conf still no autofill");
  assert(community.confidence === 60, "overall confidence uses model's score");
  assert(community.summary.length > 0, "community summary kept");

  // Overall confidence falls back to strain-type confidence when omitted.
  const noOverall = postProcessLookup({
    strain_type: "indica",
    strain_type_confidence: 0.7,
    summary: "",
    effects: [],
    aroma_notes: [],
    flavor_notes: [],
    lineage: "",
    found: true,
  });
  assert(noOverall.confidence === 70, "overall confidence falls back to strain conf");

  // A true empty miss has NO findings.
  const emptyMiss = postProcessLookup({
    strain_type: "unknown",
    strain_type_confidence: 0,
    summary: "",
    effects: [],
    aroma_notes: [],
    flavor_notes: [],
    lineage: "",
    found: false,
  });
  assert(emptyMiss.hasAnyFindings === false, "true empty miss has no findings");

  // ---- T-315: all-inclusive fields ----------------------------------------
  // Category coercion (allow-list + synonyms; never guess).
  assert(coerceCategory("Edible") === "edible", "category exact");
  assert(coerceCategory("gummies") === "edible", "category synonym gummies");
  assert(coerceCategory("cartridge") === "vape", "category synonym cartridge");
  assert(coerceCategory("lemonade") === "beverage", "category synonym lemonade");
  assert(coerceCategory("mystery box") === "", "category unknown -> blank (no guess)");

  // Potency ratio parsing.
  assert(coercePotencyRatio("1:1") === "1:1", "ratio 1:1");
  assert(coercePotencyRatio("20:1 CBD:THC") === "20:1", "ratio extracted from text");
  assert(coercePotencyRatio("no ratio here") === "", "ratio absent -> blank");

  // Image candidate hygiene.
  const imgs = cleanImageCandidates([
    "https://cdn.brand.com/products/rays-lemonade.jpg",
    "not-a-url",
    "https://cdn.brand.com/products/rays-lemonade.jpg", // dupe
    "https://cdn.brand.com/assets/logo.png", // junk name
    "https://cdn.brand.com/x/icon-cart.png", // junk name
    "https://cdn.brand.com/x/hero.svg", // svg dropped
    "http://cdn.brand.com/p/raspberry-12oz.png",
  ]);
  assert(
    JSON.stringify(imgs) ===
      JSON.stringify([
        "https://cdn.brand.com/products/rays-lemonade.jpg",
        "http://cdn.brand.com/p/raspberry-12oz.png",
      ]),
    "image candidates: dedupe, drop junk/svg, preserve order",
  );
  assert(cleanImageCandidates([]).length === 0, "image candidates: empty -> []");
  assert(cleanImageCandidates("nope" as unknown).length === 0, "image candidates: non-array -> []");

  // Non-flower (beverage) with description + images stages an ENRICHMENT draft
  // even though strain_type is unknown (no autofill).
  const bev = postProcessLookup({
    strain_type: "unknown",
    strain_type_confidence: 0,
    summary: "",
    effects: [],
    aroma_notes: [],
    flavor_notes: [],
    lineage: "",
    found: true,
    description: "A bright raspberry lemonade with a balanced, easygoing lift.",
    short_description: "Bright raspberry lemonade, balanced 1:1.",
    category: "beverage",
    potency_ratio: "1:1",
    size: "12oz",
    image_candidates: ["https://cdn.brand.com/p/rays-raspberry.jpg"],
  });
  assert(bev.autofillStrainType === false, "beverage does not autofill strain");
  assert(bev.category === "beverage", "beverage category kept");
  assert(bev.potencyRatio === "1:1", "beverage ratio kept");
  assert(bev.size === "12oz", "beverage size kept");
  assert(bev.description.length > 0, "beverage description kept");
  assert(bev.imageCandidates.length === 1, "beverage image candidate kept");
  assert(bev.hasEnrichmentDraft === true, "beverage has enrichment draft");
  assert(bev.hasKbDraft === false, "beverage has no strain-kb draft");

  // Medical description is dropped even for non-flower.
  const medDesc = postProcessLookup({
    strain_type: "unknown",
    strain_type_confidence: 0,
    summary: "",
    effects: [],
    aroma_notes: [],
    flavor_notes: [],
    lineage: "",
    found: true,
    description: "This tincture reduces inflammation and cures insomnia.",
    short_description: "",
    category: "tincture",
    potency_ratio: "",
    size: "",
    image_candidates: [],
  });
  assert(medDesc.description === "", "medical description dropped");
  assert(medDesc.hasEnrichmentDraft === false, "no enrichment draft when only medical copy");

  return { passed };
}
