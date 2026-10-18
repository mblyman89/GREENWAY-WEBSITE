/**
 * R73 S8 - Reports > Merch (PURE: no fetch, no env).
 *
 * Michael, verbatim: "The reports page should have a new tab for merch data,
 * everything merch related including website traffic stats, sales stats for
 * merch, tax info."
 *
 * SALES + TAX come from Printful orders (the merch order record; S1). Only
 * OUR orders count (external_id is a gm- ref written by greenwaymerch.com);
 * cancelled and failed orders are not sales (same rule as Merch Inventory).
 * "paid" is retail_costs, which greenwaymerch.com fills from the Stripe
 * Checkout Session (subtotal, discount, shipping, tax, total), so the tax
 * figure is exactly what the customer was charged. Washington sales tax is
 * based on where the order is delivered, so tax is also grouped by delivery
 * city + ZIP to help match WA DOR location codes when filing.
 *
 * TRAFFIC comes from Vercel Web Analytics on greenwaymerch.com, read with
 * Vercel's Web Analytics query API (GET /v1/query/web-analytics/visits/aggregate,
 * documented at vercel.com/docs/analytics/web-analytics-api). Cookieless;
 * visitors are a request hash discarded after 24 hours (Vercel docs).
 */
import { NOT_A_SALE } from "./merch-inventory-core";

// ============================================================================
// SALES
// ============================================================================

export interface ReportMoney { subtotal: number | null; discount: number | null; shipping: number | null; tax: number | null; total: number | null }
export interface ReportOrderLike {
  ours: boolean;
  printfulStatus: string;
  placedAt: string;
  itemCount: number;
  items: { name: string; quantity: number; retailCents: number | null }[];
  paid: ReportMoney;
  cost: ReportMoney;
  address: { city: string; state: string; zip: string };
}

export interface MerchSalesTotals {
  orders: number;
  units: number;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
  /** what Printful charges the LLC (costs.total), for orders where it is known */
  printfulCostCents: number;
  /** total paid - Printful cost, only over orders where both are known */
  marginCents: number;
  /** orders where Printful has not priced the order yet (cost unknown) */
  costUnknown: number;
  /** orders with no tax amount from Printful (never counted as $0) */
  taxUnknown: number;
  avgOrderCents: number;
}

export interface TaxMonthRow { month: string; orders: number; grossCents: number; taxCents: number; totalCents: number }
export interface TaxPlaceRow { place: string; zip: string; state: string; orders: number; grossCents: number; taxCents: number }
export interface MerchSalesReport {
  totals: MerchSalesTotals;
  byDay: { date: string; value: number }[];
  ordersByDay: { date: string; value: number }[];
  topProducts: { label: string; units: number; revenueCents: number }[];
  byStatus: { status: string; count: number }[];
  taxByMonth: TaxMonthRow[];
  taxByPlace: TaxPlaceRow[];
  /** placed inside the range but cancelled or failed (not counted above) */
  cancelled: number;
  /** our orders delivered outside WA (should be 0: the site is WA-only) */
  outOfState: number;
}

const n0 = (v: number | null) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** YYYY-MM-DD (Pacific) for an ISO instant; "" when unparseable. */
export function pacificDay(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Every Pacific day from..to inclusive (YYYY-MM-DD), capped at 400 days. */
export function daySpan(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromDate) || !re.test(toDate)) return out;
  let t = Date.UTC(+fromDate.slice(0, 4), +fromDate.slice(5, 7) - 1, +fromDate.slice(8, 10));
  const end = Date.UTC(+toDate.slice(0, 4), +toDate.slice(5, 7) - 1, +toDate.slice(8, 10));
  while (t <= end && out.length < 400) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

export function inRange(iso: string, fromISO: string, toISO: string): boolean {
  const t = Date.parse(iso);
  const a = Date.parse(fromISO);
  const b = Date.parse(toISO);
  return Number.isFinite(t) && Number.isFinite(a) && Number.isFinite(b) && t >= a && t <= b;
}

export function merchSalesReport(
  orders: readonly ReportOrderLike[],
  range: { fromISO: string; toISO: string; fromDate: string; toDate: string },
): MerchSalesReport {
  const totals: MerchSalesTotals = {
    orders: 0, units: 0, subtotalCents: 0, discountCents: 0, shippingCents: 0, taxCents: 0, totalCents: 0,
    printfulCostCents: 0, marginCents: 0, costUnknown: 0, taxUnknown: 0, avgOrderCents: 0,
  };
  const days = daySpan(range.fromDate, range.toDate);
  const rev = new Map(days.map((d) => [d, 0]));
  const cnt = new Map(days.map((d) => [d, 0]));
  const products = new Map<string, { units: number; revenueCents: number }>();
  const statuses = new Map<string, number>();
  const months = new Map<string, TaxMonthRow>();
  const places = new Map<string, TaxPlaceRow>();
  let cancelled = 0;
  let outOfState = 0;

  for (const o of orders) {
    if (!o.ours || !inRange(o.placedAt, range.fromISO, range.toISO)) continue;
    if (NOT_A_SALE.has(o.printfulStatus)) { cancelled += 1; continue; }
    statuses.set(o.printfulStatus || "unknown", (statuses.get(o.printfulStatus || "unknown") ?? 0) + 1);
    const total = n0(o.paid.total);
    const tax = n0(o.paid.tax);
    totals.orders += 1;
    totals.units += o.items.reduce((s, i) => s + i.quantity, 0);
    totals.subtotalCents += n0(o.paid.subtotal);
    totals.discountCents += n0(o.paid.discount);
    totals.shippingCents += n0(o.paid.shipping);
    totals.taxCents += tax;
    totals.totalCents += total;
    if (o.paid.tax === null) totals.taxUnknown += 1;
    if (o.cost.total === null) totals.costUnknown += 1;
    else {
      totals.printfulCostCents += o.cost.total;
      if (o.paid.total !== null) totals.marginCents += o.paid.total - o.cost.total;
    }
    if ((o.address.state || "").toUpperCase() !== "WA") outOfState += 1;

    const day = pacificDay(o.placedAt);
    if (rev.has(day)) {
      rev.set(day, (rev.get(day) ?? 0) + total);
      cnt.set(day, (cnt.get(day) ?? 0) + 1);
    }
    for (const it of o.items) {
      const p = products.get(it.name) ?? { units: 0, revenueCents: 0 };
      p.units += it.quantity;
      p.revenueCents += n0(it.retailCents) * it.quantity;
      products.set(it.name, p);
    }
    const month = day.slice(0, 7);
    const m = months.get(month) ?? { month, orders: 0, grossCents: 0, taxCents: 0, totalCents: 0 };
    m.orders += 1; m.grossCents += total - tax; m.taxCents += tax; m.totalCents += total;
    months.set(month, m);
    const city = (o.address.city || "Unknown").trim();
    const zip = (o.address.zip || "").trim().slice(0, 5);
    const key = `${city.toLowerCase()}|${zip}`;
    const pl = places.get(key) ?? { place: city, zip, state: (o.address.state || "").toUpperCase(), orders: 0, grossCents: 0, taxCents: 0 };
    pl.orders += 1; pl.grossCents += total - tax; pl.taxCents += tax;
    places.set(key, pl);
  }
  totals.avgOrderCents = totals.orders ? Math.round(totals.totalCents / totals.orders) : 0;
  return {
    totals,
    byDay: days.map((d) => ({ date: d, value: rev.get(d) ?? 0 })),
    ordersByDay: days.map((d) => ({ date: d, value: cnt.get(d) ?? 0 })),
    topProducts: [...products.entries()]
      .map(([label, p]) => ({ label, ...p }))
      .sort((a, b) => b.units - a.units || b.revenueCents - a.revenueCents)
      .slice(0, 15),
    byStatus: [...statuses.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    taxByMonth: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    taxByPlace: [...places.values()].sort((a, b) => b.taxCents - a.taxCents || a.place.localeCompare(b.place)),
    cancelled,
    outOfState,
  };
}

// ============================================================================
// TRAFFIC (Vercel Web Analytics query API)
// ============================================================================

export const VERCEL_WA_BASE = "https://api.vercel.com/v1/query/web-analytics";
export type TrafficDim = "day" | "requestPath" | "referrerHostname" | "deviceType" | "country";

/** Build a visits/aggregate URL. Values are URL-encoded; one breakdown per call. */
export function visitsAggregateUrl(p: { projectId: string; teamId?: string; since: string; until: string; by: TrafficDim; limit?: number }): string {
  const q = new URLSearchParams();
  q.set("projectId", p.projectId);
  q.set("by", p.by);
  q.set("since", p.since);
  q.set("until", p.until);
  if (p.limit) q.set("limit", String(Math.max(1, Math.min(100, Math.floor(p.limit)))));
  if (p.teamId) q.set("teamId", p.teamId);
  return `${VERCEL_WA_BASE}/visits/aggregate?${q.toString()}`;
}

export interface TrafficRow { label: string; pageviews: number; visitors: number }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** Parse a visits/aggregate response grouped by one dimension. Defensive: outside API. */
export function parseVisits(raw: unknown, by: TrafficDim): TrafficRow[] {
  const data = raw && typeof raw === "object" ? (raw as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  const out: TrafficRow[] = [];
  for (const r of data.slice(0, 400)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    let label = "";
    if (by === "day") {
      const t = typeof o.timestamp === "string" ? o.timestamp : "";
      label = /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : "";
    } else {
      const v = o[by];
      label = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) : "";
      if (!label) label = by === "referrerHostname" ? "Direct / none" : "Unknown";
    }
    if (!label) continue;
    out.push({ label, pageviews: num(o.pageviews), visitors: num(o.visitors) });
  }
  return out;
}

/** Fill every day of the range so the chart has no gaps. */
export function fillDays(rows: readonly TrafficRow[], days: readonly string[]): TrafficRow[] {
  const m = new Map(rows.map((r) => [r.label, r]));
  return days.map((d) => m.get(d) ?? { label: d, pageviews: 0, visitors: 0 });
}

/** orders / visitors as a percentage with one decimal; null when there were no visitors. */
export function conversionPct(orders: number, visitors: number): number | null {
  if (!(visitors > 0)) return null;
  return Math.round((orders / visitors) * 1000) / 10;
}

/** Spreadsheet-safe text: customer-typed values (city, names) can't start a formula. */
export function sheetText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function __runMerchReportsTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else failures.push(m); };
  const money = (subtotal: number, shipping: number, tax: number | null, total: number): ReportMoney => ({ subtotal, discount: 0, shipping, tax, total });
  const base: ReportOrderLike = {
    ours: true, printfulStatus: "fulfilled", placedAt: "2026-03-10T20:00:00.000Z", itemCount: 2,
    items: [{ name: "Logo Tee / L", quantity: 2, retailCents: 3000 }],
    paid: money(6000, 600, 610, 7210), cost: money(2800, 450, 0, 3250),
    address: { city: "Olympia", state: "WA", zip: "98501-1234" },
  };
  const range = { fromISO: "2026-03-01T08:00:00.000Z", toISO: "2026-04-01T06:59:59.999Z", fromDate: "2026-03-01", toDate: "2026-03-31" };
  const r = merchSalesReport([
    base,
    { ...base, placedAt: "2026-03-11T20:00:00.000Z", paid: money(3000, 600, null, 3600), cost: { ...base.cost, total: null } },
    { ...base, printfulStatus: "canceled" },
    { ...base, ours: false },
    { ...base, placedAt: "2026-02-10T20:00:00.000Z" },
    { ...base, placedAt: "2026-03-12T20:00:00.000Z", address: { city: "Portland", state: "OR", zip: "97201" } },
  ], range);
  ok(r.totals.orders === 3, "only ours, in range, not cancelled");
  ok(r.cancelled === 1, "cancelled counted separately");
  ok(r.totals.taxCents === 1220 && r.totals.taxUnknown === 1, "tax summed; unknown tax not invented");
  ok(r.totals.costUnknown === 1 && r.totals.printfulCostCents === 6500 && r.totals.marginCents === 7920, "margin only where cost known");
  ok(r.totals.units === 6 && r.totals.totalCents === 18020, "units and total");
  ok(r.totals.avgOrderCents === Math.round(18020 / 3), "average order");
  ok(r.byDay.length === 31 && r.byDay.find((d) => d.date === "2026-03-10")?.value === 7210, "daily series filled, Pacific day");
  ok(r.taxByMonth.length === 1 && r.taxByMonth[0].grossCents === 18020 - 1220, "gross = total - tax");
  ok(r.taxByPlace[0].zip === "98501" && r.taxByPlace.length === 2, "tax by city + 5-digit ZIP");
  ok(r.outOfState === 1, "out of state flagged");
  ok(r.topProducts[0].label === "Logo Tee / L" && r.topProducts[0].units === 6, "top products");
  ok(pacificDay("2026-03-11T05:00:00.000Z") === "2026-03-10" && pacificDay("x") === "", "pacific day");
  ok(daySpan("2026-02-27", "2026-03-02").join(",") === "2026-02-27,2026-02-28,2026-03-01,2026-03-02" && daySpan("bad", "2026-01-01").length === 0, "day span");
  const u = visitsAggregateUrl({ projectId: "greenway-merch", teamId: "team_1", since: "2026-03-01", until: "2026-03-31", by: "requestPath", limit: 500 });
  ok(u.startsWith(`${VERCEL_WA_BASE}/visits/aggregate?`) && u.includes("by=requestPath") && u.includes("limit=100") && u.includes("teamId=team_1"), "query url");
  const days = parseVisits({ data: [{ timestamp: "2026-03-02T00:00:00.000Z", pageviews: 9, visitors: 4 }, { timestamp: "bad" }] }, "day");
  ok(days.length === 1 && days[0].label === "2026-03-02" && days[0].pageviews === 9, "parse days");
  ok(parseVisits({ data: [{ referrerHostname: "", pageviews: 3, visitors: -1 }] }, "referrerHostname")[0].label === "Direct / none", "empty referrer = direct; negatives 0");
  ok(parseVisits(null, "day").length === 0 && parseVisits({ data: "x" }, "day").length === 0, "bad payload -> empty");
  ok(fillDays(days, ["2026-03-01", "2026-03-02"]).map((d) => d.pageviews).join() === "0,9", "fill days");
  ok(conversionPct(3, 200) === 1.5 && conversionPct(1, 0) === null, "conversion");
  ok(sheetText("=HYPERLINK(1)") === "'=HYPERLINK(1)" && sheetText("Olympia") === "Olympia", "formula guard");
  return { passed, failed: failures.length, failures };
}
