/**
 * src/lib/plaid/sync-core.ts — PURE cursor state machine for /transactions/sync
 * (Slice P3). No network, no DB, no React — just the decision logic, so the
 * tricky pagination + mutation-restart rules are unit-tested in isolation.
 *
 * Plaid's /transactions/sync contract (verified against the SDK + docs):
 *   • First call: no cursor (undefined). Each response returns `next_cursor`
 *     and `has_more`.
 *   • While `has_more` is true, keep calling with the latest `next_cursor`.
 *   • Persist the FINAL cursor (the one returned when `has_more` is false); it's
 *     valid ≥1 year and is where the NEXT sync resumes.
 *   • If a call fails mid-pagination with
 *     `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, the WHOLE loop must
 *     restart from the cursor we began THIS run with (the pre-pagination
 *     cursor) — not just retry the one failed page.
 *
 * This module models that as a tiny reducer:
 *   initSyncState(savedCursor) → SyncState
 *   reduceSyncPage(state, { next_cursor, has_more }) → SyncState   (a page succeeded)
 *   onMutationDuringPagination(state) → SyncState                  (restart this run)
 *
 * The server layer (sync-server.ts) owns the actual network calls and the
 * database writes; it asks this module "what's my next request cursor?" and
 * "am I done?" and applies each page's delta idempotently via plaid-core +
 * store. Applying per page (rather than accumulating everything in memory) is
 * both safer for large histories and idempotent on restart, because each
 * transaction upsert is keyed on transaction_id.
 */

/** The cursor to send on the NEXT request. `null` means "no cursor" (first sync). */
export type SyncState = {
  /** Cursor for the next /transactions/sync request (null on the very first call). */
  cursor: string | null;
  /**
   * The cursor this run STARTED from. On a mutation-during-pagination error we
   * restart the loop from here (Plaid's required recovery). Stays fixed for the
   * whole run until we finish (has_more=false), at which point it no longer
   * matters.
   */
  runStartCursor: string | null;
  /** How many successful pages we've processed this run (diagnostics/guard). */
  pages: number;
  /** How many times we've restarted due to a mutation error (guard against loops). */
  restarts: number;
  /** True once a page returned has_more=false — the loop is complete. */
  done: boolean;
};

/** Hard ceiling so a misbehaving institution can't spin forever. */
export const MAX_SYNC_PAGES = 200;
/** Cap on mutation-restarts before we give up and surface an error. */
export const MAX_SYNC_RESTARTS = 5;

/**
 * Begin a sync run. `savedCursor` is the cursor persisted from the last
 * successful sync (null/"" for a brand-new item → full history backfill).
 */
export function initSyncState(savedCursor: string | null | undefined): SyncState {
  const start = savedCursor && savedCursor.trim() !== "" ? savedCursor : null;
  return {
    cursor: start,
    runStartCursor: start,
    pages: 0,
    restarts: 0,
    done: false,
  };
}

/**
 * Fold in one SUCCESSFUL page. Advances the cursor to `next_cursor`; when
 * `has_more` is false the run is complete and `cursor` holds the cursor to
 * persist for next time.
 */
export function reduceSyncPage(
  state: SyncState,
  page: { next_cursor: string; has_more: boolean },
): SyncState {
  return {
    ...state,
    cursor: page.next_cursor,
    pages: state.pages + 1,
    done: !page.has_more,
  };
}

/**
 * Handle a TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION error: restart the loop
 * from the cursor we began this run with. Increments the restart counter so the
 * server can bail after MAX_SYNC_RESTARTS.
 */
export function onMutationDuringPagination(state: SyncState): SyncState {
  return {
    ...state,
    cursor: state.runStartCursor,
    pages: 0, // pages restart from zero for this run
    restarts: state.restarts + 1,
    done: false,
  };
}

/** True while we should keep requesting pages. */
export function shouldContinue(state: SyncState): boolean {
  return !state.done && state.pages < MAX_SYNC_PAGES;
}

/** True when we've exceeded the restart budget (server should stop + record). */
export function exceededRestartBudget(state: SyncState): boolean {
  return state.restarts > MAX_SYNC_RESTARTS;
}

/** Is this Plaid error_code the mutation-during-pagination signal? */
export function isMutationDuringPagination(errorCode: string | null | undefined): boolean {
  return (errorCode ?? "").trim().toUpperCase() === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
}

// ---------------------------------------------------------------------------
// Running counts + plain-English summary
// ---------------------------------------------------------------------------

export type SyncCounts = {
  added: number;
  modified: number;
  removed: number;
  skipped: number;
  pages: number;
  restarts: number;
};

export function emptyCounts(): SyncCounts {
  return { added: 0, modified: 0, removed: 0, skipped: 0, pages: 0, restarts: 0 };
}

/** Add a page's contribution to the running counts (pure accumulator). */
export function addPageCounts(
  counts: SyncCounts,
  page: { added: number; modified: number; removed: number; skipped: number },
): SyncCounts {
  return {
    added: counts.added + page.added,
    modified: counts.modified + page.modified,
    removed: counts.removed + page.removed,
    skipped: counts.skipped + page.skipped,
    pages: counts.pages + 1,
    restarts: counts.restarts,
  };
}

/** A plain-English one-liner for the UI toast + audit entry. */
export function summarizeSync(counts: SyncCounts): string {
  const total = counts.added + counts.modified;
  if (total === 0 && counts.removed === 0) {
    return "Already up to date — no new transactions.";
  }
  const parts: string[] = [];
  if (counts.added > 0) parts.push(`${counts.added} new`);
  if (counts.modified > 0) parts.push(`${counts.modified} updated`);
  if (counts.removed > 0) parts.push(`${counts.removed} removed`);
  let line = `Synced ${parts.join(", ")}.`;
  if (counts.skipped > 0) line += ` (${counts.skipped} skipped — unreadable amount.)`;
  return line;
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts + vitest wrapper)
// ---------------------------------------------------------------------------

export function __runPlaidSyncCoreTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // initSyncState -----------------------------------------------------------
  const fresh = initSyncState(null);
  ok(fresh.cursor === null && fresh.runStartCursor === null, "fresh item → null cursor");
  ok(fresh.pages === 0 && fresh.restarts === 0 && !fresh.done, "fresh state zeroed");
  ok(initSyncState("").cursor === null, "empty string cursor → null");
  ok(initSyncState("   ").cursor === null, "whitespace cursor → null");
  const resumed = initSyncState("cur_abc");
  ok(resumed.cursor === "cur_abc" && resumed.runStartCursor === "cur_abc", "resume from saved cursor");

  // First sync: single page (has_more=false immediately) --------------------
  let s = initSyncState(null);
  ok(shouldContinue(s), "should continue on fresh state");
  s = reduceSyncPage(s, { next_cursor: "cur_1", has_more: false });
  ok(s.cursor === "cur_1", "cursor advanced to next_cursor");
  ok(s.done === true, "has_more=false → done");
  ok(!shouldContinue(s), "stop when done");
  ok(s.pages === 1, "one page counted");

  // has_more loop: multi-page -----------------------------------------------
  let m = initSyncState(null);
  m = reduceSyncPage(m, { next_cursor: "cur_a", has_more: true });
  ok(!m.done && shouldContinue(m) && m.cursor === "cur_a", "page1: keep going, cursor=cur_a");
  m = reduceSyncPage(m, { next_cursor: "cur_b", has_more: true });
  ok(!m.done && m.cursor === "cur_b" && m.pages === 2, "page2: cursor=cur_b, pages=2");
  m = reduceSyncPage(m, { next_cursor: "cur_final", has_more: false });
  ok(m.done && m.cursor === "cur_final" && m.pages === 3, "page3: done, final cursor persisted");
  ok(!shouldContinue(m), "no continue after final page");

  // Mutation-during-pagination restart --------------------------------------
  ok(isMutationDuringPagination("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"), "detects mutation code");
  ok(isMutationDuringPagination("transactions_sync_mutation_during_pagination"), "case-insensitive");
  ok(!isMutationDuringPagination("ITEM_LOGIN_REQUIRED"), "other code is not mutation");
  ok(!isMutationDuringPagination(null), "null is not mutation");

  let r = initSyncState("cur_start");
  r = reduceSyncPage(r, { next_cursor: "cur_p1", has_more: true }); // got one page
  ok(r.cursor === "cur_p1" && r.pages === 1, "pre-restart advanced");
  r = onMutationDuringPagination(r); // mutation hit → restart
  ok(r.cursor === "cur_start", "restart from runStartCursor (not the failed page cursor)");
  ok(r.pages === 0, "pages reset on restart");
  ok(r.restarts === 1, "restart counted");
  ok(r.runStartCursor === "cur_start", "runStartCursor preserved across restart");
  ok(!r.done, "not done after restart");
  // second attempt succeeds in one page
  r = reduceSyncPage(r, { next_cursor: "cur_done", has_more: false });
  ok(r.done && r.cursor === "cur_done", "restart run completes");

  // restart budget guard
  let g = initSyncState(null);
  for (let i = 0; i < MAX_SYNC_RESTARTS + 1; i++) g = onMutationDuringPagination(g);
  ok(exceededRestartBudget(g), "exceeds restart budget after too many mutations");
  ok(!exceededRestartBudget(initSyncState(null)), "fresh state within budget");

  // page ceiling guard
  const many: SyncState = { ...initSyncState(null), pages: MAX_SYNC_PAGES };
  ok(!shouldContinue(many), "stop at page ceiling");

  // counts + summary --------------------------------------------------------
  let c = emptyCounts();
  ok(summarizeSync(c) === "Already up to date — no new transactions.", "empty → up to date");
  c = addPageCounts(c, { added: 3, modified: 1, removed: 0, skipped: 0 });
  c = addPageCounts(c, { added: 2, modified: 0, removed: 1, skipped: 1 });
  ok(c.added === 5 && c.modified === 1 && c.removed === 1 && c.skipped === 1, "counts accumulate");
  ok(c.pages === 2, "page count accumulates");
  const line = summarizeSync(c);
  ok(line.includes("5 new") && line.includes("1 updated") && line.includes("1 removed"), "summary lists all");
  ok(line.includes("1 skipped"), "summary mentions skipped");

  const onlyAdded = summarizeSync({ ...emptyCounts(), added: 4 });
  ok(onlyAdded === "Synced 4 new.", "added-only summary");
  const onlyRemoved = summarizeSync({ ...emptyCounts(), removed: 2 });
  ok(onlyRemoved.includes("2 removed"), "removed-only summary");

  if (failures.length > 0) {
    throw new Error("plaid-sync-core self-tests FAILED:\n" + failures.map((f) => "  - " + f).join("\n"));
  }
  console.log("plaid-sync-core: all self-tests passed");
}
