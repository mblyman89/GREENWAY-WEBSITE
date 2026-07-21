/**
 * set-password-core.ts — pure, testable logic for the invite "choose your
 * password" page (GW-017 fix).
 *
 * WHY THIS EXISTS — the invite email problem in one paragraph:
 * `inviteUserByEmail` links go through Supabase's legacy token flow (the SDK
 * itself documents that PKCE is NOT supported for invites —
 * GoTrueAdminApi.d.ts:78). GoTrue's /verify endpoint verifies the token and
 * then redirects to `redirect_to` with the session tokens in the URL
 * **FRAGMENT** (`#access_token=…&refresh_token=…`). Fragments never reach a
 * server route, so the redirect target must be a CLIENT page that reads
 * `window.location.hash` itself and calls `supabase.auth.setSession(...)`.
 * That page is /admin/account/set-password; this module is its pure brain:
 *
 *   - parseAuthFragment(hash): classify the URL fragment into tokens / an
 *     auth error / nothing (GoTrue also reports failures in the fragment,
 *     e.g. `#error=access_denied&error_code=otp_expired&error_description=…`).
 *   - validateNewPassword(password, confirm): friendly client-side checks
 *     before calling `supabase.auth.updateUser({ password })`. The server
 *     (Supabase Auth) still enforces its own minimum-length policy — these
 *     rules only catch the obvious mistakes with clearer wording.
 *
 * Pure functions only — no imports — so the whole matrix is pinned by fast
 * unit tests (vitest mirror: tests/compliance/set-password-core.test.ts).
 */

export type AuthFragment =
  | { kind: "tokens"; accessToken: string; refreshToken: string }
  | { kind: "error"; message: string }
  | { kind: "none" };

/**
 * Classify a raw `window.location.hash` (leading `#` optional).
 * Precedence: an explicit error always wins; then a complete token pair;
 * a lone access_token without refresh_token is treated as an error (we
 * cannot establish a session from half a pair); anything else is "none".
 */
export function parseAuthFragment(rawHash: string): AuthFragment {
  const hash = (rawHash ?? "").replace(/^#/, "");
  if (!hash) return { kind: "none" };

  const params = new URLSearchParams(hash);
  const errorDescription = params.get("error_description");
  const errorCode = params.get("error_code");
  const error = params.get("error");
  if (error || errorDescription || errorCode) {
    // error_description is the human sentence when present; fall back to the
    // machine code so the user never sees a blank error.
    const detail = errorDescription || errorCode || error || "Unknown error";
    const friendly =
      errorCode === "otp_expired"
        ? "This invite link has expired. Ask for a fresh invite, or use \u201cemail me a sign-in link\u201d on the login page."
        : detail;
    return { kind: "error", message: friendly };
  }

  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";
  if (accessToken && refreshToken) {
    return { kind: "tokens", accessToken, refreshToken };
  }
  if (accessToken || refreshToken) {
    return {
      kind: "error",
      message:
        "The sign-in link was incomplete. Ask for a fresh invite, or use \u201cemail me a sign-in link\u201d on the login page.",
    };
  }
  return { kind: "none" };
}

/**
 * Resolve the site's public base URL for building the invite redirect —
 * prefer NEXT_PUBLIC_SITE_URL (the established convention: printer Poll URL
 * and reminder emails already build from it), falling back to the request's
 * forwarded host headers (Vercel always sets x-forwarded-host/proto), so
 * invites keep working on preview deployments where the env var may differ.
 * Returns "" when nothing usable exists — the caller then omits redirectTo
 * and Supabase falls back to the dashboard Site URL (pre-fix behavior).
 */
export function resolveSiteBase(input: {
  envSiteUrl: string | undefined;
  forwardedProto: string | null;
  forwardedHost: string | null;
  host: string | null;
}): string {
  const env = (input.envSiteUrl ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/[^\s/]+/.test(env)) return env;

  const host = (input.forwardedHost ?? input.host ?? "").trim();
  if (!host) return "";
  const proto = (input.forwardedProto ?? "https").trim() || "https";
  return `${proto}://${host}`;
}

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

/** Client-side password rules — Supabase Auth enforces its own policy too. */
export const PASSWORD_MIN_LENGTH = 8;

export function validateNewPassword(password: string, confirm: string): PasswordCheck {
  if (!password) return { ok: false, reason: "Enter a password." };
  if (password.trim().length === 0) {
    return { ok: false, reason: "The password can't be only spaces." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      reason: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (password !== confirm) {
    return { ok: false, reason: "The two passwords don't match." };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Embedded self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------
export function __runSetPasswordCoreTests(): void {
  let failures = 0;
  function expect(name: string, cond: boolean) {
    if (cond) {
      console.log(`  ok - ${name}`);
    } else {
      failures += 1;
      console.error(`  FAIL - ${name}`);
    }
  }

  // parseAuthFragment — token pair
  const t = parseAuthFragment("#access_token=aaa&refresh_token=bbb&token_type=bearer&type=invite");
  expect("fragment with both tokens -> tokens", t.kind === "tokens");
  expect("access token extracted", t.kind === "tokens" && t.accessToken === "aaa");
  expect("refresh token extracted", t.kind === "tokens" && t.refreshToken === "bbb");

  // Leading '#' optional
  expect(
    "no leading # still parses",
    parseAuthFragment("access_token=x&refresh_token=y").kind === "tokens",
  );

  // GoTrue error fragment (real shape from /verify failures)
  const e = parseAuthFragment(
    "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  );
  expect("error fragment -> error", e.kind === "error");
  expect(
    "otp_expired gets the friendly wording",
    e.kind === "error" && e.message.includes("expired"),
  );

  // Error takes precedence even when tokens are also present
  expect(
    "error wins over tokens",
    parseAuthFragment("#access_token=a&refresh_token=b&error=access_denied").kind === "error",
  );

  // Generic error keeps the description text
  const g = parseAuthFragment("#error=server_error&error_description=Something+went+wrong");
  expect(
    "generic error keeps description",
    g.kind === "error" && g.message === "Something went wrong",
  );

  // Half a token pair is an error, not a silent none
  expect(
    "access_token without refresh_token -> error",
    parseAuthFragment("#access_token=only").kind === "error",
  );
  expect(
    "refresh_token without access_token -> error",
    parseAuthFragment("#refresh_token=only").kind === "error",
  );

  // Nothing auth-related
  expect("empty hash -> none", parseAuthFragment("").kind === "none");
  expect("bare # -> none", parseAuthFragment("#").kind === "none");
  expect("unrelated fragment -> none", parseAuthFragment("#section-2").kind === "none");

  // resolveSiteBase
  expect(
    "env URL wins",
    resolveSiteBase({
      envSiteUrl: "https://greenwaymarijuana.com",
      forwardedProto: "https",
      forwardedHost: "preview.vercel.app",
      host: "preview.vercel.app",
    }) === "https://greenwaymarijuana.com",
  );
  expect(
    "trailing slash stripped from env URL",
    resolveSiteBase({
      envSiteUrl: "https://greenwaymarijuana.com/",
      forwardedProto: null,
      forwardedHost: null,
      host: null,
    }) === "https://greenwaymarijuana.com",
  );
  expect(
    "falls back to forwarded host",
    resolveSiteBase({
      envSiteUrl: "",
      forwardedProto: "https",
      forwardedHost: "greenway-git-fix.vercel.app",
      host: "internal:3000",
    }) === "https://greenway-git-fix.vercel.app",
  );
  expect(
    "falls back to plain host with https default",
    resolveSiteBase({
      envSiteUrl: undefined,
      forwardedProto: null,
      forwardedHost: null,
      host: "greenwaymarijuana.com",
    }) === "https://greenwaymarijuana.com",
  );
  expect(
    "garbage env URL ignored in favor of host",
    resolveSiteBase({
      envSiteUrl: "not-a-url",
      forwardedProto: "https",
      forwardedHost: "site.example",
      host: null,
    }) === "https://site.example",
  );
  expect(
    "nothing usable -> empty string",
    resolveSiteBase({ envSiteUrl: "", forwardedProto: null, forwardedHost: null, host: null }) ===
      "",
  );

  // validateNewPassword
  expect("empty password rejected", !validateNewPassword("", "").ok);
  expect("all-spaces rejected", !validateNewPassword("        ", "        ").ok);
  expect("7 chars rejected", !validateNewPassword("abcdefg", "abcdefg").ok);
  expect("8 chars accepted", validateNewPassword("abcdefgh", "abcdefgh").ok);
  expect("mismatch rejected", !validateNewPassword("abcdefgh", "abcdefgX").ok);
  const mm = validateNewPassword("abcdefgh", "different");
  expect(
    "mismatch reason is friendly",
    !mm.ok && mm.reason === "The two passwords don't match.",
  );
  expect(
    "long passphrase accepted",
    validateNewPassword("correct horse battery staple", "correct horse battery staple").ok,
  );

  if (failures > 0) {
    throw new Error(`set-password-core self-tests: ${failures} failure(s)`);
  }
  console.log("set-password-core: all self-tests passed");
}
