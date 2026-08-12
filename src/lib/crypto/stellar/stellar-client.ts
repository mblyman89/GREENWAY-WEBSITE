import "server-only";

/**
 * src/lib/crypto/stellar/stellar-client.ts
 *
 * The server-only, read-only Stellar (XLM) client. It talks to the FREE public
 * Horizon API (horizon.stellar.org) over HTTPS. There are NO API keys and NO
 * secrets -- Stellar's public data is open -- so an unconfigured deploy still
 * works; the only optional env var is a custom endpoint override (HORIZON_URL).
 *
 * WATCH-ONLY: this client can ONLY read (account balances + payment history).
 * It never signs, submits, or moves anything. It cannot, by construction, touch
 * Michael's funds.
 *
 * FAIR USE: Horizon is a shared service, so every call is spaced by a minimum
 * interval and transient failures are retried with exponential backoff. All of
 * that POLICY lives in the pure `stellar-client-core` (and is self-tested); this
 * file is the thin shell that performs `fetch` and `sleep`.
 *
 * Nothing here parses balances or transactions into tax records -- that is the
 * job of the pure `stellar-map-core`. This client returns the raw JSON body (or
 * a friendly result) so the mappers stay the single source of tax truth.
 */

import {
  resolveHorizonEndpoint,
  accountUrl,
  accountPaymentsUrl,
  readHorizonPage,
  isRetryableHttpStatus,
  isAccountNotFound,
  nextRequestDelayMs,
  backoffDelayMs,
  shouldRetry,
  STELLAR_REQUEST_TIMEOUT_MS,
  type HorizonPage,
} from "./stellar-client-core";

/** Optional endpoint override (e.g. a private Horizon). No key required. */
const ENDPOINT = resolveHorizonEndpoint(process.env.HORIZON_URL);

/** Serialize + space requests across the whole process to respect fair use. */
let lastRequestAtMs: number | null = null;
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A single GET result: status + parsed JSON body (or null on parse failure). */
type RawGet = { status: number; body: unknown };

/** Perform a single GET with a timeout. Throws on network failure. */
async function getOnce(url: string): Promise<RawGet> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STELLAR_REQUEST_TIMEOUT_MS);
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

/** A friendly GET result the callers work with. */
export type StellarGetResult =
  | { ok: true; body: unknown; notFound?: false }
  | { ok: true; body: null; notFound: true }
  | { ok: false; error: string };

/**
 * Run one GET through the throttle + retry/backoff policy. All calls are chained
 * on a single queue so we never exceed Horizon's fair-use spacing, even under
 * concurrent callers. A 404 is surfaced as `{ ok:true, notFound:true }` (an
 * unfunded account), NOT an error.
 */
async function get(url: string): Promise<StellarGetResult> {
  const run = async (): Promise<StellarGetResult> => {
    let attempt = 0;
    for (;;) {
      const wait = nextRequestDelayMs(lastRequestAtMs, Date.now());
      if (wait > 0) await sleep(wait);
      lastRequestAtMs = Date.now();

      try {
        const { status, body } = await getOnce(url);
        if (status >= 200 && status < 300) {
          return { ok: true, body };
        }
        if (isAccountNotFound(status)) {
          return { ok: true, body: null, notFound: true };
        }
        if (shouldRetry(attempt, isRetryableHttpStatus(status))) {
          await sleep(backoffDelayMs(attempt));
          attempt += 1;
          continue;
        }
        return { ok: false, error: `HTTP ${status}` };
      } catch (err) {
        if (shouldRetry(attempt, true)) {
          await sleep(backoffDelayMs(attempt));
          attempt += 1;
          continue;
        }
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `network: ${message}` };
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
// Public read methods
// ---------------------------------------------------------------------------

/** The balances array from `GET /accounts/{id}`, or null for an unfunded account. */
export type StellarAccountBalances =
  | { ok: true; balances: Record<string, unknown>[]; exists: boolean }
  | { ok: false; error: string };

/**
 * Fetch an account's current balances. An unfunded account (404) returns
 * `{ ok:true, exists:false, balances:[] }` -- that's not an error.
 */
export async function fetchStellarBalances(account: string): Promise<StellarAccountBalances> {
  const res = await get(accountUrl(ENDPOINT, account));
  if (!res.ok) return { ok: false, error: res.error };
  if (res.notFound) return { ok: true, balances: [], exists: false };
  const balances = (res.body as { balances?: unknown }).balances;
  const arr = Array.isArray(balances)
    ? balances.filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    : [];
  return { ok: true, balances: arr, exists: true };
}

/** One page of payments: mapped records + next cursor, or a friendly error. */
export type StellarPaymentsPage =
  | { ok: true; page: HorizonPage; exists: boolean }
  | { ok: false; error: string };

/**
 * Fetch ONE page of an account's payment history, oldest-first, resuming from
 * `cursor` when given. Returns the HAL page (records + next cursor). A 404 (the
 * account never existed) returns an empty page with exists=false.
 */
export async function fetchStellarPaymentsPage(
  account: string,
  opts: { cursor?: string | null; limit?: number } = {},
): Promise<StellarPaymentsPage> {
  const url = accountPaymentsUrl(ENDPOINT, account, opts);
  const res = await get(url);
  if (!res.ok) return { ok: false, error: res.error };
  if (res.notFound) {
    return { ok: true, page: { records: [], nextCursor: null }, exists: false };
  }
  return { ok: true, page: readHorizonPage(res.body), exists: true };
}

/** The resolved Horizon endpoint in use (public unless overridden). */
export function horizonEndpoint(): string {
  return ENDPOINT;
}
