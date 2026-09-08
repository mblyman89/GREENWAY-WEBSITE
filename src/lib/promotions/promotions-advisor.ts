/**
 * src/lib/promotions/promotions-advisor.ts  (Task R)
 *
 * On-demand, DRAFTS-ONLY AI advisor for the Promotions command center. It is
 * fed ONLY aggregate counts and deterministic, pre-computed audit states —
 * never customer data or raw sales rows — and returns a plain-language
 * briefing: what needs attention (below-cost risks, conflicts, unpriced
 * costs), what looks healthy, margin-smart ideas, and concrete next steps.
 * Advisory only; it never creates, edits, or publishes promotions.
 *
 * Grounded in docs/PROMOTIONS_COMPLIANCE.md. Gated on the AI key (graceful
 * no-op). Server-only.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId } from "@/lib/ai/provider";

export { isAiConfigured };

const SYSTEM = [
  "You are a meticulous Washington State cannabis retail promotions strategist for Greenway Marijuana (I-502 retailer, Port Orchard WA).",
  "You help a non-technical owner run a professional promotions program that is ADVANTAGEOUS FOR THE STORE while staying compliant.",
  "GROUND TRUTH you must respect (verified current rules — do not contradict):",
  "- CCRS Upload User Guide (June 2025), Sale.csv Discount: a discount 'must be available to all who meet the discount conditions and may not discount the sale price below the cost of acquisition.'",
  "- RCW 69.50.357: retailers may not give cannabis away free ('not less than the cost of acquisition'); violations are $1,000 each.",
  "- The POS enforces three layers: a register clamp (price never below the tax-inclusive cost floor), a publish-time HARD BLOCK (worst-case below-cost promos cannot publish), and a standing below-cost audit.",
  "- Promotions NEVER stack: every item receives only the single best deal (best-deal-wins).",
  "- The daily deals are SET IN STONE — never suggest changing Tuesday (prerolls/blunts/packs: 1–3 get 20% off, 4 or more get 25% off, which is the advertised '4 for the price of 3') or Sunday (3-for-2 storewide, the cheapest unit per group of 3 spread across the eligible lines to the exact cent). You may suggest ways to merchandise them better.",
  "- 'Store wins' is a ROUNDING rule (a split cent goes to the store), NOT a deal-selection rule. Never suggest resolving two advertised offers by picking the one that saves the customer less — an advertised discount is honoured as advertised. Where a discount cannot divide evenly into whole cents, the remainder is rounded in the CUSTOMER's favour so the advertised rate is always met or beaten.",
  "- Cannabis prices are tax-inclusive (37% excise + 9.3% sales); costs are pre-tax, so the sale floor is ceil(cost × 1.463) for cannabis (× 1.093 for merch).",
  "You are given ONLY aggregate counts and audit states. Reference the ACTUAL numbers given — never invent figures, products, or events.",
  "Do not give legal advice. Keep it concrete, margin-focused, calm, and actionable.",
].join("\n");

export type PromotionsAdviceInput = {
  totalPromotions: number;
  published: number;
  drafts: number;
  scheduled: number;
  archived: number;
  weekdaysCovered: number; // 0-7 distinct weekdays with a live deal
  conflictsCount: number;
  belowCostHits: number;
  costUnknownHits: number;
  regularBelowCostHits: number;
  menuProducts: number;
  costedProducts: number;
  aiQuestion?: string | null;
};

export type PromotionsAdvice = {
  headline: string;
  attention: string[];
  healthy: string[];
  ideas: string[];
  steps: string[];
  model: string;
};

type Raw = {
  headline?: unknown;
  attention?: unknown;
  healthy?: unknown;
  ideas?: unknown;
  steps?: unknown;
};

function strArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function summarize(i: PromotionsAdviceInput): string {
  return [
    `Promotions total: ${i.totalPromotions} (published ${i.published}, drafts ${i.drafts}, scheduled ${i.scheduled}, archived ${i.archived})`,
    `Weekdays covered by a live deal: ${i.weekdaysCovered}/7`,
    `Products under MORE THAN ONE published promo (conflicts): ${i.conflictsCount}`,
    `BELOW-COST worst-case hits across published promos (register would clamp): ${i.belowCostHits}`,
    `Affected products with UNKNOWN acquisition cost (no costed lot yet): ${i.costUnknownHits}`,
    `Products whose REGULAR price already sits at/below the cost floor: ${i.regularBelowCostHits}`,
    `Published menu products: ${i.menuProducts} (with a known cost: ${i.costedProducts})`,
  ].join("\n");
}

export async function generatePromotionsAdvice(
  input: PromotionsAdviceInput,
): Promise<PromotionsAdvice> {
  const model = aiModelId;
  const user = [
    "Here is the current state of the Promotions command center (aggregate counts only).",
    "Write a short briefing for the owner reviewing the promotions program today.",
    "",
    summarize(input),
    "",
    input.aiQuestion?.trim()
      ? `The owner also asks: "${input.aiQuestion.trim().slice(0, 300)}"`
      : "",
    "",
    "Return JSON with keys:",
    '{ "headline": string, "attention": string[], "healthy": string[], "ideas": string[], "steps": string[] }',
    "- headline: one or two sentences — is anything at risk, and what matters most today?",
    "- attention: what needs action (map each to the actual counts given). Empty array if nothing.",
    "- healthy: what looks in good shape (be specific to the counts).",
    "- ideas: margin-smart promotion ideas or merchandising angles (store-advantaged; never below cost; never touching the set-in-stone daily deals). Max 4.",
    "- steps: the concrete order of operations for today (max 6).",
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generateJSON<Raw>({
    system: SYSTEM,
    user,
    temperature: 0.3,
    maxTokens: 800,
    context: { feature: "promotions_advisor" },
  });

  return {
    headline:
      typeof raw.headline === "string" && raw.headline.trim()
        ? raw.headline.trim()
        : "Review the below-cost audit and conflicts panels first, then the weekly coverage.",
    attention: strArray(raw.attention),
    healthy: strArray(raw.healthy),
    ideas: strArray(raw.ideas, 4),
    steps: strArray(raw.steps),
    model,
  };
}
