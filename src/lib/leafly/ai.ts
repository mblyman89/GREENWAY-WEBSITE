/**
 * src/lib/leafly/ai.ts
 *
 * AI DRAFT assist for Leafly menu product descriptions (Slice 40).
 *
 * STANDING RULE: drafts only. The AI proposes a plain-text product description that a
 * staff member reviews, edits, and approves before it is ever attached to a menu item
 * or pushed to Leafly. Leafly requires PLAIN TEXT descriptions (no markup), so the
 * draft is returned as plain text and re-checked for compliance language.
 *
 * Grounded in the existing AI infrastructure (generateStructured + schema + compliance)
 * and the Leafly v2 data rules (see docs/leafly-menu-api-v2.md). Never invents
 * cannabinoid figures, brands, or strains — it only describes what it is given.
 *
 * Server-only.
 */
import "server-only";

import { generateStructured } from "@/lib/ai/provider";
import { defineSchema } from "@/lib/ai/schema";
import { checkCompliance, COMPLIANCE_SYSTEM, type ComplianceResult } from "@/lib/ai/compliance";
import { toPlainText } from "./payload-core";

export type LeaflyDescriptionDraft = {
  description: string;
};

const descriptionSchema = defineSchema<LeaflyDescriptionDraft>("leafly_description", {
  description: {
    kind: "string",
    description:
      "A plain-text product description for a Leafly menu, 1-3 sentences, no markup, no medical/therapeutic claims.",
    minLength: 20,
    maxLength: 600,
  },
});

export type DraftDescriptionInput = {
  name: string;
  brand?: string | null;
  category: string;
  strainType?: string | null;
  strainName?: string | null;
  thc?: string | null;
  cbd?: string | null;
  /** Anything the staff already wrote that the AI should refine rather than replace. */
  existing?: string | null;
};

export type DraftDescriptionResult = {
  description: string;
  compliance: ComplianceResult;
};

/**
 * Draft a single plain-text Leafly description. Throws AiNotConfiguredError when AI is
 * not configured so the caller can show a friendly message. The returned text is a
 * DRAFT — caller must surface compliance flags and require staff approval.
 */
export async function draftLeaflyDescription(
  input: DraftDescriptionInput,
): Promise<DraftDescriptionResult> {
  const system = [
    COMPLIANCE_SYSTEM,
    "",
    "You are writing a short product description for a Washington State (21+) licensed",
    "cannabis retailer's Leafly menu. Output PLAIN TEXT only — no HTML, markdown, lists,",
    "or emoji. 1 to 3 sentences. Describe aroma, flavor, format, and vibe.",
    "NEVER state or imply medical, therapeutic, curative, or health benefits.",
    "NEVER invent THC/CBD numbers, brand names, strains, or awards — use only the facts given.",
    "If a fact is missing, simply omit it. Keep it honest and appealing.",
  ].join("\n");

  const facts = [
    `Product name: ${input.name}`,
    input.brand ? `Brand: ${input.brand}` : null,
    `Category: ${input.category}`,
    input.strainType ? `Strain type: ${input.strainType}` : null,
    input.strainName ? `Strain: ${input.strainName}` : null,
    input.thc ? `THC: ${input.thc}` : null,
    input.cbd ? `CBD: ${input.cbd}` : null,
    input.existing ? `Existing copy to refine (keep the meaning): ${input.existing}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const user = `${facts}\n\nWrite the plain-text description now.`;

  const draft = await generateStructured<LeaflyDescriptionDraft>({
    system,
    user,
    schema: descriptionSchema,
    tier: "light",
    temperature: 0.4,
    maxTokens: 300,
    context: { feature: "leafly.description", entityType: "menu_item" },
  });

  // Enforce plain text defensively even if the model slipped in markup.
  const plain = toPlainText(draft.description) ?? draft.description.trim();
  const compliance = checkCompliance(plain);

  return { description: plain, compliance };
}
