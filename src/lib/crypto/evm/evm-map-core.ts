/**
 * evm-map-core.ts — PURE, tax-truthful EVM transaction mappers.
 *
 * This module turns raw EVM chain data (native coin transfers + ERC-20 Transfer
 * logs) into the SAME `MappedTransaction` shape the XRPL mappers produce, so the
 * C5 persistence layer (buildTransactionUpserts + crypto-store writers) can write
 * EVM legs with zero extra code.
 *
 * DESIGN RULES (never guessed — every fact is first-party verified):
 *   - Money is EXACT. On-chain uint256 values are parsed to precise BigInt and
 *     emitted as integer minor-unit decimal strings. No floats, ever.
 *   - On-chain transfer amounts are UNSIGNED (uint256). We derive DIRECTION from
 *     whether the tracked account is the sender (out), receiver (in), or both
 *     (self), and emit a SIGNED amount (negative = leaving the wallet).
 *   - The network FEE = gasUsed × effectiveGasPrice (wei), paid in the chain's
 *     NATIVE coin by the transaction SENDER only, and attributed exactly once.
 *   - This file has NO `import "server-only"` so it runs under tsx self-tests.
 *
 * VERIFIED EVM FACTS (sources: EIP-20, EIP-721, Ethereum Yellow Paper):
 *   - ERC-20 Transfer event signature: Transfer(address,address,uint256)
 *     keccak256 topic0 = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
 *   - An ERC-20 Transfer log has EXACTLY 3 topics: [topic0, from, to].
 *     The transferred `value` (uint256) lives in `data`, NOT in a topic.
 *   - ERC-721 Transfer shares the SAME topic0 but has 4 topics (the tokenId is
 *     indexed) → we MUST reject 4-topic logs so NFTs are not mis-ingested as
 *     fungible token transfers.
 *   - An indexed address topic is a 32-byte (64-hex) left-padded word; the
 *     address is the last 20 bytes (40 hex), lower-cased.
 *   - ETH is 18-decimal native on chainId 1. USDT-on-Ethereum is a 6-decimal
 *     ERC-20 at 0xdac17f958d2ee523a2206206994597c13d831ec7 (NOT 18). FLR and SGB
 *     are 18-decimal native coins.
 */

import { type Chain, CRYPTO_ASSETS } from "../crypto-core";
import type { MappedTransaction } from "../xrpl/xrpl-map-core";

// ---------------------------------------------------------------------------
// Verified constants
// ---------------------------------------------------------------------------

/**
 * keccak256("Transfer(address,address,uint256)") — the ERC-20 Transfer event
 * topic0. ERC-721 Transfer shares this exact hash (see `isErc721TransferLog`).
 */
export const ERC20_TRANSFER_TOPIC0 =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** The all-zero address (mint source / burn destination). */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Every EVM chain we track uses an 18-decimal native gas coin. */
export const EVM_NATIVE_DECIMALS = 18;

/** Native-coin asset id per EVM chain. */
const NATIVE_ASSET_ID: Record<string, string> = {
  ethereum: "eth",
  flare: "flr",
  songbird: "sgb",
};

// ---------------------------------------------------------------------------
// Raw shapes (exactly what an explorer/RPC gives us)
// ---------------------------------------------------------------------------

/** A single EVM log entry (as returned by eth_getLogs / explorer APIs). */
export interface EvmLog {
  /** Contract that emitted the log (lower/any case; we normalise). */
  address: string;
  /** Indexed topics. topics[0] is the event signature hash. */
  topics: string[];
  /** ABI-encoded non-indexed args (hex). For ERC-20 Transfer: the value. */
  data: string;
  /** Position of this log within its block (our idempotency event index). */
  logIndex: number;
}

/** A native-coin transfer (the tx's top-level `value`, in wei). */
export interface EvmNativeTransfer {
  txHash: string;
  from: string;
  to: string;
  /** Native amount in wei (unsigned decimal string). */
  valueWei: string;
  blockNumber: number;
  /** ISO-8601 UTC timestamp string. */
  blockTime: string;
  /** Total fee in wei (gasUsed × effectiveGasPrice); attributed to `from`. */
  feeWei?: string;
}

/** Shared context for a transaction whose logs we are mapping. */
export interface EvmTxContext {
  txHash: string;
  blockNumber: number;
  blockTime: string;
  /** The tx sender (lower/any case); the only party charged the fee. */
  txFrom?: string;
  /** Total fee in wei (gasUsed × effectiveGasPrice). */
  feeWei?: string;
}

// ---------------------------------------------------------------------------
// Address + hex helpers
// ---------------------------------------------------------------------------

/** Lower-case an EVM address (no checksum needed for equality/storage). */
export function normAddr(addr: string): string {
  return (addr ?? "").trim().toLowerCase();
}

/** True if two EVM addresses are the same account (case-insensitive). */
export function sameAddr(a: string, b: string): boolean {
  return normAddr(a) === normAddr(b);
}

/**
 * Convert a 32-byte indexed address topic to a 20-byte lower-cased address.
 * The topic is left-padded, so the address is the last 40 hex chars.
 */
export function topicToAddress(topic: string): string {
  const hex = (topic ?? "").toLowerCase().replace(/^0x/, "");
  if (hex.length < 40) {
    // Defensive: pad-left so a short/malformed topic still yields 40 hex.
    return "0x" + hex.padStart(40, "0");
  }
  return "0x" + hex.slice(hex.length - 40);
}

/**
 * Parse a uint256 (hex `0x…` or plain decimal string) into an EXACT decimal
 * string. Uses BigInt so there is never any float precision loss.
 */
export function hexToDecimalString(value: string): string {
  const v = (value ?? "").trim();
  if (v === "") return "0";
  if (v.toLowerCase().startsWith("0x")) {
    return BigInt(v).toString(10);
  }
  // Already decimal — round-trip through BigInt to validate + normalise.
  return BigInt(v).toString(10);
}

/** Negate an integer minor-unit decimal string (exact, BigInt-based). */
export function negateMinor(minor: string): string {
  const b = BigInt(minor);
  return (b === BigInt(0) ? BigInt(0) : -b).toString(10);
}

// ---------------------------------------------------------------------------
// Log classification (ERC-20 vs ERC-721)
// ---------------------------------------------------------------------------

/**
 * True iff this log is a fungible ERC-20 Transfer:
 *   - topic0 matches the Transfer signature hash, AND
 *   - there are EXACTLY 3 topics ([topic0, from, to]).
 * A 4-topic log with the same topic0 is an ERC-721 (NFT) transfer — rejected.
 */
export function isErc20TransferLog(log: EvmLog): boolean {
  if (!log || !Array.isArray(log.topics) || log.topics.length !== 3) return false;
  return (log.topics[0] ?? "").toLowerCase() === ERC20_TRANSFER_TOPIC0;
}

/**
 * True iff this log is an ERC-721 Transfer (same topic0, but 4 topics because
 * the tokenId is indexed). We use this ONLY to explicitly skip NFTs.
 */
export function isErc721TransferLog(log: EvmLog): boolean {
  if (!log || !Array.isArray(log.topics) || log.topics.length !== 4) return false;
  return (log.topics[0] ?? "").toLowerCase() === ERC20_TRANSFER_TOPIC0;
}

// ---------------------------------------------------------------------------
// Asset resolution
// ---------------------------------------------------------------------------

/** Native asset id for an EVM chain (eth/flr/sgb), or null if not EVM. */
export function nativeAssetIdForChain(chain: Chain): string | null {
  return NATIVE_ASSET_ID[chain] ?? null;
}

/**
 * Resolve a tracked ERC-20 asset by (chain, contract). Returns the asset id and
 * decimals, or null when the contract is not one we track. Contract matching is
 * chain-scoped and lower-cased so, e.g., USDT resolves on ethereum only.
 */
export function resolveEvmAssetByContract(
  chain: Chain,
  contract: string,
): { assetId: string; decimals: number } | null {
  const want = normAddr(contract);
  for (const a of CRYPTO_ASSETS) {
    if (a.chain !== chain) continue;
    if (a.native) continue;
    if (!a.contract) continue;
    if (normAddr(a.contract) === want) {
      return { assetId: a.id, decimals: a.decimals ?? 0 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

/**
 * Derive tax direction from the tracked account's role in a transfer:
 *   - sender only   → "out"
 *   - receiver only → "in"
 *   - both          → "self" (wallet-to-wallet within the same account)
 */
export function directionForParties(
  account: string,
  from: string,
  to: string,
): "in" | "out" | "self" {
  const isFrom = sameAddr(account, from);
  const isTo = sameAddr(account, to);
  if (isFrom && isTo) return "self";
  if (isFrom) return "out";
  return "in";
}

// ---------------------------------------------------------------------------
// Native transfer mapper
// ---------------------------------------------------------------------------

/**
 * Map a native-coin transfer (ETH/FLR/SGB) from the tracked account's view.
 * Emits a SIGNED integer minor-unit amount (negative when leaving the wallet)
 * and attaches the fee ONLY when the tracked account is the sender.
 * Returns null if the account is neither party (shouldn't normally happen).
 */
export function mapNativeTransfer(
  chain: Chain,
  account: string,
  t: EvmNativeTransfer,
): MappedTransaction | null {
  const isFrom = sameAddr(account, t.from);
  const isTo = sameAddr(account, t.to);
  if (!isFrom && !isTo) return null;

  const assetId = nativeAssetIdForChain(chain);
  const direction = directionForParties(account, t.from, t.to);
  const magnitude = hexToDecimalString(t.valueWei);
  const signed = direction === "out" ? negateMinor(magnitude) : magnitude;

  // Fee is native and only charged to the sender; attribute once, here.
  const feeRaw = isFrom && t.feeWei != null ? hexToDecimalString(t.feeWei) : null;

  return {
    txHash: t.txHash,
    eventIndex: 0,
    assetId,
    chain,
    direction,
    txType: "transfer",
    amountRaw: signed,
    amountDecimal: null,
    decimalsAtEvent: EVM_NATIVE_DECIMALS,
    feeRaw,
    feeAssetId: feeRaw != null ? assetId : null,
    counterparty: direction === "out" ? normAddr(t.to) : normAddr(t.from),
    blockNumber: t.blockNumber,
    blockTime: t.blockTime,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// ERC-20 Transfer log mapper
// ---------------------------------------------------------------------------

/**
 * Map ONE ERC-20 Transfer log from the tracked account's perspective.
 * Returns null when the log is not an ERC-20 Transfer OR the account is not a
 * party to it. Untracked tokens are STILL returned (assetId=null) with the
 * contract recorded as currency/issuer so nothing is silently dropped.
 *
 * @param attachFee when true AND the account is the sender AND it is the tx
 *   sender, the native fee is attached to THIS leg (caller ensures once-only).
 */
export function mapErc20TransferLog(
  chain: Chain,
  account: string,
  ctx: EvmTxContext,
  log: EvmLog,
  attachFee: boolean,
): MappedTransaction | null {
  if (!isErc20TransferLog(log)) return null;

  const from = topicToAddress(log.topics[1]);
  const to = topicToAddress(log.topics[2]);
  const isFrom = sameAddr(account, from);
  const isTo = sameAddr(account, to);
  if (!isFrom && !isTo) return null;

  const direction = directionForParties(account, from, to);
  const magnitude = hexToDecimalString(log.data);
  const signed = direction === "out" ? negateMinor(magnitude) : magnitude;

  const resolved = resolveEvmAssetByContract(chain, log.address);
  const nativeId = nativeAssetIdForChain(chain);

  // Fee is native, only for the tx sender, and only when caller allows it here.
  const feeEligible =
    attachFee && isFrom && ctx.txFrom != null && sameAddr(account, ctx.txFrom) && ctx.feeWei != null;
  const feeRaw = feeEligible ? hexToDecimalString(ctx.feeWei as string) : null;

  const base: MappedTransaction = {
    txHash: ctx.txHash,
    eventIndex: log.logIndex,
    assetId: resolved ? resolved.assetId : null,
    chain,
    direction,
    txType: "transfer",
    amountRaw: signed,
    amountDecimal: null,
    decimalsAtEvent: resolved ? resolved.decimals : null,
    feeRaw,
    feeAssetId: feeRaw != null ? nativeId : null,
    counterparty: direction === "out" ? to : from,
    blockNumber: ctx.blockNumber,
    blockTime: ctx.blockTime,
    success: true,
  };

  if (!resolved) {
    // Untracked token — keep the record, record the contract so we never guess.
    base.currency = normAddr(log.address);
    base.issuer = normAddr(log.address);
  }

  return base;
}

/**
 * Map ALL ERC-20 Transfer logs for a single transaction, from the tracked
 * account's perspective. The native fee is attached to AT MOST ONE leg across
 * the whole transaction (the first leg where the account is the sender), so the
 * fee is never double-counted.
 */
export function mapErc20TransferLogs(
  chain: Chain,
  account: string,
  ctx: EvmTxContext,
  logs: EvmLog[],
): MappedTransaction[] {
  const out: MappedTransaction[] = [];
  let feeAttached = false;
  for (const log of logs ?? []) {
    if (!isErc20TransferLog(log)) continue;
    const from = topicToAddress(log.topics[1]);
    const accountIsSender = sameAddr(account, from);
    const canAttachFeeHere = !feeAttached && accountIsSender;
    const mapped = mapErc20TransferLog(chain, account, ctx, log, canAttachFeeHere);
    if (mapped == null) continue;
    if (mapped.feeRaw != null) feeAttached = true;
    out.push(mapped);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run under tsx by run-pure-selftests.ts)
// ---------------------------------------------------------------------------

/** Tiny assertion helper (throws with a clear message on failure). */
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`evm-map-core self-test failed: ${msg}`);
}

const A = "0x1111111111111111111111111111111111111111"; // tracked account
const B = "0x2222222222222222222222222222222222222222"; // counterparty
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7"; // USDT-eth (6 dec)

/** Build a 32-byte indexed address topic (left-padded) for tests. */
function addrTopic(addr: string): string {
  return "0x" + normAddr(addr).replace(/^0x/, "").padStart(64, "0");
}

/** Build a uint256 hex data word for tests. */
function u256(dec: string): string {
  return "0x" + BigInt(dec).toString(16).padStart(64, "0");
}

export function __runEvmMapCoreTests(): void {
  // --- constant ---
  assert(
    ERC20_TRANSFER_TOPIC0 ===
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "topic0 constant",
  );

  // --- topicToAddress: checksum → lower-cased last 20 bytes ---
  assert(topicToAddress(addrTopic(A)) === A, "topicToAddress round-trip");
  assert(
    topicToAddress("0x000000000000000000000000DAC17F958D2EE523A2206206994597C13D831EC7") ===
      USDT,
    "topicToAddress lower-cases checksum",
  );

  // --- hexToDecimalString: exact hex + decimal + max-uint256 ---
  assert(hexToDecimalString("0x00") === "0", "hex zero");
  assert(hexToDecimalString(u256("1000000")) === "1000000", "hex 1e6");
  assert(hexToDecimalString("1000000") === "1000000", "decimal passthrough");
  const MAX_U256 =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";
  assert(hexToDecimalString(u256(MAX_U256)) === MAX_U256, "max uint256 exact");

  // --- negateMinor ---
  assert(negateMinor("0") === "0", "negate zero stays zero");
  assert(negateMinor("500") === "-500", "negate positive");

  // --- ERC-20 vs ERC-721 discrimination (3 vs 4 topics) ---
  const erc20Log: EvmLog = {
    address: USDT,
    topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
    data: u256("1000000"),
    logIndex: 5,
  };
  const erc721Log: EvmLog = {
    address: "0x1234567890123456789012345678901234567890",
    topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B), u256("42")],
    data: "0x",
    logIndex: 6,
  };
  assert(isErc20TransferLog(erc20Log), "erc20 recognised (3 topics)");
  assert(!isErc20TransferLog(erc721Log), "erc721 NOT an erc20 (4 topics)");
  assert(isErc721TransferLog(erc721Log), "erc721 recognised (4 topics)");
  assert(!isErc721TransferLog(erc20Log), "erc20 not flagged erc721");

  // NFT must map to null (never mis-ingested as fungible).
  const ctx: EvmTxContext = {
    txHash: "0xtx",
    blockNumber: 100,
    blockTime: "2024-01-01T00:00:00Z",
    txFrom: A,
    feeWei: "21000",
  };
  assert(
    mapErc20TransferLog("ethereum", A, ctx, erc721Log, true) === null,
    "erc721 log maps to null",
  );

  // --- ERC-20 OUT (tracked USDT), 6-dec, signed negative, fee once ---
  const out20 = mapErc20TransferLog("ethereum", A, ctx, erc20Log, true);
  assert(out20 !== null, "erc20 OUT mapped");
  assert(out20!.assetId === "usdt-eth", "erc20 resolves usdt-eth");
  assert(out20!.decimalsAtEvent === 6, "usdt is 6-dec (not 18)");
  assert(out20!.direction === "out", "erc20 OUT direction");
  assert(out20!.amountRaw === "-1000000", "erc20 OUT signed negative");
  assert(out20!.feeRaw === "21000", "erc20 OUT fee attached (sender=txFrom)");
  assert(out20!.feeAssetId === "eth", "erc20 fee is native eth");
  assert(out20!.counterparty === B, "erc20 OUT counterparty = to");
  assert(out20!.eventIndex === 5, "erc20 eventIndex = logIndex");

  // --- ERC-20 IN (no fee, positive) ---
  const inLog: EvmLog = {
    address: USDT,
    topics: [ERC20_TRANSFER_TOPIC0, addrTopic(B), addrTopic(A)],
    data: u256("2500000"),
    logIndex: 7,
  };
  const ctxIn: EvmTxContext = { ...ctx, txFrom: B };
  const in20 = mapErc20TransferLog("ethereum", A, ctxIn, inLog, true);
  assert(in20 !== null, "erc20 IN mapped");
  assert(in20!.direction === "in", "erc20 IN direction");
  assert(in20!.amountRaw === "2500000", "erc20 IN positive");
  assert(in20!.feeRaw === null, "erc20 IN no fee (account not sender)");

  // --- untracked token kept (assetId null, contract recorded) ---
  const UNKNOWN = "0x9999999999999999999999999999999999999999";
  const unkLog: EvmLog = {
    address: UNKNOWN,
    topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
    data: u256("777"),
    logIndex: 8,
  };
  const unk = mapErc20TransferLog("ethereum", A, ctx, unkLog, false);
  assert(unk !== null, "untracked token kept");
  assert(unk!.assetId === null, "untracked assetId null");
  assert(unk!.currency === UNKNOWN, "untracked currency = contract");
  assert(unk!.issuer === UNKNOWN, "untracked issuer = contract");
  assert(unk!.decimalsAtEvent === null, "untracked decimals null");

  // --- chain-scoping: USDT resolves on ethereum, not flare ---
  assert(resolveEvmAssetByContract("ethereum", USDT) !== null, "usdt on ethereum");
  assert(resolveEvmAssetByContract("flare", USDT) === null, "usdt NOT on flare");

  // --- native transfer OUT signed + fee; IN no fee ---
  const nativeOut = mapNativeTransfer("ethereum", A, {
    txHash: "0xn1",
    from: A,
    to: B,
    valueWei: "1000000000000000000", // 1 ETH
    blockNumber: 200,
    blockTime: "2024-02-02T00:00:00Z",
    feeWei: "21000000000000",
  });
  assert(nativeOut !== null, "native OUT mapped");
  assert(nativeOut!.assetId === "eth", "native OUT eth");
  assert(nativeOut!.direction === "out", "native OUT direction");
  assert(nativeOut!.amountRaw === "-1000000000000000000", "native OUT signed");
  assert(nativeOut!.feeRaw === "21000000000000", "native OUT fee attached");
  assert(nativeOut!.decimalsAtEvent === 18, "native 18-dec");

  const nativeIn = mapNativeTransfer("flare", A, {
    txHash: "0xn2",
    from: B,
    to: A,
    valueWei: "5000000000000000000",
    blockNumber: 201,
    blockTime: "2024-02-03T00:00:00Z",
    feeWei: "12345",
  });
  assert(nativeIn !== null, "native IN mapped");
  assert(nativeIn!.assetId === "flr", "native IN flr");
  assert(nativeIn!.direction === "in", "native IN direction");
  assert(nativeIn!.amountRaw === "5000000000000000000", "native IN positive");
  assert(nativeIn!.feeRaw === null, "native IN no fee (not sender)");

  // --- self transfer (account is both from and to) ---
  const selfNative = mapNativeTransfer("songbird", A, {
    txHash: "0xn3",
    from: A,
    to: A,
    valueWei: "10",
    blockNumber: 202,
    blockTime: "2024-02-04T00:00:00Z",
    feeWei: "3",
  });
  assert(selfNative!.direction === "self", "native self direction");
  assert(selfNative!.assetId === "sgb", "native self sgb");

  // --- fee attached at most once across multiple OUT legs ---
  const multiLogs: EvmLog[] = [
    {
      address: USDT,
      topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
      data: u256("100"),
      logIndex: 0,
    },
    {
      address: USDT,
      topics: [ERC20_TRANSFER_TOPIC0, addrTopic(A), addrTopic(B)],
      data: u256("200"),
      logIndex: 1,
    },
  ];
  const multi = mapErc20TransferLogs("ethereum", A, ctx, multiLogs);
  assert(multi.length === 2, "two legs mapped");
  const withFee = multi.filter((m) => m.feeRaw != null);
  assert(withFee.length === 1, "fee attached exactly once across legs");
  assert(withFee[0].feeRaw === "21000", "fee value correct");

  console.log("evm-map-core self-tests: all passed");
}
