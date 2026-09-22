import "server-only";

/**
 * src/lib/leafly/deadline-fetch.ts
 *
 * SLICE L-17 — the one place a Leafly request is allowed to give up.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * Before this slice, `src/lib/leafly/` contained six outbound `fetch()` calls
 * and not one of them had a timeout. Measured, not assumed:
 *
 *   grep -rn "AbortController\|AbortSignal.timeout" src/lib/leafly/
 *   → no matches
 *
 * Meanwhile seventeen other client files in this repository already do it,
 * and `src/lib/atm/pai-client.ts:94` names the reason out loud: "fetch() with
 * a hard timeout via AbortController (no hanging syncs)."
 *
 * The owner felt the consequence directly:
 *
 *   > "for the leafly orders specifically, i can click the acknowledge
 *   >  button, confirm the action, then it sits waiting forever stuck."
 *
 * ===========================================================================
 * WHY A SHARED HELPER RATHER THAN SIX LOCAL COPIES
 * ===========================================================================
 * House rule 11 — do not re-implement a judgement that has a home. Six local
 * `AbortController` blocks would be six opportunities to forget the
 * `clearTimeout`, six chances to pick a different budget by accident, and six
 * places to fix when the next bug arrives. More importantly, each one would
 * have to decide independently what an abort MEANS, and that decision is a
 * rule about customer safety (see `deadline-core.ts`), not plumbing.
 *
 * So: the budgets and the meaning live in the pure core. The `setTimeout` and
 * the `signal` live here. The call sites just name their operation.
 *
 * ===========================================================================
 * THE ONE THING THIS FILE MUST NEVER DO
 * ===========================================================================
 * It must never convert a timeout into a success, and it must never claim to
 * know that a timed-out request failed to arrive. `didTimeout` is reported
 * honestly and separately from the error, so the caller can say "we stopped
 * waiting" instead of "it failed" — which, for an irreversible acknowledge,
 * is the difference between a safe screen and a destroyed set of ID images.
 */

import {
  classifyNetworkFault,
  describeDeadlineFailure,
  timeoutForOperation,
  type DeadlineVerdict,
  type LeaflyOperation,
} from "./deadline-core";

/** What a deadline-bounded call can produce. */
export type DeadlineFetchResult =
  | { ok: true; response: Response }
  | {
      ok: false;
      /** Never a Response — this branch means no HTTP answer at all. */
      response: null;
      /** True only when OUR timer fired. Distinct from any network failure. */
      didTimeout: boolean;
      /** The pure core's verdict: message + the two safety flags. */
      verdict: DeadlineVerdict;
      /** The raw error text, for the attempt log. Never shown raw to staff. */
      detail: string;
    };

/**
 * `fetch()` that cannot outlive its budget.
 *
 * ── WHY `AbortController` AND NOT `AbortSignal.timeout()` ─────────────────
 * `AbortSignal.timeout()` is terser and this repo uses it in
 * `regulatory-ingest.ts:69`. It is not used here for one reason: we need to
 * know WHETHER OUR TIMER FIRED, with certainty, and not infer it from an
 * error message. With an explicit controller we set a boolean at the moment
 * we abort, so `classifyNetworkFault` is told the truth rather than sniffing
 * for the word "abort" — which would also match a genuinely aborted
 * navigation and mislabel it a Leafly timeout.
 *
 * ── WHY THE TIMER IS ALWAYS CLEARED ───────────────────────────────────────
 * `finally`, unconditionally. A stray 60-second timer on a serverless
 * function is a handle that keeps the lambda warm for no reason and, worse,
 * can abort a controller that a later code path is still holding.
 *
 * ── WHY IT NEVER THROWS ───────────────────────────────────────────────────
 * Because the six call sites do NOT agree about what a failure should do,
 * and this helper must not impose an answer on them.
 *
 * The two ORDER paths (`order-ack-server.ts`, `order-fetch-server.ts`)
 * already wrap their `fetch` in a try/catch that converts a throw into a
 * structured result, because a thrown error on the order path is how an
 * order disappears silently. The three MENU paths and the token mint do the
 * opposite: they have no try/catch at all, so a rejection propagates to the
 * caller, which is where their error reporting lives.
 *
 * Returning a result instead of throwing is what lets both survive unchanged.
 * The order paths keep converting; the menu paths re-throw one line later
 * with the verdict's sentence attached. Had this helper thrown, the order
 * paths would have been fine and the menu paths would have been fine, but
 * the decision would have been made HERE for all of them — and the first
 * call site whose contract disagreed would have had to catch its own
 * helper's throw to put it back, which is how a silent swallow gets born.
 */
export async function leaflyFetchWithDeadline(
  operation: LeaflyOperation,
  url: string,
  init: RequestInit,
): Promise<DeadlineFetchResult> {
  const budgetMs = timeoutForOperation(operation);
  const controller = new AbortController();
  // Set BEFORE the abort call, read after the throw. This is the fact that
  // makes the classification honest instead of a guess.
  let weAborted = false;
  const timer = setTimeout(() => {
    weAborted = true;
    controller.abort();
  }, budgetMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { ok: true, response };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Network request failed.";
    const fault = classifyNetworkFault({ aborted: weAborted, message: detail });
    const verdict = describeDeadlineFailure({ operation, fault });
    return {
      ok: false,
      response: null,
      didTimeout: weAborted,
      verdict,
      // The budget is appended so the attempt log records what we allowed,
      // not just what happened. Two identical "timeout" rows taken either
      // side of a budget change are otherwise indistinguishable.
      detail: weAborted ? `timed out after ${budgetMs}ms: ${detail}` : detail,
    };
  } finally {
    clearTimeout(timer);
  }
}
