/**
 * src/lib/loyalty/loyalty-advisor.ts  (Task S-a)
 *
 * On-demand, DRAFTS-ONLY AI advisor for the loyalty command center. It is fed
 * ONLY the aggregate metrics from loyalty-metrics.ts — never customer PII or
 * raw rows — and returns a plain-language briefing on customer behavior:
 * what needs attention, what's healthy, retention/engagement ideas, and next
 * steps. Advisory only; it never changes the program.
 *
 * Grounded in docs/LOYALTY_COMPLIANCE.md. Gated on the AI key. Server-only.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId } from "@/lib/ai/provider";
import type { LoyaltyMetrics } from "@/lib/loyalty/loyalty-metrics";

export { isAiConfigured };

const SYSTEM = [
  "You are a customer-loyalty and retention strategist for Greenway Marijuana (WA I-502 cannabis retailer, Port Orchard WA).",
  "You help a non-technical owner run a professional, industry-standard points program that grows repeat business while staying compliant.",
  "GROUND TRUTH you must respect (verified current rules — do not contradict):",
  "- Loyalty redemptions and tier discounts are DISCOUNTS: they may never price a product below the retailer's acquisition cost (WAC 314-55-155(5)(g); CCRS Upload User Guide) and cannabis may never be free (RCW 69.50.357). The POS clamps every price to those floors automatically.",
  "- The program must be 100% retailer-funded: producers/processors may not fund or negotiate any part of it (LCB money's-worth bulletin 23-01). Never suggest vendor-funded loyalty mechanics.",
  "- Discounts never stack: each order gets ONE loyalty application (a code or member tier pricing), and each line keeps the better of the promo price or tier price — best deal wins for the customer.",
  "- Advertising restrictions apply to loyalty marketing (WAC 314-55-155): no appeal to youth, no over-consumption promotion, no curative claims; keep suggestions in owned channels (in-store, email/SMS to opted-in adults 21+).",
  "- Points accrue on the PRE-TAX subtotal after discounts. Codes hold stored value (points deducted at issuance) and are released back if the sale is cancelled.",
  "You are given ONLY aggregate program metrics. Reference the ACTUAL numbers given — never invent figures, customers, or events.",
  "Do not give legal advice. Keep it concrete, retention-focused, calm, and actionable for a store with a small team.",
].join("\n");

export type LoyaltyAdvice = {
  headline: string;
  attention: string[];
  healthy: string[];
  ideas: string[];
  steps: string[];
  model: string;
};

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

function summarize(m: LoyaltyMetrics): string {
  return [
    `Enrolled members: ${m.accounts} (new in last 30d: ${m.newAccounts30d}; active in last 90d: ${m.activeAccounts90d})`,
    `Points earned last 30d: ${m.pointsEarned30d}; points converted to codes last 30d: ${m.pointsRedeemed30d} (redemption rate ${m.redemptionRate30d == null ? "n/a" : `${m.redemptionRate30d}%`})`,
    `Outstanding liability: ${m.pointsOutstanding} pts + ${m.codesIssuedOutstanding} live codes = ${money(m.liabilityMinor)} at the current point value (${money(m.pointValueMinor)}/pt)`,
    `Codes: ${m.codesIssuedOutstanding} outstanding (${money(m.codesOutstandingValueMinor)}), ${m.codesRedeemed30d} used last 30d, ${m.codesExpired} expired all-time, avg ${m.avgDaysIssueToUse ?? "n/a"} days from issue to use`,
    `Completed orders last 90d: ${m.memberOrders90d} member vs ${m.guestOrders90d} guest; avg order ${m.memberAvgOrderMinor == null ? "n/a" : money(m.memberAvgOrderMinor)} member vs ${m.guestAvgOrderMinor == null ? "n/a" : money(m.guestAvgOrderMinor)} guest`,
    `Loyalty value given at the register last 90d: ${money(m.loyaltyDiscountTotal90dMinor)}`,
    `Tier distribution: ${m.tierDistribution.length > 0 ? m.tierDistribution.map((t) => `${t.name} ${t.count}`).join(", ") : "none"}; members below the first tier: ${m.untieredAccounts}`,
  ].join("\n");
}

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

export async function generateLoyaltyAdvice(
  metrics: LoyaltyMetrics,
  question?: string | null,
): Promise<LoyaltyAdvice> {
  const model = aiModelId;
  const user = [
    "Here is the current state of the loyalty program (aggregate metrics only).",
    "Write a short customer-behavior briefing for the owner reviewing the program today.",
    "",
    summarize(metrics),
    "",
    question?.trim() ? `The owner also asks: "${question.trim().slice(0, 300)}"` : "",
    "",
    "Return JSON with keys:",
    '- "headline": one sentence on overall program health.',
    '- "attention": array (max 5) of concrete things that need attention, each referencing the numbers above.',
    '- "healthy": array (max 4) of things working well.',
    '- "ideas": array (max 5) of compliant retention/engagement ideas sized for a small store.',
    '- "steps": array (max 5) of concrete next actions in the back office.',
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await generateJSON<Raw>({
    system: SYSTEM,
    user,
    temperature: 0.3,
    maxTokens: 800,
    context: { feature: "loyalty_advisor" },
  });
  return {
    headline:
      typeof raw?.headline === "string" && raw.headline.trim()
        ? raw.headline.trim()
        : "Loyalty program briefing",
    attention: strArray(raw?.attention, 5),
    healthy: strArray(raw?.healthy, 4),
    ideas: strArray(raw?.ideas, 5),
    steps: strArray(raw?.steps, 5),
    model,
  };
}
