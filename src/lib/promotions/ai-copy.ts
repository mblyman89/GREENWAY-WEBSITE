/**
 * src/lib/promotions/ai-copy.ts
 *
 * AI DRAFT assist for promotion marketing copy (PR C). Given the mechanics a
 * staffer has already chosen on the promotion form (discount type, amount,
 * recurring weekday, what it applies to) plus an optional plain-language
 * instruction, it generates three compliant, on-brand pieces:
 *   - a catchy promo name/title
 *   - a one-to-two sentence announcement / description
 *   - a short badge note for the product card
 *
 * Output is a SUGGESTION only — shown for staff to Use / Edit / Discard and
 * never written to a promotion automatically (drafts-only gate).
 *
 * Uses the shared provider's `generateJSON`, the WA-cannabis compliance system
 * prompt + scanner, and logs usage under the `promotion.copy` feature.
 *
 * Server-only. Never import into a client component.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId, type AiContext } from "@/lib/ai/provider";
import { COMPLIANCE_SYSTEM, PROMPT_VERSION, checkCompliance } from "@/lib/ai/compliance";
import { DISCOUNT_TYPE_LABELS, WEEKDAY_LABELS, type DiscountType, type Weekday } from "./types";

export { isAiConfigured };

export type PromotionCopyBrief = {
  discountType: DiscountType;
  discountPercent?: number | null;
  discountFixedMinor?: number | null;
  weekday?: Weekday | null;
  /** Storewide / category / brand summary for context. */
  appliesTo?: string | null;
  currentTitle?: string | null;
  currentDescription?: string | null;
  instruction?: string | null;
};

export type PromotionCopySuggestion = {
  title: string;
  description: string;
  badgeNote: string;
  complianceFlags: string[];
  model: string;
  promptVersion: string;
};

function describeMechanics(brief: PromotionCopyBrief): string {
  const parts: string[] = [`Discount type: ${DISCOUNT_TYPE_LABELS[brief.discountType] ?? brief.discountType}.`];
  if (brief.discountPercent && brief.discountPercent > 0) {
    parts.push(`${brief.discountPercent}% off.`);
  }
  if (brief.discountFixedMinor && brief.discountFixedMinor > 0) {
    parts.push(`$${(brief.discountFixedMinor / 100).toFixed(2)} off.`);
  }
  if (brief.weekday != null && brief.weekday >= 0) {
    parts.push(`Recurring every ${WEEKDAY_LABELS[brief.weekday]}.`);
  }
  if (brief.appliesTo) {
    parts.push(`Applies to: ${brief.appliesTo}.`);
  }
  return parts.join(" ");
}

type RawCopy = { title?: unknown; description?: unknown; badge?: unknown };

function s(value: unknown, max: number): string {
  const v = (typeof value === "string" ? value : "").trim();
  return v.length > max ? v.slice(0, max).trim() : v;
}

/**
 * Generate one compliant promo copy suggestion (name + announcement + badge).
 * Throws AiNotConfiguredError when no key is set, so the caller can surface a
 * friendly "AI not set up" message.
 */
export async function generatePromotionCopy(
  brief: PromotionCopyBrief,
  context?: Omit<AiContext, "feature">,
): Promise<PromotionCopySuggestion> {
  const lines = [
    `You are a cannabis-retail marketer writing in-store promotion copy for a licensed Washington State (21+) dispensary, Greenway Marijuana.`,
    `Here are the deal mechanics the staffer already configured:`,
    describeMechanics(brief),
    brief.currentTitle ? `Current name: "${brief.currentTitle}"` : null,
    brief.currentDescription ? `Current description: "${brief.currentDescription}"` : null,
    brief.instruction ? `Staff instruction: ${brief.instruction}` : null,
    ``,
    `Write three pieces:`,
    `1. "title" — a catchy, memorable promo NAME (2-5 words, no period; alliteration/day puns welcome for weekday deals, e.g. "Munchie Monday", "Top-Shelf Thursday").`,
    `2. "description" — one to two upbeat sentences announcing the deal (<= 180 characters).`,
    `3. "badge" — a tiny card badge phrase (<= 28 characters, e.g. "Save 20% today").`,
    ``,
    `Voice: confident, fun, welcoming, premium-but-approachable. No emojis. Do NOT make medical claims, do NOT target minors, and do NOT promise anything that depends on stock you can't guarantee. Reflect that this is an adult-use (21+) cannabis retailer.`,
    `Return ONLY a JSON object: {"title": string, "description": string, "badge": string}. No prose, no code fences.`,
  ].filter(Boolean) as string[];

  const raw = await generateJSON<RawCopy>({
    system: COMPLIANCE_SYSTEM,
    user: lines.join("\n"),
    temperature: 0.8,
    maxTokens: 240,
    context: {
      feature: "promotion.copy",
      entityType: "promotion",
      ...context,
    },
  });

  const title = s(raw?.title, 80);
  const description = s(raw?.description, 220);
  const badgeNote = s(raw?.badge, 40);
  const { flags } = checkCompliance(`${title}\n${description}\n${badgeNote}`);

  return {
    title,
    description,
    badgeNote,
    complianceFlags: flags,
    model: aiModelId,
    promptVersion: PROMPT_VERSION,
  };
}
