/**
 * src/lib/cms/ai-content.ts
 *
 * AI DRAFT assist for controlled site-content blocks (UX-3). Given a block's
 * label / purpose and an optional staff instruction, it generates a compliant
 * draft value for that single block. Output is a SUGGESTION only — it is shown
 * for staff Accept / Edit / Reject and is never written to the draft or
 * published automatically (same drafts-only gate as the menu + blog).
 *
 * Reuses the shared provider (`src/lib/ai/provider`) and the WA-cannabis
 * compliance system prompt + scanner (`src/lib/ai/compliance`).
 *
 * Server-only. Never import into a client component.
 */
import "server-only";
import { generate, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, PROMPT_VERSION, checkCompliance } from "@/lib/ai/compliance";

export { isAiConfigured };

export type ContentBlockBrief = {
  blockKey: string;
  label: string;
  /** plain | rich | markdown — controls formatting guidance. */
  fieldType: string;
  /** Whether this block influences SEO (keeps it concise + keyword-aware). */
  seoImpact?: boolean;
  /** The current value, so AI can rewrite/improve rather than start blank. */
  current?: string | null;
  /** Optional plain-language instruction from staff ("make it friendlier"). */
  instruction?: string | null;
};

export type ContentSuggestion = {
  /** The generated draft text (already trimmed). */
  value: string;
  /** Compliance flags found in the output (empty = clean). */
  complianceFlags: string[];
  /** Provenance for the UI + audit. */
  model: string;
  promptVersion: string;
};

/** Rough length guidance per block kind, nudging tasteful, on-brand output. */
function lengthGuidance(brief: ContentBlockBrief): string {
  const key = brief.blockKey.toLowerCase();
  if (key.includes("title") || key.includes("heading")) {
    return brief.seoImpact
      ? "Return a single punchy headline of 3-8 words. No period."
      : "Return a single short headline of 2-7 words. No period.";
  }
  if (key.includes("subtitle") || key.includes("subhead")) {
    return "Return ONE sentence (max ~18 words). Warm, inviting, plain text.";
  }
  if (brief.fieldType === "rich" || brief.fieldType === "markdown") {
    return "Return 1-2 short paragraphs of plain text (no markdown headings, no lists).";
  }
  return "Return one concise sentence of plain text.";
}

function buildPrompt(brief: ContentBlockBrief): { user: string; inputSummary: string } {
  const parts = [
    `You are writing the website copy for a single, specific text slot on a licensed Washington State cannabis retailer's site.`,
    `Slot: "${brief.label}" (key: ${brief.blockKey}).`,
    brief.current ? `Current copy: "${brief.current}"` : `There is no current copy yet.`,
    brief.instruction ? `Staff instruction: ${brief.instruction}` : null,
    lengthGuidance(brief),
    `Voice: confident, welcoming, adult-oriented, premium-but-approachable. No emojis. No quotes around the text. Do not mention price, stock, medical claims, or anything that targets minors. Return ONLY the copy itself — no labels, no explanation.`,
  ].filter(Boolean) as string[];

  return {
    user: parts.join("\n"),
    inputSummary: `${brief.label}${brief.instruction ? " · " + brief.instruction : ""}`,
  };
}

/** Strip stray wrapping quotes / leading labels a model sometimes adds. */
function cleanOutput(raw: string): string {
  let v = raw.trim();
  // remove a single pair of wrapping quotes
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  // drop an accidental "Title:"/"Copy:" prefix
  v = v.replace(/^(title|copy|headline|subtitle|text)\s*:\s*/i, "").trim();
  return v;
}

/**
 * Generate one compliant draft suggestion for a content block.
 * Throws AiNotConfiguredError (from the provider) when no key is set, so the
 * caller can surface a friendly "AI not set up" message.
 */
export async function generateContentSuggestion(
  brief: ContentBlockBrief,
): Promise<ContentSuggestion> {
  const { user } = buildPrompt(brief);
  const raw = await generate({
    system: COMPLIANCE_SYSTEM,
    user,
    temperature: 0.7,
    maxTokens: brief.fieldType === "rich" || brief.fieldType === "markdown" ? 320 : 80,
  });
  const value = cleanOutput(raw);
  const { flags } = checkCompliance(value);
  return {
    value,
    complianceFlags: flags,
    model: aiModelId,
    promptVersion: PROMPT_VERSION,
  };
}
