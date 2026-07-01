/**
 * src/lib/marketing/midjourney-ai.ts
 *
 * Server-side AI helper that expands a marketing brief into a polished set of
 * Midjourney concept fields + explains its choices. GROUNDED (we pass real
 * brand/product context) and DRAFTS-ONLY (the employee reviews before using).
 *
 * NO-OPS gracefully when AI is unconfigured — callers should check
 * `isAiConfigured` and hide the assist button.
 */
import "server-only";
import { generate, isAiConfigured } from "@/lib/ai/provider";
import { COMPLIANCE_NOTE } from "@/lib/marketing/midjourney-core";

export { isAiConfigured };

export type BriefSuggestion = {
  subject: string;
  environment: string;
  composition: string;
  lighting: string;
  style: string;
  colorMood: string;
  exclude: string;
  rationale: string;
};

const SYSTEM = [
  "You are a senior art director for a licensed Washington State cannabis retailer's marketing team.",
  "You help craft image briefs that will be turned into Midjourney prompts. You do NOT write the final Midjourney parameter string — another tool does that.",
  "Return ONLY compact JSON with these string keys: subject, environment, composition, lighting, style, colorMood, exclude, rationale.",
  "Each field is a short comma-free phrase describing that one aspect (except 'exclude' which lists things to avoid, and 'rationale' which is 1-2 sentences explaining your creative choices).",
  "Ground every suggestion in the brand context provided. Keep it tasteful, premium, and realistic.",
  `Compliance: ${COMPLIANCE_NOTE} Never suggest imagery that appeals to minors or implies health/medical benefits.`,
].join(" ");

/**
 * Expand a short idea + brand context into structured brief fields. Returns a
 * draft the employee edits before assembling the final prompt.
 */
export async function suggestBrief(input: {
  idea: string;
  presetLabel?: string;
  brandContext?: string;
}): Promise<BriefSuggestion> {
  if (!isAiConfigured) {
    throw new Error("AI is not configured.");
  }
  const user = [
    `Marketing idea: ${input.idea}`,
    input.presetLabel ? `Format/preset: ${input.presetLabel}` : "",
    input.brandContext ? `Brand context (use this, do not invent):\n${input.brandContext}` : "",
    "",
    "Return the JSON now.",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generate({
    system: SYSTEM,
    user,
    temperature: 0.6,
    maxTokens: 500,
    context: { feature: "midjourney-brief" },
  });

  const parsed = tolerantJson(raw);
  return {
    subject: str(parsed.subject),
    environment: str(parsed.environment),
    composition: str(parsed.composition),
    lighting: str(parsed.lighting),
    style: str(parsed.style),
    colorMood: str(parsed.colorMood ?? parsed.color_mood),
    exclude: str(parsed.exclude),
    rationale: str(parsed.rationale),
  };
}

function str(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v)) return v.map((x) => String(x)).join(" ").trim();
  return "";
}

/** Parse JSON that may be fenced or have surrounding prose. */
function tolerantJson(raw: string): Record<string, unknown> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return {};
  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}
