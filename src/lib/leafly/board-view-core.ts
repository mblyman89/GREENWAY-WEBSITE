/**
 * src/lib/leafly/board-view-core.ts
 *
 * SLICE L-28 — FILTERING AND SORTING THE LEAFLY ORDER BOARD.
 *
 * ===========================================================================
 * THE OWNER'S INSTRUCTION, VERBATIM
 * ===========================================================================
 *   "if we need to do a ui enhancement, then I would like to upgrade the
 *    panel to hide the finished orders exposing only the open ones. there
 *    would need to be a filter and sort feature added to it as well so its
 *    easy to find an order if needed."
 *
 * Three requirements, and the order they are written in is the order of
 * importance: hide the finished ones, let me filter, let me sort.
 *
 * ===========================================================================
 * WHY THIS IS A PURE MODULE AND NOT LOGIC INSIDE THE PANEL
 * ===========================================================================
 * The panel is a server component that needs a database and a Leafly account
 * to render. Every decision in this file — which orders are visible, what the
 * empty state should say, whether a live order is being hidden — is therefore
 * put here, where CI can prove it with plain values and no infrastructure.
 * That is the same split `order-ack-core.ts` and `bridge-core.ts` already
 * follow, and the reason is recorded in the panel's own header: "What this
 * component is allowed to decide: nothing."
 *
 * ===========================================================================
 * THE RULE THAT OUTRANKS THE OWNER'S REQUEST
 * ===========================================================================
 * A filter that can hide an order needing acknowledgement is the bug we just
 * spent a slice fixing, rebuilt deliberately in the UI. Leafly auto-cancels an
 * unacknowledged order after fifteen minutes, so "the operator could not see
 * it" costs a real customer a real order.
 *
 * So this module enforces an invariant that no filter choice can override:
 *
 *   NEVER SILENTLY HIDE A LIVE ORDER.
 *
 * `hiddenLiveCount` reports how many orders needing a human are outside the
 * current view. The panel is required to render a warning whenever it is
 * non-zero, and that requirement is asserted in CI. The operator may choose a
 * narrow view; he may not be kept ignorant of what the narrow view is costing
 * him.
 *
 * No imports, no `server-only` — safe for client, server and tests.
 */

import type { LeaflyWorkflowBucket } from "./bridge-core";

// ============================================================================
// 1. THE VOCABULARY
// ============================================================================

/**
 * What the operator asked to see.
 *
 * `open` is the DEFAULT, which is the whole point of the owner's request: the
 * board opens showing only what still needs somebody, and the finished orders
 * are one click away rather than in the way.
 */
export const BOARD_FILTERS = ["open", "accept_now", "attention", "closed", "all"] as const;
export type BoardFilter = (typeof BOARD_FILTERS)[number];

export const DEFAULT_BOARD_FILTER: BoardFilter = "open";

/** How the operator asked to order what he can see. */
export const BOARD_SORTS = ["urgency", "newest", "oldest"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

/**
 * `urgency` is the default and deliberately so. The only clock in this
 * integration that destroys a customer's order is the acknowledgement
 * deadline, so the default view answers "what runs out first?" rather than
 * "what happened most recently?".
 */
export const DEFAULT_BOARD_SORT: BoardSort = "urgency";

/**
 * Which buckets each filter admits.
 *
 * Expressed as data rather than a chain of `if`s so that adding a bucket is a
 * one-line change in one place, and so CI can assert that every bucket is
 * reachable through at least one filter — the check that would have caught an
 * order becoming invisible because a new bucket matched no filter at all.
 */
const FILTER_BUCKETS: Record<BoardFilter, readonly LeaflyWorkflowBucket[]> = {
  // "Open" means: somebody still has to do something. Everything except the
  // orders that are over.
  open: ["accept_now", "needs_attention", "to_build", "awaiting_pickup"],
  // The countdown bucket alone, for a busy evening when only the clock matters.
  accept_now: ["accept_now"],
  // The quiet failures.
  attention: ["needs_attention"],
  // What the owner asked to hide by default, available on demand.
  closed: ["closed"],
  all: ["accept_now", "needs_attention", "to_build", "awaiting_pickup", "closed"],
};

/** Human labels for the filter control. */
export function boardFilterLabel(filter: BoardFilter): string {
  switch (filter) {
    case "open":
      return "Open orders";
    case "accept_now":
      return "Needs accepting";
    case "attention":
      return "Needs attention";
    case "closed":
      return "Finished";
    case "all":
      return "All";
  }
}

/** Human labels for the sort control. */
export function boardSortLabel(sort: BoardSort): string {
  switch (sort) {
    case "urgency":
      return "Most urgent first";
    case "newest":
      return "Newest first";
    case "oldest":
      return "Oldest first";
  }
}

// ============================================================================
// 2. PARSING WHAT CAME OFF THE URL
// ============================================================================

/**
 * Turn a raw query-string value into a filter.
 *
 * Garbage becomes the default rather than an error or an empty screen. A
 * hand-edited or stale URL must never be able to produce a board showing
 * nothing — that is indistinguishable from "no orders", which is the exact
 * ambiguity this slice exists to remove.
 */
export function parseBoardFilter(raw: string | string[] | undefined | null): BoardFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? "").trim().toLowerCase();
  return (BOARD_FILTERS as readonly string[]).includes(trimmed)
    ? (trimmed as BoardFilter)
    : DEFAULT_BOARD_FILTER;
}

/** Same contract as `parseBoardFilter`, for the sort control. */
export function parseBoardSort(raw: string | string[] | undefined | null): BoardSort {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? "").trim().toLowerCase();
  return (BOARD_SORTS as readonly string[]).includes(trimmed)
    ? (trimmed as BoardSort)
    : DEFAULT_BOARD_SORT;
}

/**
 * Normalise a free-text search term.
 *
 * Lowercased and trimmed once here rather than per row, and an empty or
 * whitespace-only term becomes `null` meaning "no search" — so the caller
 * cannot accidentally filter every row out by searching for a space.
 */
export function parseBoardSearch(raw: string | string[] | undefined | null): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? "").trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

// ============================================================================
// 3. THE VIEW
// ============================================================================

/**
 * The minimum an order must expose to be filtered, searched and sorted.
 *
 * Deliberately structural rather than the database row type: the core stays
 * provable without importing anything server-side, and the panel passes its
 * real rows in because they already satisfy this shape.
 */
export type BoardViewRow = {
  bucket: LeaflyWorkflowBucket;
  /** Leafly's own order id, used for searching. */
  leaflyOrderId: string | null;
  /** Our local order id, also searchable — staff quote either one. */
  localOrderId: string | null;
  /** ISO acknowledgement deadline, or null when there isn't one. */
  acknowledgeBy: string | null;
  /** ISO timestamp of the last change, used by the newest/oldest sorts. */
  updatedAt: string;
};

export type BoardView<T extends BoardViewRow> = {
  /** The rows to render, already filtered, searched and sorted. */
  rows: T[];
  /** The active filter, after clamping. */
  filter: BoardFilter;
  /** The active sort, after clamping. */
  sort: BoardSort;
  /** The active search term, lowercased, or null. */
  search: string | null;
  /** How many rows exist in total, before filtering. */
  totalCount: number;
  /**
   * How many orders that still need a human are NOT in the current view.
   *
   * The safety valve. Non-zero means the operator is looking at a view that
   * is hiding work from him, and the panel MUST say so. See the header.
   */
  hiddenLiveCount: number;
  /**
   * How many rows the filter admitted before the search term was applied.
   * Lets the empty state distinguish "nothing matches that search" from
   * "this filter is genuinely empty", which are different problems with
   * different fixes.
   */
  matchedBeforeSearch: number;
};

/** The buckets that mean "somebody still has to do something". */
const LIVE_BUCKETS: readonly LeaflyWorkflowBucket[] = [
  "accept_now",
  "needs_attention",
  "to_build",
  "awaiting_pickup",
];

export function isLiveBucket(bucket: LeaflyWorkflowBucket): boolean {
  return LIVE_BUCKETS.includes(bucket);
}

/**
 * Does this row match the operator's search term?
 *
 * Substring, case-insensitive, against both ids. Staff read an id off a
 * screen or a printed ticket and usually quote only the last few characters,
 * so a substring match on the tail is the behaviour that matches the job. An
 * exact-match search would be technically tidier and useless at the counter.
 */
function matchesSearch(row: BoardViewRow, term: string): boolean {
  const haystacks = [row.leaflyOrderId, row.localOrderId];
  for (const h of haystacks) {
    if (typeof h === "string" && h.toLowerCase().includes(term)) return true;
  }
  return false;
}

/**
 * Compare two rows for the chosen sort.
 *
 * URGENCY. Soonest deadline first, because that is the order in which orders
 * die. Rows WITHOUT a deadline sort last rather than first: a missing
 * `acknowledge_by` is not urgent, and treating null as "very soon" would put
 * finished orders above a live countdown. Ties fall back to newest-first so
 * the order on screen is stable rather than dependent on row arrival.
 */
function compareRows(a: BoardViewRow, b: BoardViewRow, sort: BoardSort): number {
  if (sort === "urgency") {
    const ad = a.acknowledgeBy;
    const bd = b.acknowledgeBy;
    if (ad !== null && bd !== null) {
      if (ad !== bd) return ad < bd ? -1 : 1;
    } else if (ad !== null) {
      return -1;
    } else if (bd !== null) {
      return 1;
    }
    // Both null, or identical deadlines: newest change first.
    return a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0;
  }
  if (sort === "newest") {
    return a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0;
  }
  // oldest
  return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
}

/**
 * Apply the operator's filter, search and sort to a whole board.
 *
 * Pure. Does not mutate its input — the array is copied before sorting,
 * because sorting the caller's array in place would reorder the board behind
 * the back of anything else holding a reference to it.
 */
export function buildBoardView<T extends BoardViewRow>(
  rows: readonly T[],
  options: { filter?: BoardFilter; sort?: BoardSort; search?: string | null } = {},
): BoardView<T> {
  const filter = options.filter ?? DEFAULT_BOARD_FILTER;
  const sort = options.sort ?? DEFAULT_BOARD_SORT;
  const search = options.search ?? null;

  const allowed = FILTER_BUCKETS[filter];
  const byBucket = rows.filter((r) => allowed.includes(r.bucket));
  const matchedBeforeSearch = byBucket.length;

  const searched = search === null ? byBucket : byBucket.filter((r) => matchesSearch(r, search));

  // The safety valve. Counted against the FINAL visible set, not the
  // bucket-filtered one, because a search term hides orders just as
  // effectively as a filter does — and an operator hunting for one order must
  // still be told that three others are on a countdown he cannot see.
  const visible = new Set(searched);
  let hiddenLiveCount = 0;
  for (const r of rows) {
    if (isLiveBucket(r.bucket) && !visible.has(r)) hiddenLiveCount += 1;
  }

  return {
    rows: [...searched].sort((a, b) => compareRows(a, b, sort)),
    filter,
    sort,
    search,
    totalCount: rows.length,
    hiddenLiveCount,
    matchedBeforeSearch,
  };
}

/**
 * The sentence shown when the current view is empty.
 *
 * Returns null when there is something to show. Three different empty states,
 * because they have three different causes and three different remedies, and
 * one generic "no orders" message would hide all of them — the same failure
 * mode as the board that showed eight expired orders and called it a day.
 */
export function boardEmptyMessage<T extends BoardViewRow>(view: BoardView<T>): string | null {
  if (view.rows.length > 0) return null;
  if (view.totalCount === 0) {
    return "No Leafly orders yet. They appear here the moment one arrives.";
  }
  if (view.search !== null && view.matchedBeforeSearch > 0) {
    return `No orders match “${view.search}”. Clear the search to see the rest.`;
  }
  if (view.filter === "open") {
    return "Nothing needs you right now. Choose “Finished” to see completed orders.";
  }
  return "Nothing in this view. Choose “All” to see every order.";
}

/**
 * The warning shown when the current view is hiding live work.
 *
 * Returns null when nothing is hidden. Singular and plural are both spelled
 * out because "1 orders" on the one screen that matters is the kind of detail
 * that makes an operator distrust everything else on it.
 */
export function boardHiddenWarning<T extends BoardViewRow>(view: BoardView<T>): string | null {
  if (view.hiddenLiveCount <= 0) return null;
  const n = view.hiddenLiveCount;
  return n === 1
    ? "1 order still needs attention but is hidden by the current view. Choose “Open orders” to see it."
    : `${n} orders still need attention but are hidden by the current view. Choose “Open orders” to see them.`;
}

// ============================================================================
// 4. SELF-TESTS
// ============================================================================
// Run directly: `npx tsx src/lib/leafly/board-view-core.ts`
// Also executed by tests/compliance/leafly-l28-board-overflow.test.ts.

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function ok(label: string, value: boolean): void {
  if (!value) throw new Error(`${label}: expected true`);
}

export function runBoardViewSelfTests(): void {
  const row = (
    over: Partial<BoardViewRow> & { bucket: LeaflyWorkflowBucket },
  ): BoardViewRow => ({
    leaflyOrderId: "LFY-1",
    localOrderId: null,
    acknowledgeBy: null,
    updatedAt: "2026-09-23T10:00:00Z",
    ...over,
  });

  // ── The owner's exact board: 8 closed, 1 needing acceptance ──────────────
  const ownersBoard: BoardViewRow[] = [];
  for (let i = 1; i <= 8; i++) {
    ownersBoard.push(
      row({
        bucket: "closed",
        leaflyOrderId: `LFY-100${i}`,
        acknowledgeBy: `2026-09-23T0${i}:00:00Z`,
        updatedAt: `2026-09-23T0${i}:00:00Z`,
      }),
    );
  }
  ownersBoard.push(
    row({
      bucket: "accept_now",
      leaflyOrderId: "LFY-1009",
      acknowledgeBy: "2026-09-23T09:00:00Z",
      updatedAt: "2026-09-23T09:00:00Z",
    }),
  );

  const def = buildBoardView(ownersBoard);
  eq("default filter is open", def.filter, "open");
  eq("default view shows only the live order", def.rows.length, 1);
  eq("and it is the right one", def.rows[0].leaflyOrderId, "LFY-1009");
  eq("nothing live is hidden by the default view", def.hiddenLiveCount, 0);
  eq("no warning when nothing live is hidden", boardHiddenWarning(def), null);
  eq("no empty message when rows exist", boardEmptyMessage(def), null);

  // ── The finished orders are still reachable, not deleted ────────────────
  const closed = buildBoardView(ownersBoard, { filter: "closed" });
  eq("the eight finished orders are still there", closed.rows.length, 8);
  // ...but hiding the live one must warn.
  eq("hiding the live order is reported", closed.hiddenLiveCount, 1);
  ok("and the warning is singular", (boardHiddenWarning(closed) ?? "").startsWith("1 order "));

  const all = buildBoardView(ownersBoard, { filter: "all" });
  eq("all shows every order", all.rows.length, 9);
  eq("all hides nothing live", all.hiddenLiveCount, 0);

  // ── Sorting ─────────────────────────────────────────────────────────────
  const urgency = buildBoardView(ownersBoard, { filter: "all", sort: "urgency" });
  eq("urgency puts the soonest deadline first", urgency.rows[0].leaflyOrderId, "LFY-1001");
  const newest = buildBoardView(ownersBoard, { filter: "all", sort: "newest" });
  eq("newest puts the latest change first", newest.rows[0].leaflyOrderId, "LFY-1009");
  const oldest = buildBoardView(ownersBoard, { filter: "all", sort: "oldest" });
  eq("oldest puts the earliest change first", oldest.rows[0].leaflyOrderId, "LFY-1001");

  // A row with no deadline must sort LAST under urgency, never first.
  const mixed = [
    row({ bucket: "to_build", leaflyOrderId: "no-deadline", acknowledgeBy: null }),
    row({ bucket: "accept_now", leaflyOrderId: "has-deadline", acknowledgeBy: "2026-09-23T12:00:00Z" }),
  ];
  const mixedView = buildBoardView(mixed, { filter: "all", sort: "urgency" });
  eq("a deadline outranks no deadline", mixedView.rows[0].leaflyOrderId, "has-deadline");

  // ── Searching ───────────────────────────────────────────────────────────
  const found = buildBoardView(ownersBoard, { filter: "all", search: "1009" });
  eq("search finds by id fragment", found.rows.length, 1);
  eq("and returns the right row", found.rows[0].leaflyOrderId, "LFY-1009");

  const searchHidesLive = buildBoardView(ownersBoard, { filter: "all", search: "1001" });
  eq("a search that hides a live order reports it", searchHidesLive.hiddenLiveCount, 1);

  const localHit = buildBoardView(
    [row({ bucket: "to_build", leaflyOrderId: null, localOrderId: "GW-77" })],
    { filter: "all", search: "gw-77" },
  );
  eq("search matches the local id too, case-insensitively", localHit.rows.length, 1);

  const noHit = buildBoardView(ownersBoard, { filter: "all", search: "zzzz" });
  eq("a search with no hits is empty", noHit.rows.length, 0);
  ok(
    "and says so as a search problem",
    (boardEmptyMessage(noHit) ?? "").includes("No orders match"),
  );

  // ── Parsing ─────────────────────────────────────────────────────────────
  eq("garbage filter falls back", parseBoardFilter("nonsense"), "open");
  eq("missing filter falls back", parseBoardFilter(undefined), "open");
  eq("filter is case-insensitive", parseBoardFilter("CLOSED"), "closed");
  eq("array param takes the first", parseBoardFilter(["all", "closed"]), "all");
  eq("garbage sort falls back", parseBoardSort("sideways"), "urgency");
  eq("sort is case-insensitive", parseBoardSort("Newest"), "newest");
  eq("blank search is null", parseBoardSearch("   "), null);
  eq("search is lowercased", parseBoardSearch("  LFY-9 "), "lfy-9");

  // ── Structural guarantees ───────────────────────────────────────────────
  // Every bucket must be reachable, or an order type becomes invisible.
  const allBuckets: LeaflyWorkflowBucket[] = [
    "accept_now",
    "needs_attention",
    "to_build",
    "awaiting_pickup",
    "closed",
  ];
  for (const b of allBuckets) {
    const reachable = BOARD_FILTERS.some((f) => FILTER_BUCKETS[f].includes(b));
    ok(`bucket ${b} is reachable through some filter`, reachable);
    const inAll = FILTER_BUCKETS.all.includes(b);
    ok(`bucket ${b} is in the "all" filter`, inAll);
  }

  // Empty board.
  const none = buildBoardView([]);
  eq("an empty board is empty", none.rows.length, 0);
  ok("and says nothing has arrived", (boardEmptyMessage(none) ?? "").includes("No Leafly orders yet"));

  // Purity: the input array must not be reordered.
  const original = [
    row({ bucket: "closed", leaflyOrderId: "a", updatedAt: "2026-01-01T00:00:00Z" }),
    row({ bucket: "closed", leaflyOrderId: "b", updatedAt: "2026-02-01T00:00:00Z" }),
  ];
  const snapshot = original.map((r) => r.leaflyOrderId);
  buildBoardView(original, { filter: "all", sort: "newest" });
  eq("buildBoardView does not mutate its input", original.map((r) => r.leaflyOrderId), snapshot);
}

if (process.argv[1] && process.argv[1].endsWith("board-view-core.ts")) {
  runBoardViewSelfTests();
  console.log("board-view-core self-tests passed");
}
