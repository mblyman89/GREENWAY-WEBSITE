/**
 * gemini-request-core -- Round 51 D1 (pure, self-tested).
 *
 * Builds the CreateInteraction body the Gemini web-search path sends to the
 * Interactions API (https://ai.google.dev/api/interactions-api, bible S2):
 *   - `system_instruction` sent on its own (no longer glued into `input`);
 *   - tools `google_search` + `url_context` (url_context reads HTML, PDF and
 *     images; up to 20 URLs per request - bible R5). AI_GEMINI_URL_CONTEXT=off
 *     drops it;
 *   - optional `service_tier` (flex|standard|priority|deferred) from
 *     AI_GEMINI_SERVICE_TIER - not sent when unset or invalid;
 *   - optional `generation_config.seed` from AI_GEMINI_SEED (integer);
 *   - optional `response_format` (JSON schema) when a caller passes one;
 *     Gemini 3+ may combine structured output with tools (bible R3).
 * No `Api-Revision` header: Google ignores it after 2026-06-08 (bible R2).
 *
 * R66: the body is now MODEL-AWARE (gemini-models-core.ts):
 *   - the id sent is the profile id (a retired id such as gemini-3.7-flash is
 *     sent as the gemini-3.8-flash Google routes it to);
 *   - thinking_level = caller's explicit level > AI_THINKING_LEVEL > the
 *     model's own default (medium on 3.8 Flash / 4 Argon), always CLAMPED to
 *     a level the model accepts ("minimal" errors on 3.8 Flash);
 *   - max_output_tokens counts thinking + answer, so the caller's answer size
 *     gets thinking headroom (>= 32,768, Google's advice) up to the model max;
 *     AI_GEMINI_MAX_OUTPUT_TOKENS overrides; `exactMaxTokens` (the incomplete
 *     retry) is sent as is, capped at the model max.
 */
import {
  chooseThinkingLevel,
  clampThinkingLevel,
  effectiveMaxOutputTokens,
  parseThinkingWanted,
  resolveGeminiModel,
} from "./gemini-models-core";

export const GEMINI_SERVICE_TIERS = ["flex", "standard", "priority", "deferred"] as const;
export type GeminiServiceTier = (typeof GEMINI_SERVICE_TIERS)[number];
export const GEMINI_THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
/**
 * Only the fallback of parseThinkingLevel (kept for older callers). The body
 * no longer uses it: unset AI_THINKING_LEVEL now means "the model's default".
 */
export const DEFAULT_THINKING_LEVEL = "low";

export type GeminiEnv = {
  AI_THINKING_LEVEL?: string;
  AI_GEMINI_URL_CONTEXT?: string;
  AI_GEMINI_SERVICE_TIER?: string;
  AI_GEMINI_SEED?: string;
  /** R66: explicit output ceiling (thinking + answer); capped at the model max. */
  AI_GEMINI_MAX_OUTPUT_TOKENS?: string;
};

export type GeminiBodyInput = {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** JSON schema for structured output (response_format). */
  jsonSchema?: Record<string, unknown> | null;
  /** R66: a per-call thinking level (e.g. the background batch); clamped per model. */
  thinkingLevel?: string | null;
  /** R66: send exactly this ceiling (the incomplete retry); capped at the model max. */
  exactMaxTokens?: number | null;
};

export function parseServiceTier(raw: unknown): GeminiServiceTier | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (GEMINI_SERVICE_TIERS as readonly string[]).includes(v) ? (v as GeminiServiceTier) : null;
}

export function parseThinkingLevel(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (GEMINI_THINKING_LEVELS as readonly string[]).includes(v) ? v : DEFAULT_THINKING_LEVEL;
}

export function parseSeed(raw: unknown): number | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!/^-?\d{1,9}$/.test(v)) return null;
  return Number(v);
}

export function urlContextEnabled(raw: unknown): boolean {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return !(v === "off" || v === "false" || v === "0" || v === "no");
}

export function buildGeminiInteractionBody(input: GeminiBodyInput, env: GeminiEnv): Record<string, unknown> {
  const tools: Array<Record<string, unknown>> = [{ type: "google_search" }];
  if (urlContextEnabled(env.AI_GEMINI_URL_CONTEXT)) tools.push({ type: "url_context" });
  const seed = parseSeed(env.AI_GEMINI_SEED);
  const tier = parseServiceTier(env.AI_GEMINI_SERVICE_TIER);
  const profile = resolveGeminiModel(input.model);
  const thinking = chooseThinkingLevel(profile, input.thinkingLevel, env.AI_THINKING_LEVEL).level;
  const exact = typeof input.exactMaxTokens === "number" && Number.isFinite(input.exactMaxTokens) && input.exactMaxTokens >= 1
    ? Math.min(Math.floor(input.exactMaxTokens), profile.maxOutputTokens)
    : null;
  const body: Record<string, unknown> = {
    model: profile.id,
    ...(input.system.trim() ? { system_instruction: input.system } : {}),
    input: input.user,
    tools,
    generation_config: {
      max_output_tokens: exact ?? effectiveMaxOutputTokens(profile, input.maxTokens, env.AI_GEMINI_MAX_OUTPUT_TOKENS),
      thinking_level: thinking,
      ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
      ...(seed !== null ? { seed } : {}),
    },
  };
  if (tier) body.service_tier = tier;
  if (input.jsonSchema) {
    body.response_format = { type: "text", mime_type: "application/json", schema: input.jsonSchema };
  }
  return body;
}

/** R66: the thinking level a body will carry (for the usage log + the batch row). */
export function thinkingLevelFor(model: string, explicit: unknown, env: GeminiEnv): string {
  const profile = resolveGeminiModel(model);
  const wanted = parseThinkingWanted(explicit) ?? parseThinkingWanted(env.AI_THINKING_LEVEL) ?? profile.defaultThinking;
  return clampThinkingLevel(profile, wanted);
}

/** A 400 that names the structured-output field: retry once without it. */
export function shouldRetryWithoutSchema(status: number, detail: string, sentSchema: boolean): boolean {
  return sentSchema && status === 400 && /response_format|schema|mime_type/i.test(detail);
}

export function __runGeminiRequestCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL gemini-request-core:", m);
    }
  };
  const base = { model: "gemini-4-argon", system: "SYS", user: "ASK" };
  const b = buildGeminiInteractionBody(base, {});
  const gc = b.generation_config as Record<string, unknown>;
  ok(b.system_instruction === "SYS" && b.input === "ASK", "system sent separately");
  ok(JSON.stringify(b.tools) === JSON.stringify([{ type: "google_search" }, { type: "url_context" }]), "google_search + url_context by default");
  // R66: unset AI_THINKING_LEVEL = the model's own default (argon: medium);
  // a 900-token answer gets Google's >= 32,768 thinking headroom.
  ok(gc.thinking_level === "medium" && gc.max_output_tokens === 32_768 && !("seed" in gc) && !("temperature" in gc), "defaults");
  ok(b.model === "gemini-4-argon", "model id kept");
  ok(!("service_tier" in b) && !("response_format" in b), "no tier / schema unless asked");
  const e = buildGeminiInteractionBody(
    { ...base, temperature: 0.4, maxTokens: 2000, jsonSchema: { type: "object" } },
    { AI_GEMINI_URL_CONTEXT: "off", AI_GEMINI_SERVICE_TIER: "Priority", AI_GEMINI_SEED: "42", AI_THINKING_LEVEL: "high" },
  );
  const egc = e.generation_config as Record<string, unknown>;
  ok((e.tools as unknown[]).length === 1, "url_context off");
  ok(e.service_tier === "priority" && egc.seed === 42 && egc.thinking_level === "high" && egc.temperature === 0.4, "env knobs");
  ok((e.response_format as Record<string, unknown>).mime_type === "application/json", "response_format");
  ok(parseServiceTier("gold") === null && parseSeed("4.2") === null && parseThinkingLevel("max") === "low", "invalid values ignored");
  // R66: model-aware body
  const f37 = buildGeminiInteractionBody({ ...base, model: "gemini-3.7-flash", maxTokens: 4000 }, { AI_THINKING_LEVEL: "minimal" });
  const f37gc = f37.generation_config as Record<string, unknown>;
  ok(f37.model === "gemini-3.8-flash", "retired 3.7 flash sent as 3.8 flash");
  ok(f37gc.thinking_level === "low", "minimal clamped to low on 3.8 flash (minimal errors there)");
  ok(f37gc.max_output_tokens === 32_768, "4000-token answer gets thinking headroom");
  const ex = buildGeminiInteractionBody({ ...base, model: "gemini-3.8-flash", thinkingLevel: "high" }, { AI_THINKING_LEVEL: "low" });
  ok((ex.generation_config as Record<string, unknown>).thinking_level === "high", "explicit per-call level beats the env");
  const exact = buildGeminiInteractionBody({ ...base, model: "gemini-3.8-flash", exactMaxTokens: 999_999 }, {});
  ok((exact.generation_config as Record<string, unknown>).max_output_tokens === 65_536, "exact ceiling capped at the model max");
  const ov = buildGeminiInteractionBody({ ...base, model: "gemini-3.8-flash" }, { AI_GEMINI_MAX_OUTPUT_TOKENS: "16000" });
  ok((ov.generation_config as Record<string, unknown>).max_output_tokens === 16_000, "env ceiling honoured");
  const fut = buildGeminiInteractionBody({ ...base, model: "gemini-3.9-flash" }, { AI_THINKING_LEVEL: "minimal" });
  ok(fut.model === "gemini-3.9-flash" && (fut.generation_config as Record<string, unknown>).thinking_level === "low", "unknown future model: safe level");
  ok(thinkingLevelFor("gemini-3.8-flash", undefined, {}) === "medium" && thinkingLevelFor("gemini-3.8-flash", "minimal", {}) === "low", "thinkingLevelFor");
  ok(shouldRetryWithoutSchema(400, "Invalid response_format", true) && !shouldRetryWithoutSchema(400, "x", true) && !shouldRetryWithoutSchema(400, "schema", false), "schema retry rule");
  ok(!("system_instruction" in buildGeminiInteractionBody({ ...base, system: "  " }, {})), "blank system omitted");
  return { passed, failed };
}
