/**
 * src/lib/ai/enrich-model-core.ts  (D244 round 2, slice R-1)
 *
 * Owner (verbatim): "I want to use a powerful ai modal that is best suited
 * for the task. I do not mind spending extra for a better quality experience
 * and better quality output. I will let you tell me what to use. we have gpt
 * and gemini available."
 *
 * ONE place that decides which model drafts product enrichment, independent
 * of AI_MODE (maintenance mode used to downshift "heavy" drafts to the light
 * model). Env (all optional; read by the caller and passed in, so this file
 * stays pure):
 *   AI_ENRICH_MODEL             the drafting model (default: AI_MODEL_HEAVY, else gpt-4o)
 *   AI_ENRICH_REASONING_EFFORT  low | medium | high (default medium)
 *
 * A "gemini-*" id is sent to Google's OpenAI-compatible endpoint with the
 * Gemini key (AI_GEMINI_API_KEY); anything else goes to AI_BASE_URL. The
 * effort is clamped to what the model accepts (GPT-6.x refuses "none" and
 * "minimal"; Gemini thinking levels come from gemini-models-core), and a
 * Gemini thinking model gets a >= 32K output ceiling (Google's guidance:
 * thinking tokens come out of the same budget, and a low cap silently
 * truncates the JSON).
 *
 * Pure: no I/O, no process.env. Self-tests registered in
 * scripts/compliance/run-pure-selftests.ts at an exact floor.
 */
import { isReasoningModel, type ReasoningEffort } from "./chat-payload-core";
import { clampThinkingLevel, effectiveMaxOutputTokens, isGeminiModelId, resolveGeminiModel } from "./gemini-models-core";

export type EnrichProvider = "openai" | "gemini";

export type EnrichModelChoice = {
  model: string;
  provider: EnrichProvider;
  /** Sent as reasoning_effort (OpenAI reasoning models and Gemini's compat layer). null = not sent. */
  effort: ReasoningEffort | null;
  /** Where the id came from, for the page ("AI_ENRICH_MODEL", "AI_MODEL_HEAVY", "default"). */
  source: "AI_ENRICH_MODEL" | "AI_MODEL_HEAVY" | "default";
};

export const ENRICH_DEFAULT_MODEL = "gpt-4o";
export const ENRICH_DEFAULT_EFFORT: ReasoningEffort = "medium";

/** The owner-facing recommendation (shown on the Bulk AI page and in the report). */
export const ENRICH_RECOMMENDED = {
  live: { model: "gpt-6.1-sol", effort: "medium" as ReasoningEffort, why: "near-flagship quality on structured JSON drafts, fast enough for one-product-at-a-time work" },
  batch: { model: "gemini-4-carbon", why: "Google's strongest reasoning model; the overnight Batch run is half price" },
  hard: { model: "gpt-6-astra", why: "the flagship, for the Copilot and the hardest products" },
} as const;

function clean(raw: unknown): string {
  return typeof raw === "string" ? raw.trim() : "";
}

function parseEffort(raw: unknown): ReasoningEffort | null {
  const v = clean(raw).toLowerCase();
  return v === "none" || v === "minimal" || v === "low" || v === "medium" || v === "high" ? v : null;
}

/** The effort a model will accept, closest to the one wanted (ties go up). */
export function effortForModel(model: string, wanted: ReasoningEffort): ReasoningEffort | null {
  if (isGeminiModelId(model)) {
    const p = resolveGeminiModel(model);
    // Gemini has no "none"; treat it as the lowest level the model lists.
    const w = wanted === "none" ? "minimal" : wanted;
    return clampThinkingLevel(p, w);
  }
  if (!isReasoningModel(model)) return null;
  if (/^gpt-6/i.test(model) && (wanted === "none" || wanted === "minimal")) return "low";
  return wanted;
}

export function resolveEnrichModel(env: { enrichModel?: unknown; heavyModel?: unknown; effort?: unknown }): EnrichModelChoice {
  const pinned = clean(env.enrichModel);
  const heavy = clean(env.heavyModel);
  const model = pinned || heavy || ENRICH_DEFAULT_MODEL;
  const source: EnrichModelChoice["source"] = pinned ? "AI_ENRICH_MODEL" : heavy ? "AI_MODEL_HEAVY" : "default";
  const provider: EnrichProvider = isGeminiModelId(model) ? "gemini" : "openai";
  const effort = effortForModel(model, parseEffort(env.effort) ?? ENRICH_DEFAULT_EFFORT);
  return { model, provider, effort, source };
}

/**
 * The output budget to send. OpenAI reasoning models are handled by
 * buildChatPayload (max_completion_tokens = 4x, >= 2000); a Gemini thinking
 * model needs >= 32K or its thinking eats the answer.
 */
export function enrichMaxTokens(choice: Pick<EnrichModelChoice, "model" | "provider">, answerTokens: number): number {
  if (choice.provider !== "gemini") return answerTokens;
  return effectiveMaxOutputTokens(resolveGeminiModel(choice.model), answerTokens);
}

/** One plain line for the page: "gpt-6.1-sol · OpenAI · effort medium (AI_ENRICH_MODEL)". */
export function enrichModelLine(c: EnrichModelChoice): string {
  return `${c.model} · ${c.provider === "gemini" ? "Google Gemini" : "OpenAI"}${c.effort ? ` · effort ${c.effort}` : ""} (${c.source === "default" ? "built-in default" : c.source})`;
}

export function __runEnrichModelCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`enrich-model-core FAIL: ${label}`);
    }
  };
  const a = resolveEnrichModel({});
  ok(a.model === "gpt-4o" && a.source === "default" && a.provider === "openai" && a.effort === null, "default gpt-4o, no effort (not reasoning)");
  const b = resolveEnrichModel({ heavyModel: "gpt-5.4" });
  ok(b.model === "gpt-5.4" && b.source === "AI_MODEL_HEAVY" && b.effort === "medium", "falls back to heavy, effort medium");
  const c = resolveEnrichModel({ enrichModel: " gpt-6.1-sol ", heavyModel: "gpt-4o", effort: "minimal" });
  ok(c.model === "gpt-6.1-sol" && c.source === "AI_ENRICH_MODEL" && c.effort === "low", "pin wins; gpt-6 minimal -> low");
  ok(resolveEnrichModel({ enrichModel: "gpt-6-astra", effort: "none" }).effort === "low", "astra none -> low");
  ok(resolveEnrichModel({ enrichModel: "gpt-6-astra", effort: "HIGH" }).effort === "high", "effort case-insensitive");
  ok(resolveEnrichModel({ enrichModel: "gpt-5", effort: "minimal" }).effort === "minimal", "gpt-5 keeps minimal");
  ok(resolveEnrichModel({ enrichModel: "gpt-6.1-sol", effort: "junk" }).effort === "medium", "junk effort -> default");
  const g = resolveEnrichModel({ enrichModel: "gemini-4-carbon" });
  ok(g.provider === "gemini" && g.effort === "medium", "gemini provider, default medium");
  ok(resolveEnrichModel({ enrichModel: "gemini-4-carbon", effort: "minimal" }).effort === "low", "carbon has no minimal -> low");
  ok(resolveEnrichModel({ enrichModel: "gemini-3.6-flash", effort: "minimal" }).effort === "minimal", "3.6 flash keeps minimal");
  ok(enrichMaxTokens(g, 1100) === 32_768, "gemini output floor 32K");
  ok(enrichMaxTokens(c, 1100) === 1100, "openai budget untouched (payload builder scales it)");
  ok(enrichModelLine(c) === "gpt-6.1-sol · OpenAI · effort low (AI_ENRICH_MODEL)", "line");
  ok(enrichModelLine(a) === "gpt-4o · OpenAI (built-in default)", "line default");
  ok(enrichModelLine(g).includes("Google Gemini"), "line gemini");
  ok(effortForModel("gpt-4.1", "high") === null, "non-reasoning gets no effort");
  return { passed, failed };
}
