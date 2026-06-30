"use server";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { resolveRange } from "@/lib/reports/range";
import { getCogsReport } from "@/lib/reports/cogs";
import {
  generateMissingCostInsights,
  isAiConfigured,
  type MissingCostInsights,
} from "@/lib/reports/cogs-ai";

export type MissingCostInsightsResult =
  | { ok: true; insights: MissingCostInsights }
  | { ok: false; error: string };

/**
 * AI assistant for the "products sold with no COGS info" table. Re-reads the
 * COGS report for the same window the page is showing, then asks the model to
 * explain WHY cost is missing and HOW to fix it. Read-only / advisory — it never
 * changes inventory or orders. Gated on reports.view.
 */
export async function generateMissingCostInsightsAction(
  arg: number | { from?: string; to?: string; range?: string; year?: string },
): Promise<MissingCostInsightsResult> {
  const session = await requirePermission("reports.view");

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable the assistant. The missing-cost table and the per-row reasons above work without it.",
    };
  }

  const sp = typeof arg === "number" ? { range: String(arg) } : arg;
  const range = resolveRange(sp);

  try {
    const report = await getCogsReport(range.fromISO, range.toISO);
    if (report.missingCost.length === 0) {
      return {
        ok: false,
        error: "No products are missing cost in this window — nothing to diagnose. 🎉",
      };
    }

    const insights = await generateMissingCostInsights(report, {
      actorId: session.userId,
      actorEmail: session.email,
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "reports.cogs_missing_cost_insights",
      entityType: "cogs-report",
      after: {
        model: insights.model,
        products: report.missingCost.length,
        revenueMinorUnits: report.missingCostRevenueMinorUnits,
        range: range.label,
      },
    });

    return { ok: true, insights };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed. Please try again.";
    return { ok: false, error: message };
  }
}
