/**
 * src/lib/ai/enrich-model.ts  (D244 round 2, slice R-1)
 *
 * Reads the enrichment model env ONCE (AI_ENRICH_MODEL, AI_ENRICH_REASONING_EFFORT,
 * falling back to AI_MODEL_HEAVY) through the pure resolver in enrich-model-core.
 * Imported by the all-fields drafter and by the pages that show the model.
 * No secrets here: only model ids.
 */
import { resolveEnrichModel, type EnrichModelChoice } from "./enrich-model-core";

export const enrichModel: EnrichModelChoice = resolveEnrichModel({
  enrichModel: process.env.AI_ENRICH_MODEL,
  heavyModel: process.env.AI_MODEL_HEAVY ?? process.env.OPENAI_MODEL_HEAVY,
  effort: process.env.AI_ENRICH_REASONING_EFFORT,
});

/**
 * D244 R-5: the Copilot's chat model. AI_COPILOT_MODEL (optional; the
 * recommendation is the flagship, ENRICH_RECOMMENDED.hard) else the
 * enrichment model above, with the same effort clamp.
 */
export const copilotModel: EnrichModelChoice = resolveEnrichModel({
  enrichModel: process.env.AI_COPILOT_MODEL,
  heavyModel: enrichModel.model,
  effort: process.env.AI_ENRICH_REASONING_EFFORT,
});
