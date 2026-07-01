/**
 * webauthn-core.ts — pure, framework-free helpers for the passkey (Face ID /
 * Touch ID) sign-in flow. No React / server-only imports so it is unit-testable
 * with tsx. The actual ceremony (options + verify) lives in the API routes and
 * uses @simplewebauthn/server; this module holds the plumbing they share.
 *
 * GROUNDING (verified against @simplewebauthn/server v13 docs + web.dev RP-ID
 * guidance):
 *   - rpID is the effective domain: a bare hostname, NO scheme and NO port.
 *   - expectedOrigin is the FULL origin including scheme (and port in dev).
 *   - transports are stored as a CSV of the AuthenticatorTransportFuture strings.
 *   - challenges are short-lived (we use 5 minutes) and single-use.
 */

/** Derive the WebAuthn Relying Party ID (effective domain) from a request URL/origin. */
export function rpIdFromOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    return u.hostname; // hostname excludes port and scheme — exactly what rpID needs
  } catch {
    // Fall back to stripping scheme + port manually.
    return origin
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/:\d+$/, "");
  }
}

/** Normalize an origin string to scheme://host[:port] with no trailing slash/path. */
export function normalizeOrigin(origin: string): string {
  try {
    const u = new URL(origin);
    return u.port
      ? `${u.protocol}//${u.hostname}:${u.port}`
      : `${u.protocol}//${u.hostname}`;
  } catch {
    return origin.replace(/\/+$/, "");
  }
}

const VALID_TRANSPORTS = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
] as const;
export type WebAuthnTransport = (typeof VALID_TRANSPORTS)[number];

/** Encode a transports array to a CSV string for DB storage. */
export function encodeTransports(transports: readonly string[] | null | undefined): string | null {
  if (!transports || transports.length === 0) return null;
  const clean = transports
    .map((t) => String(t).trim().toLowerCase())
    .filter((t): t is WebAuthnTransport => (VALID_TRANSPORTS as readonly string[]).includes(t));
  return clean.length ? Array.from(new Set(clean)).join(",") : null;
}

/** Decode the stored CSV back into a transports array. */
export function decodeTransports(csv: string | null | undefined): WebAuthnTransport[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t): t is WebAuthnTransport => (VALID_TRANSPORTS as readonly string[]).includes(t));
}

/** True if an ISO expiry timestamp is still in the future (challenge still valid). */
export function isChallengeValid(expiresAtIso: string, nowMs = Date.now()): boolean {
  const t = Date.parse(expiresAtIso);
  if (Number.isNaN(t)) return false;
  return t > nowMs;
}

/** A friendly default label for a newly-registered passkey based on the UA. */
export function defaultPasskeyLabel(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? "").toLowerCase();
  if (/iphone/.test(ua)) return "iPhone (Face ID / Touch ID)";
  if (/ipad/.test(ua)) return "iPad (Face ID / Touch ID)";
  if (/macintosh|mac os/.test(ua)) return "Mac (Touch ID)";
  if (/android/.test(ua)) return "Android device";
  if (/windows/.test(ua)) return "Windows Hello";
  return "This device";
}

/** WebAuthn algorithms we accept. -7 = ES256, -257 = RS256. We exclude -8
 *  (Ed25519) per SimpleWebAuthn guidance to avoid Node/Firefox verify issues. */
export const SUPPORTED_ALGORITHM_IDS = [-7, -257];

/** Recommended authenticatorSelection for platform biometrics (Face ID/Touch ID). */
export const PLATFORM_AUTHENTICATOR_SELECTION = {
  residentKey: "preferred",
  userVerification: "preferred",
  authenticatorAttachment: "platform",
} as const;

// ---------------------------------------------------------------------------
// Self-tests (pure; run via tsx)
// ---------------------------------------------------------------------------
export function __runWebauthnCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error("FAIL:", msg);
    }
  };

  ok(rpIdFromOrigin("https://greenwaymarijuana.com") === "greenwaymarijuana.com", "rpID from https origin");
  ok(rpIdFromOrigin("https://app.greenway.com:3000") === "app.greenway.com", "rpID strips port");
  ok(rpIdFromOrigin("http://localhost:3000") === "localhost", "rpID localhost dev");
  ok(rpIdFromOrigin("not a url") === "not a url", "rpID fallback for junk");

  ok(normalizeOrigin("https://x.com/") === "https://x.com", "origin strips trailing slash");
  ok(normalizeOrigin("http://localhost:3000/admin") === "http://localhost:3000", "origin keeps dev port, drops path");

  ok(encodeTransports(["internal", "hybrid"]) === "internal,hybrid", "encode transports");
  ok(encodeTransports(["INTERNAL", "internal", "bogus"]) === "internal", "encode dedupes + filters + lowercases");
  ok(encodeTransports([]) === null, "encode empty -> null");
  ok(encodeTransports(null) === null, "encode null -> null");

  ok(decodeTransports("internal,usb").length === 2, "decode two");
  ok(decodeTransports("internal,bogus")[0] === "internal", "decode filters junk");
  ok(decodeTransports(null).length === 0, "decode null -> empty");

  ok(isChallengeValid(new Date(Date.now() + 60000).toISOString()) === true, "future challenge valid");
  ok(isChallengeValid(new Date(Date.now() - 60000).toISOString()) === false, "past challenge invalid");
  ok(isChallengeValid("garbage") === false, "unparseable expiry invalid");

  ok(defaultPasskeyLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)").includes("iPhone"), "iPhone label");
  ok(defaultPasskeyLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X)").includes("Mac"), "Mac label");
  ok(defaultPasskeyLabel(null) === "This device", "null UA fallback");

  ok(SUPPORTED_ALGORITHM_IDS.includes(-7) && !SUPPORTED_ALGORITHM_IDS.includes(-8), "algs include ES256, exclude Ed25519");
  ok(PLATFORM_AUTHENTICATOR_SELECTION.authenticatorAttachment === "platform", "platform attachment");

  return { passed, failed };
}
