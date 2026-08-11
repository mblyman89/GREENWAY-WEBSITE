import "server-only";

/**
 * src/lib/crypto/coreum/coreum-sync-server.ts — the SERVER-ONLY Coreum sync
 * driver (Slice C8b). It turns the pure sync brain (coreum-sync-core) into real
 * network calls (coreum-client, C8b) + database writes (crypto-store), and it
 * NEVER throws to the UI: any failure is recorded on the wallet's sync_state
 * (status 'error' + message) and returned as a friendly result, so one bad
 * wallet can't break a page or a scheduled run.
 *
 * Per wallet (Coreum / Cosmos only):
 *   1) Mark the wallet 'backfilling'.
 *   2) BALANCES — fetch ALL balances (bank module, pagination-merged by the
 *      client). Map via coreum-map-core, build rows via sync-core, upsert to
 *      crypto_balances (idempotent on wallet+asset). Untracked tokens are
 *      surfaced (kept for history), never silently dropped.
 *   3) HISTORY — walk BOTH tx-search streams (sender + recipient) by opaque
 *      pagination next_key (resuming from the saved two-stream cursor). Each
 *      page: zip tx_responses with txs → check for cross-stream duplicates →
 *      map non-duplicate txs via coreum-map-core's tax-truth mapper → build
 *      unsigned upsert rows (direction carries the sign) → upsert to
 *      crypto_transactions (idempotent on wallet+hash+event). The FULL source
 *      envelope is stored in each row's `raw` jsonb for audit provability.
 *      Persist the cursor after each page so a crash/rate-limit resumes cleanly.
 *      The sender stream is walked to completion first, then the recipient
 *      stream (so the dedup set grows monotonically).
 *   4) Persist final sync_state: cursor=null + backfill_complete when both
 *      streams finished; status back to 'idle'. On error → status 'error' +
 *      message, keeping the resume cursor.
 *
 * SAFETY: watch-only. We use ONLY the wallet's PUBLIC address. No keys exist in
 * this system. The client already throttles + retries against the public LCD,
 * with failover to a backup provider, so this driver stays a polite good
 * citizen. USD value is never written here (priced in a later slice); we never
 * guess a dollar amount.
 */

import {
  getCryptoWallet,
  upsertCryptoBalances,
  upsertCryptoTransactions,
  upsertCryptoSyncState,
  getCryptoSyncState,
  countCryptoTransactions,
} from "../crypto-store";
import { fetchBalances, fetchTxsBySenderPage, fetchTxsByRecipientPage } from "./coreum-client";
import {
  mapBalances,
  filterNonZeroBalances,
  mapCosmosTx,
} from "./coreum-map-core";
import {
  extractNextKey,
  extractTxResponses,
  extractTxs,
  type CosmosBalanceEntry,
  type CosmosTxResponse,
  type CosmosTx,
  type CosmosTxsResponse,
} from "./coreum-client-core";
import {
  buildBalanceUpserts,
  untrackedBalances,
  buildTransactionUpserts,
  initCoreumBackfill,
  reduceCoreumStream,
  shouldContinueBackfill,
  nextStream,
  isDuplicateHash,
  serializeCursor,
  deserializeCursor,
  buildSyncStateUpsert,
  emptyCoreumSyncCounts,
  addCoreumPageCounts,
  summarizeCoreumSync,
  type TransactionUpsertRow,
  type CoreumSyncCounts,
  type CoreumStreamId,
  type CoreumBackfillState,
} from "./coreum-sync-core";

/** Per-wallet sync outcome. Never throws — the error is here as a friendly string. */
export type CoreumWalletSyncResult = {
  walletId: string;
  address: string | null;
  ok: boolean;
  message: string;
  counts: CoreumSyncCounts;
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
 * Fetch + persist current balances for a Coreum wallet. Returns the number of
 * balance rows written and how many held tokens we don't yet model (surfaced,
 * never dropped). Throws only on a hard fetch error (caught by the caller).
 */
async function syncBalances(
  walletId: string,
  address: string,
): Promise<{ written: number; untracked: number }> {
  const readAt = NOW();

  const result = await fetchBalances(address);
  if (!result.ok) throw new Error(result.error);

  const entries: CosmosBalanceEntry[] = result.result;
  const mapped = mapBalances(entries);
  const nonZero = filterNonZeroBalances(mapped);
  const rows = buildBalanceUpserts(walletId, nonZero, readAt);
  const untracked = untrackedBalances(nonZero).length;

  if (rows.length > 0) {
    const res = await upsertCryptoBalances(rows);
    if (!res.ok) throw new Error(res.error);
    return { written: res.count, untracked };
  }
  return { written: 0, untracked };
}

/**
 * Fetch ONE page from a stream and return the tx_responses, txs, and next_key.
 * The server layer handles the two-stream walk + dedup; this helper just
 * performs the fetch + extraction for one stream + pagination key.
 */
async function fetchStreamPage(
  stream: CoreumStreamId,
  address: string,
  paginationKey: string | null,
): Promise<{
  txResponses: CosmosTxResponse[];
  txs: CosmosTx[];
  nextKey: string | null;
} | { error: string }> {
  const page =
    stream === "sender"
      ? await fetchTxsBySenderPage(address, paginationKey)
      : await fetchTxsByRecipientPage(address, paginationKey);

  if (!page.ok) return { error: page.error };

  const body = page.result as CosmosTxsResponse;
  const txResponses = extractTxResponses(body);
  const txs = extractTxs(body);
  const nextKey = extractNextKey(body);

  return { txResponses, txs, nextKey };
}

/**
 * Walk BOTH tx-search streams (sender then recipient), mapping + persisting
 * each page. `savedCursor` is the resumable two-stream cursor from a prior run.
 * Persists the cursor after each page so a crash resumes cleanly. Returns the
 * running counts and whether the walk completed.
 */
async function syncHistory(
  walletId: string,
  address: string,
  savedCursor: string | null,
  savedBackfillComplete: boolean,
): Promise<{ counts: CoreumSyncCounts; complete: boolean }> {
  let counts = emptyCoreumSyncCounts();

  // If the prior run completed the backfill, there's nothing to do.
  if (savedBackfillComplete) {
    return { counts, complete: true };
  }

  // Progress fact: the cursor BEFORE this run, for stuck detection. Coreum has
  // no numeric target (opaque next_key) → no percent on the Health tab.
  let prevCursor = savedCursor;

  // Deserialize the two-stream cursor.
  const { senderKey, recipientKey } = deserializeCursor(savedCursor);
  // If a stream's key is null AND we had a prior cursor (not a fresh start),
  // that stream was already exhausted in a prior run — mark it done.
  const hadPriorCursor = savedCursor !== null && savedCursor.trim() !== "";
  const senderDone = hadPriorCursor && senderKey === null;
  const recipientDone = hadPriorCursor && recipientKey === null;

  let state: CoreumBackfillState = initCoreumBackfill(
    senderKey,
    recipientKey,
    senderDone,
    recipientDone,
  );

  while (shouldContinueBackfill(state)) {
    const stream = nextStream(state);
    if (stream === null) break;

    const cursor = state[stream];
    const pageResult = await fetchStreamPage(stream, address, cursor.nextKey);

    if ("error" in pageResult) {
      throw new Error(pageResult.error);
    }

    const { txResponses, txs, nextKey } = pageResult;

    // Zip tx_responses with txs (parallel arrays, same index = same tx).
    // Check for cross-stream duplicates before mapping.
    const rows: TransactionUpsertRow[] = [];
    let duplicatesSkipped = 0;
    const pageHashes: string[] = [];

    for (let i = 0; i < txResponses.length; i += 1) {
      const txResp = txResponses[i];
      const tx = txs[i] ?? ({} as CosmosTx); // txs may be shorter in rare cases
      const hash = txResp.txhash ?? "";
      if (hash.length > 0) pageHashes.push(hash);

      // Skip duplicates (tx returned by both sender and recipient queries).
      if (hash.length > 0 && isDuplicateHash(state, hash)) {
        duplicatesSkipped += 1;
        continue;
      }

      const legs = mapCosmosTx(address, txResp, tx);
      const built = buildTransactionUpserts(walletId, legs, txResp);
      for (const row of built) {
        rows.push(row);
      }
    }

    if (rows.length > 0) {
      const res = await upsertCryptoTransactions(rows);
      if (!res.ok) throw new Error(res.error);
    }

    // Advance the state machine (adds page hashes to dedup set + moves cursor).
    state = reduceCoreumStream(state, stream, nextKey, pageHashes);
    counts = addCoreumPageCounts(counts, {
      pages: 1,
      transactionsUpserted: rows.length,
      duplicatesSkipped,
    });

    // Persist the cursor after each page so a crash resumes cleanly.
    const cursorNow = serializeCursor(state);
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
 * Sync ONE watch-only Coreum wallet: balances + full transaction history +
 * resumable two-stream cursor. Never throws — returns a friendly result and
 * records an 'error' sync-state on failure.
 */
export async function syncCoreumWallet(walletId: string): Promise<CoreumWalletSyncResult> {
  const emptyCounts = emptyCoreumSyncCounts();

  const wallet = await getCryptoWallet(walletId);
  if (!wallet) {
    return {
      walletId,
      address: null,
      ok: false,
      message: "Wallet not found.",
      counts: emptyCounts,
      error: "not_found",
    };
  }
  if (wallet.chain !== "coreum") {
    return {
      walletId,
      address: wallet.address,
      ok: false,
      message: "This connector only syncs Coreum (Cosmos) wallets.",
      counts: emptyCounts,
      error: "wrong_chain",
    };
  }

  const address = wallet.address;
  const existing = await getCryptoSyncState(walletId);
  const savedCursor = existing?.backfillCursor ?? null;
  const savedComplete = existing?.backfillComplete ?? false;

  try {
    // Mark backfilling (keep any existing resume cursor).
    await upsertCryptoSyncState(
      buildSyncStateUpsert({
        walletId,
        cursor: savedCursor,
        backfillComplete: savedComplete,
        syncedAt: NOW(),
        status: "backfilling",
        errorMessage: null,
      }),
    );

    const bal = await syncBalances(walletId, address);
    const hist = await syncHistory(walletId, address, savedCursor, savedComplete);

    const counts = addCoreumPageCounts(hist.counts, {
      balancesUpserted: bal.written,
      untrackedBalances: bal.untracked,
    });

    return {
      walletId,
      address,
      ok: true,
      message: summarizeCoreumSync(counts),
      counts,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Coreum sync failed.";
    await recordError(walletId, savedCursor, msg);
    return {
      walletId,
      address,
      ok: false,
      message:
        "We couldn't finish syncing this wallet. It will resume where it left off next time.",
      counts: emptyCounts,
      error: msg,
    };
  }
}
