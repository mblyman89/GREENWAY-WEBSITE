/**
 * src/lib/ai/compliance.ts
 *
 * WA cannabis advertising guardrails for AI-generated copy. These are baked
 * into every prompt's system message AND applied as a post-generation filter.
 * The goal: AI never drafts language that violates RCW/WAC rules (no health or
 * medical claims, nothing appealing to minors, no dosing advice, no claims of
 * safety/efficacy). Output is still employee-validated before publish.
 */
import "server-only";

export const PROMPT_VERSION = "v1";

/** System rules prepended to every cannabis copy prompt. */
export const COMPLIANCE_SYSTEM = `
You write marketing copy for a licensed Washington State (I-502) cannabis retailer.
You MUST follow these rules without exception:
- NO health, medical, therapeutic, or curative claims (do not say it treats,
  cures, heals, relieves, or helps any condition, symptom, pain, anxiety, sleep,
  etc.).
- NO claims of safety, efficacy, or that the product is "safe", "healthy", or
  "good for you".
- NO dosing advice or consumption instructions/quantities.
- NOTHING that appeals to minors: no cartoons, candy comparisons aimed at kids,
  toys, or youthful slang; keep it adult and tasteful.
- NO false or misleading statements; do not invent lab results, awards, origins,
  or effects you were not given.
- Keep it tasteful, factual, and brand-appropriate. Describe aroma, flavor,
  format, lineage/strain type, and craftsmanship — not effects on the body.
- Write for adults 21+. Do not include price or stock.
Tone: warm, knowledgeable, concise. Avoid hype words like "best", "amazing".
`.trim();

/** Phrases that, if present in output, indicate a likely compliance problem. */
const RISKY_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(cure|cures|curing|heal|heals|healing|treat|treats|treating|remedy)\b/i, label: "medical claim (cure/treat/heal)" },
  { pattern: /\b(relieve|relieves|relief|reduces? (pain|anxiety|stress|inflammation))\b/i, label: "symptom-relief claim" },
  { pattern: /\b(pain|anxiety|depression|insomnia|ptsd|cancer|arthritis|migraine|nausea|seizure)\b/i, label: "named medical condition" },
  { pattern: /\b(safe|healthy|good for you|non-?addictive|harmless)\b/i, label: "safety/efficacy claim" },
  { pattern: /\b(dose|dosage|take \d|mg per|how much to (take|consume)|start with)\b/i, label: "dosing advice" },
  { pattern: /\b(candy|gummy bears?|kid|kids|children|cartoon)\b/i, label: "appeal-to-minors language" },
  { pattern: /\b(guarantee|guaranteed|miracle|clinically proven)\b/i, label: "unsubstantiated claim" },
];

export type ComplianceResult = {
  ok: boolean;
  flags: string[];
};

/** Scan generated text for risky language. Does not modify the text. */
export function checkCompliance(text: string): ComplianceResult {
  const flags: string[] = [];
  for (const { pattern, label } of RISKY_PATTERNS) {
    if (pattern.test(text)) flags.push(label);
  }
  return { ok: flags.length === 0, flags };
}
