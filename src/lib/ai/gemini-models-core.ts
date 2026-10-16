/**
 * gemini-models-core -- Round 66 (pure, self-tested).
 *
 * ONE place that knows what each Gemini model can do, so the next model
 * upgrade is a one-line table change (or no change at all: an unknown id
 * falls back to safe defaults every current Gemini 3+ model accepts).
 *
 * Sources (Google AI for Developers, read 2026 for R66):
 *   - Thinking guide, "thinking levels" table:
 *       gemini-4-argon          default medium  levels low, medium, high
 *       gemini-3.8-flash        default medium  levels low, medium, high
 *       gemini-3.6-flash        default medium  levels minimal, low, medium, high
 *       gemini-3.5-flash-lite   default minimal levels minimal, low, medium, high
 *       gemini-3.1-pro-preview  default high    levels low, medium, high
 *       gemini-3-flash-preview  default high    levels minimal, low, medium, high
 *       gemini-3-pro-preview    default high    levels low, high
 *       gemini-2.5-pro / -flash / -flash-lite   levels low, medium, high
 *     Sending a level a model does not list returns an error, so we clamp.
 *   - Gemini 3.7 Flash page: DEPRECATED; "API requests to gemini-3.7-flash are
 *     automatically routed to gemini-3.8-flash". We send the routed id.
 *   - Gemini 3.8 Flash page: output token limit 65,536.
 *   - Gemini 4 Argon guide: "max_output_tokens" counts thinking AND answer;
 *     "Existing apps with a limit lower than 32K: raise max_output_tokens to at
 *     least 32,768"; hitting the cap ends with status "incomplete" (still
 *     billed). Sync requests may not exceed 65,536.
 *   - Interactions usage object: total_input_tokens, total_output_tokens,
 *     total_thought_tokens, total_tokens (billing = output + thought).
 *   - Community (discuss.ai.google.dev, Sept 2026): recurring 503 UNAVAILABLE
 *     on 3.6/3.7/3.8 Flash even on paid tiers -> retry with backoff.
 *
 * No imports, no I/O, no process.env. Registered in the pure self-test runner.
 */

export const THINKING_ORDER = ["minimal", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_ORDER)[number];

export type GeminiModelProfile = {
  /** The id we actually send (a deprecated id becomes the id Google routes it to). */
  id: string;
  /** True when the id came from the table (false = a future/unknown id on safe defaults). */
  known: boolean;
  /** The configured id was deprecated and is routed by Google to `id`. */
  routedFrom: string | null;
  thinkingLevels: readonly ThinkingLevel[];
  defaultThinking: ThinkingLevel;
  /** Hard synchronous output cap (thinking + answer). */
  maxOutputTokens: number;
};

type Row = { levels: readonly ThinkingLevel[]; def: ThinkingLevel; maxOut: number; routedTo?: string };

const LMH: readonly ThinkingLevel[] = ["low", "medium", "high"];
const ALL: readonly ThinkingLevel[] = ["minimal", "low", "medium", "high"];

/** The capability table. Add a row here when Google ships a model. */
export const GEMINI_MODEL_TABLE: Readonly<Record<string, Row>> = {
  "gemini-4-argon": { levels: LMH, def: "medium", maxOut: 65_536 },
  "gemini-3.8-flash": { levels: LMH, def: "medium", maxOut: 65_536 },
  "gemini-3.7-flash": { levels: LMH, def: "medium", maxOut: 65_536, routedTo: "gemini-3.8-flash" },
  "gemini-3.6-flash": { levels: ALL, def: "medium", maxOut: 65_536 },
  "gemini-3.5-flash-lite": { levels: ALL, def: "minimal", maxOut: 65_536 },
  "gemini-3.1-pro-preview": { levels: LMH, def: "high", maxOut: 65_536 },
  "gemini-3-flash-preview": { levels: ALL, def: "high", maxOut: 65_536 },
  "gemini-3-pro-preview": { levels: ["low", "high"], def: "high", maxOut: 65_536 },
  "gemini-2.5-pro": { levels: LMH, def: "medium", maxOut: 65_536 },
  "gemini-2.5-flash": { levels: LMH, def: "medium", maxOut: 65_536 },
  "gemini-2.5-flash-lite": { levels: LMH, def: "low", maxOut: 65_536 },
};

/**
 * Safe defaults for an id we have never seen (e.g. "gemini-3.9-flash" next
 * month): low/medium/high is the set EVERY current Gemini 3+ text model
 * accepts except 3-pro-preview, and 65,536 is the documented sync cap.
 */
export const UNKNOWN_MODEL_DEFAULTS: Row = { levels: LMH, def: "medium", maxOut: 65_536 };

/** Lower-case, trim, drop a "models/" prefix. */
export function normalizeModelId(raw: unknown): string {
  return (typeof raw === "string" ? raw : "").trim().toLowerCase().replace(/^models\//, "");
}

export function isGeminiModelId(raw: unknown): boolean {
  return /^gemini/.test(normalizeModelId(raw));
}

/**
 * Resolve a configured model id to its capability profile. Exact match first,
 * then the longest table key the id starts with followed by "-" (a dated or
 * numbered variant such as "gemini-3.8-flash-001"), else safe defaults.
 */
export function resolveGeminiModel(raw: unknown): GeminiModelProfile {
  const id = normalizeModelId(raw);
  let key: string | null = GEMINI_MODEL_TABLE[id] ? id : null;
  if (!key) {
    for (const k of Object.keys(GEMINI_MODEL_TABLE)) {
      if (id.startsWith(`${k}-`) && (!key || k.length > key.length)) key = k;
    }
  }
  const row = key ? GEMINI_MODEL_TABLE[key] : UNKNOWN_MODEL_DEFAULTS;
  // A deprecated base id is replaced by its successor; a pinned variant of a
  // deprecated id is replaced too (Google routes the family).
  if (key && row.routedTo) {
    const next = GEMINI_MODEL_TABLE[row.routedTo] ?? UNKNOWN_MODEL_DEFAULTS;
    return { id: row.routedTo, known: true, routedFrom: id, thinkingLevels: next.levels, defaultThinking: next.def, maxOutputTokens: next.maxOut };
  }
  return { id: id || "gemini", known: key !== null, routedFrom: null, thinkingLevels: row.levels, defaultThinking: row.def, maxOutputTokens: row.maxOut };
}

export function parseThinkingWanted(raw: unknown): ThinkingLevel | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (THINKING_ORDER as readonly string[]).includes(v) ? (v as ThinkingLevel) : null;
}

/**
 * The level a model will accept that is closest to the one wanted. A tie
 * goes UP (more thinking: the owner's rule is "data is gold"). Never returns
 * a level the model does not list.
 */
export function clampThinkingLevel(profile: Pick<GeminiModelProfile, "thinkingLevels" | "defaultThinking">, wanted: ThinkingLevel): ThinkingLevel {
  const levels = profile.thinkingLevels.length ? profile.thinkingLevels : [profile.defaultThinking];
  if (levels.includes(wanted)) return wanted;
  const w = THINKING_ORDER.indexOf(wanted);
  let best = levels[0];
  let bestD = Infinity;
  for (const l of levels) {
    const i = THINKING_ORDER.indexOf(l);
    const d = Math.abs(i - w);
    if (d < bestD || (d === bestD && i > THINKING_ORDER.indexOf(best))) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

/**
 * Which thinking level to send. First valid wins: the caller's explicit level
 * (e.g. the background batch), the global AI_THINKING_LEVEL, then the model's
 * own default. Always clamped to what the model accepts.
 */
export function chooseThinkingLevel(
  profile: Pick<GeminiModelProfile, "thinkingLevels" | "defaultThinking">,
  explicit: unknown,
  globalEnv: unknown,
): { level: ThinkingLevel; source: "explicit" | "env" | "model_default"; clamped: boolean } {
  const e = parseThinkingWanted(explicit);
  const g = parseThinkingWanted(globalEnv);
  const wanted = e ?? g ?? profile.defaultThinking;
  const level = clampThinkingLevel(profile, wanted);
  return { level, source: e ? "explicit" : g ? "env" : "model_default", clamped: level !== wanted };
}

/** Google: raise anything below 32K to at least 32,768 on thinking models. */
export const MIN_THINKING_OUTPUT_TOKENS = 32_768;

/**
 * max_output_tokens to send. The caller's number is the size of the ANSWER it
 * needs; thinking is billed per token actually produced, so a high ceiling
 * costs nothing unless used, while a low one silently truncates the reply
 * ("incomplete" -> empty text -> looked like a miss). An explicit env
 * override (AI_GEMINI_MAX_OUTPUT_TOKENS) wins, still capped at the model max.
 */
export function effectiveMaxOutputTokens(profile: Pick<GeminiModelProfile, "maxOutputTokens">, answerTokens: unknown, envOverride?: unknown): number {
  const cap = profile.maxOutputTokens > 0 ? profile.maxOutputTokens : 65_536;
  const o = typeof envOverride === "string" && /^\d{3,6}$/.test(envOverride.trim()) ? Number(envOverride.trim()) : null;
  if (o !== null && o >= 1024) return Math.min(o, cap);
  const a = typeof answerTokens === "number" && Number.isFinite(answerTokens) && answerTokens > 0 ? Math.floor(answerTokens) : 900;
  return Math.min(cap, Math.max(MIN_THINKING_OUTPUT_TOKENS, a + 16_384));
}

/** What an Interactions reply's status means for us. */
export function interactionStatus(payload: unknown): "completed" | "incomplete" | "failed" | "unknown" {
  if (!payload || typeof payload !== "object") return "unknown";
  const s = (payload as Record<string, unknown>).status;
  if (typeof s !== "string" || !s.trim()) return "completed"; // older replies carry no status
  const v = s.trim().toLowerCase();
  if (v === "completed" || v === "complete" || v === "succeeded") return "completed";
  if (v === "incomplete") return "incomplete";
  if (v === "failed" || v === "cancelled" || v === "canceled" || v === "error") return "failed";
  return "unknown";
}

/**
 * The retry after an "incomplete" reply: first lift the ceiling to the model
 * max; if it was already there, think one level less (Google's own advice:
 * "lower thinking_level rather than cap tokens"). null = nothing left to try.
 */
export function incompleteRetry(
  profile: Pick<GeminiModelProfile, "thinkingLevels" | "maxOutputTokens">,
  sent: { maxOutputTokens: number; thinking: ThinkingLevel },
): { maxOutputTokens: number; thinking: ThinkingLevel } | null {
  if (sent.maxOutputTokens < profile.maxOutputTokens) return { maxOutputTokens: profile.maxOutputTokens, thinking: sent.thinking };
  const lower = profile.thinkingLevels.filter((l) => THINKING_ORDER.indexOf(l) < THINKING_ORDER.indexOf(sent.thinking));
  if (lower.length === 0) return null;
  return { maxOutputTokens: sent.maxOutputTokens, thinking: lower[lower.length - 1] };
}

/** Transient provider statuses worth another try (community: 503 UNAVAILABLE bursts). */
export function isTransientStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Wait before retry number `attempt` (1-based) of a transient failure, or null
 * when we should stop: at most 2 retries, and only when enough of the
 * deadline is left for a real answer (a retry that cannot finish just burns
 * the time the caller needs to report the failure cleanly).
 */
export function transientRetryDelayMs(attempt: number, remainingMs: number, minUsefulMs = 45_000): number | null {
  if (!Number.isFinite(attempt) || attempt < 1 || attempt > 2) return null;
  const wait = attempt === 1 ? 2_000 : 6_000;
  return remainingMs - wait >= minUsefulMs ? wait : null;
}

export type InteractionUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; thought_tokens?: number };

/**
 * Read token usage from any shape Google has used: the Interactions names
 * (total_input_tokens / total_output_tokens / total_thought_tokens /
 * total_tokens), the older generateContent names, and the plain ones.
 * completion = output + thought (that is what is billed).
 */
export function readInteractionUsage(usage: unknown): InteractionUsage {
  if (!usage || typeof usage !== "object") return {};
  const u = usage as Record<string, unknown>;
  const n = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = u[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
    }
    return undefined;
  };
  const prompt = n("total_input_tokens", "prompt_token_count", "input_tokens");
  const output = n("total_output_tokens", "candidates_token_count", "output_tokens");
  const thought = n("total_thought_tokens", "thoughts_token_count", "thought_tokens");
  const total = n("total_tokens", "total_token_count");
  const completion = output === undefined && thought === undefined ? undefined : (output ?? 0) + (thought ?? 0);
  const out: InteractionUsage = {};
  if (prompt !== undefined) out.prompt_tokens = prompt;
  if (completion !== undefined) out.completion_tokens = completion;
  if (thought !== undefined) out.thought_tokens = thought;
  const t = total ?? (prompt !== undefined || completion !== undefined ? (prompt ?? 0) + (completion ?? 0) : undefined);
  if (t !== undefined) out.total_tokens = t;
  return out;
}

/** One plain line for the batch panel / settings: what model and thinking ran. */
export function modelNotice(profile: GeminiModelProfile): string | null {
  if (profile.routedFrom) {
    return `${profile.routedFrom} is retired by Google and every request is sent to ${profile.id}. Set AI_MODEL_HEAVY=${profile.id} in Vercel to make that explicit.`;
  }
  if (!profile.known) return `${profile.id} is newer than this app's model table, so safe settings are used (thinking low/medium/high, 65,536 output tokens).`;
  return null;
}

export function __runGeminiModelsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error("FAIL gemini-models-core:", m);
    }
  };
  // table / resolve
  const f38 = resolveGeminiModel("gemini-3.8-flash");
  ok(f38.known && f38.id === "gemini-3.8-flash" && f38.defaultThinking === "medium" && f38.maxOutputTokens === 65_536, "3.8 flash profile");
  ok(!f38.thinkingLevels.includes("minimal"), "3.8 flash has no minimal");
  const f37 = resolveGeminiModel("  Models/Gemini-3.7-Flash ");
  ok(f37.id === "gemini-3.8-flash" && f37.routedFrom === "gemini-3.7-flash", "3.7 flash routed to 3.8");
  ok(resolveGeminiModel("gemini-3.7-flash-002").id === "gemini-3.8-flash", "pinned deprecated variant routed too");
  ok(resolveGeminiModel("gemini-3.8-flash-001").id === "gemini-3.8-flash-001" && resolveGeminiModel("gemini-3.8-flash-001").known, "dated variant keeps its id, known caps");
  ok(resolveGeminiModel("gemini-3-flash-preview").thinkingLevels.includes("minimal"), "longest-prefix: 3-flash-preview not 3-pro");
  const fut = resolveGeminiModel("gemini-3.9-flash");
  ok(!fut.known && fut.id === "gemini-3.9-flash" && fut.thinkingLevels.join() === "low,medium,high" && fut.defaultThinking === "medium", "unknown future id = safe defaults");
  ok(resolveGeminiModel("gemini-4-argon").defaultThinking === "medium", "argon default medium");
  ok(resolveGeminiModel("").id === "gemini" && !resolveGeminiModel(null).known, "blank id safe");
  ok(isGeminiModelId("Gemini-3.8-flash") && !isGeminiModelId("gpt-4o"), "gemini detection");
  // clamp
  ok(clampThinkingLevel(f38, "minimal") === "low", "minimal never sent to 3.8 flash");
  ok(clampThinkingLevel(f38, "high") === "high", "supported kept");
  const p3 = resolveGeminiModel("gemini-3-pro-preview");
  ok(clampThinkingLevel(p3, "medium") === "high", "tie goes up");
  ok(clampThinkingLevel(p3, "minimal") === "low", "nearest");
  ok(clampThinkingLevel({ thinkingLevels: [], defaultThinking: "low" }, "high") === "low", "empty levels -> default");
  // choose
  const c1 = chooseThinkingLevel(f38, undefined, undefined);
  ok(c1.level === "medium" && c1.source === "model_default" && !c1.clamped, "model default");
  const c2 = chooseThinkingLevel(f38, "high", "low");
  ok(c2.level === "high" && c2.source === "explicit", "explicit beats env");
  const c3 = chooseThinkingLevel(f38, "junk", "minimal");
  ok(c3.level === "low" && c3.source === "env" && c3.clamped, "env minimal clamped to low");
  ok(chooseThinkingLevel(resolveGeminiModel("gemini-3.6-flash"), undefined, "minimal").level === "minimal", "minimal kept where supported");
  // tokens
  ok(effectiveMaxOutputTokens(f38, 4000) === 32_768, "4000 answer -> 32K floor");
  ok(effectiveMaxOutputTokens(f38, 900) === 32_768, "900 default -> 32K");
  ok(effectiveMaxOutputTokens(f38, 60_000) === 65_536, "capped at model max");
  ok(effectiveMaxOutputTokens(f38, 20_000) === 36_384, "answer + headroom");
  ok(effectiveMaxOutputTokens(f38, -5) === 32_768 && effectiveMaxOutputTokens(f38, "x") === 32_768, "junk answer size");
  ok(effectiveMaxOutputTokens(f38, 4000, "8192") === 8192 && effectiveMaxOutputTokens(f38, 4000, "999999") === 65_536, "env override, capped");
  ok(effectiveMaxOutputTokens(f38, 4000, "12") === 32_768 && effectiveMaxOutputTokens(f38, 4000, "abc") === 32_768, "bad override ignored");
  // status
  ok(interactionStatus({ status: "completed" }) === "completed" && interactionStatus({}) === "completed", "completed / absent");
  ok(interactionStatus({ status: "INCOMPLETE" }) === "incomplete", "incomplete");
  ok(interactionStatus({ status: "failed" }) === "failed" && interactionStatus({ status: "cancelled" }) === "failed", "failed");
  ok(interactionStatus({ status: "in_progress" }) === "unknown" && interactionStatus(null) === "unknown", "unknown");
  // incomplete retry
  const r1 = incompleteRetry(f38, { maxOutputTokens: 32_768, thinking: "high" });
  ok(r1 !== null && r1.maxOutputTokens === 65_536 && r1.thinking === "high", "first lift the ceiling");
  const r2 = incompleteRetry(f38, { maxOutputTokens: 65_536, thinking: "high" });
  ok(r2 !== null && r2.thinking === "medium", "then think less");
  ok(incompleteRetry(f38, { maxOutputTokens: 65_536, thinking: "low" }) === null, "nothing left");
  ok(incompleteRetry(p3, { maxOutputTokens: 65_536, thinking: "high" })?.thinking === "low", "skips unsupported level");
  // transient
  ok([500, 502, 503, 504].every(isTransientStatus) && ![400, 401, 403, 404, 429].some(isTransientStatus), "transient statuses (429 = credits, not retried)");
  ok(transientRetryDelayMs(1, 200_000) === 2_000 && transientRetryDelayMs(2, 200_000) === 6_000, "backoff");
  ok(transientRetryDelayMs(3, 200_000) === null && transientRetryDelayMs(0, 200_000) === null, "max 2 retries");
  ok(transientRetryDelayMs(1, 46_000) === null && transientRetryDelayMs(1, 47_000) === 2_000, "needs useful time left");
  // usage
  const u = readInteractionUsage({ total_input_tokens: 100, total_output_tokens: 50, total_thought_tokens: 300, total_tokens: 450 });
  ok(u.prompt_tokens === 100 && u.completion_tokens === 350 && u.thought_tokens === 300 && u.total_tokens === 450, "interactions usage names");
  const u2 = readInteractionUsage({ prompt_token_count: 10, candidates_token_count: 5, total_token_count: 15 });
  ok(u2.prompt_tokens === 10 && u2.completion_tokens === 5 && u2.total_tokens === 15, "legacy names");
  const u3 = readInteractionUsage({ input_tokens: 7, output_tokens: 3 });
  ok(u3.total_tokens === 10, "derived total");
  ok(Object.keys(readInteractionUsage(null)).length === 0 && Object.keys(readInteractionUsage({ x: 1 })).length === 0, "empty usage");
  ok(readInteractionUsage({ total_output_tokens: -1, output_tokens: 4 }).completion_tokens === 4, "negative ignored");
  // notice
  ok((modelNotice(f37) ?? "").includes("AI_MODEL_HEAVY=gemini-3.8-flash"), "routed notice");
  ok(modelNotice(f38) === null && (modelNotice(fut) ?? "").includes("newer"), "notices");
  return { passed, failed };
}
