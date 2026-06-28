/**
 * src/lib/reports/ai-insights.ts
 *
 * AI report narrator (PR E). Turns the structured analytics reports
 * (orders, loyalty, inventory health, promotions) into a short, plain-language
 * briefing for a non-technical owner: what's going well, what needs attention,
 * and 2-3 concrete next actions.
 *
 * It is read-only and advisory. We feed the model only AGGREGATE numbers (no
 * customer PII) and ask for grounded observations — no invented figures.
 *
 * Server-only.
 */
import "server-only";
import { generateJSON, isAiConfigured, aiModelId, type AiContext } from "@/lib/ai/provider";
import type {
  OrdersReport,
  LoyaltyReport,
  InventoryHealthReport,
  PromotionsReport,
} from "@/lib/reports/analytics";

export { isAiConfigured };

const SYSTEM = [
  "You are a sharp, friendly retail analyst for a licensed Washington State cannabis dispensary (Greenway Marijuana).",
  "You are given AGGREGATE store metrics for a date range. Write a brief, plain-language briefing for a non-technical owner.",
  "Be specific and reference the actual numbers you were given — never invent figures. If a metric looks concerning (cancellations, out-of-stock, missing data), call it out plainly. If things look healthy, say so without exaggeration.",
  "Do not make medical claims, do not give legal advice, and do not mention individual customers.",
].join("\n");

export type ReportInsights = {
  /** 1-2 sentence headline summary. */
  headline: string;
  /** What's going well (bullets). */
  wins: string[];
  /** What needs attention (bullets). */
  watchouts: string[];
  /** 2-3 concrete recommended next actions. */
  actions: string[];
  model: string;
};

type RawInsights = {
  headline?: unknown;
  wins?: unknown;
  watchouts?: unknown;
  actions?: unknown;
};

function strArray(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/**
 * Build a compact, PII-free metrics digest for the model.
 */
function buildDigest(input: {
  days: number;
  orders: OrdersReport;
  loyalty: LoyaltyReport;
  inventory: InventoryHealthReport;
  promotions: PromotionsReport;
}): string {
  const { days, orders, loyalty, inventory, promotions } = input;
  const lines: string[] = [];
  lines.push(`Date range: last ${days} days.`);
  lines.push(
    `Orders: ${orders.totalOrders} total, ${orders.completedOrders} completed, ${orders.cancelledOrders} cancelled, ${orders.noShowOrders} no-show.`,
  );
  lines.push(
    `Revenue (non-cancelled): ${money(orders.grossMinorUnits)}; average order ${money(orders.avgOrderMinorUnits)}; avg items/order ${orders.avgItemsPerOrder.toFixed(1)}.`,
  );
  if (orders.topProducts.length) {
    lines.push(
      `Top products: ${orders.topProducts.slice(0, 5).map((p) => `${p.label} (${p.value})`).join(", ")}.`,
    );
  }
  if (orders.topBrands.length) {
    lines.push(
      `Top brands: ${orders.topBrands.slice(0, 5).map((b) => `${b.label} (${b.value})`).join(", ")}.`,
    );
  }
  lines.push(
    `Loyalty signups: ${loyalty.total} (${loyalty.newCount} new, ${loyalty.enteredCount} entered, ${loyalty.duplicateCount} duplicate, ${loyalty.dedupeFlagged} flagged as possible duplicates).`,
  );
  if (inventory.hasPublishedMenu) {
    lines.push(
      `Inventory health: ${inventory.totalItems} items / ${inventory.totalVariants} variants; ${inventory.outOfStock} out of stock; ${inventory.lowStock} low stock; ${inventory.zeroPrice} priced at $0; ${inventory.missingDescription} missing descriptions; ${inventory.missingBrand} missing brand; ${inventory.hiddenItems} hidden; ${inventory.suspiciousPotency} suspicious potency.`,
    );
  } else {
    lines.push("Inventory health: no published menu yet.");
  }
  lines.push(
    `Promotions: ${promotions.total} total (${promotions.published} live, ${promotions.draft} draft, ${promotions.scheduled} scheduled, ${promotions.archived} archived).`,
  );
  return lines.join("\n");
}

/**
 * Generate an AI insights briefing from the structured reports. Throws
 * AiNotConfiguredError when no key is set.
 */
export async function generateReportInsights(
  input: {
    days: number;
    orders: OrdersReport;
    loyalty: LoyaltyReport;
    inventory: InventoryHealthReport;
    promotions: PromotionsReport;
  },
  context?: Omit<AiContext, "feature">,
): Promise<ReportInsights> {
  const user = [
    buildDigest(input),
    "",
    'Return ONLY a JSON object: {"headline": string, "wins": string[], "watchouts": string[], "actions": string[]}.',
    "headline: one or two sentences. wins/watchouts: up to 4 short bullets each (omit if none). actions: 2-3 concrete, doable next steps. No prose outside the JSON.",
  ].join("\n");

  const raw = await generateJSON<RawInsights>({
    system: SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 600,
    context: {
      feature: "reports.insights",
      entityType: "report",
      ...context,
    },
  });

  return {
    headline: typeof raw?.headline === "string" ? raw.headline.trim() : "",
    wins: strArray(raw?.wins, 4),
    watchouts: strArray(raw?.watchouts, 4),
    actions: strArray(raw?.actions, 3),
    model: aiModelId,
  };
}
