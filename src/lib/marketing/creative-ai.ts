/**
 * src/lib/marketing/creative-ai.ts
 *
 * Greenway AI × FLUX — the "creative director" that makes image generation
 * fool-proof. The employee picks WHERE the image goes (a placement) and types
 * a plain-English idea (or picks a live promotion); the AI drafts the full
 * creative brief — grounded in REAL store data:
 *
 *   - the store profile (name, city/state) — never invented
 *   - the store's LIVE published promotions (titles + real offer mechanics
 *     from the discount engine, e.g. "25% off"), so a "Monday deal banner"
 *     uses the actual Monday deal
 *   - the placement's own art direction (where it displays, what composition
 *     works there) from the verified creative-placements registry
 *
 * DRAFTS-ONLY: the suggestion lands in the builder's editable fields; the
 * employee reviews (and can regenerate/adjust) before anything is generated,
 * and every FLUX output is saved as a DRAFT media asset requiring human
 * publish. Every suggestion is scanned with checkCompliance so WA I-502
 * red flags are surfaced immediately.
 *
 * Uses generateStructured (schema-constrained + validated + budget-guarded).
 */
import "server-only";

import { generateStructured, isAiConfigured } from "@/lib/ai/provider";
import { defineSchema } from "@/lib/ai/schema";
import { checkCompliance } from "@/lib/ai/compliance";
import { COMPLIANCE_NOTE } from "@/lib/marketing/midjourney-core";
import type { CreativePlacement } from "@/lib/marketing/creative-placements-core";

export { isAiConfigured };

export type CreativeConcept = {
  subject: string;
  environment: string;
  composition: string;
  lighting: string;
  style: string;
  colorMood: string;
  exclude: string;
  /** 1–2 sentences explaining the creative choices (shown to the employee). */
  rationale: string;
};

export type CreativeConceptResult = {
  concept: CreativeConcept;
  /** WA-advertising compliance flags found in the suggestion (may be empty). */
  complianceFlags: string[];
};

const conceptSchema = defineSchema<CreativeConcept>("creative_concept", {
  subject: { kind: "string", description: "Main subject, short phrase, leads the image", minLength: 3, maxLength: 200 },
  environment: { kind: "string", description: "Setting / context", maxLength: 200 },
  composition: { kind: "string", description: "Shot / framing that suits the destination", maxLength: 200 },
  lighting: { kind: "string", description: "Lighting description", maxLength: 200 },
  style: { kind: "string", description: "Style / medium (e.g. premium editorial photography)", maxLength: 200 },
  colorMood: { kind: "string", description: "Palette and mood; hex codes allowed for brand colors", maxLength: 200 },
  exclude: { kind: "string", description: "Things to avoid in the image", maxLength: 200 },
  rationale: { kind: "string", description: "1-2 sentences explaining the creative choices", maxLength: 400 },
});

const SYSTEM = [
  "You are the senior creative director for a licensed Washington State cannabis retailer.",
  "You draft image-generation briefs for the FLUX 2 image model. Write natural descriptive phrases (no Midjourney-style '--' flags).",
  "Brand palette: Greenway green #7ed957 on near-black; gold #ffd700 accents. Use hex codes in colorMood when steering brand colors.",
  "Ground every suggestion ONLY in the store facts, live promotions, and destination brief provided — never invent products, prices, or offers.",
  "The image must contain NO text unless the destination brief explicitly allows it — headlines are added later by designers.",
  `Compliance: ${COMPLIANCE_NOTE} Never suggest imagery that appeals to minors (no cartoons, candy, toys), no consumption by anyone appearing under 21, and no health/medical claims.`,
].join(" ");

/**
 * Draft a full creative concept for a placement + idea, grounded in real
 * store/promotion context. Throws on AI-unconfigured / budget errors —
 * callers surface the message. DRAFTS-ONLY by design.
 */
export async function suggestCreativeConcept(input: {
  /** Plain-English idea from the employee (may be short, e.g. "Monday pre-roll deal"). */
  idea: string;
  /** Where the image will be displayed (from the verified placements registry). */
  placement?: CreativePlacement | null;
  /** Grounded store blurb (name, city, vendors) — built by the caller from real data. */
  brandContext?: string;
  /** Grounded live-promotions blurb — built by the caller from published rules. */
  promotionsContext?: string;
}): Promise<CreativeConceptResult> {
  const idea = (input.idea ?? "").trim();
  const userParts = [
    `Image idea: ${idea || "(none given — propose something on-brand for the destination)"}`,
  ];
  if (input.placement) {
    userParts.push(
      [
        `Destination: ${input.placement.label} (${input.placement.width}×${input.placement.height}px).`,
        `Where it displays: ${input.placement.where}`,
        `Destination art direction: ${input.placement.promptHint}`,
      ].join("\n"),
    );
  }
  if (input.brandContext) userParts.push(`Store facts (use these, do not invent):\n${input.brandContext}`);
  if (input.promotionsContext) userParts.push(`Live promotions right now (real offers — use exactly):\n${input.promotionsContext}`);
  userParts.push("Draft the creative concept now.");

  const concept = await generateStructured<CreativeConcept>({
    system: SYSTEM,
    user: userParts.join("\n\n"),
    schema: conceptSchema,
    tier: "light",
    temperature: 0.6,
    maxTokens: 700,
    context: { feature: "creative-concept" },
  });

  // Compliance scan across every field the employee might use verbatim.
  const combined = [
    concept.subject,
    concept.environment,
    concept.composition,
    concept.lighting,
    concept.style,
    concept.colorMood,
    concept.rationale,
  ]
    .filter(Boolean)
    .join(" ");
  const compliance = checkCompliance(combined);

  return { concept, complianceFlags: compliance.flags };
}
