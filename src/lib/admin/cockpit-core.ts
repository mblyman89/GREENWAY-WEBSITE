/**
 * cockpit-core.ts (Slice 64) — PURE, dependency-free math + formatting for the
 * POS dashboard cockpit. No server-only imports so it's tsx-unit-testable.
 *
 * Everything here operates on already-fetched, real data (sales reports, order
 * counts, drawer sessions, reorder suggestions). It computes day-over-day
 * deltas, the peak hour, a simple sparkline scale, and a drawer over/short
 * rollup — nothing is invented.
 */

// ── Money formatting (minor units → USD) ─────────────────────────────────────

export function formatMoneyMinor(minor: number): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const withCommas = dollars.toLocaleString("en-US");
  return `${neg ? "-" : ""}$${withCommas}.${String(cents).padStart(2, "0")}`;
}

/** Compact money for tiles ("$1.2k", "$3.4M"). */
export function formatMoneyCompact(minor: number): string {
  const dollars = Math.round(minor / 100);
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toLocaleString("en-US")}`;
}

// ── Day-over-day deltas ──────────────────────────────────────────────────────

export type Delta = {
  /** Signed absolute change (current − previous). */
  change: number;
  /** Percent change 0..∞ (null when previous is 0 and current > 0 → "new"). */
  pct: number | null;
  direction: "up" | "down" | "flat";
  /** True when previous was 0 but current > 0 (can't compute a %). */
  isNew: boolean;
};

export function computeDelta(current: number, previous: number): Delta {
  const change = current - previous;
  if (previous === 0) {
    return {
      change,
      pct: current === 0 ? 0 : null,
      direction: current > 0 ? "up" : "flat",
      isNew: current > 0,
    };
  }
  const pct = (change / Math.abs(previous)) * 100;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return { change, pct, direction, isNew: false };
}

/** Human label for a delta vs a comparison window (e.g. "▲ 12% vs yesterday"). */
export function deltaLabel(d: Delta, comparison = "yesterday"): string {
  if (d.isNew) return `New activity vs ${comparison}`;
  const arrow = d.direction === "up" ? "▲" : d.direction === "down" ? "▼" : "▬";
  const pct = d.pct === null ? "—" : `${Math.abs(Math.round(d.pct))}%`;
  return `${arrow} ${pct} vs ${comparison}`;
}

// ── Peak hour ────────────────────────────────────────────────────────────────

export type HourSlice = { hour: number; label: string; revenueMinorUnits: number; orders: number };

/** The hour with the most revenue so far. Returns null when there's no data. */
export function peakHour(hours: HourSlice[]): HourSlice | null {
  let best: HourSlice | null = null;
  for (const h of hours) {
    if (h.revenueMinorUnits <= 0) continue;
    if (!best || h.revenueMinorUnits > best.revenueMinorUnits) best = h;
  }
  return best;
}

// ── Sparkline / bar scaling ──────────────────────────────────────────────────

export type Bar = { label: string; value: number; heightPct: number };

/**
 * Scale a series into 0..100 height percentages against the series max, so a
 * bar chart can render without a plotting lib. Zero max → all zero.
 */
export function toBars(points: { label: string; value: number }[]): Bar[] {
  const max = points.reduce((m, p) => Math.max(m, p.value), 0);
  return points.map((p) => ({
    label: p.label,
    value: p.value,
    heightPct: max > 0 ? Math.round((p.value / max) * 100) : 0,
  }));
}

// ── Drawer over/short rollup ─────────────────────────────────────────────────

export type DrawerRollupInput = {
  status: "open" | "closed" | "reconciled" | "verified";
  over_short_minor: number | null;
};

export type DrawerRollup = {
  openCount: number;
  closedUnverifiedCount: number;
  verifiedCount: number;
  /** Sum of |over_short| across sessions that have a reconciled figure. */
  totalVarianceMinor: number;
  /** Sessions needing attention: closed-blind or with a non-zero variance not yet verified. */
  needsAttention: number;
};

export function rollupDrawers(sessions: DrawerRollupInput[]): DrawerRollup {
  let openCount = 0;
  let closedUnverifiedCount = 0;
  let verifiedCount = 0;
  let totalVarianceMinor = 0;
  let needsAttention = 0;
  for (const s of sessions) {
    if (s.status === "open") openCount += 1;
    else if (s.status === "verified") verifiedCount += 1;
    else closedUnverifiedCount += 1; // closed | reconciled

    if (typeof s.over_short_minor === "number") {
      totalVarianceMinor += Math.abs(s.over_short_minor);
      if (s.over_short_minor !== 0 && s.status !== "verified") needsAttention += 1;
    }
    if (s.over_short_minor === null && s.status !== "open") needsAttention += 1; // closed blind
  }
  return { openCount, closedUnverifiedCount, verifiedCount, totalVarianceMinor, needsAttention };
}

// ── Attention flags (what the cockpit surfaces as "needs you now") ──────────

export type AttentionFlag = { severity: "critical" | "warning" | "info"; text: string; href?: string };

export function buildAttentionFlags(input: {
  activeOrders: number;
  lowStockCount: number;
  drawers: DrawerRollup;
  publishedItems: number | null;
}): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  if (input.drawers.needsAttention > 0) {
    flags.push({
      severity: "critical",
      text: `${input.drawers.needsAttention} drawer${input.drawers.needsAttention === 1 ? "" : "s"} need${input.drawers.needsAttention === 1 ? "s" : ""} review (closed blind or over/short).`,
      href: "/admin/registers",
    });
  }
  if (input.activeOrders > 0) {
    flags.push({
      severity: input.activeOrders >= 5 ? "warning" : "info",
      text: `${input.activeOrders} open order${input.activeOrders === 1 ? "" : "s"} awaiting fulfillment.`,
      href: "/admin/orders",
    });
  }
  if (input.lowStockCount > 0) {
    flags.push({
      severity: input.lowStockCount >= 10 ? "warning" : "info",
      text: `${input.lowStockCount} product${input.lowStockCount === 1 ? "" : "s"} at or below the reorder point.`,
      href: "/admin/purchasing",
    });
  }
  if (input.publishedItems === null || input.publishedItems === 0) {
    flags.push({
      severity: "warning",
      text: "No live menu is published yet.",
      href: "/admin/menu-imports",
    });
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Tests (tsx-runnable)
// ---------------------------------------------------------------------------

export function __runCockpitTests(): { passed: number } {
  let passed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error("FAIL: " + msg);
    passed += 1;
  };

  // money
  assert(formatMoneyMinor(0) === "$0.00", "zero money");
  assert(formatMoneyMinor(123456) === "$1,234.56", "thousands");
  assert(formatMoneyMinor(-500) === "-$5.00", "negative money");
  assert(formatMoneyMinor(99) === "$0.99", "cents only");
  assert(formatMoneyCompact(150000) === "$1.5k", "compact k");
  assert(formatMoneyCompact(250000000) === "$2.5M", "compact M");
  assert(formatMoneyCompact(45000) === "$450", "compact small");

  // delta
  const up = computeDelta(120, 100);
  assert(up.direction === "up" && Math.round(up.pct as number) === 20, "up 20%");
  const down = computeDelta(80, 100);
  assert(down.direction === "down" && Math.round(down.pct as number) === -20, "down -20%");
  const flat = computeDelta(100, 100);
  assert(flat.direction === "flat" && flat.pct === 0, "flat");
  const fromZero = computeDelta(50, 0);
  assert(fromZero.isNew && fromZero.pct === null, "new from zero");
  const bothZero = computeDelta(0, 0);
  assert(bothZero.pct === 0 && !bothZero.isNew, "both zero");
  assert(deltaLabel(up).includes("20%") && deltaLabel(up).includes("▲"), "delta label up");
  assert(deltaLabel(fromZero).startsWith("New"), "delta label new");

  // peak hour
  const hours: HourSlice[] = [
    { hour: 9, label: "9 AM", revenueMinorUnits: 0, orders: 0 },
    { hour: 12, label: "12 PM", revenueMinorUnits: 5000, orders: 3 },
    { hour: 17, label: "5 PM", revenueMinorUnits: 9000, orders: 5 },
  ];
  assert(peakHour(hours)?.hour === 17, "peak hour 5pm");
  assert(peakHour([]) === null, "no peak when empty");
  assert(peakHour([{ hour: 1, label: "1 AM", revenueMinorUnits: 0, orders: 0 }]) === null, "no peak all zero");

  // bars
  const bars = toBars([
    { label: "a", value: 50 },
    { label: "b", value: 100 },
    { label: "c", value: 0 },
  ]);
  assert(bars[1].heightPct === 100 && bars[0].heightPct === 50 && bars[2].heightPct === 0, "bar scaling");
  assert(toBars([{ label: "z", value: 0 }])[0].heightPct === 0, "all-zero bars");

  // drawer rollup
  const roll = rollupDrawers([
    { status: "open", over_short_minor: null },
    { status: "verified", over_short_minor: 0 },
    { status: "closed", over_short_minor: -250 }, // over/short, not verified → attention
    { status: "reconciled", over_short_minor: null }, // closed blind → attention
  ]);
  assert(roll.openCount === 1, "1 open");
  assert(roll.verifiedCount === 1, "1 verified");
  assert(roll.closedUnverifiedCount === 2, "2 closed/reconciled");
  assert(roll.totalVarianceMinor === 250, "variance sum");
  assert(roll.needsAttention === 2, "2 need attention");

  // attention flags
  const flags = buildAttentionFlags({
    activeOrders: 6,
    lowStockCount: 12,
    drawers: roll,
    publishedItems: 0,
  });
  assert(flags.some((f) => f.severity === "critical"), "drawer critical flag");
  assert(flags.some((f) => f.text.includes("6 open orders")), "orders flag");
  assert(flags.some((f) => f.text.includes("12 products")), "low stock flag");
  assert(flags.some((f) => f.text.includes("No live menu")), "no menu flag");

  const noFlags = buildAttentionFlags({
    activeOrders: 0,
    lowStockCount: 0,
    drawers: { openCount: 1, closedUnverifiedCount: 0, verifiedCount: 2, totalVarianceMinor: 0, needsAttention: 0 },
    publishedItems: 120,
  });
  assert(noFlags.length === 0, "no flags when all clear");

  return { passed };
}
