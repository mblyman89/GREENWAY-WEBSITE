/**
 * src/lib/plaid/plaid-webhook-core.ts — Plaid webhook PURE core (Slice P4).
 *
 * No I/O, no network, no server-only imports — fully unit-testable with tsx and
 * mirrored in vitest. This is the decision brain for the /api/webhooks/plaid
 * receiver: it parses + validates the Plaid-Verification JWT (structure, alg,
 * freshness, body-hash), and decides what a given webhook code should DO. The
 * server layer (plaid-webhook-verify.ts + route.ts) injects the actual crypto
 * and network and keeps itself thin.
 *
 * ── PLAID WEBHOOK VERIFICATION (verified against Plaid's official docs) ──────
 *   1. The `Plaid-Verification` header is a JWT (JWS, ES256).
 *   2. Decode the JWT header WITHOUT verifying; require alg === "ES256"; read
 *      `kid`. Anything else → reject.
 *   3. Fetch the JWK for that `kid` via /webhook_verification_key/get (server).
 *   4. Verify the JWT signature against the JWK (server crypto).
 *   5. Payload has `iat` (issued-at, unix seconds) and `request_body_sha256`.
 *      Reject if the token is older than 5 minutes (replay protection).
 *   6. SHA-256 the RAW request body and constant-time-compare it against
 *      `request_body_sha256`. Mismatch → reject.
 *
 * This module owns steps 2, 5, and the hash-compare of step 6 as pure helpers
 * (the crypto verify of step 4 is server-only). Plaid uses your existing
 * PLAID_CLIENT_ID / PLAID_SECRET to fetch the key, so there is NO extra webhook
 * secret to configure.
 *
 * ── STANDING RULES honored ──────────────────────────────────────────────────
 *   • NEVER GUESS — every branch is explicit; malformed input is rejected, never
 *     "assumed valid". Reasons are returned so the route can log exactly why.
 *   • Pure + fully self-tested (run via scripts/compliance/run-pure-selftests.ts).
 */

// ---------------------------------------------------------------------------
// 1) Base64url + JWT segment decoding (pure; tolerant of bad input)
// ---------------------------------------------------------------------------

/** Decode a base64url string to a UTF-8 string; returns "" on bad input. */
export function base64UrlToString(segment: string | null | undefined): string {
  const s = (segment ?? "").trim();
  if (s === "") return "";
  try {
    // Node + modern runtimes accept "base64url"; normalize defensively anyway.
    const normalized = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + pad, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** The decoded JWT header we care about. */
export type PlaidJwtHeader = { alg: string; kid: string; typ?: string };

/** The decoded JWT payload we care about. */
export type PlaidJwtPayload = { iat: number; requestBodySha256: string };

/**
 * Split a compact JWS into its three segments. Returns null unless there are
 * exactly three non-empty dot-separated parts (header.payload.signature).
 */
export function splitJwt(
  jwt: string | null | undefined,
): { header: string; payload: string; signature: string } | null {
  const parts = (jwt ?? "").trim().split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;
  return { header, payload, signature };
}

/**
 * Decode + validate the JWT HEADER (no signature check here). Requires
 * alg === "ES256" and a non-empty kid, per Plaid's spec. Returns null on any
 * problem so the caller rejects the webhook.
 */
export function decodeJwtHeader(headerSegment: string | null | undefined): PlaidJwtHeader | null {
  const json = base64UrlToString(headerSegment);
  if (json === "") return null;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const alg = typeof rec.alg === "string" ? rec.alg : "";
  const kid = typeof rec.kid === "string" ? rec.kid.trim() : "";
  const typ = typeof rec.typ === "string" ? rec.typ : undefined;
  if (alg !== "ES256") return null; // reject anything but ES256 (Plaid's algorithm)
  if (kid === "") return null;
  return { alg, kid, typ };
}

/**
 * Decode + validate the JWT PAYLOAD (no signature check here). Requires a
 * finite numeric `iat` and a non-empty `request_body_sha256`. Returns null on
 * any problem so the caller rejects the webhook.
 */
export function decodeJwtPayload(payloadSegment: string | null | undefined): PlaidJwtPayload | null {
  const json = base64UrlToString(payloadSegment);
  if (json === "") return null;
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const iat = typeof rec.iat === "number" && Number.isFinite(rec.iat) ? rec.iat : NaN;
  const requestBodySha256 =
    typeof rec.request_body_sha256 === "string" ? rec.request_body_sha256.trim() : "";
  if (!Number.isFinite(iat)) return null;
  if (requestBodySha256 === "") return null;
  return { iat, requestBodySha256 };
}

// ---------------------------------------------------------------------------
// 2) Freshness (replay protection) + constant-time hash compare
// ---------------------------------------------------------------------------

/** Plaid's documented maximum webhook age for replay protection: 5 minutes. */
export const PLAID_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

/**
 * Is a JWT issued-at time fresh enough to accept? `iatSeconds` and `nowSeconds`
 * are UNIX seconds. A token is fresh when it is not older than
 * `maxAgeSeconds` AND not implausibly far in the future (a small clock-skew
 * grace guards against a fast-forward clock without opening a replay window).
 */
export function isJwtFresh(
  iatSeconds: number,
  nowSeconds: number,
  maxAgeSeconds: number = PLAID_WEBHOOK_MAX_AGE_SECONDS,
): boolean {
  if (!Number.isFinite(iatSeconds) || !Number.isFinite(nowSeconds)) return false;
  const ageSeconds = nowSeconds - iatSeconds;
  const CLOCK_SKEW_GRACE = 30; // seconds a token may appear "from the future"
  if (ageSeconds > maxAgeSeconds) return false; // too old → replay
  if (ageSeconds < -CLOCK_SKEW_GRACE) return false; // too far in the future → suspicious
  return true;
}

/**
 * Constant-time comparison of two hex-string hashes. Length mismatch → false
 * immediately (lengths are not secret). Same length → compare every character
 * with no early exit so the timing does not leak how many characters matched.
 * Case-insensitive (hex may arrive upper/lower).
 */
export function constantTimeHexEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? "").toLowerCase();
  const y = (b ?? "").toLowerCase();
  if (x.length === 0 || y.length === 0) return false;
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) {
    diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// 3) What should a webhook code DO?  (webhook_type + webhook_code → action)
// ---------------------------------------------------------------------------

/** The action our receiver takes for a given Plaid webhook. */
export type PlaidWebhookAction = {
  /** Pull transactions after this webhook (the whole point of most of them). */
  resync: boolean;
  /** Target ONLY the item in the webhook (vs a full sweep). */
  targetItem: boolean;
  /** Record the item's error status from this webhook (e.g. login required). */
  recordError: boolean;
  /** Plain-English note for the audit log / diagnostics. */
  note: string;
};

/**
 * Map a Plaid webhook (type + code, both upper-cased by Plaid) to the action we
 * take. We explicitly handle the TRANSACTIONS codes (the reason we subscribed)
 * and the ITEM error/login codes, and default everything else to "acknowledge
 * only" (record + 200, no resync) so an unknown/rare webhook can never trigger
 * a wrong action. NEVER GUESS: unknown → do nothing but acknowledge.
 */
export function mapWebhookToAction(
  webhookType: string | null | undefined,
  webhookCode: string | null | undefined,
): PlaidWebhookAction {
  const type = (webhookType ?? "").trim().toUpperCase();
  const code = (webhookCode ?? "").trim().toUpperCase();

  if (type === "TRANSACTIONS") {
    // SYNC_UPDATES_AVAILABLE is the modern /transactions/sync signal; the legacy
    // INITIAL_UPDATE / HISTORICAL_UPDATE / DEFAULT_UPDATE codes also mean "new
    // data — pull it". TRANSACTIONS_REMOVED means rows were deleted → pull too.
    if (
      code === "SYNC_UPDATES_AVAILABLE" ||
      code === "INITIAL_UPDATE" ||
      code === "HISTORICAL_UPDATE" ||
      code === "DEFAULT_UPDATE" ||
      code === "TRANSACTIONS_REMOVED"
    ) {
      return {
        resync: true,
        targetItem: true,
        recordError: false,
        note: `Transactions webhook ${code} → pull this connection's latest activity.`,
      };
    }
    return {
      resync: false,
      targetItem: true,
      recordError: false,
      note: `Transactions webhook ${code} → acknowledged (no pull needed).`,
    };
  }

  if (type === "ITEM") {
    if (code === "ERROR" || code === "PENDING_EXPIRATION" || code === "USER_PERMISSION_REVOKED" || code === "LOGIN_REPAIRED") {
      // These affect the connection's health; record so the Health tab shows it.
      // LOGIN_REPAIRED means it's healthy again → also worth a resync.
      return {
        resync: code === "LOGIN_REPAIRED",
        targetItem: true,
        recordError: code !== "LOGIN_REPAIRED",
        note: `Item webhook ${code} → update this connection's health${code === "LOGIN_REPAIRED" ? " and pull activity" : ""}.`,
      };
    }
    return {
      resync: false,
      targetItem: true,
      recordError: false,
      note: `Item webhook ${code} → acknowledged.`,
    };
  }

  // Any other webhook type (e.g. HOLDINGS, LIABILITIES we may add later): just
  // acknowledge so Plaid stops retrying, but take no action we didn't design.
  return {
    resync: false,
    targetItem: false,
    recordError: false,
    note: `Webhook ${type || "(none)"}/${code || "(none)"} → acknowledged (no action wired).`,
  };
}

// ---------------------------------------------------------------------------
// 4) A single pure "should we accept this JWT?" gate (excluding the crypto sig)
// ---------------------------------------------------------------------------

/** The pure pre-crypto validation outcome. */
export type JwtPreCheck =
  | { ok: true; kid: string; iat: number; requestBodySha256: string }
  | { ok: false; reason: string };

/**
 * Run every PURE check on the JWT that does NOT require the public key:
 * structure (3 segments), header alg/kid, payload iat/hash, and freshness.
 * The caller still MUST (a) fetch the JWK by `kid`, (b) verify the signature,
 * and (c) constant-time compare the body hash. This function never says a
 * webhook is authentic on its own — it only weeds out everything provably
 * invalid before we spend a network call on the key.
 */
export function preCheckPlaidJwt(
  jwt: string | null | undefined,
  nowSeconds: number,
  maxAgeSeconds: number = PLAID_WEBHOOK_MAX_AGE_SECONDS,
): JwtPreCheck {
  const parts = splitJwt(jwt);
  if (!parts) return { ok: false, reason: "malformed JWT (expected 3 segments)" };

  const header = decodeJwtHeader(parts.header);
  if (!header) return { ok: false, reason: "bad JWT header (need alg ES256 + kid)" };

  const payload = decodeJwtPayload(parts.payload);
  if (!payload) return { ok: false, reason: "bad JWT payload (need iat + request_body_sha256)" };

  if (!isJwtFresh(payload.iat, nowSeconds, maxAgeSeconds)) {
    return { ok: false, reason: "JWT is stale or from the future (replay protection)" };
  }

  return { ok: true, kid: header.kid, iat: payload.iat, requestBodySha256: payload.requestBodySha256 };
}

// ---------------------------------------------------------------------------
// SELF-TESTS (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPlaidWebhookCoreTests(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[plaid-webhook-core] ${msg}`);
  };
  const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

  // base64UrlToString ------------------------------------------------------
  assert(base64UrlToString(b64url("hello")) === "hello", "base64url round-trips");
  assert(base64UrlToString("") === "" && base64UrlToString(null) === "", "blank → empty");

  // splitJwt ---------------------------------------------------------------
  assert(splitJwt("a.b.c")?.signature === "c", "splits 3 segments");
  assert(splitJwt("a.b") === null, "2 segments → null");
  assert(splitJwt("a..c") === null, "empty middle → null");
  assert(splitJwt(null) === null, "null → null");

  // decodeJwtHeader --------------------------------------------------------
  const goodHdr = b64url(JSON.stringify({ alg: "ES256", kid: "k-1", typ: "JWT" }));
  const h = decodeJwtHeader(goodHdr);
  assert(h !== null && h.alg === "ES256" && h.kid === "k-1", "decodes ES256 header");
  assert(decodeJwtHeader(b64url(JSON.stringify({ alg: "HS256", kid: "k" }))) === null, "rejects non-ES256");
  assert(decodeJwtHeader(b64url(JSON.stringify({ alg: "ES256" }))) === null, "rejects missing kid");
  assert(decodeJwtHeader(b64url("not json")) === null, "rejects bad json header");

  // decodeJwtPayload -------------------------------------------------------
  const goodPay = b64url(JSON.stringify({ iat: 1560211755, request_body_sha256: "bbe8e9" }));
  const p = decodeJwtPayload(goodPay);
  assert(p !== null && p.iat === 1560211755 && p.requestBodySha256 === "bbe8e9", "decodes payload");
  assert(decodeJwtPayload(b64url(JSON.stringify({ request_body_sha256: "x" }))) === null, "rejects missing iat");
  assert(decodeJwtPayload(b64url(JSON.stringify({ iat: 1 }))) === null, "rejects missing hash");
  assert(decodeJwtPayload(b64url(JSON.stringify({ iat: "nope", request_body_sha256: "x" }))) === null, "rejects non-numeric iat");

  // isJwtFresh -------------------------------------------------------------
  const now = 1_000_000;
  assert(isJwtFresh(now - 10, now), "10s old → fresh");
  assert(isJwtFresh(now - 299, now), "just under 5 min → fresh");
  assert(!isJwtFresh(now - 301, now), "just over 5 min → stale");
  assert(isJwtFresh(now + 10, now), "10s future (within skew) → fresh");
  assert(!isJwtFresh(now + 120, now), "2 min future → rejected");
  assert(!isJwtFresh(Number.NaN, now), "NaN iat → false");

  // constantTimeHexEquals --------------------------------------------------
  assert(constantTimeHexEquals("ABCD", "abcd"), "case-insensitive equal");
  assert(!constantTimeHexEquals("abcd", "abce"), "one char diff → false");
  assert(!constantTimeHexEquals("abcd", "abcde"), "length diff → false");
  assert(!constantTimeHexEquals("", "abcd") && !constantTimeHexEquals("abcd", ""), "empty → false");

  // mapWebhookToAction -----------------------------------------------------
  const sync = mapWebhookToAction("TRANSACTIONS", "SYNC_UPDATES_AVAILABLE");
  assert(sync.resync && sync.targetItem && !sync.recordError, "SYNC_UPDATES_AVAILABLE → resync this item");
  assert(mapWebhookToAction("transactions", "default_update").resync, "case-insensitive + DEFAULT_UPDATE resyncs");
  assert(mapWebhookToAction("TRANSACTIONS", "TRANSACTIONS_REMOVED").resync, "REMOVED resyncs");
  const itemErr = mapWebhookToAction("ITEM", "ERROR");
  assert(!itemErr.resync && itemErr.recordError && itemErr.targetItem, "ITEM ERROR → record, no resync");
  const repaired = mapWebhookToAction("ITEM", "LOGIN_REPAIRED");
  assert(repaired.resync && !repaired.recordError, "LOGIN_REPAIRED → resync, clear error");
  const unknown = mapWebhookToAction("HOLDINGS", "DEFAULT_UPDATE");
  assert(!unknown.resync && !unknown.targetItem && !unknown.recordError, "unknown type → acknowledge only");
  const unknownTxCode = mapWebhookToAction("TRANSACTIONS", "SOMETHING_NEW");
  assert(!unknownTxCode.resync && unknownTxCode.targetItem, "unknown TRANSACTIONS code → ack, no resync");

  // preCheckPlaidJwt (end-to-end pure gate) --------------------------------
  const jwt = `${goodHdr}.${b64url(JSON.stringify({ iat: now - 5, request_body_sha256: "deadbeef" }))}.sigsig`;
  const pre = preCheckPlaidJwt(jwt, now);
  assert(pre.ok && pre.kid === "k-1" && pre.requestBodySha256 === "deadbeef", "precheck passes a fresh well-formed JWT");
  const preStale = preCheckPlaidJwt(`${goodHdr}.${b64url(JSON.stringify({ iat: now - 999, request_body_sha256: "x" }))}.s`, now);
  assert(!preStale.ok, "precheck rejects a stale JWT");
  assert(!preCheckPlaidJwt("a.b", now).ok, "precheck rejects malformed");

  console.log("plaid-webhook-core: all self-tests passed");
}
