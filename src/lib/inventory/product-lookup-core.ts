/**
 * src/lib/inventory/product-lookup-core.ts
 *
 * PURE CORE for the AI Product/Strain Lookup on the Product Onboarding page
 * (T-314). No network, no server-only imports \u2014 fully unit-testable offline.
 *
 * What this module owns:
 *  - The no-guessing, WA I-502-compliant SYSTEM PROMPT the model receives.
 *  - The USER prompt builder from a product name + optional vendor/brand + any
 *    hint the operator typed into the Google-style box.
 *  - The output SCHEMA (flat \u2014 the schema DSL has no nested-object arrays).
 *  - postProcessLookup(): sanitizes the raw model output into a safe, typed
 *    result. It (a) coerces the strain type to a canonical value, (b) filters
 *    effects through the compliance allow-list (experiential OK, medical/curative
 *    OUT \u2014 e.g. "reduces inflammation" is rejected), (c) filters free text
 *    (summary) through the compliance linter, (d) grades AUTOFILL eligibility on
 *    the >= 90% bar shared with SLICE 93.
 *
 * Standing rules honored: never guess (low confidence \u2192 honest miss, never a
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
  /** 0..1 \u2014 the model's own confidence in the strain_type specifically. */
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
  /** True only when the model actually recognized/located this product. */
  found: boolean;
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
  /** The model located the product at all. */
  found: boolean;
  /**
   * True when there is worthwhile detail to offer as a "Save to KB?" draft
   * (a real strain type and/or summary/effects/aroma/flavor/lineage).
   */
  hasKbDraft: boolean;
};

/**
 * SYSTEM PROMPT. Baked-in compliance + no-guessing. This is the single place
 * the model's behavior is defined for the lookup feature.
 */
export const PRODUCT_LOOKUP_SYSTEM = `
You are a meticulous cannabis product research assistant for a licensed
Washington State (I-502) retailer. You look up a specific product (often a
flower strain, but sometimes an edible, vape, concentrate, pre-roll, or
accessory) and report ONLY what you can actually verify.

HARD RULES (never break):
- NEVER GUESS. If you cannot verify a detail from real, reputable sources or
  solid knowledge, leave it blank and lower your confidence. It is always
  better to return "found": false than to invent a strain type, lineage, or
  description.
- Set "found": false and "strain_type": "unknown" when you do not actually
  recognize or locate the product.
- Report "strain_type_confidence" honestly on a 0..1 scale. Only claim high
  confidence (>= 0.9) when the strain type is genuinely well-established.

WASHINGTON I-502 COMPLIANCE (never violate):
- NO health, medical, therapeutic, or curative claims. Do NOT say a product
  treats, cures, heals, relieves, prevents, or reduces any condition, symptom,
  disease, pain, anxiety, inflammation, etc.
- You MAY describe EXPERIENTIAL character with plain adjectives (relaxed, calm,
  sleepy, uplifted, happy, focused, creative, energetic, euphoric, giggly,
  talkative, hungry, mellow, etc.) framed as the general vibe \u2014 never as a
  treatment.
- NO dosing advice, no safety/efficacy claims, nothing appealing to minors, no
  alcohol/tobacco/vehicle associations.
- Keep the summary sensory and tasteful: aroma, flavor, format, lineage/strain
  type, and general experiential character only.

STRAIN TYPE: one of exactly \u2014 indica, sativa, hybrid, indica-hybrid,
sativa-hybrid, cbd, unknown. Use "unknown" for non-flower products or when not
established.

Return your findings in the exact JSON shape requested. Prefer fewer, verified
details over many guessed ones.
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
    "Look this up. If it is a cannabis flower strain, identify its strain type " +
      "and (only if verified) lineage, aroma, flavor, and general experiential " +
      "character. If it is a non-flower product (edible, vape, concentrate, " +
      "pre-roll, accessory), set strain_type to \"unknown\" and describe only " +
      "what you can verify about the product. Never guess.",
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

  // Effects: keep only allow-listed experiential words; medical/curative OUT.
  const effectsIn = Array.isArray(raw?.effects) ? raw.effects.map((e) => String(e)) : [];
  const effectCheck = checkEffects(effectsIn, extraBanned);

  // Summary: drop it entirely if it carries a true medical/curative claim.
  const summaryLint = lintCopy(raw?.summary ?? "", extraBanned);
  const summary = summaryLint.disposition === "block" ? "" : (summaryLint.publicText ?? "");

  const aromaNotes = cleanTerms(raw?.aroma_notes);
  const flavorNotes = cleanTerms(raw?.flavor_notes);
  const lineage = String(raw?.lineage ?? "").trim();

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
    hasKbDraft,
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
// PURE SELF-TEST \u2014 registered in scripts/compliance/run-pure-selftests.ts.
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

  // Prompt builders produce non-empty text.
  assert(PRODUCT_LOOKUP_SYSTEM.includes("NEVER GUESS"), "system has no-guess rule");
  assert(
    buildLookupUserPrompt({ query: "Blue Dream", vendorOrBrand: "Acme" }).includes("Blue Dream"),
    "user prompt has query",
  );

  return { passed };
}
