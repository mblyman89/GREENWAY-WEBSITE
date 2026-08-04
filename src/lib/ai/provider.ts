/**
 * src/lib/ai/provider.ts
 *
 * Provider-agnostic AI text generation. Swappable model/provider behind a small
 * set of calls. Uses an OpenAI-compatible Chat Completions endpoint via fetch
 * (works with OpenAI, OpenRouter, Together, local gateways, etc.).
 *
 * Capabilities:
 *  - generate()       → plain text completion
 *  - generateJSON<T>()→ structured JSON output (response_format json_object),
 *                       with a tolerant fenced/loose JSON parser fallback
 *  - generateStream() → async iterator of text chunks (SSE), for live typing
 *  - generateVision() → image-aware completion (data URL or remote image URL)
 *
 * Every call logs one best-effort row to the AI usage ledger (ai_usage) for
 * cost visibility. Logging never throws.
 *
 * Gracefully NO-OPS when AI_API_KEY is unset: `isAiConfigured` is false and the
 * calls throw a clear, catchable error so callers can disable the UI.
 *
 * Server-only. Never import into client components.
 */
import "server-only";
import { logAiUsage, estimateTokens } from "./usage";
import {
  modelForTask,
  getBudgetStatus,
  AiBudgetExceededError,
  type TaskTier,
} from "./router";
import {
  toResponseFormat,
  validate,
  formatErrors,
  describeShape,
  type AiSchema,
} from "./schema";

// Accept BOTH our generic names and the standard OpenAI names so a plain
// `OPENAI_API_KEY` (the most common thing an owner already has) just works.
// AI_* wins if both are set; otherwise we fall back to OPENAI_*.
const AI_API_KEY = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
const AI_BASE_URL =
  process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const AI_MODEL = process.env.AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini";
// A model capable of vision; defaults to the same family. Override if needed.
const AI_VISION_MODEL =
  process.env.AI_VISION_MODEL ?? process.env.OPENAI_VISION_MODEL ?? AI_MODEL;

/** True when an AI key is configured. UI should soft-disable AI when false. */
export const isAiConfigured = Boolean(AI_API_KEY);

/** The model id in use (for provenance/audit). */
export const aiModelId = AI_MODEL;
export const aiVisionModelId = AI_VISION_MODEL;

/** Optional provenance/telemetry passed through to the usage ledger. */
export type AiContext = {
  feature?: string;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
};

export type GenerateOptions = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Provenance for the usage ledger. */
  context?: AiContext;
};

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured. Set OPENAI_API_KEY (or AI_API_KEY), and optionally AI_MODEL / AI_BASE_URL.");
    this.name = "AiNotConfiguredError";
  }
}

/**
 * A single, catchable error the web-search lookup throws when it cannot finish
 * for a reason the OPERATOR can act on (took too long, out of AI credits, key
 * rejected). Carries a short, plain-English `friendly` message the UI can show
 * verbatim — no stack traces, no HTTP jargon. This lets the server action
 * surface a helpful in-panel note INSTEAD of the raw browser "unexpected
 * response from server" page you get when a function is silently killed.
 */
export class AiLookupError extends Error {
  readonly friendly: string;
  constructor(friendly: string, technical?: string) {
    super(technical ?? friendly);
    this.name = "AiLookupError";
    this.friendly = friendly;
  }
}

/**
 * How long (ms) a single AI web-search HTTP call may run before we abort it.
 * This MUST fail well inside Vercel's function ceiling (Hobby = 300s hard kill)
 * so the lookup returns a clean, friendly message instead of the browser's
 * "unexpected response from server" page you get when the function is killed
 * mid-flight. ~55s leaves plenty of margin. Override via AI_WEBSEARCH_TIMEOUT_MS.
 */
const AI_WEBSEARCH_TIMEOUT_MS = (() => {
  const raw = Number(process.env.AI_WEBSEARCH_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 55_000;
})();

/**
 * fetch() with a hard timeout via AbortController. On timeout it throws an
 * Error whose name is "AbortError" (matching the platform), which callers
 * detect to raise a friendly "took too long" message. Any caller-supplied
 * `signal` is respected too. The timer is always cleared.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** True when an error is an AbortController timeout (from fetchWithTimeout). */
function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /aborted|abort(ed)?\b/i.test(err.message))
  );
}

/**
 * Map an HTTP status from an AI provider to a short, plain-English message the
 * operator can act on. Returns undefined for statuses we don't have friendly
 * copy for (caller then falls back to built-in knowledge as before).
 */
function friendlyStatusMessage(status: number): string | undefined {
  if (status === 401 || status === 403) {
    return "The AI key was rejected. Double-check the Gemini API key in your Vercel settings, then try again.";
  }
  if (status === 429) {
    return "You're out of AI Studio prepay credits (or hit a rate limit). Add credits at aistudio.google.com \u2192 Billing, then try again.";
  }
  if (status >= 500) {
    return "The AI service had a temporary problem on its end. Wait a moment and try the lookup again.";
  }
  return undefined;
}

type ChatUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };

/** Common helper: record a usage row from provider usage or a heuristic. */
async function record(
  ctx: AiContext | undefined,
  model: string,
  promptText: string,
  completionText: string,
  usage: ChatUsage | undefined,
  ok: boolean,
  errorNote?: string,
) {
  const hasReal = Boolean(usage && (usage.total_tokens || usage.prompt_tokens || usage.completion_tokens));
  await logAiUsage({
    feature: ctx?.feature ?? "ai.generate",
    entityType: ctx?.entityType ?? null,
    entityId: ctx?.entityId ?? null,
    model,
    promptTokens: usage?.prompt_tokens ?? estimateTokens(promptText),
    completionTokens: usage?.completion_tokens ?? estimateTokens(completionText),
    totalTokens:
      usage?.total_tokens ??
      (usage?.prompt_tokens ?? estimateTokens(promptText)) +
        (usage?.completion_tokens ?? estimateTokens(completionText)),
    estimated: !hasReal,
    ok,
    errorNote: errorNote ?? null,
    actorId: ctx?.actorId ?? null,
    actorEmail: ctx?.actorEmail ?? null,
  });
}

/**
 * Generate text from the configured model. Returns the trimmed completion.
 * Throws AiNotConfiguredError when no key is set.
 */
export async function generate(opts: GenerateOptions): Promise<string> {
  if (!isAiConfigured) throw new AiNotConfiguredError();
  const promptText = `${opts.system}\n${opts.user}`;

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 400,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await record(opts.context, AI_MODEL, promptText, "", undefined, false, `HTTP ${res.status}`);
      throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: ChatUsage;
    };
    const content = (json.choices?.[0]?.message?.content ?? "").trim();
    await record(opts.context, AI_MODEL, promptText, content, json.usage, true);
    return content;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) throw err;
    // already-logged HTTP errors re-throw; log unexpected ones here.
    if (!(err instanceof Error && err.message.startsWith("AI request failed"))) {
      await record(opts.context, AI_MODEL, promptText, "", undefined, false, String(err).slice(0, 200));
    }
    throw err;
  }
}

/** Pull the first balanced JSON object/array out of a possibly-fenced string. */
export function looseJsonParse<T>(raw: string): T {
  let text = raw.trim();
  // Strip ```json ... ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // Try direct parse first.
  try {
    return JSON.parse(text) as T;
  } catch {
    /* fall through to bracket extraction */
  }
  // Find the first {...} or [...] block.
  const start = text.search(/[[{]/);
  if (start >= 0) {
    const open = text[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        depth--;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          return JSON.parse(slice) as T;
        }
      }
    }
  }
  throw new Error("Could not parse JSON from AI output.");
}

/**
 * Generate a STRUCTURED JSON result. Asks the model for a JSON object via
 * response_format, then tolerantly parses it. Throws if parsing fails so the
 * caller can fall back gracefully.
 */
export async function generateJSON<T>(opts: GenerateOptions): Promise<T> {
  if (!isAiConfigured) throw new AiNotConfiguredError();
  const promptText = `${opts.system}\n${opts.user}`;

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${opts.system}\n\nRespond ONLY with valid JSON. No prose, no code fences.` },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await record(opts.context, AI_MODEL, promptText, "", undefined, false, `HTTP ${res.status}`);
    throw new Error(`AI JSON request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: ChatUsage;
  };
  const content = (json.choices?.[0]?.message?.content ?? "").trim();
  await record(opts.context, AI_MODEL, promptText, content, json.usage, true);
  return looseJsonParse<T>(content);
}

// ---------------------------------------------------------------------------
// STRUCTURED OUTPUTS — the reliable path for enrichment.
//
// Sends a strict JSON Schema via response_format so the provider CONSTRAINS the
// output to our shape (best-practice: constrained decoding ≈ 100% schema
// adherence). Parses, then VALIDATES with our own schema validator. On a
// validation/parse failure it RETRIES ONCE with the errors appended, then falls
// back to looseJsonParse. Picks the model tier (light/heavy) via the router and
// refuses to spend when a hard budget cap is exceeded.
// ---------------------------------------------------------------------------

export type StructuredOptions<T> = {
  system: string;
  user: string;
  schema: AiSchema<T>;
  /** Task weight → model tier. "heavy" uses the strong model in sprint mode. */
  tier?: TaskTier;
  temperature?: number;
  maxTokens?: number;
  context?: AiContext;
};

async function chatRaw(
  model: string,
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number; responseFormat?: unknown },
): Promise<{ content: string; usage?: ChatUsage }> {
  const body: Record<string, unknown> = {
    model,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 600,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  if (opts.responseFormat) body.response_format = opts.responseFormat;

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: ChatUsage;
  };
  return { content: (json.choices?.[0]?.message?.content ?? "").trim(), usage: json.usage };
}

/**
 * Generate a VALIDATED, typed result against a schema. Throws
 * AiNotConfiguredError when no key is set, and AiBudgetExceededError when a
 * monthly cap is already reached.
 */
export async function generateStructured<T>(opts: StructuredOptions<T>): Promise<T> {
  if (!isAiConfigured) throw new AiNotConfiguredError();

  // Hard budget guard — never spend past the owner's cap.
  const budget = await getBudgetStatus();
  if (budget.blocked) throw new AiBudgetExceededError(budget.reason ?? "AI budget exceeded.");

  const tier: TaskTier = opts.tier ?? "light";
  const model = modelForTask(tier);
  const responseFormat = toResponseFormat(opts.schema);

  // Strengthen the user message with an explicit shape description as a belt-and-
  // suspenders fallback for providers that ignore strict json_schema.
  const shapeHint = `\n\nReturn ONLY a JSON object with this exact shape (no prose, no code fences):\n${describeShape(opts.schema)}`;
  let userMsg = `${opts.user}${shapeHint}`;
  const promptText = `${opts.system}\n${userMsg}`;

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { content, usage } = await chatRaw(model, opts.system, userMsg, {
        temperature: opts.temperature ?? (tier === "heavy" ? 0.4 : 0.2),
        maxTokens: opts.maxTokens ?? 700,
        responseFormat,
      });

      let parsed: unknown;
      try {
        parsed = looseJsonParse<unknown>(content);
      } catch {
        lastErr = "Output was not valid JSON.";
        await record(opts.context, model, promptText, content, usage, false, lastErr);
        userMsg = `${opts.user}${shapeHint}\n\nYour previous answer was not valid JSON. Return ONLY the JSON object.`;
        continue;
      }

      const result = validate(opts.schema, parsed);
      if (result.ok) {
        await record(opts.context, model, promptText, content, usage, true);
        return result.value;
      }

      lastErr = formatErrors(result.errors);
      await record(opts.context, model, promptText, content, usage, false, `validation: ${lastErr.slice(0, 200)}`);
      userMsg = `${opts.user}${shapeHint}\n\nYour previous answer had these problems:\n${lastErr}\nFix them and return ONLY the corrected JSON object.`;
    } catch (err) {
      if (err instanceof AiNotConfiguredError || err instanceof AiBudgetExceededError) throw err;
      lastErr = String(err).slice(0, 200);
      await record(opts.context, model, promptText, "", undefined, false, lastErr);
      // network/HTTP error — retry once
    }
  }

  throw new Error(`AI structured generation failed after retry: ${lastErr}`);
}

export type VisionOptions = {
  system: string;
  user: string;
  /** A data: URL or a publicly reachable https image URL. */
  imageUrl: string;
  temperature?: number;
  maxTokens?: number;
  context?: AiContext;
};

/**
 * Image-aware completion. Sends the image alongside the prompt to a
 * vision-capable model. Returns trimmed text. Used for true image-aware
 * alt-text and product-photo analysis.
 */
export async function generateVision(opts: VisionOptions): Promise<string> {
  if (!isAiConfigured) throw new AiNotConfiguredError();
  const promptText = `${opts.system}\n${opts.user}`;

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_VISION_MODEL,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 200,
      messages: [
        { role: "system", content: opts.system },
        {
          role: "user",
          content: [
            { type: "text", text: opts.user },
            { type: "image_url", image_url: { url: opts.imageUrl } },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await record({ ...opts.context, feature: opts.context?.feature ?? "ai.vision" }, AI_VISION_MODEL, promptText, "", undefined, false, `HTTP ${res.status}`);
    throw new Error(`AI vision request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: ChatUsage;
  };
  const content = (json.choices?.[0]?.message?.content ?? "").trim();
  await record({ ...opts.context, feature: opts.context?.feature ?? "ai.vision" }, AI_VISION_MODEL, promptText, content, json.usage, true);
  return content;
}

/**
 * STREAMING generation. Yields text chunks as they arrive (SSE). The usage
 * ledger is recorded once at the end with an estimated token count (streaming
 * responses don't always include a usage block).
 */
export async function* generateStream(opts: GenerateOptions): AsyncGenerator<string, void, unknown> {
  if (!isAiConfigured) throw new AiNotConfiguredError();
  const promptText = `${opts.system}\n${opts.user}`;

  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 600,
      stream: true,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const text = res.ok ? "" : await res.text().catch(() => "");
    await record(opts.context, AI_MODEL, promptText, "", undefined, false, `HTTP ${res.status}`);
    throw new Error(`AI stream request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            yield delta;
          }
        } catch {
          /* ignore malformed SSE keepalive lines */
        }
      }
    }
  } finally {
    await record(opts.context, AI_MODEL, promptText, full, undefined, true);
  }
}

// ---------------------------------------------------------------------------
// LIVE WEB SEARCH — GPT-4o with the OpenAI Responses API `web_search` tool.
//
// T-314 (AI product/strain lookup). This is the ONE place in the provider that
// can reach the live internet: it uses OpenAI's hosted `web_search` tool via the
// Responses API (`/responses`), NOT chat/completions. The model plans a search,
// reads real pages, and returns an answer PLUS the source URLs it consulted.
//
// Design rules (standing rules honored):
//  - ADDITIVE ONLY: does not touch the 5 chat/completions call sites above.
//  - Pins a strong model explicitly (default gpt-4o) so the caller always gets
//    "max, not lite" regardless of AI_MODE (the router would downshift heavy to
//    the light model outside sprint mode; this feature must not be downshifted).
//  - GRACEFUL FALLBACK: if the Responses API / web_search tool is unavailable
//    (older key, proxy gateway, non-OpenAI base URL, HTTP error), we fall back
//    to a plain gpt-4o chat completion using the model's built-in knowledge and
//    return `usedWebSearch: false` + empty sources. The feature NEVER dies.
//  - Budget-guarded + usage-logged like every other spend path.
//
// Server-only.
// ---------------------------------------------------------------------------

/** The strong model this feature pins (independent of the router's tier). */
const AI_WEBSEARCH_MODEL =
  process.env.AI_MODEL_HEAVY ?? process.env.OPENAI_MODEL_HEAVY ?? "gpt-4o";

/** The model id the web-search lookup will use (for provenance in the UI). */
export const aiWebSearchModelId = AI_WEBSEARCH_MODEL;

// ---------------------------------------------------------------------------
// Gemini (Google) grounding path for the web-search lookup.
//
// Google's powerful live web search is the `google_search` grounding tool,
// which lives behind the native Interactions API (NOT the OpenAI-compat
// `/chat/completions` layer, which does not expose it for chat). It uses a
// different endpoint, a different tool name, a DIFFERENT auth header
// (`x-goog-api-key`), and returns a DIFFERENT response shape (`steps[]` with
// `model_output` content blocks carrying `url_citation` annotations).
//
// We detect Gemini purely from the heavy model id (anything starting with
// "gemini"). The Gemini key falls back to AI_API_KEY so a single key set as
// AI_API_KEY works out of the box. Everything OpenAI stays byte-for-byte
// intact below; the Gemini branch is fully additive.
// ---------------------------------------------------------------------------

/** Google's native Interactions API endpoint (where `google_search` lives). */
const GEMINI_INTERACTIONS_URL =
  process.env.AI_GEMINI_BASE_URL ??
  "https://generativelanguage.googleapis.com/v1beta/interactions";

/** The Gemini API key. Falls back to the shared AI_API_KEY. */
const GEMINI_API_KEY = process.env.AI_GEMINI_API_KEY ?? AI_API_KEY;

/** True when the heavy (web-search) model is a Gemini model. */
const IS_GEMINI_WEBSEARCH = /^gemini/i.test(AI_WEBSEARCH_MODEL);

export type WebSearchOptions = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  context?: AiContext;
};

export type WebSearchResult = {
  /** The model's answer text (trimmed). */
  text: string;
  /** Real source URLs the model consulted (deduped, order preserved). May be []. */
  sources: string[];
  /** The model id that produced this. */
  model: string;
  /** True when the live web_search tool actually ran; false on fallback. */
  usedWebSearch: boolean;
};

/**
 * Extract source URLs from a Responses API payload. Sources appear as URL
 * citation annotations on output_text content parts. We read them defensively
 * (the exact nesting varies) and de-dupe while preserving first-seen order.
 */
function extractResponsesSources(payload: unknown): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (u: unknown) => {
    const url = typeof u === "string" ? u.trim() : "";
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    // URL citation annotation shape: { type: "url_citation", url: "..." }
    if ((obj.type === "url_citation" || obj.type === "url") && typeof obj.url === "string") {
      push(obj.url);
    } else if (typeof obj.url === "string") {
      push(obj.url);
    }
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === "object") walk(v);
    }
  };
  walk(payload);
  return urls;
}

/**
 * Concatenate the assistant's output_text from a Responses API payload. Prefers
 * the convenience `output_text` field when present, else walks output parts.
 */
function extractResponsesText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  if (typeof obj.output_text === "string" && obj.output_text.trim()) {
    return obj.output_text.trim();
  }
  const parts: string[] = [];
  const output = obj.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (part && typeof part === "object") {
          const p = part as Record<string, unknown>;
          if (typeof p.text === "string") parts.push(p.text);
        }
      }
    }
  }
  return parts.join("").trim();
}

/**
 * Concatenate the assistant's answer text from a Gemini Interactions payload.
 *
 * Gemini returns an ordered `steps[]` array. The user-facing answer lives in
 * `model_output` steps, whose `content[]` carries `{ type: "text", text }`
 * blocks. A convenience `output_text` field may also be present; we prefer it
 * when non-empty, else we stitch the text blocks from the model_output steps.
 */
function extractInteractionsText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const obj = payload as Record<string, unknown>;
  if (typeof obj.output_text === "string" && obj.output_text.trim()) {
    return obj.output_text.trim();
  }
  const parts: string[] = [];
  const steps = obj.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (!step || typeof step !== "object") continue;
      const s = step as Record<string, unknown>;
      if (s.type !== "model_output") continue;
      const content = s.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
        }
      }
    }
  }
  return parts.join("").trim();
}

/**
 * Extract source URLs from a Gemini Interactions payload. Sources appear as
 * `url_citation` annotations on the `model_output` text blocks, and are also
 * echoed in `google_search_result` steps. We walk the whole payload
 * defensively for any `url_citation` (or plain `url`) and de-dupe while
 * preserving first-seen order. This reuses the exact same tolerant strategy as
 * the OpenAI parser so both providers behave identically for the UI.
 */
function extractInteractionsSources(payload: unknown): string[] {
  // The url_citation / url shapes are identical to the OpenAI Responses
  // annotations, so the same defensive walker handles both providers.
  return extractResponsesSources(payload);
}

/**
 * Gemini built-in-knowledge fallback via Google's OpenAI-compatibility layer
 * (`/chat/completions`). Self-contained: it does NOT read AI_BASE_URL, so the
 * Gemini path works even when AI_BASE_URL still points at OpenAI. Used only
 * when live `google_search` grounding fails, so the lookup never dies.
 */
async function geminiChatFallback(
  model: string,
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number },
): Promise<{ content: string; usage?: ChatUsage }> {
  // The OpenAI-compat chat endpoint lives at ".../v1beta/openai/chat/completions".
  const base =
    process.env.AI_GEMINI_OPENAI_BASE_URL ??
    "https://generativelanguage.googleapis.com/v1beta/openai";
  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 600,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
  // Only set temperature when explicitly requested (Gemini 3 prefers default).
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;

  const res = await fetchWithTimeout(
    `${base}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GEMINI_API_KEY}`,
      },
      body: JSON.stringify(body),
    },
    AI_WEBSEARCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const friendly = friendlyStatusMessage(res.status);
    if (friendly) throw new AiLookupError(friendly, `gemini fallback (${res.status}): ${text.slice(0, 200)}`);
    throw new Error(`gemini fallback failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: ChatUsage;
  };
  return { content: (json.choices?.[0]?.message?.content ?? "").trim(), usage: json.usage };
}

/**
 * Live internet lookup via a strong model + a hosted web-search tool.
 *
 * Two providers are supported, selected purely by the heavy model id:
 *   - Gemini (model id starts with "gemini"): Google's `google_search`
 *     grounding via the native Interactions API. This is the stronger tool for
 *     community/retail lookups.
 *   - OpenAI (default): GPT-4o + the OpenAI `web_search` tool via the
 *     Responses API.
 *
 * Either way it returns the answer text, the real source URLs, the model id,
 * and whether the live tool actually ran. On any failure it falls back to a
 * plain built-in-knowledge completion so the feature never dies.
 *
 * Throws AiNotConfiguredError when no key is set and AiBudgetExceededError when
 * the owner's monthly cap is already reached (spend is refused, never silent).
 */
export async function generateWebSearch(opts: WebSearchOptions): Promise<WebSearchResult> {
  if (!isAiConfigured) throw new AiNotConfiguredError();

  // Hard budget guard — never spend past the owner's cap.
  const budget = await getBudgetStatus();
  if (budget.blocked) throw new AiBudgetExceededError(budget.reason ?? "AI budget exceeded.");

  const model = AI_WEBSEARCH_MODEL;
  const promptText = `${opts.system}\n${opts.user}`;

  // --- Gemini path: Google `google_search` grounding via Interactions API. --
  // Selected when the heavy model is a Gemini model. Uses the absolute Google
  // endpoint + x-goog-api-key header (NOT AI_BASE_URL / Bearer). Google warns
  // against low temperature on Gemini 3 (looping), so we honor an explicit
  // opts.temperature but otherwise leave it at Gemini's default of 1.0.
  if (IS_GEMINI_WEBSEARCH) {
    try {
      const body: Record<string, unknown> = {
        model,
        // Combine the system framing and the user ask into one input string;
        // Gemini 3 responds best to a single, direct instruction block.
        input: `${opts.system}\n\n${opts.user}`,
        tools: [{ type: "google_search" }],
        generation_config: {
          max_output_tokens: opts.maxTokens ?? 900,
          // Gemini 3 defaults to thinking_level "high" (its SLOWEST setting):
          // combined with live google_search grounding that regularly ran past
          // Vercel Hobby's 300s function ceiling and got the whole function
          // killed (the browser then shows "unexpected response from server").
          // "low" is Google's latency-minimizing setting (per the official
          // Gemini 3 docs it is the recommended choice for high-throughput,
          // latency-sensitive calls) and is the owner's chosen default here.
          // It still reasons over the grounded search sources, just with far
          // less deliberation, so first-token latency is much lower. Override
          // via AI_THINKING_LEVEL (e.g. "medium"/"high") without a code change.
          thinking_level: process.env.AI_THINKING_LEVEL ?? "low",
          // Only set temperature when the caller explicitly asks; otherwise
          // let Gemini use its recommended default (1.0).
          ...(typeof opts.temperature === "number"
            ? { temperature: opts.temperature }
            : {}),
        },
      };
      // Hard timeout so a slow grounding run fails FAST with a friendly message
      // instead of hanging until Vercel kills the function at 300s.
      const res = await fetchWithTimeout(
        GEMINI_INTERACTIONS_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY,
          },
          body: JSON.stringify(body),
        },
        AI_WEBSEARCH_TIMEOUT_MS,
      );

      if (res.ok) {
        const payload = (await res.json()) as {
          output_text?: string;
          steps?: unknown;
          usage?: {
            prompt_token_count?: number;
            candidates_token_count?: number;
            total_token_count?: number;
            input_tokens?: number;
            output_tokens?: number;
            total_tokens?: number;
          };
        };
        const text = extractInteractionsText(payload);
        const sources = extractInteractionsSources(payload);
        const usage: ChatUsage = {
          prompt_tokens: payload.usage?.prompt_token_count ?? payload.usage?.input_tokens,
          completion_tokens:
            payload.usage?.candidates_token_count ?? payload.usage?.output_tokens,
          total_tokens: payload.usage?.total_token_count ?? payload.usage?.total_tokens,
        };
        await record(
          { ...opts.context, feature: opts.context?.feature ?? "ai.websearch" },
          model,
          promptText,
          text,
          usage,
          true,
        );
        return { text, sources, model, usedWebSearch: true };
      }

      // Non-OK. For operator-actionable statuses (bad key, out of credits,
      // provider outage) there is NO point spending a second call on the
      // built-in-knowledge fallback \u2014 it hits the same account and fails the
      // same way, just slower. Log it, then throw a friendly, catchable error
      // the UI can show verbatim (instead of hanging toward the 300s kill).
      const friendly = friendlyStatusMessage(res.status);
      const detail = await res.text().catch(() => "");
      await record(
        { ...opts.context, feature: opts.context?.feature ?? "ai.websearch" },
        model,
        promptText,
        "",
        undefined,
        false,
        friendly
          ? `gemini google_search HTTP ${res.status} — ${friendly}`
          : `gemini google_search HTTP ${res.status} — falling back to built-in knowledge`,
      );
      if (friendly) {
        throw new AiLookupError(
          friendly,
          `gemini google_search HTTP ${res.status}: ${detail.slice(0, 200)}`,
        );
      }
      // Other non-OK (e.g. a transient 4xx): fall through to fallback below.
    } catch (err) {
      if (
        err instanceof AiNotConfiguredError ||
        err instanceof AiBudgetExceededError ||
        err instanceof AiLookupError
      ) {
        throw err;
      }
      // A timeout means grounding ran too long. Don't burn a second call \u2014 tell
      // the operator plainly so they can simply try again.
      if (isAbortError(err)) {
        await record(
          { ...opts.context, feature: opts.context?.feature ?? "ai.websearch" },
          model,
          promptText,
          "",
          undefined,
          false,
          `gemini google_search timed out after ${Math.round(AI_WEBSEARCH_TIMEOUT_MS / 1000)}s`,
        );
        throw new AiLookupError(
          "The web search took too long and was stopped. Try the lookup again \u2014 it usually finishes on a second attempt.",
          `gemini google_search aborted after ${AI_WEBSEARCH_TIMEOUT_MS}ms`,
        );
      }
      await record(
        { ...opts.context, feature: opts.context?.feature ?? "ai.websearch" },
        model,
        promptText,
        "",
        undefined,
        false,
        `gemini google_search error: ${String(err).slice(0, 160)} — falling back`,
      );
    }

    // Gemini failed → built-in-knowledge fallback (no live sources). We hit
    // Gemini's OpenAI-compat /chat/completions layer directly so this path is
    // self-contained and does NOT depend on AI_BASE_URL pointing at Google.
    const g = await geminiChatFallback(model, opts.system, opts.user, {
      ...(typeof opts.temperature === "number" ? { temperature: opts.temperature } : {}),
      maxTokens: opts.maxTokens ?? 900,
    });
    await record(
      { ...opts.context, feature: opts.context?.feature ?? "ai.websearch.fallback" },
      model,
      promptText,
      g.content,
      g.usage,
      true,
    );
    return { text: g.content, sources: [], model, usedWebSearch: false };
  }

  // --- Primary path: Responses API with the hosted web_search tool. ---------
  try {
    const res = await fetchWithTimeout(
      `${AI_BASE_URL}/responses`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0.3,
          max_output_tokens: opts.maxTokens ?? 900,
          tools: [{ type: "web_search" }],
          input: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
        }),
      },
      AI_WEBSEARCH_TIMEOUT_MS,
    );

    if (res.ok) {
      const payload = (await res.json()) as {
        output_text?: string;
        output?: unknown;
        usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      };
      const text = extractResponsesText(payload);
      const sources = extractResponsesSources(payload);
      const usage: ChatUsage = {
        prompt_tokens: payload.usage?.input_tokens,
        completion_tokens: payload.usage?.output_tokens,
        total_tokens: payload.usage?.total_tokens,
      };
      await record(
        { ...opts.context, feature: opts.context?.feature ?? "ai.websearch" },
        model,
        promptText,
        text,
        usage,
        true,
      );
      return { text, sources, model, usedWebSearch: true };
    }

    // Non-OK: log and fall through to the built-in-knowledge fallback.
    await record(
      { ...opts.context, feature: opts.context?.feature ?? "ai.websearch" },
      model,
      promptText,
      "",
      undefined,
      false,
      `web_search HTTP ${res.status} — falling back to built-in knowledge`,
    );
  } catch (err) {
    if (
      err instanceof AiNotConfiguredError ||
      err instanceof AiBudgetExceededError ||
      err instanceof AiLookupError
    ) {
      throw err;
    }
    // A timeout already burned most of the budget window; don't chase it with a
    // fallback call that would push toward the function kill. Fail friendly.
    if (isAbortError(err)) {
      await record(
        { ...opts.context, feature: opts.context?.feature ?? "ai.websearch" },
        model,
        promptText,
        "",
        undefined,
        false,
        `web_search timed out after ${Math.round(AI_WEBSEARCH_TIMEOUT_MS / 1000)}s`,
      );
      throw new AiLookupError(
        "The web search took too long and was stopped. Try the lookup again \u2014 it usually finishes on a second attempt.",
        `web_search aborted after ${AI_WEBSEARCH_TIMEOUT_MS}ms`,
      );
    }
    await record(
      { ...opts.context, feature: opts.context?.feature ?? "ai.websearch" },
      model,
      promptText,
      "",
      undefined,
      false,
      `web_search error: ${String(err).slice(0, 160)} — falling back`,
    );
  }

  // --- Fallback path: plain gpt-4o completion (built-in knowledge). ---------
  // No live sources; usedWebSearch=false so the UI can be honest about it.
  const { content, usage } = await chatRaw(model, opts.system, opts.user, {
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens ?? 900,
  });
  await record(
    { ...opts.context, feature: opts.context?.feature ?? "ai.websearch.fallback" },
    model,
    promptText,
    content,
    usage,
    true,
  );
  return { text: content, sources: [], model, usedWebSearch: false };
}
