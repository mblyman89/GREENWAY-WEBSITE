import "server-only";

/**
 * src/lib/leafly/inbound-budget.ts
 *
 * SLICE L-46: the impure half of the nine-second rule. Timers and Next's
 * `after()` live here; every number and every sentence lives in
 * inbound-budget-core.ts.
 *
 * Three tools:
 *
 *   raceLeaflyBudget(work, ms)  wait for `work` OR `ms`, whichever is first.
 *                               It never cancels `work`: work that loses the
 *                               race keeps running.
 *   keepLeaflyWorkAlive(p)      tell the platform to keep the function alive
 *                               until `p` settles, even though the response
 *                               has already been sent (Next `after()`, which
 *                               on Vercel is `waitUntil`, bounded by the
 *                               route's maxDuration).
 *   __drainLeaflyDeferredWork() tests only: wait for everything kept alive.
 *
 * WHY `after(() => p)` AND NOT `after(p)`. Both reach Vercel's `waitUntil`.
 * The function form is the one this repository already uses
 * (src/lib/pos/pickup-leafly-close.ts, scheduleAfterResponse) and the one the
 * Next docs lead with. `after()` throws when there is no request scope (a
 * unit test, a script). The work is already running either way, so the
 * fallback has nothing to start. It only records the promise so tests can
 * wait for it.
 */

import { after } from "next/server";
import { LEAFLY_INBOUND_BUDGET_MS } from "./inbound-budget-core";

export type BudgetRace<T> = { finished: true; value: T } | { finished: false };

/**
 * Wait for `work`, or for `ms` milliseconds, whichever comes first.
 *
 * A rejection that arrives INSIDE the budget is rethrown to the caller, as if
 * the race were not there. A rejection that arrives AFTER the budget is
 * swallowed here (it is marked handled), because the caller has already
 * moved on, and an unhandled rejection can crash a Node process.
 */
export async function raceLeaflyBudget<T>(work: Promise<T>, ms: number): Promise<BudgetRace<T>> {
  const wait = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BudgetRace<T>>((resolve) => {
    timer = setTimeout(() => resolve({ finished: false }), wait);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([
      work.then((value): BudgetRace<T> => ({ finished: true, value })),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const pending = new Set<Promise<unknown>>();

/**
 * Keep the serverless function alive until `task` settles. Never throws, and
 * never lets `task` reject unhandled.
 */
export function keepLeaflyWorkAlive(task: Promise<unknown>): void {
  const settled: Promise<unknown> = task.catch(() => undefined);
  pending.add(settled);
  void settled.finally(() => pending.delete(settled));
  try {
    after(() => settled);
  } catch {
    // No request scope (tests, scripts). The work is already running and is
    // tracked in `pending`; there is nothing else to do.
  }
}

/** Tests only: wait until every task handed to keepLeaflyWorkAlive settles. */
export async function __drainLeaflyDeferredWork(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}

/** Tests only: how many deferred tasks are still running. */
export function __pendingLeaflyDeferredWork(): number {
  return pending.size;
}

let budgetOverrideMs: number | null = null;

/**
 * Tests only. Shrinks the budget so a test can prove "slow work still gets a
 * fast 200" in milliseconds instead of seconds. Refused outside the test
 * runner, so a stray call can never change production timing.
 */
export function __setLeaflyInboundBudgetForTests(ms: number | null): void {
  if (process.env.NODE_ENV !== "test") return;
  budgetOverrideMs = ms === null || !Number.isFinite(ms) ? null : Math.max(0, ms);
}

/** The budget in force: LEAFLY_INBOUND_BUDGET_MS, except inside tests. */
export function leaflyInboundBudgetMs(): number {
  return budgetOverrideMs ?? LEAFLY_INBOUND_BUDGET_MS;
}
