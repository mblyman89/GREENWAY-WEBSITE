/**
 * src/lib/cms/ai-seo.ts
 *
 * AI DRAFT assist for per-page SEO metadata (UX-3 / PR C). Given a public
 * route path plus optional current title / description and a plain-language
 * staff instruction, it generates a compliant, length-optimized
 * search-engine title + meta description.
 *
 * Output is a SUGGESTION only — it is shown for staff to Use / Edit / Discard
 * and is never written to the SEO entry automatically (same drafts-only gate
 * as the menu, blog, and content-block AI).
 *
 * Uses the shared provider's `generateJSON` for reliable two-field parsing,
 * the WA-cannabis compliance system prompt + scanner, and logs usage under
 * the `seo.meta` feature.
 *
 * Server-only. Never import into a client component.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId, type AiContext } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, PROMPT_VERSION, checkCompliance } from "@/lib/ai/compliance";

export { isAiConfigured };

/** Hard SEO length windows Google effectively truncates at. */
export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;

export type SeoMetaBrief = {
  /** The public route, e.g. "/", "/menu", "/specials". */
  path: string;
  /** Existing title so AI can improve rather than start blank. */
  currentTitle?: string | null;
  /** Existing description so AI can improve rather than start blank. */
  currentDescription?: string | null;
  /** Optional plain-language instruction ("mention curbside pickup"). */
  instruction?: string | null;
};

export type SeoMetaSuggestion = {
  /** The generated search-engine title (already trimmed + clamped). */
  title: string;
  /** The generated meta description (already trimmed + clamped). */
  description: string;
  /** Compliance flags found in the combined output (empty = clean). */
  complianceFlags: string[];
  /** Provenance for the UI + audit. */
  model: string;
  promptVersion: string;
};

/** Friendly description of each known public route, giving the model context. */
const PATH_CONTEXT: Record<string, string> = {
  "/": "the homepage of a licensed Washington State cannabis retailer (Greenway Marijuana)",
  "/menu": "the live product menu page (flower, edibles, vapes, concentrates, pre-rolls)",
  "/specials": "the daily deals / weekly specials and promotions page",
  "/about": "the about / our story page about the dispensary and its team",
  "/locations": "the store location, hours, and directions page",
  "/loyalty": "the customer loyalty / rewards program page",
  "/blog": "the cannabis education + news blog index",
  "/faq": "the frequently-asked-questions page covering ID rules, payment, and pickup",
  "/vendor-delivery": "the page for vendors/brands arranging product delivery to the store",
};

function describePath(path: string): string {
  return PATH_CONTEXT[path] ?? `the "${path}" page of a licensed Washington State cannabis retailer`;
}

function clampSmart(value: string, max: number): string {
  const v = (value ?? "").trim();
  if (v.length <= max) return v;
  // Trim to the last word boundary inside the limit to avoid cut-off words.
  const slice = v.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim();
}

type RawSeo = { title?: unknown; description?: unknown };

/**
 * Generate one compliant SEO title + description suggestion for a page.
 * Throws AiNotConfiguredError (from the provider) when no key is set, so the
 * caller can surface a friendly "AI not set up" message.
 */
export async function generateSeoMeta(
  brief: SeoMetaBrief,
  context?: Omit<AiContext, "feature">,
): Promise<SeoMetaSuggestion> {
  const lines = [
    `You are an SEO specialist writing search-engine metadata for ${describePath(brief.path)}.`,
    `Route: ${brief.path}`,
    brief.currentTitle ? `Current title: "${brief.currentTitle}"` : `There is no current title.`,
    brief.currentDescription
      ? `Current description: "${brief.currentDescription}"`
      : `There is no current description.`,
    brief.instruction ? `Staff instruction: ${brief.instruction}` : null,
    ``,
    `Write a compelling, keyword-aware SEO title (<= ${SEO_TITLE_MAX} characters, no trailing period) and a meta description (<= ${SEO_DESCRIPTION_MAX} characters) that earns clicks.`,
    `Voice: confident, welcoming, adult-oriented, premium-but-approachable. No emojis. Do not mention specific prices, stock levels, medical claims, or anything that targets minors. Naturally reflect that this is a licensed Washington State (21+) cannabis dispensary.`,
    `Return ONLY a JSON object: {"title": string, "description": string}. No prose, no code fences.`,
  ].filter(Boolean) as string[];

  const raw = await generateJSON<RawSeo>({
    system: COMPLIANCE_SYSTEM,
    user: lines.join("\n"),
    temperature: 0.65,
    maxTokens: 220,
    context: {
      feature: "seo.meta",
      entityType: "seo_entry",
      entityId: brief.path,
      ...context,
    },
  });

  const title = clampSmart(typeof raw?.title === "string" ? raw.title : "", SEO_TITLE_MAX);
  const description = clampSmart(
    typeof raw?.description === "string" ? raw.description : "",
    SEO_DESCRIPTION_MAX,
  );
  const { flags } = checkCompliance(`${title}\n${description}`);

  return {
    title,
    description,
    complianceFlags: flags,
    model: aiModelId,
    promptVersion: PROMPT_VERSION,
  };
}
