"use client";

/**
 * src/components/admin/ai/AiUsageCharts.tsx
 *
 * Client-side interactive charts for the AI usage dashboard, built on the
 * shared chart kit. Receives already-aggregated, serializable data from the
 * server page.
 */
import { AreaChart, DonutChart, type DonutDatum, paletteAt } from "@/components/admin/charts";

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
      areas={[{ key: "Tokens", label: "Tokens", color: "#7ed957" }]}
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
