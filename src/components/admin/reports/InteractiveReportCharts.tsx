"use client";

/**
 * src/components/admin/reports/InteractiveReportCharts.tsx
 *
 * Interactive (hover-tooltip) Recharts versions of the key report visuals,
 * built on the shared admin chart wrapper (@/components/admin/charts) so they
 * inherit brand colors/axes/tooltips. The static CSS BarLists + CSV export are
 * kept as-is elsewhere; this upgrades the time-series + status breakdowns to
 * real interactive charts.
 *
 * Client component (Recharts needs the browser). Data is passed in pre-computed
 * from the server page — no fetching here.
 */
import { AreaChart, DonutChart, type DonutDatum } from "@/components/admin/charts";

type DayPoint = { date: string; value: number };

/** Shorten an ISO date (YYYY-MM-DD) to "M/D" for compact x-axis labels. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

export function OrdersTrendChart({
  ordersByDay,
  revenueByDayMajor,
}: {
  ordersByDay: DayPoint[];
  revenueByDayMajor: DayPoint[];
}) {
  const orderData = ordersByDay.map((p) => ({ name: shortDay(p.date), Orders: p.value }));
  const revData = revenueByDayMajor.map((p) => ({ name: shortDay(p.date), Revenue: p.value }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <AreaChart
        title="Orders per day"
        subtitle="Hover any point for the exact count"
        data={orderData}
        areas={[{ key: "Orders", label: "Orders", color: "#7ed957" }]}
        height={220}
      />
      <AreaChart
        title="Revenue per day ($)"
        subtitle="Gross revenue, non-cancelled orders"
        data={revData}
        areas={[{ key: "Revenue", label: "Revenue ($)", color: "#ffd700" }]}
        height={220}
      />
    </div>
  );
}

export function LoyaltyTrendChart({ signupsByDay }: { signupsByDay: DayPoint[] }) {
  const data = signupsByDay.map((p) => ({ name: shortDay(p.date), Signups: p.value }));
  return (
    <AreaChart
      title="Signups per day"
      data={data}
      areas={[{ key: "Signups", label: "Signups", color: "#7ed957" }]}
      height={200}
    />
  );
}

export function StatusDonut({
  title,
  segments,
}: {
  title?: string;
  segments: DonutDatum[];
}) {
  const nonZero = segments.filter((s) => s.value > 0);
  return <DonutChart title={title} data={nonZero.length ? nonZero : segments} height={240} />;
}
