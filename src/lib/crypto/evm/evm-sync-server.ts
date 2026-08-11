import "server-only";

/**
 * src/lib/crypto/evm/evm-sync-server.ts — the SERVER-ONLY EVM sync driver
 * (Slice C6b). It turns the pure sync brain (evm-sync-core) into real network
 * calls (evm-client, C6b) + database writes (crypto-store, C5), and it NEVER
 * throws to the UI: any failure is recorded on the wallet's sync_state (status
 * 'error' + message) and returned as a friendly result, so one bad wallet can't
 * break a page or a scheduled run.
 *
 * Per wallet (EVM chains: ethereum, flare, songbird):
 *   1) Mark the wallet 'backfilling' (keep any existing resume cursor).
 *   2) Fetch the chain tip block (proxy eth_blockNumber) to bound the window.
 *   3) BALANCES — fetch the native coin balance (account/balance) + derive
 *      current ERC-20 token balances from the FULL tokentx history (sum in−out
 *      per contract). Map via C6, build rows via sync-core, upsert to
 *      crypto_balances (idempotent on wallet+asset). Untracked tokens are
 *      surfaced (kept for history), never silently dropped.
 *   4) HISTORY — walk txlist + tokentx oldest→newest by ASCENDING block range
 *      (resuming from the saved cursor, a "nextStartBlock:lastConsumedBlock"
 *      string). Each window: map native txlist legs + ERC-20 tokentx logs via
 *      C6's tax-truth mapper → build unsigned upsert rows (direction carries
 *      the sign) → upsert to crypto_transactions (idempotent on
 *      wallet+hash+event). The FULL source row is stored in each row's `raw`
 *      jsonb for audit provability. Persist the cursor after every window so a
 *      crash/rate-limit resumes cleanly. If a window returns a FULL page, the
 *      state machine narrows the window by half (down to 250 blocks) and
 *      re-requests the same start — no data is skipped.
 *   5) Persist final sync_state: cursor=null + backfill_complete when we walked
 *      to the tip; status back to 'idle'. On error → status 'error' + message,
 *      keeping the resume cursor.
 *
 * SAFETY: watch-only. We use ONLY the wallet's PUBLIC address. No keys exist in
 * this system. The client already throttles + retries against the shared
 * explorers, so this driver stays a polite good citizen. USD value is never
 * written here (priced in a later slice); we never guess a dollar amount.
 */

import {
  getCryptoWallet,
  getCryptoSyncState,
  upsertCryptoBalances,
  upsertCryptoTransactions,
  upsertCryptoSyncState,
} from "../crypto-store";
import {
  fetchNativeBalance,
  fetchTxList,
  fetchTokenTx,
  fetchTipBlockNumber,
  fetchTransactionReceipt,
} from "./evm-client";
import {
  mapNativeTransfer,
  mapErc20TransferLogsWithType,
  normAddr,
  type EvmNativeTransfer,
  type EvmTxContext,
  type EvmLog,
} from "./evm-map-core";
import {
  receiptToEvmLogs,
  uniqueTxHashes,
  txHashesNeedingReceipts,
} from "./evm-receipt-core";
import {
  mapEvmNativeBalance,
  deriveTokenBalancesFromHistory,
  txListRowToNativeTransfer,
  tokenTxRowToEvmLog,
  initEvmBackfill,
  reduceEvmBackfill,
  shouldContinueEvmBackfill,
  currentWindowEnd,
  currentCursorString,
  emptyEvmSyncCounts,
  addEvmWindowCounts,
  summarizeEvmSync,
  buildBalanceUpserts,
  buildTransactionUpserts,
  buildSyncStateUpsert,
  untrackedBalances,
  EVM_DEFAULT_PAGE_SIZE,
  type EvmSyncCounts,
  type BalanceUpsertRow,
  type TransactionUpsertRow,
  type EvmTokenTxRow,
} from "./evm-sync-core";
import { isEvmChain, type Chain } from "../crypto-core";
import {
  createBudgetDeadline,
  timeBudgetExceeded,
  partialContinueSuffix,
  type BudgetDeadline,
} from "./evm-sync-budget-core";

/** Per-wallet sync outcome. Never throws — the error is here as a friendly string. */
export type EvmWalletSyncResult = {
  walletId: string;
  address: string | null;
  ok: boolean;
  message: string;
  counts: EvmSyncCounts;
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
 * Fetch + persist current balances for an EVM wallet. Native coin balance comes
 * from account/balance; ERC-20 token balances are DERIVED from the full tokentx
 * history (the Etherscan-compatible API has no direct "token balance by
 * contract" call, so we sum in−out per contract across all transfer events).
 * Returns the number of balance rows written and how many untracked tokens we
 * surfaced. Throws only on a hard fetch error (caught by the caller).
 */
async function syncEvmBalances(
  walletId: string,
  chain: Chain,
  address: string,
  deadline: BudgetDeadline | null,
): Promise<{ written: number; untracked: number; stoppedForBudget: boolean }> {
  const readAt = NOW();
  const rows: BalanceUpsertRow[] = [];
  let untracked = 0;
  let stoppedForBudget = false;

  // --- Native coin balance (account/balance → wei decimal string) ---
  const native = await fetchNativeBalance(chain, address);
  if (native.ok) {
    const mapped = mapEvmNativeBalance(chain, native.result);
    rows.push(...buildBalanceUpserts(walletId, [mapped], readAt));
  }

  // --- ERC-20 token balances, derived from the full tokentx history ---
  // We fetch the ENTIRE tokentx history (page by page, ascending) to compute
  // current net balances per contract. This is separate from the history
  // backfill (which also persists transaction rows) because the balance
  // derivation needs the complete set, not a windowed subset. We cap at a
  // generous page size and follow Etherscan's page/offset pagination until an
  // empty/partial page is returned.
  //
  // TIME BUDGET: each page is a network round-trip (~220ms apart at the shared
  // rate limit). On Vercel Hobby a serverless function is hard-capped at 60s,
  // so we check the per-request deadline before fetching each new page and stop
  // cleanly when it is exhausted. The balance derivation is best-effort across
  // a single request — a partial page set still yields the balances seen so
  // far, and the NEXT "Sync now" click re-derives from scratch (token balances
  // are always computed fresh, not cursor-resumed, so a partial run is safe).
  let page = 1;
  const allTokenRows: EvmTokenTxRow[] = [];
  for (;;) {
    if (timeBudgetExceeded(Date.now(), deadline)) {
      stoppedForBudget = true;
      break;
    }
    const res = await fetchTokenTx(chain, address, {
      startBlock: 0,
      endBlock: 99999999, // widest range; pagination by page/offset
      page,
      offset: EVM_DEFAULT_PAGE_SIZE,
    });
    if (!res.ok) break; // don't let a token-balance fetch error fail the whole sync
    const rowsPage = res.result;
    if (rowsPage.length === 0) break;
    for (const r of rowsPage) allTokenRows.push(r);
    if (rowsPage.length < EVM_DEFAULT_PAGE_SIZE) break; // partial page = done
    page += 1;
    if (page > 500) break; // guard: don't page forever on a pathological endpoint
  }

  if (allTokenRows.length > 0) {
    const tokenBalances = deriveTokenBalancesFromHistory(chain, address, allTokenRows);
    rows.push(...buildBalanceUpserts(walletId, tokenBalances, readAt));
    untracked = untrackedBalances(tokenBalances).length;
  }

  if (rows.length > 0) {
    const res = await upsertCryptoBalances(rows);
    if (!res.ok) throw new Error(res.error);
    return { written: res.count, untracked, stoppedForBudget };
  }
  return { written: 0, untracked, stoppedForBudget };
}

/**
 * Walk txlist + tokentx by ascending block range, mapping + persisting each
 * window. `savedCursor` is the resumable "nextStartBlock:lastConsumedBlock"
 * string from a prior run (null = start from genesis block 0). `tipBlock` is
 * the current chain tip (from proxy eth_blockNumber). Persists the cursor after
 * each window so a crash resumes cleanly. Returns the running counts and
 * whether the walk completed (reached the tip or the safety guard).
 */
async function syncEvmHistory(
  walletId: string,
  chain: Chain,
  address: string,
  savedCursor: string | null,
  tipBlock: number,
  deadline: BudgetDeadline | null,
): Promise<{ counts: EvmSyncCounts; complete: boolean; stoppedForBudget: boolean }> {
  let counts = emptyEvmSyncCounts();
  let state = initEvmBackfill(savedCursor, tipBlock);
  const account = normAddr(address);
  let stoppedForBudget = false;

  while (shouldContinueEvmBackfill(state)) {
    // TIME BUDGET: each window is 2 explorer API calls (txlist + tokentx) plus
    // mapping + DB upserts. On Vercel Hobby (60s cap) we check the per-request
    // deadline BEFORE starting a new window so the function always has time to
    // finish the current window's DB writes and persist the resume cursor. We
    // break cleanly — the cursor saved after the last completed window is the
    // exact resume point for the next "Sync now" click.
    if (timeBudgetExceeded(Date.now(), deadline)) {
      stoppedForBudget = true;
      break;
    }
    const startBlock = state.cursor.nextStartBlock;
    const endBlock = currentWindowEnd(state);
    const offset = Math.min(EVM_DEFAULT_PAGE_SIZE, state.windowBlocks);

    // Fetch native txlist + ERC-20 tokentx for the SAME block window.
    const [txRes, tokRes] = await Promise.all([
      fetchTxList(chain, address, { startBlock, endBlock, page: 1, offset }),
      fetchTokenTx(chain, address, { startBlock, endBlock, page: 1, offset }),
    ]);

    if (!txRes.ok) {
      throw new Error(`txlist fetch: ${txRes.error}`);
    }
    if (!tokRes.ok) {
      throw new Error(`tokentx fetch: ${tokRes.error}`);
    }

    const txRows = txRes.result;
    const tokenRows = tokRes.result;
    const rows: TransactionUpsertRow[] = [];
    let untrackedTx = 0;

    // --- Native transfers (txlist) → mapNativeTransfer ---
    for (const row of txRows) {
      const t: EvmNativeTransfer = txListRowToNativeTransfer(row);
      const leg = mapNativeTransfer(chain, account, t);
      if (leg == null) continue;
      const built = buildTransactionUpserts(walletId, [leg], row);
      for (const r of built) {
        rows.push(r);
        if (r.asset_id === null) untrackedTx += 1;
      }
    }

    // --- ERC-20 Transfer events (tokentx) → mapErc20TransferLogsWithType ---
    // We group tokentx rows by tx hash so the mapper can attach the native fee
    // exactly once per transaction (to the first sender leg). We synthesize a
    // stable event index per row within its tx.
    const byHash = new Map<string, EvmTokenTxRow[]>();
    for (const row of tokenRows) {
      const list = byHash.get(row.hash);
      if (list) list.push(row);
      else byHash.set(row.hash, [row]);
    }

    // --- C7b: fetch transaction receipts for enriched DeFi classification ---
    // The tokentx rows only contain ERC-20 Transfer events (decoded). To
    // classify LP adds/removes and swaps, the classifier needs the FULL log
    // set for each transaction (pool Mint/Burn/Swap/Sync events that are NOT
    // ERC-20 Transfers). We fetch the receipt (eth_getTransactionReceipt) for
    // each transaction that has token activity — a pure native transfer
    // cannot be a DeFi operation, so we skip those to save API calls.
    //
    // GRACEFUL DEGRADATION: receipt fetching is best-effort. A failed receipt
    // fetch for one transaction never fails the whole window — that tx just
    // gets classified as the neutral "transfer" (the safe, guess-free default).
    // We also respect the time budget: if the budget is exhausted mid-receipt,
    // we stop fetching receipts but still map + persist the tokentx rows we
    // already have (without enriched classification for the remaining txs).
    const receiptLogsByHash = new Map<string, EvmLog[]>();
    if (byHash.size > 0) {
      const allHashes = uniqueTxHashes(
        txRows.map((r) => r.hash).concat(tokenRows.map((r) => r.hash)),
      );
      const tokenHashes = uniqueTxHashes(tokenRows.map((r) => r.hash));
      const hashesNeedingReceipts = txHashesNeedingReceipts(allHashes, tokenHashes);
      for (const hash of hashesNeedingReceipts) {
        if (timeBudgetExceeded(Date.now(), deadline)) {
          stoppedForBudget = true;
          break; // stop fetching receipts; map what we have so far
        }
        try {
          const receiptRes = await fetchTransactionReceipt(chain, hash);
          if (receiptRes.ok && receiptRes.result) {
            const logs = receiptToEvmLogs(receiptRes.result);
            if (logs.length > 0) {
              receiptLogsByHash.set(hash, logs);
            }
          }
          // ok=false or result=null (pending) → no enriched logs for this tx;
          // it will fall back to transfer-only classification below.
        } catch {
          // A receipt fetch failure for one tx is never fatal. The tx is still
          // mapped from its tokentx rows (classified as "transfer").
        }
      }
    }

    for (const [hash, group] of byHash) {
      // Reconstruct the EvmLog shape for each row and build a shared context.
      const first = group[0];
      const blockNumber = Number.parseInt(first.blockNumber, 10);
      const ts = Number.parseInt(first.timeStamp, 10);
      const blockTime = Number.isFinite(ts)
        ? new Date(ts * 1000).toISOString()
        : new Date(0).toISOString();
      const ctx: EvmTxContext = {
        txHash: hash,
        blockNumber: Number.isFinite(blockNumber) ? blockNumber : 0,
        blockTime,
      };
      const transferLogs: EvmLog[] = group.map((row, idx) => tokenTxRowToEvmLog(row, idx));
      // C7b: if we fetched a receipt for this tx, use its FULL log set as
      // allLogs so the classifier can see pool events. Otherwise fall back to
      // just the transfer logs (classification stays "transfer" — safe).
      const allLogs = receiptLogsByHash.get(hash) ?? transferLogs;
      const legs = mapErc20TransferLogsWithType(chain, account, ctx, transferLogs, allLogs);
      // Persist each leg with its source row as the raw envelope.
      for (let i = 0; i < legs.length; i += 1) {
        const sourceRow = group[i] ?? first;
        const built = buildTransactionUpserts(walletId, [legs[i]], sourceRow);
        for (const r of built) {
          rows.push(r);
          if (r.asset_id === null) untrackedTx += 1;
        }
      }
    }

    if (rows.length > 0) {
      const res = await upsertCryptoTransactions(rows);
      if (!res.ok) throw new Error(res.error);
    }

    // Advance the state machine, then persist the cursor as the resume point.
    state = reduceEvmBackfill(state, txRows, tokenRows, offset);
    counts = addEvmWindowCounts(counts, {
      windows: 1,
      transactionsUpserted: rows.length,
      untrackedTransactions: untrackedTx,
    });

    const cursorNow = currentCursorString(state);
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

  return { counts, complete: state.done, stoppedForBudget };
}

/**
 * Sync ONE watch-only EVM wallet: balances + full transaction history +
 * resumable cursor. Never throws — returns a friendly result and records an
 * 'error' sync-state on failure.
 */
export async function syncEvmWallet(walletId: string): Promise<EvmWalletSyncResult> {
  const emptyCounts = emptyEvmSyncCounts();

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
  if (!isEvmChain(wallet.chain as Chain)) {
    return {
      walletId,
      address: wallet.address,
      ok: false,
      message: "This connector only syncs EVM wallets (Ethereum, Flare, Songbird).",
      counts: emptyCounts,
      error: "wrong_chain",
    };
  }

  const chain = wallet.chain as Chain;
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

    // Discover the chain tip to bound the backfill window.
    const tip = await fetchTipBlockNumber(chain);
    if (!tip.ok) {
      throw new Error(`Could not reach the explorer for ${chain}: ${tip.error}`);
    }
    const tipBlock = tip.result;

    // Per-request TIME BUDGET. On Vercel Hobby a serverless function is
    // hard-capped at 60s (verified vercel.com/docs/limits). A full backfill can
    // need hundreds of explorer calls, so one click can never finish a large
    // wallet. We give this request a 45s wall-clock budget (comfortably under
    // the 60s cap, leaving ~15s for the final window's DB writes). When the
    // budget runs out the loops above stop cleanly and persist the resume
    // cursor — the next "Sync now" click continues from exactly there. We
    // append a friendly "click again to continue" suffix when the stop was due
    // to the budget (not because we reached the tip).
    const deadline = createBudgetDeadline(Date.now());
    const bal = await syncEvmBalances(walletId, chain, address, deadline);
    const hist = await syncEvmHistory(
      walletId,
      chain,
      address,
      savedCursor,
      tipBlock,
      deadline,
    );

    const counts = addEvmWindowCounts(hist.counts, {
      balancesUpserted: bal.written,
      untrackedBalances: bal.untracked,
    });

    const stoppedForBudget = bal.stoppedForBudget || hist.stoppedForBudget;
    const suffix = partialContinueSuffix(hist.complete, stoppedForBudget);

    return {
      walletId,
      address,
      ok: true,
      message: summarizeEvmSync(counts) + suffix,
      counts,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "EVM sync failed.";
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
