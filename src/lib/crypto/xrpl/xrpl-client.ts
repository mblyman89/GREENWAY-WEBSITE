import "server-only";

/**
 * src/lib/crypto/xrpl/xrpl-client.ts — C4
 *
 * The server-only, read-only XRP Ledger client. It talks to the FREE public
 * XRPL cluster (xrplcluster.com) over HTTPS JSON-RPC. There are NO API keys and
 * NO secrets — the XRP Ledger's public data is open — so an unconfigured deploy
 * still works; the only optional env var is a custom endpoint override.
 *
 * WATCH-ONLY: this client can ONLY read (account_info / account_lines /
 * account_tx). It never signs, submits, or moves anything. It cannot, by
 * construction, touch Michael's funds.
 *
 * FAIR USE: the public cluster is shared, so every call is spaced by a minimum
 * interval and transient failures are retried with exponential backoff. All of
 * that POLICY lives in the pure `xrpl-client-core` (and is self-tested); this
 * file is the thin shell that performs `fetch` and `sleep`.
 *
 * Nothing here parses balances or transactions into tax records — that is the
 * job of the pure `xrpl-map-core`. This client returns the raw `result` object
 * so the mappers stay the single source of tax truth.
 */

import {
  resolveXrplEndpoint,
  accountInfoRequest,
  accountLinesRequest,
  accountTxRequest,
  interpretRpcBody,
  isRetryableHttpStatus,
  nextRequestDelayMs,
  backoffDelayMs,
  shouldRetry,
  XRPL_REQUEST_TIMEOUT_MS,
  type XrplRpcRequest,
  type XrplRpcResult,
} from "./xrpl-client-core";

/** Optional endpoint override (e.g. a private node). No key required. */
const ENDPOINT = resolveXrplEndpoint(process.env.XRPL_RPC_URL);

/** Serialize + space requests across the whole process to respect fair use. */
let lastRequestAtMs: number | null = null;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Perform a single JSON-RPC POST with a timeout. Returns the parsed body or
 * throws on network/HTTP failure (the caller decides retry).
 */
async function postOnce(req: XrplRpcRequest): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), XRPL_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(req),
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
 * chained on a single queue so we never exceed the shared cluster's fair-use
 * spacing, even under concurrent callers.
 */
async function call(req: XrplRpcRequest): Promise<XrplRpcResult> {
  const run = async (): Promise<XrplRpcResult> => {
    let attempt = 0;
    for (;;) {
      // Respect minimum spacing since the previous request.
      const wait = nextRequestDelayMs(lastRequestAtMs, Date.now());
      if (wait > 0) await sleep(wait);
      lastRequestAtMs = Date.now();

      try {
        const { status, body } = await postOnce(req);
        if (status >= 200 && status < 300) {
          const interpreted = interpretRpcBody(body);
          if (interpreted.ok) return interpreted;
          if (shouldRetry(attempt, interpreted.retryable)) {
            await sleep(backoffDelayMs(attempt));
            attempt += 1;
            continue;
          }
          return interpreted;
        }
        // Non-2xx HTTP.
        if (shouldRetry(attempt, isRetryableHttpStatus(status))) {
          await sleep(backoffDelayMs(attempt));
          attempt += 1;
          continue;
        }
        return { ok: false, error: `HTTP ${status}`, retryable: false };
      } catch (err) {
        // Network error / timeout — retry a few times.
        if (shouldRetry(attempt, true)) {
          await sleep(backoffDelayMs(attempt));
          attempt += 1;
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `network: ${message}`, retryable: false };
      }
    }
  };

  // Chain onto the queue so requests never overlap.
  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

// ---------------------------------------------------------------------------
// Public read methods (return the raw `result` object; mappers do the parsing)
// ---------------------------------------------------------------------------

/** Fetch an account's XRP balance + sequence (validated ledger). */
export async function fetchAccountInfo(account: string): Promise<XrplRpcResult> {
  return call(accountInfoRequest(account));
}

/**
 * Fetch ALL trust lines for an account, following `marker` pagination so we
 * never miss a holding. Merges every page's `lines` into one result.
 */
export async function fetchAccountLines(account: string): Promise<XrplRpcResult> {
  const allLines: unknown[] = [];
  let marker: unknown = undefined;
  let lastResult: Record<string, unknown> = {};
  for (;;) {
    const page = await call(accountLinesRequest(account, marker));
    if (!page.ok) return page;
    lastResult = page.result;
    const lines = (page.result as { lines?: unknown[] }).lines ?? [];
    for (const l of lines) allLines.push(l);
    const nextMarker = (page.result as { marker?: unknown }).marker;
    if (nextMarker === undefined || nextMarker === null) break;
    marker = nextMarker;
  }
  return { ok: true, result: { ...lastResult, lines: allLines, marker: undefined } };
}

/**
 * Fetch ONE page of an account's transaction history. Backfill/pagination is
 * orchestrated in a later slice (C5); this returns the raw page including the
 * `transactions` array and any `marker` so the orchestrator can resume.
 */
export async function fetchAccountTxPage(
  account: string,
  opts: { ledgerIndexMin?: number; ledgerIndexMax?: number; limit?: number; marker?: unknown; forward?: boolean } = {},
): Promise<XrplRpcResult> {
  return call(accountTxRequest(account, opts));
}

/** True when a custom endpoint is configured (public cluster is always usable). */
export function xrplEndpoint(): string {
  return ENDPOINT;
}
