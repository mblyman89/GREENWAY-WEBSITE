"use server";

import { requirePermission } from "@/lib/auth/session";
import { recordAudit } from "@/lib/auth/audit";
import { getForecastBundle } from "@/lib/reports/forecast";
import { can } from "@/lib/auth/roles";
import { parseForecastSource } from "@/lib/reports/forecast-source-core";
import {
  generateForecastInsights,
  isAiConfigured,
  type ForecastInsights,
} from "@/lib/reports/forecast-ai";

export type ForecastInsightsResult =
  | { ok: true; insights: ForecastInsights }
  | { ok: false; error: string };

/**
 * Generate the AI forecast outlook for the chosen horizon. Read-only / advisory
 * — it re-reads the same statistical forecast the page renders and narrates it.
 * Gated on reports.view. Drafts-only spirit: it informs, it never changes
 * anything.
 */
export async function generateForecastInsightsAction(
  horizon: number,
  sourceRaw: string = "greenway",
): Promise<ForecastInsightsResult> {
  const session = await requirePermission("reports.view");
  // CVB-9: the Cultivera choices are owner-only (cultivera.benchmark); anyone else gets Greenway only.
  const source = parseForecastSource(sourceRaw, can(session.profile.role, "cultivera.benchmark"));

  if (!isAiConfigured) {
    return {
      ok: false,
      error:
        "AI isn't set up yet. Add an AI_API_KEY in your environment to enable the AI outlook. The forecast charts and accuracy grade above work without it.",
    };
  }

  const h = [7, 14, 30].includes(horizon) ? horizon : 14;

  try {
    const bundle = await getForecastBundle(h, 180, source);
    if (!bundle.hasData) {
      return {
        ok: false,
        error:
          "Not enough sales history yet to forecast. Once the store has a few weeks of orders, the AI outlook will turn on.",
      };
    }

    const insights = await generateForecastInsights(bundle, {
      actorId: session.userId,
      actorEmail: session.email,
    });

    await recordAudit({
      actorId: session.userId,
      actorEmail: session.email,
      action: "reports.forecast_insights",
      entityType: "forecast",
      after: { model: insights.model, horizon: h, source: bundle.source.source, sourceNote: bundle.source.note },
    });

    return { ok: true, insights };
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed. Please try again.";
    return { ok: false, error: message };
  }
}
