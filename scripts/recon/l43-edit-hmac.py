#!/usr/bin/env python3
"""SLICE L-43 -- one-shot, anchor-checked edit of src/lib/leafly/hmac-core.ts.

Every replacement must match EXACTLY ONCE or the script aborts without writing,
so a drifted anchor can never produce a half-edited security module.
"""
import sys

P = "src/lib/leafly/hmac-core.ts"
s = open(P, encoding="utf8").read()


def rep(old: str, new: str) -> None:
    global s
    n = s.count(old)
    if n != 1:
        print(f"ANCHOR COUNT {n} (need 1):\n{old[:160]}")
        sys.exit(3)
    s = s.replace(old, new, 1)


# ---------------------------------------------------------------- header doc
rep(
    """ * That paragraph fixes four things and leaves one open. The four fixed:""",
    """ * That paragraph fixes four things and left one open. The four fixed:""",
)

rep(
    """ * THE ONE OPEN QUESTION \u2014 DIGEST ENCODING (risk 8 in the readiness report).
 * Leafly says "digest" but never says whether the header carries that digest as
 * lowercase hex or as base64. Both are 100% standard for HMAC-SHA-256. Guessing
 * would be a coin flip, and the wrong guess rejects EVERY REAL ORDER while
 * looking exactly like a correctly-working fail-closed security control \u2014 the
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
""",
    """ * THE ONCE-OPEN QUESTION \u2014 DIGEST ENCODING \u2014 IS NOW CLOSED (SLICE L-43).
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
""",
)

# ---------------------------------------------------------------- vocabulary
rep(
    """/**
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
 * documents it \u2014 the test fails the moment the spec gains the word "hex" or
 * "base64" near the signature description.
 */
export const LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED = true;
""",
    """/**
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
""",
)

rep(
    """export type LeaflyHmacVerdict = {
  /** Authentic \u2014 the digest matched in at least one encoding. */
  ok: boolean;""",
    """/**
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
  /** Authentic \u2014 the digest matched. True only when outcome is "verified". */
  ok: boolean;""",
)

rep(
    """  /** Which encoding matched. Null whenever `ok` is false. */""",
    """  /** Which encoding matched (always "hex" since L-43). Null whenever `ok` is false. */""",
)
rep(
    """  /** Machine-readable failure reason. Null when `ok` is true. */""",
    """  /** Machine-readable failure reason. Non-null exactly when outcome is "refused". */""",
)

# ---------------------------------------------------------------- prefix + shape
rep(
    """ * Strip a `sha256=` style prefix if present.
 *
 * Leafly's spec shows no prefix, so we expect a bare digest. But several major
 * webhook providers (GitHub, Stripe) prefix theirs, and if Leafly ever does the
 * signature would be unparseable and every order would be refused. Tolerating
 * the prefix costs one line and removes a whole class of outage. The prefix is
 * NOT trusted to name the algorithm \u2014 we always use SHA-256, because that is
 * what the spec fixes.
 */""",
    """ * Strip a `sha256=` style prefix if present.
 *
 * Ben confirmed there is NO prefix, so a genuine header is a bare digest and
 * this is a no-op for every real delivery. It is kept because it cannot widen
 * what verifies \u2014 the digest after the label must still match exactly \u2014 while
 * a future `sha256=` (the GitHub/Stripe convention) would otherwise refuse
 * every order at once. The prefix is NOT trusted to name the algorithm: we
 * always use SHA-256, because that is what the spec fixes.
 */""",
)
rep(
    """  // Only strip labels that look like an algorithm name. Base64 digests can
  // legitimately contain '=' as PADDING, and stripping at the first '=' there
  // would destroy a valid signature \u2014 so the label must be alphanumeric and
  // short, which base64 payload bytes before the padding never are.""",
    """  // Only strip labels that look like an algorithm name: alphanumeric and short.
  // (This guard dates from when base64, whose '=' is padding, was accepted. It
  // is kept because a long run before an '=' is not a label by any convention.)""",
)

rep(
    """/**
 * Does this string even look like a SHA-256 digest in one of the two encodings?
 *""",
    """/**
 * Does this string look like a hex SHA-256 digest? (Hex only since L-43.)
 *""",
)
rep(
    """export function looksLikeSha256Digest(value: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
  // base64 of 32 bytes is 44 chars including one '=' of padding.
  if (/^[A-Za-z0-9+/]{43}=$/.test(value)) return true;
  // Tolerate unpadded base64url/base64 (43 chars, no padding).
  if (/^[A-Za-z0-9+/_-]{43}$/.test(value)) return true;
  return false;
}""",
    """export function looksLikeSha256Digest(value: string): boolean {
  // Exactly 64 hex characters, either case. Base64 (44 chars with '=' padding,
  // or 43 unpadded) used to pass here too; since L-43 it is malformed, because
  // Leafly has said in writing that it does not send it.
  return /^[0-9a-fA-F]{64}$/.test(value);
}""",
)

# ---------------------------------------------------------------- verify
rep(
    """ * FAILS CLOSED in every ambiguous case: no header, no key, unusable digester,
 * or anything that throws, all return `ok: false`. There is no configuration and
 * no environment in which this function returns `ok: true` without an actual
 * digest match.
 *
 * `rawBody` MUST be the exact bytes received. See the file header.
 */""",
    """ * FAILS CLOSED in every ambiguous case: no header, no key, unusable digester,
 * or anything that throws, all return `ok: false`. There is no configuration and
 * no environment in which this function returns `ok: true` without an actual
 * digest match.
 *
 * ORDER OF CHECKS (L-43 \u2014 the order is load-bearing and mutation-tested):
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
 * signed one is almost certainly not Leafly \u2014 but a forged one still fails
 * the digest compare, and a genuine one should not be turned away on a
 * technicality. `empty_body` stays in the vocabulary so rows written by older
 * builds still classify; this function no longer emits it.
 *
 * `rawBody` MUST be the exact bytes received. See the file header.
 */""",
)

rep(
    """  const { rawBody, headerValue, hmacKey, digest } = input;

  if (headerValue === null || headerValue === undefined) {
    return {
      ok: false,
      matchedEncoding: null,
      reason: "missing_header",
      detail: `No ${LEAFLY_SIGNATURE_HEADER} header was present. Genuine Leafly webhooks always carry one, so this request did not come from Leafly (or something is stripping headers in front of the app).`,
    };
  }
""",
    """  const { rawBody, headerValue, hmacKey, digest } = input;

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
""",
)

rep(
    """    return {
      ok: false,
      matchedEncoding: null,
      reason: "empty_header",""",
    """    return {
      outcome: "refused",
      ok: false,
      matchedEncoding: null,
      reason: "empty_header",""",
)
rep(
    """    return {
      ok: false,
      matchedEncoding: null,
      reason: "missing_key",""",
    """    return {
      outcome: "refused",
      ok: false,
      matchedEncoding: null,
      reason: "missing_key",""",
)

rep(
    """  if (rawBody === "") {
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
  let sawUsableDigest = false;""",
    """  // (No empty-body refusal here any more. See the doc comment above: a signed
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
  let sawUsableDigest = false;""",
)

rep(
    """    } catch {
      // A throwing digester is an infrastructure fault, not an auth decision.
      // Keep going: the other encoding may still work, and we must not let the
      // exception escape into the route.
      continue;
    }""",
    """    } catch {
      // A throwing digester is an infrastructure fault, not an auth decision.
      // We must not let the exception escape into the route.
      continue;
    }""",
)

rep(
    """    // Compare case-insensitively for HEX only. Hex is the same digest whether
    // rendered upper or lower case, and providers differ. Base64 is
    // case-SENSITIVE \u2014 'A' and 'a' are different six-bit groups \u2014 so folding
    // case there would accept digests that are genuinely wrong.
    const matched =
      encoding === "hex"
        ? timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase())
        : timingSafeStringEqual(computed, presented);

    if (matched) {
      return {
        ok: true,""",
    """    // Hex is compared case-insensitively: upper and lower case are the same
    // digest bytes. (Folding case is only safe BECAUSE the encoding is hex; it
    // would be wrong for base64, which is one more reason base64 is gone.)
    const matched = timingSafeStringEqual(computed.toLowerCase(), presented.toLowerCase());

    if (matched) {
      return {
        outcome: "verified",
        ok: true,""",
)

rep(
    """  if (!sawUsableDigest) {
    return {
      ok: false,""",
    """  if (!sawUsableDigest) {
    return {
      outcome: "refused",
      ok: false,""",
)
rep(
    """  return {
    ok: false,
    matchedEncoding: null,
    reason: "mismatch",
    detail:
      "The signature did not match in either hex or base64. The most likely cause is that the HMAC key on file is not the one Leafly is signing with \u2014 check whether it was rotated.",
  };
}""",
    """  return {
    outcome: "refused",
    ok: false,
    matchedEncoding: null,
    reason: "mismatch",
    detail:
      "A well-formed hex signature arrived but did not match the HMAC-SHA-256 of the raw body under the key on file. The most likely cause is that the HMAC key on file is not the one Leafly is signing with \u2014 check whether it was rotated.",
  };
}""",
)

# ---------------------------------------------------------------- admission plan
rep(
    """export function isLeaflyHmacLocalFault(reason: LeaflyHmacFailureReason | null): boolean {
  return reason === "missing_key" || reason === "digest_unavailable";
}
""",
    """export function isLeaflyHmacLocalFault(reason: LeaflyHmacFailureReason | null): boolean {
  return reason === "missing_key" || reason === "digest_unavailable";
}

// ---------------------------------------------------------------------------
// Admission \u2014 what the route does with a verdict (SLICE L-43)
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
""",
)

# ---------------------------------------------------------------- fake digest
rep(
    """  const hex = hexSeed.slice(0, SHA256_HEX_LENGTH);
  if (encoding === "hex") return hex;
  // Render the same 32 bytes as something base64-shaped (43 chars + '=').
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < 43; i += 1) {
    const nibble = parseInt(hex[i % hex.length] ?? "0", 16);
    out += alphabet[(nibble * 4 + i) % 64];
  }
  return `${out}=`;
}""",
    """  const hex = hexSeed.slice(0, SHA256_HEX_LENGTH);
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
}""",
)

# ---------------------------------------------------------------- self-tests
rep(
    """  ok(LEAFLY_HMAC_ENCODINGS.length === 2, "exactly two candidate encodings");
  ok(
    LEAFLY_HMAC_ENCODINGS.includes("hex") && LEAFLY_HMAC_ENCODINGS.includes("base64"),
    "the two candidates are hex and base64",
  );""",
    """  // L-43: Ben confirmed lowercase hex. Exactly one encoding, and it is hex.
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
  );""",
)

rep(
    """  // THE IMPORTANT ONE: base64 padding must survive.
  const b64 = `${"A".repeat(43)}=`;
  ok(
    stripSignaturePrefix(b64) === b64,
    "base64 padding is NOT treated as a prefix delimiter (would destroy a valid signature)",
  );""",
    """  // A trailing '=' with nothing after it is not a label/value split.
  const b64 = `${"A".repeat(43)}=`;
  ok(
    stripSignaturePrefix(b64) === b64,
    "a long run ending in '=' is NOT treated as a prefix delimiter",
  );""",
)

rep(
    """  ok(looksLikeSha256Digest(b64), "43 base64 chars + padding look like a digest");
  ok(looksLikeSha256Digest("A".repeat(43)), "43 unpadded base64 chars look like a digest");""",
    """  // L-43: base64 shapes are no longer digests. Both shapes that used to pass.
  ok(!looksLikeSha256Digest(b64), "43 base64 chars + padding are NOT a digest any more (L-43)");
  ok(!looksLikeSha256Digest("A".repeat(43)), "43 unpadded base64 chars are NOT a digest (L-43)");
  ok(!looksLikeSha256Digest(`${"a".repeat(42)}-_`), "unpadded base64url is NOT a digest (L-43)");
  ok(!looksLikeSha256Digest(` ${hex64}`), "a digest with a leading space is not bare hex");""",
)

rep(
    """  const b64Sig = fakeDigest(body, key, "base64");
  const goodB64 = verifyLeaflySignature({
    rawBody: body,
    headerValue: b64Sig,
    hmacKey: key,
    digest: fakeDigest,
  });
  ok(goodB64.ok, "a correct base64 signature verifies");
  ok(goodB64.matchedEncoding === "base64", "and reports base64 as the matched encoding");
""",
    """  ok(good.outcome === "verified", "a correct hex signature has the verified outcome");

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
""",
)

rep(
    """  ok(!missing.ok && missing.reason === "missing_header", "a missing header is refused");
  ok(missing.matchedEncoding === null, "a refusal reports no matched encoding");""",
    """  ok(!missing.ok && missing.reason === "missing_header", "a missing header on a body is refused");
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
  for (const notEmpty of [" ", "\\n", "{}", "\\t\\r\\n"]) {
    const v = verifyLeaflySignature({ rawBody: notEmpty, headerValue: null, hmacKey: key, digest: fakeDigest });
    ok(
      v.outcome === "refused" && v.reason === "missing_header",
      `a non-empty body ${JSON.stringify(notEmpty)} with no header is still refused`,
    );
  }""",
)

rep(
    """  ok(
    verifyLeaflySignature({ rawBody: "", headerValue: hexSig, hmacKey: key, digest: fakeDigest })
      .reason === "empty_body",
    "an empty body is refused",
  );
""",
    """  // L-43: a SIGNED empty body is verified like any other body, not refused
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
""",
)

rep(
    """  // If only ONE encoding is computable, verification must still succeed on it.
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
""",
    """  // L-43: a digester that can only do base64 cannot verify anything any more.
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
""",
)

rep(
    """  ok(!isLeaflyHmacLocalFault(null), "no reason at all is not a local fault");

  // -- The open question is still flagged ----------------------------------
  ok(
    LEAFLY_HMAC_ENCODING_IS_UNCONFIRMED === true,
    "the digest encoding is still recorded as unconfirmed (the spec does not state it)",
  );
""",
    """  ok(!isLeaflyHmacLocalFault(null), "no reason at all is not a local fault");

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
""",
)

open(P, "w", encoding="utf8").write(s)
print("hmac-core.ts edited OK")
