/**
 * src/lib/leafly/inbound-budget-core.ts
 *
 * SLICE L-46: THE NINE-SECOND RULE (the RECEIVE side of the deadline story).
 *
 * == WHAT LEAFLY TOLD US ======================================================
 *
 * Ben (Leafly), item 4 of docs/leafly-ben-email-integration-round.md:
 *
 *   "Any non-2xx counts as a failure, AND SO DOES TAKING LONGER THAN 9 SECONDS
 *    TO RESPOND."
 *
 * order_submit, order_status and order_cancel are retried up to 3 times after
 * the first attempt (4 deliveries in total), with backoff of roughly 15-25s,
 * then 15-35s, then 30-60s. order_preview is NOT retried: it runs inline in
 * the shopper's cart. Unacknowledged orders auto-cancel at 15 minutes.
 *
 * SLICE 1 (deadline-core.ts) bounded every OUTBOUND call, and L-25
 * (db-deadline-core.ts) bounded every database query. Neither of those is a
 * RESPONSE deadline. Every query was bounded, but the handler awaited ALL of
 * them, one after another, before it answered. Using the repository's own
 * numbers, the order_submit path could await:
 *
 *   credentials 5s + event insert 8s + order upsert 8s
 *   + order fetch 2 x (15s + 8s mint) + its store 8s
 *   + bridge reads/claims 8s each + announcer + printer
 *   + auto-acknowledge 2 x (12s + 8s mint) + its reads/writes
 *   + staff e-mail 8s + processed stamp 8s
 *
 * That is minutes, not seconds (`legacyAwaitedWorstCaseMs` below computes it
 * from the real constants, and the vitest suite asserts it is > 9s). The work was
 * correct, but it was all inside the response.
 *
 * == THE DESIGN ===============================================================
 *
 * ONE RACE. After the signature is verified (which must stay awaited: it
 * decides 200 vs 401), ALL of the delivery's work runs as one promise:
 * record, duplicate check, upsert, collect, bell, paper, auto-acknowledge,
 * staff alert, cancel handling, processed stamp. The response waits for that
 * promise OR for the budget, whichever is first.
 *
 *   - Fast path (the normal case): the work finishes inside the budget, and
 *     the response and log line are exactly what they were before L-46.
 *   - Slow path: at the budget the route answers 200, and the SAME promise
 *     keeps running under Next's `after()` (Vercel `waitUntil`), bounded by
 *     the route's `maxDuration`. A second log line reports how it ended.
 *
 * Nothing is skipped, re-ordered or run twice. The only thing that changes is
 * WHEN the 200 is sent.
 *
 * WHY NOT "ALWAYS DEFER"? Because the fast path keeps the old, tested
 * behaviour (and the full notes in the one log line) for every delivery
 * that is fast, which is almost all of them. Deferral is used only when it is
 * needed.
 *
 * == WHY 6 SECONDS AND NOT 9 ==================================================
 *
 * Our clock starts when OUR code starts. Leafly's clock starts when THEY send.
 * Between the two: TLS, Vercel routing, and (the big one) a cold start.
 * Answering at 8.9s by our clock can be 10s by theirs. So the internal budget
 * is 6s, leaving 3s of headroom that we never spend. Same reasoning as
 * LEAFLY_ACK_TOTAL_BUDGET_MS (240s) under the platform's 300s: an internal
 * deadline must lose the race to the external one ON PURPOSE, by a margin.
 *
 * The signature check is not covered by the race (it has to finish before we
 * know 200 from 401), but it is itself bounded: ONE credentials read,
 * `LEAFLY_DB_TIMEOUT_MS.credentials_read` = 5s, which is less than the budget. So
 * the worst response time is max(verify, budget) + slack, and
 * `worstCaseResponseMs` proves that is below 9s.
 *
 * == PURE ======================================================================
 *
 * No imports. Timers, `after()` and the database live in the impure wrapper
 * (inbound-budget.ts) and in webhook-server.ts. Every number and every sentence
 * the owner or Leafly might read is decided here, where it is exhaustively
 * testable.
 */

// ============================================================================
// 1. Leafly's numbers (quoted, never invented)
// ============================================================================

/** Ben, item 4: "taking longer than 9 seconds to respond" is a failure. */
export const LEAFLY_INBOUND_RESPONSE_LIMIT_MS = 9_000;

/** Where the numbers in this file come from, so a reader can check them. */
export const LEAFLY_INBOUND_BUDGET_SOURCE =
  "Ben (Leafly), integration round item 4: order_submit, order_status and " +
  "order_cancel are retried up to 3 times after the initial attempt (4 " +
  "deliveries total), backoff roughly 15-25s, 15-35s, 30-60s; any non-2xx " +
  "counts as a failure, and so does taking longer than 9 seconds to respond; " +
  "order_preview is NOT retried.";

/** The six Leafly webhook events, verbatim (mirrors webhook-parse-core). */
export const LEAFLY_INBOUND_EVENTS = [
  "order_activate",
  "order_deactivate",
  "order_submit",
  "order_preview",
  "order_cancel",
  "order_status",
] as const;
export type LeaflyInboundEvent = (typeof LEAFLY_INBOUND_EVENTS)[number];

export function isLeaflyInboundEvent(value: unknown): value is LeaflyInboundEvent {
  return (
    typeof value === "string" &&
    (LEAFLY_INBOUND_EVENTS as readonly string[]).includes(value)
  );
}

/**
 * What Leafly does when a delivery fails, per event.
 *
 * `retried: null` means LEAFLY DID NOT SAY. Ben listed exactly three retried
 * events and exactly one non-retried event. Activate and deactivate were in
 * neither list, and this table does not guess on Leafly's behalf: it says
 * "not stated", and the 9-second budget is applied to them anyway, because
 * answering fast is correct whatever the retry policy turns out to be.
 */
export type LeaflyRetryPolicy = {
  retried: boolean | null;
  /** Total deliveries including the first, when stated. */
  deliveries: number | null;
  /** Backoff windows between deliveries, in seconds, when stated. */
  backoffSeconds: ReadonlyArray<readonly [number, number]>;
  /** One plain sentence for the owner. */
  note: string;
};

const RETRIED_THREE_TIMES: LeaflyRetryPolicy = {
  retried: true,
  deliveries: 4,
  backoffSeconds: [
    [15, 25],
    [15, 35],
    [30, 60],
  ],
  note:
    "Leafly retries this up to 3 more times (4 deliveries in about 2 minutes) " +
    "if we answer with an error or take longer than 9 seconds.",
};

export const LEAFLY_INBOUND_RETRY_POLICY: Readonly<Record<LeaflyInboundEvent, LeaflyRetryPolicy>> = {
  order_submit: RETRIED_THREE_TIMES,
  order_status: RETRIED_THREE_TIMES,
  order_cancel: RETRIED_THREE_TIMES,
  order_preview: {
    retried: false,
    deliveries: 1,
    backoffSeconds: [],
    note:
      "Never retried: it runs inside the shopper's cart, so a slow answer is " +
      "a slow cart the shopper sees immediately.",
  },
  order_activate: {
    retried: null,
    deliveries: null,
    backoffSeconds: [],
    note: "Leafly has not said whether this is retried. It is answered inside the same budget anyway.",
  },
  order_deactivate: {
    retried: null,
    deliveries: null,
    backoffSeconds: [],
    note: "Leafly has not said whether this is retried. It is answered inside the same budget anyway.",
  },
};

/**
 * How long Leafly's whole retry sequence spans, from the first delivery to
 * the last, when stated. Ben: "Full sequence approximately 2 minutes".
 * Returns null when Leafly has not said the event is retried.
 */
export function retrySequenceWindowMs(
  event: string,
): { minMs: number; maxMs: number } | null {
  if (!isLeaflyInboundEvent(event)) return null;
  const policy = LEAFLY_INBOUND_RETRY_POLICY[event];
  if (policy.retried !== true) return null;
  let minMs = 0;
  let maxMs = 0;
  for (const [lo, hi] of policy.backoffSeconds) {
    minMs += lo * 1000;
    maxMs += hi * 1000;
  }
  return { minMs, maxMs };
}

// ============================================================================
// 2. Our budget
// ============================================================================

/**
 * How long the route waits for the delivery's work before answering 200
 * anyway. Measured from the moment OUR route code starts.
 */
export const LEAFLY_INBOUND_BUDGET_MS = 6_000;

/**
 * The part of Leafly's 9 seconds we deliberately never spend: cold start,
 * TLS, routing, clock skew. Derived, never typed twice.
 */
export const LEAFLY_INBOUND_HEADROOM_MS =
  LEAFLY_INBOUND_RESPONSE_LIMIT_MS - LEAFLY_INBOUND_BUDGET_MS;

/** The smallest headroom this file will accept (see the self-test). */
export const LEAFLY_INBOUND_MIN_HEADROOM_MS = 2_000;

/**
 * Time allowed for a response to be written after the race ends (building
 * JSON, logging). Generous on purpose: it only enters the proof.
 */
export const LEAFLY_INBOUND_RESPONSE_SLACK_MS = 250;

/**
 * order_preview only: how long the delivery's BOOKKEEPING (event row, order
 * row) may hold up the cart. The rest of the budget goes to pricing, which is
 * the part the shopper actually waits for. Bookkeeping that runs over is not
 * lost; it continues after the response like any other deferred work.
 */
export const LEAFLY_PREVIEW_BOOKKEEPING_MS = 2_000;

/**
 * The route's `maxDuration`, in seconds. Deferred work lives only as long as
 * the function does ("Promises passed to waitUntil() will have the same
 * timeout as the function itself" - Vercel), so this is the ceiling for
 * everything that runs after the 200. 300 = PLATFORM_MAX_DURATION_MS / 1000
 * in db-deadline-core.ts.
 */
export const LEAFLY_WEBHOOK_MAX_DURATION_S = 300;

/**
 * Milliseconds left in a budget. Never negative. A non-finite input (clock
 * trouble, programming mistake) is treated as ZERO remaining. The safe
 * failure is to answer immediately, never to wait forever.
 */
export function remainingBudgetMs(input: {
  startedAtMs: number;
  nowMs: number;
  budgetMs: number;
}): number {
  const { startedAtMs, nowMs, budgetMs } = input;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(budgetMs)) {
    return 0;
  }
  if (budgetMs <= 0) return 0;
  const elapsed = Math.max(0, nowMs - startedAtMs);
  return Math.max(0, Math.floor(budgetMs - elapsed));
}

/**
 * The PROOF. The slowest this route can answer: the signature check runs
 * first and is not raced (it decides 200 vs 401), then the race waits for
 * whatever is left of the budget, measured from the same start. So the answer
 * time is max(verify, budget) + slack, NOT verify + budget.
 */
export function worstCaseResponseMs(input: {
  verifyWorstMs: number;
  budgetMs: number;
  slackMs: number;
}): number {
  const v = Number.isFinite(input.verifyWorstMs) ? Math.max(0, input.verifyWorstMs) : Infinity;
  const b = Number.isFinite(input.budgetMs) ? Math.max(0, input.budgetMs) : Infinity;
  const s = Number.isFinite(input.slackMs) ? Math.max(0, input.slackMs) : Infinity;
  return Math.max(v, b) + s;
}

/** True when the proof holds against Leafly's 9 seconds, with headroom. */
export function responseFitsLeaflyLimit(input: {
  verifyWorstMs: number;
  budgetMs: number;
  slackMs: number;
}): boolean {
  return (
    worstCaseResponseMs(input) + LEAFLY_INBOUND_MIN_HEADROOM_MS <=
    LEAFLY_INBOUND_RESPONSE_LIMIT_MS
  );
}

/**
 * What the handler awaited BEFORE L-46, as a plain sum of stage worst cases.
 * Kept so the reason for this slice stays computable rather than anecdotal:
 * the test feeds it the repository's real deadline constants and asserts the
 * answer is over 9 seconds.
 */
export function legacyAwaitedWorstCaseMs(stagesMs: ReadonlyArray<number>): number {
  let total = 0;
  for (const ms of stagesMs) {
    if (!Number.isFinite(ms)) return Infinity;
    total += Math.max(0, ms);
  }
  return total;
}

/*
 * DELIBERATELY ABSENT: a proof that the deferred work fits inside maxDuration.
 * Most of it is bounded (every query by db-deadline, every Leafly call by
 * deadline-core), but the announcer enqueue and the printer enqueue that the
 * bridge awaits carry no deadline of their own, so no honest worst case
 * exists. Writing one would be a guess. The platform's maxDuration (300s) is
 * the backstop, and the leafly-ack-sweep cron (every 2 minutes) acknowledges
 * any order the deferred work did not reach.
 */

// ============================================================================
// 3. What the log says
// ============================================================================

export const INBOUND_TIMING_VERDICTS = ["inside_budget", "used_headroom", "over_leafly_limit"] as const;
export type InboundTimingVerdict = (typeof INBOUND_TIMING_VERDICTS)[number];

/**
 * Classify how long an answer took, by OUR clock. `over_leafly_limit` should
 * be impossible after L-46; if it is ever logged, something outside the race
 * (the signature check, reading the body) was slow, and that is worth
 * reading.
 */
export function classifyInboundTiming(elapsedMs: number): InboundTimingVerdict {
  if (!Number.isFinite(elapsedMs) || elapsedMs > LEAFLY_INBOUND_RESPONSE_LIMIT_MS) {
    return "over_leafly_limit";
  }
  if (elapsedMs > LEAFLY_INBOUND_BUDGET_MS + LEAFLY_INBOUND_RESPONSE_SLACK_MS) {
    return "used_headroom";
  }
  return "inside_budget";
}

function secs(ms: number): string {
  if (!Number.isFinite(ms)) return "an unknown time";
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

/**
 * The note added to the response log line when the budget ran out before the
 * work did. Plain words; it must be readable by the owner in a Vercel log.
 */
export function describeAnsweredAtBudget(input: { elapsedMs: number; budgetMs: number }): string {
  const verdict = classifyInboundTiming(input.elapsedMs);
  const base =
    `answered 200 at ${secs(input.elapsedMs)} (budget ${secs(input.budgetMs)}, Leafly's limit ` +
    `${secs(LEAFLY_INBOUND_RESPONSE_LIMIT_MS)}); the order work is still running after the response`;
  if (verdict === "over_leafly_limit") {
    return `${base} - WARNING: over Leafly's limit, so Leafly counts this delivery as failed and will retry`;
  }
  return base;
}

/**
 * The second log line, written when deferred work finishes. `notes` are the
 * same notes the fast path would have put in its one line.
 */
export function describeDeferredFinish(input: {
  event: string;
  totalMs: number;
  duplicate: boolean;
  notes: ReadonlyArray<string>;
}): string {
  const head = `[leafly ${input.event}] finished after the response (${secs(input.totalMs)} in total)`;
  if (input.duplicate) {
    return `${head}: it was a duplicate delivery, so no work was repeated.`;
  }
  return `${head}${input.notes.length > 0 ? ` notes=[${input.notes.join("; ")}]` : ""}`;
}

/** The warning logged when a preview's pricing did not fit. */
export function describePreviewPricingTimeout(input: {
  remainingMs: number;
  lineCount: number;
}): string {
  return (
    `[leafly order_preview] pricing did not finish inside the budget ` +
    `(${secs(input.remainingMs)} was left) - echoing ${input.lineCount} cart line(s) back ` +
    `unchanged so the shopper's cart is not held up. Leafly does not retry previews.`
  );
}

// ============================================================================
// 4. Self-tests
// ============================================================================

export function __runLeaflyInboundBudgetTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  FAIL leafly-inbound-budget-core: ${msg}`);
    }
  };

  // -- Leafly's numbers --
  ok(LEAFLY_INBOUND_RESPONSE_LIMIT_MS === 9000, "Ben: 9 seconds");
  ok(LEAFLY_INBOUND_BUDGET_SOURCE.includes("9 seconds"), "source quotes the limit");
  ok(LEAFLY_INBOUND_BUDGET_SOURCE.includes("NOT retried"), "source quotes preview policy");
  ok(LEAFLY_INBOUND_EVENTS.length === 6, "six events");
  ok(new Set(LEAFLY_INBOUND_EVENTS).size === 6, "events are distinct");
  ok(isLeaflyInboundEvent("order_submit"), "submit is an event");
  ok(!isLeaflyInboundEvent("order_teleport"), "unknown is not an event");
  ok(!isLeaflyInboundEvent(42), "non-string is not an event");
  ok(!isLeaflyInboundEvent(" order_submit"), "not trimmed into validity");

  for (const e of ["order_submit", "order_status", "order_cancel"] as const) {
    const p = LEAFLY_INBOUND_RETRY_POLICY[e];
    ok(p.retried === true, `${e} is retried`);
    ok(p.deliveries === 4, `${e}: 4 deliveries`);
    ok(p.backoffSeconds.length === 3, `${e}: 3 retries`);
    ok((p.deliveries ?? 0) - 1 === p.backoffSeconds.length, `${e}: retries = deliveries - 1`);
  }
  const b = LEAFLY_INBOUND_RETRY_POLICY.order_submit.backoffSeconds;
  ok(b[0][0] === 15 && b[0][1] === 25, "first backoff 15-25s");
  ok(b[1][0] === 15 && b[1][1] === 35, "second backoff 15-35s");
  ok(b[2][0] === 30 && b[2][1] === 60, "third backoff 30-60s");
  ok(b.every(([lo, hi]) => lo < hi), "every window is lo < hi");
  ok(LEAFLY_INBOUND_RETRY_POLICY.order_preview.retried === false, "preview is not retried");
  ok(LEAFLY_INBOUND_RETRY_POLICY.order_preview.deliveries === 1, "preview: one delivery");
  ok(LEAFLY_INBOUND_RETRY_POLICY.order_activate.retried === null, "activate: not stated, not assumed");
  ok(LEAFLY_INBOUND_RETRY_POLICY.order_deactivate.retried === null, "deactivate: not stated, not assumed");
  ok(LEAFLY_INBOUND_RETRY_POLICY.order_activate.deliveries === null, "activate: no invented count");
  for (const e of LEAFLY_INBOUND_EVENTS) {
    ok(LEAFLY_INBOUND_RETRY_POLICY[e].note.trim().length > 20, `${e} has an owner note`);
  }

  const w = retrySequenceWindowMs("order_submit");
  ok(w !== null && w.minMs === 60_000, "retry sequence min 60s");
  ok(w !== null && w.maxMs === 120_000, "retry sequence max 120s (Ben: about 2 minutes)");
  ok(retrySequenceWindowMs("order_preview") === null, "preview has no retry window");
  ok(retrySequenceWindowMs("order_activate") === null, "unstated policy has no window");
  ok(retrySequenceWindowMs("nope") === null, "unknown event has no window");

  // -- budget --
  ok(LEAFLY_INBOUND_BUDGET_MS < LEAFLY_INBOUND_RESPONSE_LIMIT_MS, "budget under the limit");
  ok(LEAFLY_INBOUND_HEADROOM_MS === 3000, "3s headroom");
  ok(LEAFLY_INBOUND_HEADROOM_MS >= LEAFLY_INBOUND_MIN_HEADROOM_MS, "headroom at least the minimum");
  ok(LEAFLY_PREVIEW_BOOKKEEPING_MS < LEAFLY_INBOUND_BUDGET_MS, "preview bookkeeping leaves time to price");
  ok(LEAFLY_WEBHOOK_MAX_DURATION_S === 300, "maxDuration 300");

  ok(remainingBudgetMs({ startedAtMs: 1000, nowMs: 1000, budgetMs: 6000 }) === 6000, "full budget at start");
  ok(remainingBudgetMs({ startedAtMs: 1000, nowMs: 3500, budgetMs: 6000 }) === 3500, "partial budget");
  ok(remainingBudgetMs({ startedAtMs: 1000, nowMs: 7000, budgetMs: 6000 }) === 0, "exactly spent");
  ok(remainingBudgetMs({ startedAtMs: 1000, nowMs: 99_000, budgetMs: 6000 }) === 0, "never negative");
  ok(remainingBudgetMs({ startedAtMs: 5000, nowMs: 1000, budgetMs: 6000 }) === 6000, "clock going backwards does not grant extra");
  ok(remainingBudgetMs({ startedAtMs: NaN, nowMs: 1000, budgetMs: 6000 }) === 0, "NaN start answers now");
  ok(remainingBudgetMs({ startedAtMs: 0, nowMs: Infinity, budgetMs: 6000 }) === 0, "infinite now answers now");
  ok(remainingBudgetMs({ startedAtMs: 0, nowMs: 0, budgetMs: Infinity }) === 0, "infinite budget is refused");
  ok(remainingBudgetMs({ startedAtMs: 0, nowMs: 0, budgetMs: -5 }) === 0, "negative budget is zero");
  ok(remainingBudgetMs({ startedAtMs: 0, nowMs: 0.4, budgetMs: 10 }) === 9, "floored, never rounded up");

  // -- the proof --
  ok(worstCaseResponseMs({ verifyWorstMs: 5000, budgetMs: 6000, slackMs: 250 }) === 6250, "max, not sum");
  ok(worstCaseResponseMs({ verifyWorstMs: 8000, budgetMs: 6000, slackMs: 0 }) === 8000, "slow verify dominates");
  ok(worstCaseResponseMs({ verifyWorstMs: NaN, budgetMs: 6000, slackMs: 0 }) === Infinity, "unknown verify is not assumed fast");
  ok(worstCaseResponseMs({ verifyWorstMs: -3, budgetMs: 6000, slackMs: 0 }) === 6000, "negative verify clamps");
  ok(responseFitsLeaflyLimit({ verifyWorstMs: 5000, budgetMs: LEAFLY_INBOUND_BUDGET_MS, slackMs: LEAFLY_INBOUND_RESPONSE_SLACK_MS }), "the shipped numbers fit");
  ok(!responseFitsLeaflyLimit({ verifyWorstMs: 5000, budgetMs: 8000, slackMs: 250 }), "an 8s budget would not keep the headroom");
  ok(!responseFitsLeaflyLimit({ verifyWorstMs: 7500, budgetMs: 6000, slackMs: 0 }), "a 7.5s verify would not fit");
  ok(responseFitsLeaflyLimit({ verifyWorstMs: 7000, budgetMs: 6000, slackMs: 0 }), "boundary: exactly limit minus headroom fits");

  ok(legacyAwaitedWorstCaseMs([5000, 8000, 8000]) === 21_000, "sums stages");
  ok(legacyAwaitedWorstCaseMs([5000, 8000, 8000]) > LEAFLY_INBOUND_RESPONSE_LIMIT_MS, "even the first three stages alone break 9s");
  ok(legacyAwaitedWorstCaseMs([]) === 0, "no stages, zero");
  ok(legacyAwaitedWorstCaseMs([1, NaN]) === Infinity, "unknown stage is not zero");
  ok(legacyAwaitedWorstCaseMs([-5, 10]) === 10, "negative stage clamps");

  // -- timing classification --
  ok(classifyInboundTiming(0) === "inside_budget", "0ms inside");
  ok(classifyInboundTiming(6250) === "inside_budget", "budget + slack inside");
  ok(classifyInboundTiming(6251) === "used_headroom", "just past slack uses headroom");
  ok(classifyInboundTiming(9000) === "used_headroom", "exactly 9s is still not over");
  ok(classifyInboundTiming(9001) === "over_leafly_limit", "9.001s is over");
  ok(classifyInboundTiming(NaN) === "over_leafly_limit", "unknown is reported, not hidden");
  ok(INBOUND_TIMING_VERDICTS.length === 3, "three verdicts");

  // -- sentences --
  const at = describeAnsweredAtBudget({ elapsedMs: 6012, budgetMs: 6000 });
  ok(at.includes("answered 200 at 6.0s"), "says when it answered");
  ok(at.includes("still running"), "says the work continues");
  ok(at.includes("9.0s"), "names Leafly's limit");
  ok(!at.includes("WARNING"), "no warning inside the limit");
  const late = describeAnsweredAtBudget({ elapsedMs: 9500, budgetMs: 6000 });
  ok(late.includes("WARNING") && late.includes("retry"), "warns when over the limit");
  ok(!describeAnsweredAtBudget({ elapsedMs: NaN, budgetMs: 6000 }).includes("NaN"), "no NaN in the log");

  const fin = describeDeferredFinish({ event: "order_submit", totalMs: 21_300, duplicate: false, notes: ["a", "b"] });
  ok(fin.startsWith("[leafly order_submit] finished after the response (21.3s"), "deferred line head");
  ok(fin.includes("notes=[a; b]"), "deferred line carries the notes");
  ok(!describeDeferredFinish({ event: "order_submit", totalMs: 1, duplicate: false, notes: [] }).includes("notes="), "no empty notes");
  const dup = describeDeferredFinish({ event: "order_status", totalMs: 7000, duplicate: true, notes: ["x"] });
  ok(dup.includes("duplicate") && !dup.includes("notes="), "duplicate line says so, no notes");

  const pv = describePreviewPricingTimeout({ remainingMs: 1200, lineCount: 3 });
  ok(pv.includes("3 cart line(s)") && pv.includes("unchanged"), "preview timeout echoes");
  ok(pv.includes("1.2s"), "preview timeout says how much was left");
  ok(pv.includes("does not retry"), "preview timeout explains why echo");

  return { passed, failed };
}
