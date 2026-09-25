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
 * That paragraph fixes four things and left one open. The four fixed:
 *   1. Header name .................. `X-Leafly-Signature`
 *   2. Algorithm .................... HMAC-SHA-256
 *   3. Signed material .............. the request BODY (not a timestamp, not a
 *                                     method+path+body concatenation)
 *   4. Comparison ................... compute independently, then compare
 *
 * THE ONCE-OPEN QUESTION — DIGEST ENCODING — IS NOW CLOSED (SLICE L-43).
 * The spec says "digest" but never says whether the header carries it as hex or
 * as base64. Until L-43 this module refused to guess and accepted either. Ben
 * (Leafly integrations) then answered it in writing, recorded in
 * docs/leafly-ben-email-integration-round.md, item 1:
 *
 *   > "`X-Leafly-Signature` is **lowercase hex**, HMAC-SHA-256 computed over the
 *   >  **raw request body only**. No timestamp component, no prefix, no
 *   >  versioning scheme."
 *
 *   > "**When a webhook has an empty body, the header is not sent at all.** A
 *   >  missing signature header on an empty body is EXPECTED, not a failure.
 *   >  Any verification code must not treat that case as a rejection."
 *
 * So, since L-43:
 *   - ONLY HEX IS ACCEPTED. A base64 rendering of the correct digest is now
 *     `malformed_header`. Accepting both was never a real weakness (two
 *     renderings of the same 256 bits), but it was an unknown kept open on
 *     purpose, and an unknown that has been answered should stop being
 *     treated as one. Hex is still compared case-INSENSITIVELY: Ben says
 *     "lowercase", and an upper-case rendering is the same 32 bytes, so
 *     refusing it would be a false rejection of a genuine delivery, not a
 *     security gain.
 *   - AN EMPTY BODY WITH NO HEADER IS NOT A REFUSAL. It gets its own outcome,
 *     `empty_unsigned`, which is deliberately neither "verified" nor "refused":
 *     nothing was authenticated, so nothing may be DONE with it, but a non-2xx
 *     answer would count against us as a failed delivery (Ben, item 4). See
 *     `planLeaflyWebhookAdmission` for exactly what the route does with it.
 *   - A body WITH NO HEADER is still refused (`missing_header`). Ben's carve-out
 *     is for the empty body only, and widening it would let anybody on the
 *     internet post an unsigned order.
 *
 * Leafly's webhook egress IPs rotate (Ben, item 3), so there is no network
 * allowlist behind this check. The HMAC is the ONLY authentication, which is
 * why this file is as strict as it is.
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
 * The accepted encoding. Exactly one, since SLICE L-43.
 *
 * Kept as a one-element tuple rather than collapsed to a string so the verify
 * loop, the injected `HmacDigester` signature and the node digester stay
 * shaped the way they were reviewed. What changed is the CONTENT: "base64" is
 * gone, and a self-test plus tests/compliance/leafly-l43-hmac.test.ts fail if
 * it ever comes back.
 */
export const LEAFLY_HMAC_ENCODINGS = ["hex"] as const;
export type LeaflyHmacEncoding = (typeof LEAFLY_HMAC_ENCODINGS)[number];

/**
 * FALSE since SLICE L-43: Leafly has confirmed the encoding in writing.
 *
 * The vendored spec STILL does not state it (tests/compliance/leafly-l43-hmac
 * .test.ts proves that against the file), so the authority is not the spec but
 * Ben's answer, cited below and recorded verbatim in
 * docs/leafly-ben-email-integration-round.md. If Leafly ever publishes a spec
 * that says otherwise, the spec test fails and a human decides.
 */
export const LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED = false;

/** Where the "lowercase hex" answer came from. Shown in logs and docs. */
export const LEAFLY_HMAC_ENCODING_SOURCE =
  "Ben (Leafly integrations), email answer 1: lowercase hex HMAC-SHA-256 of the raw body, no prefix; an empty body is sent with no signature header.";

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

/**
 * The three things a verification can conclude (SLICE L-43).
 *
 *   verified        the digest matched. The ONLY outcome with `ok: true`.
 *   refused         anything else that is wrong. `reason` says what.
 *   empty_unsigned  an EMPTY body arrived with NO signature header. Leafly
 *                   says this is expected. Nothing was authenticated, so
 *                   `ok` is false and nothing may be processed, but it is
 *                   not a refusal either, so `reason` is null and it must
 *                   never be answered with a non-2xx or counted as a failed
 *                   signature.
 */
export const LEAFLY_HMAC_OUTCOMES = ["verified", "refused", "empty_unsigned"] as const;
export type LeaflyHmacOutcome = (typeof LEAFLY_HMAC_OUTCOMES)[number];

export type LeaflyHmacVerdict = {
  /** Which of the three outcomes this is. See LEAFLY_HMAC_OUTCOMES. */
  outcome: LeaflyHmacOutcome;
  /** Authentic — the digest matched. True only when outcome is "verified". */
  ok: boolean;
  /** Which encoding matched (always "hex" since L-43). Null whenever `ok` is false. */
  matchedEncoding: LeaflyHmacEncoding | null;
  /** Machine-readable failure reason. Non-null exactly when outcome is "refused". */
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
 * Ben confirmed there is NO prefix, so a genuine header is a bare digest and
 * this is a no-op for every real delivery. It is kept because it cannot widen
 * what verifies — the digest after the label must still match exactly — while
 * a future `sha256=` (the GitHub/Stripe convention) would otherwise refuse
 * every order at once. The prefix is NOT trusted to name the algorithm: we
 * always use SHA-256, because that is what the spec fixes.
 */
export function stripSignaturePrefix(value: string): string {
  const trimmed = value.trim();
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return trimmed;
  const label = trimmed.slice(0, eq).toLowerCase();
  // Only strip labels that look like an algorithm name: alphanumeric and short.
  // (This guard dates from when base64, whose '=' is padding, was accepted. It
  // is kept because a long run before an '=' is not a label by any convention.)
  if (/^[a-z0-9-]{1,12}$/.test(label) && label !== "") {
    return trimmed.slice(eq + 1).trim();
  }
  return trimmed;
}

/**
 * Does this string look like a hex SHA-256 digest? (Hex only since L-43.)
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
  // Exactly 64 hex characters, either case. Base64 (44 chars with '=' padding,
  // or 43 unpadded) used to pass here too; since L-43 it is malformed, because
  // Leafly has said in writing that it does not send it.
  return /^[0-9a-fA-F]{64}$/.test(value);
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
 * ORDER OF CHECKS (L-43 — the order is load-bearing and mutation-tested):
 *   1. no header + EMPTY body   -> empty_unsigned (expected; Ben, item 1).
 *      Checked FIRST, before the key: an unconfigured key must not turn an
 *      expected empty delivery into a refusal, and there is nothing to verify.
 *   2. no header + any body     -> refused, missing_header
 *   3. blank header             -> refused, empty_header
 *   4. no key                   -> refused, missing_key
 *   5. not 64 hex chars         -> refused, malformed_header (base64 lands here)
 *   6. digest compare           -> verified | digest_unavailable | mismatch
 *
 * An EMPTY body that DOES carry a header is verified like any other: the HMAC
 * of zero bytes is well defined. Before L-43 that case was refused as
 * `empty_body` without looking. Leafly says it never signs an empty body, so a
 * signed one is almost certainly not Leafly — but a forged one still fails
 * the digest compare, and a genuine one should not be turned away on a
 * technicality. `empty_body` stays in the vocabulary so rows written by older
 * builds still classify; this function no longer emits it.
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
    if (rawBody === "") {
      // Ben, item 1: "When a webhook has an empty body, the header is not sent
      // at all ... Any verification code must not treat that case as a
      // rejection." Exactly "", not whitespace: the carve-out is for an empty
      // body, and widening it by guesswork is how an unsigned door opens.
      return {
        outcome: "empty_unsigned",
        ok: false,
        matchedEncoding: null,
        reason: null,
        detail: `An empty body arrived with no ${LEAFLY_SIGNATURE_HEADER} header. Leafly sends empty bodies unsigned, so this is expected, not a refusal. Nothing was authenticated, so nothing is processed or stored.`,
      };
    }
    return {
      outcome: "refused",
      ok: false,
      matchedEncoding: null,
      reason: "missing_header",
      detail: `No ${LEAFLY_SIGNATURE_HEADER} header was present on a request that had a body. Leafly signs every delivery that has a body, so this request did not come from Leafly (or something is stripping headers in front of the app).`,
    };
  }

  const presented = stripSignaturePrefix(String(headerValue));
  if (presented === "") {
    return {
      outcome: "refused",
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
      outcome: "refused",
      ok: false,
      matchedEncoding: null,
      reason: "missing_key",
      detail:
        "No Leafly HMAC key is configured, so the signature cannot be checked. Refusing the request: an unverifiable webhook is never accepted. Enter the HMAC key from Leafly in Integrations → Credentials.",
    };
  }

  // (No empty-body refusal here any more. See the doc comment above: a signed
  // empty body is verified like any other, and an unsigned one was handled at
  // the top.)

  if (!looksLikeSha256Digest(presented)) {
    return {
      outcome: "refused",
      ok: false,
      matchedEncoding: null,
      reason: "malformed_header",
      detail: `The ${LEAFLY_SIGNATURE_HEADER} header is not shaped like a hex HMAC-SHA-256 digest (expected exactly ${SHA256_HEX_LENGTH} hex characters; Leafly confirmed it sends lowercase hex, never base64). Something other than Leafly is posting to this URL.`,
    };
  }

  // One encoding since L-43; the loop shape is kept for the reasons given at
  // LEAFLY_HMAC_ENCODINGS.
  let sawUsableDigest = false;
  for (const encoding of LEAFLY_HMAC_ENCODINGS) {
    let computed: string;
    try {
      computed = digest(rawBody, hmacKey, encoding);
    } catch {
      // A throwing digester is an infrastructure fault, not an auth decision.
      // We must not let the exception escape into the route.
      continue;
    }
    if (typeof computed !== "string" || computed === "") continue;
    sawUsableDigest = true;

    // Hex is compared case-insensitively: upper and lower case are the same
    // digest bytes. (Folding case is only safe BECAUSE the encoding is hex; it
    // would be wrong for base64, which is one more reason base64 is gone.)
    const matched = timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase());

    if (matched) {
      return {
        outcome: "verified",
        ok: true,
        matchedEncoding: encoding,
        reason: null,
        detail: `Signature verified (HMAC-SHA-256, ${encoding}).`,
      };
    }
  }

  if (!sawUsableDigest) {
    return {
      outcome: "refused",
      ok: false,
      matchedEncoding: null,
      reason: "digest_unavailable",
      detail:
        "Could not compute an HMAC digest at all, so authenticity is unknown. Refusing, because an unverifiable webhook is never accepted. This is an app-side fault, not a bad request.",
    };
  }

  return {
    outcome: "refused",
    ok: false,
    matchedEncoding: null,
    reason: "mismatch",
    detail:
      "A well-formed hex signature arrived but did not match the HMAC-SHA-256 of the raw body under the key on file. The most likely cause is that the HMAC key on file is not the one Leafly is signing with — check whether it was rotated.",
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
// Admission — what the route does with a verdict (SLICE L-43)
// ---------------------------------------------------------------------------

/**
 * What a webhook route must do with a verdict.
 *
 *   process            authentic: record it, dedupe it, act on it, answer 200.
 *   acknowledge_only   Leafly's expected empty, unsigned delivery: answer 2xx
 *                      and do NOTHING else. No event row (it would be counted
 *                      as a refused signature, which is the exact false alarm
 *                      Ben warned about), no order, no bell.
 *   refuse             record the refusal for the owner's evidence, answer 401.
 */
export type LeaflyWebhookAdmission = {
  action: "process" | "acknowledge_only" | "refuse";
  /** The HTTP status the route answers with. */
  status: 200 | 401;
  /** Whether a row is written to leafly_webhook_events. */
  recordEvent: boolean;
  /** Whether the delivery may create or change anything (orders, bell, ack). */
  mayActOnPayload: boolean;
};

/**
 * Decide the route's response from a verdict. Pure and total.
 *
 * Written as a function, not left inline in the server file, because two of
 * its three branches used to be one: before L-43 every non-`ok` verdict was a
 * 401. That single `if (!verdict.ok)` is precisely the line that turned
 * Leafly's expected empty delivery into a failed one, and a decision that has
 * already been got wrong once belongs where it can be tested.
 *
 * Anything that is not recognisably "verified" or "empty_unsigned" is refused.
 * An unknown outcome must fail closed, never open.
 */
export function planLeaflyWebhookAdmission(
  verdict: Pick<LeaflyHmacVerdict, "outcome" | "ok"> | null | undefined,
): LeaflyWebhookAdmission {
  if (verdict && verdict.outcome === "verified" && verdict.ok === true) {
    return { action: "process", status: 200, recordEvent: true, mayActOnPayload: true };
  }
  if (verdict && verdict.outcome === "empty_unsigned" && verdict.ok === false) {
    return { action: "acknowledge_only", status: 200, recordEvent: false, mayActOnPayload: false };
  }
  return { action: "refuse", status: 401, recordEvent: true, mayActOnPayload: false };
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
  return encoding === "hex" ? hex : "";
}

/**
 * Render a 64-char hex digest as padded base64 (44 chars). Test-only, pure, no
 * Buffer: it exists so the self-tests can present Leafly's CORRECT digest in
 * the encoding Leafly does NOT use, and prove that is refused.
 */
function hexToBase64ForTest(hex: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += alphabet[(n >> 18) & 63];
    out += alphabet[(n >> 12) & 63];
    out += b === undefined ? "=" : alphabet[(n >> 6) & 63];
    out += c === undefined ? "=" : alphabet[n & 63];
  }
  return out;
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
  // L-43: Ben confirmed lowercase hex. Exactly one encoding, and it is hex.
  ok(LEAFLY_HMAC_ENCODINGS.length === 1, "exactly one accepted encoding (L-43)");
  ok(LEAFLY_HMAC_ENCODINGS[0] === "hex", "the one accepted encoding is hex (Ben, item 1)");
  ok(
    !(LEAFLY_HMAC_ENCODINGS as readonly string[]).includes("base64"),
    "base64 is NOT an accepted encoding any more",
  );
  ok(
    LEAFLY_HMAC_OUTCOMES.length === 3 &&
      LEAFLY_HMAC_OUTCOMES.includes("verified") &&
      LEAFLY_HMAC_OUTCOMES.includes("refused") &&
      LEAFLY_HMAC_OUTCOMES.includes("empty_unsigned"),
    "exactly three outcomes: verified, refused, empty_unsigned",
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
  // A trailing '=' with nothing after it is not a label/value split.
  const b64 = `${"A".repeat(43)}=`;
  ok(
    stripSignaturePrefix(b64) === b64,
    "a long run ending in '=' is NOT treated as a prefix delimiter",
  );
  ok(
    stripSignaturePrefix(`${"A".repeat(60)}=${"B".repeat(4)}`) ===
      `${"A".repeat(60)}=${"B".repeat(4)}`,
    "a long non-algorithm label before '=' is left alone",
  );

  // -- Shape screening -----------------------------------------------------
  ok(looksLikeSha256Digest(hex64), "64 lowercase hex chars look like a digest");
  ok(looksLikeSha256Digest("A".repeat(64)), "64 uppercase hex chars look like a digest");
  // L-43: base64 shapes are no longer digests. Both shapes that used to pass.
  ok(!looksLikeSha256Digest(b64), "43 base64 chars + padding are NOT a digest any more (L-43)");
  ok(!looksLikeSha256Digest("A".repeat(43)), "43 unpadded base64 chars are NOT a digest (L-43)");
  ok(!looksLikeSha256Digest(`${"a".repeat(42)}-_`), "unpadded base64url is NOT a digest (L-43)");
  ok(!looksLikeSha256Digest(` ${hex64}`), "a digest with a leading space is not bare hex");
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

  ok(good.outcome === "verified", "a correct hex signature has the verified outcome");

  // L-43, THE PIN: Leafly's CORRECT digest, rendered as base64, is refused.
  // Same 32 bytes as hexSig, so this can only fail because of the encoding.
  const b64Sig = hexToBase64ForTest(hexSig);
  ok(b64Sig.length === 44 && b64Sig.endsWith("="), "the base64 fixture is a real padded rendering");
  const goodB64 = verifyLeaflySignature({
    rawBody: body,
    headerValue: b64Sig,
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(!goodB64.ok, "the correct digest in base64 is REFUSED (Leafly sends hex only)");
  ok(goodB64.reason === "malformed_header", "and is refused as malformed, not as a mismatch");
  ok(goodB64.outcome === "refused", "and has the refused outcome");
  // Even with a digester willing to produce base64, only the hex path runs.
  const askedFor: string[] = [];
  verifyLeaflySignature({
    rawBody: body,
    headerValue: hexSig,
    hmacKey: key,
    digest: (b, k, enc) => {
      askedFor.push(enc);
      return fakeDigest(b, k, enc);
    },
  });
  ok(askedFor.length === 1 && askedFor[0] === "hex", "the digester is asked for hex, once, and nothing else");

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
  ok(!missing.ok && missing.reason === "missing_header", "a missing header on a body is refused");
  ok(missing.outcome === "refused", "a missing header on a body has the refused outcome");
  ok(missing.matchedEncoding === null, "a refusal reports no matched encoding");

  // -- L-43: Ben's empty body with no header --------------------------------
  const emptyUnsigned = verifyLeaflySignature({
    rawBody: "",
    headerValue: null,
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(emptyUnsigned.outcome === "empty_unsigned", "an empty body with no header is empty_unsigned");
  ok(emptyUnsigned.ok === false, "empty_unsigned is NOT authenticated (ok stays false)");
  ok(emptyUnsigned.reason === null, "empty_unsigned carries no refusal reason");
  ok(emptyUnsigned.matchedEncoding === null, "empty_unsigned matched no encoding");
  ok(
    verifyLeaflySignature({ rawBody: "", headerValue: undefined, hmacKey: key, digest: fakeDigest })
      .outcome === "empty_unsigned",
    "undefined header + empty body is empty_unsigned too",
  );
  // Checked BEFORE the key: no key must not turn an expected delivery into a refusal.
  const emptyNoKey = verifyLeaflySignature({
    rawBody: "",
    headerValue: null,
    hmacKey: null,
    digest: fakeDigest,
  });
  ok(emptyNoKey.outcome === "empty_unsigned", "empty_unsigned is decided before the key is needed");
  ok(emptyNoKey.reason !== "missing_key", "an unconfigured key does not refuse an empty unsigned delivery");
  // The digester is never consulted: there is nothing to verify.
  let digestedEmpty = 0;
  verifyLeaflySignature({
    rawBody: "",
    headerValue: null,
    hmacKey: key,
    digest: () => {
      digestedEmpty += 1;
      return "x";
    },
  });
  ok(digestedEmpty === 0, "no digest is computed for an empty unsigned delivery");
  // The carve-out is EXACTLY the empty string. Whitespace is a body.
  for (const notEmpty of [" ", "\n", "{}", "\t\r\n"]) {
    const v = verifyLeaflySignature({ rawBody: notEmpty, headerValue: null, hmacKey: key, digest: fakeDigest });
    ok(
      v.outcome === "refused" && v.reason === "missing_header",
      `a non-empty body ${JSON.stringify(notEmpty)} with no header is still refused`,
    );
  }

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

  // L-43: a SIGNED empty body is verified like any other body, not refused
  // unread. A correct signature over zero bytes verifies; a wrong one does not.
  const emptySigned = verifyLeaflySignature({
    rawBody: "",
    headerValue: fakeDigest("", key, "hex"),
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(emptySigned.ok && emptySigned.outcome === "verified", "a correctly signed empty body verifies");
  const emptyWrongSig = verifyLeaflySignature({
    rawBody: "",
    headerValue: hexSig,
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(!emptyWrongSig.ok && emptyWrongSig.reason === "mismatch", "a wrongly signed empty body is a mismatch");
  ok(
    !["", " ", "{}", body].some(
      (rb) =>
        verifyLeaflySignature({ rawBody: rb, headerValue: hexSig, hmacKey: key, digest: fakeDigest })
          .reason === "empty_body",
    ),
    "the verifier no longer emits empty_body (kept only so old rows classify)",
  );
  ok(
    (LEAFLY_HMAC_FAILURE_REASONS as readonly string[]).includes("empty_body"),
    "empty_body stays in the vocabulary for rows written by older builds",
  );
  const blankOnEmpty = verifyLeaflySignature({ rawBody: "", headerValue: "  ", hmacKey: key, digest: fakeDigest });
  ok(
    blankOnEmpty.outcome === "refused" && blankOnEmpty.reason === "empty_header",
    "a BLANK header on an empty body is refused (only an ABSENT header is expected)",
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

  // L-43: a digester that can only do base64 cannot verify anything any more.
  const b64OnlyDigester = verifyLeaflySignature({
    rawBody: body,
    headerValue: b64Sig,
    hmacKey: key,
    digest: (b, k, enc) => (enc === "hex" ? "" : hexToBase64ForTest(fakeDigest(b, k, "hex"))),
  });
  ok(!b64OnlyDigester.ok, "a base64 header is refused even if the digester would produce base64");

  // A digester whose hex output is only the lowercase rendering still matches
  // an UPPER-case header, and a different digest in upper case does not.
  ok(
    !verifyLeaflySignature({
      rawBody: body,
      headerValue: fakeDigest(body, "other", "hex").toUpperCase(),
      hmacKey: key,
      digest: fakeDigest,
    }).ok,
    "case-folding never turns a wrong digest into a right one",
  );

  // -- Local-fault classification ------------------------------------------
  ok(isLeaflyHmacLocalFault("missing_key"), "a missing key is our fault, not Leafly's");
  ok(isLeaflyHmacLocalFault("digest_unavailable"), "an unusable digester is our fault");
  ok(!isLeaflyHmacLocalFault("mismatch"), "a mismatch is not our fault");
  ok(!isLeaflyHmacLocalFault("missing_header"), "a missing header is not our fault");
  ok(!isLeaflyHmacLocalFault(null), "no reason at all is not a local fault");

  // -- L-43: the question is closed, and says who closed it ------------------
  ok(
    LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED === false,
    "the digest encoding is recorded as confirmed (Ben, item 1)",
  );
  ok(
    /lowercase hex/.test(LEAFLY_HMAC_ENCODING_SOURCE) && /Ben/.test(LEAFLY_HMAC_ENCODING_SOURCE),
    "the confirmation names its source and says lowercase hex",
  );

  // -- L-43: admission -- what the route does with each verdict ------------
  const admitGood = planLeaflyWebhookAdmission(good);
  ok(admitGood.action === "process" && admitGood.status === 200, "verified -> process, 200");
  ok(admitGood.recordEvent && admitGood.mayActOnPayload, "verified is recorded and may act");
  const admitEmpty = planLeaflyWebhookAdmission(emptyUnsigned);
  ok(admitEmpty.action === "acknowledge_only", "empty_unsigned -> acknowledge_only");
  ok(admitEmpty.status === 200, "empty_unsigned is answered 2xx (a non-2xx is a failed delivery)");
  ok(!admitEmpty.recordEvent, "empty_unsigned writes NO event row (it is not a refused signature)");
  ok(!admitEmpty.mayActOnPayload, "empty_unsigned may not create or change anything");
  const admitMissing = planLeaflyWebhookAdmission(missing);
  ok(admitMissing.action === "refuse" && admitMissing.status === 401, "missing_header on a body -> 401");
  ok(admitMissing.recordEvent && !admitMissing.mayActOnPayload, "a refusal is recorded and acts on nothing");
  ok(planLeaflyWebhookAdmission(goodB64).status === 401, "base64 -> 401");
  ok(planLeaflyWebhookAdmission(wrongKey).status === 401, "mismatch -> 401");
  ok(planLeaflyWebhookAdmission(null).action === "refuse", "no verdict at all fails closed");
  ok(planLeaflyWebhookAdmission(undefined).status === 401, "undefined verdict fails closed");
  ok(
    planLeaflyWebhookAdmission({ outcome: "verified", ok: false }).action === "refuse",
    "an inconsistent 'verified but not ok' verdict fails closed",
  );
  ok(
    planLeaflyWebhookAdmission({ outcome: "empty_unsigned", ok: true }).action === "refuse",
    "an inconsistent 'empty_unsigned but ok' verdict fails closed",
  );
  ok(
    planLeaflyWebhookAdmission({ outcome: "banana" as LeaflyHmacOutcome, ok: true }).action === "refuse",
    "an unknown outcome fails closed even if it claims ok",
  );
  // Every verdict the verifier can produce agrees with its own outcome field.
  for (const v of [good, goodB64, missing, emptyUnsigned, emptySigned, emptyWrongSig, noKey, wrongKey, tampered, throwing, empty]) {
    ok(
      (v.outcome === "verified") === v.ok &&
        (v.outcome === "refused") === (v.reason !== null),
      `verdict invariants hold for outcome=${v.outcome} reason=${v.reason}`,
    );
  }

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
