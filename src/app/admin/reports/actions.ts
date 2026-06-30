"use server";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import {
  getOrdersReport,
  getLoyaltyReport,
  getInventoryHealthReport,
  getPromotionsReport,
} from "@/lib/reports/analytics";
import { getSalesReport } from "@/lib/reports/sales";
import { getCogsReport } from "@/lib/reports/cogs";
import { getWaTaxReport } from "@/lib/reports/wa-tax";
import { getCustomersReport } from "@/lib/reports/customers";
import { getEmployeeReport, getMedicalReport } from "@/lib/reports/operations";
import { resolveRange } from "@/lib/reports/range";
import {
  generateReportInsights,
  isAiConfigured,
  type ReportInsights,
} from "@/lib/reports/ai-insights";

export type ReportInsightsResult =
  | { ok: true; insights: ReportInsights }
  | { ok: false; error: string };

/**
 * Generate a plain-language AI briefing that spans the WHOLE reporting suite
 * (sales, profitability/COGS, tax, customers, loyalty, inventory, promotions,
 * staffing, and the medical program) for the chosen range. Read-only /
 * advisory — it re-reads the same aggregate analytics the report tabs render
 * and summarizes them. Gated on reports.view. Drafts-only spirit: it informs,
 * it never changes anything.
 *
 * Accepts the same range params the report pages use (from/to/range/year) so
 * the briefing honors the Slice 43 presets (this year, last year, by quarter,
 * etc.). A bare number is still accepted for backwards compatibility (rolling
 * days from the overview page).
 */
export async function generateReportInsightsAction(
  arg: number | { from?: string; to?: string; range?: string; year?: string },
): Promise<ReportInsightsResult> {
  const session = await requirePermission("reports.view");

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable AI insights. The charts and tables above work without it.",
    };
  }

  const sp = typeof arg === "number" ? { range: String(arg) } : arg;
  const range = resolveRange(sp);

  try {
    const [orders, loyalty, inventory, promotions, sales, cogs, tax, customers, employees, medical] =
      await Promise.all([
        getOrdersReport(range.days),
        getLoyaltyReport(range.days),
        getInventoryHealthReport(),
        getPromotionsReport(),
        getSalesReport(range.fromISO, range.toISO),
        getCogsReport(range.fromISO, range.toISO),
        getWaTaxReport(range.fromISO, range.toISO),
        getCustomersReport(range.fromISO, range.toISO),
        getEmployeeReport(range.fromDate, range.toDate),
        getMedicalReport(range.fromDate, range.toDate),
      ]);

    const insights = await generateReportInsights(
      {
        days: range.days,
        label: range.label,
        orders,
        loyalty,
        inventory,
        promotions,
        sales,
        cogs,
        tax,
        customers,
        employees,
        medical,
      },
      { actorId: session.userId, actorEmail: session.email },
    );

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "reports.ai_insights",
      entityType: "report",
      after: { model: insights.model, range: range.label, days: range.days },
    });

    return { ok: true, insights };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "AI request failed. Please try again.";
    return { ok: false, error: message };
  }
}
