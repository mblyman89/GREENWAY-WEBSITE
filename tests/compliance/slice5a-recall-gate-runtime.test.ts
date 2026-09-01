/**
 * tests/compliance/slice5a-recall-gate-runtime.test.ts  (SLICE 5A)
 *
 * RUNTIME proof for the statutory recall-hold read.
 *
 * The companion test file asserts on source text; this one actually RUNS
 * `recalledProductKeys()` against a fake PostgREST that enforces the real
 * `db.max_rows` = 1000 ceiling, so the behaviour is proven rather than assumed.
 *
 * THE BUG THIS LOCKS DOWN: the old read was
 *   `.select(...).eq("status","recalled").limit(5000)` + `if (error) throw`.
 * PostgREST silently caps the response at 1,000 rows and sets NO error, so with
 * more than 1,000 recalled lots the function returned a SHORT hold set and
 * reported success. `runCompletionGate` (completion-gate.ts:103) calls this with
 * `failClosed: true` precisely so it can refuse when recall status is unknown —
 * but truncation never looked like failure, so a recalled product past row 1,000
 * would have COMPLETED A SALE.
 *
 * The mock records and HONOURS `.eq()`, `.order()` and `.range()`; a stub that
 * ignored them could not tell a paged query from the broken one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Lot = { id: string; pos_product_key: string | null; status: string | null };

/** The real server ceiling we are defending against. */
const SERVER_MAX_ROWS = 1000;

let LOTS: Lot[] = [];
/** Make the ROW read fail (not the count) starting at this page index. */
let FAIL_PAGE: number | null = null;
/** Make the server-side COUNT unavailable. */
let COUNT_FAILS = false;
/** Records what the code actually asked for, so we can assert on the query. */
let SEEN: {
  ordered: boolean;
  orderedColumn: string | null;
  ranges: [number, number][];
  eqStatus: string | null;
  headCount: boolean;
} = { ordered: false, orderedColumn: null, ranges: [], eqStatus: null, headCount: false };

let pageCalls = 0;

vi.mock("@/lib/supabase/env", () => ({ isSupabaseServiceConfigured: true }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => {
    const state: {
      eqStatus: string | null;
      head: boolean;
      order: string | null;
      asc: boolean;
    } = { eqStatus: null, head: false, order: null, asc: true };

    const q = {
      from: () => q,
      select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) {
          state.head = true;
          SEEN.headCount = true;
        }
        return q;
      },
      eq: (col: string, val: string) => {
        if (col === "status") {
          state.eqStatus = val;
          SEEN.eqStatus = val;
        }
        return q;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        state.order = col;
        state.asc = opts?.ascending !== false;
        SEEN.ordered = true;
        SEEN.orderedColumn = col;
        return q;
      },
      // A head:true count query is awaited without .range() — model that by
      // making the builder thenable.
      then: (resolve: (v: unknown) => unknown) => {
        const matching = LOTS.filter((l) => (state.eqStatus ? l.status === state.eqStatus : true));
        if (state.head) {
          if (COUNT_FAILS) return resolve({ count: null, error: { message: "count failed" } });
          return resolve({ count: matching.length, error: null });
        }
        return resolve({ data: matching, error: null });
      },
      range: async (from: number, to: number) => {
        SEEN.ranges.push([from, to]);
        const idx = pageCalls;
        pageCalls++;
        if (FAIL_PAGE !== null && idx >= FAIL_PAGE) {
          return { data: null, error: { message: "simulated read failure" } };
        }
        let matching = LOTS.filter((l) => (state.eqStatus ? l.status === state.eqStatus : true));
        // Honour the ORDER BY — without it paging is not deterministic.
        if (state.order === "id") {
          matching = [...matching].sort((a, b) =>
            state.asc ? a.id.localeCompare(b.id) : b.id.localeCompare(a.id),
          );
        }
        const window = matching.slice(from, to + 1);
        // THE SERVER CAP: never return more than db.max_rows, no error.
        return { data: window.slice(0, SERVER_MAX_ROWS), error: null };
      },
    };
    return q;
  },
}));

const { recalledProductKeys } = await import("@/lib/pos/recall-hold-store");

function makeLots(recalled: number, active: number): Lot[] {
  const out: Lot[] = [];
  for (let i = 0; i < recalled; i++) {
    out.push({
      id: `lot-${String(i).padStart(6, "0")}`,
      pos_product_key: `recalled-key-${i}`,
      status: "recalled",
    });
  }
  for (let i = 0; i < active; i++) {
    out.push({
      id: `zactive-${String(i).padStart(6, "0")}`,
      pos_product_key: `active-key-${i}`,
      status: "active",
    });
  }
  return out;
}

beforeEach(() => {
  LOTS = [];
  FAIL_PAGE = null;
  COUNT_FAILS = false;
  pageCalls = 0;
  SEEN = { ordered: false, orderedColumn: null, ranges: [], eqStatus: null, headCount: false };
});

describe("SLICE 5A runtime — recalledProductKeys reads every recalled lot", () => {
  it("returns all 2,500 recalled keys despite the 1,000-row server cap", async () => {
    LOTS = makeLots(2500, 500);
    const held = await recalledProductKeys({ failClosed: true });
    expect(held.size).toBe(2500);
    // The exact key that the old .limit(5000) implementation would have LOST.
    expect(held.has("recalled-key-2400")).toBe(true);
  });

  it("asks the right question: recalled status only", async () => {
    LOTS = makeLots(10, 10);
    await recalledProductKeys();
    // quarantine/active lots must never hold a product (recall-hold-core.ts:18-26).
    expect(SEEN.eqStatus).toBe("recalled");
  });

  it("orders by a unique column and pages with .range()", async () => {
    LOTS = makeLots(2500, 0);
    await recalledProductKeys();
    expect(SEEN.ordered).toBe(true);
    expect(SEEN.orderedColumn).toBe("id");
    expect(SEEN.ranges.length).toBeGreaterThan(1);
    expect(SEEN.ranges[0]).toEqual([0, 999]);
    expect(SEEN.ranges[1]).toEqual([1000, 1999]);
  });

  it("takes a server-side COUNT witness", async () => {
    LOTS = makeLots(50, 0);
    await recalledProductKeys();
    expect(SEEN.headCount).toBe(true);
  });

  it("does not hold anything when no lot is recalled", async () => {
    LOTS = makeLots(0, 300);
    const held = await recalledProductKeys({ failClosed: true });
    expect(held.size).toBe(0);
  });
});

describe("SLICE 5A runtime — the fail-CLOSED promise is now real", () => {
  it("THROWS for the statutory gate when a page fails mid-read", async () => {
    LOTS = makeLots(2500, 0);
    FAIL_PAGE = 1; // first page fine, second fails
    await expect(recalledProductKeys({ failClosed: true })).rejects.toThrow();
  });

  it("throws on a first-page failure rather than reporting 'nothing recalled'", async () => {
    LOTS = makeLots(2500, 0);
    FAIL_PAGE = 0;
    await expect(recalledProductKeys({ failClosed: true })).rejects.toThrow();
  });

  it("names the read as INCOMPLETE so the refusal is explainable", async () => {
    LOTS = makeLots(2500, 0);
    FAIL_PAGE = 1;
    await expect(recalledProductKeys({ failClosed: true })).rejects.toThrow(/incomplete/i);
  });

  it("still works when only the COUNT witness is unavailable", async () => {
    // A missing witness must not fail the read — paging signals still govern.
    LOTS = makeLots(1500, 0);
    COUNT_FAILS = true;
    const held = await recalledProductKeys({ failClosed: true });
    expect(held.size).toBe(1500);
  });
});

describe("SLICE 5A runtime — the advisory caller still degrades softly", () => {
  it("returns an empty set instead of throwing when failClosed is not set", async () => {
    // An outage must never blank every register (recall-hold-store.ts:8-10).
    LOTS = makeLots(2500, 0);
    FAIL_PAGE = 1;
    const held = await recalledProductKeys();
    expect(held.size).toBe(0);
  });

  it("returns an empty set on a total failure, exactly as before", async () => {
    LOTS = makeLots(100, 0);
    FAIL_PAGE = 0;
    const held = await recalledProductKeys({ failClosed: false });
    expect(held.size).toBe(0);
  });
});
