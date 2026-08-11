import "server-only";

/**
 * src/lib/crypto/coreum/coreum-client.ts — C8b
 *
 * The server-only, read-only Coreum (Cosmos SDK) LCD client. It talks to the
 * FREE public LCD endpoints over HTTPS REST:
 *   - Primary:   https://coreum-api.polkachu.com   (Polkachu)
 *   - Backup:    https://coreum-lcd.publicnode.com  (PublicNode)
 *
 * Both endpoints are FREE and KEYLESS — Coreum's public chain data is open, so
 * an unconfigured deploy still works; the only optional env var is a custom
 * endpoint override.
 *
 * WATCH-ONLY: this client can ONLY read (balances, denom metadata, tx search).
 * It never signs, submits, or moves anything. It cannot, by construction,
 * touch Michael's funds. We use ONLY the wallet's PUBLIC address.
 *
 * FAIR USE: these public endpoints are shared infrastructure, so every call is
 * spaced by a minimum interval (250 ms) and transient failures (429, 5xx,
 * Cosmos SDK error codes, network timeouts) are retried with exponential
 * backoff. All of that POLICY lives in the pure `coreum-client-core` (and is
 * self-tested); this file is the thin shell that performs `fetch` and `sleep`.
 *
 * TWO-PROVIDER FAILOVER: requests are sent to the primary endpoint first. If
 * the primary fails after all retries, the same request is sent to the backup
 * endpoint. This maximises availability against a single provider going down.
 *
 * Nothing here parses balances or transactions into tax records — that is the
 * job of the pure `coreum-map-core`. This client returns the raw response body
 * so the mappers stay the single source of tax truth.
 */

import {
  resolveCoreumLcdEndpoints,
  balancesRequest,
  denomMetadataRequest,
  txsBySenderRequest,
  txsByRecipientRequest,
  interpretLcdBody,
  isRetryableHttpStatus,
  nextRequestDelayMs,
  backoffDelayMs,
  shouldRetry,
  COREUM_REQUEST_TIMEOUT_MS,
  COREUM_MAX_RETRIES,
  COREUM_BASE_BACKOFF_MS,
  COREUM_MAX_BACKOFF_MS,
  COREUM_TX_PAGE_SIZE,
  extractBalances,
  extractNextKey,
  type CoreumLcdRequest,
  type CoreumLcdResult,
  type CoreumLcdEndpoint,
  type CosmosBalanceEntry,
} from "./coreum-client-core";

/**
 * Resolve endpoints. Env override (COREUM_LCD_URL) replaces the primary; the
 * backup is always PublicNode unless explicitly overridden via COREUM_LCD_BACKUP_URL.
 */
const LCD_ENDPOINTS: CoreumLcdEndpoint[] = resolveCoreumLcdEndpoints(
  process.env.COREUM_LCD_URL ?? null,
);

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
  const timer = setTimeout(() => controller.abort(), COREUM_REQUEST_TIMEOUT_MS);
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
 * Run one request against a SINGLE endpoint through the throttle +
 * retry/backoff policy. All calls are chained on a single queue so we never
 * exceed the shared endpoint's fair-use spacing, even under concurrent callers.
 */
async function callOneEndpoint(
  lcdUrl: string,
  req: CoreumLcdRequest,
): Promise<CoreumLcdResult> {
  const run = async (): Promise<CoreumLcdResult> => {
    let attempt = 0;
    for (;;) {
      const wait = nextRequestDelayMs(lastRequestAtMs, Date.now());
      if (wait > 0) await sleep(wait);
      lastRequestAtMs = Date.now();

      try {
        const { status, body } = await getOnce(req.url);
        if (status >= 200 && status < 300) {
          const interpreted = interpretLcdBody(body);
          if (interpreted.ok) return interpreted;
          if (shouldRetry(attempt, interpreted.retryable, COREUM_MAX_RETRIES)) {
            await sleep(backoffDelayMs(attempt, COREUM_BASE_BACKOFF_MS, COREUM_MAX_BACKOFF_MS));
            attempt += 1;
            continue;
          }
          return interpreted;
        }
        if (shouldRetry(attempt, isRetryableHttpStatus(status), COREUM_MAX_RETRIES)) {
          await sleep(backoffDelayMs(attempt, COREUM_BASE_BACKOFF_MS, COREUM_MAX_BACKOFF_MS));
          attempt += 1;
          continue;
        }
        return { ok: false, error: `HTTP ${status}`, retryable: false };
      } catch (err) {
        if (shouldRetry(attempt, true, COREUM_MAX_RETRIES)) {
          await sleep(backoffDelayMs(attempt, COREUM_BASE_BACKOFF_MS, COREUM_MAX_BACKOFF_MS));
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
  return result;
}

// ---------------------------------------------------------------------------
// Public read methods (return the raw response body; mappers do the parsing)
// ---------------------------------------------------------------------------

/**
 * Fetch ALL balances for an address, following `pagination.next_key` so we
 * never miss a holding. Merges every page's balances into one result.
 */
export async function fetchBalances(
  address: string,
): Promise<CoreumLcdResult<CosmosBalanceEntry[]>> {
  const allBalances: CosmosBalanceEntry[] = [];
  let paginationKey: string | null = null;
  for (;;) {
    const result = await fetchBalancesPage(address, paginationKey);
    if (!result.ok) return result;
    const body = result.result;
    const balances = extractBalances(body);
    for (const b of balances) allBalances.push(b);
    const nextKey = extractNextKey(body);
    if (nextKey === null || nextKey === "") break;
    paginationKey = nextKey;
  }
  return { ok: true, result: allBalances };
}

/** Fetch ONE page of balances (internal helper for pagination). */
async function fetchBalancesPage(
  address: string,
  paginationKey: string | null,
): Promise<CoreumLcdResult> {
  let lastError: CoreumLcdResult = { ok: false, error: "no endpoints", retryable: false };
  for (const endpoint of LCD_ENDPOINTS) {
    const req = balancesRequest(endpoint.url, address, paginationKey);
    const result = await callOneEndpoint(endpoint.url, req);
    if (result.ok) return result;
    lastError = result;
  }
  return lastError;
}

/** Fetch denom metadata for a single denom (for decimal verification). */
export async function fetchDenomMetadata(
  denom: string,
): Promise<CoreumLcdResult> {
  let lastError: CoreumLcdResult = { ok: false, error: "no endpoints", retryable: false };
  for (const endpoint of LCD_ENDPOINTS) {
    const req = denomMetadataRequest(endpoint.url, denom);
    const result = await callOneEndpoint(endpoint.url, req);
    if (result.ok) return result;
    lastError = result;
  }
  return lastError;
}

/**
 * Fetch ONE page of txs where the address is the message.sender (outgoing/
 * signed txs). Returns the raw txs response body including tx_responses and
 * pagination.next_key so the sync server can map + advance the cursor.
 */
export async function fetchTxsBySenderPage(
  address: string,
  paginationKey: string | null,
): Promise<CoreumLcdResult> {
  let lastError: CoreumLcdResult = { ok: false, error: "no endpoints", retryable: false };
  for (const endpoint of LCD_ENDPOINTS) {
    const req = txsBySenderRequest(endpoint.url, address, COREUM_TX_PAGE_SIZE, paginationKey);
    const result = await callOneEndpoint(endpoint.url, req);
    if (result.ok) return result;
    lastError = result;
  }
  return lastError;
}

/**
 * Fetch ONE page of txs where the address is the transfer.recipient (incoming
 * txs). Returns the raw txs response body including tx_responses and
 * pagination.next_key so the sync server can map + advance the cursor.
 */
export async function fetchTxsByRecipientPage(
  address: string,
  paginationKey: string | null,
): Promise<CoreumLcdResult> {
  let lastError: CoreumLcdResult = { ok: false, error: "no endpoints", retryable: false };
  for (const endpoint of LCD_ENDPOINTS) {
    const req = txsByRecipientRequest(endpoint.url, address, COREUM_TX_PAGE_SIZE, paginationKey);
    const result = await callOneEndpoint(endpoint.url, req);
    if (result.ok) return result;
    lastError = result;
  }
  return lastError;
}

/** The resolved primary LCD endpoint URL (for diagnostics / logging). */
export function coreumLcdEndpoint(): string {
  return LCD_ENDPOINTS[0]?.url ?? "(none)";
}

/** All resolved LCD endpoints (for diagnostics). */
export function coreumLcdEndpoints(): string[] {
  return LCD_ENDPOINTS.map((e) => e.url);
}
