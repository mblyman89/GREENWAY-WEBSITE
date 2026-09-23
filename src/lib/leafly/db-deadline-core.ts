/**
 * src/lib/leafly/db-deadline-core.ts
 *
 * SLICE L-25 — THE HALF OF THE DEADLINE THAT WAS NEVER A DEADLINE AT ALL.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS — THE THIRD ATTEMPT AT ONE BUG
 * ===========================================================================
 * The owner has now reported the same defect three times:
 *
 *   > "I have tested the Leafly order acknowledge button again, and it is
 *   >  still unable to complete. It just spins and thinks and never finishes."
 *
 * Twice we bounded the network and twice the hang survived:
 *
 *   L-17  bounded the CONNECTION  (`leaflyFetchWithDeadline`)      → persisted
 *   L-23  bounded the RESPONSE BODY (the read moved inside budget) → persisted
 *
 * Both fixes were correct. Both are load-bearing. Neither was the cause,
 * because both were looking at the network — and the acknowledge path's
 * network was, by then, the only part of it that could not hang.
 *
 * ── WHAT WAS ACTUALLY MISSING ────────────────────────────────────────────
 * A single acknowledge click performs FOUR network calls (all bounded) and at
 * least TEN database calls (none bounded). `createSupabaseAdminClient()`
 * builds a client with no timeout of any kind, and `abortSignal()` — which
 * postgrest-js has supported all along —
 *
 *     node_modules/@supabase/postgrest-js/dist/index.d.cts:
 *       abortSignal(signal: AbortSignal): this;
 *
 * appeared ZERO times anywhere in src/.
 *
 * ── MEASURED, NOT ASSUMED ────────────────────────────────────────────────
 * `scripts/recon/supabase-hang-probe.mjs` stands up a real `node:http` server
 * that accepts the connection and then answers nothing — what a saturated
 * connection pooler looks like from the outside — and runs the exact query
 * shape `getIntegrationCredentialsRow()` uses:
 *
 *     [probe 1] UNBOUNDED (today's code): after 8006ms settled=false
 *                                         -> STILL HANGING
 *     [probe 2] BOUNDED (abortSignal 1500ms): after 1505ms
 *               -> returned an error value: TimeoutError: The operation was
 *                  aborted due to timeout
 *
 * That is the whole bug. On Vercel the unbounded version hangs until the
 * PLATFORM kills the function, which is "about five minutes" — precisely the
 * duration the owner reports, every time, on a route that declares no
 * `maxDuration` and therefore inherits the maximum.
 *
 * ===========================================================================
 * WHY A TIMEOUT IS RETURNED AS A VALUE, NEVER THROWN
 * ===========================================================================
 * Probe 2 establishes something that shapes this entire design: an aborted
 * PostgREST query comes back through the normal `{ data, error }` channel.
 * Every existing `if (error)` branch in this codebase therefore handles a
 * deadline correctly the moment the signal is attached — no call site has to
 * learn a new failure mode, and no try/catch has to be added to code that
 * handles money.
 *
 * This file is PURE. It decides budgets and sentences and nothing else, so
 * that every number below is asserted in CI without a database.
 */

/**
 * The database operations that sit on an attended, clock-bound path.
 *
 * DELIBERATELY NOT "every query in the application". Bounding a long report
 * or a nightly export at eight seconds would break working features to fix a
 * different one. The list is exactly the reads and writes that run while a
 * person is watching a spinner on a Leafly order, because those are the ones
 * whose failure mode is the hang being fixed here.
 */
export const LEAFLY_DB_OPERATIONS = [
  "credentials_read",
  "order_read",
  "order_write",
  "attempt_log",
  "audit_log",
  "bridge_write",
] as const;

export type LeaflyDbOperation = (typeof LEAFLY_DB_OPERATIONS)[number];

/**
 * Per-query budgets, in milliseconds.
 *
 * ── HOW THESE NUMBERS WERE CHOSEN ────────────────────────────────────────
 * They are derived from a constraint, not from taste. The acknowledge click
 * must finish inside the platform's limit with room for the operator to read
 * the answer, and the NETWORK half already costs up to 80 seconds (two
 * bounded operations, each with a 401 retry, each retry paying a token mint:
 * 2*(12+8) for the acknowledge plus 2*(12+8) for the nested status push).
 *
 * So the database half must fit in what remains. Summing the worst case
 * below gives `worstCaseDbMs()`, and `LEAFLY_ACK_TOTAL_BUDGET_MS` asserts the
 * two halves together still land comfortably under the ceiling.
 *
 * ── WHY A CREDENTIALS READ IS THE TIGHTEST ───────────────────────────────
 * It is a single-row primary-key lookup on a table with one row. If that
 * takes more than five seconds the database is not slow, it is unreachable,
 * and waiting longer cannot change the answer. It is also the query that runs
 * FOUR TIMES on one click, so its budget is multiplied by four in practice —
 * which is itself an argument for the request-scoped cache this slice adds.
 *
 * ── WHY THE WRITES GET MORE THAN THE READS ───────────────────────────────
 * A write can legitimately wait on a lock that a concurrent transaction is
 * holding, and the correct response to a contended lock is usually to wait a
 * moment, not to give up. A read of a single row has no such excuse.
 *
 * ── WHY THE LOGS GET THE LEAST ───────────────────────────────────────────
 * The attempt log and the audit log are bookkeeping. They are important, but
 * an acknowledgement that succeeded at Leafly must never be reported as
 * failed because we could not write a log row about it — `order-ack-server`
 * already treats both as best-effort. A tight budget makes that posture real
 * instead of aspirational.
 */
export const LEAFLY_DB_TIMEOUT_MS: Readonly<Record<LeaflyDbOperation, number>> = {
  credentials_read: 5_000,
  order_read: 6_000,
  order_write: 8_000,
  attempt_log: 5_000,
  audit_log: 5_000,
  bridge_write: 8_000,
};

/**
 * How many of each operation ONE acknowledge click performs, worst case.
 *
 * Read out of the code, not estimated. The trace, from
 * `acknowledgeLeaflyOrderAction`:
 *
 *   credentials_read x4 — refreshLeaflyConfig + loadLeaflyOrderIntegrationKey,
 *                         once in resolveOrderApiContext and AGAIN inside the
 *                         nested setLeaflyOrderStatus("confirmed")
 *   order_read      x2 — requirePermission's profile lookup, getLeaflyBoardOrder
 *   order_write     x1 — markLeaflyOrderAcknowledged
 *   bridge_write    x4 — loadBridgeRow, insert order, insert lines, link
 *   attempt_log     x2 — the acknowledge's row and the status push's row
 *   audit_log       x1 — recordAudit
 *
 * This table exists so that `worstCaseDbMs()` is computed from the real shape
 * of the work rather than from a number somebody felt was about right. If the
 * path grows another query, this table is where that cost becomes visible.
 */
export const LEAFLY_DB_ACK_CALLS: Readonly<Record<LeaflyDbOperation, number>> = {
  credentials_read: 4,
  order_read: 2,
  order_write: 1,
  attempt_log: 2,
  audit_log: 1,
  bridge_write: 4,
};

/** The budget for one query. Unknown operations get the tightest budget. */
export function dbTimeoutForOperation(operation: string): number {
  const key = typeof operation === "string" ? operation.trim() : "";
  if (isLeaflyDbOperation(key)) return LEAFLY_DB_TIMEOUT_MS[key];
  // An unrecognised operation is a programming mistake, not a licence to
  // hang — the same posture `timeoutForOperation` takes for the network.
  return LEAFLY_DB_TIMEOUT_MS.credentials_read;
}

export function isLeaflyDbOperation(value: unknown): value is LeaflyDbOperation {
  return (
    typeof value === "string" &&
    (LEAFLY_DB_OPERATIONS as readonly string[]).includes(value)
  );
}

/**
 * The worst case the DATABASE can contribute to one acknowledge click.
 *
 * Every query on the path, each taking its full budget and timing out.
 */
export function worstCaseDbMs(): number {
  let total = 0;
  for (const op of LEAFLY_DB_OPERATIONS) {
    total += LEAFLY_DB_TIMEOUT_MS[op] * LEAFLY_DB_ACK_CALLS[op];
  }
  return total;
}

/**
 * The worst case the NETWORK can contribute to one acknowledge click.
 *
 * ── WHY THIS IS NOT `worstCaseMs("acknowledge")` ─────────────────────────
 * Because that function answers a different question, and the difference is
 * the kind that costs an afternoon. `worstCaseMs("acknowledge")` returns
 * 40,000 — two attempts, each paying a token mint — and it is RIGHT about the
 * operation it models.
 *
 * But one press of the Accept button does not run one operation. On success
 * it runs the acknowledge AND a nested `setLeaflyOrderStatus("confirmed")`
 * (order-ack-server.ts, the L-14 correction: acknowledge is a RECEIPT, the
 * status push is the business ACCEPTANCE). Each is independently bounded and
 * each independently retries a 401.
 *
 * So the operator's true network worst case is EIGHTY seconds, not forty, and
 * anyone budgeting from the core's number alone would size this path at half
 * what it can actually cost. Stated here, in its own function, with its own
 * assertion, so the doubling is impossible to miss.
 *
 * Passed the two operation budgets rather than importing them, to keep this
 * module free of imports and therefore trivially testable.
 */
export function worstCaseAckNetworkMs(input: {
  acknowledgeWorstCaseMs: number;
  statusPushWorstCaseMs: number;
}): number {
  const ack = Number.isFinite(input.acknowledgeWorstCaseMs)
    ? input.acknowledgeWorstCaseMs
    : 0;
  const status = Number.isFinite(input.statusPushWorstCaseMs)
    ? input.statusPushWorstCaseMs
    : 0;
  return ack + status;
}

/**
 * The ceiling the whole server action is held to.
 *
 * ── WHY 240 SECONDS AND NOT 300 ──────────────────────────────────────────
 * 300 is Vercel's maximum, and a budget equal to the platform's limit is not
 * a budget: the platform wins the race and kills the function, which produces
 * exactly the symptom being fixed — a spinner that ends in a dead page with
 * no message. The point of an internal deadline is to lose the race
 * DELIBERATELY, by enough margin to render a sentence and redirect.
 *
 * Sixty seconds of headroom is enough to finish the audit write, build the
 * redirect URL and render the target page.
 */
export const LEAFLY_ACK_TOTAL_BUDGET_MS = 240_000;

/** Vercel's hard ceiling. Recorded so the invariant below can be asserted. */
export const PLATFORM_MAX_DURATION_MS = 300_000;

/**
 * What to tell the operator when the whole action ran out of time.
 *
 * ── WHY THIS SENTENCE IS SO CAREFUL ──────────────────────────────────────
 * An acknowledge that times out is the single most dangerous state in this
 * integration, because the truth is genuinely unknown: Leafly may have
 * received and processed the POST while we stopped listening, and
 * acknowledgement permanently revokes access to the shopper's ID images.
 *
 * So the sentence must do three things at once — say we do not know, forbid
 * the retry that would be a second press on a one-way door, and name the
 * action that actually resolves it (look at Leafly). Anything shorter
 * produces either a double acknowledgement or a missed order.
 */
export function describeAckTimeout(input: {
  budgetMs: number;
  /** True once the POST to Leafly has been sent and not yet answered. */
  requestWasSent: boolean;
}): string {
  const seconds = Math.round((Number.isFinite(input.budgetMs) ? input.budgetMs : 0) / 1000);
  if (input.requestWasSent) {
    return (
      `We asked Leafly to acknowledge this order but got no answer within ${seconds} seconds, ` +
      `so we cannot tell whether it went through. DO NOT press Accept again — if it did go ` +
      `through, that door is already closed. Open this order in Leafly: if it shows as ` +
      `acknowledged, carry on and build it. If it does not, Leafly's fifteen-minute window may ` +
      `still be running and you can try once more.`
    );
  }
  return (
    `This took longer than ${seconds} seconds and was stopped before anything was sent to ` +
    `Leafly, so the order is NOT acknowledged and nothing has changed. Leafly's fifteen-minute ` +
    `window is still running — try again, and if it fails the same way, check the Integrations ` +
    `page.`
  );
}

/**
 * What to tell the operator when the order's details were never collected.
 *
 * ── THE DEFECT THIS NAMES ────────────────────────────────────────────────
 * The owner opened an order and found it completely empty:
 *
 *   > "when I open an order, everything is completely blank. There is no info
 *   >  at all. Is this why we can't acknowledge an order? Are we not getting
 *   >  the proper data from Leafly to acknowledge in the first place?"
 *
 * He is reading it correctly. `leafly_orders.raw_order` is written twice in an
 * order's life: first with Leafly's FIVE-FIELD submission webhook (eventTime,
 * eventType, orderId, orderIntegrationKey, acknowledgeBy — no cart, no
 * customer, no totals), and then overwritten by `collectLeaflyOrder()` with
 * the real Order fetched via `GET /{key}/orders/{id}`.
 *
 * A blank detail view is therefore POSITIVE EVIDENCE that the GET never
 * succeeded. Measured by running the spec's own example webhook through the
 * real production reader: 18 of 18 fields blank, while a real Order payload
 * through the same reader parses perfectly.
 *
 * ── WHY THAT IS A COMPLIANCE PROBLEM, NOT A COSMETIC ONE ─────────────────
 * Leafly's rule, verbatim: orders are acknowledged "as having been retrieved
 * **in whole** by your system". Acknowledging an order we never retrieved
 * asserts something untrue to a third party, destroys our only access to the
 * customer's ID images, and leaves staff with no cart to build from.
 */
export function describeUncollectedOrder(input: {
  leaflyOrderId: string | null | undefined;
  /** True when Leafly's fifteen-minute acknowledgement window has passed. */
  windowExpired: boolean;
}): string {
  const id =
    typeof input.leaflyOrderId === "string" && input.leaflyOrderId.trim() !== ""
      ? input.leaflyOrderId.trim()
      : "this order";
  const base =
    `We received Leafly's notification for ${id}, but we never managed to download the ` +
    `order itself — so there is no customer, no cart and no total to show. This is OUR ` +
    `side failing to collect it, not Leafly sending an empty order.`;
  if (input.windowExpired) {
    return (
      `${base} Leafly's fifteen-minute acknowledgement window has already passed, so this ` +
      `order has almost certainly been auto-cancelled on their side. Open it in Leafly to ` +
      `confirm before contacting the customer.`
    );
  }
  return (
    `${base} Press “Get the order details from Leafly” below to try again. Do NOT acknowledge ` +
    `until the cart appears: acknowledging tells Leafly we have the order in full, and it ` +
    `permanently ends your access to the customer's ID images.`
  );
}

/* ------------------------------------------------------------------------- *
 * SELF-TESTS
 *
 * Run by scripts/compliance/run-pure-selftests.ts. Pure, so they need no
 * database, no network and no Leafly account.
 * ------------------------------------------------------------------------- */

function ok(condition: boolean, label: string): void {
  if (!condition) throw new Error(`db-deadline-core self-test failed: ${label}`);
}

export function __selfTestDbDeadlineCore(): number {
  let assertions = 0;
  const check = (condition: boolean, label: string) => {
    ok(condition, label);
    assertions += 1;
  };

  // ── Every operation has a finite, positive budget ───────────────────────
  // This is the invariant the whole file exists to hold. A zero or a missing
  // entry would reintroduce the unbounded wait by accident.
  for (const op of LEAFLY_DB_OPERATIONS) {
    const ms = LEAFLY_DB_TIMEOUT_MS[op];
    check(typeof ms === "number" && Number.isFinite(ms), `${op} has a numeric budget`);
    check(ms > 0, `${op} budget is positive`);
    check(ms <= 15_000, `${op} budget stays attended-scale`);
  }

  // ── No "0 means unlimited" escape hatch ─────────────────────────────────
  check(
    Object.values(LEAFLY_DB_TIMEOUT_MS).every((v) => v > 0),
    "no database budget is zero",
  );

  // ── Unknown operations get the tightest budget, not an unbounded one ────
  check(
    dbTimeoutForOperation("not_a_real_operation") === LEAFLY_DB_TIMEOUT_MS.credentials_read,
    "unknown operation falls back to the tightest budget",
  );
  check(dbTimeoutForOperation("") === LEAFLY_DB_TIMEOUT_MS.credentials_read, "empty falls back");
  check(
    dbTimeoutForOperation("  order_write  ") === LEAFLY_DB_TIMEOUT_MS.order_write,
    "operation names are trimmed",
  );
  check(dbTimeoutForOperation("order_read") === 6_000, "order_read resolves to its own budget");

  // ── The type guard ──────────────────────────────────────────────────────
  check(isLeaflyDbOperation("credentials_read"), "guard accepts a real operation");
  check(!isLeaflyDbOperation("credentials"), "guard rejects a near miss");
  check(!isLeaflyDbOperation(null), "guard rejects null");
  check(!isLeaflyDbOperation(12), "guard rejects a number");

  // ── The credentials read is the tightest, because it runs four times ────
  check(
    LEAFLY_DB_TIMEOUT_MS.credentials_read <= LEAFLY_DB_TIMEOUT_MS.order_read,
    "the credentials read is no looser than an order read",
  );
  check(
    LEAFLY_DB_TIMEOUT_MS.order_write >= LEAFLY_DB_TIMEOUT_MS.order_read,
    "a write may wait on a lock; a single-row read may not",
  );

  // ── The call table reflects the real trace ──────────────────────────────
  check(
    LEAFLY_DB_ACK_CALLS.credentials_read === 4,
    "the credentials row is read four times per click",
  );
  check(
    LEAFLY_DB_ACK_CALLS.attempt_log === 2,
    "two attempt rows: the acknowledge and the nested status push",
  );

  // ── THE HEADLINE ARITHMETIC ─────────────────────────────────────────────
  // Network (80s) + database must still fit under the internal budget, and
  // the internal budget must lose the race to the platform deliberately.
  const network = worstCaseAckNetworkMs({
    acknowledgeWorstCaseMs: 40_000,
    statusPushWorstCaseMs: 40_000,
  });
  check(network === 80_000, "one click's network worst case is 80s, not 40s");

  const db = worstCaseDbMs();
  check(db > 0, "the database worst case is a real number");
  check(
    network + db < LEAFLY_ACK_TOTAL_BUDGET_MS,
    "network + database fits inside the action's own budget",
  );
  check(
    LEAFLY_ACK_TOTAL_BUDGET_MS < PLATFORM_MAX_DURATION_MS,
    "the internal budget loses the race to the platform deliberately",
  );
  check(
    PLATFORM_MAX_DURATION_MS - LEAFLY_ACK_TOTAL_BUDGET_MS >= 30_000,
    "there is real headroom to render an answer before the platform kills us",
  );

  // ── worstCaseAckNetworkMs tolerates nonsense rather than propagating NaN ─
  check(
    worstCaseAckNetworkMs({
      acknowledgeWorstCaseMs: Number.NaN,
      statusPushWorstCaseMs: 40_000,
    }) === 40_000,
    "a NaN budget contributes zero rather than poisoning the sum",
  );
  check(
    worstCaseAckNetworkMs({
      acknowledgeWorstCaseMs: Number.POSITIVE_INFINITY,
      statusPushWorstCaseMs: 0,
    }) === 0,
    "an infinite budget contributes zero rather than returning Infinity",
  );

  // ── The timeout sentences ───────────────────────────────────────────────
  const sent = describeAckTimeout({ budgetMs: 240_000, requestWasSent: true });
  check(sent.includes("240 seconds"), "the sent-sentence names the budget in seconds");
  check(
    sent.includes("cannot tell"),
    "the sent-sentence admits we do not know the outcome",
  );
  check(
    sent.includes("DO NOT press Accept again"),
    "the sent-sentence forbids a second press on a one-way door",
  );
  check(sent.includes("Leafly"), "the sent-sentence names where to check");

  const notSent = describeAckTimeout({ budgetMs: 240_000, requestWasSent: false });
  check(
    notSent.includes("NOT acknowledged"),
    "the not-sent sentence states the order is not acknowledged",
  );
  check(
    notSent.includes("nothing has changed"),
    "the not-sent sentence says nothing changed",
  );
  check(
    notSent.includes("try again"),
    "the not-sent sentence invites the retry that is actually safe",
  );
  check(
    !notSent.includes("DO NOT press Accept again"),
    "the not-sent sentence does NOT forbid a retry — that would strand the order",
  );
  check(sent !== notSent, "the two timeout sentences are genuinely different");

  // ── The uncollected-order sentences ─────────────────────────────────────
  const live = describeUncollectedOrder({ leaflyOrderId: "abc-123", windowExpired: false });
  check(live.includes("abc-123"), "the uncollected sentence names the order");
  check(
    live.includes("never managed to download"),
    "the uncollected sentence blames our collection, not Leafly",
  );
  check(
    live.includes("Do NOT acknowledge"),
    "the uncollected sentence warns against acknowledging an order we do not have",
  );
  check(
    live.includes("ID images"),
    "the uncollected sentence names what acknowledging destroys",
  );

  const expired = describeUncollectedOrder({ leaflyOrderId: "abc-123", windowExpired: true });
  check(
    expired.includes("auto-cancelled"),
    "an expired window says the order is probably auto-cancelled",
  );
  check(
    !expired.includes("Press “Get the order details from Leafly”"),
    "an expired window does not offer a collection that cannot help",
  );
  check(live !== expired, "the two uncollected sentences are genuinely different");

  const anon = describeUncollectedOrder({ leaflyOrderId: "   ", windowExpired: false });
  check(
    anon.includes("this order"),
    "a blank order id degrades to a readable phrase, never an empty gap",
  );
  check(!anon.includes("  ,"), "a blank order id leaves no double punctuation");

  return assertions;
}
