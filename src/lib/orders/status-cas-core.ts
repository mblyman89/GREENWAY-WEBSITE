/**
 * src/lib/orders/status-cas-core.ts  (GW-011 fix)
 *
 * PURE classification of a compare-and-swap MISS on the order status flip.
 *
 * setOrderStatus now updates with `.eq("id", id).eq("status", fromStatus)` —
 * a true compare-and-swap. When the update matches ZERO rows, somebody else
 * changed the order between our read and our write. This module decides what
 * that means:
 *
 *   - The order is now AT the status we wanted → another actor already made
 *     this exact transition (e.g. a POS sync retry racing a back-office
 *     click). That is CONVERGENCE, not failure: report success, but the
 *     caller MUST NOT run the side effects — the winner already did.
 *   - The order is anywhere else → a real CONFLICT: someone moved the order
 *     under us. Refuse with a plain-English message telling the actor to
 *     refresh and look again.
 *   - The order vanished → treat as conflict (deleted/never existed).
 */

import type { OrderStatus } from "@/lib/orders/types";

export type StatusCasMissVerdict =
  | { kind: "converged" }
  | { kind: "conflict"; refusal: string };

export function classifyStatusCasMiss(
  toStatus: OrderStatus,
  statusAfterMiss: OrderStatus | null,
): StatusCasMissVerdict {
  if (statusAfterMiss === toStatus) return { kind: "converged" };
  if (statusAfterMiss === null) {
    return {
      kind: "conflict",
      refusal: "This order could not be found anymore. Refresh the page and check its current state.",
    };
  }
  return {
    kind: "conflict",
    refusal: `Someone else just changed this order (it is now "${statusAfterMiss}"). Refresh the page and check its current state before acting again.`,
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runStatusCasCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  // Convergence: the other actor made the SAME transition — success, and the
  // caller skips side effects (the winner ran them).
  const converged = classifyStatusCasMiss("completed", "completed");
  ok(converged.kind === "converged", "same target status → converged");

  // Conflict: the order moved somewhere ELSE under us.
  const conflict = classifyStatusCasMiss("completed", "cancelled");
  ok(conflict.kind === "conflict", "different status → conflict");
  ok(conflict.kind === "conflict" && conflict.refusal.includes('"cancelled"'), "refusal names the current status");
  ok(conflict.kind === "conflict" && conflict.refusal.toLowerCase().includes("refresh"), "refusal tells the actor to refresh");

  // Vanished row → conflict with its own message.
  const gone = classifyStatusCasMiss("ready", null);
  ok(gone.kind === "conflict", "missing order → conflict");
  ok(gone.kind === "conflict" && gone.refusal.toLowerCase().includes("could not be found"), "missing-order refusal is explicit");

  // Forward moves that DIDN'T race the same way are still conflicts, never
  // silent successes: ready→completed raced by ready→preparing.
  const moved = classifyStatusCasMiss("completed", "preparing");
  ok(moved.kind === "conflict", "raced to a different status → conflict, never silent success");

  console.log(`status-cas-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`status-cas-core self-tests: ${fail} failure(s)`);
}
