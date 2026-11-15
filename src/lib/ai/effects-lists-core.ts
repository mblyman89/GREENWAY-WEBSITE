/**
 * src/lib/ai/effects-lists-core.ts — D244 R-23: the two effect word lists,
 * moved out of compliance.ts (server-only) unchanged so the Compliance
 * guardrails page can show them word for word. compliance.ts re-exports
 * ALLOWED_EFFECTS, so every import keeps working. PURE.
 */

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
  "productive",
  "tingly",
  "hungry",
  "munchies",
  "appetite",
  // Potency / character (experiential, per the compliance reference)
  "stoney",
  "potent",
  "buzzy",
  "cerebral",
  "body high",
  "head high",
] as const;

/**
 * Extra medical-claim words that, on their own, are never valid as an "effect"
 * value even though checkCompliance already flags them in prose. Keeping a small
 * dedicated list makes the effect validator strict and self-documenting.
 */
export const EFFECT_MEDICAL_WORDS = [
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
