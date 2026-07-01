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
import { buildAttentionFlags, type AttentionFlag, type Delta } from "@/lib/admin/cockpit-core";
import { can, type Permission } from "@/lib/auth/roles";
import type { StaffRole } from "@/lib/supabase/types";
import type { SalesReport } from "@/lib/reports/sales";

// ── KPI tiles ────────────────────────────────────────────────────────────────

export type MobileKpi = {
  key: "revenue" | "orders" | "units" | "avgOrder";
  label: string;
  /** minor units for money keys; raw count otherwise. Formatting happens in the view. */
  valueMinorOrCount: number;
  isMoney: boolean;
  delta: Delta;
};

/** Today's four headline numbers with their vs-yesterday deltas. */
export function mobileKpis(snap: CockpitSnapshot): MobileKpi[] {
  return [
    {
      key: "revenue",
      label: "Revenue today",
      valueMinorOrCount: snap.today.totalRevenueMinorUnits,
      isMoney: true,
      delta: snap.deltas.revenue,
    },
    {
      key: "orders",
      label: "Orders",
      valueMinorOrCount: snap.today.totalOrders,
      isMoney: false,
      delta: snap.deltas.orders,
    },
    {
      key: "units",
      label: "Units sold",
      valueMinorOrCount: snap.today.totalUnits,
      isMoney: false,
      delta: snap.deltas.units,
    },
    {
      key: "avgOrder",
      label: "Avg. order",
      valueMinorOrCount: snap.today.avgOrderMinorUnits,
      isMoney: true,
      delta: snap.deltas.avgOrder,
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
      label: "Live registers",
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
  { label: "Registers & Drawers", href: "/admin/registers", icon: "💵", permission: "orders.manage", hint: "Verify drawers, spot variances" },
  { label: "Reports", href: "/admin/reports", icon: "📊", permission: "reports.view", hint: "Sales, tax & performance" },
  { label: "Compliance Health", href: "/admin/compliance/health", icon: "🛡", permission: "reports.view", hint: "CCRS/DOH readiness at a glance" },
  { label: "Inventory", href: "/admin/inventory", icon: "🧾", permission: "inventory.manage", hint: "Look up stock & lots" },
  { label: "Purchasing", href: "/admin/purchasing", icon: "🛒", permission: "inventory.manage", hint: "Reorder what's low" },
  { label: "Menu Imports", href: "/admin/menu-imports", icon: "⬆", permission: "menu.import", hint: "Publish / check the live menu" },
  { label: "Marketing & Advertising", href: "/admin/marketing", icon: "📣", permission: "content.edit", hint: "Draft a compliant idea" },
  { label: "Customers", href: "/admin/customers", icon: "👤", permission: "customers.manage", hint: "Look up a customer" },
  { label: "Time Clock", href: "/admin/staffing", icon: "⏱", permission: "loyalty.view", hint: "Who's clocked in" },
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
    byCustomerType: [],
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
  };

  const kpis = mobileKpis(snap);
  assert(kpis.length === 4, "four KPI tiles");
  assert(kpis[0].isMoney && kpis[0].valueMinorOrCount === 123456, "revenue KPI is money w/ minor units");
  assert(kpis[1].key === "orders" && kpis[1].valueMinorOrCount === 10, "orders KPI count");

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
