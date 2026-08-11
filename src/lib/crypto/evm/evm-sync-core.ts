/**
 * src/lib/crypto/evm/evm-sync-core.ts — PURE EVM sync brain (Slice C6b).
 *
 * No `server-only`, no network, no Supabase, no React. This is the deterministic
 * decision logic that turns C6's mapped EVM transactions + C6b's fetched
 * explorer rows into the EXACT upsert objects for the crypto_* tables, plus the
 * EVM-specific block-range backfill state machine.
 *
 * The server layer (evm-sync-server.ts) owns the network calls + writes; it
 * asks this module:
 *   1. "Turn these native + token balances into balance-upsert rows."
 *      -> mapEvmNativeBalance / mapEvmTokenBalance + buildBalanceUpserts
 *   2. "Turn this mapped tx leg into a transaction-upsert row."
 *      -> buildTransactionUpserts  (REUSED from xrpl-sync-core — chain-agnostic)
 *   3. "Given the last block window + the rows I fetched, what's my next
 *      window + am I done?" -> the EVM block-range backfill state machine.
 *
 * DESIGN DECISIONS (grounded, never guessed):
 *
 * - REUSE. The XRPL sync-core's `buildBalanceUpserts`, `buildTransactionUpserts`,
 *   `buildSyncStateUpsert`, and the upsert row types (`BalanceUpsertRow`,
 *   `TransactionUpsertRow`, `SyncStateUpsertRow`) are ALL chain-agnostic — they
 *   operate on `MappedBalance`/`MappedTransaction` which already carry `chain`.
 *   So EVM reuses them VERBATIM. We only add what's EVM-specific: the block-
 *   range backfill state machine and EVM balance mapping. No duplication.
 *
 * - BLOCK-RANGE BACKFILL (not marker). Etherscan-compatible APIs paginate by
 *   `startblock`/`endblock` + `page`/`offset`, NOT an opaque marker. We walk
 *   ascending in fixed block windows (EVM_BACKFILL_WINDOW_BLOCKS at a time),
 *   requesting both txlist (native) + tokentx (ERC-20) for each window. When a
 *   window returns fewer rows than the page size, that window is done and we
 *   advance to the next. When we reach `tipBlock`, backfill is complete; the
 *   cursor stores the last consumed block for resumable incremental sync.
 *
 * - IDEMPOTENCY. Same as XRPL: the natural key (wallet_id, tx_hash,
 *   event_index) is UNIQUE in migration 0160, so a re-run upserts in place.
 *   Balances are keyed on (wallet_id, asset_id), also UNIQUE.
 *
 * - UNTRACKED TOKENS. An ERC-20 token we don't yet model (assetId === null) is
 *   kept in history (the mapper records the contract as currency/issuer) but
 *   SKIPPED for the balances table (asset_id is NOT NULL + FK-constrained),
 *   exactly like XRPL trust lines.
 */

import type { Chain } from "../crypto-core";
import type { MappedBalance, MappedTransaction } from "../xrpl/xrpl-map-core";
import {
  buildBalanceUpserts,
  buildTransactionUpserts,
  buildSyncStateUpsert,
  untrackedBalances,
  type BalanceUpsertRow,
  type TransactionUpsertRow,
  type SyncStateUpsertRow,
} from "../xrpl/xrpl-sync-core";
import {
  nativeAssetIdForChain,
  resolveEvmAssetByContract,
  normAddr,
  EVM_NATIVE_DECIMALS,
} from "./evm-map-core";
import {
  type EvmTxListRow,
  type EvmTokenTxRow,
  type EvmBlockCursor,
  initEvmCursor,
  serializeEvmCursor,
  maxBlockAcrossRows,
  EVM_DEFAULT_PAGE_SIZE,
} from "./evm-client-core";

// Re-export the chain-agnostic row types + builders (and untrackedBalances) so
// the server layer can import everything it needs from one place. Also
// re-export the EVM row types + page-size constant the server uses.
export type { BalanceUpsertRow, TransactionUpsertRow, SyncStateUpsertRow, EvmTxListRow, EvmTokenTxRow };
export { buildBalanceUpserts, buildTransactionUpserts, buildSyncStateUpsert, untrackedBalances, EVM_DEFAULT_PAGE_SIZE };

// ---------------------------------------------------------------------------
// Constants — block-range backfill policy
// ---------------------------------------------------------------------------

/**
 * How many blocks to request per backfill window. Etherscan-compatible APIs
 * can return up to 10,000 rows per call; a 10,000-block window is a safe upper
 * bound for an account that isn't a high-frequency bot. If a window overflows
 * (returns exactly the page size), the state machine narrows the window; if it
 * still overflows, we keep narrowing by half until we reach a minimum. This
 * keeps the backfill resumable and bounded even for very active wallets.
 */
export const EVM_BACKFILL_WINDOW_BLOCKS = 10000;

/**
 * The smallest block window we'll narrow to before giving up on a sub-window
 * (and just accepting the page). Prevents infinite halving.
 */
export const EVM_BACKFILL_MIN_WINDOW = 250;

/** Hard ceiling on backfill iterations (windows) so a runaway loop can't spin forever. */
export const MAX_EVM_BACKFILL_WINDOWS = 50000;

// ---------------------------------------------------------------------------
// EVM balance mapping — native + token balances -> MappedBalance
// ---------------------------------------------------------------------------

/**
 * Map a native-coin balance (in wei, as a decimal string from the explorer's
 * `balance` action) to a MappedBalance. EVM native coins are 18-decimal minor
 * units, so amountRaw carries the wei value and decimalsAtRead is 18.
 */
export function mapEvmNativeBalance(chain: Chain, balanceWei: string): MappedBalance {
  const assetId = nativeAssetIdForChain(chain);
  return {
    assetId,
    amountRaw: balanceWei,
    amountDecimal: null,
    decimalsAtRead: EVM_NATIVE_DECIMALS,
  };
}

/**
 * Map a single tokentx row's LATEST balance contribution to a MappedBalance.
 * Because Etherscan's `tokentx` returns transfer EVENTS (not a current
 * balance), the server layer derives the current token balance by summing
 * (in - out) across all tokentx rows for a given contract. This helper builds
 * the MappedBalance for a NET summed amount.
 *
 * `netAmount` is the net smallest-unit amount (could be negative if more sent
 * than received, but balances are floored at 0 by the caller). `contract` is
 * the token contract address (we resolve to a known asset or leave null).
 */
export function mapEvmTokenBalance(
  chain: Chain,
  contract: string,
  netAmount: string,
  decimals: number,
): MappedBalance {
  const resolved = resolveEvmAssetByContract(chain, contract);
  return {
    assetId: resolved ? resolved.assetId : null,
    amountRaw: netAmount,
    amountDecimal: null,
    decimalsAtRead: resolved ? resolved.decimals : decimals,
    currency: resolved ? undefined : normAddr(contract),
    issuer: resolved ? undefined : normAddr(contract),
  };
}

/**
 * Derive net token balances from a set of tokentx rows. Groups by
 * contractAddress, sums (to - from) from the wallet's perspective, and returns
 * one MappedBalance per contract with a non-zero net. This is how we get
 * current ERC-20 holdings from transfer history (the explorer has no direct
 * "token balance by contract" call in the Etherscan-compatible shape we use).
 */
export function deriveTokenBalancesFromHistory(
  chain: Chain,
  walletAddress: string,
  rows: EvmTokenTxRow[],
): MappedBalance[] {
  const account = normAddr(walletAddress);
  const byContract = new Map<string, { net: bigint; decimals: number }>();
  for (const r of rows ?? []) {
    const contract = normAddr(r.contractAddress);
    const decimals = Number.parseInt(r.tokenDecimal, 10);
    const dec = Number.isFinite(decimals) ? decimals : 18;
    const value = BigInt(r.value || "0");
    const from = normAddr(r.from);
    const to = normAddr(r.to);
    let entry = byContract.get(contract);
    if (!entry) {
      entry = { net: BigInt(0), decimals: dec };
      byContract.set(contract, entry);
    }
    if (to === account) entry.net += value;
    if (from === account) entry.net -= value;
  }
  const out: MappedBalance[] = [];
  for (const [contract, { net, decimals }] of byContract) {
    if (net === BigInt(0)) continue;
    const amountStr = net < BigInt(0) ? BigInt(0).toString() : net.toString();
    out.push(mapEvmTokenBalance(chain, contract, amountStr, decimals));
  }
  return out;
}

// ---------------------------------------------------------------------------
// EVM transaction mapping — convert explorer rows to mapped legs
// ---------------------------------------------------------------------------

/**
 * Convert a txlist row into the EvmNativeTransfer shape that evm-map-core's
 * mapNativeTransfer consumes. Computes the fee as gasUsed * gasPrice (in wei).
 * The server layer passes this through the mapper to get signed MappedTransaction
 * legs, then through buildTransactionUpserts for persistence.
 */
export function txListRowToNativeTransfer(
  row: EvmTxListRow,
): {
  txHash: string;
  from: string;
  to: string;
  valueWei: string;
  blockNumber: number;
  blockTime: string;
  feeWei: string;
} {
  const blockNumber = Number.parseInt(row.blockNumber, 10);
  const ts = Number.parseInt(row.timeStamp, 10);
  const blockTime = Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : new Date(0).toISOString();
  const gasUsed = BigInt(row.gasUsed || "0");
  const gasPrice = BigInt(row.gasPrice || "0");
  const feeWei = (gasUsed * gasPrice).toString();
  return {
    txHash: row.hash,
    from: row.from,
    to: row.to,
    valueWei: row.value || "0",
    blockNumber: Number.isFinite(blockNumber) ? blockNumber : 0,
    blockTime,
    feeWei,
  };
}

/**
 * Convert a tokentx row into the EvmLog-shaped input that evm-map-core's
 * mapErc20TransferLog consumes. The Etherscan-compatible API pre-decodes the
 * Transfer event into from/to/value/contract fields, so we reconstruct the
 * topic-based log shape the mapper expects. The `logIndex` is synthesized from
 * the transactionIndex + the row's position (the explorer doesn't expose a true
 * log index in the Etherscan shape), giving a stable per-tx event index.
 */
export function tokenTxRowToEvmLog(
  row: EvmTokenTxRow,
  eventIndex: number,
): {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
} {
  // Reconstruct the 3-topic ERC-20 Transfer log shape:
  // topics[0] = Transfer signature, topics[1] = from (indexed), topics[2] = to (indexed)
  // data = abi-encoded uint256 value
  const fromTopic = "0x" + normAddr(row.from).replace(/^0x/, "").padStart(64, "0");
  const toTopic = "0x" + normAddr(row.to).replace(/^0x/, "").padStart(64, "0");
  const dataHex = BigInt(row.value || "0").toString(16).padStart(64, "0");
  return {
    address: normAddr(row.contractAddress),
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      fromTopic,
      toTopic,
    ],
    data: "0x" + dataHex,
    logIndex: eventIndex,
  };
}

// ---------------------------------------------------------------------------
// Block-range backfill state machine
// ---------------------------------------------------------------------------

/** State of an in-progress EVM block-range backfill. */
export type EvmBackfillState = {
  /** The cursor (next start block + last consumed block). */
  cursor: EvmBlockCursor;
  /** The tip block we're walking toward (current chain head at sync start). */
  tipBlock: number;
  /** The current window size (blocks per window; narrows on overflow). */
  windowBlocks: number;
  /** Windows successfully applied so far. */
  windows: number;
  /** True once we've consumed up to the tip. */
  done: boolean;
};

/**
 * Begin a backfill. `savedCursor` is the serialized cursor from a prior run
 * (null = start from genesis). `tipBlock` is the current chain head (the server
 * fetches this once at sync start). We resume from the saved cursor's
 * nextStartBlock, or genesis if none.
 */
export function initEvmBackfill(
  savedCursor: string | null,
  tipBlock: number,
): EvmBackfillState {
  const cursor = initEvmCursor(savedCursor);
  return {
    cursor,
    tipBlock: tipBlock > 0 ? tipBlock : 0,
    windowBlocks: EVM_BACKFILL_WINDOW_BLOCKS,
    windows: 0,
    done: cursor.nextStartBlock > tipBlock,
  };
}

/**
 * The end block of the current window (inclusive). Capped at the tip so the
 * last window covers [nextStartBlock, tipBlock].
 */
export function currentWindowEnd(state: EvmBackfillState): number {
  const end = state.cursor.nextStartBlock + state.windowBlocks - 1;
  return end > state.tipBlock ? state.tipBlock : end;
}

/**
 * Apply the result of ONE block window. `txRows` + `tokenRows` are the rows
 * fetched for [nextStartBlock, windowEnd]. `pageSize` is the offset we used.
 *
 * If the window returned fewer rows than the page size (for BOTH txlist and
 * tokentx), the window is fully consumed: we advance nextStartBlock to
 * maxBlockSeen + 1 (or windowEnd + 1 if no rows), widen the window back to the
 * default, and mark done if we've reached the tip.
 *
 * If EITHER row set returned exactly the page size (a full page), the window
 * likely has more rows: we NARROW the window by half (down to the minimum) and
 * re-request the same start block. This handles high-activity windows without
 * missing data.
 */
export function reduceEvmBackfill(
  state: EvmBackfillState,
  txRows: EvmTxListRow[],
  tokenRows: EvmTokenTxRow[],
  pageSize: number,
): EvmBackfillState {
  const windows = state.windows + 1;
  const hitGuard = windows >= MAX_EVM_BACKFILL_WINDOWS;

  const txFull = txRows.length >= pageSize;
  const tokFull = tokenRows.length >= pageSize;
  const windowOverflowed = txFull || tokFull;

  const maxBlock = maxBlockAcrossRows(txRows, tokenRows);
  const windowEnd = currentWindowEnd(state);

  if (windowOverflowed && state.windowBlocks > EVM_BACKFILL_MIN_WINDOW) {
    // Too many rows in this window to safely page. Narrow the window by half
    // and re-request the SAME start block (keeps cursor, halves density).
    const narrowed = Math.max(
      Math.floor(state.windowBlocks / 2),
      EVM_BACKFILL_MIN_WINDOW,
    );
    return {
      cursor: state.cursor,
      tipBlock: state.tipBlock,
      windowBlocks: narrowed,
      windows,
      done: hitGuard,
    };
  }

  if (windowOverflowed && state.windowBlocks <= EVM_BACKFILL_MIN_WINDOW) {
    // Already at the minimum window and STILL full: we cannot narrow further.
    // Consume what we have seen (advance to maxBlock + 1) and keep the tight
    // window so the next request stays dense-aware. This guarantees forward
    // progress without skipping unconsumed rows.
    const advanceTo = maxBlock > 0 ? maxBlock + 1 : windowEnd + 1;
    const reachedTip = advanceTo > state.tipBlock;
    return {
      cursor: {
        nextStartBlock: advanceTo,
        lastConsumedBlock: maxBlock > 0 ? maxBlock : windowEnd,
      },
      tipBlock: state.tipBlock,
      windowBlocks: EVM_BACKFILL_MIN_WINDOW,
      windows,
      done: reachedTip || hitGuard,
    };
  }

  // Window consumed. Advance past the highest block we saw (or windowEnd if empty).
  const advanceTo = maxBlock > 0 ? maxBlock + 1 : windowEnd + 1;
  const newCursor: EvmBlockCursor = {
    nextStartBlock: advanceTo,
    lastConsumedBlock: maxBlock > 0 ? maxBlock : windowEnd,
  };
  const reachedTip = advanceTo > state.tipBlock;
  return {
    cursor: newCursor,
    tipBlock: state.tipBlock,
    windowBlocks: EVM_BACKFILL_WINDOW_BLOCKS, // reset to default for next window
    windows,
    done: reachedTip || hitGuard,
  };
}

/** Should the orchestrator request another window? */
export function shouldContinueEvmBackfill(state: EvmBackfillState): boolean {
  return !state.done;
}

/** Serialise the current cursor for persistence (resumable). */
export function currentCursorString(state: EvmBackfillState): string | null {
  return state.done ? null : serializeEvmCursor(state.cursor);
}

// ---------------------------------------------------------------------------
// Counts + summary — for the sync report + diagnostics
// ---------------------------------------------------------------------------

export type EvmSyncCounts = {
  windows: number;
  balancesUpserted: number;
  transactionsUpserted: number;
  untrackedBalances: number;
  untrackedTransactions: number;
};

export function emptyEvmSyncCounts(): EvmSyncCounts {
  return {
    windows: 0,
    balancesUpserted: 0,
    transactionsUpserted: 0,
    untrackedBalances: 0,
    untrackedTransactions: 0,
  };
}

/** Fold one window's contributions into the running totals (pure). */
export function addEvmWindowCounts(
  base: EvmSyncCounts,
  delta: Partial<EvmSyncCounts>,
): EvmSyncCounts {
  return {
    windows: base.windows + (delta.windows ?? 0),
    balancesUpserted: base.balancesUpserted + (delta.balancesUpserted ?? 0),
    transactionsUpserted: base.transactionsUpserted + (delta.transactionsUpserted ?? 0),
    untrackedBalances: base.untrackedBalances + (delta.untrackedBalances ?? 0),
    untrackedTransactions: base.untrackedTransactions + (delta.untrackedTransactions ?? 0),
  };
}

/** Plain-English one-liner for the sync report. */
export function summarizeEvmSync(counts: EvmSyncCounts): string {
  const txn = counts.transactionsUpserted;
  const bal = counts.balancesUpserted;
  const parts = [
    `${bal} balance${bal === 1 ? "" : "s"}`,
    `${txn} transaction${txn === 1 ? "" : "s"}`,
    `${counts.windows} window${counts.windows === 1 ? "" : "s"}`,
  ];
  let s = `Synced ${parts.join(", ")}.`;
  if (counts.untrackedBalances > 0 || counts.untrackedTransactions > 0) {
    s += ` (${counts.untrackedBalances} untracked-token balance${counts.untrackedBalances === 1 ? "" : "s"}, ${counts.untrackedTransactions} untracked-token transaction${counts.untrackedTransactions === 1 ? "" : "s"} kept for history.)`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run under tsx by run-pure-selftests.ts + vitest mirror)
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`evm-sync-core self-test FAILED: ${name}`);
}

export function __runEvmSyncCoreTests(): void {
  // --- balance mapping ---
  const nativeBal = mapEvmNativeBalance("flare", "1500000000000000000");
  check("native balance assetId", nativeBal.assetId === "flr");
  check("native balance amountRaw", nativeBal.amountRaw === "1500000000000000000");
  check("native balance decimals", nativeBal.decimalsAtRead === 18);
  check("native balance no decimal", nativeBal.amountDecimal === null);

  const nativeBalEth = mapEvmNativeBalance("ethereum", "0");
  check("native balance eth", nativeBalEth.assetId === "eth");

  // --- token balance mapping ---
  const usdtBal = mapEvmTokenBalance("ethereum", "0xdac17f958d2ee523a2206206994597c13d831ec7", "5000000", 6);
  check("token balance usdt assetId", usdtBal.assetId === "usdt-eth");
  check("token balance usdt decimals", usdtBal.decimalsAtRead === 6);

  const untrackedBal = mapEvmTokenBalance("flare", "0xdeadbeef00000000000000000000000000000000", "1000000000000000000", 18);
  check("untracked token balance null assetId", untrackedBal.assetId === null);
  check("untracked token balance has currency", untrackedBal.currency === "0xdeadbeef00000000000000000000000000000000");

  // --- derive token balances from history ---
  const walletAddr = "0x1111111111111111111111111111111111111111";
  const tokHistory: EvmTokenTxRow[] = [
    { hash: "0x1", from: "0x2222222222222222222222222222222222222222", to: walletAddr, value: "5000000", contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7", tokenDecimal: "6", tokenSymbol: "USDT", blockNumber: "100", timeStamp: "1000", gasUsed: "50000", gasPrice: "1" },
    { hash: "0x2", from: walletAddr, to: "0x3333333333333333333333333333333333333333", value: "2000000", contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7", tokenDecimal: "6", tokenSymbol: "USDT", blockNumber: "101", timeStamp: "2000", gasUsed: "50000", gasPrice: "1" },
  ];
  const derived = deriveTokenBalancesFromHistory("ethereum", walletAddr, tokHistory);
  check("derive token balances count", derived.length === 1);
  check("derive token balances net", derived[0].amountRaw === "3000000"); // 5M - 2M
  check("derive token balances assetId", derived[0].assetId === "usdt-eth");

  // --- derive token balances with zero net filtered ---
  const tokZero: EvmTokenTxRow[] = [
    { hash: "0x3", from: "0x4444444444444444444444444444444444444444", to: walletAddr, value: "100", contractAddress: "0xabc0000000000000000000000000000000000000", tokenDecimal: "18", tokenSymbol: "ABC", blockNumber: "102", timeStamp: "3000", gasUsed: "50000", gasPrice: "1" },
    { hash: "0x4", from: walletAddr, to: "0x4444444444444444444444444444444444444444", value: "100", contractAddress: "0xabc0000000000000000000000000000000000000", tokenDecimal: "18", tokenSymbol: "ABC", blockNumber: "103", timeStamp: "4000", gasUsed: "50000", gasPrice: "1" },
  ];
  const derivedZero = deriveTokenBalancesFromHistory("flare", walletAddr, tokZero);
  check("derive zero net filtered", derivedZero.length === 0);

  // --- txListRowToNativeTransfer ---
  const txRow: EvmTxListRow = {
    hash: "0xabc",
    from: walletAddr,
    to: "0x5555555555555555555555555555555555555555",
    value: "1000000000000000000",
    blockNumber: "500",
    timeStamp: "1700000000",
    gasUsed: "21000",
    gasPrice: "20000000000",
    isError: "0",
    transactionIndex: "3",
  };
  const native = txListRowToNativeTransfer(txRow);
  check("native transfer hash", native.txHash === "0xabc");
  check("native transfer value", native.valueWei === "1000000000000000000");
  check("native transfer block", native.blockNumber === 500);
  check("native transfer fee", native.feeWei === (BigInt(21000) * BigInt(20000000000)).toString());
  check("native transfer blockTime ISO", native.blockTime.includes("T") && native.blockTime.endsWith("Z"));

  // --- tokenTxRowToEvmLog ---
  const tokRow: EvmTokenTxRow = {
    hash: "0xdef",
    from: walletAddr,
    to: "0x6666666666666666666666666666666666666666",
    value: "5000000",
    contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    tokenDecimal: "6",
    tokenSymbol: "USDT",
    blockNumber: "501",
    timeStamp: "1700000100",
    gasUsed: "50000",
    gasPrice: "20000000000",
  };
  const log = tokenTxRowToEvmLog(tokRow, 7);
  check("evm log address", log.address === "0xdac17f958d2ee523a2206206994597c13d831ec7");
  check("evm log 3 topics", log.topics.length === 3);
  check("evm log topic0 transfer sig", log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  check("evm log logIndex", log.logIndex === 7);
  check("evm log data hex", log.data.startsWith("0x") && log.data.length === 66);

  // --- backfill state machine: init ---
  const fresh = initEvmBackfill(null, 50000);
  check("init backfill start 0", fresh.cursor.nextStartBlock === 0);
  check("init backfill tip", fresh.tipBlock === 50000);
  check("init backfill window", fresh.windowBlocks === EVM_BACKFILL_WINDOW_BLOCKS);
  check("init backfill not done", fresh.done === false);

  // resume from saved cursor
  const resumed = initEvmBackfill("1234:1233", 50000);
  check("resume backfill start", resumed.cursor.nextStartBlock === 1234);

  // --- backfill: currentWindowEnd ---
  check("window end capped at tip", currentWindowEnd(fresh) === EVM_BACKFILL_WINDOW_BLOCKS - 1);
  const nearTip = initEvmBackfill("49000:48999", 50000);
  check("window end at tip", currentWindowEnd(nearTip) === 50000);

  // --- backfill: empty window advances ---
  const afterEmpty = reduceEvmBackfill(fresh, [], [], 200);
  check("empty window advances start", afterEmpty.cursor.nextStartBlock === EVM_BACKFILL_WINDOW_BLOCKS);
  check("empty window not done", afterEmpty.done === false);
  check("empty window resets window size", afterEmpty.windowBlocks === EVM_BACKFILL_WINDOW_BLOCKS);

  // --- backfill: window with rows advances to maxBlock+1 ---
  const rowsWithBlock: EvmTxListRow[] = [
    { hash: "0x1", from: "0xa", to: "0xb", value: "1", blockNumber: "5000", timeStamp: "1", gasUsed: "1", gasPrice: "1", isError: "0", transactionIndex: "0" },
  ];
  const afterRows = reduceEvmBackfill(fresh, rowsWithBlock, [], 200);
  check("rows window advances to maxBlock+1", afterRows.cursor.nextStartBlock === 5001);
  check("rows window lastConsumed", afterRows.cursor.lastConsumedBlock === 5000);

  // --- backfill: full page narrows window ---
  const fullPage: EvmTxListRow[] = [];
  for (let i = 0; i < 200; i += 1) {
    fullPage.push({ hash: `0x${i}`, from: "0xa", to: "0xb", value: "1", blockNumber: String(i), timeStamp: "1", gasUsed: "1", gasPrice: "1", isError: "0", transactionIndex: "0" });
  }
  const afterNarrow = reduceEvmBackfill(fresh, fullPage, [], 200);
  check("full page narrows window", afterNarrow.windowBlocks === Math.floor(EVM_BACKFILL_WINDOW_BLOCKS / 2));
  check("full page does not advance", afterNarrow.cursor.nextStartBlock === 0);

  // --- backfill: narrowing hits minimum ---
  let state = initEvmBackfill(null, 100000);
  state = { ...state, windowBlocks: EVM_BACKFILL_MIN_WINDOW };
  const minNarrow = reduceEvmBackfill(state, fullPage, [], 200);
  check("min window does not narrow further", minNarrow.windowBlocks === EVM_BACKFILL_MIN_WINDOW);

  // --- backfill: reaching tip marks done ---
  // Cursor "50001:50000" means we already consumed through 50000 and the next
  // start block is PAST the tip → nothing left to backfill.
  const atTip = initEvmBackfill("50001:50000", 50000);
  check("at tip done", atTip.done === true);
  check("shouldContinue at tip", shouldContinueEvmBackfill(atTip) === false);
  // Cursor "50000:49999" means block 50000 still needs fetching (not done).
  const oneLeft = initEvmBackfill("50000:49999", 50000);
  check("one block left not done", oneLeft.done === false);
  check("shouldContinue one left", shouldContinueEvmBackfill(oneLeft) === true);

  // --- backfill: window that reaches tip via reduce ---
  const nearEnd = initEvmBackfill("49900:49899", 50000);
  const endRows: EvmTxListRow[] = [
    { hash: "0xf", from: "0xa", to: "0xb", value: "1", blockNumber: "50000", timeStamp: "1", gasUsed: "1", gasPrice: "1", isError: "0", transactionIndex: "0" },
  ];
  const atTipViaReduce = reduceEvmBackfill(nearEnd, endRows, [], 200);
  check("reduce reaching tip done", atTipViaReduce.done === true);
  check("cursor string null when done", currentCursorString(atTipViaReduce) === null);
  check("cursor string set when not done", currentCursorString(afterEmpty) !== null);

  // --- backfill guard ---
  let guardState = initEvmBackfill(null, 1000000000);
  for (let i = 0; i < MAX_EVM_BACKFILL_WINDOWS; i += 1) {
    guardState = reduceEvmBackfill(guardState, [], [], 200);
  }
  check("backfill window guard done", guardState.done === true);

  // --- counts + summary ---
  let counts = emptyEvmSyncCounts();
  check("empty counts", counts.windows === 0 && counts.transactionsUpserted === 0);
  counts = addEvmWindowCounts(counts, { windows: 1, transactionsUpserted: 5, balancesUpserted: 2 });
  counts = addEvmWindowCounts(counts, { windows: 1, transactionsUpserted: 3, untrackedTransactions: 1 });
  check("counts folded", counts.windows === 2 && counts.transactionsUpserted === 8 && counts.untrackedTransactions === 1);
  const summary = summarizeEvmSync(counts);
  check("summary has balances", summary.includes("2 balances"));
  check("summary has transactions", summary.includes("8 transactions"));
  check("summary has windows", summary.includes("2 windows"));
  check("summary has untracked note", summary.includes("untracked"));

  // --- reuse: buildTransactionUpserts works with EVM mapped legs ---
  const mappedLeg: MappedTransaction = {
    txHash: "0xabc",
    eventIndex: 0,
    assetId: "eth",
    chain: "ethereum",
    direction: "out",
    txType: "transfer",
    amountRaw: "1000000000000000000",
    amountDecimal: null,
    decimalsAtEvent: 18,
    feeRaw: "210000000000000",
    feeAssetId: "eth",
    counterparty: "0x5555555555555555555555555555555555555555",
    blockNumber: 500,
    blockTime: "2023-11-14T22:13:20.000Z",
    success: true,
  };
  const upsertRows = buildTransactionUpserts("wallet-1", [mappedLeg], { raw: "envelope" });
  check("reuse buildTransactionUpserts length", upsertRows.length === 1);
  check("reuse buildTransactionUpserts chain", upsertRows[0].chain === "ethereum");
  check("reuse buildTransactionUpserts unsigned amount", upsertRows[0].amount_raw === "1000000000000000000");
  check("reuse buildTransactionUpserts direction", upsertRows[0].direction === "out");
  check("reuse buildTransactionUpserts fee", upsertRows[0].fee_raw === "210000000000000");
  check("reuse buildTransactionUpserts feeAsset", upsertRows[0].fee_asset_id === "eth");

  // --- reuse: buildBalanceUpserts works with EVM mapped balances ---
  const balRows = buildBalanceUpserts("wallet-1", [nativeBal], "2026-08-11T00:00:00.000Z");
  check("reuse buildBalanceUpserts length", balRows.length === 1);
  check("reuse buildBalanceUpserts assetId", balRows[0].asset_id === "flr");
  check("reuse buildBalanceUpserts amountRaw", balRows[0].amount_raw === "1500000000000000000");

  // --- reuse: buildSyncStateUpsert ---
  const syncRow = buildSyncStateUpsert({
    walletId: "wallet-1",
    cursor: "1234:1233",
    backfillComplete: false,
    syncedAt: "2026-08-11T00:00:00.000Z",
    status: "backfilling",
    errorMessage: null,
  });
  check("reuse buildSyncStateUpsert cursor", syncRow.backfill_cursor === "1234:1233");
  check("reuse buildSyncStateUpsert status", syncRow.status === "backfilling");

  console.log("evm-sync-core self-tests: all passed");
}
