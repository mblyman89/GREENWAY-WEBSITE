/**
 * src/lib/security/constant-time.ts  (GW-022)
 *
 * Constant-time string comparison for shared-secret token checks on
 * unauthenticated HTTP surfaces (CloudPRNT printer polling, inbound-email
 * webhook).
 *
 * The problem (FINDINGS GW-022): `provided === expected` short-circuits at
 * the first differing character, so response timing leaks how much of the
 * token prefix matched. Impractical to exploit over the public internet but
 * trivially cheap to fix — and the codebase already does it right everywhere
 * else (scrypt PIN check in security/pin-hash.ts, Svix signature check in
 * cms/email-events/verify-core.ts). This module is the shared home for the
 * plain-string case so no future endpoint reinvents `===`.
 *
 * Pattern (same as verifyPin): compare byte lengths first (length is not
 * secret — the attacker chose `provided`), then `crypto.timingSafeEqual`
 * over the UTF-8 bytes, which requires equal-length buffers.
 *
 * PURE module (node:crypto only — no supabase / "server-only" imports) so
 * the embedded self-tests run under scripts/compliance/run-pure-selftests.ts.
 */
import { timingSafeEqual } from "node:crypto";

/**
 * True when `provided` equals `expected`, compared in constant time over
 * their UTF-8 bytes. Empty/missing values never match (an endpoint with no
 * configured secret must decide fail-open/closed BEFORE calling this).
 */
export function timingSafeEqualStr(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Self-tests (tsx-runnable; PURE).
// ---------------------------------------------------------------------------

export function __runConstantTimeTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      pass += 1;
    } else {
      fail += 1;
      console.log("FAIL:", msg);
    }
  };

  ok(timingSafeEqualStr("secret-token", "secret-token"), "equal strings match");
  ok(!timingSafeEqualStr("secret-token", "secret-tokeX"), "one differing char rejected");
  ok(!timingSafeEqualStr("secret", "secret-token"), "shorter provided rejected");
  ok(!timingSafeEqualStr("secret-token-long", "secret-token"), "longer provided rejected");
  ok(!timingSafeEqualStr("", "secret-token"), "empty provided rejected");
  ok(!timingSafeEqualStr("secret-token", ""), "empty expected rejected");
  ok(!timingSafeEqualStr("", ""), "both empty rejected (no secret is not a match)");
  ok(!timingSafeEqualStr(null, "secret-token"), "null provided rejected");
  ok(!timingSafeEqualStr(undefined, "secret-token"), "undefined provided rejected");
  ok(!timingSafeEqualStr("secret-token", null), "null expected rejected");
  ok(timingSafeEqualStr("emoji-🔒-token", "emoji-🔒-token"), "multibyte UTF-8 equal match");
  ok(!timingSafeEqualStr("emoji-🔒-token", "emoji-🔓-token"), "multibyte UTF-8 diff rejected");
  ok(timingSafeEqualStr("a", "a"), "single char match");
  ok(!timingSafeEqualStr("a", "b"), "single char diff rejected");

  if (fail > 0) {
    throw new Error(`constant-time self-tests: ${fail} FAILED (${pass} passed)`);
  }
  console.log(`constant-time: ${pass} self-tests passed`);
}
