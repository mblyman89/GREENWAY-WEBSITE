/**
 * tests/compliance/leafly-l28-board-overflow.test.ts
 *
 * SLICE L-28 — THE 9TH ORDER THAT COULD NOT BE SEEN.
 *
 * ===========================================================================
 * WHAT THIS SUITE IS DEFENDING
 * ===========================================================================
 * The owner placed a real order and could not find it:
 *
 *   "there are currently 9 orders in total, 8 of which have expired, one is
 *    still pending. but I cannot see the 9th order, maybe the ui doesnt allow
 *    for more than 8?"
 *
 * He was right that 8 was the magic number, and wrong about the cause in the
 * way that matters: the 9th order was never FETCHED. Expired orders are never
 * acknowledged — that is why they expired — so they satisfied the pending
 * filter forever, sorted first (oldest deadline), and consumed every slot.
 *
 * The bug therefore failed in the worst possible direction: it hid precisely
 * the order that still needed a human, and the "awaiting acknowledgement"
 * badge confirmed the order existed while the list refused to show it.
 *
 * These tests exist so that cannot come back, in any of its forms.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BOARD_FILTERS,
  BOARD_SORTS,
  DEFAULT_BOARD_FILTER,
  DEFAULT_BOARD_SORT,
  boardEmptyMessage,
  boardFilterLabel,
  boardHiddenWarning,
  boardSortLabel,
  buildBoardView,
  isLiveBucket,
  parseBoardFilter,
  parseBoardSearch,
  parseBoardSort,
  runBoardViewSelfTests,
  type BoardViewRow,
} from "@/lib/leafly/board-view-core";
import { BRIDGE_TERMINAL_STATUSES } from "@/lib/leafly/bridge-core";
import type { LeaflyWorkflowBucket } from "@/lib/leafly/bridge-core";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const BOARD_SERVER = "src/lib/leafly/order-board-server.ts";
const PANEL = "src/components/admin/orders/LeaflyOrdersPanel.tsx";
const PAGE = "src/app/admin/orders/page.tsx";
const CORE = "src/lib/leafly/board-view-core.ts";

/**
 * Strip comments so a source assertion matches CODE, not prose.
 *
 * Learned in L-27, where a ban on a hazardous API matched the comment warning
 * against that very API. Documenting a hazard must never trip the check that
 * forbids it.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ============================================================================
// 1. THE REGRESSION ITSELF
// ============================================================================

describe("L-28: the owner's board — 8 expired, 1 live", () => {
  /** Rebuild his exact reported state. */
  function ownersBoard(): BoardViewRow[] {
    const rows: BoardViewRow[] = [];
    for (let i = 1; i <= 8; i++) {
      rows.push({
        bucket: "closed",
        leaflyOrderId: `LFY-100${i}`,
        localOrderId: null,
        // Expired orders have the OLDEST deadlines. This is what made them
        // sort to the top and crowd out the live one.
        acknowledgeBy: `2026-09-23T0${i}:00:00Z`,
        updatedAt: `2026-09-23T0${i}:00:00Z`,
      });
    }
    rows.push({
      bucket: "accept_now",
      leaflyOrderId: "LFY-1009",
      localOrderId: null,
      acknowledgeBy: "2026-09-23T09:00:00Z",
      updatedAt: "2026-09-23T09:00:00Z",
    });
    return rows;
  }

  it("shows the 9th order by default — the exact bug he reported", () => {
    const view = buildBoardView(ownersBoard());
    const ids = view.rows.map((r) => r.leaflyOrderId);
    expect(ids).toContain("LFY-1009");
  });

  it("shows ONLY the live order by default, hiding the 8 finished ones", () => {
    const view = buildBoardView(ownersBoard());
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].leaflyOrderId).toBe("LFY-1009");
  });

  it("does not DELETE the finished orders — they are one click away", () => {
    const view = buildBoardView(ownersBoard(), { filter: "closed" });
    expect(view.rows).toHaveLength(8);
  });

  it("nothing live is hidden in the default view, so no warning fires", () => {
    const view = buildBoardView(ownersBoard());
    expect(view.hiddenLiveCount).toBe(0);
    expect(boardHiddenWarning(view)).toBeNull();
  });
});

// ============================================================================
// 2. THE INVARIANT: NEVER SILENTLY HIDE A LIVE ORDER
// ============================================================================

describe("L-28: a filter may never silently hide work", () => {
  const live: BoardViewRow = {
    bucket: "accept_now",
    leaflyOrderId: "LFY-LIVE",
    localOrderId: null,
    acknowledgeBy: "2026-09-23T09:00:00Z",
    updatedAt: "2026-09-23T09:00:00Z",
  };
  const done: BoardViewRow = {
    bucket: "closed",
    leaflyOrderId: "LFY-DONE",
    localOrderId: null,
    acknowledgeBy: null,
    updatedAt: "2026-09-23T08:00:00Z",
  };

  it("counts a live order hidden by the filter", () => {
    const view = buildBoardView([live, done], { filter: "closed" });
    expect(view.hiddenLiveCount).toBe(1);
  });

  it("warns, in words, when the filter hides a live order", () => {
    const view = buildBoardView([live, done], { filter: "closed" });
    const warning = boardHiddenWarning(view);
    expect(warning).toBeTruthy();
    expect(warning).toMatch(/still needs attention|still need attention/);
  });

  it("counts a live order hidden by a SEARCH, not just by the filter", () => {
    // A search narrows the board just as effectively as a filter. An operator
    // hunting one order must still be told what he cannot see.
    const view = buildBoardView([live, done], { filter: "all", search: "done" });
    expect(view.hiddenLiveCount).toBe(1);
    expect(boardHiddenWarning(view)).toBeTruthy();
  });

  it("gets singular and plural right", () => {
    const one = buildBoardView([live, done], { filter: "closed" });
    expect(boardHiddenWarning(one)).toMatch(/^1 order /);
    const two = buildBoardView([live, { ...live, leaflyOrderId: "LFY-LIVE2" }, done], {
      filter: "closed",
    });
    expect(boardHiddenWarning(two)).toMatch(/^2 orders /);
  });

  it("every live bucket counts as live", () => {
    for (const b of ["accept_now", "needs_attention", "to_build", "awaiting_pickup"] as const) {
      expect(isLiveBucket(b)).toBe(true);
    }
    expect(isLiveBucket("closed")).toBe(false);
  });

  it("the panel RENDERS the warning — not merely computes it", () => {
    const src = read(PANEL);
    expect(src).toMatch(/boardHiddenWarning/);
    expect(src).toMatch(/\{hiddenWarning \?/);
  });
});

// ============================================================================
// 3. THE SERVER QUERY — WHERE THE ORDER WAS ACTUALLY LOST
// ============================================================================

describe("L-28: the board query excludes finished orders", () => {
  const src = read(BOARD_SERVER);
  const code = stripComments(src);

  /**
   * Slice the source down to ONE function body.
   *
   * Learned from this slice's own mutation sweep: an unscoped
   * `expect(code).toMatch(/canceled_at/)` stayed green when the filter was
   * deleted from the pending query, because an identical line survived in
   * the closed-orders query further down. A whole-file assertion proves a
   * string exists SOMEWHERE, which is not the claim being made. Each filter
   * is now pinned to the query that actually needs it.
   */
  function bodyBetween(startAnchor: string, endAnchor: string): string {
    const start = code.indexOf(startAnchor);
    expect(start, `anchor not found: ${startAnchor}`).toBeGreaterThan(-1);
    const end = code.indexOf(endAnchor, start + startAnchor.length);
    expect(end, `end anchor not found: ${endAnchor}`).toBeGreaterThan(-1);
    return code.slice(start, end);
  }

  /** The pending query only — up to where the acked query begins. */
  //
  // SLICE L-33 RE-ANCHORED THIS. The end anchor was `let pending = await
  // runPending`, which stopped existing when the four hand-written one-step
  // column retries were replaced by a single `readWithColumnFallback` walk
  // (a third column tier was needed so a database missing migration 0230 does
  // not ALSO lose 0228's pipeline warnings as collateral).
  //
  // The assertion above turned the vanished anchor into a loud failure rather
  // than silently slicing an empty string and passing vacuously, which is
  // exactly what it was written to do. The CLAIM is unchanged — "the pending
  // query, and only the pending query, carries these filters" — so only the
  // anchor moves.
  const pendingQuery = bodyBetween("const runPending", "const pending = await readWithColumnFallback");

  it("the pending query excludes cancelled orders", () => {
    expect(pendingQuery).toMatch(/\.is\("canceled_at", null\)/);
  });

  it("the pending query excludes terminal Leafly statuses", () => {
    expect(pendingQuery).toMatch(/leafly_status\.not\.in\./);
  });

  it("the pending query still filters on unacknowledged", () => {
    // Belt and braces: excluding terminal orders must not accidentally
    // replace the original filter, which would put every acknowledged order
    // back into the "needs accepting" pile.
    expect(pendingQuery).toMatch(/\.is\("acknowledged_at", null\)/);
  });

  it("the terminal vocabulary matches bridge-core — one list, not two", () => {
    // The whole point of asserting this: the query re-states the statuses in
    // PostgREST syntax, and a silent drift between the two would put expired
    // orders back on the board with nobody noticing.
    const match = src.match(/const TERMINAL_STATUSES = \[([^\]]+)\]/);
    expect(match).toBeTruthy();
    const listed = (match?.[1] ?? "")
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .sort();
    expect(listed).toEqual([...BRIDGE_TERMINAL_STATUSES].sort());
  });

  it("the COUNT uses the same filters as the list", () => {
    // The badge said "9 awaiting" over a list of 8 expired orders. The count
    // and the list must answer the same question or the badge trains people
    // to ignore it.
    //
    // Scoped to the count function's own body. Slicing from the function
    // name to the end of the file was not enough when this was written —
    // the mutation that deleted these very filters survived, because the
    // regex still matched text in a query above. Bounded on BOTH sides now.
    const countBody = bodyBetween(
      "export async function countLeaflyOrdersAwaitingAck",
      "return count ?? 0;",
    );
    expect(countBody).toMatch(/\.is\("acknowledged_at", null\)/);
    expect(countBody).toMatch(/\.is\("canceled_at", null\)/);
    expect(countBody).toMatch(/leafly_status\.not\.in\./);
  });

  it("the cap is high enough that a real backlog is not clipped", () => {
    const m = src.match(/export const LEAFLY_BOARD_LIMIT = (\d+);/);
    expect(m).toBeTruthy();
    const limit = Number(m?.[1]);
    // The reported failure happened at 9 orders. Anything in that region is
    // the same bug with a different number.
    expect(limit).toBeGreaterThanOrEqual(100);
  });

  it("finished orders are still FETCHED, so 'Finished' is not an empty tab", () => {
    // The third query. Without it, excluding terminal orders from the pending
    // query would make them match neither query and vanish entirely — the
    // owner asked to HIDE them, not lose them.
    expect(code).toMatch(/runClosed/);
    expect(code).toMatch(/closedRows/);
    expect(code).toMatch(/orders: \[\.\.\.pendingRows, \.\.\.ackedRows, \.\.\.closedRows\]/);
  });

  it("all three queries stay time-bounded (L-25 must not regress)", () => {
    const calls = code.match(/\.abortSignal\(dbDeadline\("order_read"\)\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// 4. SORTING
// ============================================================================

describe("L-28: sorting", () => {
  const rows: BoardViewRow[] = [
    {
      bucket: "to_build",
      leaflyOrderId: "mid",
      localOrderId: null,
      acknowledgeBy: "2026-09-23T10:00:00Z",
      updatedAt: "2026-09-23T10:00:00Z",
    },
    {
      bucket: "accept_now",
      leaflyOrderId: "soonest",
      localOrderId: null,
      acknowledgeBy: "2026-09-23T09:00:00Z",
      updatedAt: "2026-09-23T09:00:00Z",
    },
    {
      bucket: "awaiting_pickup",
      leaflyOrderId: "latest",
      localOrderId: null,
      acknowledgeBy: "2026-09-23T11:00:00Z",
      updatedAt: "2026-09-23T11:00:00Z",
    },
  ];

  it("urgency puts the soonest deadline first", () => {
    const v = buildBoardView(rows, { filter: "all", sort: "urgency" });
    expect(v.rows[0].leaflyOrderId).toBe("soonest");
  });

  it("newest puts the most recent change first", () => {
    const v = buildBoardView(rows, { filter: "all", sort: "newest" });
    expect(v.rows[0].leaflyOrderId).toBe("latest");
  });

  it("oldest reverses it", () => {
    const v = buildBoardView(rows, { filter: "all", sort: "oldest" });
    expect(v.rows[0].leaflyOrderId).toBe("soonest");
  });

  it("an order with NO deadline never outranks one with a deadline", () => {
    // Treating null as "very urgent" would float finished orders above a
    // live countdown — the same inversion this slice exists to fix.
    const withNull: BoardViewRow[] = [
      { ...rows[0], leaflyOrderId: "none", acknowledgeBy: null },
      { ...rows[1], leaflyOrderId: "has" },
    ];
    const v = buildBoardView(withNull, { filter: "all", sort: "urgency" });
    expect(v.rows[0].leaflyOrderId).toBe("has");
  });

  it("does not mutate the caller's array", () => {
    const input = [...rows];
    const before = input.map((r) => r.leaflyOrderId);
    buildBoardView(input, { filter: "all", sort: "newest" });
    expect(input.map((r) => r.leaflyOrderId)).toEqual(before);
  });
});

// ============================================================================
// 5. SEARCHING
// ============================================================================

describe("L-28: searching", () => {
  const rows: BoardViewRow[] = [
    {
      bucket: "accept_now",
      leaflyOrderId: "LFY-ABC123",
      localOrderId: "GW-500",
      acknowledgeBy: null,
      updatedAt: "2026-09-23T10:00:00Z",
    },
    {
      bucket: "closed",
      leaflyOrderId: "LFY-XYZ999",
      localOrderId: "GW-501",
      acknowledgeBy: null,
      updatedAt: "2026-09-23T09:00:00Z",
    },
  ];

  it("matches a fragment of the Leafly id", () => {
    const v = buildBoardView(rows, { filter: "all", search: "abc" });
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0].leaflyOrderId).toBe("LFY-ABC123");
  });

  it("matches the LOCAL id too — staff quote either one", () => {
    const v = buildBoardView(rows, { filter: "all", search: "gw-501" });
    expect(v.rows).toHaveLength(1);
    expect(v.rows[0].localOrderId).toBe("GW-501");
  });

  it("matches the tail of an id, which is what staff read aloud", () => {
    const v = buildBoardView(rows, { filter: "all", search: "999" });
    expect(v.rows).toHaveLength(1);
  });

  it("survives a null id without throwing", () => {
    const v = buildBoardView(
      [{ ...rows[0], leaflyOrderId: null, localOrderId: null }],
      { filter: "all", search: "anything" },
    );
    expect(v.rows).toHaveLength(0);
  });
});

// ============================================================================
// 6. PARSING — A BAD URL MUST NOT PRODUCE AN EMPTY BOARD
// ============================================================================

describe("L-28: URL parsing is total", () => {
  it("garbage becomes the default filter", () => {
    expect(parseBoardFilter("../../etc/passwd")).toBe(DEFAULT_BOARD_FILTER);
    expect(parseBoardFilter("")).toBe(DEFAULT_BOARD_FILTER);
    expect(parseBoardFilter(undefined)).toBe(DEFAULT_BOARD_FILTER);
    expect(parseBoardFilter(null)).toBe(DEFAULT_BOARD_FILTER);
  });

  it("garbage becomes the default sort", () => {
    expect(parseBoardSort("DROP TABLE")).toBe(DEFAULT_BOARD_SORT);
    expect(parseBoardSort(undefined)).toBe(DEFAULT_BOARD_SORT);
  });

  it("the default filter is 'open' — the owner's actual request", () => {
    expect(DEFAULT_BOARD_FILTER).toBe("open");
  });

  it("the default sort is urgency, because the deadline is the only real clock", () => {
    expect(DEFAULT_BOARD_SORT).toBe("urgency");
  });

  it("a repeated query param takes the first value", () => {
    expect(parseBoardFilter(["closed", "all"])).toBe("closed");
  });

  it("a whitespace-only search is 'no search', not 'match nothing'", () => {
    expect(parseBoardSearch("   ")).toBeNull();
    expect(parseBoardSearch("")).toBeNull();
  });

  it("every filter and sort has a human label", () => {
    for (const f of BOARD_FILTERS) expect(boardFilterLabel(f).length).toBeGreaterThan(0);
    for (const s of BOARD_SORTS) expect(boardSortLabel(s).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 7. NO BUCKET MAY BECOME UNREACHABLE
// ============================================================================

describe("L-28: every kind of order is reachable", () => {
  const ALL_BUCKETS: LeaflyWorkflowBucket[] = [
    "accept_now",
    "needs_attention",
    "to_build",
    "awaiting_pickup",
    "closed",
  ];

  it("the 'all' filter shows every bucket", () => {
    // The guarantee that stops a future bucket from being invisible because
    // nobody remembered to add it to a filter list.
    for (const bucket of ALL_BUCKETS) {
      const v = buildBoardView(
        [{ bucket, leaflyOrderId: "x", localOrderId: null, acknowledgeBy: null, updatedAt: "2026-09-23T10:00:00Z" }],
        { filter: "all" },
      );
      expect(v.rows).toHaveLength(1);
    }
  });

  it("the default 'open' filter shows every LIVE bucket", () => {
    for (const bucket of ALL_BUCKETS.filter((b) => b !== "closed")) {
      const v = buildBoardView(
        [{ bucket, leaflyOrderId: "x", localOrderId: null, acknowledgeBy: null, updatedAt: "2026-09-23T10:00:00Z" }],
        { filter: "open" },
      );
      expect(v.rows).toHaveLength(1);
    }
  });
});

// ============================================================================
// 8. THE EMPTY STATES SAY WHICH EMPTINESS THIS IS
// ============================================================================

describe("L-28: empty states are specific", () => {
  it("nothing has ever arrived", () => {
    const msg = boardEmptyMessage(buildBoardView([]));
    expect(msg).toMatch(/No Leafly orders yet/);
  });

  it("nothing matches the search", () => {
    const rows: BoardViewRow[] = [
      { bucket: "closed", leaflyOrderId: "LFY-1", localOrderId: null, acknowledgeBy: null, updatedAt: "2026-09-23T10:00:00Z" },
    ];
    const msg = boardEmptyMessage(buildBoardView(rows, { filter: "all", search: "nope" }));
    expect(msg).toMatch(/No orders match/);
  });

  it("everything is done", () => {
    const rows: BoardViewRow[] = [
      { bucket: "closed", leaflyOrderId: "LFY-1", localOrderId: null, acknowledgeBy: null, updatedAt: "2026-09-23T10:00:00Z" },
    ];
    const msg = boardEmptyMessage(buildBoardView(rows, { filter: "open" }));
    expect(msg).toMatch(/Nothing needs you right now/);
  });

  it("there is no message when there are rows", () => {
    const rows: BoardViewRow[] = [
      { bucket: "accept_now", leaflyOrderId: "LFY-1", localOrderId: null, acknowledgeBy: null, updatedAt: "2026-09-23T10:00:00Z" },
    ];
    expect(boardEmptyMessage(buildBoardView(rows))).toBeNull();
  });
});

// ============================================================================
// 9. THE UI IS ACTUALLY WIRED UP
// ============================================================================

describe("L-28: the controls exist and are connected", () => {
  it("the panel renders a filter, a sort and a search control", () => {
    const src = read(PANEL);
    expect(src).toMatch(/name="lfilter"/);
    expect(src).toMatch(/name="lsort"/);
    expect(src).toMatch(/name="lq"/);
  });

  it("the panel renders the FILTERED rows, not the raw board", () => {
    // The mutation that matters: rendering `board.orders` again would restore
    // the old behaviour while leaving every control on screen.
    const src = stripComments(read(PANEL));
    expect(src).toMatch(/groupLeaflyWorkflow\(view\.rows\)/);
    expect(src).not.toMatch(/groupLeaflyWorkflow\(board\.orders/);
  });

  it("the page validates the params before passing them down", () => {
    const src = stripComments(read(PAGE));
    expect(src).toMatch(/filter=\{parseBoardFilter\(sp\.lfilter\)\}/);
    expect(src).toMatch(/sort=\{parseBoardSort\(sp\.lsort\)\}/);
    expect(src).toMatch(/search=\{parseBoardSearch\(sp\.lq\)\}/);
  });

  it("the view controls are a plain GET form, so they survive the redirect", () => {
    const src = read(PANEL);
    expect(src).toMatch(/method="get"/);
  });

  it("there is a reset link out of any filtered state", () => {
    expect(read(PANEL)).toMatch(/Reset/);
  });

  it("the Leafly params are prefixed so they cannot collide with the order list", () => {
    // `q` and `sort` already belong to the Greenway order list on the same
    // page. Reusing them would make one dropdown drive two lists.
    const src = read(CORE);
    expect(src).toBeTruthy();
    const page = read(PAGE);
    expect(page).toMatch(/lfilter\?: string;/);
    expect(page).toMatch(/lsort\?: string;/);
    expect(page).toMatch(/lq\?: string;/);
  });
});

// ============================================================================
// 10. THE CORE'S OWN SELF-TESTS
// ============================================================================

describe("L-28: board-view-core self-tests", () => {
  it("pass", () => {
    expect(() => runBoardViewSelfTests()).not.toThrow();
  });
});
