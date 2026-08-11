/**
 * src/lib/crypto/xrpl/xrpl-client-core.ts — C4
 *
 * PURE helpers for the XRPL client: endpoint resolution, JSON-RPC request
 * building, response envelope validation, fair-use throttle spacing, and
 * retry/backoff scheduling. NO `server-only`, NO network — so it runs under
 * `tsx`/`vitest` and its logic is fully self-tested.
 *
 * WHY A PURE CORE FOR A NETWORK CLIENT
 * ------------------------------------
 * The XRP Ledger public cluster (xrplcluster.com) is a FREE, shared, fair-use
 * service. Hammering it gets us throttled or banned, which would silently break
 * Michael's tax record. So the *policy* — how long to wait between calls, how to
 * back off on errors, how to tell a real error from a transient one, how to read
 * the JSON-RPC envelope — is written here as deterministic, tested logic. The
 * server-only client is then a thin shell that just performs `fetch` and sleeps.
 */

/** Default public XRPL JSON-RPC endpoint (no API key required). */
export const DEFAULT_XRPL_ENDPOINT = "https://xrplcluster.com/";

/** Minimum spacing between requests to respect the shared cluster (ms). */
export const XRPL_MIN_REQUEST_SPACING_MS = 250;

/** How many times to retry a transient failure before giving up. */
export const XRPL_MAX_RETRIES = 4;

/** Base backoff (ms) — doubles each retry, capped by XRPL_MAX_BACKOFF_MS. */
export const XRPL_BASE_BACKOFF_MS = 500;

/** Ceiling for a single backoff wait (ms). */
export const XRPL_MAX_BACKOFF_MS = 8000;

/** Per-request network timeout (ms). */
export const XRPL_REQUEST_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// Endpoint resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the XRPL endpoint from an optional override (e.g. an env var). Falls
 * back to the public cluster. Ensures a trailing slash and an https/http scheme;
 * a malformed override is ignored in favor of the safe default rather than
 * throwing (an unconfigured deploy must keep working).
 */
export function resolveXrplEndpoint(override?: string | null): string {
  const raw = (override ?? "").trim();
  if (raw.length === 0) return DEFAULT_XRPL_ENDPOINT;
  if (!/^https?:\/\//i.test(raw)) return DEFAULT_XRPL_ENDPOINT;
  return raw.endsWith("/") ? raw : raw + "/";
}

// ---------------------------------------------------------------------------
// JSON-RPC request building
// ---------------------------------------------------------------------------

export type XrplRpcRequest = {
  method: string;
  params: [Record<string, unknown>];
};

/**
 * Build an XRPL JSON-RPC request body. XRPL's HTTP JSON-RPC takes a single
 * `params` array with one object. We always request `api_version: 2` and only
 * validated ledgers for a stable, tax-truthful read.
 */
export function buildRpcRequest(method: string, params: Record<string, unknown>): XrplRpcRequest {
  if (typeof method !== "string" || method.length === 0) {
    throw new Error("buildRpcRequest: method required");
  }
  return { method, params: [{ api_version: 2, ...params }] };
}

/** Convenience builders for the three methods this connector uses. */
export function accountInfoRequest(account: string): XrplRpcRequest {
  return buildRpcRequest("account_info", {
    account,
    ledger_index: "validated",
    strict: true,
  });
}

export function accountLinesRequest(account: string, marker?: unknown): XrplRpcRequest {
  const params: Record<string, unknown> = {
    account,
    ledger_index: "validated",
    limit: 400,
  };
  if (marker !== undefined && marker !== null) params.marker = marker;
  return buildRpcRequest("account_lines", params);
}

export function accountTxRequest(
  account: string,
  opts: { ledgerIndexMin?: number; ledgerIndexMax?: number; limit?: number; marker?: unknown; forward?: boolean } = {},
): XrplRpcRequest {
  const params: Record<string, unknown> = {
    account,
    ledger_index_min: opts.ledgerIndexMin ?? -1,
    ledger_index_max: opts.ledgerIndexMax ?? -1,
    binary: false,
    forward: opts.forward ?? true, // oldest-first for a stable backfill
    limit: clampTxLimit(opts.limit),
  };
  if (opts.marker !== undefined && opts.marker !== null) params.marker = opts.marker;
  return buildRpcRequest("account_tx", params);
}

/** account_tx limit: keep within a polite range for the shared cluster. */
export function clampTxLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 200;
  const n = Math.trunc(limit);
  if (n < 1) return 1;
  if (n > 400) return 400;
  return n;
}

// ---------------------------------------------------------------------------
// Response envelope validation
// ---------------------------------------------------------------------------

export type XrplRpcResult<T = Record<string, unknown>> =
  | { ok: true; result: T }
  | { ok: false; error: string; retryable: boolean };

/**
 * Interpret a parsed XRPL JSON-RPC response body. XRPL returns
 * `{ result: { status: "success" | "error", ... } }`. We treat known transient
 * conditions as retryable and everything else (e.g. actNotFound) as a hard,
 * non-retryable error so the caller doesn't loop forever.
 */
export function interpretRpcBody(body: unknown): XrplRpcResult {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "empty or non-JSON response", retryable: true };
  }
  const result = (body as { result?: Record<string, unknown> }).result;
  if (!result || typeof result !== "object") {
    return { ok: false, error: "missing result object", retryable: true };
  }
  const status = result.status;
  if (status === "success") {
    return { ok: true, result };
  }
  const errCode = typeof result.error === "string" ? result.error : "unknown_error";
  return { ok: false, error: errCode, retryable: isRetryableXrplError(errCode) };
}

/** Transient XRPL errors worth retrying (server busy / not synced / timeouts). */
export function isRetryableXrplError(code: string): boolean {
  const transient = new Set([
    "noNetwork",
    "noCurrent",
    "tooBusy",
    "slowDown",
    "noClosed",
    "internal",
    "timeout",
    "failedToForward",
    "amendmentBlocked",
  ]);
  return transient.has(code);
}

/** An HTTP status is retryable if it's a 429 or any 5xx. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// ---------------------------------------------------------------------------
// Throttle + backoff scheduling
// ---------------------------------------------------------------------------

/**
 * How long to wait before the NEXT request, given the timestamp of the last
 * request, to honor the minimum spacing. Deterministic (no clock inside).
 */
export function nextRequestDelayMs(
  lastRequestAtMs: number | null,
  nowMs: number,
  spacingMs: number = XRPL_MIN_REQUEST_SPACING_MS,
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
  base: number = XRPL_BASE_BACKOFF_MS,
  cap: number = XRPL_MAX_BACKOFF_MS,
): number {
  if (attempt < 0) attempt = 0;
  const raw = base * Math.pow(2, attempt);
  return Math.min(raw, cap);
}

/** Whether another retry is allowed for a retryable failure. */
export function shouldRetry(attempt: number, retryable: boolean, maxRetries: number = XRPL_MAX_RETRIES): boolean {
  return retryable && attempt < maxRetries;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`xrpl-client-core self-test FAILED: ${name}`);
}

export function __runXrplClientCoreTests(): void {
  // endpoint
  check("default endpoint", resolveXrplEndpoint() === DEFAULT_XRPL_ENDPOINT);
  check("override endpoint keeps slash", resolveXrplEndpoint("https://my.node/") === "https://my.node/");
  check("override endpoint adds slash", resolveXrplEndpoint("https://my.node") === "https://my.node/");
  check("bad override falls back", resolveXrplEndpoint("not-a-url") === DEFAULT_XRPL_ENDPOINT);
  check("blank override falls back", resolveXrplEndpoint("   ") === DEFAULT_XRPL_ENDPOINT);

  // request building
  const info = accountInfoRequest("rMe");
  check(
    "account_info request",
    info.method === "account_info" &&
      info.params[0].account === "rMe" &&
      info.params[0].api_version === 2 &&
      info.params[0].ledger_index === "validated",
  );
  const lines = accountLinesRequest("rMe");
  check("account_lines request", lines.method === "account_lines" && lines.params[0].limit === 400);
  const linesM = accountLinesRequest("rMe", { ledger: 1, seq: 2 });
  check("account_lines marker passed", linesM.params[0].marker !== undefined);
  const tx = accountTxRequest("rMe", { limit: 100 });
  check(
    "account_tx request",
    tx.method === "account_tx" &&
      tx.params[0].limit === 100 &&
      tx.params[0].forward === true &&
      tx.params[0].ledger_index_min === -1,
  );
  check("account_tx limit clamp high", clampTxLimit(9999) === 400);
  check("account_tx limit clamp low", clampTxLimit(0) === 1);
  check("account_tx limit default", clampTxLimit(undefined) === 200);

  // envelope interpretation
  const okRes = interpretRpcBody({ result: { status: "success", account_data: {} } });
  check("success envelope", okRes.ok === true);
  const errRes = interpretRpcBody({ result: { status: "error", error: "actNotFound" } });
  check("actNotFound hard error", errRes.ok === false && !errRes.retryable);
  const busyRes = interpretRpcBody({ result: { status: "error", error: "tooBusy" } });
  check("tooBusy retryable", busyRes.ok === false && busyRes.retryable === true);
  const emptyRes = interpretRpcBody(null);
  check("empty body retryable", emptyRes.ok === false && emptyRes.retryable === true);

  // http status
  check("429 retryable", isRetryableHttpStatus(429));
  check("503 retryable", isRetryableHttpStatus(503));
  check("404 not retryable", !isRetryableHttpStatus(404));
  check("200 not retryable", !isRetryableHttpStatus(200));

  // throttle spacing
  check("first request no wait", nextRequestDelayMs(null, 1000) === 0);
  check("spacing enforced", nextRequestDelayMs(1000, 1100, 250) === 150);
  check("spacing elapsed no wait", nextRequestDelayMs(1000, 2000, 250) === 0);

  // backoff
  check("backoff attempt 0", backoffDelayMs(0, 500, 8000) === 500);
  check("backoff attempt 2", backoffDelayMs(2, 500, 8000) === 2000);
  check("backoff capped", backoffDelayMs(10, 500, 8000) === 8000);
  check("shouldRetry within limit", shouldRetry(1, true, 4) === true);
  check("shouldRetry exhausted", shouldRetry(4, true, 4) === false);
  check("shouldRetry non-retryable", shouldRetry(0, false, 4) === false);

  console.log("xrpl-client-core self-tests: all passed");
}
