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
  countCryptoTransactions,
  ensureCryptoAssets,
} from "../crypto-store";
import {
  fetchNativeBalance,
  fetchTxList,
  fetchTokenTx,
  fetchTipBlockNumber,
  fetchTransactionReceipt,
  fetchTokenList,
  fetchTokenMeta,
  fetchTokenDecimalsOnChain,
} from "./evm-client";
import {
  discoverFromTokenList,
  tokensNeedingDecimals,
  applyResolvedDecimals,
  fungibleTokens,
  buildDiscoveredAssetUpserts,
  buildDiscoveredBalanceUpserts,
  type DiscoveredToken,
} from "./evm-token-discovery-core";
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
  txListRowToNativeTransfer,
  tokenTxRowToEvmLog,
  emptyEvmSyncCounts,
  addEvmWindowCounts,
  summarizeEvmSync,
  buildBalanceUpserts,
  buildTransactionUpserts,
  buildSyncStateUpsert,
  type EvmSyncCounts,
  type BalanceUpsertRow,
  type TransactionUpsertRow,
  type EvmTxListRow,
  type EvmTokenTxRow,
} from "./evm-sync-core";
import {
  EVM_HISTORY_PAGE_SIZE,
  parseEvmHistoryCursor,
  serializeEvmHistoryCursor,
  isEvmHistoryComplete,
  nextEvmStream,
  pageForStream,
  advanceEvmStream,
} from "./evm-history-pagination-core";
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
): Promise<{ written: number; untracked: number; stoppedForBudget: boolean; discoveredAssets: number }> {
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

  // --- ALL token balances via explorer token-discovery (AREA 3) ---
  // The `tokenlist` endpoint returns EVERY token the address currently holds,
  // with the live balance per token — including alt coins we never hand-listed.
  // We discover them, keep only fungible ERC-20s, verify each token's decimals
  // from a first-party source (list → getToken → on-chain eth_call — never a
  // guess), register the verified ones as assets, then persist their balances.
  // Scam ERC-721/ERC-1155 airdrops are classified non-fungible and can never
  // become a balance. This replaces the old tokentx history-summation for the
  // balance snapshot (the live list balance is authoritative and one call).
  let discoveredAssets = 0;
  if (!timeBudgetExceeded(Date.now(), deadline)) {
    const listRes = await fetchTokenList(chain, address);
    if (listRes.ok && listRes.result.length > 0) {
      let tokens = discoverFromTokenList(chain, { result: listRes.result });

      // Resolve decimals ONLY for the fungible ERC-20s whose list-decimals were
      // blank — one polite pair of calls each (on-chain eth_call preferred),
      // stopping cleanly if the time budget runs out (best-effort; the next
      // "Sync now" re-runs discovery, so nothing is lost).
      const needing = tokensNeedingDecimals(tokens);
      if (needing.length > 0) {
        const promoted = new Map<string, DiscoveredToken>();
        for (const t of needing) {
          if (timeBudgetExceeded(Date.now(), deadline)) {
            stoppedForBudget = true;
            break;
          }
          const callRes = await fetchTokenDecimalsOnChain(chain, t.contract);
          const ethCallHex = callRes.ok ? callRes.result : null;
          let getToken = null;
          if (ethCallHex === null) {
            const metaRes = await fetchTokenMeta(chain, t.contract);
            getToken = metaRes.ok ? metaRes.result : null;
          }
          promoted.set(t.contract, applyResolvedDecimals(t, { ethCallHex, getToken }));
        }
        tokens = tokens.map((t) => promoted.get(t.contract) ?? t);
      }

      const fungible = fungibleTokens(tokens);
      // Count fungible tokens we could NOT verify (left unregistered, no balance).
      untracked = tokens.filter((t) => t.kind === "erc20" && t.decimals === null).length;

      if (fungible.length > 0) {
        // Register the verified assets FIRST (balances FK to crypto_assets).
        const assetRows = buildDiscoveredAssetUpserts(fungible);
        const assetRes = await ensureCryptoAssets(assetRows);
        if (!assetRes.ok) throw new Error(assetRes.error);
        discoveredAssets = assetRes.count;
        // Then their live balances from the list (never guessed; USD null).
        rows.push(...buildDiscoveredBalanceUpserts(walletId, fungible, readAt));
      }
    }
  } else {
    stoppedForBudget = true;
  }

  if (rows.length > 0) {
    const res = await upsertCryptoBalances(rows);
    if (!res.ok) throw new Error(res.error);
    return { written: res.count, untracked, stoppedForBudget, discoveredAssets };
  }
  return { written: 0, untracked, stoppedForBudget, discoveredAssets };
}

/**
 * Map ONE page of native `txlist` rows into transaction upsert rows.
 * Pulled out so both the (fast) account-pagination walk uses one code path.
 */
function mapNativeRows(
  walletId: string,
  chain: Chain,
  account: string,
  txRows: readonly EvmTxListRow[],
): { rows: TransactionUpsertRow[]; untracked: number } {
  const rows: TransactionUpsertRow[] = [];
  let untracked = 0;
  for (const row of txRows) {
    const t: EvmNativeTransfer = txListRowToNativeTransfer(row);
    const leg = mapNativeTransfer(chain, account, t);
    if (leg == null) continue;
    const built = buildTransactionUpserts(walletId, [leg], row);
    for (const r of built) {
      rows.push(r);
      if (r.asset_id === null) untracked += 1;
    }
  }
  return { rows, untracked };
}

/**
 * Map ONE page of ERC-20 `tokentx` rows into transaction upsert rows, fetching
 * receipts for enriched DeFi classification (best-effort, budget-aware). This
 * is the exact same mapping the previous window walk used — only the driving
 * loop changed (account pagination instead of block windows).
 */
async function mapTokenRows(
  walletId: string,
  chain: Chain,
  account: string,
  tokenRows: readonly EvmTokenTxRow[],
  deadline: BudgetDeadline | null,
): Promise<{ rows: TransactionUpsertRow[]; untracked: number; stoppedForBudget: boolean }> {
  const rows: TransactionUpsertRow[] = [];
  let untracked = 0;
  let stoppedForBudget = false;

  // Group tokentx rows by tx hash so the mapper can attach the native fee
  // exactly once per transaction (to the first sender leg).
  const byHash = new Map<string, EvmTokenTxRow[]>();
  for (const row of tokenRows) {
    const list = byHash.get(row.hash);
    if (list) list.push(row);
    else byHash.set(row.hash, [row]);
  }

  // Fetch receipts for enriched DeFi classification (LP add/remove, swaps). A
  // failed receipt fetch for one tx is never fatal — it falls back to the
  // neutral "transfer" classification. Budget-aware: stop fetching receipts
  // (but still map what we have) if the per-request time budget runs out.
  const receiptLogsByHash = new Map<string, EvmLog[]>();
  if (byHash.size > 0) {
    const tokenHashes = uniqueTxHashes(tokenRows.map((r) => r.hash));
    const hashesNeedingReceipts = txHashesNeedingReceipts(tokenHashes, tokenHashes);
    for (const hash of hashesNeedingReceipts) {
      if (timeBudgetExceeded(Date.now(), deadline)) {
        stoppedForBudget = true;
        break;
      }
      try {
        const receiptRes = await fetchTransactionReceipt(chain, hash);
        if (receiptRes.ok && receiptRes.result) {
          const logs = receiptToEvmLogs(receiptRes.result);
          if (logs.length > 0) receiptLogsByHash.set(hash, logs);
        }
      } catch {
        // Never fatal — the tx still maps to a neutral "transfer".
      }
    }
  }

  for (const [hash, group] of byHash) {
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
    const allLogs = receiptLogsByHash.get(hash) ?? transferLogs;
    const legs = mapErc20TransferLogsWithType(chain, account, ctx, transferLogs, allLogs);
    for (let i = 0; i < legs.length; i += 1) {
      const sourceRow = group[i] ?? first;
      const built = buildTransactionUpserts(walletId, [legs[i]], sourceRow);
      for (const r of built) {
        rows.push(r);
        if (r.asset_id === null) untracked += 1;
      }
    }
  }

  return { rows, untracked, stoppedForBudget };
}

/**
 * FAST EVM history walk — pages the ACCOUNT'S OWN transaction list, exactly like
 * XRP (account_tx marker) and Coreum (next_key) do, instead of scanning the
 * chain genesis→tip in block windows. Two ascending streams (native `txlist`
 * and ERC-20 `tokentx`) are each requested over the FULL block range with a
 * large page size (EVM_HISTORY_PAGE_SIZE), advancing page-by-page until a SHORT
 * page proves the stream is exhausted (evm-history-pagination-core). A wallet
 * with a few hundred lifetime transactions now finishes in one or two calls
 * instead of thousands — which also means far fewer chances for a transient
 * explorer hiccup to interrupt a sync.
 *
 * `savedCursor` resumes a prior run. A NULL cursor or a LEGACY block-window
 * cursor ("12345:12300") both cleanly start a fresh page-1 account walk (the
 * pagination core parses defensively and never crashes on an old cursor).
 * `tipBlock` is passed only so the honest progress readout can show the tip; it
 * no longer bounds the walk. The 45s time budget + resume cursor are preserved:
 * we check the budget before each page and stop cleanly, persisting the exact
 * resume point so the next "Sync now" click continues.
 *
 * TRANSIENT-FAILURE POLICY (self-healing): if a page fetch fails, we DO NOT hard
 * fail the whole wallet. We persist the resume cursor and status "backfilling"
 * and return `stoppedForBudget` so the caller reports a friendly "continue"
 * message. The wallet stays healthy and simply resumes on the next sync — a
 * single explorer blip can no longer flip a wallet to "needs attention".
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
  const account = normAddr(address);
  let cursor = parseEvmHistoryCursor(savedCursor);
  let stoppedForBudget = false;
  // The full block range — the explorer returns only THIS address's txs, so we
  // never scan empty blocks. 0..MAX means "all history". (99999999 comfortably
  // exceeds every supported chain's height for the foreseeable future.)
  const START_BLOCK = 0;
  const END_BLOCK = 99999999;
  // Progress facts. `target` = chain-tip block (text) so the Health tab can show
  // the tip; the honest EVM progress readout now counts transactions rather than
  // faking a percent from a moving tip. `prevCursor` powers stuck detection.
  const target = tipBlock > 0 ? String(tipBlock) : null;
  let prevCursor = savedCursor;

  while (!isEvmHistoryComplete(cursor)) {
    // TIME BUDGET (unchanged): stop cleanly before Vercel's 60s Hobby cap so DB
    // writes + the resume cursor always persist. Next click continues.
    if (timeBudgetExceeded(Date.now(), deadline)) {
      stoppedForBudget = true;
      break;
    }
    const stream = nextEvmStream(cursor);
    if (stream === null) break;
    const page = pageForStream(cursor, stream);

    // Fetch ONE page of ONE stream over the full range with a large offset.
    let rowsReturned = 0;
    let mapped: { rows: TransactionUpsertRow[]; untracked: number } = { rows: [], untracked: 0 };

    if (stream === "tx") {
      const txRes = await fetchTxList(chain, address, {
        startBlock: START_BLOCK,
        endBlock: END_BLOCK,
        page,
        offset: EVM_HISTORY_PAGE_SIZE,
      });
      if (!txRes.ok) {
        // SELF-HEALING: a transient failure stops this run gracefully and
        // resumes next time — it never flips the wallet to "needs attention".
        stoppedForBudget = true;
        break;
      }
      rowsReturned = txRes.result.length;
      mapped = mapNativeRows(walletId, chain, account, txRes.result);
    } else {
      const tokRes = await fetchTokenTx(chain, address, {
        startBlock: START_BLOCK,
        endBlock: END_BLOCK,
        page,
        offset: EVM_HISTORY_PAGE_SIZE,
      });
      if (!tokRes.ok) {
        stoppedForBudget = true;
        break;
      }
      rowsReturned = tokRes.result.length;
      const tokMapped = await mapTokenRows(walletId, chain, account, tokRes.result, deadline);
      mapped = { rows: tokMapped.rows, untracked: tokMapped.untracked };
      if (tokMapped.stoppedForBudget) stoppedForBudget = true;
    }

    if (mapped.rows.length > 0) {
      const res = await upsertCryptoTransactions(mapped.rows);
      if (!res.ok) {
        // A DB write failure is also treated as a soft stop: persist the
        // current (un-advanced) cursor and resume next run. No hard error.
        stoppedForBudget = true;
        break;
      }
    }

    // Advance THIS stream's page (short page → stream done), then persist.
    cursor = advanceEvmStream(cursor, stream, rowsReturned, EVM_HISTORY_PAGE_SIZE);
    counts = addEvmWindowCounts(counts, {
      windows: 1,
      transactionsUpserted: mapped.rows.length,
      untrackedTransactions: mapped.untracked,
    });

    const cursorNow = serializeEvmHistoryCursor(cursor);
    const txnsTotal = await countCryptoTransactions(walletId);
    await upsertCryptoSyncState(
      buildSyncStateUpsert({
        walletId,
        cursor: cursorNow,
        backfillComplete: isEvmHistoryComplete(cursor),
        syncedAt: NOW(),
        status: isEvmHistoryComplete(cursor) ? "idle" : "backfilling",
        errorMessage: null,
        target,
        prevCursor,
        transactionsTotal: txnsTotal,
      }),
    );
    prevCursor = cursorNow;

    // If a mid-page receipt fetch exhausted the budget, stop after persisting.
    if (stoppedForBudget) break;
  }

  return { counts, complete: isEvmHistoryComplete(cursor), stoppedForBudget };
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
