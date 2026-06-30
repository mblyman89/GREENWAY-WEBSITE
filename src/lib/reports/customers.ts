import "server-only";

/**
 * src/lib/reports/customers.ts  (Run 5 / Slice 19)
 *
 * Customer analytics for the back office — the "Customers" report tab. Answers
 * the questions a retail owner actually asks:
 *
 *   • Who are my best customers? (top by spend, by visits)
 *   • How many new vs returning customers in this window, and what share of
 *     revenue does each drive?
 *   • What's my average order value, average basket size, repeat rate?
 *   • How is my customer base trending day over day (new vs returning)?
 *   • A simple RFM-style segmentation (Champions / Loyal / At-risk / New / etc.)
 *     so staff can see who to re-engage.
 *
 * Identity
 * --------
 * Customers are keyed by lowercased email. Orders without an email are bucketed
 * as "Guest / walk-in" and excluded from per-customer rollups (they can't be
 * attributed to a returning identity) but ARE counted in the guest KPIs.
 *
 * New vs returning
 * ----------------
 * An order is "returning" if that email placed an EARLIER non-cancelled order
 * (at any time, not just in-window). We look back across all history for the
 * matched emails so the classification is stable regardless of the window.
 *
 * Time
 * ----
 * All day buckets are Pacific (America/Los_Angeles) via the shared timezone
 * helper, matching the rest of the suite.
 *
 * Money is always MINOR UNITS (cents).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { pacificDayKey } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TopCustomerRow = {
  /** Display name (best-effort) or the email if no name. */
  label: string;
  email: string;
  orders: number;
  unitsBought: number;
  revenueMinorUnits: number;
  avgOrderMinorUnits: number;
  firstOrderDate: string; // YYYY-MM-DD (Pacific)
  lastOrderDate: string; // YYYY-MM-DD (Pacific)
  /** RFM-style segment label. */
  segment: string;
};

export type NewReturningRow = {
  label: string; // "New" | "Returning" | "Guest / walk-in"
  customers: number;
  orders: number;
  revenueMinorUnits: number;
  revenueShare: number; // 0..1
};

export type CustomerDayPoint = {
  date: string; // YYYY-MM-DD (Pacific)
  newCustomers: number;
  returningCustomers: number;
  orders: number;
  revenueMinorUnits: number;
};

export type SegmentRow = {
  label: string;
  customers: number;
  revenueMinorUnits: number;
};

export type CustomersReport = {
  hasData: boolean;
  // KPIs (window)
  totalOrders: number;
  identifiedCustomers: number; // distinct emails in window
  newCustomers: number;
  returningCustomers: number;
  guestOrders: number;
  totalRevenueMinorUnits: number;
  avgOrderMinorUnits: number;
  avgBasketSize: number; // units per order
  repeatRate: number; // returning customers / identified customers, 0..1
  // Breakdowns
  newVsReturning: NewReturningRow[];
  topCustomers: TopCustomerRow[];
  segments: SegmentRow[];
  daily: CustomerDayPoint[];
};

export const EMPTY_CUSTOMERS_REPORT: CustomersReport = {
  hasData: false,
  totalOrders: 0,
  identifiedCustomers: 0,
  newCustomers: 0,
  returningCustomers: 0,
  guestOrders: 0,
  totalRevenueMinorUnits: 0,
  avgOrderMinorUnits: 0,
  avgBasketSize: 0,
  repeatRate: 0,
  newVsReturning: [],
  topCustomers: [],
  segments: [],
  daily: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  status: string;
  customer_email: string | null;
  customer_first_name: string | null;
  customer_last_name: string | null;
  total_minor_units: number | null;
  item_count: number | null;
  placed_at: string;
};

function emailKey(e: string | null): string | null {
  const t = (e ?? "").trim().toLowerCase();
  return t.length ? t : null;
}

function nameOf(o: OrderRow): string {
  const parts = [o.customer_first_name, o.customer_last_name].map((s) => (s ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : (emailKey(o.customer_email) ?? "Guest");
}

/**
 * RFM-ish segmentation for a single customer using window data + lifetime first
 * order. Intentionally simple and explainable (no opaque scoring):
 *   • New            — first order is within this window.
 *   • Champion       — 3+ orders AND top-quartile spend.
 *   • Loyal          — 2+ orders.
 *   • Big spender    — 1 order but top-quartile spend.
 *   • One-time       — exactly 1 order, ordinary spend.
 */
function segmentFor(
  orders: number,
  revenue: number,
  firstInWindow: boolean,
  spendThreshold: number,
): string {
  if (firstInWindow && orders <= 1) return "New";
  if (orders >= 3 && revenue >= spendThreshold) return "Champion";
  if (orders >= 2) return "Loyal";
  if (revenue >= spendThreshold) return "Big spender";
  return "One-time";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function getCustomersReport(fromISO: string, toISO: string): Promise<CustomersReport> {
  if (!isSupabaseServiceConfigured) return { ...EMPTY_CUSTOMERS_REPORT };
  const admin = createSupabaseAdminClient();

  // Orders in window (exclude cancelled from revenue + classification).
  const { data: windowData } = await admin
    .from("orders")
    .select(
      "id, status, customer_email, customer_first_name, customer_last_name, total_minor_units, item_count, placed_at",
    )
    .gte("placed_at", fromISO)
    .lte("placed_at", toISO);

  const windowOrders = ((windowData as OrderRow[] | null) ?? []).filter((o) => o.status !== "cancelled");
  if (windowOrders.length === 0) return { ...EMPTY_CUSTOMERS_REPORT };

  // Distinct emails in window — used to look back across ALL history to decide
  // new vs returning and to find each customer's true first order date.
  const emails = Array.from(
    new Set(windowOrders.map((o) => emailKey(o.customer_email)).filter((e): e is string => !!e)),
  );

  // History (lifetime) for those emails — earliest order date per email.
  const firstOrderByEmail = new Map<string, string>(); // email -> earliest placed_at ISO
  if (emails.length) {
    const { data: histData } = await admin
      .from("orders")
      .select("customer_email, placed_at, status")
      .in("customer_email", emails.slice(0, 2000));
    const hist = (histData as { customer_email: string | null; placed_at: string; status: string }[] | null) ?? [];
    for (const h of hist) {
      if (h.status === "cancelled") continue;
      const k = emailKey(h.customer_email);
      if (!k) continue;
      const prev = firstOrderByEmail.get(k);
      if (!prev || h.placed_at < prev) firstOrderByEmail.set(k, h.placed_at);
    }
  }

  // Per-customer accumulation within the window.
  type Cust = {
    email: string;
    label: string;
    orders: number;
    units: number;
    revenue: number;
    firstWindow: string; // ISO
    lastWindow: string; // ISO
  };
  const custMap = new Map<string, Cust>();

  let totalRevenue = 0;
  let totalUnits = 0;
  let guestOrders = 0;

  // Daily series scaffold (Pacific days across the window).
  const dayMap = new Map<string, CustomerDayPoint>();
  const seenCustomerOnDay = new Map<string, Set<string>>(); // date -> emails counted that day

  for (const o of windowOrders) {
    const rev = o.total_minor_units ?? 0;
    const units = o.item_count ?? 0;
    totalRevenue += rev;
    totalUnits += units;

    const dk = pacificDayKey(o.placed_at);
    let dp = dayMap.get(dk);
    if (!dp) {
      dp = { date: dk, newCustomers: 0, returningCustomers: 0, orders: 0, revenueMinorUnits: 0 };
      dayMap.set(dk, dp);
    }
    dp.orders += 1;
    dp.revenueMinorUnits += rev;

    const k = emailKey(o.customer_email);
    if (!k) {
      guestOrders += 1;
      continue;
    }

    let c = custMap.get(k);
    if (!c) {
      c = { email: k, label: nameOf(o), orders: 0, units: 0, revenue: 0, firstWindow: o.placed_at, lastWindow: o.placed_at };
      custMap.set(k, c);
    }
    c.orders += 1;
    c.units += units;
    c.revenue += rev;
    if (o.placed_at < c.firstWindow) c.firstWindow = o.placed_at;
    if (o.placed_at > c.lastWindow) {
      c.lastWindow = o.placed_at;
      c.label = nameOf(o); // prefer the most recent name on file
    }

    // Daily new vs returning: classify this customer's FIRST appearance on this
    // day. "New" if their lifetime first order is also within the window.
    const firstEver = firstOrderByEmail.get(k) ?? o.placed_at;
    const isNew = firstEver >= fromISO;
    let seen = seenCustomerOnDay.get(dk);
    if (!seen) {
      seen = new Set();
      seenCustomerOnDay.set(dk, seen);
    }
    if (!seen.has(k)) {
      seen.add(k);
      if (isNew) dp.newCustomers += 1;
      else dp.returningCustomers += 1;
    }
  }

  // Spend threshold = top-quartile (75th percentile) of per-customer revenue.
  const spends = [...custMap.values()].map((c) => c.revenue).sort((a, b) => a - b);
  const spendThreshold = spends.length ? spends[Math.floor(spends.length * 0.75)] ?? 0 : 0;

  // New vs returning rollup (window-level, distinct customers).
  let newCustomers = 0;
  let returningCustomers = 0;
  let newRevenue = 0;
  let returningRevenue = 0;
  const segmentMap = new Map<string, SegmentRow>();
  const topCustomers: TopCustomerRow[] = [];

  for (const c of custMap.values()) {
    const firstEver = firstOrderByEmail.get(c.email) ?? c.firstWindow;
    const firstInWindow = firstEver >= fromISO;
    if (firstInWindow) {
      newCustomers += 1;
      newRevenue += c.revenue;
    } else {
      returningCustomers += 1;
      returningRevenue += c.revenue;
    }

    const segment = segmentFor(c.orders, c.revenue, firstInWindow, spendThreshold);
    const seg = segmentMap.get(segment) ?? { label: segment, customers: 0, revenueMinorUnits: 0 };
    seg.customers += 1;
    seg.revenueMinorUnits += c.revenue;
    segmentMap.set(segment, seg);

    topCustomers.push({
      label: c.label,
      email: c.email,
      orders: c.orders,
      unitsBought: c.units,
      revenueMinorUnits: c.revenue,
      avgOrderMinorUnits: c.orders > 0 ? Math.round(c.revenue / c.orders) : 0,
      firstOrderDate: pacificDayKey(firstEver),
      lastOrderDate: pacificDayKey(c.lastWindow),
      segment,
    });
  }

  topCustomers.sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);

  const guestRevenue = totalRevenue - newRevenue - returningRevenue;
  const newVsReturning: NewReturningRow[] = [
    { label: "New", customers: newCustomers, orders: 0, revenueMinorUnits: newRevenue, revenueShare: 0 },
    {
      label: "Returning",
      customers: returningCustomers,
      orders: 0,
      revenueMinorUnits: returningRevenue,
      revenueShare: 0,
    },
    { label: "Guest / walk-in", customers: 0, orders: guestOrders, revenueMinorUnits: guestRevenue, revenueShare: 0 },
  ].map((r) => ({ ...r, revenueShare: totalRevenue > 0 ? r.revenueMinorUnits / totalRevenue : 0 }));

  // Fill order counts for new/returning rows.
  for (const c of custMap.values()) {
    const firstEver = firstOrderByEmail.get(c.email) ?? c.firstWindow;
    if (firstEver >= fromISO) newVsReturning[0].orders += c.orders;
    else newVsReturning[1].orders += c.orders;
  }

  const segments = [...segmentMap.values()].sort((a, b) => b.revenueMinorUnits - a.revenueMinorUnits);
  const daily = [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));

  const identifiedCustomers = custMap.size;
  const totalOrders = windowOrders.length;

  return {
    hasData: true,
    totalOrders,
    identifiedCustomers,
    newCustomers,
    returningCustomers,
    guestOrders,
    totalRevenueMinorUnits: totalRevenue,
    avgOrderMinorUnits: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
    avgBasketSize: totalOrders > 0 ? Math.round((totalUnits / totalOrders) * 100) / 100 : 0,
    repeatRate: identifiedCustomers > 0 ? returningCustomers / identifiedCustomers : 0,
    newVsReturning,
    topCustomers: topCustomers.slice(0, 50),
    segments,
    daily,
  };
}
