"use client";

/**
 * src/components/admin/customers/CustomerCharts.tsx  (Slice 3)
 *
 * Hover-tooltip charts for the customer profile and the customer intelligence
 * dashboard. Every number arrives pre-computed by the pure cores on the
 * server — this file only converts cents to dollars for the axis.
 */
import { AreaChart, BarChart, DonutChart, CHART_COLORS, CHART_PALETTE, type DonutDatum } from "@/components/admin/charts";

function dollars(minor: number): number {
  return Math.round(minor) / 100;
}

export type MonthPointView = { label: string; spendMinor: number; visits: number };

export function CustomerMonthlyChart({ monthly }: { monthly: MonthPointView[] }) {
  const data = monthly.map((m) => ({ name: m.label, Spend: dollars(m.spendMinor), Visits: m.visits }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <AreaChart
        title="Spend by month ($)"
        subtitle="Last 12 months, Pacific time"
        data={data}
        areas={[{ key: "Spend", label: "Spend", color: CHART_COLORS.green }]}
        height={220}
        showLegend={false}
      />
      <BarChart
        title="Visits by month"
        subtitle="Completed purchases"
        data={data}
        bars={[{ key: "Visits", label: "Visits", color: CHART_COLORS.gold }]}
        height={220}
        showLegend={false}
      />
    </div>
  );
}

export function CustomerHabitCharts({
  weekdays,
  dayparts,
}: {
  weekdays: { label: string; visits: number }[];
  dayparts: { label: string; visits: number }[];
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <BarChart
        title="Which days they shop"
        data={weekdays.map((w) => ({ name: w.label.slice(0, 3), Visits: w.visits }))}
        bars={[{ key: "Visits", label: "Visits", color: CHART_COLORS.green }]}
        height={200}
        showLegend={false}
      />
      <BarChart
        title="Time of day"
        subtitle="Morning before noon · Afternoon noon–5pm · Evening after 5pm"
        data={dayparts.map((d) => ({ name: d.label, Visits: d.visits }))}
        bars={[{ key: "Visits", label: "Visits", color: CHART_COLORS.gold }]}
        height={200}
        showLegend={false}
      />
    </div>
  );
}

export function SpendShareDonut({ title, subtitle, rows }: { title: string; subtitle?: string; rows: { label: string; spendMinor: number }[] }) {
  const data: DonutDatum[] = rows
    .filter((r) => r.spendMinor > 0)
    .map((r, i) => ({ name: r.label, value: dollars(r.spendMinor), color: CHART_PALETTE[i % CHART_PALETTE.length] }));
  if (data.length === 0) return null;
  return <DonutChart title={title} subtitle={subtitle} data={data} height={240} />;
}

const TONE_COLOR: Record<string, string> = {
  green: CHART_COLORS.green,
  gold: CHART_COLORS.gold,
  orange: CHART_COLORS.orange,
  danger: "#ff5a5a",
  neutral: "rgba(255,255,255,0.45)",
};

export function SegmentCharts({ segments }: { segments: { label: string; customers: number; netSpendMinor: number; tone: string }[] }) {
  const rows = segments.filter((s) => s.customers > 0);
  if (rows.length === 0) return null;
  const people: DonutDatum[] = rows.map((s) => ({ name: s.label, value: s.customers, color: TONE_COLOR[s.tone] ?? CHART_COLORS.muted }));
  const spend = rows.map((s) => ({ name: s.label, Spend: dollars(s.netSpendMinor) }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <DonutChart title="Customers by segment" subtitle="Hover a slice for the count" data={people} height={260} />
      <BarChart
        title="Spend by segment ($)"
        subtitle="Where your money comes from"
        data={spend}
        bars={[{ key: "Spend", label: "Spend", color: CHART_COLORS.green }]}
        height={260}
        showLegend={false}
      />
    </div>
  );
}
