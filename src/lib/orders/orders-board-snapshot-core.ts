/**
 * src/lib/orders/orders-board-snapshot-core.ts  (USAGE-3)
 *
 * PURE parsing of the jsonb document returned by the database function
 * `orders_board_snapshot()` (migration 0233) into the exact shapes the Orders
 * dashboard already consumes:
 *
 *   counts   — Record<OrderStatus, number>, every status present (0 default)
 *   arrivals — OrderArrivalRow[] (id, placedAt, label) newest first
 *   latest   — { ordersUpdatedAt, leaflyUpdatedAt }
 *
 * WHY A PARSER AT ALL: PostgREST hands jsonb back as `unknown`. The store
 * used to build these shapes from ten separate typed queries; one function
 * call replaces them, so the defensive typing that used to live in ten
 * `.select()` signatures now lives here, in one self-tested place. A document
 * that does not look right (missing keys, wrong types) returns null and the
 * caller falls back to the legacy ten-query path — never a half-parsed
 * board.
 *
 * Only imports another pure core (resolveOrderDisplay), so the ONE identity
 * rule for the customer-facing label stays shared with emails/receipts.
 */
import { resolveOrderDisplay } from "./order-name-pool-core";

export const ORDER_STATUS_KEYS = [
  "new",
  "acknowledged",
  "preparing",
  "ready",
  "completed",
  "cancelled",
  "no_show",
] as const;
export type SnapshotStatus = (typeof ORDER_STATUS_KEYS)[number];

export type SnapshotArrival = { id: string; placedAt: string; label: string };

export type ParsedOrdersBoardSnapshot = {
  counts: Record<SnapshotStatus, number>;
  arrivals: SnapshotArrival[];
  latest: { ordersUpdatedAt: string | null; leaflyUpdatedAt: string | null };
};

/** The database function name (0233). One constant so the store and the tests agree. */
export const ORDERS_BOARD_SNAPSHOT_RPC = "orders_board_snapshot";

/** Default arrivals the dashboard poll asks for (matches getRecentOrderArrivals(20)). */
export const SNAPSHOT_DEFAULT_ARRIVALS = 20;

export function emptyStatusCounts(): Record<SnapshotStatus, number> {
  return { new: 0, acknowledged: 0, preparing: 0, ready: 0, completed: 0, cancelled: 0, no_show: 0 };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toCount(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

function toNullableIso(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v !== "" && !Number.isNaN(Date.parse(v))) return v;
  return undefined; // malformed
}

/**
 * Parse the RPC payload. Returns null when the document is not the shape
 * 0233 produces, so the caller can fall back rather than trust it.
 */
export function parseOrdersBoardSnapshot(payload: unknown): ParsedOrdersBoardSnapshot | null {
  if (!isRecord(payload)) return null;
  const rawCounts = payload.counts;
  const rawArrivals = payload.arrivals;
  if (!isRecord(rawCounts) || !Array.isArray(rawArrivals)) return null;

  const counts = emptyStatusCounts();
  for (const key of ORDER_STATUS_KEYS) {
    if (!(key in rawCounts)) continue; // absent status = 0 (never invented by the SQL, but harmless)
    const n = toCount(rawCounts[key]);
    if (n === null) return null;
    counts[key] = n;
  }

  const arrivals: SnapshotArrival[] = [];
  for (const row of rawArrivals) {
    if (!isRecord(row)) return null;
    const id = row.id;
    const placedAt = row.placed_at;
    if (typeof id !== "string" || id === "" || typeof placedAt !== "string" || placedAt === "") return null;
    const orderNumber = typeof row.order_number === "string" ? row.order_number : "";
    const displayName = typeof row.display_name === "string" ? row.display_name : null;
    arrivals.push({ id, placedAt, label: resolveOrderDisplay(displayName, orderNumber) });
  }

  const ordersUpdatedAt = toNullableIso(payload.orders_updated_at);
  const leaflyUpdatedAt = toNullableIso(payload.leafly_updated_at);
  if (ordersUpdatedAt === undefined || leaflyUpdatedAt === undefined) return null;

  return { counts, arrivals, latest: { ordersUpdatedAt, leaflyUpdatedAt } };
}

/**
 * Clamp the arrivals limit the same way the SQL and getRecentOrderArrivals do
 * (0..100), so the RPC and the fallback ask for the same number of rows.
 */
export function clampArrivalsLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return SNAPSHOT_DEFAULT_ARRIVALS;
  return Math.max(0, Math.min(100, Math.floor(limit)));
}

/* ------------------------------------------------------------------ */
/* Embedded self-tests (run by scripts/compliance/run-pure-selftests)  */
/* ------------------------------------------------------------------ */

export function __runOrdersBoardSnapshotCoreTests(): void {
  const ok = (name: string, cond: boolean) => {
    if (!cond) throw new Error(`orders-board-snapshot-core self-test failed: ${name}`);
  };

  ok("rpc name pinned", ORDERS_BOARD_SNAPSHOT_RPC === "orders_board_snapshot");
  ok("seven statuses", ORDER_STATUS_KEYS.length === 7);

  const good = {
    counts: { new: 2, acknowledged: 0, preparing: 0, ready: 1, completed: 1, cancelled: 1, no_show: 0 },
    arrivals: [
      { id: "a", placed_at: "2026-03-10T12:05:00Z", order_number: "GW-5", display_name: "Zed" },
      { id: "b", placed_at: "2026-03-10T12:04:00Z", order_number: "GW-4", display_name: null },
    ],
    orders_updated_at: "2026-03-10T12:05:01Z",
    leafly_updated_at: null,
  };
  const parsed = parseOrdersBoardSnapshot(good);
  ok("good payload parses", parsed !== null);
  ok("counts carried", parsed!.counts.new === 2 && parsed!.counts.ready === 1 && parsed!.counts.no_show === 0);
  ok("arrivals length", parsed!.arrivals.length === 2);
  ok("display_name wins as label", parsed!.arrivals[0].label === "Zed" && parsed!.arrivals[0].placedAt === "2026-03-10T12:05:00Z");
  ok("null display_name falls back to order_number", parsed!.arrivals[1].label === "GW-4");
  ok("latest stamps", parsed!.latest.ordersUpdatedAt === "2026-03-10T12:05:01Z" && parsed!.latest.leaflyUpdatedAt === null);

  // Counts as strings (bigint→text on some drivers) still parse.
  ok(
    "string counts accepted",
    parseOrdersBoardSnapshot({ ...good, counts: { ...good.counts, new: "7" } })!.counts.new === 7,
  );
  // Missing status key defaults to 0, extra keys ignored.
  ok(
    "missing status key -> 0",
    parseOrdersBoardSnapshot({ ...good, counts: { new: 1, bogus: 9 } })!.counts.completed === 0,
  );
  // Empty shapes.
  const empty = parseOrdersBoardSnapshot({ counts: {}, arrivals: [], orders_updated_at: null, leafly_updated_at: null });
  ok("empty document parses to zeros", empty !== null && empty.counts.new === 0 && empty.arrivals.length === 0);

  // Rejections -> null (caller falls back).
  ok("null payload -> null", parseOrdersBoardSnapshot(null) === null);
  ok("array payload -> null", parseOrdersBoardSnapshot([]) === null);
  ok("missing counts -> null", parseOrdersBoardSnapshot({ arrivals: [] }) === null);
  ok("missing arrivals -> null", parseOrdersBoardSnapshot({ counts: {} }) === null);
  ok("negative count -> null", parseOrdersBoardSnapshot({ ...good, counts: { new: -1 } }) === null);
  ok("non-numeric count -> null", parseOrdersBoardSnapshot({ ...good, counts: { new: "lots" } }) === null);
  ok("arrival without id -> null", parseOrdersBoardSnapshot({ ...good, arrivals: [{ placed_at: "2026-03-10T12:00:00Z" }] }) === null);
  ok("arrival without placed_at -> null", parseOrdersBoardSnapshot({ ...good, arrivals: [{ id: "x" }] }) === null);
  ok("garbage stamp -> null", parseOrdersBoardSnapshot({ ...good, orders_updated_at: "yesterday" }) === null);
  ok("numeric stamp -> null", parseOrdersBoardSnapshot({ ...good, leafly_updated_at: 5 }) === null);

  // Limit clamp mirrors the SQL (0..100) and the legacy helper.
  ok("default limit 20", clampArrivalsLimit(undefined) === 20);
  ok("NaN -> default", clampArrivalsLimit(Number.NaN) === 20);
  ok("negative -> 0", clampArrivalsLimit(-3) === 0);
  ok("fraction floors", clampArrivalsLimit(7.9) === 7);
  ok("500 -> 100", clampArrivalsLimit(500) === 100);
}
