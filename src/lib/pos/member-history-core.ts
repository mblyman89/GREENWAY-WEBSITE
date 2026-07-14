/**
 * src/lib/pos/member-history-core.ts  (POS Slice B29)
 *
 * PURE shaping for the register's MEMBER PURCHASE HISTORY panel. No
 * `server-only`, no DB — safe for tests and the tsx self-test harness.
 *
 * Why this exists: the single highest-value thing a budtender can do with a
 * regular is remember them — "the usual?" is the moment every big player's
 * POS (Dutchie, Cova, Flowhub) optimizes for. B29 gives the register a
 * privacy-BUDGETED window into an attached member's history:
 *
 *   - their last few completed purchases (when, what, how much), and
 *   - their FAVORITES (top products by lifetime quantity across the window),
 *
 * and deliberately nothing else. No contact details, no notes, no
 * birthdate — the B14 lookup already set that privacy budget and this
 * module keeps it. The response may sit in iPad memory; keep it lean.
 *
 * Money in MINOR UNITS (cents) everywhere.
 */

// ── Privacy budget ──────────────────────────────────────────────────────────
/** How many recent completed purchases the register may see. */
export const HISTORY_ORDER_LIMIT = 5;
/** How many favorite products the register may see. */
export const FAVORITES_LIMIT = 3;
/** Max item lines echoed per historical purchase (the rest summarized). */
export const HISTORY_LINES_PER_ORDER = 4;

// ── Shapes ──────────────────────────────────────────────────────────────────

/** One historical order's raw material (store-fetched, already completed). */
export type HistoryOrderInput = {
  orderId: string;
  completedAtIso: string | null;
  totalMinor: number;
  lines: { productName: string; quantity: number }[];
};

export type HistoryPurchase = {
  orderId: string;
  /** Pacific calendar date of the purchase, e.g. "Feb 8". */
  dateLabel: string;
  totalMinor: number;
  itemCount: number;
  /** First HISTORY_LINES_PER_ORDER lines as "2x Blue Dream 3.5g". */
  items: string[];
  /** Lines beyond the echo cap, e.g. 2 → "+ 2 more". 0 = none. */
  moreCount: number;
};

export type MemberFavorite = {
  productName: string;
  /** Total units across the history window. */
  totalQuantity: number;
  /** How many separate purchases included it. */
  orderCount: number;
};

export type MemberHistory = {
  purchases: HistoryPurchase[];
  favorites: MemberFavorite[];
};

// ── Shaping ─────────────────────────────────────────────────────────────────

/** Pacific calendar label ("Feb 8" / "Feb 8, 2025" when not this year). */
export function pacificDateLabel(iso: string | null, nowIso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date(nowIso);
  const sameYear =
    Number.isFinite(now.getTime()) &&
    d.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", year: "numeric" }) ===
      now.toLocaleDateString("en-US", { timeZone: "America/Los_Angeles", year: "numeric" });
  return d.toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/**
 * Shape completed orders (newest first expected from the store) into the
 * register's privacy-budgeted history: recent purchases + favorites. Pure
 * and deterministic; defensive on malformed rows (skips, never NaNs).
 */
export function buildMemberHistory(orders: HistoryOrderInput[], nowIso: string): MemberHistory {
  const window = orders.slice(0, HISTORY_ORDER_LIMIT);

  const purchases: HistoryPurchase[] = window.map((o) => {
    const lines = (o.lines ?? []).filter(
      (l) => l && typeof l.productName === "string" && Number.isInteger(l.quantity) && l.quantity > 0,
    );
    const shown = lines.slice(0, HISTORY_LINES_PER_ORDER);
    return {
      orderId: o.orderId,
      dateLabel: pacificDateLabel(o.completedAtIso, nowIso),
      totalMinor: Number.isInteger(o.totalMinor) && o.totalMinor >= 0 ? o.totalMinor : 0,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      items: shown.map((l) => `${l.quantity}x ${l.productName}`),
      moreCount: Math.max(0, lines.length - shown.length),
    };
  });

  // Favorites: total quantity across the window, ties broken by order count
  // then name (stable + deterministic).
  const tally = new Map<string, { totalQuantity: number; orderCount: number }>();
  for (const o of window) {
    const seenThisOrder = new Set<string>();
    for (const l of o.lines ?? []) {
      if (!l || typeof l.productName !== "string" || !Number.isInteger(l.quantity) || l.quantity <= 0) continue;
      const key = l.productName.trim();
      if (!key) continue;
      const cur = tally.get(key) ?? { totalQuantity: 0, orderCount: 0 };
      cur.totalQuantity += l.quantity;
      if (!seenThisOrder.has(key)) {
        cur.orderCount += 1;
        seenThisOrder.add(key);
      }
      tally.set(key, cur);
    }
  }
  const favorites: MemberFavorite[] = [...tally.entries()]
    .map(([productName, t]) => ({ productName, ...t }))
    .sort(
      (a, b) =>
        b.totalQuantity - a.totalQuantity ||
        b.orderCount - a.orderCount ||
        a.productName.localeCompare(b.productName),
    )
    .slice(0, FAVORITES_LIMIT);

  return { purchases, favorites };
}

// ── Embedded self-tests ─────────────────────────────────────────────────────

export function __runMemberHistoryCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const NOW = "2026-02-10T20:00:00Z";

  // Date labels: Pacific calendar, year shown only when different.
  ok(pacificDateLabel("2026-02-08T19:30:00Z", NOW) === "Feb 8", "same-year label omits the year");
  ok(pacificDateLabel("2025-11-30T19:30:00Z", NOW) === "Nov 30, 2025", "prior-year label includes the year");
  // 2026-01-01T05:00Z is Dec 31, 2025 in Pacific — the label must roll back.
  ok(pacificDateLabel("2026-01-01T05:00:00Z", NOW) === "Dec 31, 2025", "UTC date rolls back across Pacific midnight");
  ok(pacificDateLabel(null, NOW) === "—" && pacificDateLabel("garbage", NOW) === "—", "missing/bad timestamp → em-dash");

  const orders: HistoryOrderInput[] = [
    {
      orderId: "o1",
      completedAtIso: "2026-02-08T19:30:00Z",
      totalMinor: 4550,
      lines: [
        { productName: "Blue Dream 3.5g", quantity: 2 },
        { productName: "OG Kush Pre-roll", quantity: 1 },
        { productName: "Gummies 100mg", quantity: 1 },
        { productName: "Vape Cart 1g", quantity: 1 },
        { productName: "Lighter", quantity: 1 },
      ],
    },
    {
      orderId: "o2",
      completedAtIso: "2026-01-20T19:30:00Z",
      totalMinor: 2000,
      lines: [{ productName: "Blue Dream 3.5g", quantity: 1 }],
    },
    {
      orderId: "o3",
      completedAtIso: "2025-12-05T19:30:00Z",
      totalMinor: 3000,
      lines: [
        { productName: "Gummies 100mg", quantity: 3 },
        { productName: "bad", quantity: 0 }, // malformed: skipped
      ],
    },
  ];

  const h = buildMemberHistory(orders, NOW);

  // Purchases: shaping, caps, counts.
  ok(h.purchases.length === 3, "all (≤ limit) purchases shaped");
  ok(h.purchases[0].dateLabel === "Feb 8" && h.purchases[0].totalMinor === 4550, "purchase date + total");
  ok(h.purchases[0].itemCount === 6, "itemCount sums quantities");
  ok(h.purchases[0].items.length === 4 && h.purchases[0].moreCount === 1, "line echo capped with moreCount");
  ok(h.purchases[0].items[0] === "2x Blue Dream 3.5g", "items formatted as Nx Name");
  ok(h.purchases[2].itemCount === 3, "malformed line skipped from counts");

  // Favorites: quantity-ranked, order-count tie-break, capped.
  ok(h.favorites.length === 3, "favorites capped at FAVORITES_LIMIT");
  ok(h.favorites[0].productName === "Gummies 100mg" && h.favorites[0].totalQuantity === 4, "top favorite by quantity");
  ok(
    h.favorites[1].productName === "Blue Dream 3.5g" && h.favorites[1].orderCount === 2,
    "second favorite carries order count",
  );

  // Window cap: only the newest HISTORY_ORDER_LIMIT orders count.
  const many = Array.from({ length: 8 }, (_, i) => ({
    orderId: `m${i}`,
    completedAtIso: "2026-02-01T19:30:00Z",
    totalMinor: 100,
    lines: [{ productName: i < HISTORY_ORDER_LIMIT ? "InWindow" : "OutOfWindow", quantity: 1 }],
  }));
  const capped = buildMemberHistory(many, NOW);
  ok(capped.purchases.length === HISTORY_ORDER_LIMIT, "purchase window capped");
  ok(
    capped.favorites.every((f) => f.productName === "InWindow"),
    "favorites never see beyond the window",
  );

  // Empty history.
  const empty = buildMemberHistory([], NOW);
  ok(empty.purchases.length === 0 && empty.favorites.length === 0, "empty history is empty, not an error");

  // Defensive: garbage total → 0.
  const bad = buildMemberHistory(
    [{ orderId: "x", completedAtIso: null, totalMinor: 45.5, lines: [] }],
    NOW,
  );
  ok(bad.purchases[0].totalMinor === 0 && bad.purchases[0].dateLabel === "—", "bad total/date sanitized");

  if (fail > 0) throw new Error(`member-history-core self-tests: ${fail} FAILED (${pass} passed)`);
  console.log(`member-history-core self-tests: ALL PASS (${pass} assertions)`);
}
