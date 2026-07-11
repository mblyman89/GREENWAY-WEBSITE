/**
 * src/lib/discovery/benchmarks-ai.ts
 *
 * "ASK THE ANALYST" — free-text Q&A over the persisted CCRS benchmark rollups
 * (Task I, I7). Owner's ask (verbatim intent): "I want ai to be included in
 * all of the benchmarks sections … I want to be able to ask questions and have
 * appropriate and fantastic responses and insights."
 *
 * The owner (or purchase manager) types any question; the server builds a
 * grounded digest from the SAME persisted rollups the page renders (statewide
 * benchmarks / local competitor stats — see benchmarks-ai-core.ts) and returns
 * a structured, cited answer.
 *
 * Standing rules honored:
 *  - Drafts-only / advisory: it changes NOTHING. It informs a human decision.
 *  - No guessing: the model reasons ONLY over the digest; the schema forces a
 *    key_facts grounding trail and a caveats block; the SYSTEM prompt forbids
 *    invented figures and month-to-year extrapolation.
 *  - Heavy tier: router-controlled (gpt-4o in sprint mode, light model in
 *    maintenance mode). Budget-guarded + usage-logged by the provider.
 *
 * Server-only. Never import into a client component.
 */
import "server-only";
import {
  generateStructured,
  isAiConfigured,
  aiModelId,
  type AiContext,
} from "@/lib/ai/provider";
import { aiHeavyModelId, aiMode } from "@/lib/ai/router";
import { defineSchema } from "@/lib/ai/schema";
import type { AnalystAnswer } from "@/lib/discovery/benchmarks-ai-core";

export { isAiConfigured };

/** The model id the analyst will actually use, for provenance in the UI. */
export const benchmarksAnalystModelId = aiMode === "sprint" ? aiHeavyModelId : aiModelId;

// ---------------------------------------------------------------------------
// Output schema (flat DSL — arrays of strings, validated before reaching UI)
// ---------------------------------------------------------------------------

type RawAnalystAnswer = {
  headline: string;
  answer_points: string[];
  key_facts: string[];
  caveats: string[];
  follow_ups: string[];
};

const analystAnswerSchema = defineSchema<RawAnalystAnswer>("benchmark_analyst_answer", {
  headline: {
    kind: "string",
    description:
      "A direct 1-2 sentence answer to the user's question, grounded ONLY in the provided data. If the data cannot answer the question, say so plainly here.",
    minLength: 12,
    maxLength: 400,
  },
  answer_points: {
    kind: "stringArray",
    description:
      "The full answer as 2-8 ordered points. Each point must rest on figures from the DATA section — quote the actual numbers (with $ and store/type/brand names) as given. Never invent or adjust a figure.",
    maxItems: 8,
  },
  key_facts: {
    kind: "stringArray",
    description:
      "2-6 verbatim-style citations of the specific DATA lines the answer rests on, e.g. 'Port Orchard: median_retail=$21.00 across 2 stores'. These are the grounding trail — only figures that appear in the DATA section.",
    maxItems: 8,
  },
  caveats: {
    kind: "stringArray",
    description:
      "1-4 honest limits: one-month scope, thin samples (low n), missing fields shown as n/a, retail-vs-wholesale basis, or that the data simply can't answer part of the question.",
    maxItems: 6,
  },
  follow_ups: {
    kind: "stringArray",
    description:
      "2-4 follow-up questions this SAME dataset could answer well (never suggest questions requiring data that wasn't provided).",
    maxItems: 6,
  },
});

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

const SYSTEM = [
  "You are a sharp cannabis retail market analyst for Greenway Marijuana, a licensed Washington State (I-502) dispensary in Port Orchard.",
  "You are given a DATA section — real, persisted rollups computed from Washington's CCRS traceability data — and ONE question from the store's owner or purchase manager. Answer the question from the DATA alone.",
  "HARD RULES:",
  "- Use ONLY figures that appear in the DATA section. NEVER invent, estimate, or adjust a number. If a needed figure is 'n/a' or absent, say so plainly instead of guessing.",
  "- Every monetary figure you cite must keep its basis: RETAIL prices are what shoppers paid at other stores; WHOLESALE prices are what stores paid vendors. Never mix or compare the two as if they were the same thing.",
  "- The data covers ONE monthly drop (plus a month-over-month history table when provided). Never annualize or extrapolate a month to a longer period.",
  "- Greenway's own sales are NOT in this data (it is structurally excluded). Never present a competitor figure as Greenway's.",
  "- When the question touches local strategy, weight Port Orchard first — it is the market Greenway most needs to win.",
  "- Small samples (low n) are weak evidence — flag them in caveats rather than leaning on them.",
  "- If the question cannot be answered from the DATA at all, say exactly that in the headline and suggest what the data CAN answer instead.",
  "Be concrete, numeric, and buyer-focused. No medical or health claims. Advisory only — you never place orders or change data.",
].join("\n");

/**
 * Answer one free-text question over a grounded digest. Throws
 * AiNotConfiguredError when no AI key is set; budget/HTTP errors surface to
 * the caller (which turns them into a friendly message).
 */
export async function generateAnalystAnswer(
  question: string,
  digest: string,
  ctx?: AiContext,
): Promise<AnalystAnswer> {
  const raw = await generateStructured({
    system: SYSTEM,
    user: `QUESTION: ${question}\n\nDATA:\n${digest}`,
    schema: analystAnswerSchema,
    tier: "heavy", // → gpt-4o in sprint mode (router-controlled), light in maintenance
    maxTokens: 1400,
    temperature: 0.2,
    context: { feature: "discovery.benchmarks_analyst", ...ctx },
  });

  return {
    headline: raw.headline,
    answer_points: raw.answer_points ?? [],
    key_facts: raw.key_facts ?? [],
    caveats: raw.caveats ?? [],
    follow_ups: raw.follow_ups ?? [],
    model: benchmarksAnalystModelId,
  };
}
