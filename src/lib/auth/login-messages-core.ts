/**
 * login-messages-core.ts — pure, testable handling of magic-link outcomes on
 * the public login page (GW-018 fix + anti-enumeration hardening).
 *
 * Context: the login form's "email me a sign-in link" now passes
 * `shouldCreateUser: false` so unknown emails can never create staff accounts
 * (the GW-018 hole). But the Auth server then answers an unknown email with
 * 422 `otp_disabled` / "Signups not allowed for otp" (verified in
 * supabase/auth internal/api/otp.go — `shouldCreateUser()` returns false for
 * a not-found user and the handler raises exactly that error). Showing that
 * error verbatim would tell a stranger "this email has no account here" —
 * i.e. the form becomes a staff-directory oracle (the leak is documented in
 * supabase/auth issue #1547).
 *
 * So this module classifies the error into what the PUBLIC page should show:
 *   - "neutral": unknown-email/signups-off responses → show the exact same
 *     "check your email" screen a real staffer sees. No information leaks.
 *   - "error": everything else (rate limits, network, misconfiguration) →
 *     real staff still see actionable messages.
 *
 * Pure functions only (no imports) so the matrix is pinned by fast tests
 * (vitest mirror: tests/compliance/login-messages-core.test.ts).
 */

export type MagicLinkOutcome =
  | { kind: "neutral" }
  | { kind: "error"; message: string };

/**
 * Error codes the Auth server uses for "this email can't sign up here" —
 * both mean the request was refused because the account doesn't exist (or
 * signups are off), which is exactly what we must NOT reveal.
 *  - otp_disabled: unknown email with create_user=false (otp.go), or OTP
 *    sign-in disabled project-wide.
 *  - signup_disabled: "allow new users to sign up" is OFF in the dashboard
 *    and the request would have needed a signup.
 */
const NEUTRAL_CODES = new Set(["otp_disabled", "signup_disabled"]);

/** Rate-limit codes get a friendlier "wait a moment" wording. */
const RATE_LIMIT_CODES = new Set([
  "over_email_send_rate_limit",
  "over_request_rate_limit",
]);

export function classifyMagicLinkError(
  code: string | undefined,
  message: string | undefined,
): MagicLinkOutcome {
  const msg = (message ?? "").trim();

  if (code && NEUTRAL_CODES.has(code)) return { kind: "neutral" };

  // Older Auth servers (pre error-code era) send the sentence without a code.
  if (/signups? not allowed/i.test(msg)) return { kind: "neutral" };

  if (code && RATE_LIMIT_CODES.has(code)) {
    return {
      kind: "error",
      message:
        "Too many attempts right now — wait a minute and try again.",
    };
  }

  return {
    kind: "error",
    message: msg || "Could not send the sign-in link. Please try again.",
  };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runLoginMessagesCoreTests(): void {
  let failures = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  }

  // The GW-018 case: unknown email with shouldCreateUser:false
  expect(
    "otp_disabled -> neutral (no account-existence leak)",
    classifyMagicLinkError("otp_disabled", "Signups not allowed for otp").kind === "neutral",
  );
  expect(
    "signup_disabled -> neutral",
    classifyMagicLinkError("signup_disabled", "Signups not allowed for this instance").kind ===
      "neutral",
  );
  // Legacy servers without error codes still send the sentence
  expect(
    "message-only 'Signups not allowed for otp' -> neutral",
    classifyMagicLinkError(undefined, "Signups not allowed for otp").kind === "neutral",
  );
  expect(
    "message-only 'Signup not allowed for this instance' -> neutral",
    classifyMagicLinkError(undefined, "Signup not allowed for this instance").kind === "neutral",
  );

  // Rate limits stay visible but get friendly wording
  const rl = classifyMagicLinkError("over_email_send_rate_limit", "email rate limit exceeded");
  expect("email rate limit -> error", rl.kind === "error");
  expect(
    "rate limit gets 'wait a minute' wording",
    rl.kind === "error" && rl.message.includes("wait a minute"),
  );
  expect(
    "request rate limit -> error",
    classifyMagicLinkError("over_request_rate_limit", "").kind === "error",
  );

  // Everything else passes through for real staff to see
  const other = classifyMagicLinkError("validation_failed", "Unable to validate email address");
  expect("other errors pass through", other.kind === "error");
  expect(
    "other errors keep the original message",
    other.kind === "error" && other.message === "Unable to validate email address",
  );
  const blank = classifyMagicLinkError(undefined, "");
  expect(
    "blank message gets a fallback",
    blank.kind === "error" && blank.message.length > 0,
  );

  // A neutral-looking word inside an unrelated sentence must NOT go neutral
  expect(
    "unrelated message stays an error",
    classifyMagicLinkError(undefined, "Could not reach the server").kind === "error",
  );

  if (failures > 0) {
    throw new Error(`login-messages-core self-tests: ${failures} failure(s)`);
  }
  console.log("login-messages-core: all self-tests passed");
}
