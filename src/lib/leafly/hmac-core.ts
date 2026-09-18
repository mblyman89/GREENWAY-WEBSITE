/**
 * Leafly webhook HMAC verification — PURE core (Slice L-5)
 * =========================================================================
 *
 * Leafly authenticates the webhooks it sends us with a signature header. This
 * module decides whether a given (rawBody, header, key) triple is authentic.
 * It is the only thing standing between "Leafly sent us this order" and
 * "somebody on the internet sent us this order".
 *
 * GROUND TRUTH — verbatim from Leafly's live Order API specification, vendored
 * at docs/leafly-specs/order-api-v1.openapi.json, key
 * `.components.securitySchemes.WebhookHMACAuthentication`:
 *
 *   type: apiKey
 *   in:   header
 *   name: X-Leafly-Signature
 *   description: "Webhooks outbound from Leafly will include an
 *     `X-Leafly-Signature` header representing an `HMAC-SHA-256` digest of the
 *     request body using an HMAC key issued to you alongside your client
 *     credentials for this purpose. Authenticate webhooks received from Leafly
 *     by independently computing the HMAC signature from the request body and
 *     your HMAC key, then comparing the result with the value present in the
 *     header."
 *
 * That paragraph fixes four things and leaves one open. The four fixed:
 *   1. Header name .................. `X-Leafly-Signature`
 *   2. Algorithm .................... HMAC-SHA-256
 *   3. Signed material .............. the request BODY (not a timestamp, not a
 *                                     method+path+body concatenation)
 *   4. Comparison ................... compute independently, then compare
 *
 * THE ONE OPEN QUESTION — DIGEST ENCODING (risk 8 in the readiness report).
 * Leafly says "digest" but never says whether the header carries that digest as
 * lowercase hex or as base64. Both are 100% standard for HMAC-SHA-256. Guessing
 * would be a coin flip, and the wrong guess rejects EVERY REAL ORDER while
 * looking exactly like a correctly-working fail-closed security control — the
 * worst possible failure mode, because it is silent and self-justifying.
 *
 * So this module does NOT guess. It computes BOTH encodings and accepts a match
 * against either, then REPORTS which one matched (`matchedEncoding`). That is
 * not a security compromise, and the reason is worth stating precisely:
 *
 *   - Accepting either encoding does not widen the attack surface. An attacker
 *     without the key cannot produce a valid digest in EITHER encoding; the two
 *     encodings are just two renderings of the same 256 bits. The probability of
 *     a blind forgery is 2^-256 per encoding, so allowing two candidates makes
 *     it 2 * 2^-256. That is not a meaningful change.
 *   - It converts an unknown that would otherwise be discovered as a production
 *     outage into a logged observation on the first real delivery.
 *
 * Once a real Leafly delivery has verified, `matchedEncoding` tells us which one
 * Leafly actually uses, and the open question can be closed with evidence rather
 * than by asking. See LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED below.
 *
 * WHY THE RAW BODY, NOT THE PARSED OBJECT.
 * The digest covers the exact bytes Leafly sent. `JSON.parse` followed by
 * `JSON.stringify` is NOT byte-preserving: key order, whitespace, unicode
 * escaping and number formatting can all change. Re-serializing before verifying
 * would produce sporadic, unreproducible signature failures that look like an
 * attack. Every function here takes the raw string; nothing in this file parses
 * JSON, and that is deliberate.
 *
 * WHY TIMING-SAFE COMPARISON.
 * `a === b` on strings short-circuits at the first differing byte, so the time
 * it takes leaks how many leading bytes were correct. That is enough to forge a
 * signature byte-by-byte given enough attempts. `timingSafeEqual` always reads
 * every byte. This module implements the comparison itself rather than importing
 * node:crypto's, because it must stay PURE and runnable in any environment (house
 * rule 5); the caller injects the digest function.
 *
 * PURITY (house rule 5): no imports, no I/O, no Date.now(), no crypto. The HMAC
 * computation itself is injected by the caller as a `HmacDigester`. That keeps
 * this file exhaustively testable — including the failure paths that are
 * impossible to trigger with a real crypto implementation, such as a digester
 * that throws or returns an empty string.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The signature header name, verbatim from the spec.
 *
 * Compared case-INSENSITIVELY by `findSignatureHeader` below, because HTTP
 * header names are case-insensitive per RFC 9110 §5.1 and different proxies
 * normalise them differently. Node lowercases them; the spec writes them in
 * title case. Matching the spec's exact casing would be a latent bug.
 */
export const LEAFLY_SIGNATURE_HEADER = "X-Leafly-Signature";

/** Lowercased form, which is what Node/Next actually hand us. */
export const LEAFLY_SIGNATURE_HEADER_LOWER = "x-leafly-signature";

/** The digest algorithm, verbatim from the spec: `HMAC-SHA-256`. */
export const LEAFLY_HMAC_ALGORITHM = "sha256";

/**
 * The two candidate encodings, in the order we report them.
 *
 * `hex` first only because it is the more common convention in webhook
 * signatures; the order carries no security meaning and both are always tried.
 */
export const LEAFLY_HMAC_ENCODINGS = ["hex", "base64"] as const;
export type LeaflyHmacEncoding = (typeof LEAFLY_HMAC_ENCODINGS)[number];

/**
 * TRUE until a real Leafly delivery proves which encoding they use.
 *
 * This is a deliberate, citable admission of an unknown rather than a silent
 * assumption. A compliance test asserts that the vendored spec genuinely does
 * NOT state the encoding, so this flag cannot sit here stale after Leafly
 * documents it — the test fails the moment the spec gains the word "hex" or
 * "base64" near the signature description.
 */
export const LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED = true;

/** Byte length of a SHA-256 digest. */
export const SHA256_DIGEST_BYTES = 32;

/** Expected length of a SHA-256 digest rendered as lowercase hex. */
export const SHA256_HEX_LENGTH = 64;

// ---------------------------------------------------------------------------
// Failure reasons
// ---------------------------------------------------------------------------

/**
 * Why a verification failed.
 *
 * These are for OUR logs only and must never be returned to the caller of a
 * webhook route: telling an attacker "your signature was the right length but
 * the wrong value" is free information. The route returns a bare 401.
 */
export const LEAFLY_HMAC_FAILURE_REASONS = [
  "missing_header",
  "empty_header",
  "missing_key",
  "empty_body",
  "malformed_header",
  "digest_unavailable",
  "mismatch",
] as const;
export type LeaflyHmacFailureReason = (typeof LEAFLY_HMAC_FAILURE_REASONS)[number];

export type LeaflyHmacVerdict = {
  /** Authentic — the digest matched in at least one encoding. */
  ok: boolean;
  /** Which encoding matched. Null whenever `ok` is false. */
  matchedEncoding: LeaflyHmacEncoding | null;
  /** Machine-readable failure reason. Null when `ok` is true. */
  reason: LeaflyHmacFailureReason | null;
  /** Operator-facing explanation. Server logs only — never sent to the caller. */
  detail: string;
};

/**
 * A function that computes an HMAC-SHA-256 digest of `body` under `key` and
 * renders it in `encoding`.
 *
 * Injected so this module stays pure. The server passes a `node:crypto`-backed
 * implementation; tests pass a fake. It is allowed to throw — a real one will if
 * the key is unusable — and `verifyLeaflySignature` treats a throw as a failure
 * rather than letting it escape, because an exception inside a webhook route
 * would produce a 500, and Leafly requires 200/201 on anything it considers a
 * successful delivery.
 */
export type HmacDigester = (
  body: string,
  key: string,
  encoding: LeaflyHmacEncoding,
) => string;

// ---------------------------------------------------------------------------
// Header extraction
// ---------------------------------------------------------------------------

/**
 * Pull the signature out of a header bag, case-insensitively.
 *
 * Accepts the shapes real callers have: a plain object, or anything with a
 * `get()` method (the web `Headers` class). Returns null when absent.
 */
export function findSignatureHeader(
  headers: Record<string, string | string[] | undefined> | { get(name: string): string | null },
): string | null {
  if (headers && typeof (headers as { get?: unknown }).get === "function") {
    const viaGet = (headers as { get(name: string): string | null }).get(
      LEAFLY_SIGNATURE_HEADER_LOWER,
    );
    if (typeof viaGet === "string") return viaGet;
    const viaGetExact = (headers as { get(name: string): string | null }).get(
      LEAFLY_SIGNATURE_HEADER,
    );
    return typeof viaGetExact === "string" ? viaGetExact : null;
  }

  const bag = headers as Record<string, string | string[] | undefined>;
  for (const name of Object.keys(bag ?? {})) {
    if (name.toLowerCase() !== LEAFLY_SIGNATURE_HEADER_LOWER) continue;
    const value = bag[name];
    // A repeated header arrives as an array. Two different signatures for one
    // body is not something Leafly does, and picking one would be a guess, so
    // we take the first and let the digest comparison decide. If it is wrong,
    // the request is refused — which is the correct outcome for an ambiguous
    // signature.
    if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
    return typeof value === "string" ? value : null;
  }
  return null;
}

/**
 * Strip a `sha256=` style prefix if present.
 *
 * Leafly's spec shows no prefix, so we expect a bare digest. But several major
 * webhook providers (GitHub, Stripe) prefix theirs, and if Leafly ever does the
 * signature would be unparseable and every order would be refused. Tolerating
 * the prefix costs one line and removes a whole class of outage. The prefix is
 * NOT trusted to name the algorithm — we always use SHA-256, because that is
 * what the spec fixes.
 */
export function stripSignaturePrefix(value: string): string {
  const trimmed = value.trim();
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return trimmed;
  const label = trimmed.slice(0, eq).toLowerCase();
  // Only strip labels that look like an algorithm name. Base64 digests can
  // legitimately contain '=' as PADDING, and stripping at the first '=' there
  // would destroy a valid signature — so the label must be alphanumeric and
  // short, which base64 payload bytes before the padding never are.
  if (/^[a-z0-9-]{1,12}$/.test(label) && label !== "") {
    return trimmed.slice(eq + 1).trim();
  }
  return trimmed;
}

/**
 * Does this string even look like a SHA-256 digest in one of the two encodings?
 *
 * A cheap structural screen so an obviously-wrong header is reported as
 * `malformed_header` rather than `mismatch`. That distinction matters
 * operationally: `malformed_header` means "something is pointed at this URL that
 * is not Leafly", while `mismatch` means "Leafly-shaped traffic with the wrong
 * key", i.e. probably a rotated key. Different problems, different fixes.
 *
 * This is NOT a security control — a wrong-but-well-formed digest still has to
 * fail the real comparison.
 */
export function looksLikeSha256Digest(value: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
  // base64 of 32 bytes is 44 chars including one '=' of padding.
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) return true;
  // Tolerate unpadded base64url/base64 (43 chars, no padding).
  if (/^[A-Za-z0-9+/_-]{43}$/.test(value)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Timing-safe comparison
// ---------------------------------------------------------------------------

/**
 * Constant-time string comparison.
 *
 * Always walks the full length of the longer string, XOR-accumulating
 * differences, so the running time does not depend on WHERE the strings diverge.
 *
 * Length is folded into the result instead of short-circuiting on it. A length
 * check that returns early does leak the expected length — which for a fixed
 * 64-char hex digest is not a secret, but writing it the safe way here means the
 * function stays safe if it is ever reused for something where length IS secret.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    // charCodeAt past the end returns NaN; `| 0` makes that a stable 0 so the
    // loop stays branch-free and total.
    const ca = a.charCodeAt(i) | 0;
    const cb = b.charCodeAt(i) | 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a Leafly webhook signature.
 *
 * FAILS CLOSED in every ambiguous case: no header, no key, unusable digester,
 * or anything that throws, all return `ok: false`. There is no configuration and
 * no environment in which this function returns `ok: true` without an actual
 * digest match.
 *
 * `rawBody` MUST be the exact bytes received. See the file header.
 */
export function verifyLeaflySignature(input: {
  rawBody: string;
  headerValue: string | null | undefined;
  hmacKey: string | null | undefined;
  digest: HmacDigester;
}): LeaflyHmacVerdict {
  const { rawBody, headerValue, hmacKey, digest } = input;

  if (headerValue === null || headerValue === undefined) {
    return {
      ok: false,
      matchedEncoding: null,
      reason: "missing_header",
      detail: `No ${LEAFLY_SIGNATURE_HEADER} header was present. Genuine Leafly webhooks always carry one, so this request did not come from Leafly (or something is stripping headers in front of the app).`,
    };
  }

  const presented = stripSignaturePrefix(String(headerValue));
  if (presented === "") {
    return {
      ok: false,
      matchedEncoding: null,
      reason: "empty_header",
      detail: `The ${LEAFLY_SIGNATURE_HEADER} header was present but empty.`,
    };
  }

  if (!hmacKey) {
    // Refused, NOT accepted. An unconfigured key must never mean "skip
    // verification" — that would turn a missing credential into an open door.
    return {
      ok: false,
      matchedEncoding: null,
      reason: "missing_key",
      detail:
        "No Leafly HMAC key is configured, so the signature cannot be checked. Refusing the request: an unverifiable webhook is never accepted. Enter the HMAC key from Leafly in Integrations → Credentials.",
    };
  }

  if (rawBody === "") {
    // A signature over an empty body is cryptographically verifiable, but Leafly
    // declares `requestBody.required: true` on all six webhooks, so an empty body
    // is not a delivery Leafly makes. Refuse it as malformed rather than spend a
    // digest on it.
    return {
      ok: false,
      matchedEncoding: null,
      reason: "empty_body",
      detail:
        "The request body was empty. All six Leafly webhooks declare a required request body, so this is not a Leafly delivery.",
    };
  }

  if (!looksLikeSha256Digest(presented)) {
    return {
      ok: false,
      matchedEncoding: null,
      reason: "malformed_header",
      detail: `The ${LEAFLY_SIGNATURE_HEADER} header is not shaped like an HMAC-SHA-256 digest (expected ${SHA256_HEX_LENGTH} hex characters or 44 base64 characters). Something other than Leafly is posting to this URL.`,
    };
  }

  // Compute both candidate encodings. See the file header for why accepting
  // either is not a weakening.
  let sawUsableDigest = false;
  for (const encoding of LEAFLY_HMAC_ENCODINGS) {
    let computed: string;
    try {
      computed = digest(rawBody, hmacKey, encoding);
    } catch {
      // A throwing digester is an infrastructure fault, not an auth decision.
      // Keep going: the other encoding may still work, and we must not let the
      // exception escape into the route.
      continue;
    }
    if (typeof computed !== "string" || computed === "") continue;
    sawUsableDigest = true;

    // Compare case-insensitively for HEX only. Hex is the same digest whether
    // rendered upper or lower case, and providers differ. Base64 is
    // case-SENSITIVE — 'A' and 'a' are different six-bit groups — so folding
    // case there would accept digests that are genuinely wrong.
    const matched =
      encoding === "hex"
        ? timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase())
        : timingSafeStringEqual(computed, presented);

    if (matched) {
      return {
        ok: true,
        matchedEncoding: encoding,
        reason: null,
        detail: `Signature verified (HMAC-SHA-256, ${encoding}).`,
      };
    }
  }

  if (!sawUsableDigest) {
    return {
      ok: false,
      matchedEncoding: null,
      reason: "digest_unavailable",
      detail:
        "Could not compute an HMAC digest at all, so authenticity is unknown. Refusing, because an unverifiable webhook is never accepted. This is an app-side fault, not a bad request.",
    };
  }

  return {
    ok: false,
    matchedEncoding: null,
    reason: "mismatch",
    detail:
      "The signature did not match in either hex or base64. The most likely cause is that the HMAC key on file is not the one Leafly is signing with — check whether it was rotated.",
  };
}

/**
 * Should this failure be surfaced as "our fault" rather than "bad request"?
 *
 * Used by the routes to choose 503 over 401. The distinction is worth making:
 * a 401 tells Leafly "your signature is wrong", which for a missing local key
 * or a broken digester is a lie that sends them looking in the wrong place.
 */
export function isLeaflyHmacLocalFault(reason: LeaflyHmacFailureReason | null): boolean {
  return reason === "missing_key" || reason === "digest_unavailable";
}

// ---------------------------------------------------------------------------
// Self-tests (house rule 5)
// ---------------------------------------------------------------------------

/**
 * A deterministic fake digester. NOT cryptography — it exists so the control
 * flow can be tested without pulling node:crypto into a pure module.
 *
 * It must be a pure function of (body, key, encoding) and must produce
 * plausibly-shaped output, because `looksLikeSha256Digest` screens the header
 * before any comparison happens.
 */
function fakeDigest(body: string, key: string, encoding: LeaflyHmacEncoding): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const material = `${key}\u0000${body}`;
  for (let i = 0; i < material.length; i += 1) {
    h1 = (h1 ^ material.charCodeAt(i)) >>> 0;
    h1 = (h1 * 0x01000193) >>> 0;
    h2 = (h2 + material.charCodeAt(i) * (i + 1)) >>> 0;
  }
  const hexSeed = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).repeat(4);
  const hex = hexSeed.slice(0, SHA256_HEX_LENGTH);
  if (encoding === "hex") return hex;
  // Render the same 32 bytes as something base64-shaped (43 chars + '=').
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < 43; i += 1) {
    const nibble = parseInt(hex[i % hex.length] ?? "0", 16);
    out += alphabet[(nibble * 4 + i) % 64];
  }
  return `${out}=`;
}

export function __runLeaflyHmacTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[leafly-hmac-core] FAIL: ${label}`);
    }
  };

  // -- Vocabulary is the spec's, exactly -----------------------------------
  ok(LEAFLY_SIGNATURE_HEADER === "X-Leafly-Signature", "header name matches the spec verbatim");
  ok(
    LEAFLY_SIGNATURE_HEADER_LOWER === LEAFLY_SIGNATURE_HEADER.toLowerCase(),
    "lowercase header constant is consistent with the canonical one",
  );
  ok(LEAFLY_HMAC_ALGORITHM === "sha256", "algorithm is SHA-256 per the spec");
  ok(LEAFLY_HMAC_ENCODINGS.length === 2, "exactly two candidate encodings");
  ok(
    LEAFLY_HMAC_ENCODINGS.includes("hex") && LEAFLY_HMAC_ENCODINGS.includes("base64"),
    "the two candidates are hex and base64",
  );
  ok(SHA256_DIGEST_BYTES === 32, "sha256 is 32 bytes");
  ok(SHA256_HEX_LENGTH === SHA256_DIGEST_BYTES * 2, "hex length is twice the byte length");

  // -- Header extraction ---------------------------------------------------
  ok(
    findSignatureHeader({ "X-Leafly-Signature": "abc" }) === "abc",
    "finds the header in the spec's casing",
  );
  ok(
    findSignatureHeader({ "x-leafly-signature": "abc" }) === "abc",
    "finds the header lowercased (the casing Node actually gives us)",
  );
  ok(
    findSignatureHeader({ "X-LEAFLY-SIGNATURE": "abc" }) === "abc",
    "finds the header uppercased — HTTP header names are case-insensitive",
  );
  ok(findSignatureHeader({ "content-type": "application/json" }) === null, "absent header is null");
  ok(findSignatureHeader({}) === null, "empty bag is null");
  ok(
    findSignatureHeader({ "x-leafly-signature": ["first", "second"] }) === "first",
    "a repeated header takes the first value rather than concatenating",
  );
  ok(
    findSignatureHeader({ "x-leafly-signature": [] }) === null,
    "an empty repeated header is null, not undefined",
  );
  ok(
    findSignatureHeader(new Headers({ "x-leafly-signature": "viaheaders" })) === "viaheaders",
    "works with a real web Headers object",
  );
  ok(
    findSignatureHeader({ get: () => null } as { get(name: string): string | null }) === null,
    "a Headers-like object returning null yields null",
  );

  // -- Prefix stripping ----------------------------------------------------
  const hex64 = "a".repeat(64);
  ok(stripSignaturePrefix(hex64) === hex64, "a bare digest is returned unchanged");
  ok(stripSignaturePrefix(`sha256=${hex64}`) === hex64, "a sha256= prefix is stripped");
  ok(stripSignaturePrefix(`  sha256=${hex64}  `) === hex64, "surrounding whitespace is trimmed");
  // THE IMPORTANT ONE: base64 padding must survive.
  const b64 = `${"A".repeat(43)}=`;
  ok(
    stripSignaturePrefix(b64) === b64,
    "base64 padding is NOT treated as a prefix delimiter (would destroy a valid signature)",
  );
  ok(
    stripSignaturePrefix(`${"A".repeat(60)}=${"B".repeat(4)}`) ===
      `${"A".repeat(60)}=${"B".repeat(4)}`,
    "a long non-algorithm label before '=' is left alone",
  );

  // -- Shape screening -----------------------------------------------------
  ok(looksLikeSha256Digest(hex64), "64 lowercase hex chars look like a digest");
  ok(looksLikeSha256Digest("A".repeat(64)), "64 uppercase hex chars look like a digest");
  ok(looksLikeSha256Digest(b64), "43 base64 chars + padding look like a digest");
  ok(looksLikeSha256Digest("A".repeat(43)), "43 unpadded base64 chars look like a digest");
  ok(!looksLikeSha256Digest("deadbeef"), "a short hex string does not");
  ok(!looksLikeSha256Digest(""), "an empty string does not");
  ok(!looksLikeSha256Digest("z".repeat(64)), "64 non-hex letters do not");
  ok(!looksLikeSha256Digest("a".repeat(63)), "63 hex chars do not (off-by-one below)");
  ok(!looksLikeSha256Digest("a".repeat(65)), "65 hex chars do not (off-by-one above)");

  // -- Timing-safe comparison ----------------------------------------------
  ok(timingSafeStringEqual("", ""), "two empty strings are equal");
  ok(timingSafeStringEqual("abc", "abc"), "identical strings are equal");
  ok(!timingSafeStringEqual("abc", "abd"), "a trailing difference is detected");
  ok(!timingSafeStringEqual("abc", "bbc"), "a leading difference is detected");
  ok(!timingSafeStringEqual("abc", "abcd"), "different lengths are unequal");
  ok(!timingSafeStringEqual("abcd", "abc"), "different lengths are unequal, reversed");
  ok(
    !timingSafeStringEqual("abc", ""),
    "comparing against empty is unequal, not vacuously true",
  );
  ok(
    timingSafeStringEqual("a\u0000b", "a\u0000b"),
    "embedded NUL bytes compare correctly (no C-string truncation)",
  );

  // ADDED after the L-5 mutation sweep: mutation M09 replaced
  // `let diff = a.length ^ b.length` with `let diff = 0`, removing the length
  // fold, and SURVIVED the whole suite. The six length assertions above did not
  // catch it because `charCodeAt` past the end returns NaN, which `| 0` turns
  // into 0 -- so a genuinely shorter string still differs from a longer one
  // whose extra characters are non-zero, and every case above happened to use
  // ordinary text. The one input that distinguishes them is a string padded
  // with actual NUL characters, whose char code IS 0: without the length fold
  // "ab" and "ab\0" compare EQUAL. A base64 digest is attacker-supplied text in
  // a header, so a comparison that ignores trailing NULs is a real forgery
  // surface, not a theoretical one. Verified both directions.
  ok(
    !timingSafeStringEqual("ab", "ab\u0000"),
    "a NUL-padded string is NOT equal to the shorter one (the length fold is live)",
  );
  ok(
    !timingSafeStringEqual("ab\u0000", "ab"),
    "and the same in reverse, so the fold is not one-sided",
  );
  ok(
    !timingSafeStringEqual("ab", "ab\u0000\u0000\u0000"),
    "several NUL characters of padding are still not equal",
  );

  // ADDED after the L-5 mutation sweep: mutations M07 and M08 both SURVIVED.
  // M07 prepended `if (a !== b) return false;` and M08 restored an early
  // `if (a.length !== b.length) return false;`. Neither changes the RESULT for
  // any input -- they are both correct as predicates -- so no behavioural
  // assertion can ever catch them. What they destroy is the only property this
  // function exists for: that its running time does not depend on WHERE two
  // digests first differ. A caller that leaks that position leaks the expected
  // signature one character at a time.
  //
  // That property is therefore asserted STRUCTURALLY, against this function's
  // own source text. This is the same technique the L-5 route tests use to
  // prove a handler reads `request.text()` rather than `request.json()`: when a
  // requirement is about HOW something is computed and two implementations are
  // observationally identical, the source is the only available evidence.
  // Timing itself is deliberately NOT measured -- a wall-clock threshold in a
  // shared sandbox is exactly the kind of flaky test that gets deleted later.
  //
  // WHITESPACE IS STRIPPED FIRST, and that detail was learned the hard way. The
  // first version of this block matched the literal strings "diff |=" and
  // "a.length ^ b.length" and FAILED against correct code, because the
  // TypeScript loader minifies on the way in: the real toString() reads
  //   function timingSafeStringEqual(a,b){const len=Math.max(...);let
  //   diff=a.length^b.length;for(...){...diff|=ca^cb}return diff===0}
  // with every space removed. Rather than assume a source layout, the actual
  // output was printed and read, and the patterns below are written against
  // what the runtime really produces. A test that fails on correct code is
  // worse than no test: it gets weakened until it passes.
  //
  // COMMENTS MUST BE STRIPPED TOO, and that was learned the second hard way.
  // After fixing the whitespace problem the block passed under `tsx` and then
  // FAILED under vitest, because the two loaders transpile differently: tsx
  // strips comments, vitest keeps them. This function's own comment contains
  // the word "returns" ("charCodeAt past the end returns NaN"), so counting
  // /return/ over the raw text found 2 in vitest and 1 in tsx -- the same
  // source, two answers. Both loaders' real output was printed and read before
  // settling on the normalisation below. The lesson generalises: a structural
  // assertion must normalise away everything the toolchain is free to change,
  // and the only way to know what that is, is to look.
  {
    const src = timingSafeStringEqual.toString();
    const bare = src
      // Block comments first, then line comments, then all whitespace.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\s+/g, "");

    // Everything before the accumulator loop. Any `return` in that window is an
    // early exit -- which is precisely what mutants M07 and M08 introduce.
    const loopAt = bare.indexOf("for(");
    ok(loopAt > 0, "the comparison loop is present at all (guards the slice below)");
    const beforeLoop = bare.slice(0, loopAt);
    ok(
      !beforeLoop.includes("return"),
      "timingSafeStringEqual has NO early return before its loop (a short-circuit " +
        "would make its runtime reveal where two digests diverge)",
    );
    ok(
      bare.includes("diff=a.length^b.length"),
      "the length difference is FOLDED into the accumulator rather than branched on",
    );
    ok(
      (bare.match(/return/g) ?? []).length === 1,
      "there is exactly one return, at the end: the comparison is total and branch-free",
    );
    ok(
      bare.includes("diff|="),
      "the accumulator ORs each character difference in, so no later match can clear an earlier one",
    );
    // The mutants' exact signatures, pinned by name so a future reader knows
    // which specific regressions this block was written to stop.
    ok(
      !bare.includes("if(a!==b)"),
      "M07's plain `a !== b` short-circuit is absent",
    );
    ok(
      !bare.includes("if(a.length!==b.length)"),
      "M08's length short-circuit is absent",
    );
  }

  // -- Verification: the happy paths ---------------------------------------
  const body = '{"eventType":"order_submit","orderId":"abc"}';
  const key = "test-hmac-key";

  const hexSig = fakeDigest(body, key, "hex");
  const good = verifyLeaflySignature({
    rawBody: body,
    headerValue: hexSig,
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(good.ok, "a correct hex signature verifies");
  ok(good.matchedEncoding === "hex", "and reports hex as the matched encoding");
  ok(good.reason === null, "a success carries no failure reason");

  const b64Sig = fakeDigest(body, key, "base64");
  const goodB64 = verifyLeaflySignature({
    rawBody: body,
    headerValue: b64Sig,
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(goodB64.ok, "a correct base64 signature verifies");
  ok(goodB64.matchedEncoding === "base64", "and reports base64 as the matched encoding");

  ok(
    verifyLeaflySignature({
      rawBody: body,
      headerValue: hexSig.toUpperCase(),
      hmacKey: key,
      digest: fakeDigest,
    }).ok,
    "an UPPERCASE hex signature verifies (same digest, different rendering)",
  );

  ok(
    verifyLeaflySignature({
      rawBody: body,
      headerValue: `sha256=${hexSig}`,
      hmacKey: key,
      digest: fakeDigest,
    }).ok,
    "a prefixed signature verifies",
  );

  // -- Verification: every failure path ------------------------------------
  const missing = verifyLeaflySignature({
    rawBody: body,
    headerValue: null,
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(!missing.ok && missing.reason === "missing_header", "a missing header is refused");
  ok(missing.matchedEncoding === null, "a refusal reports no matched encoding");

  ok(
    verifyLeaflySignature({
      rawBody: body,
      headerValue: undefined,
      hmacKey: key,
      digest: fakeDigest,
    }).reason === "missing_header",
    "undefined is treated the same as a missing header",
  );

  ok(
    verifyLeaflySignature({ rawBody: body, headerValue: "   ", hmacKey: key, digest: fakeDigest })
      .reason === "empty_header",
    "a whitespace-only header is empty, not malformed",
  );

  const noKey = verifyLeaflySignature({
    rawBody: body,
    headerValue: hexSig,
    hmacKey: "",
    digest: fakeDigest,
  });
  ok(!noKey.ok, "a missing key REFUSES — it never skips verification");
  ok(noKey.reason === "missing_key", "and says so");
  ok(
    verifyLeaflySignature({
      rawBody: body,
      headerValue: hexSig,
      hmacKey: null,
      digest: fakeDigest,
    }).reason === "missing_key",
    "a null key is refused too",
  );

  ok(
    verifyLeaflySignature({ rawBody: "", headerValue: hexSig, hmacKey: key, digest: fakeDigest })
      .reason === "empty_body",
    "an empty body is refused",
  );

  ok(
    verifyLeaflySignature({
      rawBody: body,
      headerValue: "not-a-digest",
      hmacKey: key,
      digest: fakeDigest,
    }).reason === "malformed_header",
    "a malformed header is distinguished from a mismatch",
  );

  const wrongKey = verifyLeaflySignature({
    rawBody: body,
    headerValue: fakeDigest(body, "a-different-key", "hex"),
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(!wrongKey.ok, "a digest computed under a different key is refused");
  ok(wrongKey.reason === "mismatch", "and is reported as a mismatch (suggesting key rotation)");

  const tampered = verifyLeaflySignature({
    rawBody: `${body} `,
    headerValue: hexSig,
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(!tampered.ok, "a single added byte in the body invalidates the signature");
  ok(tampered.reason === "mismatch", "body tampering reads as a mismatch");

  // A digester that always throws must not let the exception escape.
  const throwing = verifyLeaflySignature({
    rawBody: body,
    headerValue: hexSig,
    hmacKey: key,
    digest: () => {
      throw new Error("crypto unavailable");
    },
  });
  ok(!throwing.ok, "a throwing digester fails closed rather than propagating");
  ok(
    throwing.reason === "digest_unavailable",
    "and is reported as an app-side fault, not a bad request",
  );

  // A digester returning empty strings is equally unusable.
  const empty = verifyLeaflySignature({
    rawBody: body,
    headerValue: hexSig,
    hmacKey: key,
    digest: () => "",
  });
  ok(
    !empty.ok && empty.reason === "digest_unavailable",
    "a digester returning empty strings is unusable, not a mismatch",
  );

  // If only ONE encoding is computable, verification must still succeed on it.
  const hexOnly = verifyLeaflySignature({
    rawBody: body,
    headerValue: hexSig,
    hmacKey: key,
    digest: (b, k, enc) => {
      if (enc === "base64") throw new Error("nope");
      return fakeDigest(b, k, enc);
    },
  });
  ok(hexOnly.ok, "hex still verifies when the base64 path is broken");

  const b64Only = verifyLeaflySignature({
    rawBody: body,
    headerValue: b64Sig,
    hmacKey: key,
    digest: (b, k, enc) => {
      if (enc === "hex") throw new Error("nope");
      return fakeDigest(b, k, enc);
    },
  });
  ok(b64Only.ok, "base64 still verifies when the hex path is broken");

  // Base64 must stay case-sensitive.
  const b64Upper = verifyLeaflySignature({
    rawBody: body,
    headerValue: b64Sig.toUpperCase(),
    hmacKey: key,
    digest: (b, k, enc) => (enc === "base64" ? fakeDigest(b, k, enc) : "x".repeat(64)),
  });
  ok(
    !b64Upper.ok || b64Sig === b64Sig.toUpperCase(),
    "case-folding is NOT applied to base64 (different case = different bytes)",
  );

  // -- Local-fault classification ------------------------------------------
  ok(isLeaflyHmacLocalFault("missing_key"), "a missing key is our fault, not Leafly's");
  ok(isLeaflyHmacLocalFault("digest_unavailable"), "an unusable digester is our fault");
  ok(!isLeaflyHmacLocalFault("mismatch"), "a mismatch is not our fault");
  ok(!isLeaflyHmacLocalFault("missing_header"), "a missing header is not our fault");
  ok(!isLeaflyHmacLocalFault(null), "no reason at all is not a local fault");

  // -- The open question is still flagged ----------------------------------
  ok(
    LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED === true,
    "the digest encoding is still recorded as unconfirmed (the spec does not state it)",
  );

  // -- Determinism ---------------------------------------------------------
  const twice = [0, 1].map(
    () =>
      verifyLeaflySignature({
        rawBody: body,
        headerValue: hexSig,
        hmacKey: key,
        digest: fakeDigest,
      }).matchedEncoding,
  );
  ok(twice[0] === twice[1], "verification is deterministic across calls");

  // -- Nothing throws, ever ------------------------------------------------
  const hostile: unknown[] = [null, undefined, "", "x", 0, {}, [], NaN];
  let threw = false;
  for (const h of hostile) {
    try {
      verifyLeaflySignature({
        rawBody: h as string,
        headerValue: h as string,
        hmacKey: h as string,
        digest: fakeDigest,
      });
    } catch {
      threw = true;
    }
    try {
      stripSignaturePrefix(String(h));
      looksLikeSha256Digest(String(h));
      timingSafeStringEqual(String(h), String(h));
    } catch {
      threw = true;
    }
  }
  ok(!threw, "no hostile input makes any exported function throw");

  return { passed, failed };
}
