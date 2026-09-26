"use client";

/**
 * src/components/admin/reports/OnlineOrdersChannelCharts.tsx
 *
 * Interactive (hover-tooltip) charts for the Online Orders report, comparing
 * the two online channels: our own website and Leafly.
 *
 * Client component (Recharts needs the browser). Every number arrives
 * pre-computed from `buildOnlineChannelsReport` on the server — this file does
 * no arithmetic beyond cents -> dollars for the axis, and no fetching.
 *
 * Colour rule, used everywhere on the page: Website = brand green,
 * Leafly = purple. The same two colours in every chart so the eye never has to
 * re-read a legend.
 */
import {
  AreaChart,
  BarChart,
  DonutChart,
  CHART_COLORS,
  type DonutDatum,
} from "@/components/admin/charts";

export const WEBSITE_COLOR = CHART_COLORS.green;
export const LEAFLY_COLOR = "#b07cff";

export type ChannelDailyPoint = {
  date: string;
  websiteOrders: number;
  leaflyOrders: number;
  websiteValueMinor: number;
  leaflyValueMinor: number;
};

export type ChannelHourPoint = { hour: number; website: number; leafly: number };
export type ChannelWeekdayPoint = { label: string; website: number; leafly: number };
export type ChannelOutcomePoint = { outcome: string; website: number; leafly: number };

/** "2026-03-04" -> "3/4". */
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}

/** 0 -> "12a", 13 -> "1p". */
function hourLabel(h: number): string {
  const suffix = h < 12 ? "a" : "p";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

/** Cents -> dollars, rounded to the cent, for chart axes only. */
function dollars(minor: number): number {
  return Math.round(minor) / 100;
}

const SERIES = [
  { key: "Website", label: "Website", color: WEBSITE_COLOR },
  { key: "Leafly", label: "Leafly", color: LEAFLY_COLOR },
];

export function OnlineOrdersDailyCharts({ daily }: { daily: ChannelDailyPoint[] }) {
  const orders = daily.map((d) => ({
    name: shortDay(d.date),
    Website: d.websiteOrders,
    Leafly: d.leaflyOrders,
  }));
  const value = daily.map((d) => ({
    name: shortDay(d.date),
    Website: dollars(d.websiteValueMinor),
    Leafly: dollars(d.leaflyValueMinor),
  }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <BarChart
        title="Online orders per day"
        subtitle="Stacked by channel — hover for exact counts"
        data={orders}
        bars={SERIES}
        stacked
        height={240}
      />
      <AreaChart
        title="Known order value per day ($)"
        subtitle="Only orders whose total we know are counted"
        data={value}
        areas={SERIES}
        stacked
        height={240}
      />
    </div>
  );
}

export function OnlineOrdersShareDonuts({
  websiteOrders,
  leaflyOrders,
  websiteValueMinor,
  leaflyValueMinor,
}: {
  websiteOrders: number;
  leaflyOrders: number;
  websiteValueMinor: number;
  leaflyValueMinor: number;
}) {
  const orderData: DonutDatum[] = [
    { name: "Website", value: websiteOrders, color: WEBSITE_COLOR },
    { name: "Leafly", value: leaflyOrders, color: LEAFLY_COLOR },
  ];
  const valueData: DonutDatum[] = [
    { name: "Website ($)", value: dollars(websiteValueMinor), color: WEBSITE_COLOR },
    { name: "Leafly ($)", value: dollars(leaflyValueMinor), color: LEAFLY_COLOR },
  ];
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <DonutChart title="Share of orders" data={orderData} height={240} />
      <DonutChart title="Share of known value" data={valueData} height={240} />
    </div>
  );
}

export function OnlineOrdersOutcomeChart({ outcomes }: { outcomes: ChannelOutcomePoint[] }) {
  const data = outcomes.map((o) => ({ name: o.outcome, Website: o.website, Leafly: o.leafly }));
  return (
    <BarChart
      title="How the orders ended"
      subtitle="Side by side, per channel"
      data={data}
      bars={SERIES}
      height={260}
    />
  );
}

export function OnlineOrdersTimingCharts({
  byHour,
  byWeekday,
}: {
  byHour: ChannelHourPoint[];
  byWeekday: ChannelWeekdayPoint[];
}) {
  const hours = byHour.map((h) => ({ name: hourLabel(h.hour), Website: h.website, Leafly: h.leafly }));
  const days = byWeekday.map((d) => ({ name: d.label, Website: d.website, Leafly: d.leafly }));
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <BarChart
        title="When orders are placed (hour, Pacific)"
        subtitle="Useful for staffing the pickup counter"
        data={hours}
        bars={SERIES}
        stacked
        height={240}
      />
      <BarChart
        title="Orders by day of week"
        data={days}
        bars={SERIES}
        stacked
        height={240}
      />
    </div>
  );
}
