/**
 * src/lib/ai/compliance.ts
 *
 * WA cannabis advertising guardrails + grounding rules for AI-generated copy.
 * These are baked into every prompt's system message AND applied as a
 * post-generation filter. The goal: AI never drafts language that violates
 * RCW 69.50.369 / WAC 314-55-155 (no health or medical claims, nothing
 * appealing to minors, no dosing advice, no claims of safety/efficacy, no
 * alcohol/tobacco/vehicle associations) AND never invents facts.
 *
 * Output is still employee-validated before publish. The regex scan is
 * ASSISTIVE — a "blocking" flag means the reviewer must edit before accepting;
 * a "warn" flag is just a heads-up.
 */
import "server-only";

// Bump when the system rules change so we can A/B accept-rate by prompt_version.
export const PROMPT_VERSION = "v2-grounded";

/**
 * System rules prepended to every cannabis copy prompt. Two jobs:
 *  1. COMPLIANCE — never write anything WA I-502 prohibits.
 *  2. GROUNDING  — only use the facts provided; never invent. This is what
 *     keeps the accept-rate high and stops money being wasted on rejected,
 *     hallucinated output.
 */
export const COMPLIANCE_SYSTEM = `
You are an expert cannabis copywriter for a licensed Washington State (I-502)
cannabis retailer. You write tasteful, knowledgeable, factual product copy for
adults 21+.

GROUNDING (critical — do not break):
- Use ONLY the facts provided to you (POS facts, brand/strain/terpene facts).
- NEVER invent strain lineage, terpenes, awards, origins, lab results, or
  effects. If a detail is not provided, omit it or describe generically.
- When facts are thin, write a shorter, generic-but-accurate description and set
  your confidence low. Do not fill gaps with guesses.

WASHINGTON I-502 COMPLIANCE (never violate):
- NO health, medical, therapeutic, or curative claims (do not say it treats,
  cures, heals, relieves, or helps any condition, symptom, pain, anxiety, sleep,
  stress, inflammation, etc.).
- NO claims of safety, efficacy, or that the product is "safe", "healthy",
  "non-addictive", or "good for you".
- NO dosing advice or consumption instructions/quantities.
- NOTHING that appeals to minors: no cartoons, candy/kid comparisons, toys, or
  youthful slang; keep it adult and tasteful.
- NO associations with alcohol, tobacco/nicotine, or motor vehicles.
- NO false or misleading statements.
- Do NOT include price, stock, discounts, or below-cost language.

EFFECTS (allowed as EXPERIENTIAL descriptors ONLY):
- You MAY describe a general experiential character using plain adjectives such
  as: sleepy, relaxed, calm, uplifted, happy, focused, creative, energetic,
  euphoric, giggly, talkative, hungry, mellow.
- Frame them as experiential vibe/character, never as a treatment. GOOD:
  "commonly described as relaxing and mellow." BAD: "relieves anxiety",
  "cures insomnia", "helps you sleep", "treats pain".
- NEVER pair an effect with a medical condition, symptom, or the words cure/
  treat/heal/relieve/prevent/diagnose/remedy/therapy/medicine.

STYLE:
- Describe aroma, flavor, format, lineage/strain type, craftsmanship, and (when
  supported) the general experiential character — the legal, expert surface
  area. Do not describe medical effects on the body or mind.
- Warm, knowledgeable, concise. Avoid empty hype ("best", "amazing", "miracle").
`.trim();

export type ComplianceSeverity = "block" | "warn";

/**
 * Patterns that indicate a likely compliance problem.
 *
 * Grounded in docs/COMPLIANCE_CLAIMS_REFERENCE.md (WAC 314-55-155(1)(a): no
 * false/misleading, over-consumption, curative/therapeutic, or appeal-to-minors
 * language) + the FDA warning-letter analysis. Owner rule: WARN by default;
 * reserve BLOCK for unmistakable medical/curative/therapeutic claims (and the
 * other hard statutory prohibitions). Experience/effect/flavor words are handled
 * by ALLOWED_EFFECTS and are never blocked here.
 *
 * BLOCK tier — the WAC (iii) curative/therapeutic surface + hard prohibitions:
 *   • treat/cure/heal/prevent/remedy verbs, symptom "relief/relieves/reduces X"
 *   • a condition/disease FRAMED as treated (treat-verb + condition, or the
 *     "anti-<condition>" / "<condition> relief" constructions)
 *   • medical-authority claims (clinically proven, doctor/physician recommended,
 *     FDA approved, medical grade, pharmaceutical)
 *   • physiological-outcome claims (lowers blood pressure, boosts immune system,
 *     anti-inflammatory, kills cancer cells)
 *   • safety/efficacy claims, dosing advice, appeal-to-minors, alcohol/tobacco,
 *     over-consumption encouragement.
 *
 * WARN tier — borderline therapeutic-leaning or promotional phrasing a human
 *   should review (helps with / aids / good for your ___ / eases), plus empty
 *   hype and price/discount mentions.
 */
const RISKY_PATTERNS: { pattern: RegExp; label: string; severity: ComplianceSeverity }[] = [
  // --- BLOCK: curative / therapeutic verbs -------------------------------------
  { pattern: /\b(cure|cures|cured|curing|heal|heals|healed|healing|treat|treats|treated|treating|remedy|remedies|prevent|prevents|preventing|diagnose|diagnoses)\b/i, label: "medical claim (cure/treat/heal/prevent)", severity: "block" },
  { pattern: /\b(therapeutic|therapy|medicinal(?:ly)?|medicine for|medical(?:ly)? (?:grade|proven|benefit))\b/i, label: "therapeutic/medicinal claim", severity: "block" },
  // symptom-relief / physiological outcomes
  { pattern: /\b(relieves?|relief|reduces?|lowers?|eases?|soothes?|alleviates?)\s+(your\s+)?(pain|anxiety|stress|inflammation|nausea|depression|insomnia|cramps?|spasms?|blood pressure|symptoms?)\b/i, label: "symptom-relief claim", severity: "block" },
  { pattern: /\b(pain[- ]relief|anti-?inflammatory|anti-?anxiety|antidepressant|antiemetic|analgesic|blood pressure|immune system|kills? cancer)\b/i, label: "physiological/medical-outcome claim", severity: "block" },
  // condition FRAMED as treated (treat-verb near a condition, or "<condition> relief")
  { pattern: /\b(treats?|cures?|heals?|helps?\s+with|good\s+for|for\s+your)\s+(chronic\s+)?(pain|anxiety|depression|insomnia|ptsd|cancer|arthritis|migraines?|nausea|seizures?|epilepsy|glaucoma|adhd|inflammation)\b/i, label: "treats-a-condition claim", severity: "block" },
  { pattern: /\b(ptsd|cancer|epilepsy|glaucoma|arthritis)\b/i, label: "named disease/condition", severity: "block" },
  // --- BLOCK: other hard statutory prohibitions --------------------------------
  { pattern: /\b(safe|healthy|good for you|non-?addictive|harmless|no side effects|wellness benefit)\b/i, label: "safety/efficacy claim", severity: "block" },
  { pattern: /\b(dose|dosage|dosing|take \d|\d+\s*mg per|how much to (take|consume)|start with \d)\b/i, label: "dosing advice", severity: "block" },
  { pattern: /\b(candy|gummy bears?|kid|kids|children|childhood|cartoon|toy|mascot)\b/i, label: "appeal-to-minors language", severity: "block" },
  { pattern: /\b(alcohol|beer|wine|whiskey|tobacco|cigarette|nicotine|vodka|liquor)\b/i, label: "alcohol/tobacco association", severity: "block" },
  { pattern: /\b(guarantee|guaranteed|miracle|clinically proven|doctor recommended|physician recommended|fda[- ]approved|pharmaceutical)\b/i, label: "unsubstantiated/medical-authority claim", severity: "block" },
  { pattern: /\b(get (?:really )?(?:high|blazed|wasted)|as much as you can|binge|over-?consume|chug|megadose)\b/i, label: "over-consumption encouragement", severity: "block" },
  // --- WARN: borderline therapeutic-leaning or promotional ---------------------
  { pattern: /\b(helps?\s+(?:you\s+)?(?:sleep|relax|unwind|de-?stress)|aids?\b|helps?\s+with|great\s+for\b)/i, label: "borderline therapeutic-leaning phrasing (review)", severity: "warn" },
  { pattern: /\b(best|amazing|incredible|unbeatable|world-?class|premium quality|top-?shelf)\b/i, label: "empty hype wording", severity: "warn" },
  { pattern: /\$\s?\d|\bprice\b|\bdiscount\b|\bsale\b|\bdeal\b|\bcheap\b/i, label: "price/discount mention", severity: "warn" },
];

export type ComplianceResult = {
  ok: boolean; // no blocking flags
  flags: string[]; // all flags (block + warn) for display
  blockingFlags: string[]; // only the must-fix ones
};

/** An owner-editable extra banned phrase, layered on top of the regex. */
export type ExtraBannedPhrase = { phrase: string; severity: ComplianceSeverity; reason?: string | null };

/** Escape a string for safe use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan generated text for risky language. Does not modify the text.
 *
 * `extra` lets callers layer the owner's kb_banned_phrases list on top of the
 * hardcoded regex without a code change. Each extra phrase is matched
 * case-insensitively with word-ish boundaries.
 */
export function checkCompliance(text: string, extra: ExtraBannedPhrase[] = []): ComplianceResult {
  const flags: string[] = [];
  const blockingFlags: string[] = [];
  for (const { pattern, label, severity } of RISKY_PATTERNS) {
    if (pattern.test(text)) {
      flags.push(severity === "block" ? `${label} (must fix)` : `${label} (heads-up)`);
      if (severity === "block") blockingFlags.push(label);
    }
  }
  for (const { phrase, severity } of extra) {
    const trimmed = phrase.trim();
    if (!trimmed) continue;
    const re = new RegExp(`(^|\\W)${escapeRegExp(trimmed)}(\\W|$)`, "i");
    if (re.test(text)) {
      const label = `banned phrase: "${trimmed}"`;
      flags.push(severity === "block" ? `${label} (must fix)` : `${label} (heads-up)`);
      if (severity === "block") blockingFlags.push(label);
    }
  }
  return { ok: blockingFlags.length === 0, flags, blockingFlags };
}

// =============================================================================
// EFFECTS — experiential-only allow-list + validator
// =============================================================================
// Request D: experiential effects (sleepy/relaxed) are OK; medical claims
// (cure/treat/…) are NOT. We keep a canonical allow-list of experiential
// descriptors and a validator that (a) rejects any effect not on the list and
// (b) rejects any effect that trips the medical-claim regex or the owner's
// kb_banned_phrases blocklist. This is the gate for BOTH effect generation and
// effect write-back into the KB. Sensory copy still uses checkCompliance().

/** Canonical experiential effect descriptors permitted under WA I-502. */
export const ALLOWED_EFFECTS = [
  // Relaxed / sedating experience (NOT medical — describes the subjective feel)
  "sleepy",
  "relaxed",
  "relaxing",
  "calm",
  "calming",
  "chill",
  "mellow",
  "soothing",
  "couch-lock",
  "heavy",
  "sedate",
  "sedating",
  "dreamy",
  // Uplifted / social
  "uplifted",
  "uplifting",
  "happy",
  "euphoric",
  "giggly",
  "talkative",
  "sociable",
  "social",
  // Energetic / active
  "focused",
  "creative",
  "energetic",
  "energizing",
  "motivated",
  "tingly",
  "hungry",
  // Potency / character (experiential, per the compliance reference)
  "stoney",
  "potent",
  "buzzy",
  "cerebral",
  "body high",
  "head high",
] as const;

export type EffectCheckResult = {
  /** Effects that are on the allow-list AND pass the medical-claim filter. */
  allowed: string[];
  /** Effects rejected (not on allow-list, or trip a medical/banned phrase). */
  rejected: { effect: string; reason: string }[];
  /** True when every input effect was accepted. */
  ok: boolean;
};

const ALLOWED_EFFECT_SET = new Set<string>(ALLOWED_EFFECTS.map((e) => e.toLowerCase()));

/**
 * Extra medical-claim words that, on their own, are never valid as an "effect"
 * value even though checkCompliance already flags them in prose. Keeping a small
 * dedicated list makes the effect validator strict and self-documenting.
 */
const EFFECT_MEDICAL_WORDS = [
  "cure",
  "cures",
  "treat",
  "treats",
  "heal",
  "heals",
  "relieve",
  "relieves",
  "relief",
  "prevent",
  "prevents",
  "diagnose",
  "remedy",
  "therapy",
  "therapeutic",
  "medicine",
  "medical",
  "medicinal",
  "disease",
  "disorder",
  "symptom",
  "clinical",
  "clinically",
  "fda",
  "pain",
  "anxiety",
  "depression",
  "insomnia",
  "ptsd",
  "cancer",
  "arthritis",
  "migraine",
  "nausea",
  "seizure",
  "adhd",
  "inflammation",
];

/**
 * Validate a list of proposed EFFECT descriptors. An effect is accepted only if
 * it is a single/short experiential term on ALLOWED_EFFECTS and it neither trips
 * the medical-claim regex (checkCompliance blocking flags) nor contains a
 * medical word nor matches the owner's kb_banned_phrases blocklist.
 *
 * `extra` layers kb_banned_phrases (same source checkCompliance uses).
 */
export function checkEffects(effects: string[], extra: ExtraBannedPhrase[] = []): EffectCheckResult {
  const allowed: string[] = [];
  const rejected: { effect: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const raw of effects) {
    const effect = String(raw ?? "").trim().toLowerCase();
    if (!effect) continue;
    if (seen.has(effect)) continue;
    seen.add(effect);

    if (!ALLOWED_EFFECT_SET.has(effect)) {
      rejected.push({ effect, reason: "not on the approved experiential-effect list" });
      continue;
    }
    if (EFFECT_MEDICAL_WORDS.some((w) => effect === w || effect.includes(w))) {
      rejected.push({ effect, reason: "contains a medical-claim word" });
      continue;
    }
    const compliance = checkCompliance(effect, extra);
    if (!compliance.ok) {
      rejected.push({ effect, reason: `blocked: ${compliance.blockingFlags.join(", ")}` });
      continue;
    }
    allowed.push(effect);
  }

  return { allowed, rejected, ok: rejected.length === 0 };
}

// =============================================================================
// DISPLAY LINTER \u2014 thin layer over checkCompliance for surfacing KB copy safely
// =============================================================================
// Slice 7b. Owner directive: "warnings only, no hard blocks unless it's truly a
// medicinal claim... relaxing or uplifting etc is fine... let me tell the
// customer how 'Stoney' the strain is." (see docs/COMPLIANCE_CLAIMS_REFERENCE.md)
//
// This is NOT a second rule engine \u2014 it reuses checkCompliance() (single source
// of truth for the regex + owner blocklist) and reshapes the verdict for two
// consumers:
//   1. The employee review UI  \u2192 wants warn/allow guidance, never a hard stop.
//   2. The PUBLIC product surface \u2192 must never render a TRUE curative/therapeutic
//      claim. So on the public path we DROP blocking copy (with an audit note)
//      rather than display it. Everything else (experiential/sensory) passes.
//
// The distinction the owner cares about: experiential words (relaxing, uplifting,
// stoney, mellow) are ALLOWED; only genuine medical/curative language blocks.
// checkCompliance already encodes exactly that split (RISKY_PATTERNS block =
// medical/curative + minors + safety + dosing; warn = hype/price).

/** Overall lint disposition for a piece of copy. */
export type CopyDisposition = "clean" | "warn" | "block";

export type CopyLintResult = {
  /** The disposition of the ORIGINAL text. */
  disposition: CopyDisposition;
  /** All human-readable flags (block + warn), suitable for a review UI. */
  flags: string[];
  /** Only the must-fix (curative/therapeutic/etc) flags. */
  blockingFlags: string[];
  /**
   * The text as it is SAFE to display publicly. When `disposition === "block"`
   * we return null (caller should fall back to a generic description) so a true
   * medical claim never reaches a customer. When "clean"/"warn" the original
   * text is returned unchanged (warnings are advisory, not display-blocking \u2014
   * per the owner's warn-only rule for borderline copy).
   */
  publicText: string | null;
};

/**
 * Lint a single copy string for public display. Reuses checkCompliance().
 *
 * `extra` layers the owner's kb_banned_phrases (same source everything else
 * uses). Empty/blank input is treated as clean with null publicText.
 */
export function lintCopy(text: string | null | undefined, extra: ExtraBannedPhrase[] = []): CopyLintResult {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return { disposition: "clean", flags: [], blockingFlags: [], publicText: null };
  }
  const res = checkCompliance(trimmed, extra);
  if (res.blockingFlags.length > 0) {
    // True medical/curative (or minors/safety/dosing) claim \u2014 never surface it.
    return { disposition: "block", flags: res.flags, blockingFlags: res.blockingFlags, publicText: null };
  }
  if (res.flags.length > 0) {
    // Borderline (hype/price) \u2014 owner wants warn-only, so still display it.
    return { disposition: "warn", flags: res.flags, blockingFlags: [], publicText: trimmed };
  }
  return { disposition: "clean", flags: [], blockingFlags: [], publicText: trimmed };
}

/**
 * Filter a list of short descriptor terms (aroma / flavor / terpene names /
 * effects) for public display. Each term is linted individually; any term whose
 * disposition is "block" is dropped. Returns the safe subset plus the dropped
 * terms (for optional audit/logging). De-dupes case-insensitively, preserves
 * order and original casing of the first occurrence.
 */
export function lintTerms(terms: string[], extra: ExtraBannedPhrase[] = []): { safe: string[]; dropped: string[] } {
  const safe: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of terms ?? []) {
    const term = String(raw ?? "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const res = lintCopy(term, extra);
    if (res.disposition === "block") dropped.push(term);
    else safe.push(term);
  }
  return { safe, dropped };
}

/**
 * The medical-claim phrases we want present in the owner-editable
 * kb_banned_phrases table so the DB-backed blocklist stays in sync with the
 * code. Used by the idempotent seed helper (src/lib/ai/kb/seed-banned.ts).
 */
export const MEDICAL_BANNED_PHRASES: { phrase: string; severity: ComplianceSeverity; reason: string }[] = [
  "cure",
  "cures",
  "treat",
  "treats",
  "heal",
  "heals",
  "prevent",
  "prevents",
  "diagnose",
  "remedy",
  "therapy",
  "therapeutic",
  "medicine",
  "medicinal",
  "disease",
  "disorder",
  "symptom",
  "clinically",
].map((phrase) => ({ phrase, severity: "block" as ComplianceSeverity, reason: "medical/therapeutic claim (WA I-502)" }));
