import "server-only";

/**
 * src/lib/plaid/plaid-webhook-verify.ts — server-only Plaid webhook verifier
 * (Slice P4). Turns the pure gate in plaid-webhook-core.ts into a real, signed
 * verification using Node's built-in crypto (no extra dependency) + Plaid's
 * /webhook_verification_key/get. NEVER throws — every path returns a typed
 * result the route can log and act on.
 *
 * Steps (Plaid's official spec — see plaid-webhook-core.ts header):
 *   1) PURE pre-check: 3 segments, alg ES256, kid, iat fresh (≤5 min), hash present.
 *   2) Fetch the JWK for `kid` via the Plaid SDK (cached in-process by kid).
 *   3) Verify the JWT signature (ES256 / P-256) against the JWK using
 *      crypto.verify with dsaEncoding "ieee-p1363" (JOSE raw R||S form).
 *   4) SHA-256 the RAW body and constant-time-compare to request_body_sha256.
 *
 * Verification uses your existing PLAID_CLIENT_ID / PLAID_SECRET to fetch the
 * key — there is NO separate webhook secret to configure. When Plaid isn't
 * configured we return {ok:false, reason} so the route can fail closed in prod.
 */
import { createHash, createPublicKey, verify as cryptoVerify, type JsonWebKey } from "node:crypto";
import { getPlaidClient } from "./client";
import { isPlaidConfigured } from "./env";
import {
  splitJwt,
  preCheckPlaidJwt,
  constantTimeHexEquals,
  PLAID_WEBHOOK_MAX_AGE_SECONDS,
} from "./plaid-webhook-core";

/** In-process cache of JWKs by kid (keys rarely rotate; a cold start re-fetches). */
const jwkCache = new Map<string, JsonWebKey>();

/** Read the Plaid-Verification header case-insensitively from a Headers-like map. */
export function readPlaidVerificationHeader(headers: Headers): string {
  // Headers.get is already case-insensitive, but Plaid documents the header as
  // case-varying, so we check the lowercase canonical form the platform stores.
  return (headers.get("plaid-verification") ?? "").trim();
}

/** Fetch (and cache) the JWK for a kid. Returns null on any failure. */
async function getVerificationJwk(kid: string): Promise<JsonWebKey | null> {
  const cached = jwkCache.get(kid);
  if (cached) return cached;
  const plaid = getPlaidClient();
  if (!plaid) return null;
  try {
    const resp = await plaid.webhookVerificationKeyGet({ key_id: kid });
    const key = resp.data.key as unknown as JsonWebKey;
    if (!key || typeof key !== "object") return null;
    jwkCache.set(kid, key);
    return key;
  } catch {
    return null;
  }
}

export type PlaidWebhookVerifyResult =
  | { ok: true }
  | { ok: false; reason: string; refuseUnconfigured?: boolean };

/**
 * Verify a Plaid webhook. `rawBody` MUST be the exact bytes/string Plaid sent
 * (do not re-serialize the JSON — the body hash is whitespace-sensitive).
 * Returns {ok:true} only when the signature, freshness, and body hash all pass.
 */
export async function verifyPlaidWebhook(
  rawBody: string,
  headers: Headers,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<PlaidWebhookVerifyResult> {
  if (!isPlaidConfigured) {
    return { ok: false, reason: "Plaid is not configured (cannot fetch the verification key).", refuseUnconfigured: true };
  }

  const jwt = readPlaidVerificationHeader(headers);
  if (jwt === "") return { ok: false, reason: "missing Plaid-Verification header" };

  // 1) PURE pre-check (structure, alg, kid, iat freshness, hash present).
  const pre = preCheckPlaidJwt(jwt, nowSeconds, PLAID_WEBHOOK_MAX_AGE_SECONDS);
  if (!pre.ok) return { ok: false, reason: pre.reason };

  // 2) Fetch the public key for this kid.
  const jwk = await getVerificationJwk(pre.kid);
  if (!jwk) return { ok: false, reason: "could not fetch/parse the Plaid verification key" };

  // 3) Verify the ES256 signature over "header.payload" using the JWK.
  const parts = splitJwt(jwt);
  if (!parts) return { ok: false, reason: "malformed JWT (post-precheck)" };
  let signatureValid = false;
  try {
    const pubKey = createPublicKey({ key: jwk, format: "jwk" });
    const signingInput = Buffer.from(`${parts.header}.${parts.payload}`, "utf8");
    const signature = Buffer.from(parts.signature, "base64url");
    signatureValid = cryptoVerify("SHA256", signingInput, { key: pubKey, dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, reason: "JWT signature did not verify against the Plaid key" };

  // 4) SHA-256 the RAW body and constant-time compare to the claimed hash.
  const bodyHashHex = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (!constantTimeHexEquals(bodyHashHex, pre.requestBodySha256)) {
    return { ok: false, reason: "request body hash did not match the signed hash" };
  }

  return { ok: true };
}

/** Test-only: clear the in-process JWK cache (never used in production paths). */
export function __clearPlaidJwkCacheForTests(): void {
  jwkCache.clear();
}
