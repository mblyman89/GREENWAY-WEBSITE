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
 */

export const GEMINI_SERVICE_TIERS = ["flex", "standard", "priority", "deferred"] as const;
export type GeminiServiceTier = (typeof GEMINI_SERVICE_TIERS)[number];
export const GEMINI_THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export const DEFAULT_THINKING_LEVEL = "low";

export type GeminiEnv = {
  AI_THINKING_LEVEL?: string;
  AI_GEMINI_URL_CONTEXT?: string;
  AI_GEMINI_SERVICE_TIER?: string;
  AI_GEMINI_SEED?: string;
};

export type GeminiBodyInput = {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** JSON schema for structured output (response_format). */
  jsonSchema?: Record<string, unknown> | null;
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
  const body: Record<string, unknown> = {
    model: input.model,
    ...(input.system.trim() ? { system_instruction: input.system } : {}),
    input: input.user,
    tools,
    generation_config: {
      max_output_tokens: input.maxTokens ?? 900,
      thinking_level: parseThinkingLevel(env.AI_THINKING_LEVEL),
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
  ok(gc.thinking_level === "low" && gc.max_output_tokens === 900 && !("seed" in gc) && !("temperature" in gc), "defaults");
  ok(!("service_tier" in b) && !("response_format" in b), "no tier / schema unless asked");
  const e = buildGeminiInteractionBody(
    { ...base, temperature: 0.4, maxTokens: 2000, jsonSchema: { type: "object" } },
    { AI_GEMINI_URL_CONTEXT: "off", AI_GEMINI_SERVICE_TIER: "Priority", AI_GEMINI_SEED: "42", AI_THINKING_LEVEL: "medium" },
  );
  const egc = e.generation_config as Record<string, unknown>;
  ok((e.tools as unknown[]).length === 1, "url_context off");
  ok(e.service_tier === "priority" && egc.seed === 42 && egc.thinking_level === "medium" && egc.temperature === 0.4, "env knobs");
  ok((e.response_format as Record<string, unknown>).mime_type === "application/json", "response_format");
  ok(parseServiceTier("gold") === null && parseSeed("4.2") === null && parseThinkingLevel("max") === "low", "invalid values ignored");
  ok(shouldRetryWithoutSchema(400, "Invalid response_format", true) && !shouldRetryWithoutSchema(400, "x", true) && !shouldRetryWithoutSchema(400, "schema", false), "schema retry rule");
  ok(!("system_instruction" in buildGeminiInteractionBody({ ...base, system: "  " }, {})), "blank system omitted");
  return { passed, failed };
}
