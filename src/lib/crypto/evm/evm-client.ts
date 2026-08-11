import "server-only";

/**
 * src/lib/crypto/evm/evm-client.ts — C6b
 *
 * The server-only, read-only EVM explorer client. It talks to the FREE
 * Etherscan-compatible REST APIs over HTTPS:
 *   - Ethereum  → Etherscan V2 (https://api.etherscan.io/v2/api) — needs a FREE
 *                 API key (ETHERSCAN_API_KEY env var). Free tier ≈ 5 calls/sec.
 *   - Flare     → Flare's official Blockscout explorer (keyless).
 *   - Songbird  → Songbird's official Blockscout explorer (keyless).
 *
 * All three speak the SAME Etherscan-compatible API shape:
 *   ?module=account&action=balance     → native coin balance (wei)
 *   ?module=account&action=txlist      → native transfers + gas/fee fields
 *   ?module=account&action=tokentx     → ERC-20 Transfer events (decoded)
 *   ?module=proxy&action=eth_blockNumber → current chain tip (hex)
 *
 * WATCH-ONLY: this client can ONLY read. It never signs, submits, or moves
 * anything. It cannot, by construction, touch Michael's funds. We use ONLY the
 * wallet's PUBLIC address.
 *
 * FAIR USE: these explorers are shared public infrastructure, so every call is
 * spaced by a minimum interval (220 ms) and transient failures (429, 5xx, rate
 * limit messages, network timeouts) are retried with exponential backoff. All
 * of that POLICY lives in the pure `evm-client-core` (and is self-tested); this
 * file is the thin shell that performs `fetch` and `sleep`.
 *
 * ENV VARS (all OPTIONAL with safe defaults — only ETHERSCAN_API_KEY is needed
 * and only for Ethereum):
 *   ETHERSCAN_API_KEY   — free key from etherscan.io (Ethereum only; no key =
 *                         the call still works but is treated as the anonymous
 *                         tier which is more aggressively rate-limited).
 *   ETHERSCAN_API_URL   — override the Ethereum V2 base URL.
 *   FLARE_EXPLORER_URL  — override the Flare explorer base URL.
 *   SONGBIRD_EXPLORER_URL — override the Songbird explorer base URL.
 *
 * Nothing here parses balances or transactions into tax records — that is the
 * job of the pure `evm-map-core`. This client returns the raw decoded rows so
 * the mappers stay the single source of tax truth.
 */

import {
  resolveEvmExplorerBase,
  chainNeedsApiKey,
  clampPageSize,
  balanceRequest,
  txlistRequest,
  tokentxRequest,
  blockNumberRequest,
  receiptRequest,
  isBlockscoutChain,
  blockNumberJsonRpcRequest,
  receiptJsonRpcRequest,
  isJsonRpcError,
  interpretExplorerBody,
  parseBlockNumberResult,
  isRetryableHttpStatus,
  nextRequestDelayMs,
  backoffDelayMs,
  shouldRetry,
  EVM_MIN_REQUEST_SPACING_MS,
  EVM_REQUEST_TIMEOUT_MS,
  EVM_MAX_RETRIES,
  type EvmExplorerResult,
  type EvmTxListRow,
  type EvmTokenTxRow,
} from "./evm-client-core";
import { parseReceiptResult, type EvmReceipt, type EvmReceiptResult } from "./evm-receipt-core";
import {
  tokenListRequest,
  getTokenRequest,
  decimalsEthCallRequest,
  asTokenListRows,
  asGetTokenResult,
  ethCallResultHex,
  type TokenListRow,
  type GetTokenResult,
} from "./evm-token-discovery-core";
import { isEvmChain, type Chain } from "../crypto-core";

/**
 * Resolve the per-chain API key. Only Ethereum reads ETHERSCAN_API_KEY from
 * env. Flare and Songbird are keyless (return null).
 */
function apiKeyForChain(chain: Chain): string | null {
  if (!chainNeedsApiKey(chain)) return null;
  const raw = process.env.ETHERSCAN_API_KEY;
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

/**
 * Resolve an optional per-chain endpoint override from env. Returns null when
 * no override is set (the core's built-in default is used).
 */
function explorerOverride(chain: Chain): string | null {
  if (chain === "ethereum") {
    const v = process.env.ETHERSCAN_API_URL;
    return v && v.trim().length > 0 ? v.trim() : null;
  }
  if (chain === "flare") {
    const v = process.env.FLARE_EXPLORER_URL;
    return v && v.trim().length > 0 ? v.trim() : null;
  }
  if (chain === "songbird") {
    const v = process.env.SONGBIRD_EXPLORER_URL;
    return v && v.trim().length > 0 ? v.trim() : null;
  }
  return null;
}

/** Serialize + space requests across the whole process to respect fair use. */
let lastRequestAtMs: number | null = null;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a single HTTPS GET with a timeout. Returns the parsed body or throws
 * on network failure (the caller decides retry).
 */
async function getOnce(url: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVM_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Perform a single HTTPS POST with a timeout (for Blockscout JSON-RPC). Returns
 * the parsed body or throws on network failure (the caller decides retry).
 * Mirrors `getOnce` but sends a JSON body with Content-Type: application/json.
 */
async function postOnce(url: string, jsonBody: string): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EVM_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: jsonBody,
      signal: controller.signal,
      cache: "no-store",
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one request through the throttle + retry/backoff policy. All calls are
 * chained on a single queue so we never exceed the shared explorer's fair-use
 * spacing, even under concurrent callers.
 */
async function call<T>(url: string, interpret: (body: unknown) => EvmExplorerResult<T>): Promise<EvmExplorerResult<T>> {
  const run = async (): Promise<EvmExplorerResult<T>> => {
    let attempt = 0;
    for (;;) {
      const wait = nextRequestDelayMs(lastRequestAtMs, Date.now(), EVM_MIN_REQUEST_SPACING_MS);
      if (wait > 0) await sleep(wait);
      lastRequestAtMs = Date.now();

      try {
        const { status, body } = await getOnce(url);
        if (status >= 200 && status < 300) {
          const interpreted = interpret(body);
          if (interpreted.ok) return interpreted;
          if (shouldRetry(attempt, interpreted.retryable, EVM_MAX_RETRIES)) {
            await sleep(backoffDelayMs(attempt, 500, 8000));
            attempt += 1;
            continue;
          }
          return interpreted;
        }
        if (shouldRetry(attempt, isRetryableHttpStatus(status), EVM_MAX_RETRIES)) {
          await sleep(backoffDelayMs(attempt, 500, 8000));
          attempt += 1;
          continue;
        }
        return { ok: false, error: `HTTP ${status}`, retryable: false };
      } catch (err) {
        if (shouldRetry(attempt, true, EVM_MAX_RETRIES)) {
          await sleep(backoffDelayMs(attempt, 500, 8000));
          attempt += 1;
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `network: ${message}`, retryable: false };
      }
    }
  };

  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result as Promise<EvmExplorerResult<T>>;
}

/**
 * Run one JSON-RPC POST request through the SAME throttle + retry/backoff
 * policy as `call`. Used for Blockscout's /api/eth-rpc endpoint (Flare +
 * Songbird), which requires POST with a JSON-RPC body instead of the GET
 * proxy module that Etherscan V2 uses. Shares the same queue + spacing so
 * we never exceed the shared explorer's fair-use rate, even under concurrent
 * callers mixing GET and POST requests.
 */
async function callPost<T>(
  url: string,
  jsonBody: string,
  interpret: (body: unknown) => EvmExplorerResult<T>,
): Promise<EvmExplorerResult<T>> {
  const run = async (): Promise<EvmExplorerResult<T>> => {
    let attempt = 0;
    for (;;) {
      const wait = nextRequestDelayMs(lastRequestAtMs, Date.now(), EVM_MIN_REQUEST_SPACING_MS);
      if (wait > 0) await sleep(wait);
      lastRequestAtMs = Date.now();

      try {
        const { status, body } = await postOnce(url, jsonBody);
        if (status >= 200 && status < 300) {
          const interpreted = interpret(body);
          if (interpreted.ok) return interpreted;
          if (shouldRetry(attempt, interpreted.retryable, EVM_MAX_RETRIES)) {
            await sleep(backoffDelayMs(attempt, 500, 8000));
            attempt += 1;
            continue;
          }
          return interpreted;
        }
        if (shouldRetry(attempt, isRetryableHttpStatus(status), EVM_MAX_RETRIES)) {
          await sleep(backoffDelayMs(attempt, 500, 8000));
          attempt += 1;
          continue;
        }
        return { ok: false, error: `HTTP ${status}`, retryable: false };
      } catch (err) {
        if (shouldRetry(attempt, true, EVM_MAX_RETRIES)) {
          await sleep(backoffDelayMs(attempt, 500, 8000));
          attempt += 1;
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `network: ${message}`, retryable: false };
      }
    }
  };

  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result as Promise<EvmExplorerResult<T>>;
}

// ---------------------------------------------------------------------------
// Public read methods (return the raw decoded rows; mappers do the parsing)
// ---------------------------------------------------------------------------

/**
 * Fetch the native coin balance (in wei) for an address on a chain. Returns
 * the balance as a decimal STRING (wei routinely exceeds Number.MAX_SAFE).
 */
export async function fetchNativeBalance(
  chain: Chain,
  address: string,
): Promise<EvmExplorerResult<string>> {
  if (!isEvmChain(chain)) {
    return { ok: false, error: `Not an EVM chain: ${chain}`, retryable: false };
  }
  const req = balanceRequest(chain, address, apiKeyForChain(chain));
  const res = await call<string>(req.url, (body) => {
    const interpreted = interpretExplorerBody(body);
    if (!interpreted.ok) return interpreted as EvmExplorerResult<string>;
    // balance action returns a single decimal string in `result`.
    const result = interpreted.result;
    const balance = typeof result === "string" ? result : Array.isArray(result) && result.length > 0 && typeof result[0] === "object" && result[0] !== null && "balance" in (result[0] as Record<string, unknown>) ? String((result[0] as { balance: unknown }).balance) : typeof result === "string" ? result : "";
    if (balance === "") {
      return { ok: false, error: "missing balance in response", retryable: true };
    }
    return { ok: true, result: balance };
  });
  return res;
}

/**
 * Fetch ONE page of native transfers (txlist) for a block range. Returns the
 * decoded `EvmTxListRow[]`. Backfill/pagination by block range is orchestrated
 * by evm-sync-server; this returns one page so the orchestrator can narrow or
 * advance the window.
 */
export async function fetchTxList(
  chain: Chain,
  address: string,
  opts: { startBlock: number; endBlock: number; page?: number; offset?: number },
): Promise<EvmExplorerResult<EvmTxListRow[]>> {
  if (!isEvmChain(chain)) {
    return { ok: false, error: `Not an EVM chain: ${chain}`, retryable: false };
  }
  const offset = clampPageSize(opts.offset);
  const req = txlistRequest(chain, address, apiKeyForChain(chain), {
    startBlock: opts.startBlock,
    endBlock: opts.endBlock,
    page: opts.page ?? 1,
    offset,
    sort: "asc",
  });
  const res = await call<EvmTxListRow[]>(req.url, (body) => {
    const interpreted = interpretExplorerBody(body);
    if (!interpreted.ok) return interpreted as EvmExplorerResult<EvmTxListRow[]>;
    const rows = Array.isArray(interpreted.result) ? (interpreted.result as EvmTxListRow[]) : [];
    return { ok: true, result: rows };
  });
  return res;
}

/**
 * Fetch ONE page of ERC-20 Transfer events (tokentx) for a block range. Returns
 * the decoded `EvmTokenTxRow[]`. As with fetchTxList, block-range orchestration
 * lives in the sync server.
 */
export async function fetchTokenTx(
  chain: Chain,
  address: string,
  opts: { startBlock: number; endBlock: number; page?: number; offset?: number },
): Promise<EvmExplorerResult<EvmTokenTxRow[]>> {
  if (!isEvmChain(chain)) {
    return { ok: false, error: `Not an EVM chain: ${chain}`, retryable: false };
  }
  const offset = clampPageSize(opts.offset);
  const req = tokentxRequest(chain, address, apiKeyForChain(chain), {
    startBlock: opts.startBlock,
    endBlock: opts.endBlock,
    page: opts.page ?? 1,
    offset,
    sort: "asc",
  });
  const res = await call<EvmTokenTxRow[]>(req.url, (body) => {
    const interpreted = interpretExplorerBody(body);
    if (!interpreted.ok) return interpreted as EvmExplorerResult<EvmTokenTxRow[]>;
    const rows = Array.isArray(interpreted.result) ? (interpreted.result as EvmTokenTxRow[]) : [];
    return { ok: true, result: rows };
  });
  return res;
}

/**
 * Fetch the current chain tip block number. Used to bound the backfill window
 * so we walk only the real tip.
 *
 * DUAL TRANSPORT (C8):
 * - Blockscout chains (Flare, Songbird): POST JSON-RPC to {base}/eth-rpc.
 *   Blockscout does NOT support the `module=proxy` GET endpoint that Etherscan
 *   uses (it returns "Unknown module"). The JSON-RPC response shape
 *   ({jsonrpc, result, id}) is identical, so parseBlockNumberResult works
 *   unchanged for both transports.
 * - Ethereum (Etherscan V2): GET ?module=proxy&action=eth_blockNumber (the
 *   existing path, which works with an API key).
 */
export async function fetchTipBlockNumber(chain: Chain): Promise<EvmExplorerResult<number>> {
  if (!isEvmChain(chain)) {
    return { ok: false, error: `Not an EVM chain: ${chain}`, retryable: false };
  }
  // Blockscout chains: use JSON-RPC POST.
  if (isBlockscoutChain(chain)) {
    const req = blockNumberJsonRpcRequest(chain);
    if (req === null) {
      return { ok: false, error: `Could not build JSON-RPC request for ${chain}`, retryable: false };
    }
    return callPost<number>(req.url, req.body, (body) => {
      // Blockscout JSON-RPC errors are {jsonrpc, error: "...", id}.
      if (isJsonRpcError(body)) {
        const obj = body as { error?: unknown };
        const msg = typeof obj.error === "string" ? obj.error : "JSON-RPC error";
        return { ok: false, error: msg, retryable: false };
      }
      return parseBlockNumberResult(body);
    });
  }
  // Ethereum (Etherscan V2): use the existing GET proxy module.
  const req = blockNumberRequest(chain, apiKeyForChain(chain));
  return call<number>(req.url, (body) => parseBlockNumberResult(body));
}

/**
 * Fetch the full transaction receipt for a single transaction hash. The
 * receipt's `logs[]` array contains EVERY event emitted by EVERY contract in
 * that transaction — ERC-20 Transfers, pool Mint/Burn/Swap/Sync, WFLR
 * Deposit/Withdrawal, everything. This is what lets the C7 DeFi classifier
 * (evm-defi-core) see pool events and stamp legs as lp_add / lp_remove / swap
 * instead of the neutral "transfer".
 *
 * DUAL TRANSPORT (C8):
 * - Blockscout chains (Flare, Songbird): POST JSON-RPC to {base}/eth-rpc.
 *   Blockscout does NOT support the `module=proxy` GET endpoint (returns
 *   "Unknown module"). The JSON-RPC response shape is identical to Etherscan's
 *   proxy module, so parseReceiptResult works unchanged for both transports.
 * - Ethereum (Etherscan V2): GET ?module=proxy&action=eth_getTransactionReceipt
 *   (the existing path, which works with an API key).
 *
 * Returns an `EvmReceiptResult`:
 *   - ok=true, result=EvmReceipt — the receipt with its full log array.
 *   - ok=true, result=null — the transaction is pending (not yet mined). This
 *     is a valid outcome, NOT an error; the caller treats it as "no logs yet."
 *   - ok=false — a fetch/parse failure (rate limit, network, bad response).
 *     `retryable` indicates whether a retry might help.
 *
 * WATCH-ONLY: reads public chain data only. Never signs or submits anything.
 */
export async function fetchTransactionReceipt(
  chain: Chain,
  txHash: string,
): Promise<EvmReceiptResult> {
  if (!isEvmChain(chain)) {
    return { ok: false, error: `Not an EVM chain: ${chain}`, retryable: false };
  }
  // Blockscout chains: use JSON-RPC POST.
  if (isBlockscoutChain(chain)) {
    const req = receiptJsonRpcRequest(chain, txHash);
    if (req === null) {
      return { ok: false, error: `Could not build JSON-RPC request for ${chain}`, retryable: false };
    }
    return callPost<EvmReceipt | null>(req.url, req.body, (body) => {
      // Blockscout JSON-RPC errors are {jsonrpc, error: "...", id}.
      if (isJsonRpcError(body)) {
        const obj = body as { error?: unknown };
        const msg = typeof obj.error === "string" ? obj.error : "JSON-RPC error";
        return { ok: false, error: msg, retryable: false };
      }
      return parseReceiptResult(body);
    });
  }
  // Ethereum (Etherscan V2): use the existing GET proxy module.
  const req = receiptRequest(chain, txHash, apiKeyForChain(chain));
  return call<EvmReceipt | null>(req.url, (body) => parseReceiptResult(body));
}

/**
 * True when the explorer endpoint for a chain is usable. All three chains have
 * built-in free defaults, so this is true unless an explicitly-broken override
 * is configured (we treat a configured override as intentional). Ethereum
 * works even without a key (anonymous tier) but is more rate-limited.
 */
export function evmEndpointConfigured(chain: Chain): boolean {
  if (!isEvmChain(chain)) return false;
  try {
    resolveEvmExplorerBase(chain, explorerOverride(chain));
    return true;
  } catch {
    return false;
  }
}

/** The resolved base URL for a chain (for diagnostics / logging). */
export function evmExplorerBase(chain: Chain): string {
  return resolveEvmExplorerBase(chain, explorerOverride(chain));
}

// ---------------------------------------------------------------------------
// AREA 3 — alt-coin discovery reads. These fetch the raw payloads; the pure
// evm-token-discovery-core interprets them (discovery + decimals resolution).
// Watch-only: PUBLIC address / contract only, no keys involved for Blockscout.
// ---------------------------------------------------------------------------

/**
 * Fetch the FULL list of tokens an address holds (account&action=tokenlist).
 * Returns the raw rows; the core classifies ERC-20 vs NFT and resolves decimals.
 * On a "No tokens found" empty result the explorer returns status 0 with an
 * empty array — we treat that as an OK empty list (not an error).
 */
export async function fetchTokenList(
  chain: Chain,
  address: string,
): Promise<EvmExplorerResult<TokenListRow[]>> {
  if (!isEvmChain(chain)) {
    return { ok: false, error: `Not an EVM chain: ${chain}`, retryable: false };
  }
  const req = tokenListRequest(chain, address, apiKeyForChain(chain));
  return call<TokenListRow[]>(req.url, (body) => {
    // tokenlist returns {status, message, result:[...]}. Empty holdings come
    // back as status "0" + [] which interpretExplorerBody flags as an error;
    // for THIS action an empty list is a valid (not retryable) result.
    const rows = asTokenListRows(body);
    return { ok: true, result: rows };
  });
}

/**
 * Fetch a single token's metadata (token&action=getToken): name/symbol/decimals
 * /type. Used to resolve decimals when the tokenlist row's decimals is blank,
 * before falling back to the on-chain eth_call.
 */
export async function fetchTokenMeta(
  chain: Chain,
  contract: string,
): Promise<EvmExplorerResult<GetTokenResult | null>> {
  if (!isEvmChain(chain)) {
    return { ok: false, error: `Not an EVM chain: ${chain}`, retryable: false };
  }
  const req = getTokenRequest(chain, contract, apiKeyForChain(chain));
  return call<GetTokenResult | null>(req.url, (body) => {
    return { ok: true, result: asGetTokenResult(body) };
  });
}

/**
 * Read a token's on-chain `decimals()` (Blockscout eth_call). This is the
 * GROUND TRUTH source used to verify decimals when the list/metadata are blank.
 * Only available for Blockscout chains (Flare/Songbird); returns a null result
 * for non-Blockscout chains so the caller falls back to metadata.
 */
export async function fetchTokenDecimalsOnChain(
  chain: Chain,
  contract: string,
): Promise<EvmExplorerResult<string | null>> {
  if (!isEvmChain(chain)) {
    return { ok: false, error: `Not an EVM chain: ${chain}`, retryable: false };
  }
  const req = decimalsEthCallRequest(chain, contract);
  if (req === null) {
    // Not a Blockscout chain — no on-chain read available here.
    return { ok: true, result: null };
  }
  return callPost<string | null>(req.url, req.body, (body) => {
    if (isJsonRpcError(body)) {
      // A reverting decimals() (non-ERC-20) is not retryable — treat as "no
      // decimals available" so the caller leaves the token unverified.
      return { ok: true, result: null };
    }
    return { ok: true, result: ethCallResultHex(body) };
  });
}
