/**
 * src/lib/cms/ai-blog-ideas.ts
 *
 * B7 — GPT-4o blog IDEA / HEADLINE / TREND assistant for the Greenway blog.
 *
 * This is the "suggest what to write about" half of the blog AI (the existing
 * ai-blog.ts covers drafting the body + SEO of a chosen post). It proposes a
 * batch of post ideas — each with a headline, an angle, a short "why now" hook,
 * a suggested category, and 3–5 keywords — tuned to Greenway's LOCAL audience:
 *
 *   Kitsap County (Port Orchard, Bremerton, Silverdale, Poulsbo, Bainbridge)
 *   + the surrounding area + the greater Seattle / Puget Sound market.
 *
 * DRAFTS-ONLY (standing rule): these are SUGGESTIONS a human reviews. Nothing is
 * published or even saved to a post automatically. All copy still passes through
 * the WA I-502 compliance system prompt + post-generation scan, so ideas never
 * imply health claims, minor appeal, dosing advice, etc.
 *
 * Server-only. Uses the shared, budget-guarded, schema-validated AI provider.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, checkCompliance } from "@/lib/ai/compliance";
import { BLOG_CATEGORIES } from "@/lib/cms/types";

export { isAiConfigured };

/** The local market Greenway writes for. Kept here so the prompt stays grounded. */
export const LOCAL_MARKET_CONTEXT = `
Greenway Marijuana is a licensed Washington I-502 cannabis retailer in Port
Orchard, Kitsap County. Its audience is LOCAL, adults 21+:
- Kitsap County: Port Orchard, Bremerton, Silverdale, Poulsbo, Bainbridge Island,
  Gig Harbor, and the Kitsap Peninsula (ferry + Navy/PSNS community).
- The surrounding area and the greater Seattle / Puget Sound region (Tacoma,
  Seattle, the Eastside) — customers who cross the water or the bridge.
Write for this audience: reference local seasons, ferries, the outdoors (Olympic
Peninsula, hiking, the Sound), local events and culture where it is genuinely
relevant — but NEVER invent specific event names, dates, dispensary claims, or
facts you were not given.
`.trim();

export type BlogIdeaKind = "idea" | "headline" | "trend";

export type BlogIdea = {
  headline: string;
  angle: string;
  hook: string;
  category: string;
  keywords: string[];
  complianceFlags: string[];
};

export type BlogIdeaResult = {
  ideas: BlogIdea[];
  model: string;
};

/** One idea object in the structured response. */
type RawIdea = {
  headline: string;
  angle: string;
  hook: string;
  category: string;
  keywords: string[];
};
type RawIdeaBatch = { ideas?: RawIdea[] };

/** Build the user prompt for an idea batch. */
function ideaPrompt(kind: BlogIdeaKind, count: number, topic: string | null): string {
  const what =
    kind === "headline"
      ? `Propose ${count} strong, specific HEADLINES (title ideas) for blog posts.`
      : kind === "trend"
      ? `Propose ${count} TIMELY, trend-aware blog post ideas — things worth writing about for this audience in the current season/market. Ground the "hook" in general, evergreen-safe timeliness (season, local lifestyle, product education) — do NOT fabricate specific news, events, or dates.`
      : `Propose ${count} blog post IDEAS.`;

  const topicLine = topic ? `\nBias the ideas toward this theme/topic: ${topic}` : "";

  return `${LOCAL_MARKET_CONTEXT}

${what}
For EACH idea return: headline, angle (one sentence), hook (why it's relevant to
the local audience), category (one of: ${BLOG_CATEGORIES.join(", ")}), and 3-5
short keywords. Keep everything tasteful, educational, adult-oriented (21+), and
FULLY WA I-502 compliant — no health/medical claims, no dosing advice, nothing
appealing to minors, no price/stock/inventory specifics.${topicLine}

Return ONLY JSON of the exact shape:
{"ideas":[{"headline":"...","angle":"...","hook":"...","category":"...","keywords":["...","..."]}]}
No prose, no code fences.`;
}

function normalizeCategory(raw: string): string {
  const up = (raw || "").toUpperCase().trim();
  return (BLOG_CATEGORIES as readonly string[]).includes(up) ? up : "CULTURE";
}

function cleanIdea(raw: RawIdea): BlogIdea | null {
  const headline = (raw?.headline ?? "").toString().trim();
  if (!headline) return null;
  const angle = (raw?.angle ?? "").toString().trim();
  const hook = (raw?.hook ?? "").toString().trim();
  const keywords = Array.isArray(raw?.keywords)
    ? raw.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 6)
    : [];
  // Compliance scan across the visible copy (assistive; reviewer still edits).
  const scan = checkCompliance([headline, angle, hook, keywords.join(" ")].join(". "));
  return {
    headline,
    angle,
    hook,
    category: normalizeCategory(raw?.category ?? ""),
    keywords,
    complianceFlags: scan.flags,
  };
}

/**
 * Generate a batch of blog ideas/headlines/trends for the local market.
 * DRAFTS-ONLY. Throws AiNotConfiguredError when no key is set; callers should
 * check isAiConfigured / catch and surface a friendly message.
 */
export async function generateBlogIdeas(opts: {
  kind: BlogIdeaKind;
  count?: number;
  topic?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
}): Promise<BlogIdeaResult> {
  const count = Math.min(Math.max(opts.count ?? 6, 1), 10);
  const user = ideaPrompt(opts.kind, count, opts.topic ?? null);

  // The idea batch is an array-of-objects, which the tiny strict-schema lib
  // can't express, so we use the tolerant JSON path (json_object + loose parse)
  // and clean/validate each idea ourselves below.
  const raw = await generateJSON<RawIdeaBatch>({
    system: COMPLIANCE_SYSTEM,
    user,
    temperature: 0.8,
    maxTokens: 1100,
    context: {
      feature: "blog.ai.ideas",
      entityType: "blog",
      actorId: opts.actorId ?? null,
      actorEmail: opts.actorEmail ?? null,
    },
  });

  const list = Array.isArray(raw?.ideas) ? raw.ideas : [];
  const ideas = list
    .map((r) => cleanIdea(r))
    .filter((x): x is BlogIdea => x !== null)
    .slice(0, count);

  return { ideas, model: aiModelId };
}
