/**
 * evm-sync-budget-core.ts — PURE per-request time-budget guard for EVM sync.
 *
 * WHY THIS EXISTS
 * ---------------
 * "Sync now" runs synchronously inside a Vercel Server Action. On the Hobby
 * plan a serverless function is HARD-CAPPED at 60 seconds (vercel.com/docs/
 * limits, "Vercel Functions" table: Hobby max 60s). A full EVM backfill can
 * require HUNDREDS of explorer API calls (balance derivation pages the entire
 * tokentx history; the history walk is 2 calls per block window from genesis
 * to tip), so a single request can never finish a large wallet on Hobby — it
 * gets killed mid-flight, which is exactly the timeout Michael sees.
 *
 * The cursor/resume infrastructure already persists progress after every
 * window (initEvmBackfill / nextStartBlock:lastConsumedBlock). So the fix is
 * NOT to make one request do everything; it is to make each request do a SAFE
 * amount of work, stop cleanly BEFORE the platform kills it, and tell the user
 * to click again to continue. This module holds the pure decision logic for
 * that budget, separated from the network/server layer so it is unit-testable.
 *
 * DESIGN RULES (never guessed — the 60s Hobby cap is verified from Vercel):
 *   - The budget is a WALL-CLOCK deadline in epoch milliseconds. The server
 *     computes one deadline at the start of the request and checks it before
 *     each expensive step. Checking a deadline is O(1) and never blocks.
 *   - We leave a SAFETY MARGIN below the platform cap so a slow final window
 *     still finishes its DB writes before the function is reaped. The default
 *   - No floats, no BigInt literals (ES2017 target). Times are plain numbers.
 *
 * VERIFIED FACTS:
 *   - Vercel Hobby serverless MAX duration = 60s. Pro = 300s. Enterprise = 900s.
 *   - We default the budget to 45s on Hobby — comfortably under the 60s cap
 *     with a 15s margin for the final window's map + DB upserts.
 */

/** A wall-clock deadline (epoch ms) after which the sync must stop. */
export type BudgetDeadline = {
  /** Epoch-ms timestamp the budget was created (start of the request). */
  startedAtMs: number;
  /** Epoch-ms timestamp after which work must stop (startedAtMs + budgetMs). */
  deadlineMs: number;
  /** The configured budget in ms (for reporting). */
  budgetMs: number;
};

/**
 * The DEFAULT per-request budget. 45s is comfortably under Vercel Hobby's
 * verified 60s serverless cap, leaving a ~15s margin for the final window's
 * mapping + database upserts to complete before the platform reaps the
 * function. Exposed so callers can read/override it.
 */
export const DEFAULT_EVM_SYNC_BUDGET_MS = 45000;

/**
 * Minimum budget we will ever honour (ms). Below this there is no point
 * starting a window, so the loop yields immediately. Guards against a caller
 * passing a tiny/zero budget by accident.
 */
export const MIN_EVM_SYNC_BUDGET_MS = 5000;

/**
 * Create a budget deadline. `budgetMs` defaults to DEFAULT_EVM_SYNC_BUDGET_MS.
 * A budget below MIN_EVM_SYNC_BUDGET_MS is clamped up to the minimum so a
 * caller can never accidentally request "do no work". `nowMs` is injected so
 * tests are deterministic (the server passes Date.now()).
 */
export function createBudgetDeadline(
  nowMs: number,
  budgetMs: number = DEFAULT_EVM_SYNC_BUDGET_MS,
): BudgetDeadline {
  const budget =
    budgetMs < MIN_EVM_SYNC_BUDGET_MS ? MIN_EVM_SYNC_BUDGET_MS : budgetMs;
  return {
    startedAtMs: nowMs,
    deadlineMs: nowMs + budget,
    budgetMs: budget,
  };
}

/**
 * True when the wall clock has passed the deadline — i.e. the sync MUST stop
 * now and persist whatever progress it has made. Never throws; a malformed
 * deadline simply returns false (fail-open so a bug can't wedge the sync).
 */
export function timeBudgetExceeded(
  nowMs: number,
  deadline: BudgetDeadline | null,
): boolean {
  if (!deadline) return false;
  if (
    typeof deadline.deadlineMs !== "number" ||
    !Number.isFinite(deadline.deadlineMs)
  ) {
    return false;
  }
  return nowMs >= deadline.deadlineMs;
}

/**
 * Milliseconds remaining until the deadline (clamped at 0). Useful for deciding
 * whether there is enough time to start one more expensive step.
 */
export function budgetRemainingMs(
  nowMs: number,
  deadline: BudgetDeadline | null,
): number {
  if (!deadline) return Number.POSITIVE_INFINITY;
  const remaining = deadline.deadlineMs - nowMs;
  return remaining < 0 ? 0 : remaining;
}

/**
 * Build a friendly "partial / continue" suffix for a sync that stopped because
 * the time budget ran out (as opposed to reaching the tip). Returns the suffix
 * to APPEND to the normal summary, or "" when the sync completed fully.
 *
 *   complete=false, stoppedForBudget=true  → " …fetched so far; click Sync now
 *     again to continue (large histories are pulled in chunks)."
 *   complete=true                          → ""
 */
export function partialContinueSuffix(
  complete: boolean,
  stoppedForBudget: boolean,
): string {
  if (complete) return "";
  if (!stoppedForBudget) return "";
  return " Fetched so far; click \u201cSync now\u201d again to continue (large histories are pulled in safe chunks).";
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run under tsx by run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`evm-sync-budget-core self-test failed: ${msg}`);
}

export function __runEvmSyncBudgetCoreTests(): void {
  // --- constants ---
  assert(
    DEFAULT_EVM_SYNC_BUDGET_MS === 45000,
    "default budget is 45s (under 60s Hobby cap)",
  );
  assert(MIN_EVM_SYNC_BUDGET_MS === 5000, "min budget is 5s");
  assert(
    DEFAULT_EVM_SYNC_BUDGET_MS < 60000,
    "default budget stays under verified 60s Hobby cap",
  );

  // --- createBudgetDeadline: arithmetic + clamp ---
  const d = createBudgetDeadline(1000000, 45000);
  assert(d.startedAtMs === 1000000, "startedAtMs recorded");
  assert(d.deadlineMs === 1045000, "deadline = start + budget");
  assert(d.budgetMs === 45000, "budgetMs recorded");
  // default budget when omitted
  const dDefault = createBudgetDeadline(0);
  assert(
    dDefault.deadlineMs === DEFAULT_EVM_SYNC_BUDGET_MS,
    "default budget applied when omitted",
  );
  // tiny budget clamped to minimum
  const dClamped = createBudgetDeadline(1000, 100);
  assert(
    dClamped.budgetMs === MIN_EVM_SYNC_BUDGET_MS,
    "tiny budget clamped to min",
  );
  assert(
    dClamped.deadlineMs === 1000 + MIN_EVM_SYNC_BUDGET_MS,
    "clamped deadline correct",
  );

  // --- timeBudgetExceeded: boundary ---
  assert(!timeBudgetExceeded(999999, d), "before deadline → not exceeded");
  assert(!timeBudgetExceeded(1044999, d), "just before deadline → not exceeded");
  assert(timeBudgetExceeded(1045000, d), "exactly at deadline → exceeded");
  assert(timeBudgetExceeded(2000000, d), "well past deadline → exceeded");
  // null deadline → never exceeded (fail-open)
  assert(!timeBudgetExceeded(9999999999, null), "null deadline → false");
  // malformed deadline → false (fail-open, no throw)
  assert(
    !timeBudgetExceeded(0, {
      startedAtMs: 0,
      deadlineMs: Number.NaN,
      budgetMs: 1000,
    }),
    "NaN deadline → false (fail-open)",
  );

  // --- budgetRemainingMs ---
  assert(
    budgetRemainingMs(1000000, d) === 45000,
    "remaining at start = full budget",
  );
  assert(
    budgetRemainingMs(1040000, d) === 5000,
    "remaining partway through",
  );
  assert(budgetRemainingMs(1045000, d) === 0, "remaining at deadline = 0");
  assert(budgetRemainingMs(9999999, d) === 0, "remaining past deadline clamped 0");
  assert(
    budgetRemainingMs(0, null) === Number.POSITIVE_INFINITY,
    "null deadline → infinite remaining",
  );

  // --- partialContinueSuffix ---
  assert(
    partialContinueSuffix(false, true) ===
      " Fetched so far; click \u201cSync now\u201d again to continue (large histories are pulled in safe chunks).",
    "partial+budget → continue suffix",
  );
  assert(partialContinueSuffix(true, false) === "", "complete → empty suffix");
  assert(partialContinueSuffix(true, true) === "", "complete overrides budget flag");
  assert(partialContinueSuffix(false, false) === "", "incomplete but not budget → empty");

  console.log("evm-sync-budget-core self-tests: all passed");
}
