"use client";

/**
 * src/components/admin/ai/AiUsageCharts.tsx
 *
 * Client-side interactive charts for the AI usage dashboard, built on the
 * shared chart kit. Receives already-aggregated, serializable data from the
 * server page.
 */
import { AreaChart, CHART_COLORS, DonutChart, type DonutDatum, paletteAt } from "@/components/admin/charts";

function shortDay(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function AiTokensTrend({
  byDay,
}: {
  byDay: { date: string; calls: number; tokens: number }[];
}) {
  const data = byDay.map((p) => ({ name: shortDay(p.date), Tokens: p.tokens, Calls: p.calls }));
  return (
    <AreaChart
      data={data}
      areas={[{ key: "Tokens", label: "Tokens", color: CHART_COLORS.green }]}
      xKey="name"
      title="Tokens used per day"
      subtitle="Estimated unless your provider reports exact usage"
      height={220}
    />
  );
}

export function AiFeatureDonut({
  byFeature,
}: {
  byFeature: { feature: string; calls: number; tokens: number }[];
}) {
  const top = byFeature.slice(0, 8);
  const segments: DonutDatum[] = top.map((f, i) => ({
    name: f.feature,
    value: f.tokens,
    color: paletteAt(i),
  }));
  return <DonutChart data={segments} title="Tokens by feature" height={240} />;
}

/** AI-$: dollars per Pacific day (cents in, dollars drawn - the display boundary, rule 8). */
export function AiSpendTrend({ byDay }: { byDay: { date: string; cents: number; calls: number }[] }) {
  const data = byDay.map((p) => ({ name: shortDay(p.date), Dollars: Math.round(p.cents) / 100 }));
  return (
    <AreaChart
      data={data}
      areas={[{ key: "Dollars", label: "Dollars", color: CHART_COLORS.gold }]}
      xKey="name"
      title="Dollars spent per day"
      subtitle="Pacific days. Vendor-reported cost where we have it, list price otherwise"
      height={220}
    />
  );
}

/** AI-$: dollars by provider. */
export function AiSpendDonut({ byProvider }: { byProvider: { key: string; cents: number }[] }) {
  const segments: DonutDatum[] = byProvider
    .filter((p) => p.cents > 0)
    .slice(0, 8)
    .map((p, i) => ({ name: p.key, value: Math.round(p.cents) / 100, color: paletteAt(i) }));
  return <DonutChart data={segments} title="Dollars by provider" height={240} />;
}
