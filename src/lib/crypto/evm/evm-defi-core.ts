/**
 * evm-defi-core.ts — PURE, guess-free DeFi transaction classifier.
 *
 * PURPOSE
 * -------
 * The base EVM mapper (evm-map-core.ts) turns raw chain data into
 * `MappedTransaction` legs whose `txType` is always the neutral "transfer".
 * That is correct but not RICH: a liquidity-pool deposit and a plain send look
 * identical at the token-transfer level. This module inspects the FULL set of
 * logs in a transaction and, using ONLY verified event-signature hashes,
 * upgrades the semantic type to the truth of what happened:
 *
 *   - Uniswap-V2-style Mint  → "lp_add"     (deposit into a liquidity pool)
 *   - Uniswap-V2-style Burn  → "lp_remove"  (withdraw from a liquidity pool)
 *   - Uniswap-V2-style Swap  → "swap"       (token A → token B, a disposal)
 *   - Uniswap-V3 pool Mint / NFT IncreaseLiquidity → "lp_add"
 *   - Uniswap-V3 pool Burn / NFT DecreaseLiquidity → "lp_remove"
 *   - Uniswap-V3 pool Swap                          → "swap"
 *   - WFLR/WETH Deposit/Withdrawal (wrap/unwrap)    → left as "transfer"
 *     (a 1:1 wrap is NOT a disposal under the defensible default; we keep the
 *     audit trail and do NOT invent a taxable event)
 *
 * This solves the community's #1 pain — "LP transactions are not auto-
 * categorized, I have to tag every one by hand" — at the DATA layer, before any
 * pricing (USD comes later, in C9). It aggressively targets ENOSYS, Michael's
 * near-exclusive venue, which runs BOTH a Uniswap-V2 fork (DEX V2, fungible LP
 * tokens) AND a Uniswap-V3 fork (DEX V3, concentrated-liquidity NFT positions).
 *
 * DESIGN RULES (never guessed — every signature is first-party verified):
 *   - Classification is driven ONLY by event-signature topic0 hashes computed
 *     from the canonical Solidity event declarations and cross-checked against
 *     the official Uniswap v2-core / v3-core / v3-periphery sources.
 *   - When NOTHING matches, we return the neutral "transfer" — we NEVER guess a
 *     richer type. A wrong tax category is worse than a plain one.
 *   - This file has NO `import "server-only"` so it runs under tsx self-tests.
 *   - No floats, no BigInt literals (ES2017 target): use BigInt(...) if needed.
 *
 * VERIFIED EVENT SIGNATURES (keccak256 of the canonical event declaration):
 *   Uniswap V2 (sources: @uniswap/v2-core UniswapV2Pair.sol):
 *     Mint(address,uint256,uint256)                        → topic0 below
 *     Burn(address,uint256,uint256,address)                → topic0 below
 *     Swap(address,uint256,uint256,uint256,uint256,address)→ topic0 below
 *     Sync(uint112,uint112)                                → topic0 below
 *   WETH9 / WFLR wrap (sources: WETH9.sol, canonical wrapped-native):
 *     Deposit(address,uint256)                             → topic0 below
 *     Withdrawal(address,uint256)                          → topic0 below
 *   Uniswap V3 pool (sources: @uniswap/v3-core IUniswapV3PoolEvents.sol):
 *     Mint(address,address,int24,int24,uint128,uint256,uint256)
 *     Burn(address,int24,int24,uint128,uint256,uint256)
 *     Collect(address,address,int24,int24,uint128,uint128)
 *     Swap(address,address,int256,int256,uint160,uint128,int24)
 *   Uniswap V3 NonfungiblePositionManager (sources: v3-periphery
 *   INonfungiblePositionManager.sol):
 *     IncreaseLiquidity(uint256,uint128,uint256,uint256)
 *     DecreaseLiquidity(uint256,uint128,uint256,uint256)
 *     Collect(uint256,address,uint256,uint256)
 */

import type { TxType } from "../crypto-core";
import type { EvmLog } from "./evm-map-core";

// ---------------------------------------------------------------------------
// Verified event-signature topic0 constants
// ---------------------------------------------------------------------------

/** Uniswap V2 `Mint(address,uint256,uint256)` — LP deposit. */
export const V2_MINT_TOPIC0 =
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f";

/** Uniswap V2 `Burn(address,uint256,uint256,address)` — LP withdraw. */
export const V2_BURN_TOPIC0 =
  "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496";

/** Uniswap V2 `Swap(address,uint256,uint256,uint256,uint256,address)`. */
export const V2_SWAP_TOPIC0 =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";

/** Uniswap V2 `Sync(uint112,uint112)` — reserves update (informational). */
export const V2_SYNC_TOPIC0 =
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";

/** WETH9 / WFLR `Deposit(address,uint256)` — native → wrapped (wrap). */
export const WRAP_DEPOSIT_TOPIC0 =
  "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c";

/** WETH9 / WFLR `Withdrawal(address,uint256)` — wrapped → native (unwrap). */
export const WRAP_WITHDRAWAL_TOPIC0 =
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";

/** Uniswap V3 pool `Mint(...)` — concentrated-liquidity add. */
export const V3_MINT_TOPIC0 =
  "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde";

/** Uniswap V3 pool `Burn(...)` — concentrated-liquidity remove. */
export const V3_BURN_TOPIC0 =
  "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c";

/** Uniswap V3 pool `Collect(...)` — collect owed tokens/fees from a position. */
export const V3_COLLECT_TOPIC0 =
  "0x70935338e69775456a85ddef226c395fb668b63fa0115f5f20610b388e6ca9c0";

/** Uniswap V3 pool `Swap(...)`. */
export const V3_SWAP_TOPIC0 =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

/** V3 NonfungiblePositionManager `IncreaseLiquidity(...)` — LP add via NFT. */
export const NFT_INCREASE_LIQUIDITY_TOPIC0 =
  "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f";

/** V3 NonfungiblePositionManager `DecreaseLiquidity(...)` — LP remove via NFT. */
export const NFT_DECREASE_LIQUIDITY_TOPIC0 =
  "0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4";

/** V3 NonfungiblePositionManager `Collect(...)` — collect fees to an NFT owner. */
export const NFT_COLLECT_TOPIC0 =
  "0x40d0efd1a53d60ecbf40971b9daf7dc90178c3aadc7aab1765632738fa8b8f01";

// ---------------------------------------------------------------------------
// Event-signature grouping (which hashes imply which semantic type)
// ---------------------------------------------------------------------------

/**
 * Every event-signature hash that means "liquidity was ADDED to a pool" — both
 * Uniswap-V2 pair Mint and Uniswap-V3 pool Mint / NFT IncreaseLiquidity.
 */
export const LP_ADD_TOPICS: readonly string[] = [
  V2_MINT_TOPIC0,
  V3_MINT_TOPIC0,
  NFT_INCREASE_LIQUIDITY_TOPIC0,
];

/**
 * Every event-signature hash that means "liquidity was REMOVED from a pool" —
 * Uniswap-V2 pair Burn and Uniswap-V3 pool Burn / NFT DecreaseLiquidity.
 *
 * NOTE: V3 `Collect` is deliberately NOT here. Collect can happen on its own
 * (harvesting accrued fees without touching principal), which we do not want to
 * mislabel as a full removal. A withdraw that also collects will still emit a
 * Burn/DecreaseLiquidity, which classifies correctly.
 */
export const LP_REMOVE_TOPICS: readonly string[] = [
  V2_BURN_TOPIC0,
  V3_BURN_TOPIC0,
  NFT_DECREASE_LIQUIDITY_TOPIC0,
];

/** Every event-signature hash that means "a swap happened" (V2 + V3). */
export const SWAP_TOPICS: readonly string[] = [V2_SWAP_TOPIC0, V3_SWAP_TOPIC0];

/** Wrap/unwrap event hashes (native ↔ wrapped-native). */
export const WRAP_TOPICS: readonly string[] = [
  WRAP_DEPOSIT_TOPIC0,
  WRAP_WITHDRAWAL_TOPIC0,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lower-cased topic0 of a log, or "" when absent/malformed. */
function topic0Of(log: EvmLog): string {
  if (!log || !Array.isArray(log.topics) || log.topics.length === 0) return "";
  return (log.topics[0] ?? "").toLowerCase();
}

/** True iff ANY log in the transaction carries one of the given topic0 hashes. */
export function anyLogHasTopic0(
  logs: EvmLog[] | undefined,
  topics: readonly string[],
): boolean {
  const wanted = new Set(topics.map((t) => t.toLowerCase()));
  for (const log of logs ?? []) {
    if (wanted.has(topic0Of(log))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a whole transaction's semantic `TxType` from its logs.
 *
 * PRECEDENCE (most specific / most tax-material first, so the truth wins when a
 * single transaction emits several event kinds):
 *   1. LP remove  (lp_remove) — withdrawing liquidity is a disposal of the LP
 *      position; if present it dominates any incidental swap in the same tx.
 *   2. LP add     (lp_add)    — depositing liquidity is a disposal of the
 *      deposited tokens; dominates an incidental swap (e.g. zap-in).
 *   3. Swap       (swap)      — a bare token-for-token trade.
 *   4. Otherwise  (transfer)  — nothing DeFi-specific detected (includes plain
 *      wrap/unwrap, which we intentionally leave neutral).
 *
 * We NEVER guess: a transaction with no recognized DeFi event stays "transfer".
 */
export function classifyEvmTxType(logs: EvmLog[] | undefined): TxType {
  if (anyLogHasTopic0(logs, LP_REMOVE_TOPICS)) return "lp_remove";
  if (anyLogHasTopic0(logs, LP_ADD_TOPICS)) return "lp_add";
  if (anyLogHasTopic0(logs, SWAP_TOPICS)) return "swap";
  return "transfer";
}

/**
 * True iff the transaction contains a wrap/unwrap event (native ↔ wrapped).
 * Exposed so a later slice (or the reporter) can DOCUMENT the wrap position
 * without changing the neutral tax treatment here.
 */
export function isWrapTransaction(logs: EvmLog[] | undefined): boolean {
  return anyLogHasTopic0(logs, WRAP_TOPICS);
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run under tsx by run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`evm-defi-core self-test failed: ${msg}`);
}

/** Build a minimal log carrying just a topic0 (enough for classification). */
function logWith(topic0: string, logIndex: number): EvmLog {
  return { address: "0xpool", topics: [topic0], data: "0x", logIndex };
}

const ERC20_TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function __runEvmDefiCoreTests(): void {
  // --- constants are the exact verified hashes (guard against edits) ---
  assert(
    V2_MINT_TOPIC0 ===
      "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f",
    "V2 Mint topic0",
  );
  assert(
    V2_BURN_TOPIC0 ===
      "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496",
    "V2 Burn topic0",
  );
  assert(
    V2_SWAP_TOPIC0 ===
      "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822",
    "V2 Swap topic0",
  );
  assert(
    V3_MINT_TOPIC0 ===
      "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde",
    "V3 Mint topic0",
  );
  assert(
    V3_BURN_TOPIC0 ===
      "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c",
    "V3 Burn topic0",
  );
  assert(
    NFT_INCREASE_LIQUIDITY_TOPIC0 ===
      "0x3067048beee31b25b2f1681f88dac838c8bba36af25bfb2b7cf7473a5847e35f",
    "NFT IncreaseLiquidity topic0",
  );
  assert(
    NFT_DECREASE_LIQUIDITY_TOPIC0 ===
      "0x26f6a048ee9138f2c0ce266f322cb99228e8d619ae2bff30c67f8dcf9d2377b4",
    "NFT DecreaseLiquidity topic0",
  );
  assert(
    WRAP_DEPOSIT_TOPIC0 ===
      "0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c",
    "wrap Deposit topic0",
  );

  // --- anyLogHasTopic0 basic behaviour ---
  assert(anyLogHasTopic0([logWith(V2_MINT_TOPIC0, 0)], LP_ADD_TOPICS), "detects V2 Mint");
  assert(!anyLogHasTopic0([logWith(ERC20_TRANSFER, 0)], LP_ADD_TOPICS), "plain transfer not LP");
  assert(!anyLogHasTopic0(undefined, LP_ADD_TOPICS), "undefined logs → false");
  assert(!anyLogHasTopic0([], SWAP_TOPICS), "empty logs → false");

  // --- case-insensitive matching (explorers may return upper-case) ---
  const upper = { address: "0xp", topics: [V2_MINT_TOPIC0.toUpperCase()], data: "0x", logIndex: 0 };
  assert(anyLogHasTopic0([upper], LP_ADD_TOPICS), "upper-case topic0 still matches");

  // --- V2: Mint → lp_add, Burn → lp_remove, Swap → swap ---
  assert(
    classifyEvmTxType([logWith(V2_MINT_TOPIC0, 0), logWith(V2_SYNC_TOPIC0, 1)]) === "lp_add",
    "V2 Mint classifies lp_add",
  );
  assert(
    classifyEvmTxType([logWith(V2_BURN_TOPIC0, 0), logWith(V2_SYNC_TOPIC0, 1)]) === "lp_remove",
    "V2 Burn classifies lp_remove",
  );
  assert(
    classifyEvmTxType([logWith(V2_SWAP_TOPIC0, 0), logWith(V2_SYNC_TOPIC0, 1)]) === "swap",
    "V2 Swap classifies swap",
  );

  // --- V3 pool: Mint → lp_add, Burn → lp_remove, Swap → swap ---
  assert(classifyEvmTxType([logWith(V3_MINT_TOPIC0, 0)]) === "lp_add", "V3 Mint → lp_add");
  assert(classifyEvmTxType([logWith(V3_BURN_TOPIC0, 0)]) === "lp_remove", "V3 Burn → lp_remove");
  assert(classifyEvmTxType([logWith(V3_SWAP_TOPIC0, 0)]) === "swap", "V3 Swap → swap");

  // --- V3 NFT position manager: Increase → lp_add, Decrease → lp_remove ---
  assert(
    classifyEvmTxType([logWith(NFT_INCREASE_LIQUIDITY_TOPIC0, 0)]) === "lp_add",
    "NFT IncreaseLiquidity → lp_add",
  );
  assert(
    classifyEvmTxType([logWith(NFT_DECREASE_LIQUIDITY_TOPIC0, 0)]) === "lp_remove",
    "NFT DecreaseLiquidity → lp_remove",
  );

  // --- precedence: lp_remove beats an incidental swap in the same tx ---
  assert(
    classifyEvmTxType([logWith(V3_SWAP_TOPIC0, 0), logWith(V2_BURN_TOPIC0, 1)]) === "lp_remove",
    "lp_remove dominates swap",
  );
  // --- precedence: lp_add beats an incidental swap (zap-in) ---
  assert(
    classifyEvmTxType([logWith(V2_SWAP_TOPIC0, 0), logWith(V2_MINT_TOPIC0, 1)]) === "lp_add",
    "lp_add dominates swap",
  );
  // --- precedence: lp_remove beats lp_add if both somehow present ---
  assert(
    classifyEvmTxType([logWith(V2_MINT_TOPIC0, 0), logWith(V2_BURN_TOPIC0, 1)]) === "lp_remove",
    "lp_remove dominates lp_add",
  );

  // --- V3 Collect alone is NOT a removal (fee harvest) → stays transfer ---
  assert(
    classifyEvmTxType([logWith(V3_COLLECT_TOPIC0, 0)]) === "transfer",
    "bare V3 Collect is not lp_remove",
  );
  assert(
    classifyEvmTxType([logWith(NFT_COLLECT_TOPIC0, 0)]) === "transfer",
    "bare NFT Collect is not lp_remove",
  );

  // --- wrap/unwrap: neutral (transfer), but detectable ---
  assert(
    classifyEvmTxType([logWith(WRAP_DEPOSIT_TOPIC0, 0)]) === "transfer",
    "wrap Deposit stays transfer (neutral)",
  );
  assert(
    classifyEvmTxType([logWith(WRAP_WITHDRAWAL_TOPIC0, 0)]) === "transfer",
    "unwrap Withdrawal stays transfer (neutral)",
  );
  assert(isWrapTransaction([logWith(WRAP_DEPOSIT_TOPIC0, 0)]), "wrap detected");
  assert(isWrapTransaction([logWith(WRAP_WITHDRAWAL_TOPIC0, 0)]), "unwrap detected");
  assert(!isWrapTransaction([logWith(V2_SWAP_TOPIC0, 0)]), "swap is not a wrap");

  // --- nothing DeFi-specific → transfer (never guess) ---
  assert(
    classifyEvmTxType([logWith(ERC20_TRANSFER, 0)]) === "transfer",
    "plain ERC-20 transfer → transfer",
  );
  assert(classifyEvmTxType([]) === "transfer", "no logs → transfer");
  assert(classifyEvmTxType(undefined) === "transfer", "undefined logs → transfer");

  // --- topic groups are disjoint where they must be ---
  const removeSet = new Set(LP_REMOVE_TOPICS.map((t) => t.toLowerCase()));
  for (const t of LP_ADD_TOPICS) {
    assert(!removeSet.has(t.toLowerCase()), `add topic ${t} not in remove set`);
  }
  const swapSet = new Set(SWAP_TOPICS.map((t) => t.toLowerCase()));
  for (const t of [...LP_ADD_TOPICS, ...LP_REMOVE_TOPICS]) {
    assert(!swapSet.has(t.toLowerCase()), `lp topic ${t} not in swap set`);
  }

  console.log("evm-defi-core self-tests: all passed");
}
