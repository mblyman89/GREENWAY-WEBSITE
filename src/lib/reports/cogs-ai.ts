import "server-only";

/**
 * src/lib/reports/cogs-ai.ts  (Slice 48)
 *
 * AI assistant for the "products sold with no COGS info" table on the COGS
 * report. It is fed the ALREADY-DIAGNOSED missing-cost rows (each carries a
 * best-effort reason produced by the deterministic builder in cogs.ts) and asked
 * to explain, in plain language for a non-technical owner, WHY the cost is
 * missing and exactly HOW to fix it inside the back office. It never invents
 * product data or dollar figures; it interprets the rows it is given. Advisory /
 * drafts-only.
 *
 * Money in MINOR UNITS (cents).
 */

import { generateJSON, isAiConfigured, aiModelId, type AiContext } from "@/lib/ai/provider";
import type { CogsReport, MissingCostRow } from "@/lib/reports/cogs";

export { isAiConfigured };

const SYSTEM = [
  "You are a meticulous inventory & accounting assistant for a licensed Washington State cannabis dispensary (Greenway Marijuana).",
  "Your job: explain why certain SOLD products have NO cost-of-goods-sold (COGS) recorded, and give the owner concrete, doable steps to fix each cause.",
  "Background on how cost is resolved in this system: each order line carries a product_id. Inventory is received as 'lots' in the inventory_lots table, keyed by pos_product_key, each with a unit_cost_minor_units. A product's cost is the weighted-average unit cost across its lots. If an order line has no product_id, or no inventory lot matches its product key, or the matching lot has an empty unit cost, then COGS resolves to $0 and gross profit is overstated.",
  "Common root causes: (1) the product was sold off-catalog / from a legacy import with no product_id; (2) inventory was received outside this system so no lot exists; (3) a lot exists but the buyer never entered a unit cost at intake; (4) the order's product_id does not match the lot's pos_product_key (key mismatch).",
  "Group similar causes together. Tie each recommended fix to the specific reason. Reference the actual product names and reasons you were given \u2014 never invent products, costs, or figures.",
  "Be practical for a small store: the fixes are things like 'open the inventory lot and enter the unit cost', 'create a lot for this product and backfill cost', or 'check that the POS product key matches'. Do not give legal or medical advice.",
].join("\n");

export type MissingCostInsights = {
  summary: string;
  /** Grouped causes with how many products / how much revenue each represents. */
  causes: { cause: string; impact: string; fix: string }[];
  /** Ordered, concrete next steps for the owner. */
  steps: string[];
  model: string;
};

type Raw = { summary?: unknown; causes?: unknown; steps?: unknown };

function strArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim())
    .slice(0, max);
}

type RawCause = { cause?: unknown; impact?: unknown; fix?: unknown };
function causeArray(v: unknown, max = 6): { cause: string; impact: string; fix: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is RawCause => !!x && typeof x === "object")
    .map((x) => ({
      cause: typeof x.cause === "string" ? x.cause.trim() : "",
      impact: typeof x.impact === "string" ? x.impact.trim() : "",
      fix: typeof x.fix === "string" ? x.fix.trim() : "",
    }))
    .filter((c) => c.cause.length > 0)
    .slice(0, max);
}

function money(minor: number): string {
  return `$${(minor / 100).toFixed(2)}`;
}

/** Build a compact digest of the missing-cost rows for the model. */
function buildDigest(report: CogsReport): string {
  const rows: MissingCostRow[] = report.missingCost;
  const lines: string[] = [];
  lines.push(
    `Total: ${rows.length} distinct products sold with no resolved cost, covering ${report.missingCostUnits} units and ${money(
      report.missingCostRevenueMinorUnits,
    )} of revenue (their gross profit is currently overstated because COGS = $0).`,
  );

  // Tally by reason so the model can group.
  const byReason = new Map<string, { products: number; units: number; revenue: number }>();
  for (const r of rows) {
    const agg = byReason.get(r.reason) ?? { products: 0, units: 0, revenue: 0 };
    agg.products += 1;
    agg.units += r.units;
    agg.revenue += r.revenueMinorUnits;
    byReason.set(r.reason, agg);
  }
  lines.push("By reason:");
  for (const [reason, agg] of [...byReason.entries()].sort((a, b) => b[1].revenue - a[1].revenue)) {
    lines.push(`  - "${reason}" \u2014 ${agg.products} products, ${agg.units} units, ${money(agg.revenue)} revenue.`);
  }

  // Top offenders by revenue so the model can name specifics.
  const top = rows.slice(0, 15);
  lines.push("Top products with missing cost (by revenue):");
  for (const r of top) {
    lines.push(`  - ${r.productName} (id ${r.productId}): ${r.units} units, ${money(r.revenueMinorUnits)}. Reason: ${r.reason}`);
  }
  return lines.join("\n");
}

/**
 * Generate the plain-language explanation + fix plan for the no-COGS table.
 * Throws AiNotConfiguredError when no key is set. Returns an empty-ish result
 * (no causes) is impossible \u2014 caller should guard on report.missingCost.length.
 */
export async function generateMissingCostInsights(
  report: CogsReport,
  context?: Omit<AiContext, "feature">,
): Promise<MissingCostInsights> {
  const user = [
    buildDigest(report),
    "",
    'Return ONLY a JSON object: {"summary": string, "causes": [{"cause": string, "impact": string, "fix": string}], "steps": string[]}.',
    "summary: one or two sentences framing the problem and its size. causes: group the rows by root cause (use the reasons given); for each, 'impact' states how many products / how much revenue it affects (use the numbers given), and 'fix' is the specific action to resolve it in the back office. steps: 3-5 concrete, ordered next steps the owner can take today. No prose outside the JSON.",
  ].join("\n");

  const raw = await generateJSON<Raw>({
    system: SYSTEM,
    user,
    temperature: 0.3,
    maxTokens: 800,
    context: {
      feature: "reports.cogs.missing-cost",
      entityType: "cogs-report",
      ...context,
    },
  });

  return {
    summary: typeof raw?.summary === "string" ? raw.summary.trim() : "",
    causes: causeArray(raw?.causes, 6),
    steps: strArray(raw?.steps, 6),
    model: aiModelId,
  };
}
