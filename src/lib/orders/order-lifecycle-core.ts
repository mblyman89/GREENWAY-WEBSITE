/**
 * src/lib/orders/order-lifecycle-core.ts
 *
 * PURE order status lifecycle rules (GAP LOW / Roadmap S-15).
 * No `server-only`, no DB — safe to import from tests and tsx harnesses.
 *
 * Why this exists: before S-15 the store accepted ANY from→to status change
 * (e.g. completed→new), which corrupts the audit story for a completed SALE.
 * Under WAC 314-55 record-keeping expectations a completed sale must never be
 * silently rewound — any reversal has to be an explicit, reasoned, audited
 * event.
 *
 * Rules encoded here:
 *  - The active chain moves FORWARD only: new → acknowledged → preparing →
 *    ready → completed (skipping ahead is allowed — e.g. a phone order that is
 *    bagged and handed over in one step).
 *  - Any ACTIVE order may close as cancelled or no_show.
 *  - completed / cancelled / no_show are TERMINAL. The only way out is an
 *    explicit REVERSAL that carries a written reason (min 5 chars); callers
 *    must record it as its own order event + audit row.
 *  - Moving BACKWARD within the active chain (e.g. ready → preparing) also
 *    requires a reversal reason — it undoes recorded workflow history.
 *  - from === to is a permitted no-op (idempotent re-submits).
 */

import type { OrderStatus } from "./types";

/** Position of each status along the forward workflow. Closures sit "after" ready. */
const ACTIVE_CHAIN: OrderStatus[] = ["new", "acknowledged", "preparing", "ready"];
const CLOSED: OrderStatus[] = ["completed", "cancelled", "no_show"];

export const MIN_REVERSAL_REASON_LENGTH = 5;

/** Where a closed order may be reopened TO (with a reasoned reversal). */
export const ORDER_REVERSAL_TARGETS: Record<string, OrderStatus> = {
  completed: "ready", // undo a mistaken completion; picks back up at "ready"
  cancelled: "new", // un-cancel; re-enters the queue
  no_show: "new", // customer showed up after all; re-enters the queue
};

export type OrderTransitionKind = "noop" | "forward" | "closure" | "reversal";

export type OrderTransitionVerdict = {
  allowed: boolean;
  kind: OrderTransitionKind;
  /** Human-readable refusal (present when !allowed). */
  reason?: string;
};

function isClosed(s: OrderStatus): boolean {
  return CLOSED.includes(s);
}

/**
 * Evaluate a proposed status change. `reversalReason` is required for any
 * change that rewinds history (closed → active, or backward within the active
 * chain). Pure and deterministic.
 */
export function evaluateOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
  opts: { reversalReason?: string | null } = {},
): OrderTransitionVerdict {
  if (from === to) return { allowed: true, kind: "noop" };

  const reason = (opts.reversalReason ?? "").trim();
  const hasReason = reason.length >= MIN_REVERSAL_REASON_LENGTH;

  // ── From a CLOSED status: terminal unless a reasoned reversal to the
  //    designated reopen target.
  if (isClosed(from)) {
    const target = ORDER_REVERSAL_TARGETS[from];
    if (to !== target) {
      return {
        allowed: false,
        kind: "reversal",
        reason: `A ${from} order is closed. It may only be reopened to "${target}" via a logged reversal with a written reason.`,
      };
    }
    if (!hasReason) {
      return {
        allowed: false,
        kind: "reversal",
        reason: `Reopening a ${from} order requires a written reason (at least ${MIN_REVERSAL_REASON_LENGTH} characters) — it is logged to the order timeline and the audit trail.`,
      };
    }
    return { allowed: true, kind: "reversal" };
  }

  // ── From an ACTIVE status: closures are always available.
  if (isClosed(to)) return { allowed: true, kind: "closure" };

  // ── Active → active: forward is free; backward needs a reasoned reversal.
  const fromIdx = ACTIVE_CHAIN.indexOf(from);
  const toIdx = ACTIVE_CHAIN.indexOf(to);
  if (toIdx > fromIdx) return { allowed: true, kind: "forward" };

  if (!hasReason) {
    return {
      allowed: false,
      kind: "reversal",
      reason: `Moving an order backward (${from} → ${to}) rewinds recorded workflow history and requires a written reason (at least ${MIN_REVERSAL_REASON_LENGTH} characters).`,
    };
  }
  return { allowed: true, kind: "reversal" };
}

/** True when the order is in a terminal (closed) status. */
export function isTerminalOrderStatus(s: OrderStatus): boolean {
  return isClosed(s);
}
