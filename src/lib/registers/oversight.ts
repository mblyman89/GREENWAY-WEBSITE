import "server-only";

/**
 * src/lib/registers/oversight.ts
 *
 * Back-office **Register Activity** oversight assembler.
 *
 * The owner's direction: the hands-on count-in / drop / blind-close drawer
 * workflow belongs on the FRONT-END iPad POS (the cashier does it at the
 * register). The back office is a manager OVERSIGHT / MONITORING console:
 * who's working, what the registers are doing, and a live feed of activity.
 *
 * This mirrors the best-in-class pattern verified in vendor docs:
 *  - Lightspeed BackOffice "Shifts Summary": a read-only overview of each
 *    register shift so you can "monitor the cash drawer from anywhere"
 *    (green dot = open, red = closed).
 *  - Square Dashboard: real-time reports, "see all your transactions",
 *    team-attributed activity, "handle tasks that need attention right away".
 *  - Toast Reporting Dashboard: a single manager view of the day's headline
 *    numbers.
 *
 * DATA REALITY (verified in the file tree): there is NO in-store per-transaction
 * POS table. The only transaction-like records are ONLINE pickup orders. So the
 * "live activity feed" is built from REAL events only:
 *   - online orders (orders-store)
 *   - drawer sessions open/close/reconcile/verify (registers/store)
 *   - clock-ins currently on the clock (staffing/store)
 * We never fabricate in-store transactions that don't exist.
 *
 * ALL time-dependent computation lives here (server data layer) so the page
 * render stays pure and satisfies react-hooks/purity. Money is in MINOR UNITS.
 */

import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  liveRegisters,
  recentSessions,
  cashDrawerSummary,
  type RegisterLive,
  type DrawerSession,
  type CashDrawerSummary,
} from "@/lib/registers/store";
import {
  onTheClock,
  listRecentShifts,
  type Employee,
  type TimePunch,
  type Shift,
} from "@/lib/staffing/store";
import { listOrders } from "@/lib/orders/orders-store";
import type { OrderRow, OrderStatus } from "@/lib/orders/types";
import { getCockpitSnapshot, type CockpitSnapshot } from "@/lib/admin/cockpit-data";
import { businessDayFor } from "@/lib/staffing/time";
import { pacificParts } from "@/lib/reports/timezone";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One person currently clocked in (shift-management at-a-glance). */
export type OnClockRow = {
  employeeId: string;
  name: string;
  role: Employee["job_role"];
  clockInAtISO: string;
  /** Pacific "h:mm AM/PM" for display (computed server-side). */
  clockInLabel: string;
  /** Whole minutes on the clock so far (server-computed). */
  minutesOnClock: number;
};

/** Per-register live status card (read-only oversight, Lightspeed-style). */
export type RegisterActivityRow = {
  registerId: string;
  name: string;
  kind: "sales" | "manager_till";
  /** True when a drawer session is currently open on this register. */
  open: boolean;
  status: DrawerSession["status"] | "idle";
  openedByLabel: string | null;
  openedAtISO: string | null;
  openedAtLabel: string | null;
  startingCashMinor: number | null;
  droppedMinor: number;
  expectedCloseMinor: number | null;
};

/** A closed drawer awaiting a manager reconcile / verify action. */
export type AttentionItem = {
  sessionId: string;
  registerName: string;
  kind: "reconcile" | "verify";
  businessDay: string;
  expectedCloseMinor: number | null;
  closingCountMinor: number | null;
};

export type ActivityKind =
  | "order_new"
  | "order_ready"
  | "order_completed"
  | "order_cancelled"
  | "drawer_open"
  | "drawer_closed"
  | "drawer_reconciled"
  | "drawer_verified"
  | "clock_in";

/** One item in the merged, reverse-chronological live activity feed. */
export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  /** ISO instant used only for sorting (server-side). */
  atISO: string;
  /** Pacific "h:mm AM/PM" for display. */
  atLabel: string;
  /** Human sentence, e.g. "Order #1042 placed". */
  title: string;
  /** Optional secondary detail, e.g. customer name or register. */
  detail: string | null;
  /** Optional money amount in minor units to render on the right. */
  amountMinor: number | null;
};

export type RegisterActivityKpis = {
  /** Today's ONLINE order sales (minor units) — labelled honestly on the page. */
  onlineSalesTodayMinor: number;
  onlineSalesDeltaPct: number | null;
  onlineSalesDeltaDir: "up" | "down" | "flat";
  activeOrders: number;
  openDrawers: number;
  registerCount: number;
  netOverShortTodayMinor: number;
  awaitingReconcile: number;
};

export type RegisterActivitySnapshot = {
  configured: boolean;
  kpis: RegisterActivityKpis;
  onClock: OnClockRow[];
  registers: RegisterActivityRow[];
  attention: AttentionItem[];
  feed: ActivityEvent[];
  cash: CashDrawerSummary;
};

// ---------------------------------------------------------------------------
// Helpers (all server-side; page render stays pure)
// ---------------------------------------------------------------------------

/** Pacific "h:mm AM/PM" label for an ISO instant. */
function pacificClock(iso: string): string {
  const p = pacificParts(iso);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? "AM" : "PM";
  const mm = String(p.minute).padStart(2, "0");
  return `${h12}:${mm} ${ampm}`;
}

function minutesBetween(fromISO: string, toISO: string): number {
  const ms = new Date(toISO).getTime() - new Date(fromISO).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

const ORDER_STATUS_TIME: Partial<Record<OrderStatus, keyof OrderRow>> = {
  ready: "ready_at",
  completed: "completed_at",
};

function emptySnapshot(): RegisterActivitySnapshot {
  return {
    configured: false,
    kpis: {
      onlineSalesTodayMinor: 0,
      onlineSalesDeltaPct: 0,
      onlineSalesDeltaDir: "flat",
      activeOrders: 0,
      openDrawers: 0,
      registerCount: 0,
      netOverShortTodayMinor: 0,
      awaitingReconcile: 0,
    },
    onClock: [],
    registers: [],
    attention: [],
    feed: [],
    cash: {
      registerCount: 0,
      openCount: 0,
      startingCashOpenMinor: 0,
      droppedOpenMinor: 0,
      awaitingReconcile: 0,
      netOverShortTodayMinor: 0,
      reconciledToday: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Assembler
// ---------------------------------------------------------------------------

export async function getRegisterActivity(): Promise<RegisterActivitySnapshot> {
  if (!isSupabaseServiceConfigured) return emptySnapshot();

  const nowISO = new Date().toISOString();
  const today = businessDayFor(nowISO);

  const [cockpit, cash, live, sessions, clock, recentShifts, orders]: [
    CockpitSnapshot,
    CashDrawerSummary,
    RegisterLive[],
    (DrawerSession & { register_name: string })[],
    { employee: Employee; punch: TimePunch }[],
    (Shift & { employee_name: string })[],
    OrderRow[],
  ] = await Promise.all([
    getCockpitSnapshot(),
    cashDrawerSummary(),
    liveRegisters(),
    recentSessions(60),
    onTheClock(),
    listRecentShifts(20),
    listOrders({ status: "all", limit: 40 }),
  ]);

  // --- KPIs -----------------------------------------------------------------
  const kpis: RegisterActivityKpis = {
    onlineSalesTodayMinor: cockpit.today.totalRevenueMinorUnits,
    onlineSalesDeltaPct: cockpit.deltas.revenue.pct,
    onlineSalesDeltaDir: cockpit.deltas.revenue.direction,
    activeOrders: cockpit.activeOrders,
    openDrawers: cash.openCount,
    registerCount: cash.registerCount,
    netOverShortTodayMinor: cash.netOverShortTodayMinor,
    awaitingReconcile: cash.awaitingReconcile,
  };

  // --- On the clock (shift management at-a-glance) --------------------------
  const onClock: OnClockRow[] = clock.map(({ employee, punch }) => ({
    employeeId: employee.id,
    name: employee.full_name,
    role: employee.job_role,
    clockInAtISO: punch.clock_in_at,
    clockInLabel: pacificClock(punch.clock_in_at),
    minutesOnClock: minutesBetween(punch.clock_in_at, nowISO),
  }));

  // --- Register activity (read-only, Lightspeed Shifts-Summary style) -------
  const registers: RegisterActivityRow[] = live.map((l) => {
    const s = l.openSession;
    return {
      registerId: l.register.id,
      name: l.register.name,
      kind: l.register.kind,
      open: Boolean(s),
      status: s ? s.status : "idle",
      openedByLabel: s?.opened_by ?? null,
      openedAtISO: s?.opened_at ?? null,
      openedAtLabel: s?.opened_at ? pacificClock(s.opened_at) : null,
      startingCashMinor: s?.opening_count_minor ?? null,
      droppedMinor: l.dropsMinor,
      expectedCloseMinor: s?.expected_close_minor ?? null,
    };
  });

  // --- Needs attention (manager-only oversight actions) ---------------------
  // Closed drawers awaiting reconcile, and reconciled tills awaiting verify.
  const attention: AttentionItem[] = [];
  for (const s of sessions) {
    if (s.status === "closed") {
      attention.push({
        sessionId: s.id,
        registerName: s.register_name,
        kind: "reconcile",
        businessDay: s.business_day,
        expectedCloseMinor: s.expected_close_minor,
        closingCountMinor: s.closing_count_minor,
      });
    } else if (s.status === "reconciled") {
      attention.push({
        sessionId: s.id,
        registerName: s.register_name,
        kind: "verify",
        businessDay: s.business_day,
        expectedCloseMinor: s.expected_close_minor,
        closingCountMinor: s.closing_count_minor,
      });
    }
  }

  // --- Live activity feed (REAL events only) --------------------------------
  const feed: ActivityEvent[] = [];

  for (const o of orders) {
    const name = [o.customer_first_name, o.customer_last_name].filter(Boolean).join(" ") || "Guest";
    // Placed / new.
    feed.push({
      id: `order-placed-${o.id}`,
      kind: "order_new",
      atISO: o.placed_at,
      atLabel: pacificClock(o.placed_at),
      title: `Order #${o.order_number} placed`,
      detail: `${name} · ${o.item_count} item${o.item_count === 1 ? "" : "s"}`,
      amountMinor: o.total_minor_units,
    });
    // Ready / completed / cancelled — only add the terminal event we have a timestamp for.
    if (o.status === "ready" && o.ready_at) {
      feed.push({
        id: `order-ready-${o.id}`,
        kind: "order_ready",
        atISO: o.ready_at,
        atLabel: pacificClock(o.ready_at),
        title: `Order #${o.order_number} marked ready`,
        detail: name,
        amountMinor: null,
      });
    } else if (o.status === "completed" && o.completed_at) {
      feed.push({
        id: `order-done-${o.id}`,
        kind: "order_completed",
        atISO: o.completed_at,
        atLabel: pacificClock(o.completed_at),
        title: `Order #${o.order_number} completed`,
        detail: name,
        amountMinor: o.total_minor_units,
      });
    } else if ((o.status === "cancelled" || o.status === "no_show") && o.updated_at) {
      feed.push({
        id: `order-cancel-${o.id}`,
        kind: "order_cancelled",
        atISO: o.updated_at,
        atLabel: pacificClock(o.updated_at),
        title: `Order #${o.order_number} ${o.status === "no_show" ? "no-show" : "cancelled"}`,
        detail: name,
        amountMinor: null,
      });
    }
  }
  void ORDER_STATUS_TIME; // kept for future status→timestamp expansion

  for (const s of sessions) {
    if (s.opened_at) {
      feed.push({
        id: `drawer-open-${s.id}`,
        kind: "drawer_open",
        atISO: s.opened_at,
        atLabel: pacificClock(s.opened_at),
        title: `${s.register_name} opened`,
        detail: s.opened_by ? `by ${s.opened_by}` : null,
        amountMinor: s.opening_count_minor,
      });
    }
    if (s.closed_at && (s.status === "closed" || s.status === "reconciled" || s.status === "verified")) {
      feed.push({
        id: `drawer-close-${s.id}`,
        kind: "drawer_closed",
        atISO: s.closed_at,
        atLabel: pacificClock(s.closed_at),
        title: `${s.register_name} closed`,
        detail: s.closed_by ? `by ${s.closed_by}` : null,
        amountMinor: s.closing_count_minor,
      });
    }
    if (s.reconciled_at && s.status === "reconciled") {
      feed.push({
        id: `drawer-recon-${s.id}`,
        kind: "drawer_reconciled",
        atISO: s.reconciled_at,
        atLabel: pacificClock(s.reconciled_at),
        title: `${s.register_name} reconciled`,
        detail: null,
        amountMinor: s.over_short_minor,
      });
    }
    if (s.reconciled_at && s.status === "verified") {
      feed.push({
        id: `drawer-verify-${s.id}`,
        kind: "drawer_verified",
        atISO: s.reconciled_at,
        atLabel: pacificClock(s.reconciled_at),
        title: `${s.register_name} verified`,
        detail: null,
        amountMinor: s.over_short_minor,
      });
    }
  }

  for (const { employee, punch } of clock) {
    feed.push({
      id: `clock-${punch.id}`,
      kind: "clock_in",
      atISO: punch.clock_in_at,
      atLabel: pacificClock(punch.clock_in_at),
      title: `${employee.full_name} clocked in`,
      detail: employee.job_role,
      amountMinor: null,
    });
  }

  feed.sort((a, b) => (a.atISO < b.atISO ? 1 : a.atISO > b.atISO ? -1 : 0));

  // reference recentShifts + today so the imports are used and available if we
  // later surface a "today's shifts" strip; keeps grounding explicit.
  void recentShifts;
  void today;

  return {
    configured: true,
    kpis,
    onClock,
    registers,
    attention,
    feed: feed.slice(0, 40),
    cash,
  };
}
