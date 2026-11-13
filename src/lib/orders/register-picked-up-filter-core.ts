/**
 * src/lib/orders/register-picked-up-filter-core.ts  (D240)
 *
 * ONLINE ORDERS THE CUSTOMER COLLECTED AT THE REGISTER ARE "COMPLETED" ON THE
 * ORDERS BOARD.
 *
 * Owner (verbatim, D240): "The online orders is still not right. I am not
 * able to see completed online orders. I am only able to see total orders and
 * canceled orders. Please fix this for me so I can filter to see online
 * orders that were completed at the register."
 *
 * Why the Completed tab was always empty (production, read only, 2026-11-12:
 * 0 online orders with status 'completed'; 6 of the 15 cancelled online
 * orders carry the register pickup note):
 *
 *   When a budtender loads a website / Leafly order at the register and rings
 *   it up, the register writes its OWN order (the sale of record) and closes
 *   the online order as status "cancelled" ON PURPOSE (SLICE L-37,
 *   sync-store.ts): a second "completed" order would count the revenue, the
 *   excise, CCRS, the ledger, the stock and the points twice. The close
 *   writes an order_events row
 *       event_type = 'status_changed', to_status = 'cancelled',
 *       note LIKE 'PICKED UP AT THE REGISTER%'
 *   and the rows already READ "Picked up (register)". But the status tabs and
 *   their counts went by the raw status, so every collected order sat under
 *   "Cancelled" and "Completed" showed nothing.
 *
 * THE RULE (board only, nothing in the database changes):
 *
 *   Completed tab = status 'completed'
 *                   OR (status 'cancelled' AND it has the pickup event)
 *   Cancelled tab = status 'cancelled' AND it has NO pickup event
 *   counts        = the same move: picked-up orders leave "cancelled" and
 *                   join "completed", so the tab number matches its rows.
 *
 * The stored status stays "cancelled", so every revenue / tax / CCRS report
 * that reads status is untouched (the register sale is still the one sale).
 *
 * HOW THE STORE ASKS POSTGREST (verified against PostgREST 12.2.3, which is
 * what Supabase runs, with two pickup events on one order, a true cancel, a
 * note on a still-open order and a second `or=` from the search box):
 *   select  *, rpu:order_events(id)          embed, filtered to pickup events
 *   rpu.event_type=eq.status_changed
 *   rpu.to_status=eq.cancelled
 *   rpu.note=like.PICKED UP AT THE REGISTER%
 *   Completed: or=(status.eq.completed,and(status.eq.cancelled,rpu.not.is.null))
 *   Cancelled: status=eq.cancelled & rpu=is.null
 * An embed never multiplies the parent row (two pickup events still count as
 * one order), and a second `.or()` is ANDed with the first, so the search box
 * keeps working on both tabs.
 *
 * PURE: no I/O, no React.
 */

import { REGISTER_PICKED_UP_NOTE_PREFIX } from "@/lib/pos/pickup-progress-core";
import type { OrderStatus } from "@/lib/orders/types";

/** The embed alias the store uses. Stripped from rows before they leave the store. */
export const PICKED_UP_EMBED = "rpu" as const;

/** The select list that carries the pickup embed. */
export const PICKED_UP_SELECT = `*, ${PICKED_UP_EMBED}:order_events(id)` as const;

/** The select list for a head count of picked-up orders (inner join). */
export const PICKED_UP_COUNT_SELECT = `id, ${PICKED_UP_EMBED}:order_events!inner(id)` as const;

/** The filters that narrow the embed to the register pickup event only. */
export const PICKED_UP_EMBED_FILTERS: readonly { column: string; op: "eq" | "like"; value: string }[] = [
  { column: `${PICKED_UP_EMBED}.event_type`, op: "eq", value: "status_changed" },
  { column: `${PICKED_UP_EMBED}.to_status`, op: "eq", value: "cancelled" },
  { column: `${PICKED_UP_EMBED}.note`, op: "like", value: `${REGISTER_PICKED_UP_NOTE_PREFIX}%` },
];

/** Completed tab: really completed, or cancelled-because-collected. */
export const COMPLETED_WITH_PICKED_UP_OR = `status.eq.completed,and(status.eq.cancelled,${PICKED_UP_EMBED}.not.is.null)`;

/**
 * How a status tab needs the pickup embed, or null when it does not (every
 * other tab filters on the stored status exactly as before).
 */
export type PickedUpTabPlan =
  | { kind: "completed_or_picked_up" }
  | { kind: "cancelled_not_picked_up" }
  | null;

export function pickedUpTabPlan(status: string | null | undefined): PickedUpTabPlan {
  if (status === "completed") return { kind: "completed_or_picked_up" };
  if (status === "cancelled") return { kind: "cancelled_not_picked_up" };
  return null;
}

/**
 * Move `pickedUp` orders from "cancelled" to "completed". Never makes a count
 * negative: if the pickup count is larger than the cancelled count (it cannot
 * be when both come from the same filter, but a read can race a write), only
 * what is there moves. Garbage / negative input moves nothing.
 */
export function foldPickedUpIntoCompleted<C extends Record<OrderStatus, number>>(counts: C, pickedUp: number): C {
  const n = Number.isFinite(pickedUp) && pickedUp > 0 ? Math.floor(pickedUp) : 0;
  const moved = Math.min(n, Math.max(0, counts.cancelled));
  if (moved === 0) return counts;
  return { ...counts, cancelled: counts.cancelled - moved, completed: counts.completed + moved };
}

/** Remove the embed column from a row the store read with PICKED_UP_SELECT. */
export function stripPickedUpEmbed<T extends Record<string, unknown>>(row: T): Omit<T, typeof PICKED_UP_EMBED> {
  if (!row || typeof row !== "object" || !(PICKED_UP_EMBED in row)) return row;
  const { [PICKED_UP_EMBED]: _omit, ...rest } = row;
  void _omit;
  return rest;
}

/**
 * The status the board files an order under: a cancelled order the customer
 * collected at the register files as "completed". Used by the Leafly panel,
 * which filters its loaded rows in memory.
 */
export function boardStatus(status: OrderStatus, pickedUpAtRegister: boolean): OrderStatus {
  return status === "cancelled" && pickedUpAtRegister ? "completed" : status;
}

export function __runRegisterPickedUpFilterTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL register-picked-up-filter-core: ${name}`);
    }
  };
  const zero = { new: 0, acknowledged: 0, preparing: 0, ready: 0, completed: 0, cancelled: 0, no_show: 0 };
  ok("completed tab plan", pickedUpTabPlan("completed")?.kind === "completed_or_picked_up");
  ok("cancelled tab plan", pickedUpTabPlan("cancelled")?.kind === "cancelled_not_picked_up");
  ok("other tabs untouched", ["active", "all", "new", "ready", "no_show", undefined, null].every((s) => pickedUpTabPlan(s) === null));
  const f = foldPickedUpIntoCompleted({ ...zero, completed: 1, cancelled: 15 }, 6);
  ok("fold moves", f.completed === 7 && f.cancelled === 9);
  ok("fold keeps the total", f.completed + f.cancelled === 16);
  ok("fold never negative", foldPickedUpIntoCompleted({ ...zero, cancelled: 2 }, 5).cancelled === 0);
  ok("fold caps at cancelled", foldPickedUpIntoCompleted({ ...zero, cancelled: 2 }, 5).completed === 2);
  ok("fold ignores garbage", foldPickedUpIntoCompleted({ ...zero, cancelled: 2 }, Number.NaN).cancelled === 2);
  ok("fold ignores negative", foldPickedUpIntoCompleted({ ...zero, cancelled: 2 }, -3).cancelled === 2);
  ok("strip removes embed", !("rpu" in stripPickedUpEmbed({ id: "a", rpu: [{ id: 1 }] })));
  ok("strip keeps fields", stripPickedUpEmbed({ id: "a", rpu: [] }).id === "a");
  ok("boardStatus collected", boardStatus("cancelled", true) === "completed");
  ok("boardStatus true cancel", boardStatus("cancelled", false) === "cancelled");
  ok("boardStatus never touches an open order", boardStatus("ready", true) === "ready");
  ok("or clause shape", COMPLETED_WITH_PICKED_UP_OR === "status.eq.completed,and(status.eq.cancelled,rpu.not.is.null)");
  ok("note filter uses the sync's prefix", PICKED_UP_EMBED_FILTERS[2].value === `${REGISTER_PICKED_UP_NOTE_PREFIX}%`);
  return { passed, failed };
}
