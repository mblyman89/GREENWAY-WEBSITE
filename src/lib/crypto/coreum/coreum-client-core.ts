/**
 * src/lib/crypto/coreum/coreum-client-core.ts (C8b)
 *
 * PURE helpers for the Coreum (Cosmos SDK / Tendermint) REST client: endpoint
 * resolution (two providers), request building for the LCD endpoints we use,
 * response-envelope validation, denom-amount parsing, fair-use throttle
 * spacing, and retry/backoff scheduling. NO `server-only`, NO network so it
 * runs under `tsx`/`vitest` and its logic is fully self-tested.
 *
 * WHY A PURE CORE FOR A NETWORK CLIENT
 * ------------------------------------
 * Coreum is a Cosmos SDK / Tendermint chain (NOT EVM, NOT XRPL). It speaks a
 * gRPC-gateway REST API ("LCD") for queries and a Tendermint JSON-RPC for
 * low-level tx search. The public endpoints (Polkachu, PublicNode) are FREE,
 * shared, keyless services. Hammering them gets us throttled or banned, which
 * would silently break Michael's tax record. So the *policy* (how long to
 * wait, how to back off, how to tell a real error from a transient one, how to
 * read the Cosmos SDK REST envelope) is written here as deterministic, tested
 * logic. The server-only client is then a thin shell that performs `fetch` +
 * sleeps and can fail over between the two providers.
 *
 * EVERY FACT BELOW WAS VERIFIED BY LIVE curl AGAINST THE REAL COREUM MAINNET
 * (2026-08-11; re-verified 2026-08-11 in this session). See
 * /workspace/research/c8b-coreum-explorer-research.md for the full evidence.
 *
 * Chain identity:
 *   chain-id: coreum-mainnet-1
 *   address prefix: core (bech32)
 *   native coin: TX (display), base denom ucore (6 decimals)
 *
 * Endpoints (VERIFIED LIVE):
 *   Primary  LCD: https://coreum-api.polkachu.com
 *   Primary  RPC: https://coreum-rpc.polkachu.com:443
 *   Backup   LCD: https://coreum-lcd.publicnode.com
 *   Backup   RPC: https://coreum-rpc.publicnode.com
 *
 * Balance API:
 *   GET /cosmos/bank/v1beta1/balances/{address}
 *   Returns { balances: [{denom, amount}], pagination: {next_key, total} | null }
 *
 * Denom metadata API:
 *   GET /cosmos/bank/v1beta1/denoms_metadata/{denom}
 *   Returns { metadata: { base, display, symbol, denom_units: [{denom, exponent}] } }
 *
 * Transaction history API (LCD tx query):
 *   GET /cosmos/tx/v1beta1/txs?query={tendermint-query}&pagination.limit={n}&pagination.key={base64}
 *   This Cosmos SDK version uses the `query` param (Tendermint-style), NOT `events`.
 *   Returns { txs: [...], tx_responses: [...], pagination: {next_key, total} | null, total }
 *   tx_responses come in ASCENDING height order (oldest first).
 *
 * Two queries needed (no OR support in Tendermint query):
 *   1. query=message.sender='{addr}'   (outgoing/signed txs)
 *   2. query=transfer.recipient='{addr}' (incoming txs)
 *   Deduplicate by txhash.
 */

// ---------------------------------------------------------------------------
// Provider endpoints (VERIFIED LIVE 2026-08-11)
// ---------------------------------------------------------------------------

/** Primary LCD (REST) endpoint: Polkachu (best block retention, ~76.4M). */
export const COREUM_LCD_PRIMARY = "https://coreum-api.polkachu.com";

/** Backup LCD (REST) endpoint: PublicNode / Allnodes (retention from ~82M). */
export const COREUM_LCD_BACKUP = "https://coreum-lcd.publicnode.com";

/** Primary Tendermint RPC endpoint: Polkachu. */
export const COREUM_RPC_PRIMARY = "https://coreum-rpc.polkachu.com:443";

/** Backup Tendermint RPC endpoint: PublicNode / Allnodes. */
export const COREUM_RPC_BACKUP = "https://coreum-rpc.publicnode.com";

// ---------------------------------------------------------------------------
// Fair-use throttle + retry policy (mirrors XRPL/EVM pattern)
// ---------------------------------------------------------------------------

/**
 * Minimum spacing between requests to the shared LCD providers (ms). Both
 * Polkachu and PublicNode are free, keyless, shared services. 250ms (4 req/sec)
 * is polite and well within their tolerance.
 */
export const COREUM_MIN_REQUEST_SPACING_MS = 250;

/** How many times to retry a transient failure before giving up. */
export const COREUM_MAX_RETRIES = 4;

/** Base backoff (ms); doubles each retry, capped by COREUM_MAX_BACKOFF_MS. */
export const COREUM_BASE_BACKOFF_MS = 500;

/** Ceiling for a single backoff wait (ms). */
export const COREUM_MAX_BACKOFF_MS = 8000;

/** Per-request network timeout (ms). */
export const COREUM_REQUEST_TIMEOUT_MS = 15000;

/** Default page size for tx queries (LCD). The LCD returns all results in one
 *  page for most wallets; this is the cap for larger accounts. */
export const COREUM_TX_PAGE_SIZE = 100;

/** Maximum pages to walk during backfill (safety guard against infinite loops). */
export const COREUM_MAX_BACKFILL_PAGES = 5000;

// ---------------------------------------------------------------------------
// Endpoint resolution
// ---------------------------------------------------------------------------

/** A resolved LCD provider: a base URL plus which provider it is. */
export type CoreumLcdEndpoint = {
  url: string;
  /** "primary" or "backup" so the server layer knows the fail-over order. */
  tier: "primary" | "backup";
};

/**
 * Resolve the list of LCD endpoints to try, in fail-over order. The primary
 * (Polkachu) goes first; the backup (PublicNode) second. An optional override
 * (e.g. from an env var) replaces the primary slot; the backup is still kept
 * as a safety net. A malformed override is ignored in favor of the safe
 * default rather than throwing (an unconfigured deploy must keep working).
 */
export function resolveCoreumLcdEndpoints(override?: string | null): CoreumLcdEndpoint[] {
  const raw = (override ?? "").trim();
  const primaryUrl = isHttpsUrl(raw) ? normalizeBaseUrl(raw) : COREUM_LCD_PRIMARY;
  return [
    { url: primaryUrl, tier: "primary" },
    { url: COREUM_LCD_BACKUP, tier: "backup" },
  ];
}

/**
 * Resolve the list of Tendermint RPC endpoints, in fail-over order.
 * Mirrors resolveCoreumLcdEndpoints but for the RPC (tx_search / block).
 */
export function resolveCoreumRpcEndpoints(override?: string | null): CoreumLcdEndpoint[] {
  const raw = (override ?? "").trim();
  const primaryUrl = isHttpsUrl(raw) ? normalizeBaseUrl(raw) : COREUM_RPC_PRIMARY;
  return [
    { url: primaryUrl, tier: "primary" },
    { url: COREUM_RPC_BACKUP, tier: "backup" },
  ];
}

/** True if the string is a valid http(s) URL. */
function isHttpsUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) && s.length > 8;
}

/** Ensure a base URL has no trailing slash (LCD paths start with /). */
function normalizeBaseUrl(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

// ---------------------------------------------------------------------------
// Denom-amount parsing (Cosmos amounts are "{value}{denom}" e.g. "400000000ucore")
// ---------------------------------------------------------------------------

/** A parsed Cosmos coin amount: the integer value and the denom string. */
export type CosmosCoin = {
  amount: string;
  denom: string;
};

/**
 * Parse a Cosmos coin string like "400000000ucore" into {amount, denom}.
 * The denom starts at the first non-digit character. Returns null for a
 * malformed string (never guesses).
 */
export function parseCosmosCoin(s: string | null | undefined): CosmosCoin | null {
  if (typeof s !== "string" || s.length === 0) return null;
  // The amount is a run of digits (optionally preceded by a sign for display
  // purposes). The denom starts at the first non-digit character and must
  // contain at least one non-digit char (Cosmos denoms always start with a
  // letter: ucore, usara-..., ibc/..., etc.).
  const match = s.match(/^(-?\d+)(\D.*)$/);
  if (!match) return null;
  const amount = match[1];
  const denom = match[2];
  if (amount.length === 0 || denom.length === 0) return null;
  return { amount, denom };
}

/**
 * Split a comma-separated list of Cosmos coins (as seen in wasm event
 * attributes like "233602426umart-..., 400000000ucore") into individual
 * CosmosCoin objects. Malformed entries are skipped (never guesses).
 */
export function parseCosmosCoinList(s: string | null | undefined): CosmosCoin[] {
  if (typeof s !== "string" || s.length === 0) return [];
  const parts = s.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  const coins: CosmosCoin[] = [];
  for (const part of parts) {
    const coin = parseCosmosCoin(part);
    if (coin !== null) coins.push(coin);
  }
  return coins;
}

// ---------------------------------------------------------------------------
// Request building (LCD REST GET requests)
// ---------------------------------------------------------------------------

/** A built LCD GET request: the full URL (the server layer just fetches it). */
export type CoreumLcdRequest = {
  url: string;
  /** Human-readable label for logging / error messages. */
  label: string;
};

/**
 * Build the balance request URL for an address.
 * GET /cosmos/bank/v1beta1/balances/{address}
 * Optionally with a pagination key (base64-encoded keyset cursor).
 */
export function balancesRequest(
  lcdUrl: string,
  address: string,
  paginationKey?: string | null,
): CoreumLcdRequest {
  const url = `${lcdUrl}/cosmos/bank/v1beta1/balances/${address}`;
  const fullUrl = withQueryParams(url, [
    ...(paginationKey ? [["pagination.key", paginationKey] as [string, string]] : []),
    ["pagination.limit", "1000"],
  ]);
  return { url: fullUrl, label: `balances(${address})` };
}

/**
 * Build the denom metadata request URL for a denom.
 * GET /cosmos/bank/v1beta1/denoms_metadata/{denom}
 */
export function denomMetadataRequest(lcdUrl: string, denom: string): CoreumLcdRequest {
  const url = `${lcdUrl}/cosmos/bank/v1beta1/denoms_metadata/${denom}`;
  return { url, label: `denoms_metadata(${denom})` };
}

/**
 * Build a tx-query request for the "message.sender" query (outgoing/signed txs).
 * GET /cosmos/tx/v1beta1/txs?query=message.sender='{addr}'&pagination.limit={n}
 */
export function txsBySenderRequest(
  lcdUrl: string,
  address: string,
  limit: number = COREUM_TX_PAGE_SIZE,
  paginationKey?: string | null,
): CoreumLcdRequest {
  const query = `message.sender='${address}'`;
  return buildTxQueryRequest(lcdUrl, query, limit, paginationKey, `txs-sender(${address})`);
}

/**
 * Build a tx-query request for the "transfer.recipient" query (incoming txs).
 * GET /cosmos/tx/v1beta1/txs?query=transfer.recipient='{addr}'&pagination.limit={n}
 */
export function txsByRecipientRequest(
  lcdUrl: string,
  address: string,
  limit: number = COREUM_TX_PAGE_SIZE,
  paginationKey?: string | null,
): CoreumLcdRequest {
  const query = `transfer.recipient='${address}'`;
  return buildTxQueryRequest(lcdUrl, query, limit, paginationKey, `txs-recipient(${address})`);
}

/**
 * Internal: build a tx-query request from a raw Tendermint query string.
 * Uses the `query` parameter (NOT `events`; verified that `events` returns
 * "query cannot be empty" on this Cosmos SDK version).
 */
function buildTxQueryRequest(
  lcdUrl: string,
  query: string,
  limit: number,
  paginationKey: string | null | undefined,
  label: string,
): CoreumLcdRequest {
  const params: [string, string][] = [
    ["query", query],
    ["pagination.limit", String(clampPageSize(limit))],
  ];
  if (paginationKey) params.push(["pagination.key", paginationKey]);
  const url = withQueryParams(`${lcdUrl}/cosmos/tx/v1beta1/txs`, params);
  return { url, label };
}

/** Clamp the page size to a polite, safe range. */
export function clampPageSize(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return COREUM_TX_PAGE_SIZE;
  const n = Math.trunc(limit);
  if (n < 1) return 1;
  if (n > 200) return 200;
  return n;
}

/**
 * Append query parameters to a URL. Encodes keys and values with
 * encodeURIComponent. This handles the single-quoted Tendermint query syntax
 * (e.g. message.sender='core1...' becomes message.sender=%27core1...%27).
 */
function withQueryParams(baseUrl: string, params: [string, string][]): string {
  if (params.length === 0) return baseUrl;
  const qs = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${baseUrl}?${qs}`;
}

// ---------------------------------------------------------------------------
// Response envelope validation (Cosmos SDK REST)
// ---------------------------------------------------------------------------

/** A validated LCD response: either the parsed body or a structured error. */
export type CoreumLcdResult<T = Record<string, unknown>> =
  | { ok: true; result: T }
  | { ok: false; error: string; retryable: boolean };

/**
 * Interpret a parsed Cosmos SDK REST response body. Cosmos SDK returns
 * a top-level `code` + `message` on errors (e.g.
 * {"code":13,"message":"query cannot be empty"}). On success, the response
 * is a plain object with the data (e.g. {balances, pagination}).
 *
 * We treat known transient conditions as retryable and everything else as a
 * hard, non-retryable error so the caller doesn't loop forever.
 */
export function interpretLcdBody(body: unknown): CoreumLcdResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "empty or non-JSON response", retryable: true };
  }
  const obj = body as Record<string, unknown>;
  // Cosmos SDK error envelope: { code: number, message: string, details? }
  const code = obj.code;
  if (typeof code === "number" && code !== 0) {
    const message = typeof obj.message === "string" ? obj.message : `cosmos code ${code}`;
    return { ok: false, error: message, retryable: isRetryableCosmosCode(code) };
  }
  // Success: return the body as-is
  return { ok: true, result: obj as never };
}

/**
 * Whether a Cosmos SDK error code is transient (worth retrying).
 * Known transient codes:
 *   - 2 (internal/timeout)  — server-side transient
 *   - 13 (internal)          — gRPC internal error, often transient
 *   - 4 (not found)          — NOT retryable (e.g. account doesn't exist yet)
 *   - 3 (invalid argument)   — NOT retryable (our bug, not theirs)
 *   - 1 (canceled)           — NOT retryable
 */
export function isRetryableCosmosCode(code: number): boolean {
  return code === 2 || code === 13;
}

/** An HTTP status is retryable if it's 429 or any 5xx. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// ---------------------------------------------------------------------------
// Cosmos SDK balance response typing
// ---------------------------------------------------------------------------

/** A raw balance entry from the LCD: { denom, amount }. */
export type CosmosBalanceEntry = {
  denom: string;
  amount: string;
};

/** A raw Cosmos SDK pagination object (keyset). */
export type CosmosPagination = {
  next_key: string | null;
  total: string;
} | null;

/** A raw Cosmos SDK balances response. */
export type CosmosBalancesResponse = {
  balances: CosmosBalanceEntry[];
  pagination: CosmosPagination;
};

/**
 * Extract the balances array from a parsed LCD response. Returns an empty
 * array if the shape is unexpected (never guesses; logs nothing).
 */
export function extractBalances(body: unknown): CosmosBalanceEntry[] {
  if (!body || typeof body !== "object") return [];
  const balances = (body as { balances?: unknown }).balances;
  if (!Array.isArray(balances)) return [];
  return balances.filter(
    (b): b is CosmosBalanceEntry =>
      b !== null &&
      typeof b === "object" &&
      typeof (b as CosmosBalanceEntry).denom === "string" &&
      typeof (b as CosmosBalanceEntry).amount === "string",
  );
}

/**
 * Extract the next pagination key from a parsed LCD response. Returns null if
 * there is no next key (all results fit) or the shape is unexpected.
 */
export function extractNextKey(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const pagination = (body as { pagination?: unknown }).pagination;
  if (!pagination || typeof pagination !== "object") return null;
  const nextKey = (pagination as { next_key?: unknown }).next_key;
  if (typeof nextKey === "string" && nextKey.length > 0) return nextKey;
  return null;
}

// ---------------------------------------------------------------------------
// Cosmos SDK tx response typing
// ---------------------------------------------------------------------------

/** A raw event attribute: { key, value } (both base64 or plain depending on
 *  the endpoint; the LCD returns them as plain strings). */
export type CosmosEventAttribute = {
  key?: string;
  value?: string;
  index?: boolean;
};

/** A raw event from tx_responses[].events[]: { type, attributes, msg_index? }. */
export type CosmosEvent = {
  type?: string;
  attributes?: CosmosEventAttribute[];
  msg_index?: number;
};

/** A raw tx_response from the LCD tx query. */
export type CosmosTxResponse = {
  txhash?: string;
  height?: string;
  timestamp?: string;
  code?: number;
  gas_used?: string;
  gas_wanted?: string;
  events?: CosmosEvent[];
  logs?: unknown[];
  raw_log?: string;
  data?: string;
};

/** A raw decoded message from txs[].body.messages[]: { @type, ...fields }. */
export type CosmosMessage = {
  "@type"?: string;
  [key: string]: unknown;
};

/** A raw fee amount from txs[].auth_info.fee.amount[]: { denom, amount }. */
export type CosmosFeeAmount = {
  denom: string;
  amount: string;
};

/** A raw tx (decoded) from the LCD tx query. */
export type CosmosTx = {
  body?: {
    messages?: CosmosMessage[];
    memo?: string;
  };
  auth_info?: {
    fee?: {
      amount?: CosmosFeeAmount[];
      gas_limit?: string;
      payer?: string;
      granter?: string;
    };
    signer_infos?: unknown[];
  };
};

/** A raw LCD tx-query response. */
export type CosmosTxsResponse = {
  txs?: CosmosTx[];
  tx_responses?: CosmosTxResponse[];
  pagination?: CosmosPagination;
  total?: string;
};

/**
 * Extract the tx_responses array from a parsed LCD tx-query response.
 * Returns an empty array if the shape is unexpected.
 */
export function extractTxResponses(body: unknown): CosmosTxResponse[] {
  if (!body || typeof body !== "object") return [];
  const txResponses = (body as { tx_responses?: unknown }).tx_responses;
  if (!Array.isArray(txResponses)) return [];
  return txResponses.filter(
    (r): r is CosmosTxResponse => r !== null && typeof r === "object",
  );
}

/**
 * Extract the txs array (decoded messages) from a parsed LCD tx-query response.
 * Returns an empty array if the shape is unexpected.
 */
export function extractTxs(body: unknown): CosmosTx[] {
  if (!body || typeof body !== "object") return [];
  const txs = (body as { txs?: unknown }).txs;
  if (!Array.isArray(txs)) return [];
  return txs.filter((t): t is CosmosTx => t !== null && typeof t === "object");
}

// ---------------------------------------------------------------------------
// Event attribute extraction (find a specific attribute in an event)
// ---------------------------------------------------------------------------

/**
 * Find the value of an attribute by key within a single event. Returns null
 * if not found. This is how we read `action` from wasm events, `sender` and
 * `recipient` and `amount` from transfer events, etc.
 */
export function findEventAttribute(event: CosmosEvent, key: string): string | null {
  if (!event.attributes || !Array.isArray(event.attributes)) return null;
  for (const attr of event.attributes) {
    if (attr && attr.key === key) {
      return typeof attr.value === "string" ? attr.value : null;
    }
  }
  return null;
}

/**
 * Find ALL events of a given type within a tx_response's events array.
 * Returns an empty array if none match.
 */
export function findEventsByType(txResponse: CosmosTxResponse, type: string): CosmosEvent[] {
  if (!txResponse.events || !Array.isArray(txResponse.events)) return [];
  return txResponse.events.filter((ev) => ev && ev.type === type);
}

/**
 * Find the value of an attribute from the FIRST event of a given type.
 * Convenience wrapper for the common case (e.g. wasm.action).
 */
export function findAttributeInFirstEvent(
  txResponse: CosmosTxResponse,
  eventType: string,
  attrKey: string,
): string | null {
  const events = findEventsByType(txResponse, eventType);
  if (events.length === 0) return null;
  return findEventAttribute(events[0], attrKey);
}

// ---------------------------------------------------------------------------
// Throttle + backoff scheduling (mirrors XRPL pattern)
// ---------------------------------------------------------------------------

/**
 * How long to wait before the NEXT request, given the timestamp of the last
 * request, to honor the minimum spacing. Deterministic (no clock inside).
 */
export function nextRequestDelayMs(
  lastRequestAtMs: number | null,
  nowMs: number,
  spacingMs: number = COREUM_MIN_REQUEST_SPACING_MS,
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
  base: number = COREUM_BASE_BACKOFF_MS,
  cap: number = COREUM_MAX_BACKOFF_MS,
): number {
  if (attempt < 0) attempt = 0;
  const raw = base * Math.pow(2, attempt);
  return Math.min(raw, cap);
}

/** Whether another retry is allowed for a retryable failure. */
export function shouldRetry(attempt: number, retryable: boolean, maxRetries: number = COREUM_MAX_RETRIES): boolean {
  return retryable && attempt < maxRetries;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`coreum-client-core self-test FAILED: ${name}`);
}

export function __runCoreumClientCoreTests(): void {
  // --- endpoint resolution ---
  const endpoints = resolveCoreumLcdEndpoints();
  check("two LCD endpoints", endpoints.length === 2);
  check("primary is Polkachu", endpoints[0].url === COREUM_LCD_PRIMARY && endpoints[0].tier === "primary");
  check("backup is PublicNode", endpoints[1].url === COREUM_LCD_BACKUP && endpoints[1].tier === "backup");
  check("primary has no trailing slash", !endpoints[0].url.endsWith("/"));

  // override replaces primary, backup stays
  const overridden = resolveCoreumLcdEndpoints("https://my-custom-lcd.example.com/");
  check("override replaces primary", overridden[0].url === "https://my-custom-lcd.example.com");
  check("backup still present", overridden[1].url === COREUM_LCD_BACKUP);

  // malformed override falls back to default
  const badOverride = resolveCoreumLcdEndpoints("not-a-url");
  check("bad override falls back", badOverride[0].url === COREUM_LCD_PRIMARY);
  const blankOverride = resolveCoreumLcdEndpoints("   ");
  check("blank override falls back", blankOverride[0].url === COREUM_LCD_PRIMARY);

  // RPC endpoints
  const rpcEndpoints = resolveCoreumRpcEndpoints();
  check("two RPC endpoints", rpcEndpoints.length === 2);
  check("RPC primary is Polkachu", rpcEndpoints[0].url === COREUM_RPC_PRIMARY);
  check("RPC backup is PublicNode", rpcEndpoints[1].url === COREUM_RPC_BACKUP);

  // --- denom-amount parsing ---
  const coin = parseCosmosCoin("400000000ucore");
  check("parse coin amount", coin !== null && coin.amount === "400000000" && coin.denom === "ucore");

  const coinNeg = parseCosmosCoin("-32256ucore");
  check("parse negative coin", coinNeg !== null && coinNeg.amount === "-32256" && coinNeg.denom === "ucore");

  const coinSara = parseCosmosCoin("1000000usara-core1r9gc0abc");
  check("parse sara coin", coinSara !== null && coinSara.denom === "usara-core1r9gc0abc");

  check("parse empty returns null", parseCosmosCoin("") === null);
  check("parse null returns null", parseCosmosCoin(null) === null);
  check("parse undefined returns null", parseCosmosCoin(undefined) === null);
  check("parse no-denom returns null", parseCosmosCoin("12345") === null);
  check("parse no-amount returns null", parseCosmosCoin("ucore") === null);

  // coin list parsing
  const list = parseCosmosCoinList("233602426umart-core1abc, 400000000ucore");
  check("parse coin list count", list.length === 2);
  check("parse coin list first", list[0].amount === "233602426" && list[0].denom === "umart-core1abc");
  check("parse coin list second", list[1].amount === "400000000" && list[1].denom === "ucore");

  const emptyList = parseCosmosCoinList("");
  check("parse empty list", emptyList.length === 0);
  const nullList = parseCosmosCoinList(null);
  check("parse null list", nullList.length === 0);

  // mixed valid + invalid (invalid skipped)
  const mixed = parseCosmosCoinList("100ucore, BADENTRY, 200usara-core1x");
  check("parse mixed list skips invalid", mixed.length === 2);

  // --- request building: balances ---
  const balReq = balancesRequest(COREUM_LCD_PRIMARY, "core1abc");
  check("balances URL", balReq.url.includes("/cosmos/bank/v1beta1/balances/core1abc"));
  check("balances label", balReq.label === "balances(core1abc)");
  check("balances has page limit", balReq.url.includes("pagination.limit=1000"));

  const balReqKey = balancesRequest(COREUM_LCD_PRIMARY, "core1abc", "abc123Key==");
  check("balances with key", balReqKey.url.includes("pagination.key=abc123Key%3D%3D"));

  // --- request building: denom metadata ---
  const dmReq = denomMetadataRequest(COREUM_LCD_PRIMARY, "ucore");
  check("denom metadata URL", dmReq.url === `${COREUM_LCD_PRIMARY}/cosmos/bank/v1beta1/denoms_metadata/ucore`);
  check("denom metadata label", dmReq.label === "denoms_metadata(ucore)");

  // --- request building: tx queries ---
  const senderReq = txsBySenderRequest(COREUM_LCD_PRIMARY, "core1abc");
  check("sender query URL", senderReq.url.includes("/cosmos/tx/v1beta1/txs"));
  check("sender query has query param", senderReq.url.includes("query=message.sender%3D"));
  check("sender query has address", senderReq.url.includes(encodeURIComponent("core1abc")));
  check("sender query label", senderReq.label === "txs-sender(core1abc)");

  const recipReq = txsByRecipientRequest(COREUM_LCD_PRIMARY, "core1def");
  check("recipient query has query param", recipReq.url.includes("query=transfer.recipient%3D"));
  check("recipient query label", recipReq.label === "txs-recipient(core1def)");

  // with pagination key
  const senderKeyReq = txsBySenderRequest(COREUM_LCD_PRIMARY, "core1abc", 50, "pageKey123=");
  check("sender query with key", senderKeyReq.url.includes("pagination.key=pageKey123%3D"));
  check("sender query with limit", senderKeyReq.url.includes("pagination.limit=50"));

  // --- page size clamping ---
  check("clamp default", clampPageSize(undefined) === COREUM_TX_PAGE_SIZE);
  check("clamp too small", clampPageSize(0) === 1);
  check("clamp too large", clampPageSize(99999) === 200);
  check("clamp valid", clampPageSize(50) === 50);
  check("clamp NaN", clampPageSize(NaN) === COREUM_TX_PAGE_SIZE);
  check("clamp infinity", clampPageSize(Infinity) === COREUM_TX_PAGE_SIZE);

  // --- response envelope: interpretLcdBody ---
  const okRes = interpretLcdBody({ balances: [], pagination: null });
  check("success envelope", okRes.ok === true);

  const errRes = interpretLcdBody({ code: 3, message: "ORDER_BY_BLOCK_ASC is not a valid tx.OrderBy" });
  check("code 3 hard error", errRes.ok === false && !errRes.retryable);

  const retryRes = interpretLcdBody({ code: 13, message: "query cannot be empty" });
  check("code 13 retryable", retryRes.ok === false && retryRes.retryable === true);

  const timeoutRes = interpretLcdBody({ code: 2, message: "internal timeout" });
  check("code 2 retryable", timeoutRes.ok === false && timeoutRes.retryable === true);

  const emptyRes = interpretLcdBody(null);
  check("empty body retryable", emptyRes.ok === false && emptyRes.retryable === true);

  const emptyRes2 = interpretLcdBody("not an object");
  check("string body retryable", emptyRes2.ok === false && emptyRes2.retryable === true);

  // code 0 is success
  const codeZero = interpretLcdBody({ code: 0, balances: [] });
  check("code 0 is success", codeZero.ok === true);

  // --- cosmos error codes ---
  check("code 2 retryable", isRetryableCosmosCode(2));
  check("code 13 retryable", isRetryableCosmosCode(13));
  check("code 3 not retryable", !isRetryableCosmosCode(3));
  check("code 4 not retryable", !isRetryableCosmosCode(4));
  check("code 1 not retryable", !isRetryableCosmosCode(1));

  // --- HTTP status ---
  check("429 retryable", isRetryableHttpStatus(429));
  check("503 retryable", isRetryableHttpStatus(503));
  check("500 retryable", isRetryableHttpStatus(500));
  check("404 not retryable", !isRetryableHttpStatus(404));
  check("200 not retryable", !isRetryableHttpStatus(200));
  check("400 not retryable", !isRetryableHttpStatus(400));

  // --- balance extraction ---
  const balBody = {
    balances: [
      { denom: "ucore", amount: "1160717368" },
      { denom: "usara-core1r9gc0abc", amount: "100000000" },
    ],
    pagination: { next_key: null, total: "2" },
  };
  const balEntries = extractBalances(balBody);
  check("extract balances count", balEntries.length === 2);
  check("extract balances first", balEntries[0].denom === "ucore" && balEntries[0].amount === "1160717368");
  check("extract balances second", balEntries[1].denom === "usara-core1r9gc0abc");

  // malformed balance entries skipped
  const malBalBody = {
    balances: [
      { denom: "ucore", amount: "100" },
      { denom: "bad" }, // missing amount
      null,
      { amount: "200" }, // missing denom
      { denom: "ok", amount: "300" },
    ],
  };
  check("extract skips malformed", extractBalances(malBalBody).length === 2);

  check("extract balances empty body", extractBalances({}).length === 0);
  check("extract balances null body", extractBalances(null).length === 0);

  // --- next key extraction ---
  check("extract next key null", extractNextKey({ pagination: { next_key: null, total: "5" } }) === null);
  check("extract next key present", extractNextKey({ pagination: { next_key: "abcKey==", total: "100" } }) === "abcKey==");
  check("extract next key no pagination", extractNextKey({ balances: [] }) === null);
  check("extract next key null body", extractNextKey(null) === null);
  check("extract next key empty string is null", extractNextKey({ pagination: { next_key: "", total: "0" } }) === null);

  // pagination can be null entirely (LCD returns null when all results fit)
  check("extract next key pagination null", extractNextKey({ txs: [], pagination: null }) === null);

  // --- tx response extraction ---
  const txBody = {
    txs: [{ body: { messages: [{ "@type": "/cosmos.bank.v1beta1.MsgSend" }] } }],
    tx_responses: [
      { txhash: "ABC123", height: "82238241", code: 0, timestamp: "2026-08-07T12:01:04Z" },
      { txhash: "DEF456", height: "82238242", code: 0, timestamp: "2026-08-07T12:02:04Z" },
    ],
    pagination: null,
    total: "2",
  };
  const txResponses = extractTxResponses(txBody);
  check("extract tx responses count", txResponses.length === 2);
  check("extract tx responses first hash", txResponses[0].txhash === "ABC123");
  check("extract tx responses first height", txResponses[0].height === "82238241");

  const txs = extractTxs(txBody);
  check("extract txs count", txs.length === 1);
  check("extract txs first message type", txs[0].body?.messages?.[0]?.["@type"] === "/cosmos.bank.v1beta1.MsgSend");

  check("extract tx responses empty", extractTxResponses({}).length === 0);
  check("extract tx responses null", extractTxResponses(null).length === 0);
  check("extract txs empty", extractTxs({}).length === 0);

  // --- event attribute extraction ---
  const ev: CosmosEvent = {
    type: "transfer",
    attributes: [
      { key: "recipient", value: "core1abc" },
      { key: "sender", value: "core1def" },
      { key: "amount", value: "400000000ucore" },
    ],
  };
  check("find attr recipient", findEventAttribute(ev, "recipient") === "core1abc");
  check("find attr sender", findEventAttribute(ev, "sender") === "core1def");
  check("find attr amount", findEventAttribute(ev, "amount") === "400000000ucore");
  check("find attr missing", findEventAttribute(ev, "nonexistent") === null);
  check("find attr no attrs", findEventAttribute({ type: "x" }, "y") === null);

  // findEventsByType
  const sampleTxResp: CosmosTxResponse = {
    events: [
      { type: "transfer", attributes: [{ key: "amount", value: "100ucore" }] },
      { type: "message", attributes: [{ key: "action", value: "/cosmos.bank.v1beta1.MsgSend" }] },
      { type: "transfer", attributes: [{ key: "amount", value: "200ucore" }] },
      { type: "wasm", attributes: [{ key: "action", value: "swap" }] },
    ],
  };
  const transferEvents = findEventsByType(sampleTxResp, "transfer");
  check("find events by type count", transferEvents.length === 2);
  const wasmEvents = findEventsByType(sampleTxResp, "wasm");
  check("find wasm events count", wasmEvents.length === 1);
  check("find nonexistent events", findEventsByType(sampleTxResp, "nonexistent").length === 0);
  check("find events null tx response", findEventsByType({}, "transfer").length === 0);

  // findAttributeInFirstEvent
  check("find first event attr", findAttributeInFirstEvent(sampleTxResp, "wasm", "action") === "swap");
  check("find first event attr missing type", findAttributeInFirstEvent(sampleTxResp, "nonexistent", "x") === null);

  // --- throttle spacing ---
  check("first request no wait", nextRequestDelayMs(null, 1000) === 0);
  check("spacing enforced", nextRequestDelayMs(1000, 1100, 250) === 150);
  check("spacing elapsed no wait", nextRequestDelayMs(1000, 2000, 250) === 0);
  check("spacing exactly elapsed", nextRequestDelayMs(1000, 1250, 250) === 0);

  // --- backoff ---
  check("backoff attempt 0", backoffDelayMs(0, 500, 8000) === 500);
  check("backoff attempt 1", backoffDelayMs(1, 500, 8000) === 1000);
  check("backoff attempt 2", backoffDelayMs(2, 500, 8000) === 2000);
  check("backoff attempt 3", backoffDelayMs(3, 500, 8000) === 4000);
  check("backoff capped", backoffDelayMs(10, 500, 8000) === 8000);
  check("backoff negative attempt", backoffDelayMs(-1, 500, 8000) === 500);
  check("backoff default base", backoffDelayMs(0) === COREUM_BASE_BACKOFF_MS);

  // --- shouldRetry ---
  check("shouldRetry within limit", shouldRetry(1, true, 4) === true);
  check("shouldRetry at limit", shouldRetry(4, true, 4) === false);
  check("shouldRetry exhausted", shouldRetry(5, true, 4) === false);
  check("shouldRetry non-retryable", shouldRetry(0, false, 4) === false);
  check("shouldRetry default max", shouldRetry(0, true) === true);

  console.log("coreum-client-core self-tests: all passed");
}
