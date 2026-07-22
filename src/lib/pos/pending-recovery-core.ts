/**
 * src/lib/pos/pending-recovery-core.ts  (GW-023 fix)
 *
 * PURE decision logic for recovering ledger rows stranded at `pending`.
 *
 * The hole this closes: the sync path inserts a `pos_sale_events` row as
 * `pending`, runs a long processing chain, and only marks `processed` at the
 * very end. If the serverless function dies in between, the row is stranded
 * at `pending` forever. Worse, the register's retry used to be acked
 * "duplicate" (a durable ack), so the device DELETED its only copy — cash
 * taken, customer gone, but no order, no inventory decrement, no X/Z line,
 * no CCRS row, and nothing anywhere would ever retry it.
 *
 * Recovery discipline (why each branch exists):
 *
 *   wait        — the row is YOUNG: another invocation is very likely still
 *                 mid-chain. Interfering could double-process. The caller
 *                 returns NO ack, and the register's own applyAcks keeps
 *                 un-acked rows queued (verified: register-client-core.ts
 *                 applyAcks → `remaining`), so the device simply retries on
 *                 its next flush. No device change needed.
 *
 *   escalate    — (a) an ORDER already exists for this event: a previous
 *                 attempt crashed mid-materialization. Blindly re-running
 *                 would insert a SECOND order (the order insert is not
 *                 idempotent by itself) — double inventory decrement, double
 *                 revenue. A human must look, so the row becomes an
 *                 EXCEPTION in the manager queue (durably visible, never
 *                 silent). (b) recovery has been attempted MAX times: a
 *                 poison event must not retry forever — same manager queue.
 *
 *   reprocess   — no order exists and attempts remain: everything before the
 *                 order insert is read-only validation, so re-running the
 *                 full chain on the EXISTING ledger row is safe. Punch
 *                 replays are intent-asserting (resolvePunchIntent) and
 *                 audit-only events at worst write a duplicate audit row —
 *                 noise, never money.
 *
 * The absolute double-order guarantee is DB-enforced by migration 0128
 * (orders.pos_client_uuid unique index); this classifier is the fast path
 * that makes the guarantee almost never needed.
 */

// ---------------------------------------------------------------------------
// Tunables (exported so the server + tests share one source of truth)
// ---------------------------------------------------------------------------

/**
 * Duplicate-path staleness: a retried event whose row has been `pending` for
 * at least this long is considered STRANDED (the original invocation is dead
 * — Vercel functions don't run anywhere near this long). Below it: wait.
 */
export const DUPLICATE_RETRY_STALE_MS = 2 * 60_000;

/**
 * Sweeper staleness: the daily cron only touches rows at least this old, so
 * it can never race a healthy in-flight sync.
 */
export const SWEEP_STALE_MS = 10 * 60_000;

/** After this many recovery attempts the row escalates to the manager queue. */
export const MAX_RECOVERY_ATTEMPTS = 3;

/** Sweeper batch cap — keeps the cron comfortably inside its maxDuration. */
export const SWEEP_BATCH_LIMIT = 25;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type PendingRetryDecision =
  | { action: "wait" }
  | { action: "reprocess" }
  | { action: "escalate"; kind: "order_exists" | "attempts_exhausted"; reason: string };

export type PendingRetryInput = {
  /** pos_sale_events.received_at (ISO). Null/garbage ⇒ treated as stale. */
  receivedAtIso: string | null;
  /** Current time in ms (caller supplies — keeps this module pure). */
  nowMs: number;
  /** Staleness threshold for THIS caller (duplicate path vs sweeper). */
  staleAfterMs: number;
  /** pos_sale_events.recovery_attempts (0 on pre-0128 databases). */
  recoveryAttempts: number;
  /** pos_sale_events.order_id — an order this event already materialized. */
  orderId: string | null;
  /** Optional friendlier label for the escalation message. */
  orderNumber?: string | null;
};

export function buildOrderExistsReason(orderId: string, orderNumber?: string | null): string {
  const label = orderNumber ? `#${orderNumber}` : orderId;
  return (
    `Sync recovery: a previous processing attempt crashed AFTER materializing order ${label} ` +
    `but before finishing. The sale was NOT completed automatically because finishing a ` +
    `half-built order blind could double-count it. Review the order (Admin → Orders), ` +
    `verify its lines and total against the register receipt, complete or cancel it by hand, ` +
    `then resolve this exception.`
  );
}

export function buildAttemptsExhaustedReason(attempts: number): string {
  return (
    `Sync recovery: processing this event crashed ${attempts} time(s) without completing — ` +
    `it will not be retried automatically again. Review the payload below, re-ring the sale ` +
    `if it never materialized, then resolve this exception.`
  );
}

/**
 * Decide what to do with a `pending` ledger row that has been seen again
 * (register retry) or found by the sweeper. Order of checks matters:
 * youth wins (an in-flight chain must not be disturbed — even if it already
 * created its order, it is about to finish on its own), then the
 * order-exists guard, then the attempts cap.
 */
export function classifyPendingRetry(input: PendingRetryInput): PendingRetryDecision {
  const received = input.receivedAtIso ? Date.parse(input.receivedAtIso) : NaN;
  // A garbage/missing timestamp must not strand the row forever — treat as stale.
  const ageMs = Number.isFinite(received) ? input.nowMs - received : Number.POSITIVE_INFINITY;
  if (ageMs < input.staleAfterMs) return { action: "wait" };

  if (input.orderId) {
    return {
      action: "escalate",
      kind: "order_exists",
      reason: buildOrderExistsReason(input.orderId, input.orderNumber ?? null),
    };
  }
  if (input.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
    return {
      action: "escalate",
      kind: "attempts_exhausted",
      reason: buildAttemptsExhaustedReason(input.recoveryAttempts),
    };
  }
  return { action: "reprocess" };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runPendingRecoveryCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  const NOW = Date.parse("2026-07-21T18:00:00.000Z");
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
  const base: PendingRetryInput = {
    receivedAtIso: iso(0),
    nowMs: NOW,
    staleAfterMs: DUPLICATE_RETRY_STALE_MS,
    recoveryAttempts: 0,
    orderId: null,
  };

  // Youth wins — never disturb an in-flight chain.
  ok(classifyPendingRetry({ ...base, receivedAtIso: iso(30_000) }).action === "wait", "30s old → wait");
  ok(
    classifyPendingRetry({ ...base, receivedAtIso: iso(30_000), orderId: "o-1" }).action === "wait",
    "young + order already exists → still wait (chain is about to finish itself)",
  );
  ok(
    classifyPendingRetry({ ...base, receivedAtIso: iso(DUPLICATE_RETRY_STALE_MS - 1) }).action === "wait",
    "1ms under the threshold → wait",
  );

  // Exactly at / beyond the threshold → recover.
  ok(
    classifyPendingRetry({ ...base, receivedAtIso: iso(DUPLICATE_RETRY_STALE_MS) }).action === "reprocess",
    "exactly at the threshold → reprocess",
  );
  ok(
    classifyPendingRetry({ ...base, receivedAtIso: iso(60 * 60_000) }).action === "reprocess",
    "an hour old, no order, attempts remain → reprocess",
  );

  // Order-exists guard — never blind re-run over a materialized order.
  {
    const d = classifyPendingRetry({
      ...base,
      receivedAtIso: iso(10 * 60_000),
      orderId: "11111111-1111-4111-8111-111111111111",
      orderNumber: "GW-1042",
    });
    ok(d.action === "escalate" && d.kind === "order_exists", "stale + order → escalate order_exists");
    ok(
      d.action === "escalate" && d.reason.includes("#GW-1042") && d.reason.includes("double-count"),
      "order_exists reason names the order and the double-count danger",
    );
  }
  {
    const d = classifyPendingRetry({ ...base, receivedAtIso: iso(10 * 60_000), orderId: "raw-id" });
    ok(d.action === "escalate" && d.reason.includes("raw-id"), "order_exists reason falls back to the raw id");
  }

  // Attempts cap — poison events must not retry forever.
  {
    const d = classifyPendingRetry({
      ...base,
      receivedAtIso: iso(10 * 60_000),
      recoveryAttempts: MAX_RECOVERY_ATTEMPTS,
    });
    ok(d.action === "escalate" && d.kind === "attempts_exhausted", "attempts at cap → escalate");
    ok(d.action === "escalate" && d.reason.includes(`${MAX_RECOVERY_ATTEMPTS} time(s)`), "attempts reason counts");
  }
  ok(
    classifyPendingRetry({
      ...base,
      receivedAtIso: iso(10 * 60_000),
      recoveryAttempts: MAX_RECOVERY_ATTEMPTS - 1,
    }).action === "reprocess",
    "one attempt below the cap → reprocess",
  );

  // Garbage timestamps recover rather than strand.
  ok(classifyPendingRetry({ ...base, receivedAtIso: null }).action === "reprocess", "null received_at → stale → reprocess");
  ok(classifyPendingRetry({ ...base, receivedAtIso: "not-a-date" }).action === "reprocess", "garbage received_at → stale → reprocess");

  // Sweeper threshold is stricter than the duplicate path (sanity on constants).
  ok(SWEEP_STALE_MS > DUPLICATE_RETRY_STALE_MS, "sweeper threshold is the more conservative one");
  ok(MAX_RECOVERY_ATTEMPTS >= 1 && SWEEP_BATCH_LIMIT >= 1, "tunables are sane");

  console.log(`pending-recovery-core: ${pass} passed, ${fail} failed`);
  if (fail > 0) throw new Error(`pending-recovery-core self-tests: ${fail} failure(s)`);
}
