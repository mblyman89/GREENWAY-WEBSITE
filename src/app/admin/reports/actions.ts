"use server";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  getOrdersReport,
  getLoyaltyReport,
  getInventoryHealthReport,
  getPromotionsReport,
} from "@/lib/reports/analytics";
import {
  generateReportInsights,
  isAiConfigured,
  type ReportInsights,
} from "@/lib/reports/ai-insights";

export type ReportInsightsResult =
  | { ok: true; insights: ReportInsights }
  | { ok: false; error: string };

/**
 * Generate a plain-language AI briefing for the current reports range.
 * Read-only / advisory — it re-reads the same aggregate analytics the page
 * renders and summarizes them. Gated on reports.view. Drafts-only spirit: it
 * informs, it never changes anything.
 */
export async function generateReportInsightsAction(
  days: number,
): Promise<ReportInsightsResult> {
  const session = await requirePermission("reports.view");

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable AI insights. The charts and tables above work without it.",
    };
  }

  const range = [7, 30, 90].includes(days) ? days : 30;

  try {
    const [orders, loyalty, inventory, promotions] = await Promise.all([
      getOrdersReport(range),
      getLoyaltyReport(range),
      getInventoryHealthReport(),
      getPromotionsReport(),
    ]);

    const insights = await generateReportInsights(
      { days: range, orders, loyalty, inventory, promotions },
      { actorId: session.userId, actorEmail: session.email },
    );

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "reports.ai_insights",
      entityType: "report",
      after: { model: insights.model, days: range },
    });

    return { ok: true, insights };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI request failed. Please try again.";
    return { ok: false, error: message };
  }
}
