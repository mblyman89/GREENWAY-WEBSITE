/**
 * evm-receipt-core.ts — PURE, guess-free transaction-receipt log enrichment.
 *
 * PURPOSE
 * -------
 * The C7 DeFi classifier (evm-defi-core.ts) inspects the FULL set of logs in a
 * transaction to decide whether it was an LP add / LP remove / swap / plain
 * transfer. But the sync server only had the ERC-20 Transfer logs (decoded by
 * the `tokentx` endpoint) — it never saw the pool Mint/Burn/Swap/Sync events
 * that live in the SAME transaction but are NOT ERC-20 Transfers. So the
 * classifier could never fire on real data.
 *
 * C7b closes that gap by fetching the transaction RECEIPT for each transaction
 * in a sync window. A receipt (eth_getTransactionReceipt) contains `logs[]` —
 * every event emitted by every contract touched in that transaction. This pure
 * module turns that raw JSON-RPC receipt into the dense `EvmLog[]` shape that
 * evm-map-core and evm-defi-core already consume, with zero guessing.
 *
 * DESIGN RULES (never guessed — every fact is first-party verified):
 *   - The receipt endpoint is `module=proxy&action=eth_getTransactionReceipt`
 *     and returns a JSON-RPC envelope `{ jsonrpc, id, result }`. See the
 *     research doc research/c7b-receipt-log-research.md for verified shapes.
 *   - `result` can be `null` when the transaction is not yet mined (pending).
 *     We return ok=true with a null receipt in that case (it is not an error).
 *   - `result.status` is "0x1" (success) or "0x0" (reverted). We still parse a
 *     reverted receipt's logs for audit completeness.
 *   - Blockscout (Flare/Songbird) returns `null` for UNUSED topic slots in the
 *     `topics` array, while the EvmLog interface expects a dense `string[]`.
 *     We filter out null topics so a sparse topics array never mis-indices.
 *   - `logIndex` is a hex string in the receipt; we parse it to a number.
 *   - This file has NO `import "server-only"` so it runs under tsx self-tests.
 *   - No floats. No BigInt literals (ES2017 target): use BigInt(...) if needed.
 *
 * VERIFIED RECEIPT LOG SHAPE (Etherscan proxy / Blockscout):
 *   {
 *     address:        "0x...",            // emitting contract
 *     topics:         ["0x...", null, "0x..."],  // null = unused indexed slot
 *     data:           "0x...",            // ABI-encoded non-indexed args
 *     logIndex:       "0xdb",            // hex position within the block
 *     transactionHash:"0x...",
 *     blockNumber:    "0xcf2427",         // hex
 *     removed:        false              // true if log was removed in a reorg
 *   }
 */

import type { EvmLog } from "./evm-map-core";
import { classifyEvmTxType } from "./evm-defi-core";

// ---------------------------------------------------------------------------
// Types — the raw shapes returned by eth_getTransactionReceipt
// ---------------------------------------------------------------------------

/**
 * A single raw log entry from a receipt's `logs[]` array. The fields are hex
 * strings (or null for unused topic slots) exactly as the explorer returns
 * them. We type them loosely (string | null) so the parser can be defensive
 * without the type system fighting us.
 */
export interface EvmReceiptLog {
  /** Emitting contract address (any case; we do not normalise here). */
  address: string | null;
  /**
   * Indexed topics. topics[0] is the event-signature hash. Blockscout inserts
   * `null` for unused indexed slots, so this is a sparse array of
   * (string | null). We keep the raw shape here and densify in the converter.
   */
  topics: (string | null)[] | null;
  /** ABI-encoded non-indexed args (hex string). */
  data: string | null;
  /** Hex string position of this log within its block (e.g. "0xdb"). */
  logIndex: string | null;
  /** The transaction hash this log belongs to (hex string). */
  transactionHash: string | null;
  /** Block number as a hex string (e.g. "0xcf2427"). */
  blockNumber: string | null;
  /** True if the log was removed due to a chain reorg. */
  removed?: boolean | null;
}

/**
 * The parsed receipt object (the `result` field of the JSON-RPC response). All
 * scalar fields are hex strings exactly as returned by the explorer.
 */
export interface EvmReceipt {
  /** "0x1" = success, "0x0" = reverted. */
  status: string | null;
  /** Sender address (hex string). */
  from: string | null;
  /** Recipient address (hex string, or null for contract creation). */
  to: string | null;
  /** Gas used (hex string). */
  gasUsed: string | null;
  /** Effective gas price in wei (hex string). */
  effectiveGasPrice: string | null;
  /** Block number (hex string). */
  blockNumber: string | null;
  /** The transaction hash (hex string). */
  transactionHash: string | null;
  /** All event logs emitted by all contracts in this transaction. */
  logs: EvmReceiptLog[] | null;
}

/**
 * The parsed result of a receipt fetch. Mirrors EvmExplorerResult from
 * evm-client-core but is defined locally so this pure module does not depend on
 * the client-core's broader surface (it only needs the union shape). The
 * `result` is `EvmReceipt | null` — null means the transaction is pending
 * (not yet mined), which is a valid, non-error outcome.
 */
export type EvmReceiptResult =
  | { ok: true; result: EvmReceipt | null }
  | { ok: false; error: string; retryable: boolean };

// ---------------------------------------------------------------------------
// Receipt-envelope parsing
// ---------------------------------------------------------------------------

/**
 * Parse the JSON-RPC envelope returned by `eth_getTransactionReceipt`. The
 * explorer returns `{ jsonrpc: "2.0", id: N, result: <receipt | null> }` on
 * success, or an `{ error: { code, message } }` object on a JSON-RPC error.
 *
 * - `result === null` means the transaction is pending (not yet mined). We
 *   return ok=true with null — it is not a fetch failure, just no receipt yet.
 * - `result` present but not an object is treated as a hard parse error.
 * - A JSON-RPC `error` field is a retryable explorer hiccup (rate limit, etc.).
 * - Empty/non-JSON body is retryable (transient network blip).
 *
 * This function NEVER throws — it always returns a result object so the caller
 * can degrade gracefully.
 */
export function parseReceiptResult(body: unknown): EvmReceiptResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "empty or non-JSON receipt response", retryable: true };
  }
  const obj = body as {
    result?: unknown;
    error?: { message?: string; code?: number } | string;
    message?: string;
  };

  // JSON-RPC error envelope (explorer-side error, usually rate-limit / 5xx).
  if (obj.error) {
    const errMsg =
      typeof obj.error === "string"
        ? obj.error
        : obj.error.message ?? `JSON-RPC error code ${obj.error.code ?? "?"}`;
    return { ok: false, error: errMsg, retryable: true };
  }

  // Etherscan-style status/message on a proxy call that failed.
  if (obj.result === undefined && typeof obj.message === "string") {
    return { ok: false, error: obj.message, retryable: true };
  }

  // result === null is a PENDING transaction (valid, not an error).
  if (obj.result === null) {
    return { ok: true, result: null };
  }

  if (!obj.result || typeof obj.result !== "object") {
    return { ok: false, error: "missing receipt result", retryable: true };
  }

  const r = obj.result as Record<string, unknown>;
  const receipt: EvmReceipt = {
    status: typeof r.status === "string" ? r.status : null,
    from: typeof r.from === "string" ? r.from : null,
    to: typeof r.to === "string" ? r.to : null,
    gasUsed: typeof r.gasUsed === "string" ? r.gasUsed : null,
    effectiveGasPrice: typeof r.effectiveGasPrice === "string" ? r.effectiveGasPrice : null,
    blockNumber: typeof r.blockNumber === "string" ? r.blockNumber : null,
    transactionHash: typeof r.transactionHash === "string" ? r.transactionHash : null,
    logs: Array.isArray(r.logs) ? (r.logs as EvmReceiptLog[]) : null,
  };
  return { ok: true, result: receipt };
}

// ---------------------------------------------------------------------------
// Receipt-log → EvmLog conversion (densify topics, parse hex logIndex)
// ---------------------------------------------------------------------------

/**
 * Parse a hex string (e.g. "0xdb") to a non-negative integer. Returns 0 for
 * null / empty / unparseable — we never throw, and logIndex 0 is a safe
 * fallback (it only affects per-tx event ordering, never the tax truth).
 */
function parseHexIndex(hex: string | null): number {
  if (hex == null || hex === "") return 0;
  const v = hex.toLowerCase().startsWith("0x") ? hex : "0x" + hex;
  const n = Number.parseInt(v, 16);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Convert ONE raw receipt log into the dense `EvmLog` shape that evm-map-core
 * and evm-defi-core consume. This is the critical transformation:
 *   - Filters out `null` topic slots (Blockscout returns null for unused
 *     indexed params). The EvmLog interface expects a dense `string[]`, so a
 *     sparse `[topic0, null, topic2]` becomes `[topic0, topic2]`. This is safe
 *     because the classifier and mapper only look at topic0 (signature) and,
 *     for ERC-20 Transfers, topics[1]/topics[2] (from/to). Pool Mint/Burn/Swap
 *     events are matched by topic0 ALONE (anyLogHasTopic0), so densifying does
 *     not affect classification. For ERC-20 Transfer logs, the explorer never
 *     returns a sparse array (all 3 slots are always populated), so densifying
 *     is a no-op there.
 *   - Parses logIndex from hex to a number.
 *   - Returns null for a log with no address or no topics (malformed / skip).
 *
 * Note: the `EvmLog` interface does not carry a transaction hash — the tx hash
 * is provided by the `EvmTxContext` in the mapper, so we do not need the log's
 * own `transactionHash` field here.
 */
export function receiptLogToEvmLog(
  log: EvmReceiptLog | null | undefined,
): EvmLog | null {
  if (!log) return null;
  if (typeof log.address !== "string" || log.address.trim() === "") return null;
  if (!Array.isArray(log.topics)) return null;

  // Densify: keep only non-null, non-empty string topics.
  const denseTopics: string[] = [];
  for (const t of log.topics) {
    if (typeof t === "string" && t.trim() !== "") {
      denseTopics.push(t);
    }
  }
  // A log with zero topics after densifying is not useful for classification
  // (no event signature). Skip it so the classifier never sees a topicless log.
  if (denseTopics.length === 0) return null;

  const data = typeof log.data === "string" ? log.data : "0x";
  const logIndex = parseHexIndex(log.logIndex);

  return {
    address: log.address,
    topics: denseTopics,
    data,
    logIndex,
  };
}

/**
 * Convert ALL logs in a receipt into the dense `EvmLog[]` shape. Logs are kept
 * in their original receipt order (which is on-chain log order, ascending
 * logIndex). Returns [] for a null receipt (pending tx) or a receipt with no
 * logs. Never throws.
 */
export function receiptToEvmLogs(
  receipt: EvmReceipt | null | undefined,
): EvmLog[] {
  if (!receipt) return [];
  if (!Array.isArray(receipt.logs)) return [];
  const out: EvmLog[] = [];
  for (const rawLog of receipt.logs) {
    const converted = receiptLogToEvmLog(rawLog);
    if (converted != null) out.push(converted);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tx-hash selection (which receipts to fetch per sync window)
// ---------------------------------------------------------------------------

/**
 * Collect the unique transaction hashes from both txlist rows and tokentx rows.
 * Deduplicates so we never fetch the same receipt twice within a window. Returns
 * a stable, insertion-ordered array (txlist order first, then tokentx-only
 * hashes). Pure and deterministic.
 */
export function uniqueTxHashes(
  txHashes: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of txHashes) {
    if (typeof h !== "string") continue;
    const trimmed = h.trim().toLowerCase();
    if (trimmed === "" || trimmed === "0x" || trimmed === "0x0") continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Filter a list of unique tx hashes to only those that appear in the tokentx
 * rows. This is the key optimization: a transaction with NO ERC-20 activity
 * (pure native transfer, gas-only, or contract deployment) cannot be a DeFi
 * operation, so we skip fetching its receipt entirely. This keeps the extra
 * API calls per window to 0–5 for a personal wallet instead of one-per-tx.
 *
 * `tokenTxHashes` is the set of hashes that have at least one tokentx row.
 */
export function txHashesNeedingReceipts(
  txHashes: string[],
  tokenTxHashes: string[],
): string[] {
  const tokenSet = new Set(
    tokenTxHashes.map((h) => (typeof h === "string" ? h.trim().toLowerCase() : "")),
  );
  return txHashes.filter((h) => {
    const trimmed = typeof h === "string" ? h.trim().toLowerCase() : "";
    return trimmed !== "" && tokenSet.has(trimmed);
  });
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run under tsx by run-pure-selftests.ts)
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`evm-receipt-core self-test failed: ${msg}`);
}

/** A valid ERC-20 Transfer receipt log (3 dense topics). */
function erc20ReceiptLog(
  contract: string,
  from: string,
  to: string,
  valueHex: string,
  logIndexHex: string,
  txHash: string,
  blockHex: string,
): EvmReceiptLog {
  const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return {
    address: contract,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      pad(from),
      pad(to),
    ],
    data: "0x" + BigInt(valueHex).toString(16).padStart(64, "0"),
    logIndex: logIndexHex,
    transactionHash: txHash,
    blockNumber: blockHex,
    removed: false,
  };
}

/** A V2 Mint (LP add) receipt log — only 2 topics (signature + sender). */
function v2MintReceiptLog(
  pool: string,
  sender: string,
  logIndexHex: string,
  txHash: string,
): EvmReceiptLog {
  const pad = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  return {
    address: pool,
    topics: [
      "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f",
      pad(sender),
    ],
    data: "0x" + "ab".padStart(64, "0"),
    logIndex: logIndexHex,
    transactionHash: txHash,
    blockNumber: "0xcf2427",
    removed: false,
  };
}

const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const POOL = "0xaaa1111111111111111111111111111111111111";
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const TX1 = "0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1";

export function __runEvmReceiptCoreTests(): void {
  // === parseReceiptResult ===

  // --- empty / non-JSON body → retryable ---
  const empty = parseReceiptResult(null);
  assert(empty.ok === false && empty.retryable === true, "null body retryable");
  const nonObj = parseReceiptResult("nope");
  assert(nonObj.ok === false && nonObj.retryable === true, "string body retryable");

  // --- pending tx (result === null) → ok with null ---
  const pending = parseReceiptResult({ jsonrpc: "2.0", id: 1, result: null });
  assert(pending.ok === true && pending.result === null, "pending tx → ok null");

  // --- JSON-RPC error → retryable ---
  const rpcErr = parseReceiptResult({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32000, message: "rate limit" },
  });
  assert(rpcErr.ok === false && rpcErr.retryable === true, "json-rpc error retryable");
  const rpcErrStr = parseReceiptResult({ error: "boom" });
  assert(rpcErrStr.ok === false && rpcErrStr.error === "boom", "string error extracted");

  // --- etherscan-style message without result → retryable ---
  const msgOnly = parseReceiptResult({ message: "Max rate limit reached" });
  assert(msgOnly.ok === false && msgOnly.retryable === true, "message-only retryable");

  // --- a full successful receipt ---
  const fullReceiptBody = {
    jsonrpc: "2.0",
    id: 1,
    result: {
      status: "0x1",
      from: A,
      to: POOL,
      gasUsed: "0xb41d",
      effectiveGasPrice: "0x1a96b24c26",
      blockNumber: "0xcf2427",
      transactionHash: TX1,
      logs: [
        erc20ReceiptLog(USDT, A, POOL, "1000000", "0xd9", TX1, "0xcf2427"),
        erc20ReceiptLog(USDT, POOL, A, "500000", "0xda", TX1, "0xcf2427"),
        v2MintReceiptLog(POOL, A, "0xdb", TX1),
      ],
    },
  };
  const parsed = parseReceiptResult(fullReceiptBody);
  assert(parsed.ok === true, "full receipt ok");
  const receipt = parsed.ok ? parsed.result : null;
  assert(receipt !== null, "receipt not null");
  assert(receipt!.status === "0x1", "receipt status parsed");
  assert(receipt!.from === A, "receipt from parsed");
  assert(receipt!.to === POOL, "receipt to parsed");
  assert(receipt!.gasUsed === "0xb41d", "receipt gasUsed parsed");
  assert(receipt!.effectiveGasPrice === "0x1a96b24c26", "receipt gasPrice parsed");
  assert(receipt!.blockNumber === "0xcf2427", "receipt blockNumber parsed");
  assert(receipt!.transactionHash === TX1, "receipt txHash parsed");
  assert(Array.isArray(receipt!.logs) && receipt!.logs!.length === 3, "receipt has 3 logs");

  // --- receipt with missing optional fields → nulls, not crash ---
  const sparseReceiptBody = {
    jsonrpc: "2.0",
    id: 1,
    result: { logs: [] },
  };
  const sparseParsed = parseReceiptResult(sparseReceiptBody);
  assert(sparseParsed.ok === true, "sparse receipt ok");
  const sparseReceipt = sparseParsed.ok ? sparseParsed.result : null;
  assert(sparseReceipt !== null, "sparse receipt not null");
  assert(sparseReceipt!.status === null, "missing status → null");
  assert(sparseReceipt!.from === null, "missing from → null");
  assert(sparseReceipt!.logs != null && sparseReceipt!.logs!.length === 0, "empty logs array");

  // === receiptLogToEvmLog ===

  // --- dense ERC-20 log converts cleanly ---
  const ercLogSrc = erc20ReceiptLog(USDT, A, B, "1000000", "0xdb", TX1, "0xcf2427");
  const ercLog = receiptLogToEvmLog(ercLogSrc);
  assert(ercLog !== null, "erc20 log converts");
  assert(ercLog!.address === USDT, "erc20 address preserved");
  assert(ercLog!.topics.length === 3, "erc20 3 dense topics");
  assert(
    ercLog!.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "erc20 topic0 preserved",
  );
  assert(ercLog!.logIndex === 0xdb, "erc20 logIndex parsed from hex (0xdb = 219)");
  assert(ercLog!.data.length > 2, "erc20 data preserved");

  // --- sparse topics (null slots) are densified ---
  const sparseLog: EvmReceiptLog = {
    address: POOL,
    topics: [
      "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f",
      null,
    ],
    data: "0x",
    logIndex: "0x05",
    transactionHash: TX1,
    blockNumber: "0x1",
    removed: false,
  };
  const densified = receiptLogToEvmLog(sparseLog);
  assert(densified !== null, "sparse log converts (not null)");
  assert(densified!.topics.length === 1, "null topic slot filtered → 1 topic");
  assert(
    densified!.topics[0] === "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f",
    "sparse: topic0 preserved after densify",
  );

  // --- log with all-null topics → null (no event signature, useless) ---
  const noTopicsLog: EvmReceiptLog = {
    address: POOL,
    topics: [null, null],
    data: "0x",
    logIndex: "0x0",
    transactionHash: TX1,
    blockNumber: "0x1",
  };
  assert(receiptLogToEvmLog(noTopicsLog) === null, "all-null topics → null");

  // --- log with empty-string topics → null (densify yields nothing) ---
  const emptyTopicsLog: EvmReceiptLog = {
    address: POOL,
    topics: ["", ""],
    data: "0x",
    logIndex: "0x0",
    transactionHash: TX1,
    blockNumber: "0x1",
  };
  assert(receiptLogToEvmLog(emptyTopicsLog) === null, "empty-string topics → null");

  // --- log with no address → null ---
  const noAddrLog: EvmReceiptLog = {
    address: null,
    topics: ["0xabc"],
    data: "0x",
    logIndex: "0x0",
    transactionHash: TX1,
    blockNumber: "0x1",
  };
  assert(receiptLogToEvmLog(noAddrLog) === null, "null address → null");

  // --- log with null topics array → null ---
  const nullTopicsLog: EvmReceiptLog = {
    address: POOL,
    topics: null,
    data: "0x",
    logIndex: "0x0",
    transactionHash: TX1,
    blockNumber: "0x1",
  };
  assert(receiptLogToEvmLog(nullTopicsLog) === null, "null topics array → null");

  // --- null/undefined log → null ---
  assert(receiptLogToEvmLog(null) === null, "null log → null");
  assert(receiptLogToEvmLog(undefined) === null, "undefined log → null");

  // --- logIndex fallbacks ---
  const noLogIdx: EvmReceiptLog = {
    address: POOL,
    topics: ["0xabc"],
    data: "0x",
    logIndex: null,
    transactionHash: TX1,
    blockNumber: "0x1",
  };
  assert(receiptLogToEvmLog(noLogIdx)!.logIndex === 0, "null logIndex → 0");
  const badLogIdx: EvmReceiptLog = {
    address: POOL,
    topics: ["0xabc"],
    data: "0x",
    logIndex: "zzz",
    transactionHash: TX1,
    blockNumber: "0x1",
  };
  assert(receiptLogToEvmLog(badLogIdx)!.logIndex === 0, "bad logIndex → 0");

  // --- data fallback to "0x" when missing ---
  const noData: EvmReceiptLog = {
    address: POOL,
    topics: ["0xabc"],
    data: null,
    logIndex: "0x0",
    transactionHash: TX1,
    blockNumber: "0x1",
  };
  assert(receiptLogToEvmLog(noData)!.data === "0x", "null data → 0x");

  // === receiptToEvmLogs ===

  // --- full receipt → dense EvmLog[] in order ---
  const allLogs = receiptToEvmLogs(receipt);
  assert(allLogs.length === 3, "receiptToEvmLogs returns 3 logs");
  assert(allLogs[0].logIndex === 0xd9, "first log logIndex 0xd9");
  assert(allLogs[1].logIndex === 0xda, "second log logIndex 0xda");
  assert(allLogs[2].logIndex === 0xdb, "third log logIndex 0xdb");
  // The third log is the V2 Mint — only 2 topics (signature + sender).
  assert(allLogs[2].topics.length === 2, "V2 mint log has 2 topics");

  // --- null receipt → [] ---
  assert(receiptToEvmLogs(null).length === 0, "null receipt → empty");
  assert(receiptToEvmLogs(undefined).length === 0, "undefined receipt → empty");

  // --- receipt with null logs → [] ---
  const nullLogsReceipt: EvmReceipt = {
    status: "0x1",
    from: A,
    to: B,
    gasUsed: "0x1",
    effectiveGasPrice: "0x1",
    blockNumber: "0x1",
    transactionHash: TX1,
    logs: null,
  };
  assert(receiptToEvmLogs(nullLogsReceipt).length === 0, "null logs array → empty");

  // --- receipt with a malformed log mixed in → that log is dropped, others kept ---
  const mixedReceipt: EvmReceipt = {
    status: "0x1",
    from: A,
    to: B,
    gasUsed: "0x1",
    effectiveGasPrice: "0x1",
    blockNumber: "0x1",
    transactionHash: TX1,
    logs: [
      erc20ReceiptLog(USDT, A, B, "100", "0x0", TX1, "0x1"),
      { address: null, topics: ["0x"], data: "0x", logIndex: "0x1", transactionHash: TX1, blockNumber: "0x1" }, // bad: no address
      v2MintReceiptLog(POOL, A, "0x2", TX1),
    ],
  };
  const mixed = receiptToEvmLogs(mixedReceipt);
  assert(mixed.length === 2, "mixed receipt: bad log dropped, 2 kept");

  // === uniqueTxHashes ===

  // --- dedup + normalisation ---
  const hashes = uniqueTxHashes([
    TX1,
    TX1.toUpperCase(), // same hash, different case → deduped
    "0x" + "f".repeat(64),
    "0x" + "f".repeat(64), // exact dup → deduped
    "",
    "0x",
    "0x0",
  ]);
  assert(hashes.length === 2, "uniqueTxHashes dedups to 2");
  assert(hashes[0] === TX1.toLowerCase(), "first hash is TX1 lowercased");
  assert(hashes[1] === "0x" + "f".repeat(64), "second hash is the f-repeat");

  // --- empty / garbage ---
  assert(uniqueTxHashes([]).length === 0, "empty input → empty");
  assert(uniqueTxHashes(["", "0x", "0x0"]).length === 0, "only garbage → empty");

  // === txHashesNeedingReceipts ===

  const allHashes = [TX1, "0x" + "a".repeat(64), "0x" + "b".repeat(64)];
  const tokenHashes = [TX1, "0x" + "b".repeat(64)];
  const needing = txHashesNeedingReceipts(allHashes, tokenHashes);
  assert(needing.length === 2, "only txs with token activity need receipts");
  assert(needing.includes(TX1.toLowerCase()), "TX1 (has token activity) included");
  assert(
    needing.includes("0x" + "b".repeat(64)),
    "b-hash (has token activity) included",
  );
  assert(
    !needing.includes("0x" + "a".repeat(64)),
    "a-hash (no token activity) excluded",
  );

  // --- case-insensitive matching ---
  const needingUpper = txHashesNeedingReceipts([TX1.toUpperCase()], [TX1.toLowerCase()]);
  assert(needingUpper.length === 1, "case-insensitive hash matching");

  // --- no token activity → no receipts needed ---
  assert(
    txHashesNeedingReceipts(allHashes, []).length === 0,
    "no token txs → no receipts needed",
  );

  // --- empty inputs ---
  assert(txHashesNeedingReceipts([], tokenHashes).length === 0, "no txs → empty");

  // === Integration: receipt logs feed the classifier correctly ===
  // (This proves the full pipeline: receipt → EvmLog[] → classifier would see
  // the V2 Mint event.)
  const receiptLogs = receiptToEvmLogs(receipt);
  const txType = classifyEvmTxType(receiptLogs);
  assert(txType === "lp_add", "receipt with V2 Mint → classifier says lp_add");

  // A receipt with ONLY ERC-20 transfers (no pool event) → transfer.
  const plainReceipt: EvmReceipt = {
    status: "0x1",
    from: A,
    to: B,
    gasUsed: "0x1",
    effectiveGasPrice: "0x1",
    blockNumber: "0x1",
    transactionHash: TX1,
    logs: [erc20ReceiptLog(USDT, A, B, "1000000", "0x0", TX1, "0x1")],
  };
  const plainLogs = receiptToEvmLogs(plainReceipt);
  assert(classifyEvmTxType(plainLogs) === "transfer", "plain ERC-20 receipt → transfer");

  console.log("evm-receipt-core self-tests: all passed");
}
