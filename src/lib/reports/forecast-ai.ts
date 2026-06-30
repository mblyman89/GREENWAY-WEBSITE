import "server-only";

/**
 * src/lib/reports/forecast-ai.ts  (Slice 45)
 *
 * AI narration layer for the demand forecaster. It is fed the OUTPUT of the
 * statistical model (forecast-core) — point forecasts, intervals, day-of-week
 * pattern, trend, and the backtest accuracy — and asked to translate it into a
 * plain-language outlook plus concrete, doable actions (staffing, ordering,
 * promotions). It NEVER invents numbers; it interprets the ones it is given and
 * is explicit about uncertainty. Advisory / drafts-only.
 */

import { generateJSON, isAiConfigured, aiModelId, type AiContext } from "@/lib/ai/provider";
import { describeWeeklyPattern, type ForecastBundle } from "@/lib/reports/forecast";

export { isAiConfigured };

const SYSTEM = [
  "You are an expert retail demand-planning analyst for a licensed Washington State cannabis dispensary (Greenway Marijuana).",
  "You are given the OUTPUT of a statistical forecast model (trend + weekly seasonality decomposition) including point forecasts, prediction intervals, day-of-week patterns, and a backtest accuracy grade.",
  "Translate it into a short, confident-but-honest outlook for a non-technical owner. Reference the actual numbers you were given — never invent figures.",
  "Always communicate UNCERTAINTY: a forecast is a range, not a promise. If the backtest accuracy is weak or history is thin, say so plainly and advise caution.",
  "Recommend concrete operational actions tied to the pattern: staffing on the busiest days, ordering/par levels ahead of peaks, and promotion timing on quiet days. Keep it practical for a small store.",
  "Do not make medical claims, do not give legal advice, and do not mention individual customers.",
].join("\n");

export type ForecastInsights = {
  headline: string;
  outlook: string[]; // what to expect
  watchouts: string[]; // uncertainty / risks
  actions: string[]; // concrete next steps
  model: string;
};

type Raw = { headline?: unknown; outlook?: unknown; watchouts?: unknown; actions?: unknown };

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

function gradeWord(grade: string): string {
  switch (grade) {
    case "excellent":
      return "excellent (typically within ~10%)";
    case "good":
      return "good (typically within ~20%)";
    case "fair":
      return "fair (typically within ~35%)";
    case "weak":
      return "weak (errors above ~35% — treat as a rough guide)";
    default:
      return "insufficient history to grade";
  }
}

function buildDigest(bundle: ForecastBundle): string {
  const lines: string[] = [];
  lines.push(`Forecast horizon: next ${bundle.horizon} days. History used: up to ${bundle.lookbackDays} days.`);

  const rev = bundle.revenue;
  if (rev.hasForecast) {
    const pattern = describeWeeklyPattern(rev.dowIndex);
    const trendDir = rev.trendPerDay > 0 ? "rising" : rev.trendPerDay < 0 ? "declining" : "flat";
    lines.push(
      `Revenue: projected ${money(rev.horizonTotal)} over the next ${bundle.horizon} days (80% range ${money(
        rev.points.reduce((a, p) => a + p.lower80, 0),
      )}–${money(rev.points.reduce((a, p) => a + p.upper80, 0))}). Underlying trend is ${trendDir}.`,
    );
    lines.push(`Weekly pattern (revenue): busiest day is ${pattern.busiest}, quietest is ${pattern.quietest}.`);
    lines.push(`Forecast accuracy (revenue backtest): ${gradeWord(rev.accuracy.grade)}${rev.accuracy.mape !== null ? ` — MAPE ${(rev.accuracy.mape * 100).toFixed(1)}%` : ""}.`);
    // First-week day-by-day so the AI can call out specific days.
    const wk = rev.points.slice(0, 7);
    lines.push(
      `Next 7 days (revenue mean): ${wk.map((p) => `${p.date} ${money(p.mean)}`).join("; ")}.`,
    );
  } else {
    lines.push(`Revenue: ${rev.note ?? "no forecast available."}`);
  }

  const ord = bundle.orders;
  if (ord.hasForecast) {
    lines.push(
      `Orders: projected ${Math.round(ord.horizonTotal)} over the next ${bundle.horizon} days (≈${(
        ord.horizonTotal / bundle.horizon
      ).toFixed(1)}/day).`,
    );
  }
  const uni = bundle.units;
  if (uni.hasForecast) {
    lines.push(`Units sold: projected ${Math.round(uni.horizonTotal)} over the next ${bundle.horizon} days.`);
  }

  return lines.join("\n");
}

/**
 * Generate the AI outlook for a forecast bundle. Throws AiNotConfiguredError
 * when no key is set.
 */
export async function generateForecastInsights(
  bundle: ForecastBundle,
  context?: Omit<AiContext, "feature">,
): Promise<ForecastInsights> {
  const user = [
    buildDigest(bundle),
    "",
    'Return ONLY a JSON object: {"headline": string, "outlook": string[], "watchouts": string[], "actions": string[]}.',
    "headline: one or two sentences summarizing the outlook. outlook: up to 4 short bullets on what to expect (call out specific busy/quiet days). watchouts: up to 3 bullets on uncertainty/risk (be honest about the accuracy grade). actions: 2-3 concrete next steps (staffing, ordering, promotions). No prose outside the JSON.",
  ].join("\n");

  const raw = await generateJSON<Raw>({
    system: SYSTEM,
    user,
    temperature: 0.4,
    maxTokens: 700,
    context: {
      feature: "reports.forecast",
      entityType: "forecast",
      ...context,
    },
  });

  return {
    headline: typeof raw?.headline === "string" ? raw.headline.trim() : "",
    outlook: strArray(raw?.outlook, 4),
    watchouts: strArray(raw?.watchouts, 3),
    actions: strArray(raw?.actions, 3),
    model: aiModelId,
  };
}
