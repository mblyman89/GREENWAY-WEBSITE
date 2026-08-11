import "server-only";

/**
 * src/lib/crypto/xrpl/xrpl-sync-server.ts — the SERVER-ONLY XRPL sync driver
 * (Slice C5). It turns the pure sync brain (xrpl-sync-core) into real network
 * calls (xrpl-client, C4) + database writes (crypto-store, C5), and it NEVER
 * throws to the UI: any failure is recorded on the wallet's sync_state (status
 * 'error' + message) and returned as a friendly result, so one bad wallet can't
 * break a page or a scheduled run.
 *
 * Per wallet (XRPL only):
 *   1) Mark the wallet 'backfilling'.
 *   2) BALANCES — account_info (native XRP) + account_lines (issued tokens,
 *      marker-merged by the client). Map via C4, build rows via sync-core,
 *      upsert to crypto_balances (idempotent on wallet+asset). Untracked tokens
 *      are surfaced (kept for history), never silently dropped.
 *   3) HISTORY — walk account_tx oldest→newest by opaque `marker` (resuming from
 *      the saved cursor). Each page: map every tx via C4's tax-truth mapper →
 *      build unsigned upsert rows (direction carries the sign) → upsert to
 *      crypto_transactions (idempotent on wallet+hash+event). The FULL source
 *      envelope is stored in each row's `raw` jsonb for audit provability.
 *      Persist the marker after each page so a crash/rate-limit resumes cleanly.
 *   4) Persist final sync_state: cursor=null + backfill_complete when we walked
 *      to the end; status back to 'idle'. On error → status 'error' + message,
 *      keeping the resume cursor.
 *
 * SAFETY: watch-only. We use ONLY the wallet's PUBLIC address. No keys exist in
 * this system. The client already throttles + retries against the public
 * cluster, so this driver stays a polite good citizen. USD value is never
 * written here (priced in a later slice); we never guess a dollar amount.
 */

import { getCryptoWallet, upsertCryptoBalances, upsertCryptoTransactions, upsertCryptoSyncState, getCryptoSyncState } from "../crypto-store";
import { fetchAccountInfo, fetchAccountLines, fetchAccountTxPage } from "./xrpl-client";
import {
  mapAccountInfoBalance,
  mapTrustLineBalances,
  mapAccountTx,
  type XrplAccountData,
  type XrplTrustLine,
  type XrplTxEnvelope,
} from "./xrpl-map-core";
import {
  buildBalanceUpserts,
  untrackedBalances,
  buildTransactionUpserts,
  initXrplBackfill,
  reduceXrplBackfill,
  shouldContinueBackfill,
  serializeMarker,
  deserializeMarker,
  buildSyncStateUpsert,
  emptyXrplSyncCounts,
  addXrplPageCounts,
  summarizeXrplSync,
  type BalanceUpsertRow,
  type TransactionUpsertRow,
  type XrplSyncCounts,
} from "./xrpl-sync-core";

/** Per-wallet sync outcome. Never throws — the error is here as a friendly string. */
export type XrplWalletSyncResult = {
  walletId: string;
  address: string | null;
  ok: boolean;
  message: string;
  counts: XrplSyncCounts;
  error?: string | null;
};

const NOW = (): string => new Date().toISOString();

/** Record an error sync-state without throwing (best-effort). */
async function recordError(
  walletId: string,
  cursor: string | null,
  message: string,
): Promise<void> {
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
 * Fetch + persist current balances for an XRPL wallet. Returns the number of
 * balance rows written and how many held tokens we don't yet model (surfaced,
 * never dropped). Throws only on a hard fetch error (caught by the caller).
 */
async function syncBalances(
  walletId: string,
  address: string,
): Promise<{ written: number; untracked: number }> {
  const readAt = NOW();
  const rows: BalanceUpsertRow[] = [];
  let untracked = 0;

  // Native XRP (account_info). A brand-new/unfunded account may not exist yet;
  // that's not an error — it simply has no XRP balance to record.
  const info = await fetchAccountInfo(address);
  if (info.ok) {
    const accountData = (info.result as { account_data?: XrplAccountData }).account_data;
    if (accountData) {
      const xrp = mapAccountInfoBalance(accountData);
      rows.push(...buildBalanceUpserts(walletId, [xrp], readAt));
    }
  }

  // Issued tokens (account_lines, marker-merged by the client).
  const lines = await fetchAccountLines(address);
  if (lines.ok) {
    const trustLines = (lines.result as { lines?: XrplTrustLine[] }).lines ?? [];
    const mapped = mapTrustLineBalances(trustLines);
    rows.push(...buildBalanceUpserts(walletId, mapped, readAt));
    untracked = untrackedBalances(mapped).length;
  }

  if (rows.length > 0) {
    const res = await upsertCryptoBalances(rows);
    if (!res.ok) throw new Error(res.error);
    return { written: res.count, untracked };
  }
  return { written: 0, untracked };
}

/**
 * Walk account_tx by marker, mapping + persisting each page. `savedCursor` is
 * the resumable marker from a prior run (null = start from the widest range).
 * Persists the marker after each page so a crash resumes cleanly. Returns the
 * running counts and whether the walk completed.
 */
async function syncHistory(
  walletId: string,
  address: string,
  savedCursor: string | null,
): Promise<{ counts: XrplSyncCounts; complete: boolean }> {
  let counts = emptyXrplSyncCounts();
  let state = initXrplBackfill(deserializeMarker(savedCursor));

  while (shouldContinueBackfill(state)) {
    const page = await fetchAccountTxPage(address, {
      marker: state.marker,
      forward: true, // oldest-first → a stable, resumable backfill
    });
    if (!page.ok) {
      // Surface the error but keep the cursor we were about to use, so the next
      // run resumes from here instead of restarting the whole history.
      throw new Error(page.error);
    }

    const result = page.result as {
      transactions?: XrplTxEnvelope[];
      marker?: unknown;
    };
    const envelopes = result.transactions ?? [];

    const rows: TransactionUpsertRow[] = [];
    let untrackedTx = 0;
    for (const env of envelopes) {
      const legs = mapAccountTx(address, env);
      const built = buildTransactionUpserts(walletId, legs, env);
      for (const row of built) {
        rows.push(row);
        if (row.asset_id === null) untrackedTx += 1;
      }
    }

    if (rows.length > 0) {
      const res = await upsertCryptoTransactions(rows);
      if (!res.ok) throw new Error(res.error);
    }

    // Advance the state machine, then persist the marker as the resume cursor.
    state = reduceXrplBackfill(state, result.marker);
    counts = addXrplPageCounts(counts, {
      pages: 1,
      transactionsUpserted: rows.length,
      untrackedTransactions: untrackedTx,
    });

    const cursorNow = state.done ? null : serializeMarker(state.marker);
    await upsertCryptoSyncState(
      buildSyncStateUpsert({
        walletId,
        cursor: cursorNow,
        backfillComplete: state.done,
        syncedAt: NOW(),
        status: state.done ? "idle" : "backfilling",
        errorMessage: null,
      }),
    );
  }

  return { counts, complete: state.done };
}

/**
 * Sync ONE watch-only XRPL wallet: balances + full transaction history +
 * resumable cursor. Never throws — returns a friendly result and records an
 * 'error' sync-state on failure.
 */
export async function syncXrplWallet(walletId: string): Promise<XrplWalletSyncResult> {
  const emptyCounts = emptyXrplSyncCounts();

  const wallet = await getCryptoWallet(walletId);
  if (!wallet) {
    return { walletId, address: null, ok: false, message: "Wallet not found.", counts: emptyCounts, error: "not_found" };
  }
  if (wallet.chain !== "xrpl") {
    return {
      walletId,
      address: wallet.address,
      ok: false,
      message: "This connector only syncs XRP Ledger wallets.",
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

    const counts = addXrplPageCounts(hist.counts, {
      balancesUpserted: bal.written,
      untrackedBalances: bal.untracked,
    });

    return {
      walletId,
      address,
      ok: true,
      message: summarizeXrplSync(counts),
      counts,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "XRPL sync failed.";
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
