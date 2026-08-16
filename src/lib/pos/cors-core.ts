/**
 * pos/cors-core — the ONE authoritative cross-origin policy for /api/pos/*.
 *
 * WHY THIS EXISTS
 * The register is being packaged as a native iPad app ("Greenway Point of
 * Transaction"). A Capacitor app does NOT run on https://greenwaymarijuana.com
 * — its web view serves the bundled files from a LOCAL origin and then calls
 * our API cross-origin. Browsers (and WKWebView) block those calls unless the
 * server explicitly says "this origin is allowed". Today /api/pos/* sends no
 * CORS headers at all, so the native app literally cannot talk to the server.
 *
 * The Capacitor origins below are NOT guesses — they are the documented v8
 * defaults (capacitorjs.com/docs/config):
 *   - iOS:     server.iosScheme     default "capacitor"  -> capacitor://localhost
 *   - Android: server.androidScheme default "https"      -> https://localhost
 * `ionic://localhost` is the legacy cordova-plugin-ionic-webview scheme, kept
 * because the same docs call out migrating apps that still use it.
 *
 * SECURITY POSTURE (deliberate, and the reason this is an allowlist):
 *  1. STRICT ALLOWLIST. We never reflect an arbitrary Origin and we never send
 *     `Access-Control-Allow-Origin: *`. An unknown origin gets NO CORS headers,
 *     so the browser blocks it. A wildcard would let ANY website on the
 *     internet script our POS API using a stolen device key.
 *  2. NO CREDENTIALS. /api/pos/* authenticates with the explicit
 *     `x-pos-device-id` / `x-pos-device-key` headers, never cookies. So we do
 *     NOT send `Access-Control-Allow-Credentials`, which keeps the API immune
 *     to cookie-based CSRF: a malicious page cannot ride an ambient session.
 *  3. EXACT ORIGIN MATCH. Compared byte-for-byte after normalization. No
 *     prefix/suffix/`includes()` matching — "https://greenwaymarijuana.com.evil
 *     .com" must never match "https://greenwaymarijuana.com".
 *  4. `Vary: Origin` is ALWAYS set, so a CDN/proxy can never serve one origin's
 *     cached CORS decision to a different origin.
 *
 * PURE MODULE: no next/*, no I/O, no env reads at import time. Everything is a
 * function of its arguments so it is fully testable, per repo rule 5.
 */

/** Native origins used by Capacitor web views (documented v8 defaults). */
export const CAPACITOR_IOS_ORIGIN = "capacitor://localhost";
export const CAPACITOR_ANDROID_ORIGIN = "https://localhost";
export const CAPACITOR_LEGACY_IONIC_ORIGIN = "ionic://localhost";

/**
 * Origins the packaged register app can present. Always allowed — they are
 * fixed local scheme+host pairs that only the installed app can originate.
 */
export const NATIVE_POS_ORIGINS: readonly string[] = [
  CAPACITOR_IOS_ORIGIN,
  CAPACITOR_ANDROID_ORIGIN,
  CAPACITOR_LEGACY_IONIC_ORIGIN,
];

/** Request headers the register sends. Lower-case; browsers compare case-insensitively. */
export const POS_ALLOWED_HEADERS: readonly string[] = [
  "content-type",
  "x-pos-device-id",
  "x-pos-device-key",
];

/** Methods /api/pos/* routes expose. */
export const POS_ALLOWED_METHODS: readonly string[] = ["GET", "POST", "OPTIONS"];

/**
 * How long (seconds) a browser may cache the preflight result. 86400 = 24h,
 * the maximum Chromium honors, so the register preflights at most once a day
 * instead of before every sync.
 */
export const POS_PREFLIGHT_MAX_AGE_SECONDS = 86400;

/**
 * Normalize an Origin header for comparison.
 *
 * Origins are scheme + host + optional port and are case-insensitive in the
 * scheme/host; they must NOT carry a path. We lower-case, trim, and strip a
 * single trailing slash (some clients send "https://example.com/"). Anything
 * that still contains a path segment is rejected by the caller via exact match.
 */
export function normalizeOrigin(origin: string | null | undefined): string {
  const raw = (origin ?? "").trim();
  if (raw === "") return "";
  const lowered = raw.toLowerCase();
  return lowered.endsWith("/") ? lowered.slice(0, -1) : lowered;
}

/**
 * Build the full allowlist: the fixed native origins plus the configured
 * production site origin (so the SAME browser PWA at /pos keeps working if it
 * is ever served from a different host than the API).
 *
 * `siteUrl` is typically process.env.NEXT_PUBLIC_SITE_URL. Missing/blank is
 * FINE — it just means "no extra web origin", never a crash and never a
 * wildcard. Only the origin part of the URL is used; any path is discarded.
 */
export function buildPosAllowedOrigins(siteUrl?: string | null): string[] {
  const list = [...NATIVE_POS_ORIGINS];
  const normalized = normalizeOrigin(siteUrl);
  if (normalized !== "") {
    // Keep ONLY scheme://host[:port] — drop any path/query someone pasted in.
    const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]+)/.exec(normalized);
    const originOnly = match ? match[1] : "";
    if (originOnly !== "" && !list.includes(originOnly)) list.push(originOnly);
  }
  return list;
}

/**
 * Is this Origin allowed? EXACT match against the allowlist after
 * normalization. A missing Origin header returns false — same-origin requests
 * simply don't need CORS headers, so there is nothing to grant.
 */
export function isAllowedPosOrigin(
  origin: string | null | undefined,
  allowed: readonly string[],
): boolean {
  const candidate = normalizeOrigin(origin);
  if (candidate === "") return false;
  return allowed.some((a) => normalizeOrigin(a) === candidate);
}

/** Headers to attach to a normal (non-preflight) /api/pos/* response. */
export function posCorsHeaders(
  origin: string | null | undefined,
  allowed: readonly string[],
): Record<string, string> {
  // ALWAYS vary on Origin, even when we deny, so caches never cross-serve a
  // CORS decision made for a different origin.
  const headers: Record<string, string> = { Vary: "Origin" };
  if (!isAllowedPosOrigin(origin, allowed)) return headers;
  headers["Access-Control-Allow-Origin"] = normalizeOrigin(origin);
  return headers;
}

/**
 * Headers for an OPTIONS preflight. When the origin is allowed we answer the
 * browser's three questions: which origin, which methods, which headers.
 * When it is NOT allowed we return only `Vary`, so the browser blocks the real
 * request. We never explain why — no information leak.
 */
export function posPreflightHeaders(
  origin: string | null | undefined,
  allowed: readonly string[],
): Record<string, string> {
  const headers = posCorsHeaders(origin, allowed);
  if (!("Access-Control-Allow-Origin" in headers)) return headers;
  headers["Access-Control-Allow-Methods"] = POS_ALLOWED_METHODS.join(", ");
  headers["Access-Control-Allow-Headers"] = POS_ALLOWED_HEADERS.join(", ");
  headers["Access-Control-Max-Age"] = String(POS_PREFLIGHT_MAX_AGE_SECONDS);
  return headers;
}

/**
 * The HTTP status a preflight should get. 204 (No Content) for an allowed
 * origin; 403 for anything else. A denied preflight carries no CORS headers,
 * so the browser blocks the follow-up request regardless of status.
 */
export function posPreflightStatus(
  origin: string | null | undefined,
  allowed: readonly string[],
): number {
  return isAllowedPosOrigin(origin, allowed) ? 204 : 403;
}

// ---------------------------------------------------------------------------
// Self-tests — run in CI via scripts/compliance/run-pure-selftests.ts
// (which asserts failed === 0).
// ---------------------------------------------------------------------------
export function __runPosCorsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`FAIL pos/cors-core: ${label}`);
    }
  };

  const PROD = "https://greenwaymarijuana.com";
  const allowed = buildPosAllowedOrigins(PROD);

  // --- allowlist construction ---
  ok("iOS capacitor origin allowed", allowed.includes("capacitor://localhost"));
  ok("Android https localhost allowed", allowed.includes("https://localhost"));
  ok("legacy ionic origin allowed", allowed.includes("ionic://localhost"));
  ok("prod site origin allowed", allowed.includes(PROD));
  ok("exactly 4 origins", allowed.length === 4);
  ok("no wildcard EVER in allowlist", !allowed.includes("*"));

  // Missing/blank site URL must degrade to natives only — never crash, never wildcard.
  ok("undefined siteUrl -> 3 natives", buildPosAllowedOrigins(undefined).length === 3);
  ok("null siteUrl -> 3 natives", buildPosAllowedOrigins(null).length === 3);
  ok("blank siteUrl -> 3 natives", buildPosAllowedOrigins("   ").length === 3);
  ok("blank siteUrl has no wildcard", !buildPosAllowedOrigins("").includes("*"));

  // A pasted URL with a path must contribute only its ORIGIN.
  const withPath = buildPosAllowedOrigins("https://greenwaymarijuana.com/pos?x=1");
  ok("path stripped to origin", withPath.includes(PROD));
  ok("path never kept in allowlist", !withPath.some((o) => o.includes("/pos")));

  // Duplicate site URL must not double-register.
  ok("duplicate native not re-added", buildPosAllowedOrigins("capacitor://localhost").length === 3);

  // --- normalizeOrigin ---
  ok("normalize trims", normalizeOrigin("  https://a.com  ") === "https://a.com");
  ok("normalize lowercases", normalizeOrigin("HTTPS://A.COM") === "https://a.com");
  ok("normalize strips one trailing slash", normalizeOrigin("https://a.com/") === "https://a.com");
  ok("normalize null -> empty", normalizeOrigin(null) === "");
  ok("normalize undefined -> empty", normalizeOrigin(undefined) === "");

  // --- allow/deny decisions ---
  ok("allows iOS origin", isAllowedPosOrigin("capacitor://localhost", allowed));
  ok("allows prod origin", isAllowedPosOrigin(PROD, allowed));
  ok("allows prod with trailing slash", isAllowedPosOrigin(`${PROD}/`, allowed));
  ok("allows case-insensitive host", isAllowedPosOrigin("HTTPS://GREENWAYMARIJUANA.COM", allowed));
  ok("missing origin denied", !isAllowedPosOrigin(null, allowed));
  ok("empty origin denied", !isAllowedPosOrigin("", allowed));
  ok("literal 'null' origin denied", !isAllowedPosOrigin("null", allowed));

  // --- ATTACK CASES: these are the whole point of an exact-match allowlist ---
  ok("suffix attack denied", !isAllowedPosOrigin("https://greenwaymarijuana.com.evil.com", allowed));
  ok("prefix attack denied", !isAllowedPosOrigin("https://evil-greenwaymarijuana.com", allowed));
  ok("subdomain attack denied", !isAllowedPosOrigin("https://evil.greenwaymarijuana.com", allowed));
  ok("http downgrade denied", !isAllowedPosOrigin("http://greenwaymarijuana.com", allowed));
  ok("port mismatch denied", !isAllowedPosOrigin("https://greenwaymarijuana.com:8443", allowed));
  ok("evil localhost scheme denied", !isAllowedPosOrigin("evil://localhost", allowed));
  ok("http localhost denied", !isAllowedPosOrigin("http://localhost", allowed));
  ok("wildcard string denied", !isAllowedPosOrigin("*", allowed));
  ok("embedded-substring attack denied", !isAllowedPosOrigin("https://x.com#https://localhost", allowed));

  // --- response headers ---
  const good = posCorsHeaders(PROD, allowed);
  ok("allowed -> echoes exact origin", good["Access-Control-Allow-Origin"] === PROD);
  ok("allowed -> sets Vary: Origin", good["Vary"] === "Origin");
  ok("allowed -> never sends credentials", !("Access-Control-Allow-Credentials" in good));
  ok("allowed -> never wildcard", good["Access-Control-Allow-Origin"] !== "*");

  const bad = posCorsHeaders("https://evil.com", allowed);
  ok("denied -> no allow-origin header", !("Access-Control-Allow-Origin" in bad));
  ok("denied -> STILL sets Vary", bad["Vary"] === "Origin");

  const none = posCorsHeaders(null, allowed);
  ok("no origin -> no allow-origin header", !("Access-Control-Allow-Origin" in none));
  ok("no origin -> still Vary", none["Vary"] === "Origin");

  // --- preflight ---
  const pre = posPreflightHeaders(CAPACITOR_IOS_ORIGIN, allowed);
  ok("preflight echoes origin", pre["Access-Control-Allow-Origin"] === CAPACITOR_IOS_ORIGIN);
  ok("preflight lists POST", (pre["Access-Control-Allow-Methods"] ?? "").includes("POST"));
  ok("preflight lists GET", (pre["Access-Control-Allow-Methods"] ?? "").includes("GET"));
  ok("preflight lists OPTIONS", (pre["Access-Control-Allow-Methods"] ?? "").includes("OPTIONS"));
  ok("preflight allows device id header", (pre["Access-Control-Allow-Headers"] ?? "").includes("x-pos-device-id"));
  ok("preflight allows device key header", (pre["Access-Control-Allow-Headers"] ?? "").includes("x-pos-device-key"));
  ok("preflight allows content-type", (pre["Access-Control-Allow-Headers"] ?? "").includes("content-type"));
  ok("preflight max-age is 24h", pre["Access-Control-Max-Age"] === "86400");
  ok("preflight never sends credentials", !("Access-Control-Allow-Credentials" in pre));

  const preBad = posPreflightHeaders("https://evil.com", allowed);
  ok("denied preflight -> no methods leaked", !("Access-Control-Allow-Methods" in preBad));
  ok("denied preflight -> no headers leaked", !("Access-Control-Allow-Headers" in preBad));
  ok("denied preflight -> no allow-origin", !("Access-Control-Allow-Origin" in preBad));

  ok("allowed preflight status 204", posPreflightStatus(PROD, allowed) === 204);
  ok("denied preflight status 403", posPreflightStatus("https://evil.com", allowed) === 403);
  ok("missing-origin preflight status 403", posPreflightStatus(null, allowed) === 403);

  // --- policy pins (changing these must be a deliberate decision) ---
  ok("methods are exactly GET/POST/OPTIONS", POS_ALLOWED_METHODS.join(",") === "GET,POST,OPTIONS");
  ok("device headers are in the allowlist", POS_ALLOWED_HEADERS.includes("x-pos-device-key"));
  ok("no authorization header expected", !POS_ALLOWED_HEADERS.includes("authorization"));

  console.log(`pos/cors-core self-tests: ${passed} passed, ${failed} failed`);
  if (failed > 0 && typeof process !== "undefined") process.exitCode = 1;
  return { passed, failed };
}
