import "server-only";

/**
 * src/lib/leafly/action-deadline.ts
 *
 * SLICE L-25 — THE BACKSTOP. Whatever happens, the operator gets a sentence.
 *
 * ===========================================================================
 * WHY A SECOND LAYER OF DEADLINE
 * ===========================================================================
 * Every individual call on the acknowledge path is now bounded: the network
 * by `leaflyFetchWithDeadline` (L-17, L-23) and the database by `dbDeadline`
 * (this slice). So why add an outer one?
 *
 * Because "every call I thought of is bounded" is exactly the belief that has
 * now been wrong twice. L-17 bounded every fetch and the hang survived. L-23
 * bounded every body and the hang survived. Both times the reasoning was
 * sound and both times something outside the enumeration was holding the
 * request open.
 *
 * This layer does not require the enumeration to be complete. It races the
 * WHOLE action against one clock, so a wait nobody has thought of yet — a
 * future query added without a signal, a DNS stall inside a library, a lock
 * on a table — still ends in a sentence on the operator's screen instead of a
 * spinner that runs until the platform kills the function.
 *
 * ── THE NUMBER THIS IS RACING ────────────────────────────────────────────
 * The owner's report, three rounds running, is "about five minutes". Vercel's
 * maximum function duration is 300 seconds. That is not a coincidence, and it
 * is the strongest single piece of evidence in this investigation: the
 * function is being KILLED by the platform, not returning. A killed function
 * renders nothing, which is why the page then "refreshes and does nothing".
 *
 * `LEAFLY_ACK_TOTAL_BUDGET_MS` is 240s — deliberately 60 seconds short of the
 * platform's limit, so we lose the race on purpose and keep enough time to
 * write the audit row, build the redirect and render the target page.
 *
 * ===========================================================================
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ===========================================================================
 * It does not CANCEL the work. There is no safe way to cancel a
 * half-completed acknowledgement: the POST may already have reached Leafly,
 * and abandoning it would leave us with no record of an irreversible act.
 * Instead the losing work is left to finish into the void while the operator
 * is told the truth — that we do not know the outcome and must not press
 * again. `describeAckTimeout` carries that wording, and it is the only honest
 * sentence available.
 */

import {
  LEAFLY_ACK_TOTAL_BUDGET_MS,
  describeAckTimeout,
} from "./db-deadline-core";

export type ActionDeadlineResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true; value: null; message: string };

/**
 * Race a server action's work against the total budget.
 *
 * `requestWasSent` is a CALLBACK, not a boolean, and that is load-bearing.
 * Whether the POST has left the building changes at some unpredictable moment
 * DURING the work, so a boolean captured at call time would always read
 * `false` and would therefore always produce the wrong sentence — the one
 * that says "nothing was sent, try again" about an acknowledgement that may
 * already have destroyed the customer's ID images. Reading it lazily, at the
 * moment the deadline fires, is what makes the wording true.
 */
export async function withActionDeadline<T>(
  work: Promise<T>,
  options?: {
    budgetMs?: number;
    requestWasSent?: () => boolean;
  },
): Promise<ActionDeadlineResult<T>> {
  const budgetMs =
    typeof options?.budgetMs === "number" && Number.isFinite(options.budgetMs)
      ? options.budgetMs
      : LEAFLY_ACK_TOTAL_BUDGET_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const TIMED_OUT = Symbol("leafly-action-timed-out");

  const guard = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
  });

  try {
    const outcome = await Promise.race([work, guard]);
    if (outcome === TIMED_OUT) {
      // The work is NOT cancelled — see the file header. It is left to finish
      // into the void so that any attempt row it was going to write still
      // gets written, which is the only record we will have of an
      // irreversible act whose outcome we never learned.
      //
      // Attaching a catch here is not optional: an unhandled rejection on the
      // abandoned promise would crash the process on some Node
      // configurations, turning a timeout into an outage.
      void Promise.resolve(work).catch(() => undefined);
      return {
        timedOut: true,
        value: null,
        message: describeAckTimeout({
          budgetMs,
          requestWasSent: options?.requestWasSent?.() ?? false,
        }),
      };
    }
    return { timedOut: false, value: outcome as T };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
