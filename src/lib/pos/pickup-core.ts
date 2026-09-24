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
import {
  toOrderOrigin,
  orderOriginLabel,
  isMarketplaceOrigin,
  type OrderOrigin,
} from "@/lib/orders/order-origin-core";
import { resolveOrderDisplay } from "@/lib/orders/order-name-pool-core";

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
  /**
   * SLICE L-36 - the name printed big on the pick-and-bag receipt (the fun
   * overlay name, or LF-XXXXXX for Leafly). Falls back to orderNumber, so it
   * is never blank. This is what staff say out loud and what they scan.
   */
  displayName: string;
  customerLabel: string;
  status: OrderStatus;
  statusLabel: string;
  itemCount: number;
  totalMinor: number;
  placedAtIso: string;
  minutesWaiting: number;
  /** True when the customer left a note (staff should read it before handover). */
  hasCustomerNote: boolean;
  /**
   * SLICE L-12 - WHERE THIS ORDER CAME FROM.
   *
   * The owner's instruction was literal: "The two types need to be
   * distinguishable from each other." Until this field existed, they were
   * not - not here. `orders.origin` has been populated since migration 0226
   * and it reached the back office, but this queue entry simply never copied
   * it across, so the LAST screen before a regulated handover showed a Leafly
   * order and a website order as the same tile with the same colour.
   *
   * That is the screen where it matters most. Three facts about a Leafly
   * order are only true of a Leafly order, and all three bite at the counter:
   *
   *   1. Leafly told the customer what is happening, not us (L-1b). A
   *      budtender who assumes our own confirmation email went out will say
   *      something the customer never received.
   *   2. Leafly can cancel it from outside the building, at any moment,
   *      including while it sits in an open register sale (see
   *      decideCancelPlan in leafly/bridge-core.ts).
   *   3. Its status has to travel back to Leafly, so "handled it verbally" is
   *      not handling it.
   *
   * Always present and always a valid origin: `toOrderOrigin` resolves an
   * absent column (a row older than 0226) to `greenway`, which is the safe
   * direction - it costs a badge, never an order.
   */
  origin: OrderOrigin;
  /**
   * The badge word, resolved HERE rather than in the register component.
   *
   * House rule 11. `orderOriginLabel` is the single home for this word; the
   * register is a separate bundle that cannot import back-office components,
   * so without this field the iPad would grow its own copy of the mapping and
   * "Leafly" would eventually read differently in two places.
   */
  originLabel: string;
  /**
   * True when the order came through somebody else's marketplace.
   *
   * Exposed as its own boolean, rather than leaving the register to test
   * `origin === "leafly"`, so that adding a second marketplace lights it up
   * at the counter by joining MARKETPLACE_ORDER_ORIGINS - with nobody having
   * to remember this file exists.
   */
  isMarketplace: boolean;
};

/**
 * Queue order for the counter (SLICE L-36): NEWEST FIRST, full stop. The
 * owner's words: "Newest orders on top, scrollable". The old ready-first
 * ranking buried a just-placed order under every ready one; status is now a
 * highlight on the tile, not a position in the list.
 */
export function sortPickupQueue<T extends { placedAtIso: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    // SLICE L-36 - the owner asked for "newest orders on top". Status is no
    // longer a sort key; READY is highlighted on the tile instead, so the
    // list reads like a feed and a just-placed order is never below the fold.
    // Ties (same placed_at) fall back to orderId-free stable input order.
    return b.placedAtIso.localeCompare(a.placedAtIso);
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
    /** SLICE L-36 - `orders.display_name` (fun overlay name / LF- label). Optional: older rows lack it. */
    display_name?: string | null;
    /**
     * `orders.origin` (migration 0226). OPTIONAL on purpose: this function is
     * called with rows that may predate the column, and a required field here
     * would force every caller to invent a value - which is precisely how a
     * Leafly order gets labelled "Website" by a `?? "greenway"` written in a
     * hurry at a call site. Undefined means "not tracked", and `toOrderOrigin`
     * owns that decision in one place.
     */
    origin?: string | null;
  },
  nowIso: string,
): PickupQueueEntry {
  const origin = toOrderOrigin(order.origin);
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    displayName: resolveOrderDisplay(order.display_name ?? null, order.order_number),
    customerLabel: customerPickupLabel(order.customer_first_name, order.customer_last_name),
    status: order.status,
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    itemCount: order.item_count,
    totalMinor: order.total_minor_units,
    placedAtIso: order.placed_at,
    minutesWaiting: minutesBetween(order.placed_at, nowIso),
    hasCustomerNote: !!(order.customer_note ?? "").trim(),
    origin,
    originLabel: orderOriginLabel(origin),
    isMarketplace: isMarketplaceOrigin(origin),
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

  // Sort (SLICE L-36): newest first regardless of status.
  const sorted = sortPickupQueue([
    { status: "new" as OrderStatus, placedAtIso: "2026-02-10T09:00:00Z", tag: "new-early" },
    { status: "ready" as OrderStatus, placedAtIso: "2026-02-10T10:00:00Z", tag: "ready-late" },
    { status: "ready" as OrderStatus, placedAtIso: "2026-02-10T08:00:00Z", tag: "ready-early" },
    { status: "preparing" as OrderStatus, placedAtIso: "2026-02-10T07:00:00Z", tag: "prep" },
  ]);
  ok(
    sorted.map((e) => (e as { tag: string }).tag).join(",") === "ready-late,new-early,ready-early,prep",
    "newest first, status is not a sort key",
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
  ok(entry.displayName === "GW-1042", "no display_name -> falls back to the order number");
  ok(entry.statusLabel === "Ready for pickup" && entry.hasCustomerNote, "status label + note flag");
  ok(
    !toPickupQueueEntry(
      { id: "o2", order_number: "GW-1", customer_first_name: "A", customer_last_name: null, status: "new", item_count: 1, total_minor_units: 100, placed_at: "2026-02-10T10:00:00Z", customer_note: "   " },
      "2026-02-10T10:00:00Z",
    ).hasCustomerNote,
    "whitespace-only note is no note",
  );

  // -- SLICE L-12: origin reaches the counter --------------------------------
  //
  // The owner's instruction was "the two types need to be distinguishable
  // from each other", and the register was the screen where they were not.
  // These assertions are the proof that the column survives the trip from
  // `orders.origin` to the tile the budtender taps.
  const leaflyRow = {
    id: "o3",
    order_number: "GW-2001",
    customer_first_name: "Sam",
    customer_last_name: "Reed",
    status: "ready" as OrderStatus,
    item_count: 2,
    total_minor_units: 3000,
    placed_at: "2026-02-10T10:00:00Z",
    customer_note: null,
    origin: "leafly",
  };
  const leaflyEntry = toPickupQueueEntry(leaflyRow, "2026-02-10T10:05:00Z");
  ok(leaflyEntry.origin === "leafly", "a Leafly order arrives at the counter as leafly");
  ok(leaflyEntry.originLabel === "Leafly", "the tile gets the shared label, not a local string");
  ok(leaflyEntry.isMarketplace, "a Leafly order is flagged as a marketplace order");

  const siteEntry = toPickupQueueEntry({ ...leaflyRow, origin: "greenway" }, "2026-02-10T10:05:00Z");
  ok(siteEntry.origin === "greenway", "a website order stays a website order");
  ok(siteEntry.originLabel === "Website", "website label");
  ok(!siteEntry.isMarketplace, "a website order is NOT a marketplace order");

  // The two must actually DIFFER - that is the entire request. Asserting each
  // label separately would still pass if someone made both of them "Online".
  ok(
    leaflyEntry.originLabel !== siteEntry.originLabel,
    "THE OWNER'S REQUIREMENT: the two order types render different words",
  );
  ok(
    leaflyEntry.isMarketplace !== siteEntry.isMarketplace,
    "and they differ structurally, not only in wording",
  );

  // Three-state discipline. A row read before migration 0226 has NO origin
  // column at all, which is not the same as a row whose origin is null. Both
  // must resolve to the website default, because the alternative is a blank
  // or a crash on the screen that precedes a regulated handover.
  const noColumn = toPickupQueueEntry(
    {
      id: "o4",
      order_number: "GW-9",
      customer_first_name: "A",
      customer_last_name: null,
      status: "new",
      item_count: 1,
      total_minor_units: 100,
      placed_at: "2026-02-10T10:00:00Z",
      customer_note: null,
    },
    "2026-02-10T10:00:00Z",
  );
  ok(noColumn.origin === "greenway", "a pre-0226 row (no origin column) reads as greenway");
  ok(noColumn.originLabel === "Website", "and still gets a label, never an empty badge");
  const nullOrigin = toPickupQueueEntry({ ...leaflyRow, origin: null }, "2026-02-10T10:00:00Z");
  ok(nullOrigin.origin === "greenway", "an explicitly null origin also reads as greenway");
  const junkOrigin = toPickupQueueEntry({ ...leaflyRow, origin: "weedmaps" }, "2026-02-10T10:00:00Z");
  ok(junkOrigin.origin === "greenway", "an unknown marketplace never blocks a handover");
  ok(!junkOrigin.isMarketplace, "an unrecognised origin is not silently treated as a marketplace");

  // Case/whitespace robustness: the value crosses a database, PostgREST and
  // JSON before it gets here.
  ok(
    toPickupQueueEntry({ ...leaflyRow, origin: "  LEAFLY " }, "2026-02-10T10:00:00Z").origin === "leafly",
    "origin is normalised for case and whitespace",
  );

  // A register-materialized sale is excluded from this queue by staff_note,
  // but if one ever reached here it must not masquerade as a marketplace.
  ok(
    !toPickupQueueEntry({ ...leaflyRow, origin: "register" }, "2026-02-10T10:00:00Z").isMarketplace,
    "a register sale is not a marketplace order",
  );

  // Every entry, whatever the input, carries a non-empty label. An empty
  // badge is worse than no badge: it looks like a rendering bug and staff
  // stop trusting the column.
  ok(
    [leaflyEntry, siteEntry, noColumn, nullOrigin, junkOrigin].every(
      (e) => e.originLabel.trim() !== "",
    ),
    "no entry can ever carry an empty label",
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
