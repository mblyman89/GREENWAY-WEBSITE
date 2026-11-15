/**
 * src/lib/admin/mobile-core.ts
 *
 * Mobile Readiness Pass — PURE view-model selectors for the on-the-go "/admin/mobile"
 * experience. This file has NO server imports (no DB, no next/headers), so it is
 * trivially unit-testable and safe to import anywhere.
 *
 * Design is grounded in verified research:
 *  - Cannabis-industry mobile tools (Flowhub Stash) show owners/managers want a fast,
 *    real-time snapshot + a SHORT set of things they'd act on remotely — not the full
 *    40+ item admin nav.
 *  - Mobile-dashboard best practice (Tableau): favor INSIGHTS over exploration, show
 *    only the metrics that matter, keep it a simple actionable snapshot.
 *
 * IMPORTANT: this selector invents no data. It only reshapes the existing, verified
 * CockpitSnapshot (src/lib/admin/cockpit-data.ts) into a phone-first view-model, and
 * filters a curated shortcut list by the role's real permissions via can().
 */

import type { CockpitSnapshot } from "@/lib/admin/cockpit-data";
import { buildAttentionFlags, computeDelta, type AttentionFlag, type Delta } from "@/lib/admin/cockpit-core";
import { can, type Permission } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";
import type { SalesReport } from "@/lib/reports/sales";
// PURE IMPORTS ONLY. `comparison-data.ts` and `returns-metrics-store.ts` are
// both `import "server-only"`, and pulling either into this module breaks the
// pure self-test runner (it has no such module). The two fixture values they
// would have supplied are constructed inline below instead.
import { DEFAULT_BASIS, comparisonWindowFor } from "@/lib/admin/comparison-basis-core";
import { computeNetSales, EMPTY_REFUND_FACTS } from "@/lib/admin/refund-metrics-core";

// ── KPI tiles ────────────────────────────────────────────────────────────────

export type MobileKpi = {
  key: "grossBeforeDiscounts" | "discount" | "revenue" | "orders" | "units" | "avgOrder";
  label: string;
  /** minor units for money keys; raw count otherwise. Formatting happens in the view. */
  valueMinorOrCount: number;
  isMoney: boolean;
  delta: Delta;
  /**
   * D245b: what the delta compares against, e.g. "yesterday by 2:35 PM"
   * (the same-time comparison the desktop dashboard uses), or "yesterday"
   * when only whole-day figures are available.
   */
  vsLabel: string;
};

type MeasureLike = { delta: Delta } | undefined;

/**
 * Today's headline numbers. D245b (owner: "Please update the phone dashboard
 * too"): the same six tiles in the same order as the desktop "Today's sales"
 * row (Revenue before discounts and Total discounts first), each compared with
 * the default basis cut at the same Pacific time of day as now
 * (snap.comparison, built by comparison-data.ts with the same-time cut).
 * Falls back to the whole-day yesterday deltas only when a comparison measure
 * is missing, and then says "yesterday" rather than claiming same time.
 */
export function mobileKpis(snap: CockpitSnapshot): MobileKpi[] {
  const c = snap.comparison;
  const sameTimeVs = `${c.window.comparisonLabel.replace(/^vs /, "")}${c.cutLabel ? ` by ${c.cutLabel}` : ""}`;
  const todayDiscount = snap.today.totalDiscountMinorUnits ?? 0;
  const yDiscount = snap.yesterday.totalDiscountMinorUnits ?? 0;
  const pick = (m: MeasureLike, fallback: Delta): { delta: Delta; vsLabel: string } =>
    m ? { delta: m.delta, vsLabel: sameTimeVs } : { delta: fallback, vsLabel: "yesterday" };
  return [
    {
      key: "grossBeforeDiscounts",
      label: "Before discounts",
      valueMinorOrCount: snap.today.totalRevenueMinorUnits + todayDiscount,
      isMoney: true,
      ...pick(
        c.grossBeforeDiscounts,
        computeDelta(snap.today.totalRevenueMinorUnits + todayDiscount, snap.yesterday.totalRevenueMinorUnits + yDiscount),
      ),
    },
    {
      key: "discount",
      label: "Total discounts",
      valueMinorOrCount: todayDiscount,
      isMoney: true,
      ...pick(c.discount, computeDelta(todayDiscount, yDiscount)),
    },
    {
      key: "revenue",
      label: "Revenue today",
      valueMinorOrCount: snap.today.totalRevenueMinorUnits,
      isMoney: true,
      ...pick(c.revenue, snap.deltas.revenue),
    },
    {
      key: "orders",
      label: "Orders",
      valueMinorOrCount: snap.today.totalOrders,
      isMoney: false,
      ...pick(c.orders, snap.deltas.orders),
    },
    {
      key: "units",
      label: "Units sold",
      valueMinorOrCount: snap.today.totalUnits,
      isMoney: false,
      ...pick(c.units, snap.deltas.units),
    },
    {
      key: "avgOrder",
      label: "Avg. order",
      valueMinorOrCount: snap.today.avgOrderMinorUnits,
      isMoney: true,
      ...pick(c.avgOrder, snap.deltas.avgOrder),
    },
  ];
}

// ── Attention (reuse the exact same logic the desktop cockpit uses) ──────────

export function mobileAttention(snap: CockpitSnapshot): AttentionFlag[] {
  return buildAttentionFlags({
    activeOrders: snap.activeOrders,
    lowStockCount: snap.lowStockCount,
    drawers: snap.drawers,
    publishedItems: snap.publishedItems,
  });
}

// ── Glance tiles: read-only, deep-linked "how are things right now" ──────────

export type MobileGlance = {
  key: string;
  label: string;
  value: string;
  href: string;
  /** True when this glance is in a state worth a second look. */
  attention?: boolean;
};

/**
 * Small set of live status glances. Values are already-computed counts on the
 * snapshot; we only format them to short strings and attach deep links.
 */
export function mobileGlances(snap: CockpitSnapshot): MobileGlance[] {
  const openDrawers = snap.drawers.openCount;
  const drawerAttn = snap.drawers.needsAttention;
  const glances: MobileGlance[] = [
    {
      key: "activeOrders",
      label: "Open orders",
      value: String(snap.activeOrders),
      href: "/admin/orders",
      attention: snap.activeOrders > 0,
    },
    {
      key: "lowStock",
      label: "Low stock",
      value: String(snap.lowStockCount),
      href: "/admin/purchasing",
      attention: snap.lowStockCount > 0,
    },
    {
      key: "drawers",
      label: "Open drawers",
      value: drawerAttn > 0 ? `${openDrawers} · ${drawerAttn}⚠` : String(openDrawers),
      href: "/admin/registers",
      attention: drawerAttn > 0,
    },
    {
      key: "menu",
      label: "Live menu items",
      value: snap.publishedItems === null ? "—" : String(snap.publishedItems),
      href: "/admin/menu-imports",
      attention: !snap.publishedItems,
    },
    {
      key: "loyalty",
      label: "Loyalty signups",
      value: String(snap.loyaltySignups),
      href: "/admin/loyalty-signups",
    },
    {
      key: "registers",
      label: "Register activity",
      value: String(snap.registers.length),
      href: "/admin/registers",
    },
  ];
  return glances;
}

// ── Curated shortcuts (permission-filtered) ──────────────────────────────────

export type MobileShortcut = {
  label: string;
  href: string;
  icon: string;
  permission: Permission;
  /** Short "why you'd tap this on the go" hint. */
  hint: string;
};

/**
 * The short list of things an owner/manager realistically acts on from a phone.
 * Deliberately curated (research: don't mirror the full desktop nav on mobile).
 * Each entry is permission-gated and links to the EXISTING desktop page.
 */
export const MOBILE_SHORTCUTS: MobileShortcut[] = [
  { label: "Orders", href: "/admin/orders", icon: "🧾", permission: "orders.view", hint: "Check & fulfill open orders" },
  { label: "Register Activity", href: "/admin/registers", icon: "💵", permission: "orders.manage", hint: "Shifts, registers, live activity" },
  { label: "Reports", href: "/admin/reports", icon: "📊", permission: "reports.view", hint: "Sales, tax & performance" },
  { label: "Compliance Health", href: "/admin/compliance/health", icon: "🛡", permission: "reports.view", hint: "CCRS/DOH readiness at a glance" },
  { label: "Inventory", href: "/admin/inventory", icon: "🧾", permission: "inventory.manage", hint: "Look up stock & lots" },
  { label: "Purchasing", href: "/admin/purchasing", icon: "🛒", permission: "inventory.manage", hint: "Reorder what's low" },
  { label: "Menu Imports", href: "/admin/menu-imports", icon: "⬆", permission: "menu.import", hint: "Publish / check the live menu" },
  { label: "Marketing & Advertising", href: "/admin/marketing", icon: "📣", permission: "content.edit", hint: "Draft a compliant idea" },
  { label: "Customers", href: "/admin/customers", icon: "👤", permission: "customers.manage", hint: "Look up a customer" },
  { label: "Time Clock", href: "/admin/staffing", icon: "⏱", permission: "timeclock.use", hint: "Who's clocked in or on break" },
];

/** Filter the curated shortcuts to what this role can actually open. */
export function visibleShortcuts(role: StaffRole): MobileShortcut[] {
  return MOBILE_SHORTCUTS.filter((s) => can(role, s.permission));
}

// ── Self-tests (tsx-runnable) ────────────────────────────────────────────────

export function __runMobileCoreTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed += 1;
  };

  const zeroDelta: Delta = { change: 0, pct: 0, direction: "flat", isNew: false };
  const emptyReport: SalesReport = {
    hasData: false,
    totalRevenueMinorUnits: 0,
    totalUnits: 0,
    totalOrders: 0,
    avgOrderMinorUnits: 0,
    avgUnitsPerOrder: 0,
    totalDiscountMinorUnits: 0,
    byCategory: [],
    byType: [],
    byTypeWithinCategory: [],
    byVendor: [],
    byBrand: [],
    byProduct: [],
    byDay: [],
    byHour: [],
    byDayHour: [],
    byDayCategoryType: [],
    byDayClock: [],
    byCustomerType: [],
  };
  const zeroMeasure = {
    current: 0,
    baseline: null,
    delta: zeroDelta,
    result: { value: null, daysWithData: 0, daysRequested: 0, partial: false },
    qualifier: "no baseline data",
  };
  const snap: CockpitSnapshot = {
    configured: true,
    today: {
      ...emptyReport,
      hasData: true,
      totalRevenueMinorUnits: 123456,
      totalUnits: 42,
      totalOrders: 10,
      avgOrderMinorUnits: 12345,
      totalDiscountMinorUnits: 2500,
    },
    yesterday: emptyReport,
    deltas: { revenue: zeroDelta, orders: zeroDelta, units: zeroDelta, avgOrder: zeroDelta },
    activeOrders: 3,
    orderBoard: [],
    registers: [],
    drawers: { openCount: 2, closedUnverifiedCount: 0, verifiedCount: 0, totalVarianceMinor: 0, needsAttention: 1 },
    lowStockCount: 5,
    publishedItems: 0,
    lastImportISO: null,
    loyaltySignups: 7,
    // SLICE 21 — the snapshot now carries the comparison basis and the
    // returns/voids block. This fixture uses the defaults; the comparison
    // engine has its own dedicated tests.
    basis: DEFAULT_BASIS,
    comparison: {
      window: comparisonWindowFor(DEFAULT_BASIS, "2026-09-06"),
      revenue: zeroMeasure,
      orders: zeroMeasure,
      units: zeroMeasure,
      avgOrder: zeroMeasure,
    },
    refundsToday: {
      ok: false,
      byDay: [{ day: "2026-09-06", ...EMPTY_REFUND_FACTS }],
      totals: { ...EMPTY_REFUND_FACTS },
      byReason: [],
      byDisposition: [],
      returnedUnits: 0,
      restockShare: null,
    },
    netToday: computeNetSales(0, EMPTY_REFUND_FACTS),
    refundSeverityToday: "ok",
    todayYmd: "2026-09-06",
  };

  const kpis = mobileKpis(snap);
  assert(kpis.length === 6, "six KPI tiles, same as the desktop row (D245b)");
  assert(kpis[0].key === "grossBeforeDiscounts" && kpis[1].key === "discount", "the two discount tiles lead (D245b)");
  assert(kpis[0].isMoney && kpis[0].valueMinorOrCount === 123456 + 2500, "before discounts = revenue + discounts");
  assert(kpis[1].isMoney && kpis[1].valueMinorOrCount === 2500, "total discounts in minor units");
  assert(kpis[2].key === "revenue" && kpis[2].isMoney && kpis[2].valueMinorOrCount === 123456, "revenue KPI is money w/ minor units");
  assert(kpis[3].key === "orders" && kpis[3].valueMinorOrCount === 10, "orders KPI count");
  // The fixture's comparison has the four classic measures but not the two
  // new ones, and no cut: classic tiles say the basis, new tiles fall back.
  assert(kpis[2].vsLabel === "yesterday", "no cut: plain basis label");
  assert(kpis[0].vsLabel === "yesterday", "missing measure falls back to whole-day yesterday");
  const cutSnap: CockpitSnapshot = {
    ...snap,
    comparison: {
      ...snap.comparison,
      grossBeforeDiscounts: { ...zeroMeasure, delta: { change: 10, pct: 5, direction: "up", isNew: false } },
      discount: zeroMeasure,
      cutMinute: 875,
      cutLabel: "2:35 PM",
    },
  };
  const cutKpis = mobileKpis(cutSnap);
  assert(cutKpis.every((k) => k.vsLabel === "yesterday by 2:35 PM"), "every tile compares at the same time of day");
  assert(cutKpis[0].delta.direction === "up", "the same-time delta is the one shown");

  const glances = mobileGlances(snap);
  assert(glances.find((g) => g.key === "activeOrders")!.value === "3", "open orders glance = 3");
  assert(glances.find((g) => g.key === "drawers")!.value.includes("⚠"), "drawer glance flags attention");
  assert(glances.find((g) => g.key === "menu")!.attention === true, "no live menu => attention");

  const flags = mobileAttention(snap);
  // drawers.needsAttention(1) + activeOrders(3) + lowStock(5) + no menu = 4 flags
  assert(flags.length === 4, "attention flags reuse cockpit logic (expected 4)");
  assert(flags[0].severity === "critical", "drawer review is critical + first");

  // Permission filtering: an owner/admin should see all; a limited role fewer.
  const ownerShortcuts = visibleShortcuts("owner");
  assert(ownerShortcuts.length === MOBILE_SHORTCUTS.length, "owner sees all curated shortcuts");
  assert(ownerShortcuts.length <= 12, "curated list stays short (<=12)");

  return { passed };
}
