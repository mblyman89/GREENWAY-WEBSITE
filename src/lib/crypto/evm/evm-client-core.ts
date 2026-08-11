/**
 * src/lib/crypto/evm/evm-client-core.ts — PURE EVM client policy (Slice C6b).
 *
 * No `server-only`, no network, no Supabase. This is the deterministic,
 * self-tested POLICY layer for the EVM explorer REST client: per-chain base-URL
 * resolution, query-string building for the three actions we use (account
 * balance, native txlist, ERC-20 tokentx), the block-range backfill cursor
 * model, fair-use throttle spacing, retry/backoff scheduling, and response-row
 * typing/validation. The server-only `evm-client.ts` is a thin shell that
 * performs `fetch` + `sleep` on top of this.
 *
 * WHY A PURE CORE
 * ---------------
 * All three chains (Ethereum, Flare, Songbird) speak the SAME Etherscan-
 * compatible REST API (documented in docs/CRYPTO_EVM_FETCH_RESEARCH.md):
 *   GET <base>?module=account&action=<action>&address=<addr>&...&apikey=<key>
 * Responses are `{ status: "1"|"0", message, result: [...] }`. The *policy* —
 * which URL, which params, how long to wait between calls, how to back off,
 * how to tell a retryable rate-limit from a hard error — is written here as
 * pure, tested logic so the tax record stays honest even when the network is
 * flaky. The server shell just performs `fetch` and sleeps.
 *
 * CHAIN-SPECIFIC ENDPOINTS (verified live 2026-08-11):
 *   ethereum  → Etherscan V2 unified multichain: api.etherscan.io/v2/api
 *               (requires a FREE api key; chainid=1 in the query)
 *   flare     → Flare Blockscout explorer (keyless): flare-explorer.flare.network/api
 *   songbird  → Songbird Blockscout explorer (keyless): songbird-explorer.flare.network/api
 * Etherscan V2 does NOT cover Flare/Songbird, so they use their native
 * Blockscout explorers which speak the SAME Etherscan-compatible shape.
 */

import type { Chain } from "../crypto-core";
import { EVM_CHAIN_ID } from "../crypto-core";

// ---------------------------------------------------------------------------
// Constants — per-chain base URLs + fair-use policy
// ---------------------------------------------------------------------------

/** Etherscan V2 unified multichain base (requires apikey; chainid in query). */
export const ETHERSCAN_V2_BASE = "https://api.etherscan.io/v2/api";

/** Flare's official Blockscout explorer (Etherscan-compatible, no key). */
export const FLARE_EXPLORER_BASE = "https://flare-explorer.flare.network/api";

/** Songbird's official Blockscout explorer (Etherscan-compatible, no key). */
export const SONGBIRD_EXPLORER_BASE = "https://songbird-explorer.flare.network/api";

/** The EVM chains this connector supports (mirrors crypto-core's EVM_CHAIN_ID). */
export const EVM_CLIENT_CHAINS: Chain[] = ["ethereum", "flare", "songbird"];

/**
 * Minimum spacing between explorer calls, in ms. Etherscan's free tier allows
 * ~5 calls/sec; Blockscout is public/shared. We round down to a polite 220ms
 * (~4.5/sec) to stay safely under both without wasting time.
 */
export const EVM_MIN_REQUEST_SPACING_MS = 220;

/** How many times to retry a transient failure before giving up. */
export const EVM_MAX_RETRIES = 4;

/** Base backoff (ms) — doubles each retry, capped by EVM_MAX_BACKOFF_MS. */
export const EVM_BASE_BACKOFF_MS = 500;

/** Ceiling for a single backoff wait (ms). */
export const EVM_MAX_BACKOFF_MS = 8000;

/** Per-request network timeout (ms). */
export const EVM_REQUEST_TIMEOUT_MS = 20000;

/** Default page size for txlist/tokentx (rows per call). Etherscan max is 10000. */
export const EVM_DEFAULT_PAGE_SIZE = 200;

/** Max page size we'll ever request (Etherscan caps offset*page results). */
export const EVM_MAX_PAGE_SIZE = 10000;

/** The genesis block — our backfill always starts at block 0 unless resuming. */
export const EVM_START_BLOCK = 0;

// ---------------------------------------------------------------------------
// Endpoint resolution — per chain, with safe overrides + key handling
// ---------------------------------------------------------------------------

/**
 * Resolve the explorer base URL for a chain. An explicit override (e.g. an env
 * var) wins IF it is a valid http(s) URL; otherwise the safe documented default
 * is used. A malformed override never throws — an unconfigured deploy must keep
 * working. Returns the base URL WITHOUT a trailing slash (the query string is
 * appended by the query builders).
 */
export function resolveEvmExplorerBase(chain: Chain, override?: string | null): string {
  const raw = (override ?? "").trim();
  if (raw.length > 0 && /^https?:\/\//i.test(raw)) {
    return raw.replace(/\/+$/, "");
  }
  switch (chain) {
    case "ethereum":
      return ETHERSCAN_V2_BASE;
    case "flare":
      return FLARE_EXPLORER_BASE;
    case "songbird":
      return SONGBIRD_EXPLORER_BASE;
    default:
      throw new Error(`resolveEvmExplorerBase: unsupported EVM chain "${chain}"`);
  }
}

/**
 * Whether a chain needs an `apikey` query param. Only Ethereum (Etherscan V2)
 * requires a free key; Flare and Songbird Blockscout are keyless.
 */
export function chainNeedsApiKey(chain: Chain): boolean {
  return chain === "ethereum";
}

/**
 * The chainid query param value for Etherscan V2 (only meaningful for ethereum;
 * Flare/Songbird Blockscout ignores it). Returns null for non-Etherscan chains.
 */
export function etherscanChainId(chain: Chain): number | null {
  if (chain !== "ethereum" && chain !== "flare" && chain !== "songbird") return null;
  const id = EVM_CHAIN_ID[chain];
  return typeof id === "number" ? id : null;
}

// ---------------------------------------------------------------------------
// Query building — the GET query string for each action
// ---------------------------------------------------------------------------

/** A built EVM explorer GET request (just a URL string; the client fetches it). */
export type EvmExplorerRequest = {
  url: string;
};

/** Clamp a page size into the polite/safe range. */
export function clampPageSize(size?: number): number {
  if (typeof size !== "number" || !Number.isFinite(size)) return EVM_DEFAULT_PAGE_SIZE;
  const n = Math.trunc(size);
  if (n < 1) return 1;
  if (n > EVM_MAX_PAGE_SIZE) return EVM_MAX_PAGE_SIZE;
  return n;
}

/**
 * Build the full query string for an account action. `extra` holds action-
 * specific params (e.g. startblock/endblock/page/offset). The apikey is
 * appended ONLY when the chain requires one and a key is provided.
 */
export function buildEvmQuery(
  chain: Chain,
  action: string,
  address: string,
  apiKey: string | null,
  extra: Record<string, string | number> = {},
): EvmExplorerRequest {
  const base = resolveEvmExplorerBase(chain);
  const params = new URLSearchParams();
  // Etherscan V2 needs module=account + chainid for every call.
  params.set("module", "account");
  params.set("action", action);
  params.set("address", address);
  if (chain === "ethereum") {
    const cid = etherscanChainId(chain);
    if (cid !== null) params.set("chainid", String(cid));
  }
  for (const [k, v] of Object.entries(extra)) {
    params.set(k, String(v));
  }
  if (chainNeedsApiKey(chain) && apiKey && apiKey.trim().length > 0) {
    params.set("apikey", apiKey.trim());
  }
  return { url: `${base}?${params.toString()}` };
}

/** Build the balance request (native coin balance, in wei). */
export function balanceRequest(
  chain: Chain,
  address: string,
  apiKey: string | null,
): EvmExplorerRequest {
  return buildEvmQuery(chain, "balance", address, apiKey, {
    tag: "latest",
  });
}

/** Build a txlist request (native transfers + fee fields) for a block range. */
export function txlistRequest(
  chain: Chain,
  address: string,
  apiKey: string | null,
  opts: {
    startBlock: number;
    endBlock: number;
    page?: number;
    offset?: number;
    sort?: "asc" | "desc";
  },
): EvmExplorerRequest {
  return buildEvmQuery(chain, "txlist", address, apiKey, {
    startblock: opts.startBlock,
    endblock: opts.endBlock,
    page: opts.page ?? 1,
    offset: opts.offset ?? EVM_DEFAULT_PAGE_SIZE,
    sort: opts.sort ?? "asc",
  });
}

/** Build a tokentx request (ERC-20 Transfer events) for a block range. */
export function tokentxRequest(
  chain: Chain,
  address: string,
  apiKey: string | null,
  opts: {
    startBlock: number;
    endBlock: number;
    page?: number;
    offset?: number;
    sort?: "asc" | "desc";
  },
): EvmExplorerRequest {
  return buildEvmQuery(chain, "tokentx", address, apiKey, {
    startblock: opts.startBlock,
    endblock: opts.endBlock,
    page: opts.page ?? 1,
    offset: opts.offset ?? EVM_DEFAULT_PAGE_SIZE,
    sort: opts.sort ?? "asc",
  });
}

/**
 * Build a proxy-module eth_blockNumber request to discover the chain tip. The
 * Etherscan-compatible `proxy` module returns the latest block number as a
 * hex string in `result`. We use it to bound the backfill window so we walk
 * only the real on-chain tip. This uses a DIFFERENT module (proxy, not
 * account) so we build the query directly rather than via buildEvmQuery.
 */
export function blockNumberRequest(
  chain: Chain,
  apiKey: string | null,
): EvmExplorerRequest {
  const base = resolveEvmExplorerBase(chain);
  const params = new URLSearchParams();
  params.set("module", "proxy");
  params.set("action", "eth_blockNumber");
  if (chain === "ethereum") {
    const cid = etherscanChainId(chain);
    if (cid !== null) params.set("chainid", String(cid));
  }
  if (chainNeedsApiKey(chain) && apiKey && apiKey.trim().length > 0) {
    params.set("apikey", apiKey.trim());
  }
  return { url: `${base}?${params.toString()}` };
}

/**
 * Build a proxy-module eth_getTransactionReceipt request to fetch the full log
 * set for a single transaction. The Etherscan-compatible `proxy` module returns
 * a JSON-RPC envelope `{ jsonrpc, id, result: { ..., logs: [...] } }` where
 * `result.logs` contains EVERY event emitted by EVERY contract in that
 * transaction. This is what lets the C7 DeFi classifier see pool Mint/Burn/Swap
 * events that are NOT ERC-20 Transfers (and thus absent from tokentx).
 *
 * Like `blockNumberRequest`, this uses the `proxy` module (not `account`), so
 * we build the query directly rather than via buildEvmQuery.
 *
 * Verified on all three chains (Etherscan V2 + Flare/Songbird Blockscout):
 *   ?module=proxy&action=eth_getTransactionReceipt&txhash=0x...&apikey=...
 * See research/c7b-receipt-log-research.md for the verified response shape.
 */
export function receiptRequest(
  chain: Chain,
  txHash: string,
  apiKey: string | null,
): EvmExplorerRequest {
  const base = resolveEvmExplorerBase(chain);
  const params = new URLSearchParams();
  params.set("module", "proxy");
  params.set("action", "eth_getTransactionReceipt");
  params.set("txhash", txHash);
  if (chain === "ethereum") {
    const cid = etherscanChainId(chain);
    if (cid !== null) params.set("chainid", String(cid));
  }
  if (chainNeedsApiKey(chain) && apiKey && apiKey.trim().length > 0) {
    params.set("apikey", apiKey.trim());
  }
  return { url: `${base}?${params.toString()}` };
}

/**
 * Parse a proxy eth_blockNumber response body. The result is a hex string like
 * "0x10c868" — we decode it to a decimal block number. Returns ok=false with
 * retryable=true for empty/non-JSON or missing result (transient explorer
 * hiccups), so the caller can retry.
 */
export function parseBlockNumberResult(body: unknown): EvmExplorerResult<number> {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "empty or non-JSON block-number response", retryable: true };
  }
  const obj = body as { result?: string; message?: string };
  const raw = typeof obj.result === "string" ? obj.result : "";
  if (raw === "" || !raw.startsWith("0x")) {
    if (isRateLimitMessage(obj.message ?? "")) {
      return { ok: false, error: obj.message ?? "rate limit", retryable: true };
    }
    return { ok: false, error: obj.message || "missing block-number result", retryable: true };
  }
  const n = parseInt(raw, 16);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: `unparseable block number: ${raw}`, retryable: false };
  }
  return { ok: true, result: n };
}

// ---------------------------------------------------------------------------
// Response typing — the decoded rows Etherscan-compatible APIs return
// ---------------------------------------------------------------------------

/**
 * A native txlist row (Etherscan-compatible). Amounts are decimal STRINGS in
 * the smallest unit (wei). We keep them as strings — they routinely exceed
 * Number.MAX_SAFE_INTEGER.
 */
export type EvmTxListRow = {
  hash: string;
  from: string;
  to: string;
  /** Native value in wei (decimal string). */
  value: string;
  blockNumber: string;
  timeStamp: string;
  /** Gas used (decimal string). */
  gasUsed: string;
  /** Effective gas price in wei (decimal string). */
  gasPrice: string;
  /** "1" = success, "0" = failed. */
  isError: string;
  /** Transaction index within the block (decimal string). */
  transactionIndex: string;
};

/**
 * A tokentx row (Etherscan-compatible). The API decodes the Transfer event into
 * human-friendly fields including the token's decimals/symbol.
 */
export type EvmTokenTxRow = {
  hash: string;
  from: string;
  to: string;
  /** Token amount in smallest unit (decimal string, per tokenDecimal). */
  value: string;
  /** Contract address (checksummed or lower; we normalise downstream). */
  contractAddress: string;
  /** Token decimals (decimal string; usually "6" or "18"). */
  tokenDecimal: string;
  /** Token symbol (e.g. "USDT"). */
  tokenSymbol: string;
  blockNumber: string;
  timeStamp: string;
  gasUsed: string;
  gasPrice: string;
};

/** The parsed envelope of an explorer REST response. */
export type EvmExplorerResult<T = unknown> =
  | { ok: true; result: T }
  | { ok: false; error: string; retryable: boolean };

/**
 * Interpret an explorer REST response body. Etherscan-compatible APIs return:
 *   { status: "1", message: "OK", result: [...] }
 *   { status: "0", message: "No transactions found", result: [] }
 *   { status: "0", message: "Max rate limit reached", result: "..." }
 * `status:"0"` + "No transactions" is a NORMAL empty page (ok=true, result=[]).
 * Rate-limit / server errors are retryable; everything else is a hard error.
 */
export function interpretExplorerBody(body: unknown): EvmExplorerResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "empty or non-JSON response", retryable: true };
  }
  const obj = body as { status?: string; message?: string; result?: unknown };
  const status = typeof obj.status === "string" ? obj.status : "";
  const message = typeof obj.message === "string" ? obj.message : "";

  // status "1" = success with data.
  if (status === "1") {
    return { ok: true, result: obj.result };
  }

  // status "0" + "No transactions found" is a normal empty page.
  const lower = message.toLowerCase();
  if (lower.includes("no transactions") || lower.includes("no records") || status === "0") {
    // Distinguish rate-limit (retryable) from a genuine empty result.
    if (isRateLimitMessage(message)) {
      return { ok: false, error: message, retryable: true };
    }
    // Genuine empty: return an empty array as the result.
    return { ok: true, result: Array.isArray(obj.result) ? obj.result : [] };
  }

  // Unknown shape — treat as retryable to be safe but surface the message.
  if (isRateLimitMessage(message)) {
    return { ok: false, error: message, retryable: true };
  }
  return { ok: false, error: message || "unknown explorer error", retryable: false };
}

/** Heuristic for Etherscan-style rate-limit messages (retryable). */
export function isRateLimitMessage(message: string): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    m.includes("max rate limit") ||
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("slow down")
  );
}

/** An HTTP status is retryable if it's a 429 or any 5xx. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// ---------------------------------------------------------------------------
// Block-range backfill cursor model
// ---------------------------------------------------------------------------

/**
 * The resumable cursor for an EVM backfill. Because Etherscan-compatible APIs
 * paginate by block range (startblock/endblock) rather than an opaque marker,
 * the cursor is simply the last block we've fully consumed. We walk ascending
 * (oldest->newest) in fixed windows and store lastConsumedBlock as the resume
 * point. On the next run we resume from lastConsumedBlock + 1.
 *
 * The cursor is serialised as a plain decimal block-number string so it's
 * human-readable and trivially parseable.
 */
export type EvmBlockCursor = {
  /** The next block to start reading from (inclusive). */
  nextStartBlock: number;
  /** The block we last fully consumed (for resume; -1 = none yet). */
  lastConsumedBlock: number;
};

/** Serialise a cursor to a string for backfill_cursor storage. */
export function serializeEvmCursor(cursor: EvmBlockCursor | null): string | null {
  if (!cursor) return null;
  return `${cursor.nextStartBlock}:${cursor.lastConsumedBlock}`;
}

/** Parse a stored cursor string back into a cursor (null = start fresh). */
export function deserializeEvmCursor(stored: string | null): EvmBlockCursor | null {
  if (!stored || stored.trim() === "") return null;
  const parts = stored.trim().split(":");
  if (parts.length !== 2) return null;
  const next = Number.parseInt(parts[0], 10);
  const last = Number.parseInt(parts[1], 10);
  if (!Number.isFinite(next) || !Number.isFinite(last)) return null;
  if (next < 0 || last < -1) return null;
  return { nextStartBlock: next, lastConsumedBlock: last };
}

/**
 * Initialise a backfill cursor. A saved cursor (from a prior run) resumes where
 * we left off; null/empty starts from genesis (block 0).
 */
export function initEvmCursor(saved: string | null): EvmBlockCursor {
  const parsed = deserializeEvmCursor(saved);
  if (parsed) return parsed;
  return { nextStartBlock: EVM_START_BLOCK, lastConsumedBlock: -1 };
}

// ---------------------------------------------------------------------------
// Throttle + backoff scheduling (mirrors xrpl-client-core, pure + deterministic)
// ---------------------------------------------------------------------------

/**
 * How long to wait before the NEXT request, given the timestamp of the last
 * request, to honor the minimum spacing. Deterministic (no clock inside).
 */
export function nextRequestDelayMs(
  lastRequestAtMs: number | null,
  nowMs: number,
  spacingMs: number = EVM_MIN_REQUEST_SPACING_MS,
): number {
  if (lastRequestAtMs === null) return 0;
  const elapsed = nowMs - lastRequestAtMs;
  const wait = spacingMs - elapsed;
  return wait > 0 ? wait : 0;
}

/**
 * Exponential backoff for retry attempt `attempt` (0-based): base * 2^attempt,
 * capped. Deterministic; the caller adds jitter if it wants.
 */
export function backoffDelayMs(
  attempt: number,
  base: number = EVM_BASE_BACKOFF_MS,
  cap: number = EVM_MAX_BACKOFF_MS,
): number {
  if (attempt < 0) attempt = 0;
  const raw = base * Math.pow(2, attempt);
  return Math.min(raw, cap);
}

/** Whether another retry is allowed for a retryable failure. */
export function shouldRetry(
  attempt: number,
  retryable: boolean,
  maxRetries: number = EVM_MAX_RETRIES,
): boolean {
  return retryable && attempt < maxRetries;
}

// ---------------------------------------------------------------------------
// Row coercion — safely cast decoded arrays + extract the max block seen
// ---------------------------------------------------------------------------

/** Safely narrow the result to an EvmTxListRow[] (returns [] on bad shape). */
export function asTxListRows(result: unknown): EvmTxListRow[] {
  if (!Array.isArray(result)) return [];
  return result as EvmTxListRow[];
}

/** Safely narrow the result to an EvmTokenTxRow[] (returns [] on bad shape). */
export function asTokenTxRows(result: unknown): EvmTokenTxRow[] {
  if (!Array.isArray(result)) return [];
  return result as EvmTokenTxRow[];
}

/**
 * The highest block number present in a set of txlist rows (0 if empty). Used
 * to advance the backfill cursor after a page is consumed.
 */
export function maxBlockFromTxList(rows: EvmTxListRow[]): number {
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.blockNumber, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * The highest block number present in a set of tokentx rows (0 if empty). Used
 * to advance the backfill cursor after a page is consumed.
 */
export function maxBlockFromTokenTx(rows: EvmTokenTxRow[]): number {
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.blockNumber, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/**
 * The latest block number across BOTH row sets (we walk both in lockstep for a
 * given block window). 0 if both are empty.
 */
export function maxBlockAcrossRows(
  txRows: EvmTxListRow[],
  tokenRows: EvmTokenTxRow[],
): number {
  return Math.max(maxBlockFromTxList(txRows), maxBlockFromTokenTx(tokenRows));
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run under tsx by run-pure-selftests.ts + vitest mirror)
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`evm-client-core self-test FAILED: ${name}`);
}

export function __runEvmClientCoreTests(): void {
  // --- constants ---
  check("etherscan v2 base", ETHERSCAN_V2_BASE === "https://api.etherscan.io/v2/api");
  check("flare base", FLARE_EXPLORER_BASE === "https://flare-explorer.flare.network/api");
  check("songbird base", SONGBIRD_EXPLORER_BASE === "https://songbird-explorer.flare.network/api");
  check("page size default", EVM_DEFAULT_PAGE_SIZE === 200);
  check("start block genesis", EVM_START_BLOCK === 0);

  // --- endpoint resolution ---
  check("default ethereum", resolveEvmExplorerBase("ethereum") === ETHERSCAN_V2_BASE);
  check("default flare", resolveEvmExplorerBase("flare") === FLARE_EXPLORER_BASE);
  check("default songbird", resolveEvmExplorerBase("songbird") === SONGBIRD_EXPLORER_BASE);
  check("override valid keeps no trailing slash", resolveEvmExplorerBase("flare", "https://my.explorer/api/") === "https://my.explorer/api");
  check("override valid no slash", resolveEvmExplorerBase("flare", "https://my.explorer/api") === "https://my.explorer/api");
  check("override bad falls back", resolveEvmExplorerBase("flare", "not-a-url") === FLARE_EXPLORER_BASE);
  check("override blank falls back", resolveEvmExplorerBase("flare", "   ") === FLARE_EXPLORER_BASE);
  let threw = false;
  try { resolveEvmExplorerBase("xrpl"); } catch { threw = true; }
  check("unsupported chain throws", threw);

  // --- api key / chainid ---
  check("ethereum needs key", chainNeedsApiKey("ethereum") === true);
  check("flare needs no key", chainNeedsApiKey("flare") === false);
  check("songbird needs no key", chainNeedsApiKey("songbird") === false);
  check("etherscan chainid ethereum", etherscanChainId("ethereum") === 1);
  check("etherscan chainid flare", etherscanChainId("flare") === 14);
  check("etherscan chainid songbird", etherscanChainId("songbird") === 19);
  check("etherscan chainid xrpl null", etherscanChainId("xrpl") === null);

  // --- page size clamp ---
  check("page size default", clampPageSize(undefined) === 200);
  check("page size high clamped", clampPageSize(999999) === EVM_MAX_PAGE_SIZE);
  check("page size low clamped", clampPageSize(0) === 1);
  check("page size normal", clampPageSize(500) === 500);

  // --- query building: balance (flare, no key) ---
  const balFlare = balanceRequest("flare", "0xAbC", null);
  check("flare balance has module+action", balFlare.url.includes("module=account") && balFlare.url.includes("action=balance"));
  check("flare balance has address", balFlare.url.includes("address=0xAbC"));
  check("flare balance has tag latest", balFlare.url.includes("tag=latest"));
  check("flare balance no chainid", !balFlare.url.includes("chainid="));
  check("flare balance no apikey", !balFlare.url.includes("apikey="));

  // --- query building: balance (ethereum, with key) ---
  const balEth = balanceRequest("ethereum", "0xAbC", "MYKEY");
  check("eth balance has chainid 1", balEth.url.includes("chainid=1"));
  check("eth balance has apikey", balEth.url.includes("apikey=MYKEY"));
  // eth balance without key still builds (keyless call — will likely fail at runtime, but URL is valid)
  const balEthNoKey = balanceRequest("ethereum", "0xAbC", null);
  check("eth balance no key omits apikey", !balEthNoKey.url.includes("apikey="));

  // --- query building: txlist ---
  const tx = txlistRequest("flare", "0xAbC", null, { startBlock: 100, endBlock: 200 });
  check("txlist has action", tx.url.includes("action=txlist"));
  check("txlist has startblock", tx.url.includes("startblock=100"));
  check("txlist has endblock", tx.url.includes("endblock=200"));
  check("txlist default page 1", tx.url.includes("page=1"));
  check("txlist default offset 200", tx.url.includes("offset=200"));
  check("txlist default sort asc", tx.url.includes("sort=asc"));

  // --- query building: tokentx ---
  const tok = tokentxRequest("ethereum", "0xAbC", "K", { startBlock: 0, endBlock: 50, page: 2, offset: 100, sort: "desc" });
  check("tokentx has action", tok.url.includes("action=tokentx"));
  check("tokentx has startblock", tok.url.includes("startblock=0"));
  check("tokentx has page 2", tok.url.includes("page=2"));
  check("tokentx has offset 100", tok.url.includes("offset=100"));
  check("tokentx has sort desc", tok.url.includes("sort=desc"));
  check("tokentx eth has key", tok.url.includes("apikey=K"));

  // --- response interpretation ---
  const okRows = interpretExplorerBody({ status: "1", message: "OK", result: [{ hash: "0x1" }] });
  check("ok rows", okRows.ok === true && Array.isArray((okRows as { result: unknown[] }).result));

  const emptyPage = interpretExplorerBody({ status: "0", message: "No transactions found", result: [] });
  check("empty page ok with []", emptyPage.ok === true && Array.isArray((emptyPage as { result: unknown[] }).result) && (emptyPage as { result: unknown[] }).result.length === 0);

  const rateLimit = interpretExplorerBody({ status: "0", message: "Max rate limit reached", result: "..." });
  check("rate limit retryable", rateLimit.ok === false && rateLimit.retryable === true);

  const emptyBody = interpretExplorerBody(null);
  check("empty body retryable", emptyBody.ok === false && emptyBody.retryable === true);

  // --- rate limit heuristic ---
  check("rate limit max", isRateLimitMessage("Max rate limit reached") === true);
  check("rate limit too many", isRateLimitMessage("Too many requests") === true);
  check("not rate limit no txns", isRateLimitMessage("No transactions found") === false);

  // --- http status ---
  check("429 retryable", isRetryableHttpStatus(429) === true);
  check("503 retryable", isRetryableHttpStatus(503) === true);
  check("404 not retryable", isRetryableHttpStatus(404) === false);
  check("200 not retryable", isRetryableHttpStatus(200) === false);

  // --- cursor model ---
  check("init cursor genesis", initEvmCursor(null).nextStartBlock === 0 && initEvmCursor(null).lastConsumedBlock === -1);
  check("init cursor empty string genesis", initEvmCursor("").nextStartBlock === 0);
  const cur: EvmBlockCursor = { nextStartBlock: 500, lastConsumedBlock: 499 };
  const ser = serializeEvmCursor(cur);
  check("serialize cursor", ser === "500:499");
  const deser = deserializeEvmCursor(ser);
  check("deserialize cursor", deser !== null && deser.nextStartBlock === 500 && deser.lastConsumedBlock === 499);
  check("deserialize null", deserializeEvmCursor(null) === null);
  check("deserialize bad", deserializeEvmCursor("garbage") === null);
  check("deserialize resume", initEvmCursor("1234:1233").nextStartBlock === 1234);

  // --- throttle spacing ---
  check("first request no wait", nextRequestDelayMs(null, 1000) === 0);
  check("spacing enforced", nextRequestDelayMs(1000, 1100, 220) === 120);
  check("spacing elapsed no wait", nextRequestDelayMs(1000, 2000, 220) === 0);

  // --- backoff ---
  check("backoff attempt 0", backoffDelayMs(0, 500, 8000) === 500);
  check("backoff attempt 2", backoffDelayMs(2, 500, 8000) === 2000);
  check("backoff capped", backoffDelayMs(10, 500, 8000) === 8000);
  check("shouldRetry within limit", shouldRetry(1, true, 4) === true);
  check("shouldRetry exhausted", shouldRetry(4, true, 4) === false);
  check("shouldRetry non-retryable", shouldRetry(0, false, 4) === false);

  // --- row coercion + max block ---
  const txRows: EvmTxListRow[] = [
    { hash: "0xa", from: "0x1", to: "0x2", value: "100", blockNumber: "10", timeStamp: "1", gasUsed: "21000", gasPrice: "1", isError: "0", transactionIndex: "0" },
    { hash: "0xb", from: "0x2", to: "0x1", value: "200", blockNumber: "25", timeStamp: "2", gasUsed: "21000", gasPrice: "1", isError: "0", transactionIndex: "1" },
  ];
  check("asTxListRows valid", asTxListRows(txRows).length === 2);
  check("asTxListRows bad", asTxListRows("nope").length === 0);
  check("maxBlockFromTxList", maxBlockFromTxList(txRows) === 25);
  check("maxBlockFromTxList empty", maxBlockFromTxList([]) === 0);
  const tokRows: EvmTokenTxRow[] = [
    { hash: "0xc", from: "0x1", to: "0x3", value: "50", contractAddress: "0x", tokenDecimal: "6", tokenSymbol: "USDT", blockNumber: "40", timeStamp: "3", gasUsed: "50000", gasPrice: "1" },
  ];
  check("maxBlockFromTokenTx", maxBlockFromTokenTx(tokRows) === 40);
  check("maxBlockAcrossRows", maxBlockAcrossRows(txRows, tokRows) === 40);
  check("maxBlockAcrossRows both empty", maxBlockAcrossRows([], []) === 0);

  // --- block number (proxy) request + parser ---
  const bnEth = blockNumberRequest("ethereum", "K");
  check("blockNumber uses proxy module", bnEth.url.includes("module=proxy"));
  check("blockNumber uses eth_blockNumber", bnEth.url.includes("action=eth_blockNumber"));
  check("blockNumber eth has chainid", bnEth.url.includes("chainid=1"));
  check("blockNumber eth has key", bnEth.url.includes("apikey=K"));
  const bnFlare = blockNumberRequest("flare", null);
  check("blockNumber flare no chainid", !bnFlare.url.includes("chainid="));
  check("blockNumber flare no key", !bnFlare.url.includes("apikey="));

  const bnOk = parseBlockNumberResult({ result: "0x10c868" });
  check("parse blockNumber ok", bnOk.ok === true && (bnOk as { result: number }).result === 0x10c868);
  const bnMissing = parseBlockNumberResult({ result: "" });
  check("parse blockNumber missing retryable", bnMissing.ok === false && bnMissing.retryable === true);
  const bnEmpty = parseBlockNumberResult(null);
  check("parse blockNumber empty retryable", bnEmpty.ok === false && bnEmpty.retryable === true);
  const bnRate = parseBlockNumberResult({ result: "", message: "Max rate limit reached" });
  check("parse blockNumber rate limit", bnRate.ok === false && bnRate.retryable === true);

  // --- receipt request (proxy module, C7b) ---
  const rcEth = receiptRequest("ethereum", "0x" + "a".repeat(64), "K");
  check("receipt uses proxy module", rcEth.url.includes("module=proxy"));
  check("receipt uses eth_getTransactionReceipt", rcEth.url.includes("action=eth_getTransactionReceipt"));
  check("receipt has txhash", rcEth.url.includes("txhash=0x"));
  check("receipt eth has chainid", rcEth.url.includes("chainid=1"));
  check("receipt eth has key", rcEth.url.includes("apikey=K"));
  const rcFlare = receiptRequest("flare", "0x" + "b".repeat(64), null);
  check("receipt flare no chainid", !rcFlare.url.includes("chainid="));
  check("receipt flare no key", !rcFlare.url.includes("apikey="));
  check("receipt flare has txhash", rcFlare.url.includes("txhash=0x"));
  const rcEthNoKey = receiptRequest("ethereum", "0x" + "c".repeat(64), null);
  check("receipt eth no key omits apikey", !rcEthNoKey.url.includes("apikey="));

  console.log("evm-client-core self-tests: all passed");
}
