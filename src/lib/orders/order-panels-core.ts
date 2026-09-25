/**
 * src/lib/orders/order-panels-core.ts
 *
 * SLICE L-40 — TWO ORDER PANELS THAT LOOK AND BEHAVE IDENTICALLY.
 *
 * The owner, verbatim:
 *
 *   > "I want it to look identical to our section above it. our orders section
 *   >  should be labeled greenway orders, and the leafly section remains
 *   >  labeled leafly orders. but the search bar and sort and filters should
 *   >  look and behave identically. ... our system auto acknowledges leafly
 *   >  orders, so there is no 15 minute limit we need to obey ... so I want to
 *   >  remove the leafly section moving above our section. I just want the two
 *   >  panels/ sections to be identical and behave identically."
 *
 * "Behave identically" is a claim about RULES, and rules that live in JSX
 * cannot be executed by CI. So every rule both panels share is decided here,
 * once, in pure functions with embedded self-tests:
 *
 *   1. THE TABS — one list (Active, New, Acknowledged, Preparing, Ready,
 *      Completed, Cancelled, No-show, All) and one meaning for each.
 *   2. THE URL — each panel has its own params (ours keep their historical
 *      names so old bookmarks still work; Leafly's are `l`-prefixed), each is
 *      validated by the SAME grammar (list-filter-core), and every link either
 *      panel builds carries the OTHER panel's view along unchanged. Filtering
 *      one panel never resets the other.
 *   3. WHAT A LEAFLY ORDER'S STATUS IS — Leafly orders are shown in our
 *      vocabulary (New → Completed), because the tabs are ours. See
 *      `leaflyPanelStatus` for the mapping and why each branch is what it is.
 *   4. FILTER, SEARCH, SORT, PAGE — for Leafly the rows are already in memory
 *      (the board reader), so the same semantics the database applies to our
 *      orders are applied here. The sort is not re-typed: it is DRIVEN by the
 *      `ORDER_SORTS` menu itself, so a new sort added for our orders applies to
 *      Leafly automatically (or fails the self-tests if it names a column this
 *      file cannot read). Search reuses the Leafly board's existing matcher.
 *   5. THE SAFETY LINE — a view may never silently hide a Leafly order that
 *      needs a person (the L-28 invariant). Auto-acknowledge makes that rare;
 *      it does not make it impossible (the switch can be off, a push can fail).
 *
 * No I/O. No React. No clock. Safe to import from anywhere.
 */
import {
  ACTIVE_ORDER_STATUSES,
  type OrderStatus,
} from "./types";
import {
  ORDER_SORTS,
  endOfDayIso,
  parseDollarsToMinor,
  parseIsoDate,
  resolveSort,
  type SortColumn,
} from "@/lib/admin/list-filter-core";
import {
  DEFAULT_PAGE_SIZE,
  listWindow,
  parsePageParam,
  type ListWindow,
} from "@/lib/admin/list-window-core";
import {
  leaflyDisplayLabel,
  placeLeaflyOrder,
  type LeaflyWorkflowBucket,
  type LeaflyWorkflowPlacement,
} from "@/lib/leafly/bridge-core";
import { buildBoardView, isLiveBucket, parseBoardSearch } from "@/lib/leafly/board-view-core";
import { leaflySearchTerms } from "./order-board-split-core";

// ============================================================================
// 1. THE TABS
// ============================================================================

/** Every order status, in lifecycle order. */
export const ALL_ORDER_STATUSES: readonly OrderStatus[] = [
  "new",
  "acknowledged",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "no_show",
];

/** A status tab key: a real status, or one of the two groupings. */
export type OrdersPanelStatus = OrderStatus | "active" | "all";

/** The tabs, in the order they render. Shared by both panels. */
export const ORDERS_PANEL_TABS: readonly { key: OrdersPanelStatus; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "new", label: "New" },
  { key: "acknowledged", label: "Acknowledged" },
  { key: "preparing", label: "Preparing" },
  { key: "ready", label: "Ready" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "no_show", label: "No-show" },
  { key: "all", label: "All" },
];

export const DEFAULT_PANEL_STATUS: OrdersPanelStatus = "active";

/**
 * Validate a raw status param. Unknown → the default (Active), never an empty
 * list: a stale or hand-edited link must not look like "no orders".
 *
 * Before L-40 our panel passed the raw string straight to the query, so
 * `?status=bogus` asked the database for status "bogus" and showed nothing.
 */
export function parsePanelStatus(raw: string | string[] | undefined | null): OrdersPanelStatus {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  return ORDERS_PANEL_TABS.some((t) => t.key === v) ? (v as OrdersPanelStatus) : DEFAULT_PANEL_STATUS;
}

/** Does an order in `status` belong in the `tab` view? One rule, both panels. */
export function statusInTab(status: OrderStatus, tab: OrdersPanelStatus): boolean {
  if (tab === "all") return true;
  if (tab === "active") return ACTIVE_ORDER_STATUSES.includes(status);
  return status === tab;
}

// ============================================================================
// 2. THE URL
// ============================================================================

export const ORDERS_PANELS = ["greenway", "leafly"] as const;
export type OrdersPanelKey = (typeof ORDERS_PANELS)[number];

export type PanelParamNames = {
  status: string;
  q: string;
  from: string;
  to: string;
  min: string;
  max: string;
  sort: string;
  page: string;
};

/**
 * Each panel's query-string names.
 *
 * Ours keep the names they have always had, so a bookmarked or shared link to
 * a filtered view of our orders still opens that view. Leafly's are prefixed
 * with `l` so one form can never drive the other panel.
 */
export const ORDERS_PANEL_PARAMS: Record<OrdersPanelKey, PanelParamNames> = {
  greenway: { status: "status", q: "q", from: "from", to: "to", min: "min", max: "max", sort: "sort", page: "page" },
  leafly: {
    status: "lstatus",
    q: "lq",
    from: "lfrom",
    to: "lto",
    min: "lmin",
    max: "lmax",
    sort: "lsort",
    page: "lpage",
  },
};

/** Where each panel lives on the page, so a link can land on it. */
export const ORDERS_PANEL_ANCHORS: Record<OrdersPanelKey, string> = {
  greenway: "greenway-orders",
  leafly: "leafly-orders",
};

export type SearchParamsLike = Record<string, string | string[] | undefined>;

/** One panel's validated view. */
export type OrdersPanelQuery = {
  status: OrdersPanelStatus;
  /** Trimmed search text; "" when off. */
  search: string;
  /** A key of ORDER_SORTS (validated). */
  sortKey: string;
  sortColumns: SortColumn[];
  /** yyyy-mm-dd, validated. */
  placedFrom?: string;
  /** yyyy-mm-dd, validated (the date the operator typed). */
  placedToDate?: string;
  /** End-of-day timestamp for `placedToDate` (what the filter compares to). */
  placedTo?: string;
  totalMin?: number;
  totalMax?: number;
  /** What the operator typed, echoed back into the box when it parsed. */
  minRaw: string;
  maxRaw: string;
  /** Requested page (1-based, unclamped). */
  page: number;
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Read one panel's view from the URL through the shared grammar. Garbage in
 * any knob means "that filter off" — never an exception, never an empty list.
 */
export function parseOrdersPanelQuery(
  sp: SearchParamsLike | null | undefined,
  panel: OrdersPanelKey,
): OrdersPanelQuery {
  const names = ORDERS_PANEL_PARAMS[panel];
  const get = (k: keyof PanelParamNames) => first(sp?.[names[k]]);
  const sort = resolveSort(get("sort"), ORDER_SORTS);
  const placedToDate = parseIsoDate(get("to"));
  const minRaw = (get("min") ?? "").trim();
  const maxRaw = (get("max") ?? "").trim();
  const totalMin = parseDollarsToMinor(minRaw);
  const totalMax = parseDollarsToMinor(maxRaw);
  return {
    status: parsePanelStatus(get("status")),
    search: (get("q") ?? "").trim(),
    sortKey: sort.key,
    sortColumns: sort.columns,
    placedFrom: parseIsoDate(get("from")),
    placedToDate,
    placedTo: placedToDate ? endOfDayIso(placedToDate) : undefined,
    totalMin,
    totalMax,
    minRaw: totalMin != null ? minRaw : "",
    maxRaw: totalMax != null ? maxRaw : "",
    page: parsePageParam(get("page")),
  };
}

/** Anything beyond status/search narrowing the view (drives "Clear"). */
export function panelHasExtraFilters(q: OrdersPanelQuery): boolean {
  return Boolean(
    q.search ||
      q.placedFrom ||
      q.placedToDate ||
      q.totalMin != null ||
      q.totalMax != null ||
      q.sortKey !== ORDER_SORTS[0].key,
  );
}

/** A panel's view as [name, value] pairs, defaults omitted. */
export function panelQueryEntries(q: OrdersPanelQuery, panel: OrdersPanelKey): [string, string][] {
  const n = ORDERS_PANEL_PARAMS[panel];
  const out: [string, string][] = [];
  if (q.status !== DEFAULT_PANEL_STATUS) out.push([n.status, q.status]);
  if (q.search) out.push([n.q, q.search]);
  if (q.sortKey !== ORDER_SORTS[0].key) out.push([n.sort, q.sortKey]);
  if (q.placedFrom) out.push([n.from, q.placedFrom]);
  if (q.placedToDate) out.push([n.to, q.placedToDate]);
  if (q.totalMin != null && q.minRaw) out.push([n.min, q.minRaw]);
  if (q.totalMax != null && q.maxRaw) out.push([n.max, q.maxRaw]);
  if (q.page > 1) out.push([n.page, String(q.page)]);
  return out;
}

/** The panel that is not `panel`. */
export function otherPanel(panel: OrdersPanelKey): OrdersPanelKey {
  return panel === "greenway" ? "leafly" : "greenway";
}

/**
 * Hidden inputs for a panel's GET form: the OTHER panel's view, so pressing
 * Apply on one panel leaves the other exactly as it was.
 */
export function preservedFields(sp: SearchParamsLike | null | undefined, panel: OrdersPanelKey): [string, string][] {
  const other = otherPanel(panel);
  return panelQueryEntries(parseOrdersPanelQuery(sp, other), other);
}

export type PanelHrefChange =
  | { kind: "status"; status: OrdersPanelStatus }
  | { kind: "page"; page: number }
  | { kind: "clear" };

/**
 * A link for one panel: that panel changed as asked, the other carried over.
 *
 * Built only from the two panels' OWN params, so one-shot banners
 * (`leaflyMsg`, `poolMsg`, `printTest` …) are dropped rather than re-shown,
 * and the legacy L-28 params (`lfilter`) fall away. Every link lands on the
 * panel it belongs to (`#greenway-orders` / `#leafly-orders`).
 *
 * Status and Clear reset the page to 1 (the old page number means nothing in
 * the new view). Clear keeps the status tab, exactly as our panel always has.
 */
export function panelHref(
  sp: SearchParamsLike | null | undefined,
  panel: OrdersPanelKey,
  change: PanelHrefChange,
): string {
  const params = new URLSearchParams();
  for (const p of ORDERS_PANELS) {
    let q = parseOrdersPanelQuery(sp, p);
    if (p === panel) {
      if (change.kind === "status") q = { ...q, status: change.status, page: 1 };
      else if (change.kind === "page") q = { ...q, page: change.page };
      else
        q = {
          ...parseOrdersPanelQuery({}, p),
          status: q.status,
        };
    }
    for (const [k, v] of panelQueryEntries(q, p)) params.set(k, v);
  }
  const qs = params.toString();
  return `/admin/orders${qs ? `?${qs}` : ""}#${ORDERS_PANEL_ANCHORS[panel]}`;
}

/** The GET form's action: the page itself, landing back on this panel. */
export function panelFormAction(panel: OrdersPanelKey): string {
  return `/admin/orders#${ORDERS_PANEL_ANCHORS[panel]}`;
}

// ============================================================================
// 3. WHAT A LEAFLY ORDER'S STATUS IS, IN OUR WORDS
// ============================================================================

/** The fields of a Leafly board row this core reads. */
export type LeaflyPanelSource = {
  id: string;
  leafly_order_id: string | null;
  leafly_status: string | null;
  acknowledged_at: string | null;
  acknowledge_by: string | null;
  canceled_at: string | null;
  local_order_id: string | null;
  first_seen_at: string;
  updated_at: string;
  announced_at?: string | null;
  printed_at?: string | null;
};

/** The fields of our copy of a Leafly order this core reads. */
export type LeaflyPanelLocal = {
  status: string;
  placed_at: string;
  total_minor_units: number;
  item_count?: number;
  order_number?: string | null;
  display_name?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_phone?: string | null;
};

function isOrderStatus(v: unknown): v is OrderStatus {
  return typeof v === "string" && (ALL_ORDER_STATUSES as readonly string[]).includes(v);
}

/**
 * A Leafly order's status in OUR vocabulary.
 *
 *   - LINKED (we hold a copy): our copy's status, full stop. Once a Leafly
 *     order is accepted, our copy is what the floor works from — it is what
 *     the details page moves along, what the register reads, and what the
 *     bridge keeps in step with Leafly (forward only). If Leafly cancels an
 *     order somebody already started, our copy deliberately stays open until
 *     the till answers what happened to the product (bridge-core
 *     decideCancelPlan), so it correctly stays in "Active" until then.
 *   - NOT LINKED, finished at Leafly: cancelled/expired → Cancelled;
 *     picked up → Completed.
 *   - NOT LINKED, not accepted yet → New. It has not been started by anyone.
 *   - NOT LINKED, accepted but no copy was made → Acknowledged (that is
 *     literally true, and it keeps the order in Active where a person will
 *     see its "never reached the register" warning).
 *
 * If our copy exists but could not be read (the linked read timed out), the
 * Leafly-side answer is used: degraded, never invented.
 */
export function leaflyPanelStatus(order: LeaflyPanelSource, local?: LeaflyPanelLocal | null): OrderStatus {
  if (local && isOrderStatus(local.status)) return local.status;
  const s = (order.leafly_status ?? "").trim();
  if (order.canceled_at !== null || s === "canceled" || s === "expired") return "cancelled";
  if (s === "picked_up") return "completed";
  if (order.acknowledged_at === null) return "new";
  if (s === "ready") return "ready";
  return "acknowledged";
}

/** One Leafly order, flattened for filtering, sorting and rendering. */
export type LeaflyPanelRow<O extends LeaflyPanelSource = LeaflyPanelSource, L extends LeaflyPanelLocal = LeaflyPanelLocal> = {
  order: O;
  local: L | null;
  status: OrderStatus;
  /**
   * The workflow placement, computed ONCE per row. The bucket drives the
   * safety line (needsPerson) and the placement's pipeline warning is shown
   * on the row, so the two can never disagree about the same order.
   */
  placement: LeaflyWorkflowPlacement;
  bucket: LeaflyWorkflowBucket;
  /** True when a person has to act (not accepted yet, or accepted with no copy). */
  needsPerson: boolean;
  placedAt: string;
  totalMinor: number | null;
  firstName: string;
  // ── the fields the Leafly board's search matcher reads (board-view-core) ──
  leaflyOrderId: string | null;
  localOrderId: string | null;
  acknowledgeBy: string | null;
  updatedAt: string;
  searchTerms: string[];
};

/** The buckets that mean "a person must act" — not merely "work in progress". */
const NEEDS_PERSON: readonly LeaflyWorkflowBucket[] = ["accept_now", "needs_attention"];

export function toLeaflyPanelRows<O extends LeaflyPanelSource, L extends LeaflyPanelLocal>(
  orders: readonly O[],
  linked?: ReadonlyMap<string, L> | null,
): LeaflyPanelRow<O, L>[] {
  return orders.map((order) => {
    const local = order.local_order_id ? (linked?.get(order.local_order_id) ?? null) : null;
    const placement = placeLeaflyOrder({
      leaflyOrderId: order.leafly_order_id,
      leaflyStatus: order.leafly_status,
      acknowledgedAt: order.acknowledged_at,
      canceledAt: order.canceled_at,
      localOrderId: order.local_order_id,
      announcedAt: order.announced_at,
      printedAt: order.printed_at,
    });
    const bucket = placement.bucket;
    const leaflyId = (order.leafly_order_id ?? "").trim();
    return {
      order,
      local,
      status: leaflyPanelStatus(order, local),
      placement,
      bucket,
      needsPerson: NEEDS_PERSON.includes(bucket) && isLiveBucket(bucket),
      placedAt: local?.placed_at ?? order.first_seen_at,
      totalMinor: local ? local.total_minor_units : null,
      firstName: (local?.customer_first_name ?? "").trim(),
      leaflyOrderId: order.leafly_order_id,
      localOrderId: order.local_order_id,
      acknowledgeBy: order.acknowledge_by,
      updatedAt: order.updated_at,
      // Staff quote the LF- label from the receipt, our order number, the
      // customer's name or phone. The label is added for UNLINKED orders too,
      // because that is the only handle printed on their arrival ticket.
      searchTerms: [...(leaflyId ? [leaflyDisplayLabel(leaflyId)] : []), ...leaflySearchTerms(local)],
    };
  });
}

// ============================================================================
// 4. FILTER, SEARCH, SORT, PAGE
// ============================================================================

export type StatusCounts = Record<OrderStatus, number>;

export function countByStatus(rows: readonly { status: OrderStatus }[]): StatusCounts {
  const out = Object.fromEntries(ALL_ORDER_STATUSES.map((s) => [s, 0])) as StatusCounts;
  for (const r of rows) out[r.status] += 1;
  return out;
}

/** New + Acknowledged + Preparing + Ready — the "Active total" card. */
export function activeTotal(counts: StatusCounts): number {
  return ACTIVE_ORDER_STATUSES.reduce((n, s) => n + counts[s], 0);
}

/**
 * How many orders a status tab holds, from per-status counts. Both panels
 * show this beside each tab, so "Ready 3" means the same thing in each.
 * "All" is every status; "Active" is the four open ones.
 */
export function tabCount(counts: StatusCounts, tab: OrdersPanelStatus): number {
  if (tab === "all") return ALL_ORDER_STATUSES.reduce((n, s) => n + counts[s], 0);
  if (tab === "active") return activeTotal(counts);
  return counts[tab];
}

/**
 * The Leafly list is read with a cap (the board loader's limit). When the
 * cap is reached, say so: the counts and the "All" tab cover what was loaded,
 * and an operator must not read them as the shop's lifetime totals. Every
 * order still waiting to be accepted is read FIRST by the loader, so the
 * cap can only ever drop old, finished history.
 */
export function leaflyLoadCapNotice(loaded: number, cap: number | null | undefined): string | null {
  if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return null;
  if (!Number.isFinite(loaded) || loaded < cap) return null;
  return `Showing the ${cap} most recent Leafly orders. Older, finished Leafly orders are not listed here \u2014 the tabs and counts above cover these ${cap}.`;
}

/**
 * The ORDER_SORTS column names this core knows how to read from a row.
 * A sort naming anything else fails the self-tests, loudly, rather than
 * silently sorting Leafly orders differently from ours.
 */
const SORTABLE: Record<string, (r: LeaflyPanelRow) => string | number | null> = {
  placed_at: (r) => {
    const t = Date.parse(r.placedAt);
    return Number.isFinite(t) ? t : null;
  },
  total_minor_units: (r) => r.totalMinor,
  customer_first_name: (r) => (r.firstName ? r.firstName : null),
};

export function sortColumnSupported(column: string): boolean {
  return Object.prototype.hasOwnProperty.call(SORTABLE, column);
}

/**
 * Compare by the ORDER_SORTS columns, in order. A value that is missing (an
 * order not accepted yet has no total and no name) sorts LAST in either
 * direction, so "Total: high → low" never opens with a row showing no total.
 * Names compare case-insensitively, as a person reads them.
 */
function compareByColumns(a: LeaflyPanelRow, b: LeaflyPanelRow, columns: readonly SortColumn[]): number {
  for (const col of columns) {
    const read = SORTABLE[col.column];
    if (!read) continue;
    const av = read(a);
    const bv = read(b);
    if (av === null && bv === null) continue;
    if (av === null) return 1;
    if (bv === null) return -1;
    let c: number;
    if (typeof av === "string" && typeof bv === "string") {
      c = av.localeCompare(bv, "en", { sensitivity: "base" });
    } else {
      c = av < bv ? -1 : av > bv ? 1 : 0;
    }
    if (c !== 0) return col.ascending ? c : -c;
  }
  // Stable, deterministic tie-break: the Leafly id.
  return (a.order.id ?? "").localeCompare(b.order.id ?? "");
}

export type LeaflyPanelView<R> = {
  /** The rows on the requested page, filtered and sorted. */
  rows: R[];
  /** Rows matching the view across every page. */
  total: number;
  window: ListWindow;
  /** Per-status counts over EVERY loaded Leafly order (drives the cards). */
  counts: StatusCounts;
  /** Orders needing a person that the current view is hiding. */
  hiddenNeedsPerson: number;
};

function inDateRange(placedAt: string, q: OrdersPanelQuery): boolean {
  if (!q.placedFrom && !q.placedTo) return true;
  const t = Date.parse(placedAt);
  if (!Number.isFinite(t)) return false;
  if (q.placedFrom && t < Date.parse(`${q.placedFrom}T00:00:00.000Z`)) return false;
  if (q.placedTo && t > Date.parse(q.placedTo)) return false;
  return true;
}

/**
 * An order with no total yet (not accepted) cannot be shown to fall inside
 * a total range, so a total filter excludes it — and if it needs a person,
 * the safety line below says so.
 */
function inTotalRange(total: number | null, q: OrdersPanelQuery): boolean {
  if (q.totalMin == null && q.totalMax == null) return true;
  if (total === null) return false;
  if (q.totalMin != null && total < q.totalMin) return false;
  if (q.totalMax != null && total > q.totalMax) return false;
  return true;
}

/** Apply one panel's view to the Leafly rows, with our exact semantics. */
export function buildLeaflyPanelView<R extends LeaflyPanelRow<LeaflyPanelSource, LeaflyPanelLocal>>(
  rows: readonly R[],
  q: OrdersPanelQuery,
  pageSize: number = DEFAULT_PAGE_SIZE,
): LeaflyPanelView<R> {
  const search = parseBoardSearch(q.search);
  // The Leafly board's own matcher (board-view-core), over every bucket:
  // one definition of "this order matches what was typed".
  const searched = search === null ? [...rows] : buildBoardView(rows, { filter: "all", search }).rows;
  const matched = searched.filter(
    (r) => statusInTab(r.status, q.status) && inDateRange(r.placedAt, q) && inTotalRange(r.totalMinor, q),
  );
  const visible = new Set<R>(matched);
  const hiddenNeedsPerson = rows.filter((r) => r.needsPerson && !visible.has(r)).length;
  const sorted = [...matched].sort((a, b) => compareByColumns(a, b, q.sortColumns));
  const window = listWindow(sorted.length, q.page, pageSize);
  return {
    rows: sorted.slice(window.from, window.to + 1),
    total: sorted.length,
    window,
    counts: countByStatus(rows),
    hiddenNeedsPerson,
  };
}

/** The safety line's sentence, or null when nothing is hidden. */
export function hiddenNeedsPersonWarning(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1
    ? "1 Leafly order needs someone but is hidden by the current view. Choose “Active” and clear the search to see it."
    : `${n} Leafly orders need someone but are hidden by the current view. Choose “Active” and clear the search to see them.`;
}

// ============================================================================
// 5. WORDS BOTH PANELS SHARE
// ============================================================================

/** The empty state's title, identical in both panels. */
export const PANEL_EMPTY_TITLE = "No orders match this view";

/**
 * The Leafly panel's subtitle. States the truth about auto-acknowledge,
 * which is a switch (LEAFLY_AUTO_ACKNOWLEDGE): the owner relies on it being
 * on, and if someone turns it off the panel must not keep saying it is.
 * Deliberately no deadline talk — with it on, there is nothing to race.
 */
export function leaflyPanelSubtitle(autoAcknowledge: boolean): string {
  return autoAcknowledge
    ? "Orders placed on Leafly. Each one is accepted automatically the moment it arrives."
    : "Orders placed on Leafly. Automatic acceptance is switched off, so open each new order and accept it.";
}

// ============================================================================
// SELF-TESTS
// ============================================================================

export function __runOrdersPanelTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[order-panels-core] FAIL: ${label}`);
    }
  };

  // ── 1. tabs ────────────────────────────────────────────────────────────
  ok("nine tabs", ORDERS_PANEL_TABS.length === 9);
  ok("Active first, All last", ORDERS_PANEL_TABS[0].key === "active" && ORDERS_PANEL_TABS[8].key === "all");
  ok(
    "every status has a tab",
    ALL_ORDER_STATUSES.every((s) => ORDERS_PANEL_TABS.some((t) => t.key === s)),
  );
  ok("unique tab keys", new Set(ORDERS_PANEL_TABS.map((t) => t.key)).size === 9);
  ok("garbage status → active", parsePanelStatus("bogus") === "active");
  ok("missing status → active", parsePanelStatus(undefined) === "active");
  ok("array status reads first", parsePanelStatus(["ready", "new"]) === "ready");
  ok("valid status kept", parsePanelStatus("no_show") === "no_show");
  ok("active includes new..ready", ACTIVE_ORDER_STATUSES.every((s) => statusInTab(s, "active")));
  ok("active excludes closed", !statusInTab("completed", "active") && !statusInTab("cancelled", "active") && !statusInTab("no_show", "active"));
  ok("all includes everything", ALL_ORDER_STATUSES.every((s) => statusInTab(s, "all")));
  ok("a single tab is exact", statusInTab("ready", "ready") && !statusInTab("preparing", "ready"));

  // ── 2. URL ─────────────────────────────────────────────────────────────
  const gw = ORDERS_PANEL_PARAMS.greenway;
  const lf = ORDERS_PANEL_PARAMS.leafly;
  ok("our param names are unchanged (old bookmarks)", gw.status === "status" && gw.q === "q" && gw.page === "page");
  ok(
    "leafly params never collide with ours",
    Object.values(lf).every((n) => !Object.values(gw).includes(n)),
  );
  ok("leafly params are l-prefixed", Object.values(lf).every((n) => n.startsWith("l")));
  const q0 = parseOrdersPanelQuery({}, "leafly");
  ok("empty URL = default view", q0.status === "active" && q0.search === "" && q0.sortKey === "newest" && q0.page === 1);
  const qBad = parseOrdersPanelQuery(
    { lstatus: "x", lsort: "DROP", lfrom: "2026-02-30", lto: "junk", lmin: "-5", lmax: "abc", lpage: "-2" },
    "leafly",
  );
  ok("garbage knobs all fall back", qBad.status === "active" && qBad.sortKey === "newest" && !qBad.placedFrom && !qBad.placedToDate && qBad.totalMin == null && qBad.totalMax == null && qBad.page === 1);
  ok("garbage money is not echoed back", qBad.minRaw === "" && qBad.maxRaw === "");
  const qGood = parseOrdersPanelQuery(
    { lstatus: "ready", lq: "  jane ", lsort: "total_high", lfrom: "2026-01-02", lto: "2026-01-05", lmin: "10", lmax: "$1,000.50", lpage: "3" },
    "leafly",
  );
  ok("good knobs parse", qGood.status === "ready" && qGood.search === "jane" && qGood.sortKey === "total_high" && qGood.page === 3);
  ok("dates parse; to is end of day", qGood.placedFrom === "2026-01-02" && qGood.placedTo === "2026-01-05T23:59:59.999Z");
  ok("money parses to cents", qGood.totalMin === 1000 && qGood.totalMax === 100050);
  ok("panels read only their own params", parseOrdersPanelQuery({ status: "ready" }, "leafly").status === "active");
  ok("greenway reads unprefixed", parseOrdersPanelQuery({ status: "ready", lstatus: "new" }, "greenway").status === "ready");

  const sp = { status: "ready", q: "bob", page: "2", lstatus: "cancelled", lq: "lf-1", leaflyMsg: "Done", printTest: "1", lfilter: "closed" };
  const hStatus = panelHref(sp, "leafly", { kind: "status", status: "completed" });
  ok("status link lands on its panel", hStatus.endsWith("#leafly-orders"));
  ok("status link changes only its panel", hStatus.includes("lstatus=completed") && hStatus.includes("status=ready") && hStatus.includes("q=bob"));
  ok("status link keeps the other panel's page", hStatus.includes("page=2"));
  ok("status link keeps its own search", hStatus.includes("lq=lf-1"));
  ok("one-shot banners are dropped", !hStatus.includes("leaflyMsg") && !hStatus.includes("printTest"));
  ok("legacy params fall away", !hStatus.includes("lfilter"));
  const hPage = panelHref({ ...sp, lpage: "1" }, "leafly", { kind: "page", page: 4 });
  ok("page link sets its own page", hPage.includes("lpage=4") && hPage.includes("page=2"));
  const hPage1 = panelHref({ lpage: "3" }, "leafly", { kind: "page", page: 1 });
  ok("page 1 is omitted", !hPage1.includes("lpage"));
  const hStatusResets = panelHref({ lpage: "3" }, "leafly", { kind: "status", status: "new" });
  ok("changing tab resets the page", !hStatusResets.includes("lpage"));
  const hClear = panelHref({ ...sp, lsort: "oldest", lmin: "5" }, "leafly", { kind: "clear" });
  ok("clear keeps the tab", hClear.includes("lstatus=cancelled"));
  ok("clear drops the rest of its panel", !hClear.includes("lq=") && !hClear.includes("lsort") && !hClear.includes("lmin"));
  ok("clear keeps the other panel", hClear.includes("status=ready") && hClear.includes("q=bob"));
  ok("default view is the bare page", panelHref({}, "greenway", { kind: "status", status: "active" }) === "/admin/orders#greenway-orders");
  ok("greenway links land on greenway", panelHref(sp, "greenway", { kind: "page", page: 3 }).endsWith("#greenway-orders"));
  const kept = preservedFields(sp, "greenway");
  ok("greenway form carries the leafly view", kept.some(([k, v]) => k === "lstatus" && v === "cancelled") && kept.some(([k]) => k === "lq"));
  ok("greenway form does not carry its own params as hidden", !kept.some(([k]) => k === "status" || k === "q"));
  ok("form action lands on its panel", panelFormAction("leafly") === "/admin/orders#leafly-orders");
  ok("extra filters detected", panelHasExtraFilters(qGood) && !panelHasExtraFilters(q0));

  // ── 3. status mapping ──────────────────────────────────────────────────
  const base: LeaflyPanelSource = {
    id: "a",
    leafly_order_id: "11111111-2222-3333-4444-bbbbbbcccccc",
    leafly_status: "pending",
    acknowledged_at: null,
    acknowledge_by: "2026-01-05T10:15:00Z",
    canceled_at: null,
    local_order_id: null,
    first_seen_at: "2026-01-05T10:00:00Z",
    updated_at: "2026-01-05T10:00:00Z",
  };
  const loc = (over: Partial<LeaflyPanelLocal> = {}): LeaflyPanelLocal => ({
    status: "preparing",
    placed_at: "2026-01-05T10:01:00Z",
    total_minor_units: 4200,
    order_number: "GWY-000042",
    display_name: "LF-CCCCCC",
    customer_first_name: "Jane",
    customer_last_name: "S.",
    customer_phone: null,
    ...over,
  });
  ok("unaccepted → New", leaflyPanelStatus(base) === "new");
  ok("expired → Cancelled", leaflyPanelStatus({ ...base, leafly_status: "expired" }) === "cancelled");
  ok("canceled stamp → Cancelled", leaflyPanelStatus({ ...base, canceled_at: "2026-01-05T10:20:00Z" }) === "cancelled");
  ok("picked up, unlinked → Completed", leaflyPanelStatus({ ...base, leafly_status: "picked_up", acknowledged_at: "x" }) === "completed");
  ok("accepted, no copy → Acknowledged", leaflyPanelStatus({ ...base, leafly_status: "confirmed", acknowledged_at: "x" }) === "acknowledged");
  ok("accepted+ready, no copy → Ready", leaflyPanelStatus({ ...base, leafly_status: "ready", acknowledged_at: "x" }) === "ready");
  ok("linked → our copy's status", leaflyPanelStatus({ ...base, acknowledged_at: "x", local_order_id: "L1" }, loc()) === "preparing");
  ok(
    "linked beats a Leafly cancel (till must answer first)",
    leaflyPanelStatus({ ...base, leafly_status: "canceled", acknowledged_at: "x", local_order_id: "L1" }, loc()) === "preparing",
  );
  ok("a junk local status falls back to Leafly's", leaflyPanelStatus({ ...base, acknowledged_at: "x" }, loc({ status: "martian" })) === "acknowledged");

  // ── 4. view ────────────────────────────────────────────────────────────
  const linked = new Map<string, LeaflyPanelLocal>([
    ["L1", loc({ status: "preparing", total_minor_units: 4200, placed_at: "2026-01-05T10:01:00Z", customer_first_name: "zed" })],
    ["L2", loc({ status: "completed", total_minor_units: 9900, placed_at: "2026-01-03T09:00:00Z", customer_first_name: "Amy", order_number: "GWY-000099", display_name: "LF-DDDDDD" })],
  ]);
  const src: LeaflyPanelSource[] = [
    { ...base, id: "u1", leafly_order_id: "77777777-0000-0000-0000-00000000abc7", first_seen_at: "2026-01-06T08:00:00Z" },
    { ...base, id: "k1", acknowledged_at: "x", leafly_status: "confirmed", local_order_id: "L1" },
    { ...base, id: "k2", acknowledged_at: "x", leafly_status: "picked_up", local_order_id: "L2", leafly_order_id: "99999999-0000-0000-0000-dddddddddddd" },
    { ...base, id: "x1", leafly_status: "expired", first_seen_at: "2026-01-01T08:00:00Z" },
    { ...base, id: "n1", acknowledged_at: "x", leafly_status: "confirmed", local_order_id: null, first_seen_at: "2026-01-02T08:00:00Z" },
  ];
  const rows = toLeaflyPanelRows(src, linked);
  const view = (over: SearchParamsLike) => buildLeaflyPanelView(rows, parseOrdersPanelQuery(over, "leafly"));
  const ids = (v: LeaflyPanelView<LeaflyPanelRow>) => v.rows.map((r) => r.order.id).join(",");
  ok("default Active view: newest first", ids(view({})) === "u1,k1,n1");
  ok("counts cover every loaded order", view({}).counts.new === 1 && view({}).counts.completed === 1 && view({}).counts.cancelled === 1 && view({}).counts.acknowledged === 1 && view({}).counts.preparing === 1);
  ok("active total", activeTotal(view({}).counts) === 3);
  ok("nothing hidden by default", view({}).hiddenNeedsPerson === 0);
  ok("All tab shows all", view({ lstatus: "all" }).total === 5);
  ok("Completed tab", ids(view({ lstatus: "completed" })) === "k2");
  ok("Cancelled tab holds expired", ids(view({ lstatus: "cancelled" })) === "x1");
  ok("Completed hides live work → warned", view({ lstatus: "completed" }).hiddenNeedsPerson === 2);
  ok("warning sentence is singular/plural", hiddenNeedsPersonWarning(1)!.startsWith("1 Leafly order needs") && hiddenNeedsPersonWarning(2)!.startsWith("2 Leafly orders need"));
  ok("no warning at zero / NaN", hiddenNeedsPersonWarning(0) === null && hiddenNeedsPersonWarning(Number.NaN) === null);
  ok("oldest first", ids(view({ lstatus: "all", lsort: "oldest" })) === "x1,n1,k2,k1,u1");
  ok("total high → low, missing totals last", ids(view({ lstatus: "all", lsort: "total_high" })).startsWith("k2,k1,"));
  ok("total low → high, missing totals still last", ids(view({ lstatus: "all", lsort: "total_low" })).startsWith("k1,k2,"));
  ok("name A→Z is case-insensitive, nameless last", ids(view({ lstatus: "all", lsort: "name" })).startsWith("k2,k1,"));
  ok("search finds our name", ids(view({ lstatus: "all", lq: "AMY" })) === "k2");
  ok("search finds our order number", ids(view({ lstatus: "all", lq: "000042" })) === "k1");
  ok("search finds the receipt label of an unlinked order", ids(view({ lstatus: "all", lq: "lf-00abc7" })) === "u1");
  ok("search miss is empty", view({ lstatus: "all", lq: "nobody" }).total === 0);
  ok("search hiding live work is warned", view({ lq: "amy" }).hiddenNeedsPerson === 2);
  ok("date from", ids(view({ lstatus: "all", lfrom: "2026-01-05" })) === "u1,k1");
  ok("date to is inclusive to end of day", ids(view({ lstatus: "all", lto: "2026-01-03" })) === "k2,n1,x1");
  ok("total min excludes orders with no total", ids(view({ lstatus: "all", lmin: "50" })) === "k2");
  ok("total max", ids(view({ lstatus: "all", lmax: "50" })) === "k1");
  const paged = buildLeaflyPanelView(rows, parseOrdersPanelQuery({ lstatus: "all", lpage: "2" }, "leafly"), 2);
  ok("paging slices", paged.rows.length === 2 && paged.window.page === 2 && paged.total === 5);
  const clamped = buildLeaflyPanelView(rows, parseOrdersPanelQuery({ lstatus: "all", lpage: "99" }, "leafly"), 2);
  ok("a page past the end clamps to the last page, never empty", clamped.window.page === 3 && clamped.rows.length === 1);
  ok(
    "every ORDER_SORTS column is sortable here (same sorts as ours)",
    ORDER_SORTS.every((o) => o.columns.every((c) => sortColumnSupported(c.column))),
  );
  ok("unknown columns are reported unsupported", !sortColumnSupported("martian"));
  ok("rows with no linked read degrade to Leafly's status", toLeaflyPanelRows([src[1]], new Map())[0].status === "acknowledged");
  ok("unaccepted needs a person", rows.find((r) => r.order.id === "u1")!.needsPerson);
  ok("accepted without a copy needs a person", rows.find((r) => r.order.id === "n1")!.needsPerson);
  ok("work in progress does not 'need a person'", !rows.find((r) => r.order.id === "k1")!.needsPerson);
  ok("placed = our copy's time, else first seen", rows.find((r) => r.order.id === "k1")!.placedAt === "2026-01-05T10:01:00Z" && rows.find((r) => r.order.id === "u1")!.placedAt === "2026-01-06T08:00:00Z");

  // ── 5. words ───────────────────────────────────────────────────────────
  // ── 5. tab counts + load cap ──
  {
    const c = countByStatus([{ status: "new" }, { status: "ready" }, { status: "ready" }, { status: "completed" }, { status: "no_show" }]);
    ok("tab count: a single status", tabCount(c, "ready") === 2);
    ok("tab count: Active is the four open statuses", tabCount(c, "active") === 3);
    ok("tab count: All is every status", tabCount(c, "all") === 5);
    ok("tab count: an empty status is zero", tabCount(c, "preparing") === 0);
    ok("every tab has a count", ORDERS_PANEL_TABS.every((t) => Number.isFinite(tabCount(c, t.key))));
  }
  ok("no cap note under the cap", leaflyLoadCapNotice(199, 200) === null);
  ok("cap note at the cap", (leaflyLoadCapNotice(200, 200) ?? "").includes("200 most recent"));
  ok("no cap note without a cap", leaflyLoadCapNotice(500, null) === null && leaflyLoadCapNotice(500, 0) === null);
  ok("cap note never talks about deadlines", !/minute|deadline|clock/i.test(leaflyLoadCapNotice(200, 200) ?? ""));
  ok("subtitle names auto-accept when on", leaflyPanelSubtitle(true).includes("automatically"));
  ok("subtitle tells the truth when off", leaflyPanelSubtitle(false).includes("switched off"));
  ok(
    "no deadline talk in either subtitle",
    ![leaflyPanelSubtitle(true), leaflyPanelSubtitle(false)].some((s) => /minute|deadline|15/.test(s)),
  );

  return { passed, failed };
}
