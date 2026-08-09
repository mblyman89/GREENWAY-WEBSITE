/**
 * tests/compliance/plaid-sync-core.test.ts  (SLICE P3)
 *
 * Vitest mirror for the PURE /transactions/sync cursor state machine. Pins the
 * tricky rules that are easy to get wrong and dangerous to guess:
 *   • first sync (null cursor) and single-page completion,
 *   • has_more pagination loop advancing the cursor and persisting the final one,
 *   • TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION → restart from the run's
 *     START cursor (NOT the failed page's cursor),
 *   • restart + page ceilings,
 *   • running counts + plain-English summary.
 *
 * sync-server.ts is server-only (import "server-only") and drives these with
 * real network + DB; the decision logic lives here and is exercised directly.
 */
import { describe, expect, it } from "vitest";
import {
  initSyncState,
  reduceSyncPage,
  onMutationDuringPagination,
  shouldContinue,
  exceededRestartBudget,
  isMutationDuringPagination,
  emptyCounts,
  addPageCounts,
  summarizeSync,
  MAX_SYNC_PAGES,
  MAX_SYNC_RESTARTS,
  __runPlaidSyncCoreTests,
} from "@/lib/plaid/sync-core";

describe("plaid-sync-core self-tests (harness parity)", () => {
  it("passes the in-module self-test battery", () => {
    expect(() => __runPlaidSyncCoreTests()).not.toThrow();
  });
});

describe("cursor init + first sync", () => {
  it("starts with a null cursor for a fresh item", () => {
    const s = initSyncState(null);
    expect(s.cursor).toBeNull();
    expect(s.runStartCursor).toBeNull();
    expect(s.done).toBe(false);
    expect(shouldContinue(s)).toBe(true);
  });
  it("resumes from a saved cursor and treats blank as fresh", () => {
    expect(initSyncState("cur_x").cursor).toBe("cur_x");
    expect(initSyncState("").cursor).toBeNull();
    expect(initSyncState("   ").cursor).toBeNull();
  });
  it("completes in one page when has_more=false", () => {
    let s = initSyncState(null);
    s = reduceSyncPage(s, { next_cursor: "cur_1", has_more: false });
    expect(s.done).toBe(true);
    expect(s.cursor).toBe("cur_1");
    expect(shouldContinue(s)).toBe(false);
  });
});

describe("has_more pagination loop", () => {
  it("advances the cursor across pages and persists the final one", () => {
    let s = initSyncState(null);
    s = reduceSyncPage(s, { next_cursor: "a", has_more: true });
    s = reduceSyncPage(s, { next_cursor: "b", has_more: true });
    expect(s.cursor).toBe("b");
    expect(s.done).toBe(false);
    s = reduceSyncPage(s, { next_cursor: "final", has_more: false });
    expect(s.cursor).toBe("final");
    expect(s.done).toBe(true);
    expect(s.pages).toBe(3);
  });
});

describe("mutation-during-pagination recovery", () => {
  it("detects the error code (case-insensitive)", () => {
    expect(isMutationDuringPagination("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION")).toBe(true);
    expect(isMutationDuringPagination("transactions_sync_mutation_during_pagination")).toBe(true);
    expect(isMutationDuringPagination("ITEM_LOGIN_REQUIRED")).toBe(false);
    expect(isMutationDuringPagination(null)).toBe(false);
  });
  it("restarts from the run's START cursor, not the failed page", () => {
    let s = initSyncState("start");
    s = reduceSyncPage(s, { next_cursor: "p1", has_more: true });
    expect(s.cursor).toBe("p1");
    s = onMutationDuringPagination(s);
    expect(s.cursor).toBe("start"); // <-- the crucial rule
    expect(s.runStartCursor).toBe("start");
    expect(s.pages).toBe(0);
    expect(s.restarts).toBe(1);
    // second attempt completes
    s = reduceSyncPage(s, { next_cursor: "done", has_more: false });
    expect(s.done).toBe(true);
    expect(s.cursor).toBe("done");
  });
  it("bails after too many restarts", () => {
    let s = initSyncState(null);
    for (let i = 0; i < MAX_SYNC_RESTARTS + 1; i++) s = onMutationDuringPagination(s);
    expect(exceededRestartBudget(s)).toBe(true);
  });
  it("stops at the page ceiling", () => {
    const s = { ...initSyncState(null), pages: MAX_SYNC_PAGES };
    expect(shouldContinue(s)).toBe(false);
  });
});

describe("counts + plain-English summary", () => {
  it("summarizes an up-to-date sync", () => {
    expect(summarizeSync(emptyCounts())).toBe("Already up to date — no new transactions.");
  });
  it("accumulates and lists added/updated/removed/skipped", () => {
    let c = emptyCounts();
    c = addPageCounts(c, { added: 3, modified: 1, removed: 0, skipped: 0 });
    c = addPageCounts(c, { added: 2, modified: 0, removed: 1, skipped: 1 });
    expect(c.added).toBe(5);
    expect(c.pages).toBe(2);
    const line = summarizeSync(c);
    expect(line).toContain("5 new");
    expect(line).toContain("1 updated");
    expect(line).toContain("1 removed");
    expect(line).toContain("1 skipped");
  });
});
