/**
 * src/lib/crypto/stellar/stellar-sync-core.ts -- PURE Stellar sync brain.
 *
 * No `server-only`, no network, no Supabase, no React. Just the decision logic
 * for walking Horizon's cursor-paginated payments endpoint and the row-builders
 * that turn the mapped balances/transactions into the EXACT upsert objects for
 * the crypto_* tables. Keeping this pure lets the self-test battery (tsx +
 * vitest) exercise every rule without a DB.
 *
 * REUSE, DON'T DUPLICATE: the row-building + sign-splitting + sync-state logic
 * is chain-agnostic and already exists, tested, in xrpl-sync-core. We import and
 * re-export those builders so Stellar shares ONE audited implementation of the
 * crypto_balances / crypto_transactions / crypto_sync_state contract. What is
 * genuinely Stellar-specific lives here: the cursor pagination state machine
 * (Horizon `_links.next` -> opaque paging_token), the page guard, and the
 * dust-aware counts summary.
 *
 * Horizon pagination facts (verified live 2026-08-12):
 *   - Collections are ordered `asc` (oldest-first) for a stable, resumable walk.
 *   - Each page carries `_links.next.href` whose `cursor` is the last record's
 *     `paging_token`; an EMPTY page (no records) means we've reached the end.
 *   - The cursor is a plain string (int64 paging_token) -- trivially serialized.
 */

import type { MappedBalance, MappedTransaction } from "./stellar-map-core";

// Re-export the AUDITED, chain-agnostic builders so the Stellar server layer
// uses the exact same crypto_* contract as XRPL/Coreum. (Their MappedBalance /
// MappedTransaction shapes are structurally identical to Stellar's.)
export {
  buildBalanceUpsert,
  buildBalanceUpserts,
  untrackedBalances,
  buildTransactionUpsert,
  buildTransactionUpserts,
  buildSyncStateUpsert,
  serializeMarker,
  deserializeMarker,
  unsignMinor,
  unsignDecimal,
  type BalanceUpsertRow,
  type TransactionUpsertRow,
  type SyncStateUpsertRow,
} from "../xrpl/xrpl-sync-core";

// ---------------------------------------------------------------------------
// Cursor pagination state machine -- walks Horizon payments by paging_token.
// ---------------------------------------------------------------------------

/** Hard ceiling so a misbehaving endpoint can't page forever. */
export const MAX_STELLAR_BACKFILL_PAGES = 5000;

/** State of an in-progress (or finished) Stellar payments backfill. */
export type StellarBackfillState = {
  /** The `cursor` (paging_token) to send on the NEXT request; null = first page / done. */
  cursor: string | null;
  /** Pages successfully applied so far. */
  pages: number;
  /** True once a page returned no next cursor -- the walk is complete. */
  done: boolean;
};

/**
 * Begin a backfill. A saved cursor (resumable) continues where we left off;
 * null/empty starts from the beginning of the available history (oldest-first).
 */
export function initStellarBackfill(savedCursor: string | null): StellarBackfillState {
  const cursor =
    savedCursor === undefined || savedCursor === null || savedCursor.trim() === ""
      ? null
      : savedCursor.trim();
  return { cursor, pages: 0, done: false };
}

/**
 * Apply the result of ONE payments page. `nextCursor` is the page's next cursor
 * (null when there are no more pages). `recordCount` is how many records the
 * page returned -- an empty page also ends the walk (Horizon returns an empty
 * `_embedded.records` at the tail). Increments the page count and flips `done`
 * when the walk is complete or the page guard trips.
 */
export function reduceStellarBackfill(
  state: StellarBackfillState,
  nextCursor: string | null,
  recordCount: number,
): StellarBackfillState {
  const pages = state.pages + 1;
  const noMore = nextCursor === null || nextCursor === undefined || recordCount === 0;
  const hitGuard = pages >= MAX_STELLAR_BACKFILL_PAGES;
  return {
    cursor: noMore ? null : nextCursor,
    pages,
    done: noMore || hitGuard,
  };
}

/** Should the orchestrator request another page? */
export function shouldContinueStellarBackfill(state: StellarBackfillState): boolean {
  return !state.done;
}

// ---------------------------------------------------------------------------
// Counts + summary (dust-aware) -- for the sync report + diagnostics.
// ---------------------------------------------------------------------------

export type StellarSyncCounts = {
  pages: number;
  balancesUpserted: number;
  transactionsUpserted: number;
  untrackedBalances: number;
  untrackedTransactions: number;
  /** Count of 1-stroop dust/spam legs recorded (kept for history, valued zero). */
  dustTransactions: number;
};

export function emptyStellarSyncCounts(): StellarSyncCounts {
  return {
    pages: 0,
    balancesUpserted: 0,
    transactionsUpserted: 0,
    untrackedBalances: 0,
    untrackedTransactions: 0,
    dustTransactions: 0,
  };
}

/** Fold one page's contributions into the running totals (pure). */
export function addStellarPageCounts(
  base: StellarSyncCounts,
  delta: Partial<StellarSyncCounts>,
): StellarSyncCounts {
  return {
    pages: base.pages + (delta.pages ?? 0),
    balancesUpserted: base.balancesUpserted + (delta.balancesUpserted ?? 0),
    transactionsUpserted: base.transactionsUpserted + (delta.transactionsUpserted ?? 0),
    untrackedBalances: base.untrackedBalances + (delta.untrackedBalances ?? 0),
    untrackedTransactions: base.untrackedTransactions + (delta.untrackedTransactions ?? 0),
    dustTransactions: base.dustTransactions + (delta.dustTransactions ?? 0),
  };
}

/** Count how many of a page's legs are dust (1-stroop spam). */
export function countDustLegs(legs: MappedTransaction[]): number {
  let n = 0;
  for (const leg of legs ?? []) if (leg.dust === true) n += 1;
  return n;
}

/** Plain-English one-liner for the sync report. */
export function summarizeStellarSync(counts: StellarSyncCounts): string {
  const txn = counts.transactionsUpserted;
  const bal = counts.balancesUpserted;
  const parts = [
    `${bal} balance${bal === 1 ? "" : "s"}`,
    `${txn} transaction${txn === 1 ? "" : "s"}`,
    `${counts.pages} page${counts.pages === 1 ? "" : "s"}`,
  ];
  let s = `Synced ${parts.join(", ")}.`;
  if (counts.dustTransactions > 0) {
    s += ` (${counts.dustTransactions} were 1-stroop spam "dust" payments, kept for history but valued at zero.)`;
  }
  if (counts.untrackedBalances > 0 || counts.untrackedTransactions > 0) {
    s += ` (${counts.untrackedBalances} untracked-asset balance${counts.untrackedBalances === 1 ? "" : "s"}, ${counts.untrackedTransactions} untracked-asset transaction${counts.untrackedTransactions === 1 ? "" : "s"} kept for history.)`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Balance zero-check helper for the server (uses the shared representation).
// ---------------------------------------------------------------------------

/** How many mapped balances have a modeled asset id (persistable rows). */
export function countPersistableBalances(balances: MappedBalance[]): number {
  return (balances ?? []).filter((b) => b.assetId !== null).length;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run under tsx via run-pure-selftests + vitest mirror).
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`stellar-sync-core self-test FAILED: ${name}`);
}

export function __runStellarSyncCoreTests(): void {
  // init
  const s0 = initStellarBackfill(null);
  check("init null cursor", s0.cursor === null && s0.pages === 0 && s0.done === false);
  const sResume = initStellarBackfill("  248079673249452093  ");
  check("init resume trims", sResume.cursor === "248079673249452093");
  check("init blank -> null", initStellarBackfill("   ").cursor === null);

  // reduce: a normal page advances the cursor
  const s1 = reduceStellarBackfill(s0, "CUR2", 200);
  check("reduce advances", s1.cursor === "CUR2" && s1.pages === 1 && s1.done === false);

  // reduce: no next cursor -> done
  const sDoneNoCursor = reduceStellarBackfill(s1, null, 200);
  check("reduce no cursor done", sDoneNoCursor.done === true && sDoneNoCursor.cursor === null);

  // reduce: empty page -> done even with a cursor echoed
  const sDoneEmpty = reduceStellarBackfill(s1, "CUR3", 0);
  check("reduce empty page done", sDoneEmpty.done === true && sDoneEmpty.cursor === null);

  // reduce: page guard
  let sGuard: StellarBackfillState = { cursor: "X", pages: MAX_STELLAR_BACKFILL_PAGES - 1, done: false };
  sGuard = reduceStellarBackfill(sGuard, "Y", 200);
  check("reduce guard trips", sGuard.done === true);

  // shouldContinue
  check("continue while not done", shouldContinueStellarBackfill(s1) === true);
  check("stop when done", shouldContinueStellarBackfill(sDoneNoCursor) === false);

  // counts
  let counts = emptyStellarSyncCounts();
  check("empty counts", counts.pages === 0 && counts.dustTransactions === 0);
  counts = addStellarPageCounts(counts, { pages: 1, transactionsUpserted: 5, dustTransactions: 4 });
  counts = addStellarPageCounts(counts, { pages: 1, balancesUpserted: 1, transactionsUpserted: 1 });
  check("counts folded", counts.pages === 2 && counts.transactionsUpserted === 6 && counts.dustTransactions === 4 && counts.balancesUpserted === 1);

  // dust counting from legs
  const legs: MappedTransaction[] = [
    { txHash: "a", eventIndex: 0, assetId: "xlm", chain: "stellar", direction: "in", txType: "transfer", amountRaw: "1", amountDecimal: null, decimalsAtEvent: 7, feeRaw: null, feeAssetId: null, counterparty: null, blockNumber: null, blockTime: null, success: true, dust: true },
    { txHash: "b", eventIndex: 0, assetId: "xlm", chain: "stellar", direction: "out", txType: "transfer", amountRaw: "-1000000000", amountDecimal: null, decimalsAtEvent: 7, feeRaw: null, feeAssetId: null, counterparty: null, blockNumber: null, blockTime: null, success: true, dust: false },
  ];
  check("countDustLegs", countDustLegs(legs) === 1);

  // persistable balances
  const bals: MappedBalance[] = [
    { assetId: "xlm", amountRaw: "2796501307", amountDecimal: null, decimalsAtRead: 7 },
    { assetId: null, amountRaw: null, amountDecimal: "10.0", decimalsAtRead: null, currency: "USDC" },
  ];
  check("persistable count", countPersistableBalances(bals) === 1);

  // summaries
  const dustSummary = summarizeStellarSync({ pages: 3, balancesUpserted: 1, transactionsUpserted: 172, untrackedBalances: 0, untrackedTransactions: 0, dustTransactions: 172 });
  check("summary mentions dust", dustSummary.includes("dust") && dustSummary.includes("172"));
  const cleanSummary = summarizeStellarSync({ pages: 1, balancesUpserted: 1, transactionsUpserted: 2, untrackedBalances: 0, untrackedTransactions: 0, dustTransactions: 0 });
  check("clean summary no dust note", !cleanSummary.includes("dust"));

  console.log("stellar-sync-core self-tests: all passed");
}
