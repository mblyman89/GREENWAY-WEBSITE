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

const AI_API_KEY = process.env.AI_API_KEY ?? "";
const AI_BASE_URL = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
const AI_MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";
// A model capable of vision; defaults to the same family. Override if needed.
const AI_VISION_MODEL = process.env.AI_VISION_MODEL ?? "gpt-4o-mini";

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
    super("AI is not configured. Set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL).");
    this.name = "AiNotConfiguredError";
  }
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
