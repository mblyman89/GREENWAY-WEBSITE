import "server-only";

/**
 * src/lib/crypto/stellar/stellar-sync-server.ts -- the SERVER-ONLY Stellar (XLM)
 * sync driver. It turns the pure sync brain (stellar-sync-core) into real
 * network calls (stellar-client) + database writes (crypto-store), and it NEVER
 * throws to the UI: any failure is recorded on the wallet's sync_state (status
 * 'error' + message) and returned as a friendly result, so one bad wallet can't
 * break a page or a scheduled run.
 *
 * Per Stellar wallet:
 *   1) Mark the wallet 'backfilling'.
 *   2) BALANCES -- GET /accounts/{id}. Map native XLM (7-dec stroops) + any
 *      issued assets (kept as untracked). Upsert to crypto_balances (idempotent
 *      on wallet+asset). An unfunded account simply has no balances.
 *   3) HISTORY -- walk GET /accounts/{id}/payments oldest-first by `cursor`
 *      (paging_token), resuming from the saved cursor. Each page: map every
 *      payment op via stellar-map-core -> build unsigned upsert rows (direction
 *      carries the sign) -> upsert to crypto_transactions (idempotent on
 *      wallet+hash+event). The FULL source record is stored in each row's `raw`
 *      jsonb for audit provability. 1-stroop spam "dust" payments are recorded
 *      but flagged so valuation ignores them. Persist the cursor after each page
 *      so a crash/rate-limit resumes cleanly.
 *   4) Persist final sync_state: cursor=null + backfill_complete when we walked
 *      to the end; status back to 'idle'. On error -> status 'error' + message,
 *      keeping the resume cursor.
 *
 * HISTORY LIMITATION (surfaced to the owner, not a bug): SDF's public Horizon
 * retains only ~12 months of history. A pre-2024 acquisition is outside this
 * window, so the true 2018 cost basis is reconstructed separately; this driver
 * captures the live balance + every operation Horizon still serves.
 *
 * SAFETY: watch-only. We use ONLY the wallet's PUBLIC address. No keys exist in
 * this system. The client throttles + retries against public Horizon. USD value
 * is never written here (priced in a later slice); we never guess a dollar value.
 */

import {
  getCryptoWallet,
  upsertCryptoBalances,
  upsertCryptoTransactions,
  upsertCryptoSyncState,
  getCryptoSyncState,
  countCryptoTransactions,
} from "../crypto-store";
import { fetchStellarBalances, fetchStellarPaymentsPage } from "./stellar-client";
import {
  mapStellarBalances,
  mapStellarPayment,
  type HorizonBalance,
  type HorizonPaymentRecord,
} from "./stellar-map-core";
import {
  buildBalanceUpserts,
  untrackedBalances,
  buildTransactionUpserts,
  buildSyncStateUpsert,
  initStellarBackfill,
  reduceStellarBackfill,
  shouldContinueStellarBackfill,
  emptyStellarSyncCounts,
  addStellarPageCounts,
  countDustLegs,
  summarizeStellarSync,
  type StellarSyncCounts,
  type BalanceUpsertRow,
  type TransactionUpsertRow,
} from "./stellar-sync-core";

/** Per-wallet sync outcome. Never throws -- the error is here as a friendly string. */
export type StellarWalletSyncResult = {
  walletId: string;
  address: string | null;
  ok: boolean;
  message: string;
  counts: StellarSyncCounts;
  error?: string | null;
};

const NOW = (): string => new Date().toISOString();

/** Record an error sync-state without throwing (best-effort). */
async function recordError(walletId: string, cursor: string | null, message: string): Promise<void> {
  try {
    await upsertCryptoSyncState(
      buildSyncStateUpsert({
        walletId,
        cursor,
        backfillComplete: false,
        syncedAt: NOW(),
        status: "error",
        errorMessage: message.slice(0, 500),
      }),
    );
  } catch {
    // best-effort; the returned result still carries the friendly message.
  }
}

/**
 * Fetch + persist current balances for a Stellar wallet. Returns how many
 * balance rows were written and how many held assets we don't yet model
 * (surfaced, never dropped). Throws only on a hard fetch error.
 */
async function syncBalances(
  walletId: string,
  address: string,
): Promise<{ written: number; untracked: number }> {
  const readAt = NOW();
  const res = await fetchStellarBalances(address);
  if (!res.ok) throw new Error(res.error);
  if (!res.exists) return { written: 0, untracked: 0 }; // unfunded account

  const mapped = mapStellarBalances(res.balances as HorizonBalance[]);
  const rows: BalanceUpsertRow[] = buildBalanceUpserts(walletId, mapped, readAt);
  const untracked = untrackedBalances(mapped).length;

  if (rows.length > 0) {
    const write = await upsertCryptoBalances(rows);
    if (!write.ok) throw new Error(write.error);
    return { written: write.count, untracked };
  }
  return { written: 0, untracked };
}

/**
 * Walk the payments endpoint by cursor, mapping + persisting each page.
 * `savedCursor` is the resumable paging_token from a prior run (null = start
 * from the oldest available). Persists the cursor after each page so a crash
 * resumes cleanly. Returns the running counts and whether the walk completed.
 */
async function syncHistory(
  walletId: string,
  address: string,
  savedCursor: string | null,
): Promise<{ counts: StellarSyncCounts; complete: boolean }> {
  let counts = emptyStellarSyncCounts();
  let state = initStellarBackfill(savedCursor);
  let prevCursor = savedCursor;

  while (shouldContinueStellarBackfill(state)) {
    const page = await fetchStellarPaymentsPage(address, { cursor: state.cursor });
    if (!page.ok) {
      // Surface the error but keep the cursor we were about to use, so the next
      // run resumes from here instead of restarting the whole history.
      throw new Error(page.error);
    }
    if (!page.exists) break; // account never existed -> no history

    const records = page.page.records as HorizonPaymentRecord[];

    const rows: TransactionUpsertRow[] = [];
    let untrackedTx = 0;
    let dust = 0;
    for (const rec of records) {
      const legs = mapStellarPayment(address, rec);
      dust += countDustLegs(legs);
      const built = buildTransactionUpserts(walletId, legs, rec);
      for (const row of built) {
        rows.push(row);
        if (row.asset_id === null) untrackedTx += 1;
      }
    }

    if (rows.length > 0) {
      const write = await upsertCryptoTransactions(rows);
      if (!write.ok) throw new Error(write.error);
    }

    // Advance the state machine, then persist the cursor as the resume point.
    state = reduceStellarBackfill(state, page.page.nextCursor, records.length);
    counts = addStellarPageCounts(counts, {
      pages: 1,
      transactionsUpserted: rows.length,
      untrackedTransactions: untrackedTx,
      dustTransactions: dust,
    });

    const cursorNow = state.done ? null : state.cursor;
    const txnsTotal = await countCryptoTransactions(walletId);
    await upsertCryptoSyncState(
      buildSyncStateUpsert({
        walletId,
        cursor: cursorNow,
        backfillComplete: state.done,
        syncedAt: NOW(),
        status: state.done ? "idle" : "backfilling",
        errorMessage: null,
        prevCursor,
        transactionsTotal: txnsTotal,
      }),
    );
    prevCursor = cursorNow;
  }

  return { counts, complete: state.done };
}

/**
 * Sync ONE watch-only Stellar wallet: balances + payment history + resumable
 * cursor. Never throws -- returns a friendly result and records an 'error'
 * sync-state on failure.
 */
export async function syncStellarWallet(walletId: string): Promise<StellarWalletSyncResult> {
  const emptyCounts = emptyStellarSyncCounts();

  const wallet = await getCryptoWallet(walletId);
  if (!wallet) {
    return { walletId, address: null, ok: false, message: "Wallet not found.", counts: emptyCounts, error: "not_found" };
  }
  if (wallet.chain !== "stellar") {
    return {
      walletId,
      address: wallet.address,
      ok: false,
      message: "This connector only syncs Stellar (XLM) wallets.",
      counts: emptyCounts,
      error: "wrong_chain",
    };
  }

  const address = wallet.address;
  const existing = await getCryptoSyncState(walletId);
  const savedCursor = existing?.backfillCursor ?? null;

  try {
    // Mark backfilling (keep any existing resume cursor).
    await upsertCryptoSyncState(
      buildSyncStateUpsert({
        walletId,
        cursor: savedCursor,
        backfillComplete: existing?.backfillComplete ?? false,
        syncedAt: NOW(),
        status: "backfilling",
        errorMessage: null,
      }),
    );

    const bal = await syncBalances(walletId, address);
    const hist = await syncHistory(walletId, address, savedCursor);

    const counts = addStellarPageCounts(hist.counts, {
      balancesUpserted: bal.written,
      untrackedBalances: bal.untracked,
    });

    return {
      walletId,
      address,
      ok: true,
      message: summarizeStellarSync(counts),
      counts,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stellar sync failed.";
    await recordError(walletId, savedCursor, msg);
    return {
      walletId,
      address,
      ok: false,
      message: "We couldn't finish syncing this wallet. It will resume where it left off next time.",
      counts: emptyCounts,
      error: msg,
    };
  }
}
