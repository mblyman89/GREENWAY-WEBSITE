/**
 * src/lib/supabase/read-completeness-core.ts  (SLICE 5A)
 *
 * PURE module — no supabase / no "server-only" import — so it runs under
 * `npx tsx scripts/compliance/run-pure-selftests.ts`.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * PostgREST caps a single response at `db.max_rows` (default 1000) — see
 * chunked-in.ts:13-14. `.limit(5000)` does NOT raise that ceiling; a `.limit()`
 * can only ever LOWER it. So a call site asking for 5,000 rows receives 1,000,
 * with **no error and no warning**.
 *
 * That is the part the codebase had no answer for. `chunked-in.ts` fixed the
 * COMPLETENESS problem (page with `.range()` until a short page) but its fetcher
 * signature returns `Row[]` (chunked-in.ts:82-96), so a FAILED page returns `[]`
 * and the loop reads that as a clean end-of-data. `listVendors()` has the same
 * shape at vendors/store.ts:60 — `if (error || !data) break;` quietly returns a
 * SHORT list.
 *
 * The result is a read that cannot tell these three states apart:
 *   1. "I read everything."               → trustworthy
 *   2. "I stopped early because the server capped me." → truncated, looks fine
 *   3. "I stopped early because the read errored."     → short, looks fine
 *
 * For an advisory panel, conflating them is survivable. For the recall-hold
 * gate (the statutory stop that refuses a sale, completion-gate.ts:103) and for
 * the acquisition-cost floor (discount-engine-core.ts:592, where an unknown cost
 * silently disables below-cost protection), conflating them is FAIL-OPEN.
 *
 * This module makes the distinction explicit and testable. It computes nothing
 * about the database; it judges the SHAPE of what a paging loop observed.
 *
 * ── DESIGN RULE (asymmetric, deliberately) ─────────────────────────────────
 * Mirrors the posture already documented in recall-hold-store.ts:7-15 and the
 * SLICE 4A commit-integrity core: an ADVISORY caller degrades softly (ship the
 * partial list, flagged), a STATUTORY caller refuses. This core never decides
 * which one a caller is — it only reports, honestly, what it saw. The call site
 * owns the consequence.
 *
 * NEVER GUESS: a page count that is not a finite non-negative integer is
 * treated as unusable evidence, never coerced to 0. Zero is a real answer
 * ("no rows"); unusable is not.
 */

/** PostgREST's default server-side row ceiling. Documented in chunked-in.ts:13-14. */
export const POSTGREST_DEFAULT_MAX_ROWS = 1000;

/**
 * Why a paged read stopped.
 *
 *  - `complete`      — a short page ended the loop. Every row was read.
 *  - `read_failed`   — a page reported an error. The result is SHORT by an
 *                      unknown amount. Never trust a count derived from it.
 *  - `limit_reached` — the loop hit its own safety ceiling (maxRows) while the
 *                      server was still returning full pages. More rows exist.
 */
export type ReadStopReason = "complete" | "read_failed" | "limit_reached";

/** What a paging loop observed, in the shape this core can judge. */
export type ReadObservation = {
  /** Rows actually collected across every page. */
  rowsRead: number;
  /** Pages fetched (a page that errored still counts as attempted). */
  pagesFetched: number;
  /** Rows requested per page — the `.range()` window width. */
  pageSize: number;
  /** True when any page reported an error. */
  readFailed?: boolean;
  /** True when the loop stopped at its own ceiling rather than a short page. */
  hitCeiling?: boolean;
  /**
   * OPTIONAL independent witness: a server-side `count: "exact", head: true`
   * total. This is immune to db.max_rows because it returns a NUMBER, not rows
   * (established pattern — e.g. vendors/store.ts:136). When present it turns a
   * shape heuristic into arithmetic proof.
   */
  expectedTotal?: number | null;
};

/** The verdict a call site acts on. */
export type ReadCompletenessVerdict = {
  /** Safe to treat the rows as the WHOLE answer? */
  complete: boolean;
  reason: ReadStopReason;
  rowsRead: number;
  /** Rows known to be missing. Null when the shortfall cannot be quantified. */
  missing: number | null;
  /** Plain-English explanation, safe to show an operator. */
  message: string;
};

/** A count is usable evidence only if it is a finite, non-negative integer. */
export function usableCount(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && Number.isInteger(n);
}

/**
 * Would a single un-paged read of `total` rows be silently truncated?
 *
 * The predicate behind all 20 SLICE 5 sites: a `.limit(N)` where N exceeds the
 * server cap creates the ILLUSION of a complete read. `.limit(2000)` against a
 * 1,775-row table (vendors — docs/ROADMAP_VENDORS_AND_KB_ENRICHMENT.md:30)
 * returns 1,000 rows and no error.
 */
export function wouldTruncate(total: number, maxRows: number = POSTGREST_DEFAULT_MAX_ROWS): boolean {
  if (!usableCount(total) || !usableCount(maxRows) || maxRows <= 0) return false;
  return total > maxRows;
}

/**
 * Judge a completed paging loop.
 *
 * Rule order matters and is deliberate — the most dangerous state wins:
 *
 *   1. read_failed   — an error was SEEN. Never claim completeness after one,
 *                      even if the arithmetic happens to line up: we do not
 *                      know what the failed page contained.
 *   2. limit_reached — the loop stopped itself while pages were still full.
 *   3. expectedTotal — an independent witness disagrees ⇒ incomplete, and the
 *                      shortfall is EXACTLY quantified.
 *   4. complete      — a short page ended the loop and nothing contradicts it.
 *
 * A short page is the only reliable end-of-data signal (chunked-in.ts:66-68),
 * because a FULL page may be the server cap rather than the true end.
 */
export function evaluateReadCompleteness(obs: ReadObservation): ReadCompletenessVerdict {
  const rowsRead = usableCount(obs?.rowsRead) ? obs.rowsRead : 0;
  const expected = usableCount(obs?.expectedTotal) ? obs.expectedTotal : null;

  // 1. An observed error outranks every other signal.
  if (obs?.readFailed === true) {
    const missing = expected !== null ? Math.max(0, expected - rowsRead) : null;
    return {
      complete: false,
      reason: "read_failed",
      rowsRead,
      missing,
      message:
        missing !== null
          ? `Read failed after ${rowsRead} row(s); at least ${missing} row(s) are missing. This result is incomplete and must not be treated as the whole picture.`
          : `Read failed after ${rowsRead} row(s). An unknown number of rows are missing; this result is incomplete.`,
    };
  }

  // 2. The loop stopped at its own ceiling while pages were still full.
  if (obs?.hitCeiling === true) {
    const missing = expected !== null ? Math.max(0, expected - rowsRead) : null;
    return {
      complete: false,
      reason: "limit_reached",
      rowsRead,
      missing,
      message:
        missing !== null
          ? `Stopped at the safety ceiling after ${rowsRead} row(s); ${missing} more row(s) exist. Raise the ceiling or narrow the query.`
          : `Stopped at the safety ceiling after ${rowsRead} row(s); more rows exist. Raise the ceiling or narrow the query.`,
    };
  }

  // 3. Independent witness (server-side COUNT) disagrees with what we collected.
  if (expected !== null && rowsRead < expected) {
    return {
      complete: false,
      reason: "read_failed",
      rowsRead,
      missing: expected - rowsRead,
      message: `Read returned ${rowsRead} row(s) but the server counts ${expected}; ${expected - rowsRead} row(s) are missing. This result is incomplete.`,
    };
  }

  // 4. Nothing contradicts the short page. The read is whole.
  //    (rowsRead ABOVE expectedTotal is benign: rows can be inserted between
  //    the COUNT and the read. Extra rows never hide a recalled lot or erase a
  //    cost — the direction that matters is SHORT. Same asymmetry SLICE 4A
  //    established for observed-vs-recorded item counts.)
  return {
    complete: true,
    reason: "complete",
    rowsRead,
    missing: 0,
    message: `Read complete: ${rowsRead} row(s).`,
  };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export async function __runReadCompletenessCoreTests(): Promise<void> {
  let n = 0;
  function ok(cond: boolean, label: string) {
    n++;
    if (!cond) throw new Error(`read-completeness self-test failed: ${label}`);
  }

  // ── usableCount ──────────────────────────────────────────────────────────
  ok(usableCount(0), "0 is a usable count (it is a real answer)");
  ok(usableCount(4179), "a positive integer is usable");
  ok(!usableCount(-1), "negative is not usable");
  ok(!usableCount(1.5), "non-integer is not usable");
  ok(!usableCount(NaN), "NaN is not usable");
  ok(!usableCount(Infinity), "Infinity is not usable");
  ok(!usableCount(null), "null is not usable");
  ok(!usableCount(undefined), "undefined is not usable");
  ok(!usableCount("1000"), "a numeric STRING is not usable");

  // ── wouldTruncate: the premise behind all 20 sites ───────────────────────
  ok(wouldTruncate(1775), "1,775 vendors > 1,000 cap => truncates TODAY");
  ok(wouldTruncate(4179), "4,179 lots > 1,000 cap => truncates");
  ok(!wouldTruncate(1000), "exactly at the cap does not truncate");
  ok(!wouldTruncate(999), "under the cap does not truncate");
  ok(!wouldTruncate(0), "empty table does not truncate");
  ok(wouldTruncate(1001, 1000), "one row over the cap truncates");
  ok(!wouldTruncate(5000, 10000), "a raised server cap changes the answer");
  ok(!wouldTruncate(NaN), "garbage total never claims truncation");

  // ── complete ─────────────────────────────────────────────────────────────
  {
    const v = evaluateReadCompleteness({ rowsRead: 4179, pagesFetched: 5, pageSize: 1000 });
    ok(v.complete, "short final page => complete");
    ok(v.reason === "complete", "reason is complete");
    ok(v.missing === 0, "nothing missing");
  }
  {
    const v = evaluateReadCompleteness({ rowsRead: 0, pagesFetched: 1, pageSize: 1000 });
    ok(v.complete, "genuinely empty table is COMPLETE, not suspicious");
    ok(v.rowsRead === 0, "zero rows reported");
  }

  // ── read_failed outranks everything ──────────────────────────────────────
  {
    const v = evaluateReadCompleteness({
      rowsRead: 1000,
      pagesFetched: 2,
      pageSize: 1000,
      readFailed: true,
    });
    ok(!v.complete, "a failed page is never complete");
    ok(v.reason === "read_failed", "reason is read_failed");
    ok(v.missing === null, "shortfall unquantifiable without a witness");
  }
  {
    // The trap: arithmetic lines up, but an error was still seen.
    const v = evaluateReadCompleteness({
      rowsRead: 500,
      pagesFetched: 1,
      pageSize: 1000,
      readFailed: true,
      expectedTotal: 500,
    });
    ok(!v.complete, "matching totals do NOT excuse an observed read error");
    ok(v.reason === "read_failed", "error still wins over matching arithmetic");
    ok(v.missing === 0, "quantified shortfall is 0 but completeness is still false");
  }

  // ── limit_reached ────────────────────────────────────────────────────────
  {
    const v = evaluateReadCompleteness({
      rowsRead: 5000,
      pagesFetched: 5,
      pageSize: 1000,
      hitCeiling: true,
    });
    ok(!v.complete, "hitting the safety ceiling is not complete");
    ok(v.reason === "limit_reached", "reason is limit_reached");
  }
  {
    const v = evaluateReadCompleteness({
      rowsRead: 5000,
      pagesFetched: 5,
      pageSize: 1000,
      hitCeiling: true,
      expectedTotal: 6200,
    });
    ok(v.missing === 1200, "witness quantifies exactly how many were left behind");
  }

  // ── expectedTotal witness ────────────────────────────────────────────────
  {
    // THE recall scenario: capped at 1,000 of 1,775, no error raised.
    const v = evaluateReadCompleteness({
      rowsRead: 1000,
      pagesFetched: 1,
      pageSize: 1000,
      expectedTotal: 1775,
    });
    ok(!v.complete, "witness catches a silent server-cap truncation");
    ok(v.missing === 775, "exactly 775 rows missing");
    ok(v.message.includes("775"), "message names the shortfall");
  }
  {
    const v = evaluateReadCompleteness({
      rowsRead: 1775,
      pagesFetched: 2,
      pageSize: 1000,
      expectedTotal: 1775,
    });
    ok(v.complete, "witness agrees => complete");
  }
  {
    const v = evaluateReadCompleteness({
      rowsRead: 1776,
      pagesFetched: 2,
      pageSize: 1000,
      expectedTotal: 1775,
    });
    ok(v.complete, "MORE rows than the witness is benign (insert during read)");
    ok(v.missing === 0, "no shortfall when we read extra");
  }
  {
    const v = evaluateReadCompleteness({
      rowsRead: 1000,
      pagesFetched: 1,
      pageSize: 1000,
      expectedTotal: null,
    });
    ok(v.complete, "no witness + no error + short-page stop => complete");
  }
  {
    // A garbage witness must not fabricate a shortfall.
    const v = evaluateReadCompleteness({
      rowsRead: 10,
      pagesFetched: 1,
      pageSize: 1000,
      expectedTotal: Number.NaN,
    });
    ok(v.complete, "unusable witness is ignored, not coerced to 0");
  }

  // ── garbage input never crashes ──────────────────────────────────────────
  {
    const v = evaluateReadCompleteness({
      rowsRead: Number.NaN,
      pagesFetched: 0,
      pageSize: 1000,
    });
    ok(v.rowsRead === 0, "unusable rowsRead reports as 0");
  }

  console.log(`read-completeness-core self-tests: ${n} assertions passed`);
}
