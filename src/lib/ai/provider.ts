/**
 * src/lib/ai/provider.ts
 *
 * Provider-agnostic AI text generation. Swappable model/provider behind a single
 * `generate()` call. Uses an OpenAI-compatible Chat Completions endpoint via
 * fetch (works with OpenAI, OpenRouter, Together, local gateways, etc.).
 *
 * Gracefully NO-OPS when AI_API_KEY is unset: `isAiConfigured` is false and
 * `generate()` throws a clear, catchable error so callers can disable the UI.
 *
 * Server-only. Never import into client components.
 */
import "server-only";

const AI_API_KEY = process.env.AI_API_KEY ?? "";
const AI_BASE_URL = process.env.AI_BASE_URL ?? "https://api.openai.com/v1";
const AI_MODEL = process.env.AI_MODEL ?? "gpt-4o-mini";

/** True when an AI key is configured. UI should soft-disable AI when false. */
export const isAiConfigured = Boolean(AI_API_KEY);

/** The model id in use (for provenance/audit). */
export const aiModelId = AI_MODEL;

export type GenerateOptions = {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
};

export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured. Set AI_API_KEY (and optionally AI_BASE_URL / AI_MODEL).");
    this.name = "AiNotConfiguredError";
  }
}

/**
 * Generate text from the configured model. Returns the trimmed completion.
 * Throws AiNotConfiguredError when no key is set.
 */
export async function generate(opts: GenerateOptions): Promise<string> {
  if (!isAiConfigured) throw new AiNotConfiguredError();

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
    throw new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? "";
  return content.trim();
}
