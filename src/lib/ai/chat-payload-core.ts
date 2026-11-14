/**
 * D244 E-0 — chat-completions payload builder (PURE, no I/O).
 *
 * Why this exists: the owner pointed AI_MODEL / AI_MODEL_HEAVY at a newer
 * reasoning-class model and bulk / single "Generate" started failing with a
 * 400 about `max_tokens`. Reasoning ids (o1/o3/o4…, gpt-5…, gpt-6…) reject
 * `max_tokens` (they want `max_completion_tokens`), usually reject a custom
 * `temperature`, and spend hidden "reasoning" tokens out of the same budget —
 * so a 320-token cap that is fine for gpt-4o-mini comes back EMPTY on gpt-5.
 *
 * Every request body in src/lib/ai/provider.ts that targets the OpenAI-style
 * endpoint is now built here, and a 400 that names a parameter is answered by
 * `adjustPayloadFor400` (one parameter fix per retry) instead of re-sending the
 * identical failing body.
 *
 * Gemini's OpenAI-compat fallback (geminiChatFallback) intentionally keeps its
 * own `max_tokens` body: Gemini accepts it and the R66 tests pin that path.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: unknown };

export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";

export type ChatPayloadOptions = {
  messages: ChatMessage[];
  /** The caller's visible-output budget (what it would pass as max_tokens). */
  maxTokens: number;
  /** Ignored for reasoning-class models (they only accept the default). */
  temperature?: number;
  responseFormat?: unknown;
  stream?: boolean;
  /** Reasoning-class models only. Defaults to "low" (fast + cheap drafts). */
  reasoningEffort?: ReasoningEffort | null;
};

export type ChatPayload = Record<string, unknown>;

/** Floor for a reasoning model's completion budget (reasoning + visible). */
export const REASONING_MIN_COMPLETION_TOKENS = 2000;
/** Reasoning models spend hidden tokens first — multiply the visible budget. */
export const REASONING_TOKEN_MULTIPLIER = 4;

/** Reasoning-class ids take max_completion_tokens and may refuse temperature. */
export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5|gpt-6)/i.test((model ?? "").trim());
}

/** The completion budget we actually send for a reasoning model. */
export function reasoningBudget(maxTokens: number): number {
  const n = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 0;
  return Math.max(n * REASONING_TOKEN_MULTIPLIER, REASONING_MIN_COMPLETION_TOKENS);
}

/** Build a chat-completions body that the given model will accept. */
export function buildChatPayload(model: string, opts: ChatPayloadOptions): ChatPayload {
  const payload: ChatPayload = { model, messages: opts.messages };
  if (isReasoningModel(model)) {
    payload.max_completion_tokens = reasoningBudget(opts.maxTokens);
    const effort = opts.reasoningEffort === undefined ? "low" : opts.reasoningEffort;
    if (effort) payload.reasoning_effort = effort;
  } else {
    payload.max_tokens = opts.maxTokens;
    if (opts.temperature !== undefined) payload.temperature = opts.temperature;
  }
  if (opts.responseFormat) payload.response_format = opts.responseFormat;
  if (opts.stream) payload.stream = true;
  return payload;
}

/**
 * Given a payload that just got HTTP 400 with `errorText`, return a NEW payload
 * with ONE offending parameter fixed, or null when nothing we know how to fix
 * is named (the caller then gives up and surfaces the error).
 */
export function adjustPayloadFor400(payload: ChatPayload, errorText: string): ChatPayload | null {
  const low = (errorText ?? "").toLowerCase();
  const next: ChatPayload = { ...payload };

  // Check max_completion_tokens BEFORE max_tokens ("max_tokens" is a substring).
  if (low.includes("max_completion_tokens") && "max_completion_tokens" in next && !("max_tokens" in next)) {
    // Model is NOT a reasoning model but we sent the reasoning field.
    next.max_tokens = next.max_completion_tokens;
    delete next.max_completion_tokens;
    return next;
  }
  if (low.includes("max_tokens") && "max_tokens" in next) {
    // "Unsupported parameter: 'max_tokens' … Use 'max_completion_tokens'".
    next.max_completion_tokens = reasoningBudget(Number(next.max_tokens));
    delete next.max_tokens;
    delete next.temperature;
    return next;
  }
  if (low.includes("temperature") && "temperature" in next) {
    delete next.temperature;
    return next;
  }
  if (low.includes("reasoning_effort") && "reasoning_effort" in next) {
    delete next.reasoning_effort;
    return next;
  }
  if ((low.includes("response_format") || low.includes("json_schema")) && "response_format" in next) {
    const rf = next.response_format as { type?: string } | undefined;
    if (rf && rf.type === "json_schema") next.response_format = { type: "json_object" };
    else delete next.response_format;
    return next;
  }
  return null;
}

/** Short, human-readable reason from a provider error string (for flashes). */
export function friendlyAiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.match(/"message"\s*:\s*"([^"]{1,220})"/);
  const core = (m ? m[1] : raw).replace(/\s+/g, " ").trim();
  return core.slice(0, 220) || "Unknown AI error";
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------
export function __runChatPayloadCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`chat-payload-core FAIL: ${label}`);
    }
  };
  const msgs: ChatMessage[] = [{ role: "user", content: "hi" }];

  ok(isReasoningModel("gpt-5"), "gpt-5 reasoning");
  ok(isReasoningModel("gpt-5.4-mini"), "gpt-5.x reasoning");
  ok(isReasoningModel("o3-mini"), "o3 reasoning");
  ok(isReasoningModel("O4-mini"), "case-insensitive");
  ok(!isReasoningModel("gpt-4o-mini"), "4o-mini not reasoning");
  ok(!isReasoningModel("gpt-4.1"), "4.1 not reasoning");
  ok(!isReasoningModel(""), "empty not reasoning");

  const light = buildChatPayload("gpt-4o-mini", { messages: msgs, maxTokens: 320, temperature: 0.4 });
  ok(light.max_tokens === 320, "light max_tokens");
  ok(light.temperature === 0.4, "light temperature");
  ok(!("max_completion_tokens" in light), "light no mct");
  ok(!("reasoning_effort" in light), "light no effort");

  const heavy = buildChatPayload("gpt-5", { messages: msgs, maxTokens: 320, temperature: 0.4 });
  ok(heavy.max_completion_tokens === 2000, "reasoning floor 2000");
  ok(!("max_tokens" in heavy), "reasoning no max_tokens");
  ok(!("temperature" in heavy), "reasoning no temperature");
  ok(heavy.reasoning_effort === "low", "reasoning default effort low");
  ok(buildChatPayload("o3", { messages: msgs, maxTokens: 900 }).max_completion_tokens === 3600, "4x budget");
  ok(!("reasoning_effort" in buildChatPayload("o3", { messages: msgs, maxTokens: 10, reasoningEffort: null })), "effort null omitted");
  ok(buildChatPayload("gpt-4o", { messages: msgs, maxTokens: 5, stream: true }).stream === true, "stream flag");
  ok(
    (buildChatPayload("gpt-4o", { messages: msgs, maxTokens: 5, responseFormat: { type: "json_object" } }).response_format as { type: string }).type ===
      "json_object",
    "response_format passed",
  );

  // 400 adjustments
  const a1 = adjustPayloadFor400(light, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.");
  ok(!!a1 && a1.max_completion_tokens === 2000 && !("max_tokens" in a1) && !("temperature" in a1), "max_tokens → mct");
  ok(light.max_tokens === 320, "adjust does not mutate input");
  const a2 = adjustPayloadFor400(heavy, "Unsupported parameter: 'max_completion_tokens'");
  ok(!!a2 && a2.max_tokens === 2000 && !("max_completion_tokens" in a2), "mct → max_tokens");
  const a3 = adjustPayloadFor400({ model: "x", temperature: 0.2, max_completion_tokens: 10 }, "Unsupported value: 'temperature' does not support 0.2");
  ok(!!a3 && !("temperature" in a3), "drop temperature");
  const a4 = adjustPayloadFor400(heavy, "Unrecognized request argument supplied: reasoning_effort");
  ok(!!a4 && !("reasoning_effort" in a4), "drop reasoning_effort");
  const a5 = adjustPayloadFor400({ model: "x", max_tokens: 1, response_format: { type: "json_schema" } }, "Invalid response_format json_schema");
  ok(!!a5 && (a5.response_format as { type: string }).type === "json_object", "json_schema → json_object");
  const a6 = adjustPayloadFor400({ model: "x", max_tokens: 1, response_format: { type: "json_object" } }, "response_format not supported");
  ok(!!a6 && !("response_format" in a6), "drop json_object");
  ok(adjustPayloadFor400(light, "Invalid API key") === null, "unknown error → null");

  ok(friendlyAiError(new Error('AI request failed (400): {"error":{"message":"Unsupported parameter: max_tokens"}}')) === "Unsupported parameter: max_tokens", "friendly extracts message");
  ok(friendlyAiError("plain") === "plain", "friendly plain");
  ok(friendlyAiError("") === "Unknown AI error", "friendly empty");

  return { passed, failed };
}
