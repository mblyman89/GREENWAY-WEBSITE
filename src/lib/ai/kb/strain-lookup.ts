/**
 * src/lib/ai/kb/strain-lookup.ts
 *
 * Server-only wrapper for the Gemini STRAIN look-up (KB Strain Editor).
 *
 * Runs the same live web-search engine the product look-up uses
 * (provider.generateWebSearch → Gemini's google_search grounding, with a
 * graceful built-in-knowledge fallback), but with a STRAIN-shaped prompt and
 * the strain-shaped post-processor so we get a real terpenes[] array and the
 * exact kb_strains columns. Sanitizing + the compliance gate happen in the PURE
 * core (postProcessStrainLookup); a plain "not found" is a NORMAL result
 * (result.found === false), never an exception.
 *
 * Standing rules honored: no guessing (empty stays empty; low-signal → honest
 * miss), compliance-baked (summary gated), budget-guarded + usage-logged by the
 * provider. Server-only — never import into a client component.
 */
import "server-only";
import {
  generateWebSearch,
  isAiConfigured,
  aiWebSearchModelId,
  type AiContext,
} from "@/lib/ai/provider";
import { looseParseLookupJson } from "@/lib/inventory/product-lookup-parse";
import {
  STRAIN_LOOKUP_SYSTEM,
  STRAIN_LOOKUP_SHAPE_HINT,
  buildStrainLookupUserPrompt,
  coerceRawStrainLookup,
  postProcessStrainLookup,
  type StrainLookupResult,
} from "@/lib/ai/kb/strain-lookup-core";
import type { ExtraBannedPhrase } from "@/lib/ai/compliance";

export { isAiConfigured };

/** The model id the strain look-up uses (for provenance in the UI). */
export const strainLookupModelId = aiWebSearchModelId;

/** The full outcome handed back to the server action / UI. */
export type StrainLookupOutcome = {
  /** The sanitized, compliance-gated result. */
  result: StrainLookupResult;
  /** Real source URLs the model consulted (may be []). */
  sources: string[];
  /** The model id that produced this. */
  model: string;
  /** True when the live web_search tool ran; false on built-in-knowledge fallback. */
  usedWebSearch: boolean;
};

/**
 * Run the AI strain look-up for a single strain name. Throws only for hard
 * configuration/budget errors from the provider (so the server action can
 * surface a clear message); "not found" is a normal result.
 */
export async function lookupStrain(input: {
  strainName: string;
  extraBanned?: ExtraBannedPhrase[];
  context?: AiContext;
}): Promise<StrainLookupOutcome> {
  const user = buildStrainLookupUserPrompt(input.strainName);

  const ws = await generateWebSearch({
    system: STRAIN_LOOKUP_SYSTEM,
    user: `${user}${STRAIN_LOOKUP_SHAPE_HINT}`,
    // Mirror the product look-up's Gemini-grounding guidance: do NOT force a low
    // temperature (Google's Gemini 3 docs warn it can loop/degrade). The strict
    // JSON shape hint + postProcessStrainLookup keep the output well-formed.
    maxTokens: 1500,
    context: {
      feature: "kb.strain_lookup",
      ...input.context,
    },
  });

  const raw = coerceRawStrainLookup(looseParseLookupJson(ws.text));
  const result = postProcessStrainLookup(raw, input.extraBanned ?? []);

  return {
    result,
    sources: ws.sources,
    model: ws.model,
    usedWebSearch: ws.usedWebSearch,
  };
}
