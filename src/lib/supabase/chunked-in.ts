/**
 * src/lib/supabase/chunked-in.ts  (S-7, COMPLIANCE_ROADMAP)
 *
 * Complete-result fetching for PostgREST `.in()` queries. Fixes the silent
 * truncation family (GAP_AUDIT M-4) where call sites capped the id list with
 * `.slice(0, 1000|2000)` — on a busy month the tax/CCRS/Sage/report totals
 * silently dropped every order past the cap.
 *
 * Two truncation vectors are handled:
 *   1. URL length — PostgREST encodes `.in()` lists in the query string, so
 *      very large id lists can overflow. We chunk ids (default 200 per chunk,
 *      matching the proven pattern in pos/menu-version.ts).
 *   2. Server row cap — PostgREST/Supabase caps a single response at
 *      `db.max_rows` (default 1000). A 200-order chunk can easily contain
 *      more than 1000 order_lines. We paginate each chunk with `.range()` until a
 *      page comes back short.
 *
 * PURE module — no supabase / "server-only" imports — so it can be unit-tested
 * with `npx tsx scripts/compliance/run-pure-selftests.ts`.
 *
 * Usage at a call site:
 *
 *   const lines = await chunkedIn(orderIds, async (chunk, from, to) => {
 *     const { data } = await admin
 *       .from("order_lines")
 *       .select("order_id, quantity, price_minor_units")
 *       .in("order_id", chunk)
 *       .order("id", { ascending: true })   // stable pagination order — REQUIRED
 *       .range(from, to);
 *     return (data as Row[] | null) ?? [];
 *   });
 *
 * The fetcher MUST apply `.order(...)` on a unique column and `.range(from, to)`
 * or pagination is not deterministic.
 */

import {
  evaluateReadCompleteness,
  type ReadCompletenessVerdict,
} from "./read-completeness-core";

export const CHUNKED_IN_CHUNK_SIZE = 200;
export const CHUNKED_IN_PAGE_SIZE = 1000;

/**
 * SLICE D (performance) — how many chunks may be in flight at once.
 *
 * ONE, i.e. the original strictly-serial behaviour, and deliberately so. This
 * module is used by tax, CCRS, Sage and report paths whose correctness was the
 * whole point of S-7; none of them asked for concurrency and none of them get
 * it by accident. Read paths that want it opt in per call site.
 *
 * WHY CONCURRENCY MATTERS HERE AT ALL: a 4,500-item menu chunked at 200 is 23
 * round trips, and the original loop `await`s each one before starting the
 * next. The requests do not depend on each other — each covers a disjoint set
 * of ids — so the waiting was pure latency, serialised for no reason. At a
 * measured 8 ms round trip that is ~184 ms of dead time per call, and the menu
 * page makes several such calls per request.
 */
export const CHUNKED_IN_CONCURRENCY = 1;

/**
 * The concurrency the PUBLIC MENU READ paths use.
 *
 * WHY 6 AND NOT 23 (all of them at once): Supabase pools connections, and a
 * burst of 23 simultaneous queries from a single render competes with the
 * register and the back office for that pool. Six keeps the tail short — 23
 * chunks finish in 4 waves instead of 23 — while leaving most of the pool for
 * everything else. This is a display path; it must never starve a sale.
 */
export const MENU_READ_CONCURRENCY = 6;

export type ChunkedInFetchPage<Id, Row> = (
  chunk: Id[],
  fromIndex: number,
  toIndex: number,
) => Promise<Row[]>;

/**
 * Fetch ALL rows matching the given ids, chunking the id list and paginating
 * each chunk. Ids are de-duplicated (harmless for `.in()` semantics, shrinks
 * URLs). Returns the concatenation of every page of every chunk.
 */
export async function chunkedIn<Id, Row>(
  ids: readonly Id[],
  fetchPage: ChunkedInFetchPage<Id, Row>,
  opts: { chunkSize?: number; pageSize?: number; concurrency?: number } = {},
): Promise<Row[]> {
  const chunkSize = Math.max(1, opts.chunkSize ?? CHUNKED_IN_CHUNK_SIZE);
  const pageSize = Math.max(1, opts.pageSize ?? CHUNKED_IN_PAGE_SIZE);
  const concurrency = Math.max(1, opts.concurrency ?? CHUNKED_IN_CONCURRENCY);
  const unique = [...new Set(ids)];

  // Split first, so the work list is a plain array of independent units. Each
  // chunk queries a DISJOINT set of ids, which is what makes running several of
  // them at once safe: no chunk can observe another chunk's rows.
  const chunks: Id[][] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    chunks.push(unique.slice(i, i + chunkSize));
  }

  /** Drain one chunk completely (all its pages), in order. */
  const drainChunk = async (chunk: Id[]): Promise<Row[]> => {
    const rows: Row[] = [];
    let from = 0;
    for (;;) {
      const page = await fetchPage(chunk, from, from + pageSize - 1);
      if (page.length > 0) rows.push(...page);
      // A short page means the chunk is exhausted. (A full page might be the
      // server cap — keep going; the next page returning 0 rows ends the loop.)
      if (page.length < pageSize) break;
      from += pageSize;
    }
    return rows;
  };

  // SERIAL PATH (the default, and what every pre-existing caller gets).
  // Byte-for-byte the original loop. Kept as its own branch rather than as
  // "concurrency of 1" so the untouched callers cannot be affected by a bug in
  // the scheduler below.
  if (concurrency === 1) {
    const out: Row[] = [];
    for (const chunk of chunks) out.push(...(await drainChunk(chunk)));
    return out;
  }

  // CONCURRENT PATH (opt-in). A fixed pool of workers pulls the next unclaimed
  // chunk index, so at most `concurrency` requests are ever in flight no matter
  // how many chunks there are — an id list of 4,500 does not open 23 sockets.
  //
  // ORDERING IS PRESERVED. Each chunk writes into its OWN slot, and the slots
  // are flattened in index order at the end, so the returned array is identical
  // to the serial path regardless of which request finishes first. Callers that
  // rely on chunk order (and the `.order(...)` contract in this file's header)
  // keep the guarantee they already had.
  const slots: Row[][] = new Array(chunks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= chunks.length) return;
      slots[index] = await drainChunk(chunks[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()),
  );

  const out: Row[] = [];
  for (const slot of slots) out.push(...slot);
  return out;
}

/**
 * Fetch ALL rows of a single (non-`.in()`) query by paging `.range()` until a
 * short page. Fixes the same M-4 family for base queries (e.g. the orders
 * fetch feeding a report) which PostgREST silently caps at `db.max_rows`
 * (default 1000) even when no `.limit()` is set. The fetcher MUST apply a
 * stable `.order(...)` and the given `.range(from, to)`.
 */
export async function pagedAll<Row>(
  fetchPage: (fromIndex: number, toIndex: number) => Promise<Row[]>,
  opts: { pageSize?: number } = {},
): Promise<Row[]> {
  const pageSize = Math.max(1, opts.pageSize ?? CHUNKED_IN_PAGE_SIZE);
  const out: Row[] = [];
  let from = 0;
  for (;;) {
    const rows = await fetchPage(from, from + pageSize - 1);
    if (rows.length > 0) out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SLICE 5A — paging that can PROVE it was complete
// ---------------------------------------------------------------------------

/**
 * One page's outcome. Unlike `pagedAll`'s fetcher (which returns `Row[]`, so a
 * failed page is indistinguishable from end-of-data), this fetcher reports
 * whether the read itself succeeded.
 */
export type CheckedPage<Row> = {
  rows: Row[];
  /** False when the query errored. The loop STOPS and the verdict says so. */
  ok: boolean;
};

export type PagedAllCheckedResult<Row> = {
  rows: Row[];
  verdict: ReadCompletenessVerdict;
};

/**
 * `pagedAll` with an honest failure signal.
 *
 * WHY: `pagedAll` breaks on `rows.length < pageSize` (chunked-in.ts:92). A page
 * that FAILED returns `[]`, which satisfies that condition — so a mid-read
 * outage silently produces a SHORT list that every caller treats as the whole
 * table. For an advisory list that is survivable; for the recall-hold gate
 * (completion-gate.ts:103) or the acquisition-cost floor
 * (discount-engine-core.ts:592, where an unknown cost DISABLES the below-cost
 * clamp) it is fail-open.
 *
 * This variant returns the rows AND a verdict. Callers decide what to do:
 * a statutory gate refuses on `!verdict.complete`; an advisory panel ships the
 * partial data and flags it. This function never makes that choice for them.
 *
 * `maxRows` is a memory ceiling, not a row cap — hitting it is REPORTED as
 * `limit_reached` rather than silently accepted (the exact mistake that
 * `.limit(5000)` makes today).
 *
 * The fetcher MUST apply a stable `.order(...)` on a UNIQUE column plus the
 * given `.range(from, to)`, or pagination is not deterministic.
 */
export async function pagedAllChecked<Row>(
  fetchPage: (fromIndex: number, toIndex: number) => Promise<CheckedPage<Row>>,
  opts: { pageSize?: number; maxRows?: number; expectedTotal?: number | null } = {},
): Promise<PagedAllCheckedResult<Row>> {
  const pageSize = Math.max(1, opts.pageSize ?? CHUNKED_IN_PAGE_SIZE);
  const maxRows = opts.maxRows != null && opts.maxRows > 0 ? opts.maxRows : Number.POSITIVE_INFINITY;
  const rows: Row[] = [];
  let pagesFetched = 0;
  let readFailed = false;
  let hitCeiling = false;
  let from = 0;

  for (;;) {
    const page = await fetchPage(from, from + pageSize - 1);
    pagesFetched++;
    const got = Array.isArray(page?.rows) ? page.rows : [];
    if (got.length > 0) rows.push(...got);

    // A failed page ends the loop AND is remembered — the whole point.
    if (!page?.ok) {
      readFailed = true;
      break;
    }
    // Short page = the only reliable end-of-data signal (see pagedAll above).
    if (got.length < pageSize) break;

    from += pageSize;
    if (rows.length >= maxRows) {
      // Full pages were still coming when we stopped ourselves.
      hitCeiling = true;
      break;
    }
  }

  return {
    rows,
    verdict: evaluateReadCompleteness({
      rowsRead: rows.length,
      pagesFetched,
      pageSize,
      readFailed,
      hitCeiling,
      expectedTotal: opts.expectedTotal ?? null,
    }),
  };
}

// ---------------------------------------------------------------------------
// Self-tests (S-7 regression: >2,000 synthetic orders, totals must be complete)
// ---------------------------------------------------------------------------

export async function __runChunkedInTests(): Promise<void> {
  let n = 0;
  function ok(cond: boolean, label: string) {
    n++;
    if (!cond) throw new Error(`chunkedIn self-test failed: ${label}`);
  }

  // Synthetic DB: 2,500 orders × 2 lines each = 5,000 rows. The fake server
  // enforces a 1,000-row page cap exactly like PostgREST db.max_rows.
  const ORDERS = 2500;
  const orderIds = Array.from({ length: ORDERS }, (_, i) => `ord-${i}`);
  const db = new Map<string, { order_id: string; amount: number }[]>();
  for (const id of orderIds) {
    db.set(id, [
      { order_id: id, amount: 100 },
      { order_id: id, amount: 23 },
    ]);
  }

  const chunkSizes: number[] = [];
  let pageCalls = 0;
  const SERVER_CAP = 1000;

  const rows = await chunkedIn(orderIds, async (chunk, from, to) => {
    chunkSizes.push(chunk.length);
    pageCalls++;
    // Simulate the server: gather all rows for the chunk in a stable order,
    // then slice [from, to] and additionally clamp to the server cap.
    const all: { order_id: string; amount: number }[] = [];
    for (const id of chunk) all.push(...(db.get(id) ?? []));
    const requested = all.slice(from, to + 1);
    return requested.slice(0, SERVER_CAP);
  });

  ok(rows.length === ORDERS * 2, `all rows returned (got ${rows.length}, want ${ORDERS * 2})`);
  const total = rows.reduce((a, r) => a + r.amount, 0);
  ok(total === ORDERS * 123, `total complete (got ${total}, want ${ORDERS * 123})`);
  ok(Math.max(...chunkSizes) <= CHUNKED_IN_CHUNK_SIZE, "chunks respect chunk size");
  ok(pageCalls >= Math.ceil(ORDERS / CHUNKED_IN_CHUNK_SIZE), "every chunk fetched");

  // De-duplication: repeated ids must not double rows.
  const dup = await chunkedIn(["a", "a", "b"], async (chunk) =>
    chunk.map((id) => ({ id })),
  );
  ok(dup.length === 2, "duplicate ids de-duplicated");

  // Empty input: zero fetches.
  let calls = 0;
  const none = await chunkedIn([], async () => {
    calls++;
    return [];
  });
  ok(none.length === 0 && calls === 0, "empty input performs no fetches");

  // Pagination inside one chunk: 5 ids × 600 rows = 3,000 rows, page cap 1,000.
  const bigIds = ["a", "b", "c", "d", "e"];
  const big = await chunkedIn(
    bigIds,
    async (chunk, from, to) => {
      const all: { id: string; i: number }[] = [];
      for (const id of chunk) for (let i = 0; i < 600; i++) all.push({ id, i });
      return all.slice(from, to + 1).slice(0, SERVER_CAP);
    },
    { chunkSize: 10, pageSize: SERVER_CAP },
  );
  ok(big.length === 3000, `single-chunk pagination complete (got ${big.length}, want 3000)`);

  // ── SLICE D: opt-in chunk concurrency ──────────────────────────────────────
  // The whole claim being defended is "faster, and otherwise identical". These
  // assertions are the "otherwise identical" half; a wrong answer delivered
  // quickly is not an improvement.

  // Default is SERIAL. Proven by observation, not by reading the constant:
  // record how many fetches are in flight and assert the peak never exceeds 1.
  {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    let inFlight = 0;
    let peak = 0;
    await chunkedIn(ids, async (chunk) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight--;
      return chunk.map((id) => ({ id }));
    });
    ok(peak === 1, `default stays serial (peak in-flight ${peak}, want 1)`);
  }

  // Concurrency actually overlaps requests, and respects its ceiling.
  {
    const ids = Array.from({ length: 1000 }, (_, i) => `id-${i}`);
    let inFlight = 0;
    let peak = 0;
    await chunkedIn(
      ids,
      async (chunk) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        // Yield enough times that every worker is started before any resolves.
        for (let i = 0; i < 5; i++) await Promise.resolve();
        inFlight--;
        return chunk.map((id) => ({ id }));
      },
      { chunkSize: 100, concurrency: 4 },
    );
    ok(peak > 1, `concurrency overlaps requests (peak in-flight ${peak})`);
    ok(peak <= 4, `concurrency respects its ceiling (peak ${peak}, max 4)`);
  }

  // ORDERING: the concurrent result must equal the serial result EXACTLY, even
  // when later chunks resolve before earlier ones. The fetcher below inverts
  // completion order on purpose — the first chunk waits the longest — so a
  // naive "push as they arrive" implementation would fail this.
  {
    const ids = Array.from({ length: 500 }, (_, i) => `id-${i}`);
    const fetcher = async (chunk: string[]) => {
      const delay = 20 - Number(chunk[0]!.split("-")[1]) / 25;
      await new Promise((r) => setTimeout(r, Math.max(0, delay)));
      return chunk.map((id) => ({ id }));
    };
    const serial = await chunkedIn(ids, fetcher, { chunkSize: 25 });
    const parallel = await chunkedIn(ids, fetcher, { chunkSize: 25, concurrency: 5 });
    ok(
      JSON.stringify(serial) === JSON.stringify(parallel),
      "concurrent result is byte-identical to serial, despite inverted completion order",
    );
    ok(parallel.length === 500, `no rows lost or duplicated (got ${parallel.length}, want 500)`);
  }

  // Pagination WITHIN a chunk stays ordered while chunks run concurrently.
  {
    const ids = ["a", "b", "c", "d"];
    const rows = await chunkedIn(
      ids,
      async (chunk, from, to) => {
        const all: { id: string; i: number }[] = [];
        for (const id of chunk) for (let i = 0; i < 250; i++) all.push({ id, i });
        return all.slice(from, to + 1).slice(0, 100);
      },
      { chunkSize: 1, pageSize: 100, concurrency: 4 },
    );
    ok(rows.length === 1000, `paged + concurrent returns every row (got ${rows.length})`);
    ok(
      rows[0]!.id === "a" && rows[999]!.id === "d",
      "paged + concurrent preserves chunk order",
    );
    const firstChunk = rows.slice(0, 250);
    ok(
      firstChunk.every((r, i) => r.i === i),
      "pages within a chunk stay in order under concurrency",
    );
  }

  // A rejection still propagates rather than being swallowed by the pool.
  {
    let threw = false;
    try {
      await chunkedIn(
        Array.from({ length: 400 }, (_, i) => `id-${i}`),
        async (chunk) => {
          if (chunk[0] === "id-200") throw new Error("boom");
          return chunk.map((id) => ({ id }));
        },
        { chunkSize: 200, concurrency: 2 },
      );
    } catch {
      threw = true;
    }
    ok(threw, "a failing chunk still rejects under concurrency");
  }

  // Guard rails: 0 / negative concurrency must not mean "no workers" (a hang).
  {
    const rows = await chunkedIn(
      ["a", "b", "c"],
      async (chunk) => chunk.map((id) => ({ id })),
      { chunkSize: 1, concurrency: 0 },
    );
    ok(rows.length === 3, "concurrency 0 is clamped to serial, not to a hang");
  }

  // pagedAll: 2,345 rows behind a 1,000-row server cap must all come back.
  const allRows = Array.from({ length: 2345 }, (_, i) => ({ i }));
  const paged = await pagedAll(async (from, to) =>
    allRows.slice(from, to + 1).slice(0, SERVER_CAP),
  );
  ok(paged.length === 2345, `pagedAll complete (got ${paged.length}, want 2345)`);
  const pagedSum = paged.reduce((a, r) => a + r.i, 0);
  const wantSum = (2344 * 2345) / 2;
  ok(pagedSum === wantSum, "pagedAll preserves every row exactly once");

  // ── SLICE 5A: pagedAllChecked ────────────────────────────────────────────

  // Happy path: 4,179 rows (the real inventory_lots size) behind a 1,000 cap.
  {
    const lots = Array.from({ length: 4179 }, (_, i) => ({ i }));
    const res = await pagedAllChecked<{ i: number }>(async (from, to) => ({
      rows: lots.slice(from, to + 1).slice(0, SERVER_CAP),
      ok: true,
    }));
    ok(res.rows.length === 4179, `checked paging complete (got ${res.rows.length}, want 4179)`);
    ok(res.verdict.complete, "verdict says complete");
    ok(res.verdict.reason === "complete", "reason complete");
  }

  // THE fail-open this exists to close: page 2 errors. Plain pagedAll would
  // return 1,000 rows and the caller would treat that as the whole table.
  {
    const lots = Array.from({ length: 4179 }, (_, i) => ({ i }));
    let call = 0;
    const res = await pagedAllChecked<{ i: number }>(async (from, to) => {
      call++;
      if (call === 2) return { rows: [], ok: false };
      return { rows: lots.slice(from, to + 1).slice(0, SERVER_CAP), ok: true };
    });
    ok(res.rows.length === 1000, "partial rows are still returned");
    ok(!res.verdict.complete, "a failed page is REPORTED, not swallowed");
    ok(res.verdict.reason === "read_failed", "reason read_failed");
  }

  // A failed FIRST page must not look like an empty table.
  {
    const res = await pagedAllChecked<{ i: number }>(async () => ({ rows: [], ok: false }));
    ok(res.rows.length === 0, "no rows recovered");
    ok(!res.verdict.complete, "empty-because-failed is NOT empty-because-empty");
    ok(res.verdict.reason === "read_failed", "reason read_failed on first page");
  }

  // A genuinely empty table is complete, not an error.
  {
    const res = await pagedAllChecked<{ i: number }>(async () => ({ rows: [], ok: true }));
    ok(res.rows.length === 0 && res.verdict.complete, "truly empty table reads complete");
  }

  // Safety ceiling is REPORTED rather than silently accepted.
  {
    const many = Array.from({ length: 9000 }, (_, i) => ({ i }));
    const res = await pagedAllChecked<{ i: number }>(
      async (from, to) => ({ rows: many.slice(from, to + 1).slice(0, SERVER_CAP), ok: true }),
      { maxRows: 3000 },
    );
    ok(res.rows.length === 3000, "ceiling bounds memory");
    ok(!res.verdict.complete, "hitting the ceiling is not complete");
    ok(res.verdict.reason === "limit_reached", "reason limit_reached");
  }

  // A server-side COUNT witness quantifies a silent shortfall exactly.
  {
    const lots = Array.from({ length: 4179 }, (_, i) => ({ i }));
    let call = 0;
    const res = await pagedAllChecked<{ i: number }>(
      async (from, to) => {
        call++;
        if (call === 3) return { rows: [], ok: false };
        return { rows: lots.slice(from, to + 1).slice(0, SERVER_CAP), ok: true };
      },
      { expectedTotal: 4179 },
    );
    ok(res.verdict.missing === 4179 - res.rows.length, "witness quantifies the shortfall exactly");
  }

  console.log(`chunked-in self-tests: ${n} assertions passed`);
}
