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

export const CHUNKED_IN_CHUNK_SIZE = 200;
export const CHUNKED_IN_PAGE_SIZE = 1000;

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
  opts: { chunkSize?: number; pageSize?: number } = {},
): Promise<Row[]> {
  const chunkSize = Math.max(1, opts.chunkSize ?? CHUNKED_IN_CHUNK_SIZE);
  const pageSize = Math.max(1, opts.pageSize ?? CHUNKED_IN_PAGE_SIZE);
  const unique = [...new Set(ids)];
  const out: Row[] = [];
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    let from = 0;
    for (;;) {
      const rows = await fetchPage(chunk, from, from + pageSize - 1);
      if (rows.length > 0) out.push(...rows);
      // A short page means the chunk is exhausted. (A full page might be the
      // server cap — keep going; the next page returning 0 rows ends the loop.)
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }
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

  // pagedAll: 2,345 rows behind a 1,000-row server cap must all come back.
  const allRows = Array.from({ length: 2345 }, (_, i) => ({ i }));
  const paged = await pagedAll(async (from, to) =>
    allRows.slice(from, to + 1).slice(0, SERVER_CAP),
  );
  ok(paged.length === 2345, `pagedAll complete (got ${paged.length}, want 2345)`);
  const pagedSum = paged.reduce((a, r) => a + r.i, 0);
  const wantSum = (2344 * 2345) / 2;
  ok(pagedSum === wantSum, "pagedAll preserves every row exactly once");

  console.log(`chunked-in self-tests: ${n} assertions passed`);
}
