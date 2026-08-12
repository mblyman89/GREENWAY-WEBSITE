/**
 * evm-history-pagination-core.ts — PURE address-pagination state machine for
 * EVM transaction history.
 *
 * WHY THIS EXISTS (the fast-sync fix)
 * -----------------------------------
 * The original EVM history walk scanned the chain genesis→tip in fixed
 * 10,000-BLOCK WINDOWS (evm-sync-core.ts / EVM_BACKFILL_WINDOW_BLOCKS), asking
 * every window "any transactions here?". On Flare/Songbird that is TENS OF
 * MILLIONS of blocks → THOUSANDS of mostly-empty API calls for a wallet that
 * only ever made a handful of transactions. That is why EVM sync crawled while
 * XRP and Coreum flew.
 *
 * XRP (xrpl-sync-core) and Coreum (coreum-sync-core) are fast for one reason:
 * they walk the ACCOUNT'S OWN transaction list (account_tx marker / next_key),
 * touching ONLY the transactions the wallet actually made. The Etherscan V2 and
 * Blockscout `account/txlist` + `account/tokentx` endpoints do exactly the same
 * thing — they return an address's transactions directly, paginated by
 * page/offset (VERIFIED live against flare-explorer.flare.network: txlist,
 * tokentx and tokenlist all return address-scoped results, offset up to 10,000).
 *
 * So this module makes EVM history walk the account's own tx list the SAME way
 * XRP/Coreum do: two independent ascending page streams (native `txlist` and
 * ERC-20 `tokentx`), each requesting the FULL block range with a large page
 * size, advancing page-by-page until a SHORT page (fewer rows than the page
 * size) proves the stream is exhausted. A wallet with a few hundred lifetime
 * transactions now finishes in ONE or TWO calls instead of thousands.
 *
 * DESIGN RULES (never guessed):
 *   • Two streams: `tx` (native txlist) and `token` (ERC-20 tokentx). Each has
 *     its own next page + done flag, so one can finish while the other keeps
 *     paging — exactly like Coreum's sender/recipient streams.
 *   • A stream is DONE the moment a page returns FEWER rows than the page size.
 *     A full page (== page size) means "there may be more" → advance the page.
 *   • The cursor is a small JSON object persisted as text in backfill_cursor and
 *     is fully resumable: `{"v":2,"tx":{"page":3,"done":false},"token":{...}}`.
 *   • Backwards compatible: a NULL cursor (fresh wallet) OR an OLD block-window
 *     cursor string ("12345:12300") both start a clean page-1 walk. We never
 *     crash on a legacy cursor — we just begin the account walk from the top.
 *   • Hard page ceiling so a misbehaving endpoint can't page forever.
 *   • No floats, no BigInt literals, no numeric separators (ES2017 target).
 *
 * PURE: no `server-only`, no I/O. Unit-tested via
 * `__runEvmHistoryPaginationCoreTests` (wired into run-pure-selftests + a vitest
 * mirror). The server layer (evm-sync-server.ts) does the fetching + mapping +
 * DB writes and drives this state machine.
 */

// ---------------------------------------------------------------------------
// Page size — the big lever
// ---------------------------------------------------------------------------

/**
 * Records per page when walking the account's tx list. Both Etherscan V2 and
 * Blockscout document a MAX of 10,000 records per page for txlist/tokentx
 * (VERIFIED in their API references). We request the documented maximum so a
 * wallet's entire history usually arrives in a single page. Exposed so the
 * server + tests share one number.
 */
export const EVM_HISTORY_PAGE_SIZE = 10000;

/**
 * Hard ceiling on pages per stream so a broken/looping endpoint can never spin
 * forever. At 10,000 rows/page this covers 5,000,000 transactions for a single
 * address — far beyond any real wallet — while still guaranteeing termination.
 */
export const EVM_HISTORY_MAX_PAGES = 500;

// ---------------------------------------------------------------------------
// Cursor model
// ---------------------------------------------------------------------------

/** One paginated stream's resume position. */
export type EvmStreamCursor = {
  /** The page number to request NEXT (1-based). */
  page: number;
  /** True once a short page proved this stream is exhausted. */
  done: boolean;
};

/** The full history cursor: one position per stream. */
export type EvmHistoryCursor = {
  /** Cursor-format version, so future changes are detectable. Always 2 here. */
  v: number;
  /** Native `txlist` stream. */
  tx: EvmStreamCursor;
  /** ERC-20 `tokentx` stream. */
  token: EvmStreamCursor;
};

/** Which stream a page belongs to. */
export type EvmStreamName = "tx" | "token";

/** A fresh cursor: both streams start at page 1, not done. */
export function initEvmHistoryCursor(): EvmHistoryCursor {
  return {
    v: 2,
    tx: { page: 1, done: false },
    token: { page: 1, done: false },
  };
}

/**
 * Parse a stored cursor string into an EvmHistoryCursor. Returns a FRESH cursor
 * (page-1 walk) for: null/blank, a legacy block-window cursor ("12345:12300"),
 * malformed JSON, or any shape we don't recognise. This guarantees an existing
 * wallet with an old-style cursor cleanly switches to the fast account walk on
 * its next sync — never crashes, never resumes a stale block position.
 */
export function parseEvmHistoryCursor(cursor: string | null): EvmHistoryCursor {
  if (cursor === null) return initEvmHistoryCursor();
  const raw = cursor.trim();
  if (raw === "") return initEvmHistoryCursor();
  // Legacy block-window cursor "nextStart:lastConsumed" — not JSON → fresh walk.
  if (!raw.startsWith("{")) return initEvmHistoryCursor();
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return initEvmHistoryCursor();
  }
  if (!obj || typeof obj !== "object") return initEvmHistoryCursor();
  const o = obj as { v?: unknown; tx?: unknown; token?: unknown };
  if (o.v !== 2) return initEvmHistoryCursor();
  return {
    v: 2,
    tx: parseStreamCursor(o.tx),
    token: parseStreamCursor(o.token),
  };
}

/** Defensive per-stream parse: any bad shape → a fresh page-1, not-done stream. */
function parseStreamCursor(value: unknown): EvmStreamCursor {
  if (!value || typeof value !== "object") return { page: 1, done: false };
  const v = value as { page?: unknown; done?: unknown };
  const page =
    typeof v.page === "number" && Number.isFinite(v.page) && v.page >= 1
      ? Math.trunc(v.page)
      : 1;
  const done = v.done === true;
  return { page, done };
}

/** Serialise the cursor to text for backfill_cursor. Returns null when DONE. */
export function serializeEvmHistoryCursor(cursor: EvmHistoryCursor): string | null {
  if (isEvmHistoryComplete(cursor)) return null;
  return JSON.stringify(cursor);
}

// ---------------------------------------------------------------------------
// Stream selection + advancement
// ---------------------------------------------------------------------------

/** True once BOTH streams are exhausted — the whole history walk is complete. */
export function isEvmHistoryComplete(cursor: EvmHistoryCursor): boolean {
  return cursor.tx.done && cursor.token.done;
}

/**
 * Pick the next stream to fetch. We finish the `tx` (native) stream first, then
 * the `token` stream — a deterministic order that keeps the cursor simple and
 * makes tests predictable. Returns null when both are done.
 */
export function nextEvmStream(cursor: EvmHistoryCursor): EvmStreamName | null {
  if (!cursor.tx.done) return "tx";
  if (!cursor.token.done) return "token";
  return null;
}

/**
 * The page number to request for a given stream (its current `page`). Callers
 * request this page with a full-range, large-offset query.
 */
export function pageForStream(cursor: EvmHistoryCursor, stream: EvmStreamName): number {
  return cursor[stream].page;
}

/**
 * Apply the outcome of ONE page fetch for `stream`. `rowsReturned` is how many
 * rows that page produced; `pageSize` is the offset we requested.
 *
 *   • rowsReturned < pageSize  → this was the LAST page: mark the stream done.
 *   • rowsReturned == pageSize → a full page: advance to the next page number.
 *   • Reaching EVM_HISTORY_MAX_PAGES forces the stream done (safety guard) so a
 *     misbehaving endpoint can never page forever.
 *
 * Pure: returns a NEW cursor; never mutates the input.
 */
export function advanceEvmStream(
  cursor: EvmHistoryCursor,
  stream: EvmStreamName,
  rowsReturned: number,
  pageSize: number,
): EvmHistoryCursor {
  const cur = cursor[stream];
  // A short page (or an empty page) means the stream is exhausted.
  const shortPage = rowsReturned < pageSize;
  const nextPage = cur.page + 1;
  const hitGuard = nextPage > EVM_HISTORY_MAX_PAGES;
  const updated: EvmStreamCursor = shortPage || hitGuard
    ? { page: cur.page, done: true }
    : { page: nextPage, done: false };
  return stream === "tx"
    ? { v: 2, tx: updated, token: cursor.token }
    : { v: 2, tx: cursor.tx, token: updated };
}

// ---------------------------------------------------------------------------
// Progress summary (honest, XRP/Coreum-style — never a fabricated percent)
// ---------------------------------------------------------------------------

/**
 * A short human phase for the cursor's state. Used only for diagnostics/logging;
 * the user-facing progress view lives in crypto-progress-core.ts.
 */
export function evmHistoryPhase(cursor: EvmHistoryCursor): "complete" | "paging" {
  return isEvmHistoryComplete(cursor) ? "complete" : "paging";
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run under tsx via run-pure-selftests + a vitest mirror).
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`evm-history-pagination-core self-test FAILED: ${name}`);
}

export function __runEvmHistoryPaginationCoreTests(): void {
  // --- constants
  check("page size is documented max 10000", EVM_HISTORY_PAGE_SIZE === 10000);
  check("max pages guard present", EVM_HISTORY_MAX_PAGES === 500);

  // --- init
  const fresh = initEvmHistoryCursor();
  check("fresh v2", fresh.v === 2);
  check("fresh tx page 1", fresh.tx.page === 1 && fresh.tx.done === false);
  check("fresh token page 1", fresh.token.page === 1 && fresh.token.done === false);
  check("fresh not complete", isEvmHistoryComplete(fresh) === false);

  // --- parse: null / blank / legacy / bad JSON all → fresh
  check("parse null → fresh", JSON.stringify(parseEvmHistoryCursor(null)) === JSON.stringify(fresh));
  check("parse blank → fresh", JSON.stringify(parseEvmHistoryCursor("   ")) === JSON.stringify(fresh));
  check(
    "parse legacy block cursor → fresh",
    JSON.stringify(parseEvmHistoryCursor("12345:12300")) === JSON.stringify(fresh),
  );
  check("parse bad json → fresh", JSON.stringify(parseEvmHistoryCursor("{oops")) === JSON.stringify(fresh));
  check(
    "parse wrong version → fresh",
    JSON.stringify(parseEvmHistoryCursor('{"v":1,"tx":{"page":9,"done":false}}')) === JSON.stringify(fresh),
  );

  // --- parse: a real v2 cursor round-trips
  const mid: EvmHistoryCursor = {
    v: 2,
    tx: { page: 3, done: false },
    token: { page: 1, done: true },
  };
  const parsed = parseEvmHistoryCursor(JSON.stringify(mid));
  check("parse v2 tx page", parsed.tx.page === 3 && parsed.tx.done === false);
  check("parse v2 token done", parsed.token.page === 1 && parsed.token.done === true);
  // defensive: negative/garbage page clamps to 1
  const bad = parseEvmHistoryCursor('{"v":2,"tx":{"page":-5,"done":false},"token":{"page":"x","done":true}}');
  check("parse clamps bad tx page", bad.tx.page === 1);
  check("parse clamps bad token page", bad.token.page === 1 && bad.token.done === true);

  // --- stream selection: tx first, then token, then null
  check("next stream = tx first", nextEvmStream(fresh) === "tx");
  check(
    "next stream = token after tx done",
    nextEvmStream({ v: 2, tx: { page: 2, done: true }, token: { page: 1, done: false } }) === "token",
  );
  check(
    "next stream = null when both done",
    nextEvmStream({ v: 2, tx: { page: 2, done: true }, token: { page: 5, done: true } }) === null,
  );
  check("pageForStream tx", pageForStream(fresh, "tx") === 1);
  check("pageForStream token", pageForStream(mid, "token") === 1);

  // --- advance: full page advances, short page finishes
  const afterFullTx = advanceEvmStream(fresh, "tx", EVM_HISTORY_PAGE_SIZE, EVM_HISTORY_PAGE_SIZE);
  check("full page advances tx to page 2", afterFullTx.tx.page === 2 && afterFullTx.tx.done === false);
  check("advancing tx leaves token untouched", afterFullTx.token.page === 1 && afterFullTx.token.done === false);

  const afterShortTx = advanceEvmStream(fresh, "tx", 42, EVM_HISTORY_PAGE_SIZE);
  check("short page marks tx done", afterShortTx.tx.done === true && afterShortTx.tx.page === 1);

  const afterEmptyTx = advanceEvmStream(fresh, "tx", 0, EVM_HISTORY_PAGE_SIZE);
  check("empty page marks tx done", afterEmptyTx.tx.done === true);

  const afterFullToken = advanceEvmStream(
    { v: 2, tx: { page: 1, done: true }, token: { page: 1, done: false } },
    "token",
    EVM_HISTORY_PAGE_SIZE,
    EVM_HISTORY_PAGE_SIZE,
  );
  check("full token page advances", afterFullToken.token.page === 2 && afterFullToken.token.done === false);
  check("advancing token leaves tx done", afterFullToken.tx.done === true);

  // --- purity: input cursor never mutated
  const before = JSON.stringify(fresh);
  advanceEvmStream(fresh, "tx", 10, EVM_HISTORY_PAGE_SIZE);
  check("advance does not mutate input", JSON.stringify(fresh) === before);

  // --- guard: page ceiling forces done
  const nearMax: EvmHistoryCursor = { v: 2, tx: { page: EVM_HISTORY_MAX_PAGES, done: false }, token: { page: 1, done: true } };
  const guarded = advanceEvmStream(nearMax, "tx", EVM_HISTORY_PAGE_SIZE, EVM_HISTORY_PAGE_SIZE);
  check("page ceiling forces done", guarded.tx.done === true);

  // --- completion + serialise
  const done: EvmHistoryCursor = { v: 2, tx: { page: 2, done: true }, token: { page: 3, done: true } };
  check("both done → complete", isEvmHistoryComplete(done) === true);
  check("complete cursor serialises to null", serializeEvmHistoryCursor(done) === null);
  const inProgress = serializeEvmHistoryCursor(mid);
  check("in-progress serialises to json", typeof inProgress === "string" && inProgress.includes('"v":2'));
  // round-trip the in-progress string
  check(
    "serialise → parse round-trip",
    JSON.stringify(parseEvmHistoryCursor(inProgress)) === JSON.stringify(mid),
  );

  // --- phase
  check("phase paging", evmHistoryPhase(fresh) === "paging");
  check("phase complete", evmHistoryPhase(done) === "complete");

  // --- full walk simulation: 2 full tx pages then short, then 1 short token page
  let c = initEvmHistoryCursor();
  check("walk step1 stream tx", nextEvmStream(c) === "tx");
  c = advanceEvmStream(c, "tx", EVM_HISTORY_PAGE_SIZE, EVM_HISTORY_PAGE_SIZE); // full
  check("walk tx now page 2", c.tx.page === 2);
  c = advanceEvmStream(c, "tx", 5, EVM_HISTORY_PAGE_SIZE); // short → tx done
  check("walk tx done", c.tx.done === true);
  check("walk next now token", nextEvmStream(c) === "token");
  c = advanceEvmStream(c, "token", 0, EVM_HISTORY_PAGE_SIZE); // empty → token done
  check("walk complete", isEvmHistoryComplete(c) === true);
  check("walk final stream null", nextEvmStream(c) === null);

  console.log("evm-history-pagination-core self-tests: all passed");
}
