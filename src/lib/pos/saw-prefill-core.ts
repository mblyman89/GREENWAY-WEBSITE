/**
 * POS Slice 6 — SAW username helper for the DOH medical-verification step (pure core).
 *
 * WHY THIS EXISTS
 * ---------------
 * A rare medical sale requires the budtender to VERIFY the customer's DOH
 * recognition card is ACTIVE in the state Medical Cannabis Registry (MCR) on
 * EVERY sale — done by logging into SecureAccess Washington (SAW). With two
 * registers and ten staff, the friction owners fear is "which SAW login is
 * this, and where are the credentials?" — fumbling mid-sale.
 *
 * WHAT WE CAN AND CANNOT DO (verified against secureaccess.wa.gov, not guessed)
 * ----------------------------------------------------------------------------
 * The live SAW login page is a client-rendered SPA with NO documented URL
 * parameter to pre-fill the username, and a third-party site cannot type into
 * another origin's form (browser security). So we CANNOT auto-inject the
 * username into SAW's field. What we CAN do — safely and reliably — is:
 *   1. SHOW the signed-in employee THEIR OWN SAW username at the verify step
 *      (the register already knows who unlocked it), so there is zero "which
 *      login?" confusion, and
 *   2. give a one-tap "copy username" affordance + open SAW's real login page.
 * The employee then completes their own multi-factor login (the code sent to
 * THEIR phone). Passwords are never stored anywhere in this app; the per-person
 * MFA is exactly what keeps the DOH audit trail honest.
 *
 * This core owns the tiny, testable pieces of that: sanitizing a stored
 * username and producing the canonical SAW login URL. Pure: no I/O, no React.
 * Self-tested below (registered in scripts/compliance/run-pure-selftests.ts)
 * and mirrored in vitest.
 */

/**
 * The canonical SAW sign-in URL. We intentionally send staff to the SAW HOME
 * ("/") — the login entry point — rather than a deep `displayLogin.do` link,
 * because the deep link 400s (verified live) and the SPA home is the stable,
 * supported entry. No query parameters are appended: none are documented to
 * pre-fill the username, and inventing one would silently do nothing.
 */
export const SAW_LOGIN_URL = "https://secureaccess.wa.gov/";

/**
 * Normalize an untrusted stored SAW username into a safe, display/copy-ready
 * string, or null when there is nothing usable.
 *
 * SAW usernames are case-insensitive account handles. We:
 *  - coerce non-strings to null (fail safe on corruption),
 *  - trim surrounding whitespace,
 *  - collapse internal whitespace to nothing (SAW usernames contain no spaces;
 *    a pasted value with stray spaces is a data-entry slip, not a real name),
 *  - strip control characters,
 *  - cap length defensively (no legitimate username is this long),
 *  - return null for the empty result.
 *
 * We do NOT force case or otherwise alter the visible characters — the owner
 * types the exact handle in the back office and we show it back verbatim.
 */
export function sanitizeSawUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // Remove ASCII control chars, then drop ALL whitespace, then trim leftovers.
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length > 128) return cleaned.slice(0, 128);
  return cleaned;
}

/** True when a usable SAW username is present after sanitizing. */
export function hasSawUsername(raw: unknown): boolean {
  return sanitizeSawUsername(raw) !== null;
}

/**
 * Build the SAW login URL to open from the register. There is no reliable
 * username pre-fill parameter, so this always returns the canonical login URL;
 * the username is surfaced separately in the UI (shown + copyable). Kept as a
 * function (not just the constant) so any future, VERIFIED prefill mechanism
 * has one place to live without touching call sites.
 */
export function buildSawLoginUrl(...ignoredUsername: unknown[]): string {
  // The username is intentionally ignored: there is no reliable, documented SAW
  // URL parameter to pre-fill it (verified live). Referenced here as a no-op so
  // the signature stays call-compatible while any future VERIFIED prefill can
  // slot in without touching call sites.
  void ignoredUsername;
  return SAW_LOGIN_URL;
}

/**
 * The short helper line shown next to the "Open SAW" action at the verify step.
 * When we know the employee's username we name it so there is no ambiguity about
 * which login to use; otherwise we prompt the owner to set it (without blocking
 * the sale — the employee can still log in from memory).
 */
export function sawUsernameHint(raw: unknown): string {
  const u = sanitizeSawUsername(raw);
  return u
    ? `Log in to SAW as: ${u}`
    : "Log in with your own SAW account (ask the owner to save your SAW username on your employee file to show it here).";
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runSawPrefillCoreTests(): void {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  const ok = (cond: boolean, name: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      failures.push(name);
    }
  };

  // Canonical URL is the stable SAW home entry point, no query params.
  ok(SAW_LOGIN_URL === "https://secureaccess.wa.gov/", "canonical SAW url");
  ok(!SAW_LOGIN_URL.includes("?"), "no query params on SAW url (none are documented)");
  ok(buildSawLoginUrl("jsmith") === SAW_LOGIN_URL, "buildSawLoginUrl ignores username (no reliable prefill)");
  ok(buildSawLoginUrl() === SAW_LOGIN_URL, "buildSawLoginUrl with no arg");
  ok(buildSawLoginUrl(null) === SAW_LOGIN_URL, "buildSawLoginUrl null");

  // sanitizeSawUsername — happy paths.
  ok(sanitizeSawUsername("jsmith") === "jsmith", "plain username kept verbatim");
  ok(sanitizeSawUsername("J.Smith_2026") === "J.Smith_2026", "dots/underscores/digits kept");
  ok(sanitizeSawUsername("  jsmith  ") === "jsmith", "surrounding whitespace trimmed");
  ok(sanitizeSawUsername("j smith") === "jsmith", "internal spaces collapsed away");
  ok(sanitizeSawUsername("MixedCase") === "MixedCase", "case preserved (SAW is case-insensitive; we show verbatim)");
  ok(sanitizeSawUsername("greenway@store") === "greenway@store", "email-style handle kept");

  // sanitizeSawUsername — fail-safe / corruption.
  ok(sanitizeSawUsername(null) === null, "null → null");
  ok(sanitizeSawUsername(undefined) === null, "undefined → null");
  ok(sanitizeSawUsername("") === null, "empty → null");
  ok(sanitizeSawUsername("   ") === null, "all-whitespace → null");
  ok(sanitizeSawUsername("\t\n ") === null, "tabs/newlines only → null");
  ok(sanitizeSawUsername(42) === null, "number → null");
  ok(sanitizeSawUsername({}) === null, "object → null");
  ok(sanitizeSawUsername("bad\u0000ctrl") === "badctrl", "control chars stripped");
  ok(
    (sanitizeSawUsername("x".repeat(500)) ?? "").length === 128,
    "overlong username capped at 128",
  );

  // hasSawUsername.
  ok(hasSawUsername("jsmith") === true, "hasSawUsername true for real username");
  ok(hasSawUsername("") === false, "hasSawUsername false for empty");
  ok(hasSawUsername(null) === false, "hasSawUsername false for null");
  ok(hasSawUsername("   ") === false, "hasSawUsername false for whitespace");

  // sawUsernameHint — names the login when known, prompts (non-blocking) otherwise.
  ok(sawUsernameHint("jsmith").includes("jsmith"), "hint names the known username");
  ok(sawUsernameHint("jsmith").startsWith("Log in to SAW as:"), "hint phrasing when known");
  ok(
    sawUsernameHint(null).includes("your own SAW account"),
    "hint prompts to set username when unknown",
  );
  ok(
    !sawUsernameHint(null).toLowerCase().includes("password"),
    "hint never mentions a password (we never store one)",
  );

  console.log(`saw-prefill-core: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    throw new Error(`saw-prefill-core self-tests failed: ${failures.join("; ")}`);
  }
}
