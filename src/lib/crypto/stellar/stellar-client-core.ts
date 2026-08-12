/**
 * src/lib/crypto/stellar/stellar-client-core.ts
 *
 * PURE helpers for the Stellar (XLM) client: Horizon endpoint resolution, URL
 * building for the account-scoped endpoints we read, response-envelope reading,
 * cursor extraction from HAL `_links.next`, fair-use throttle spacing, and
 * retry/backoff scheduling. NO `server-only`, NO network -- so it runs under
 * `tsx`/`vitest` and its logic is fully self-tested.
 *
 * WHY A PURE CORE FOR A NETWORK CLIENT
 * ------------------------------------
 * We read Stellar's FREE public Horizon (horizon.stellar.org) over HTTPS. It is
 * a shared, fair-use service, so the *policy* -- how long to wait between calls,
 * how to back off on errors, how to tell a transient error from a hard one, how
 * to read the HAL JSON envelope and follow the `_links.next` cursor -- is written
 * here as deterministic, tested logic. The server-only client is then a thin
 * shell that just performs `fetch` and sleeps.
 *
 * VERIFIED against official Stellar docs (developers.stellar.org) and live calls
 * to Horizon on 2026-08-12:
 *   - Base URL: https://horizon.stellar.org (no API key required).
 *   - Account:   GET /accounts/{account_id}                 -> { balances: [...] }
 *   - Payments:  GET /accounts/{account_id}/payments?...     -> HAL collection
 *   - Collections are HAL: records live under `_embedded.records`, and the next
 *     page is `_links.next.href` (also expressible as `?cursor=<paging_token>`).
 *   - Order is `asc` (oldest-first) for a stable, resumable backfill.
 *
 * IMPORTANT HISTORY NOTE (surfaced to the owner, not a code concern): SDF's
 * public Horizon retains only ~12 months of history (truncated Aug 1 2024), so a
 * pre-2024 acquisition is outside this free window. This connector captures the
 * live balance + every operation Horizon still serves; older cost-basis is
 * reconstructed separately.
 */

// ---------------------------------------------------------------------------
// Endpoint + tuning constants (verified; never guessed)
// ---------------------------------------------------------------------------

/** Default public Horizon endpoint (no API key required). No trailing slash. */
export const DEFAULT_HORIZON_ENDPOINT = "https://horizon.stellar.org";

/** Minimum spacing between requests to respect the shared service (ms). */
export const STELLAR_MIN_REQUEST_SPACING_MS = 250;

/** How many times to retry a transient failure before giving up. */
export const STELLAR_MAX_RETRIES = 4;

/** Base backoff (ms) -- doubles each retry, capped by STELLAR_MAX_BACKOFF_MS. */
export const STELLAR_BASE_BACKOFF_MS = 500;

/** Ceiling for a single backoff wait (ms). */
export const STELLAR_MAX_BACKOFF_MS = 8000;

/** Per-request network timeout (ms). */
export const STELLAR_REQUEST_TIMEOUT_MS = 15000;

/** Page size for the payments walk (Horizon max is 200). */
export const STELLAR_PAGE_LIMIT = 200;

// ---------------------------------------------------------------------------
// Endpoint resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Horizon endpoint from an optional override (e.g. an env var).
 * Falls back to the public endpoint. Strips a trailing slash and requires an
 * https/http scheme; a malformed override is ignored in favor of the safe
 * default rather than throwing (an unconfigured deploy must keep working).
 */
export function resolveHorizonEndpoint(override?: string | null): string {
  const raw = (override ?? "").trim();
  if (raw.length === 0) return DEFAULT_HORIZON_ENDPOINT;
  if (!/^https?:\/\//i.test(raw)) return DEFAULT_HORIZON_ENDPOINT;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

// ---------------------------------------------------------------------------
// URL building for the account-scoped endpoints we read
// ---------------------------------------------------------------------------

/** URL for `GET /accounts/{id}` -- the wallet's balances snapshot. */
export function accountUrl(endpoint: string, account: string): string {
  if (typeof account !== "string" || account.length === 0) {
    throw new Error("accountUrl: account required");
  }
  return `${resolveHorizonEndpoint(endpoint)}/accounts/${encodeURIComponent(account)}`;
}

/**
 * URL for `GET /accounts/{id}/payments` -- one page of the account's payment
 * history. Oldest-first (`order=asc`) for a stable backfill. A `cursor`
 * (paging_token) resumes exactly where a prior page ended. `include_failed` is
 * false: only successful, value-moving operations are tax-relevant.
 */
export function accountPaymentsUrl(
  endpoint: string,
  account: string,
  opts: { cursor?: string | null; limit?: number } = {},
): string {
  if (typeof account !== "string" || account.length === 0) {
    throw new Error("accountPaymentsUrl: account required");
  }
  const base = `${resolveHorizonEndpoint(endpoint)}/accounts/${encodeURIComponent(account)}/payments`;
  const params: string[] = [
    `order=asc`,
    `limit=${clampPageLimit(opts.limit)}`,
    `include_failed=false`,
  ];
  const cursor = (opts.cursor ?? "").trim();
  if (cursor.length > 0) params.push(`cursor=${encodeURIComponent(cursor)}`);
  return `${base}?${params.join("&")}`;
}

/** Clamp the page limit to Horizon's polite range [1, 200]. */
export function clampPageLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return STELLAR_PAGE_LIMIT;
  const n = Math.trunc(limit);
  if (n < 1) return 1;
  if (n > STELLAR_PAGE_LIMIT) return STELLAR_PAGE_LIMIT;
  return n;
}

// ---------------------------------------------------------------------------
// HAL collection reading
// ---------------------------------------------------------------------------

/** A HAL collection page: records + optional next-cursor. */
export type HorizonPage<T = Record<string, unknown>> = {
  records: T[];
  /** The `cursor` to request the NEXT page, or null when there are no more. */
  nextCursor: string | null;
};

/**
 * Read the records out of a HAL collection body: they live under
 * `_embedded.records`. Returns [] for a malformed/empty body (the caller treats
 * an empty page as "done"), never throws.
 */
export function extractRecords(body: unknown): Record<string, unknown>[] {
  if (!body || typeof body !== "object") return [];
  const embedded = (body as { _embedded?: { records?: unknown } })._embedded;
  if (!embedded || typeof embedded !== "object") return [];
  const records = (embedded as { records?: unknown }).records;
  if (!Array.isArray(records)) return [];
  return records.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

/**
 * Pull the `cursor` query value out of a HAL `_links.next.href`. Horizon always
 * echoes the next page as a full URL whose `cursor` param is the last record's
 * `paging_token`. We prefer parsing the href (authoritative) and fall back to
 * the last record's `paging_token` if the link is missing.
 *
 * Returns null when there is no usable next cursor (end of history).
 */
export function extractNextCursor(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const links = (body as { _links?: { next?: { href?: unknown } } })._links;
  const href = links?.next?.href;
  if (typeof href === "string" && href.length > 0) {
    const c = cursorFromHref(href);
    if (c !== null) return c;
  }
  // Fallback: last record's paging_token.
  const records = extractRecords(body);
  if (records.length === 0) return null;
  const last = records[records.length - 1];
  const token = last.paging_token;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Extract the `cursor=` value from a Horizon next-page href (query string). */
export function cursorFromHref(href: string): string | null {
  // Horizon may HTML-escape `&` as `\u0026` in JSON, but JSON.parse restores it
  // to a real `&` before this runs. Parse defensively without a URL object so
  // this stays pure and dependency-free.
  const qIndex = href.indexOf("?");
  const query = qIndex >= 0 ? href.slice(qIndex + 1) : href;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    if (key === "cursor") {
      const val = pair.slice(eq + 1);
      try {
        return decodeURIComponent(val);
      } catch {
        return val;
      }
    }
  }
  return null;
}

/** Read one HAL collection body into records + next-cursor. */
export function readHorizonPage(body: unknown): HorizonPage {
  return {
    records: extractRecords(body),
    nextCursor: extractNextCursor(body),
  };
}

// ---------------------------------------------------------------------------
// HTTP status interpretation
// ---------------------------------------------------------------------------

/** An HTTP status is retryable if it's a 429 or any 5xx. */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * A Horizon 404 on `/accounts/{id}` means the account does not exist on-ledger
 * yet (unfunded) -- NOT an error we should retry or surface as a failure. The
 * caller treats it as "no balances / no history".
 */
export function isAccountNotFound(status: number): boolean {
  return status === 404;
}

// ---------------------------------------------------------------------------
// Throttle + backoff scheduling (identical policy to the XRPL client-core)
// ---------------------------------------------------------------------------

/**
 * How long to wait before the NEXT request, given the timestamp of the last
 * request, to honor the minimum spacing. Deterministic (no clock inside).
 */
export function nextRequestDelayMs(
  lastRequestAtMs: number | null,
  nowMs: number,
  spacingMs: number = STELLAR_MIN_REQUEST_SPACING_MS,
): number {
  if (lastRequestAtMs === null) return 0;
  const elapsed = nowMs - lastRequestAtMs;
  const wait = spacingMs - elapsed;
  return wait > 0 ? wait : 0;
}

/** Exponential backoff for retry attempt `attempt` (0-based): base * 2^attempt, capped. */
export function backoffDelayMs(
  attempt: number,
  base: number = STELLAR_BASE_BACKOFF_MS,
  cap: number = STELLAR_MAX_BACKOFF_MS,
): number {
  if (attempt < 0) attempt = 0;
  const raw = base * Math.pow(2, attempt);
  return Math.min(raw, cap);
}

/** Whether another retry is allowed for a retryable failure. */
export function shouldRetry(
  attempt: number,
  retryable: boolean,
  maxRetries: number = STELLAR_MAX_RETRIES,
): boolean {
  return retryable && attempt < maxRetries;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`stellar-client-core self-test FAILED: ${name}`);
}

export function __runStellarClientCoreTests(): void {
  const ACC = "GA5G6NOV57S267XTVZFZYAED2JKPYEBL7X73XZ62B2KIMU237NBGHPMT";

  // endpoint resolution
  check("default endpoint", resolveHorizonEndpoint() === DEFAULT_HORIZON_ENDPOINT);
  check("override strips slash", resolveHorizonEndpoint("https://my.node/") === "https://my.node");
  check("override kept", resolveHorizonEndpoint("https://my.node") === "https://my.node");
  check("bad override falls back", resolveHorizonEndpoint("not-a-url") === DEFAULT_HORIZON_ENDPOINT);
  check("blank override falls back", resolveHorizonEndpoint("   ") === DEFAULT_HORIZON_ENDPOINT);

  // URL building
  check(
    "account url",
    accountUrl(DEFAULT_HORIZON_ENDPOINT, ACC) ===
      `${DEFAULT_HORIZON_ENDPOINT}/accounts/${ACC}`,
  );
  const p0 = accountPaymentsUrl(DEFAULT_HORIZON_ENDPOINT, ACC);
  check("payments url asc", p0.includes("order=asc"));
  check("payments url limit", p0.includes(`limit=${STELLAR_PAGE_LIMIT}`));
  check("payments url include_failed=false", p0.includes("include_failed=false"));
  check("payments url no cursor when absent", !p0.includes("cursor="));
  const p1 = accountPaymentsUrl(DEFAULT_HORIZON_ENDPOINT, ACC, { cursor: "248079673249452093", limit: 50 });
  check("payments url cursor", p1.includes("cursor=248079673249452093"));
  check("payments url limit override", p1.includes("limit=50"));

  // limit clamp
  check("limit clamp high", clampPageLimit(9999) === 200);
  check("limit clamp low", clampPageLimit(0) === 1);
  check("limit default", clampPageLimit(undefined) === 200);

  // HAL reading -- shaped exactly like a live Horizon payments page
  const livePage = {
    _links: {
      self: { href: `${DEFAULT_HORIZON_ENDPOINT}/accounts/${ACC}/payments?cursor=&limit=2&order=asc` },
      next: { href: `${DEFAULT_HORIZON_ENDPOINT}/accounts/${ACC}/payments?cursor=248079673249452093&limit=2&order=asc` },
      prev: { href: `${DEFAULT_HORIZON_ENDPOINT}/accounts/${ACC}/payments?cursor=247572957302546493&limit=2&order=desc` },
    },
    _embedded: {
      records: [
        { id: "247572957302546493", paging_token: "247572957302546493", type: "payment", amount: "0.0000001" },
        { id: "248079673249452093", paging_token: "248079673249452093", type: "payment", amount: "0.0000001" },
      ],
    },
  };
  const page = readHorizonPage(livePage);
  check("extract 2 records", page.records.length === 2);
  check("next cursor from href", page.nextCursor === "248079673249452093");
  check("cursorFromHref direct", cursorFromHref("https://h/accounts/x/payments?cursor=ABC&limit=2") === "ABC");
  check("cursorFromHref no cursor", cursorFromHref("https://h/x?order=asc") === null);

  // empty / malformed bodies
  check("empty body -> 0 records", extractRecords(null).length === 0);
  check("empty body -> null cursor", extractNextCursor(null) === null);
  const noNext = { _embedded: { records: [{ paging_token: "LAST" }] } };
  check("no next link -> fallback paging_token", extractNextCursor(noNext) === "LAST");
  const emptyRecords = { _embedded: { records: [] }, _links: {} };
  check("empty records -> null cursor", extractNextCursor(emptyRecords) === null);

  // http status
  check("429 retryable", isRetryableHttpStatus(429));
  check("503 retryable", isRetryableHttpStatus(503));
  check("404 not retryable", !isRetryableHttpStatus(404));
  check("200 not retryable", !isRetryableHttpStatus(200));
  check("404 is account-not-found", isAccountNotFound(404));
  check("200 is not account-not-found", !isAccountNotFound(200));

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

  console.log("stellar-client-core self-tests: all passed");
}
