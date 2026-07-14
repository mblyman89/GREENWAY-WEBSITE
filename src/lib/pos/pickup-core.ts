/**
 * src/lib/pos/pickup-core.ts  (POS Slice B28)
 *
 * PURE policy for the register's ONLINE-ORDER PICKUP QUEUE. No `server-only`,
 * no DB — safe for tests and the tsx self-test harness.
 *
 * What B28 is: website pickup orders (status new → ready) surfaced ON the
 * iPad so the budtender can hand them over without touching the back office —
 * claim the order, check the customer's ID at the counter, take cash, and
 * complete it through the SAME server completion gate every sale runs
 * (hours → money recompute → loyalty code → medical card → high-THC →
 * sales limits → exempt ledger). Every major cannabis POS (Dutchie, Cova,
 * Flowhub, Treez) treats the pickup queue as a first-class register surface;
 * ours additionally refuses to complete without an explicit ID attestation,
 * because WAC 314-55-150 age verification happens at HANDOVER, not at
 * placement.
 *
 * Register sales themselves are materialized as orders too (sync-store), so
 * the queue must EXCLUDE POS-materialized orders — those are identified by
 * the staff_note prefix the sync writes and by their pos_sale_events link
 * (the store checks both; belt and suspenders).
 *
 * Money in MINOR UNITS (cents) everywhere.
 */
import type { OrderStatus } from "@/lib/orders/types";
import { ORDER_STATUS_LABELS } from "@/lib/orders/types";
import { computeCashChange } from "@/lib/pos/sale-event-core";

// ---------------------------------------------------------------------------
// POS-materialized order detection
// ---------------------------------------------------------------------------

/**
 * The EXACT prefix sync-store writes on every register-materialized order's
 * staff_note ("POS sale — <device> — rung by <name>. Event <uuid>."). The
 * em-dash is part of the contract — see sync-store.ts.
 */
export const POS_SALE_STAFF_NOTE_PREFIX = "POS sale —";

/** True when an order was materialized by the register sync (not a website order). */
export function isPosMaterializedOrder(staffNote: string | null | undefined): boolean {
  return typeof staffNote === "string" && staffNote.startsWith(POS_SALE_STAFF_NOTE_PREFIX);
}

// ---------------------------------------------------------------------------
// Queue shaping
// ---------------------------------------------------------------------------

/** Privacy-lean counter label: first name + last initial ("Jordan T."). */
export function customerPickupLabel(first: string, last: string | null | undefined): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  return l ? `${f} ${l[0].toUpperCase()}.` : f || "Customer";
}

/** Whole minutes from `fromIso` to `nowIso` (clamped at 0; bad input → 0). */
export function minutesBetween(fromIso: string, nowIso: string): number {
  const from = Date.parse(fromIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(from) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - from) / 60_000));
}

export type PickupQueueEntry = {
  orderId: string;
  orderNumber: string;
  customerLabel: string;
  status: OrderStatus;
  statusLabel: string;
  itemCount: number;
  totalMinor: number;
  placedAtIso: string;
  minutesWaiting: number;
  /** True when the customer left a note (staff should read it before handover). */
  hasCustomerNote: boolean;
};

/**
 * Queue order for the counter: READY orders first (the customer may already
 * be standing there), then preparing → acknowledged → new; oldest first
 * within each group so nobody gets buried.
 */
const STATUS_RANK: Partial<Record<OrderStatus, number>> = {
  ready: 0,
  preparing: 1,
  acknowledged: 2,
  new: 3,
};

export function sortPickupQueue<T extends { status: OrderStatus; placedAtIso: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 9;
    const rb = STATUS_RANK[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.placedAtIso.localeCompare(b.placedAtIso);
  });
}

/** Shape one order row (already store-filtered) into a queue entry. */
export function toPickupQueueEntry(
  order: {
    id: string;
    order_number: string;
    customer_first_name: string;
    customer_last_name: string | null;
    status: OrderStatus;
    item_count: number;
    total_minor_units: number;
    placed_at: string;
    customer_note: string | null;
  },
  nowIso: string,
): PickupQueueEntry {
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    customerLabel: customerPickupLabel(order.customer_first_name, order.customer_last_name),
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    itemCount: order.item_count,
    totalMinor: order.total_minor_units,
    placedAtIso: order.placed_at,
    minutesWaiting: minutesBetween(order.placed_at, nowIso),
    hasCustomerNote: !!(order.customer_note ?? "").trim(),
  };
}

// ---------------------------------------------------------------------------
// Completion policy (register handover)
// ---------------------------------------------------------------------------

const ACTIVE: OrderStatus[] = ["new", "acknowledged", "preparing", "ready"];

export type PickupCompletionInput = {
  orderStatus: OrderStatus;
  /** True when the order is register-materialized (never completable here). */
  isPosSale: boolean;
  /** The budtender's explicit at-the-counter ID attestation. */
  idConfirmed: boolean;
  totalMinor: number;
  tenderedMinor: number;
};

export type PickupCompletionVerdict =
  | { ok: true; changeMinor: number }
  | { ok: false; errors: string[] };

/**
 * Every handover gate, evaluated together so the register shows the COMPLETE
 * list (same contract as returns/void eligibility). The server completion
 * gate (hours, money, limits, medical) still runs after this — these are the
 * register-side preconditions only.
 */
export function evaluatePickupCompletion(input: PickupCompletionInput): PickupCompletionVerdict {
  const errors: string[] = [];
  if (input.isPosSale) {
    errors.push("That order is a register sale, not a website pickup — it has no handover step.");
  }
  if (!ACTIVE.includes(input.orderStatus)) {
    errors.push(
      `Order is ${ORDER_STATUS_LABELS[input.orderStatus] ?? input.orderStatus} — only an active pickup order can be completed at the register.`,
    );
  }
  if (!input.idConfirmed) {
    errors.push("Check the customer's ID first — age verification happens at handover (WAC 314-55-150).");
  }
  if (!Number.isInteger(input.totalMinor) || input.totalMinor < 0) {
    errors.push("Order total is not a valid amount in cents — open the order in the back office.");
  } else {
    const tender = computeCashChange({ totalMinor: input.totalMinor, tenderedMinor: input.tenderedMinor });
    if (!tender.ok) errors.push(tender.error);
    else if (errors.length === 0) return { ok: true, changeMinor: tender.changeMinor };
  }
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runPickupCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // POS-materialized detection: exact prefix, em-dash intact.
  ok(isPosMaterializedOrder("POS sale — Front iPad — rung by Casey. Event abc."), "POS staff_note detected");
  ok(!isPosMaterializedOrder("Customer called ahead"), "ordinary staff note is not POS");
  ok(!isPosMaterializedOrder(null) && !isPosMaterializedOrder(undefined), "null/undefined note is not POS");
  ok(!isPosMaterializedOrder("POS sale - hyphen"), "ASCII hyphen does NOT match (the sync writes an em-dash)");

  // Labels + waiting time.
  ok(customerPickupLabel("Jordan", "Taylor") === "Jordan T.", "first + last initial");
  ok(customerPickupLabel("Jordan", null) === "Jordan", "no last name → first only");
  ok(customerPickupLabel("", "") === "Customer", "empty names → generic label");
  ok(minutesBetween("2026-02-10T10:00:00Z", "2026-02-10T10:31:30Z") === 31, "minutes floor");
  ok(minutesBetween("2026-02-10T11:00:00Z", "2026-02-10T10:00:00Z") === 0, "future placed_at clamps to 0");
  ok(minutesBetween("garbage", "2026-02-10T10:00:00Z") === 0, "bad input → 0, never NaN");

  // Sort: ready first, oldest first within group.
  const sorted = sortPickupQueue([
    { status: "new" as OrderStatus, placedAtIso: "2026-02-10T09:00:00Z", tag: "new-early" },
    { status: "ready" as OrderStatus, placedAtIso: "2026-02-10T10:00:00Z", tag: "ready-late" },
    { status: "ready" as OrderStatus, placedAtIso: "2026-02-10T08:00:00Z", tag: "ready-early" },
    { status: "preparing" as OrderStatus, placedAtIso: "2026-02-10T07:00:00Z", tag: "prep" },
  ]);
  ok(
    sorted.map((e) => (e as { tag: string }).tag).join(",") === "ready-early,ready-late,prep,new-early",
    "ready first (oldest first), then preparing, then new",
  );

  // Queue entry shaping.
  const entry = toPickupQueueEntry(
    {
      id: "o1",
      order_number: "GW-1042",
      customer_first_name: "Jordan",
      customer_last_name: "Taylor",
      status: "ready",
      item_count: 3,
      total_minor_units: 4550,
      placed_at: "2026-02-10T10:00:00Z",
      customer_note: "  Will arrive around 4pm  ",
    },
    "2026-02-10T10:20:00Z",
  );
  ok(entry.customerLabel === "Jordan T." && entry.minutesWaiting === 20, "entry label + waiting minutes");
  ok(entry.statusLabel === "Ready for pickup" && entry.hasCustomerNote, "status label + note flag");
  ok(
    !toPickupQueueEntry(
      { id: "o2", order_number: "GW-1", customer_first_name: "A", customer_last_name: null, status: "new", item_count: 1, total_minor_units: 100, placed_at: "2026-02-10T10:00:00Z", customer_note: "   " },
      "2026-02-10T10:00:00Z",
    ).hasCustomerNote,
    "whitespace-only note is no note",
  );

  // Completion policy: happy path.
  const good = evaluatePickupCompletion({ orderStatus: "ready", isPosSale: false, idConfirmed: true, totalMinor: 4550, tenderedMinor: 5000 });
  ok(good.ok && good.changeMinor === 450, "ready + ID + full tender → change computed");
  const exact = evaluatePickupCompletion({ orderStatus: "preparing", isPosSale: false, idConfirmed: true, totalMinor: 4550, tenderedMinor: 4550 });
  ok(exact.ok && exact.changeMinor === 0, "any ACTIVE status may complete (bag-and-hand-over in one step)");

  // Completion policy: every failing gate reported together.
  const multi = evaluatePickupCompletion({ orderStatus: "completed", isPosSale: true, idConfirmed: false, totalMinor: 4550, tenderedMinor: 4000 });
  ok(!multi.ok && multi.errors.length === 4, "all failing gates reported together");
  ok(!multi.ok && multi.errors.some((e) => e.includes("register sale")), "POS-materialized named");
  ok(!multi.ok && multi.errors.some((e) => e.includes("ID")), "missing ID attestation named");
  const short = evaluatePickupCompletion({ orderStatus: "ready", isPosSale: false, idConfirmed: true, totalMinor: 4550, tenderedMinor: 4000 });
  ok(!short.ok && short.errors.length === 1, "short tender is the only error on an otherwise-good handover");
  const badTotal = evaluatePickupCompletion({ orderStatus: "ready", isPosSale: false, idConfirmed: true, totalMinor: 45.5, tenderedMinor: 5000 });
  ok(!badTotal.ok && badTotal.errors.some((e) => e.includes("cents")), "fractional total refused");
  const zero = evaluatePickupCompletion({ orderStatus: "ready", isPosSale: false, idConfirmed: true, totalMinor: 0, tenderedMinor: 0 });
  ok(zero.ok && zero.changeMinor === 0, "zero-total order (fully discounted) completable");

  if (fail > 0) throw new Error(`pickup-core self-tests: ${fail} FAILED (${pass} passed)`);
  console.log(`pickup-core self-tests: ALL PASS (${pass} assertions)`);
}
