/**
 * src/lib/marketing/canva-core.ts
 *
 * SLICE 115: resolve the "Open Canva" button target from an owner-configured
 * URL, with a safe default.
 *
 * TRUTH (verified in-slice against Canva's docs, NOT guessed):
 *   - Canva does NOT support credential-in-URL auto-login. You cannot pass a
 *     username/password in a link to log a browser in, and storing a Canva
 *     password in a Vercel env var can never sign a browser in (and would be a
 *     security risk). Login happens in the browser (email / Google / SSO).
 *   - Deep links DO work using the owner's EXISTING signed-in browser session.
 *     So an "Open Canva" button that points at the Canva dashboard, a specific
 *     design/template link, or a brand-kit URL will open straight to that spot
 *     when Michael is already logged in.
 *
 * Therefore the right, honest design is an owner-CONFIGURABLE Canva URL:
 *   - default = the Canva home/dashboard (https://www.canva.com/), and
 *   - overridable via the Vercel env var NEXT_PUBLIC_CANVA_URL (readable in the
 *     browser) so Michael can point it at his team home, a brand kit, or a
 *     specific template with ZERO code changes.
 *
 * This module is PURE (no server / React imports) so it is self-testable.
 */

/** Safe default: the Canva dashboard/home. */
export const CANVA_DEFAULT_URL = "https://www.canva.com/";

/**
 * Resolve a safe Canva URL from an optional owner-configured value.
 *
 * Rules (defensive — the button must NEVER point off-domain or at a
 * non-https/hostile URL, even if the env var is fat-fingered):
 *   - must be a non-blank string,
 *   - must parse as a URL,
 *   - protocol must be https,
 *   - host must be canva.com or a *.canva.com subdomain.
 * Anything else falls back to CANVA_DEFAULT_URL.
 */
export function resolveCanvaUrl(
  configured?: string | null | undefined,
): string {
  if (typeof configured !== "string") return CANVA_DEFAULT_URL;
  const trimmed = configured.trim();
  if (trimmed.length === 0) return CANVA_DEFAULT_URL;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return CANVA_DEFAULT_URL;
  }

  if (parsed.protocol !== "https:") return CANVA_DEFAULT_URL;

  const host = parsed.hostname.toLowerCase();
  const isCanva = host === "canva.com" || host.endsWith(".canva.com");
  if (!isCanva) return CANVA_DEFAULT_URL;

  return parsed.toString();
}

// ---------------------------------------------------------------------------
// Self-tests (pure; run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function runCanvaCoreSelfTests(): string[] {
  const failures: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  check(
    CANVA_DEFAULT_URL === "https://www.canva.com/",
    "CANVA_DEFAULT_URL default drift",
  );

  // Missing / blank -> default.
  check(resolveCanvaUrl() === CANVA_DEFAULT_URL, "undefined -> default");
  check(resolveCanvaUrl(null) === CANVA_DEFAULT_URL, "null -> default");
  check(resolveCanvaUrl("") === CANVA_DEFAULT_URL, "empty -> default");
  check(resolveCanvaUrl("   ") === CANVA_DEFAULT_URL, "blank -> default");

  // Valid canva overrides win (normalized by URL()).
  check(
    resolveCanvaUrl("https://www.canva.com/folder/abc") ===
      "https://www.canva.com/folder/abc",
    "valid canva path override",
  );
  check(
    resolveCanvaUrl("https://canva.com/design/xyz") ===
      "https://canva.com/design/xyz",
    "apex canva override",
  );
  check(
    resolveCanvaUrl("  https://www.canva.com/brand/kit  ") ===
      "https://www.canva.com/brand/kit",
    "trimmed canva override",
  );

  // Hostile / wrong -> default.
  check(
    resolveCanvaUrl("http://www.canva.com/") === CANVA_DEFAULT_URL,
    "http (non-https) -> default",
  );
  check(
    resolveCanvaUrl("https://evil.com/") === CANVA_DEFAULT_URL,
    "off-domain -> default",
  );
  check(
    resolveCanvaUrl("https://canva.com.evil.com/") === CANVA_DEFAULT_URL,
    "lookalike host -> default",
  );
  check(
    resolveCanvaUrl("javascript:alert(1)") === CANVA_DEFAULT_URL,
    "js scheme -> default",
  );
  check(
    resolveCanvaUrl("not a url") === CANVA_DEFAULT_URL,
    "junk -> default",
  );

  return failures;
}

/**
 * Adapter for scripts/compliance/run-pure-selftests.ts (assertNoFailures).
 */
export function __runCanvaCoreTests(): { passed: number; failed: number } {
  const failures = runCanvaCoreSelfTests();
  return { passed: 0, failed: failures.length };
}
