/**
 * pos/register-host-core — the ONE place that decides how the packaged
 * register app boots.
 *
 * WHY THIS EXISTS
 * The same RegisterShell runs in two very different places:
 *
 *   1. The browser PWA at https://greenwaymarijuana.com/pos. The page is
 *      SERVED BY our server, so a relative path like "/api/pos/sync" already
 *      resolves to the right place. No configuration is needed or wanted.
 *
 *   2. The packaged iPad app "Greenway Point of Transaction". Here the HTML,
 *      JS and CSS are files INSIDE the app bundle, served by the native web
 *      view from its own local origin — capacitor://localhost on iOS,
 *      https://localhost on Android. There is no server behind that origin.
 *      A relative "/api/pos/sync" resolves to capacitor://localhost/api/pos/sync,
 *      a file that does not exist. EVERY call fails.
 *
 * So the packaged build MUST be given an absolute https base, and the browser
 * build MUST NOT be. Getting that wrong in either direction breaks the till.
 *
 * THE FAILURE THIS MODULE EXISTS TO PREVENT
 * If someone builds the iPad app without setting the server address, the app
 * still installs, still launches, still shows the Greenway wordmark — and then
 * fails on every single request. A budtender would discover that with a
 * customer at the counter and a queue behind them. Worse, a register that
 * cannot reach the server cannot record the sale, and a sale that is not
 * recorded is a traceability gap.
 *
 * Therefore: a packaged build with no server address is a FATAL, LOUD,
 * BOOT-TIME error with a plain-English explanation — not a register that looks
 * fine and silently cannot work. Fail in the workshop, never at the counter.
 *
 * PLATFORM DETECTION IS OBSERVED, NOT DECLARED
 * We do not trust a build flag to tell us "this is the native app" — a flag
 * can be forgotten, and the whole point is to catch the case where someone
 * forgot something. Instead we look at the origin the code is ACTUALLY running
 * on, which the web view sets and the build cannot lie about.
 *
 * Capacitor's documented default schemes (Capacitor v8):
 *   iOS      server.iosScheme     default "capacitor"  -> capacitor://localhost
 *   Android  server.androidScheme default "https"      -> https://localhost
 *
 * PURE MODULE: no next/*, no I/O, no import-time env reads, no window access.
 * Everything is a function of its arguments (repo rule 5), so every branch
 * below is testable and is tested.
 */

import { resolveApiBase } from "./api-base-core";
import { DEV_SW_VERSION, sanitizeSwVersion } from "./sw-core";

/** Where the register code is actually running. */
export type RegisterPlatform = "web" | "native";

/** Raw, untrusted build-time configuration (injected by the Vite build). */
export type RegisterHostInput = {
  apiBase?: unknown;
  buildVersion?: unknown;
};

/** The location facts we need, passed in so this stays pure. */
export type RegisterLocation = {
  protocol?: unknown;
  hostname?: unknown;
  port?: unknown;
};

/** Resolved boot configuration, or a fatal reason not to boot at all. */
export type RegisterHostConfig =
  | {
      ok: true;
      platform: RegisterPlatform;
      apiBase: string;
      buildVersion: string;
      /** Plain-English description for the diagnostics screen. */
      description: string;
    }
  | {
      ok: false;
      platform: RegisterPlatform;
      /** Plain-English reason, safe to show on screen. */
      error: string;
    };

/**
 * Is this origin the native web view rather than a real web server?
 *
 * Deliberately CONSERVATIVE. "web" is the safe default: guessing "web" when we
 * are actually native produces a loud broken-request failure in testing, while
 * guessing "native" when we are actually web would demand an absolute base the
 * browser PWA must never use. So only the two documented Capacitor origins
 * count as native.
 *
 * Note the port check on the Android case: a local dev server is
 * http://localhost:5173, and https://localhost:5173 could be a local test
 * server too. Only the PORTLESS https://localhost is Capacitor's origin.
 */
export function detectRegisterPlatform(loc: RegisterLocation): RegisterPlatform {
  const protocol = typeof loc.protocol === "string" ? loc.protocol.toLowerCase() : "";
  const hostname = typeof loc.hostname === "string" ? loc.hostname.toLowerCase() : "";
  const port = typeof loc.port === "string" ? loc.port : "";

  // iOS: capacitor://localhost — the scheme alone is unambiguous.
  if (protocol === "capacitor:") return "native";

  // Android: https://localhost with NO port.
  if (protocol === "https:" && hostname === "localhost" && port === "") return "native";

  return "web";
}

/**
 * Should this copy of the register install the /pos service worker?
 *
 * On the website: YES. The worker is what lets the browser PWA boot with no
 * signal, and it is served per-deploy by /pos-sw.js/route.ts so the register
 * can notice a new build and offer "Update available".
 *
 * In the packaged app: NO, and this matters more than it looks.
 *
 *  - /pos-sw.js is a Next.js ROUTE, not a file. It does not exist inside the
 *    app bundle, so the request 404s on every single launch — noise in the
 *    logs that hides real faults.
 *  - On Android the app is served from https://localhost, which browsers treat
 *    as a secure origin, so a worker registered there WOULD install and would
 *    start caching the app shell. The App Store is what updates this app. A
 *    service-worker cache sitting in front of it could serve yesterday's
 *    register after an update was installed — a register running code the
 *    owner believes was replaced. For a till that prices sales and enforces
 *    purchase limits, that is not acceptable.
 *  - The "Update available" banner is meaningless here for the same reason:
 *    updates arrive through the App Store, not through a waiting worker.
 *
 * So the packaged build skips service-worker registration entirely and relies
 * on the native web view's own asset loading, which reads the bundle straight
 * off the device and is already fully offline.
 */
export function shouldRegisterServiceWorker(loc: RegisterLocation): boolean {
  return detectRegisterPlatform(loc) === "web";
}

/**
 * Resolve the register's boot configuration.
 *
 * `raw` is whatever the build injected (possibly nothing at all). `loc` is the
 * observed origin. The rules, each one tested below:
 *
 *  1. NATIVE + no server address            -> FATAL. Explain how to fix it.
 *  2. NATIVE + rejected server address      -> FATAL. Never silently fall back
 *     to same-origin, because same-origin in the app is a dead end.
 *  3. WEB + no server address               -> fine, same-origin (today's PWA).
 *  4. WEB + a valid absolute address        -> allowed (useful for staging),
 *     but it is a deliberate choice, so it is reported in the description.
 *  5. WEB + a rejected address              -> NOT fatal: the browser PWA can
 *     always fall back to same-origin and still work perfectly. Degrade, note
 *     it, keep selling.
 *  6. Build version is always sanitized and never fatal.
 */
export function resolveRegisterHostConfig(
  raw: RegisterHostInput | null | undefined,
  loc: RegisterLocation,
): RegisterHostConfig {
  const platform = detectRegisterPlatform(loc);
  const input = raw ?? {};

  const rawBase = typeof input.apiBase === "string" ? input.apiBase.trim() : "";
  const buildVersion =
    input.buildVersion === undefined || input.buildVersion === null
      ? DEV_SW_VERSION
      : sanitizeSwVersion(input.buildVersion);

  if (platform === "native") {
    // Rule 1 — the misconfiguration that would break every sale.
    if (rawBase === "") {
      return {
        ok: false,
        platform,
        error:
          "This copy of the register app was built without a server address, so it cannot reach Greenway. " +
          "Rebuild the app with the server address set (REGISTER_API_BASE=https://greenwaywebsite1.vercel.app) " +
          "and install it again. Nothing is wrong with this iPad.",
      };
    }

    // Rule 2 — a bad address is fatal here; there is no working fallback.
    const resolved = resolveApiBase(rawBase);
    if (!resolved.ok) {
      return {
        ok: false,
        platform,
        error:
          "This copy of the register app was built with an unusable server address. " +
          resolved.error +
          " Rebuild the app with a corrected address and install it again.",
      };
    }

    return {
      ok: true,
      platform,
      apiBase: resolved.base,
      buildVersion,
      description: `Packaged app — sending register traffic to ${resolved.base}.`,
    };
  }

  // ── web ──────────────────────────────────────────────────────────────────
  // Rule 3 — the overwhelmingly common case: the PWA, unchanged.
  if (rawBase === "") {
    return {
      ok: true,
      platform,
      apiBase: "",
      buildVersion,
      description: "Browser register — sending register traffic to this same website.",
    };
  }

  const resolved = resolveApiBase(rawBase);
  // Rule 5 — degrade, never die, in the browser.
  if (!resolved.ok) {
    return {
      ok: true,
      platform,
      apiBase: "",
      buildVersion,
      description:
        "Browser register — the configured server address was refused, so register traffic is going to " +
        "this same website instead. " +
        resolved.error,
    };
  }

  // Rule 4 — deliberate cross-origin browser build (staging).
  return {
    ok: true,
    platform,
    apiBase: resolved.base,
    buildVersion,
    description: `Browser register — sending register traffic to ${resolved.base}.`,
  };
}

/* -------------------------------------------------------------------------
 * Embedded pure self-tests (repo rule 5). Run by
 * scripts/compliance/run-pure-selftests.ts and mirrored in vitest.
 * ---------------------------------------------------------------------- */
export function __runRegisterHostCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`register-host-core FAIL: ${label}`);
    }
  };

  const WEB = { protocol: "https:", hostname: "greenwaymarijuana.com", port: "" };
  const IOS = { protocol: "capacitor:", hostname: "localhost", port: "" };
  const ANDROID = { protocol: "https:", hostname: "localhost", port: "" };
  const PROD = "https://greenwaymarijuana.com";

  // ── detectRegisterPlatform ───────────────────────────────────────────────
  ok(detectRegisterPlatform(IOS) === "native", "capacitor: scheme is native");
  ok(detectRegisterPlatform(ANDROID) === "native", "portless https://localhost is native");
  ok(detectRegisterPlatform(WEB) === "web", "real https site is web");
  ok(
    detectRegisterPlatform({ protocol: "http:", hostname: "localhost", port: "3000" }) === "web",
    "next dev server is web",
  );
  ok(
    detectRegisterPlatform({ protocol: "http:", hostname: "localhost", port: "5173" }) === "web",
    "vite dev server is web",
  );
  ok(
    detectRegisterPlatform({ protocol: "https:", hostname: "localhost", port: "5173" }) === "web",
    "https://localhost WITH a port is a dev server, not Capacitor",
  );
  ok(
    detectRegisterPlatform({ protocol: "CAPACITOR:", hostname: "LOCALHOST", port: "" }) === "native",
    "scheme/host detection is case-insensitive",
  );
  // Junk must never be mistaken for native (that would demand config the web
  // build must not have).
  ok(detectRegisterPlatform({}) === "web", "empty location degrades to web");
  ok(
    detectRegisterPlatform({ protocol: 123, hostname: null, port: {} }) === "web",
    "non-string location fields degrade to web",
  );
  ok(
    detectRegisterPlatform({ protocol: "https:", hostname: "localhost.evil.com", port: "" }) === "web",
    "lookalike hostname is not native",
  );
  ok(
    detectRegisterPlatform({ protocol: "file:", hostname: "", port: "" }) === "web",
    "file: is not treated as native",
  );

  // ── shouldRegisterServiceWorker ──────────────────────────────────────────
  ok(shouldRegisterServiceWorker(WEB) === true, "browser PWA still registers its worker");
  ok(
    shouldRegisterServiceWorker({ protocol: "http:", hostname: "localhost", port: "3000" }) === true,
    "next dev still registers its worker",
  );
  ok(shouldRegisterServiceWorker(IOS) === false, "packaged iOS app never registers a worker");
  ok(shouldRegisterServiceWorker(ANDROID) === false, "packaged Android app never registers a worker");

  // ── NATIVE: missing base is fatal ────────────────────────────────────────
  for (const loc of [IOS, ANDROID]) {
    const r = resolveRegisterHostConfig({}, loc);
    ok(!r.ok, "native with no base is fatal");
    ok(r.platform === "native", "native platform reported on the fatal result");
    if (!r.ok) {
      ok(r.error.includes("REGISTER_API_BASE"), "fatal error names the variable to set");
      ok(r.error.includes("Nothing is wrong with this iPad"), "fatal error reassures the user");
    }
  }
  ok(!resolveRegisterHostConfig(null, IOS).ok, "native with null config is fatal");
  ok(!resolveRegisterHostConfig(undefined, IOS).ok, "native with undefined config is fatal");
  ok(!resolveRegisterHostConfig({ apiBase: "" }, IOS).ok, "native with empty base is fatal");
  ok(!resolveRegisterHostConfig({ apiBase: "   " }, IOS).ok, "native with blank base is fatal");
  ok(!resolveRegisterHostConfig({ apiBase: 42 }, IOS).ok, "native with non-string base is fatal");

  // ── NATIVE: bad base is fatal, NEVER a silent same-origin fallback ───────
  for (const bad of [
    "http://greenwaymarijuana.com",
    "not a url",
    "ftp://greenwaymarijuana.com",
    `${PROD}/pos`,
    "//greenwaymarijuana.com",
    "javascript:alert(1)",
  ]) {
    const r = resolveRegisterHostConfig({ apiBase: bad }, IOS);
    ok(!r.ok, `native rejects bad base ${bad}`);
    // The critical property: a fatal result carries NO apiBase field at all,
    // so there is no way for a caller to accidentally boot with "".
    ok(!("apiBase" in r), `native fatal result exposes no apiBase for ${bad}`);
  }

  // ── NATIVE: good base boots ──────────────────────────────────────────────
  {
    const r = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "abc1234" }, IOS);
    ok(r.ok, "native with a good base boots");
    if (r.ok) {
      ok(r.apiBase === PROD, "native carries the absolute base");
      ok(r.buildVersion === "abc1234", "native carries the build version");
      ok(r.description.includes(PROD), "native description names the destination");
    }
  }
  {
    // Trailing slash normalized by api-base-core; must survive the seam.
    const r = resolveRegisterHostConfig({ apiBase: `${PROD}/` }, ANDROID);
    ok(r.ok && r.apiBase === PROD, "native normalizes a trailing slash");
  }
  {
    const r = resolveRegisterHostConfig({ apiBase: "http://localhost:3000" }, IOS);
    ok(r.ok, "native allows http://localhost for simulator development");
  }

  // ── WEB: no base = today's PWA, byte for byte ────────────────────────────
  {
    const r = resolveRegisterHostConfig({}, WEB);
    ok(r.ok, "web with no base boots");
    if (r.ok) {
      ok(r.apiBase === "", "web with no base stays same-origin");
      ok(r.description.toLowerCase().includes("same website"), "web description says same website");
    }
  }
  ok(resolveRegisterHostConfig(null, WEB).ok, "web with null config boots");
  ok(resolveRegisterHostConfig(undefined, WEB).ok, "web with undefined config boots");

  // ── WEB: bad base degrades, never dies ───────────────────────────────────
  for (const bad of ["http://greenwaymarijuana.com", "not a url", `${PROD}/pos`]) {
    const r = resolveRegisterHostConfig({ apiBase: bad }, WEB);
    ok(r.ok, `web degrades rather than dying on ${bad}`);
    if (r.ok) ok(r.apiBase === "", `web falls back to same-origin on ${bad}`);
  }

  // ── WEB: deliberate absolute base is allowed ─────────────────────────────
  {
    const r = resolveRegisterHostConfig({ apiBase: PROD }, WEB);
    ok(r.ok && r.apiBase === PROD, "web allows a deliberate absolute base");
  }

  // ── build version handling (never fatal) ─────────────────────────────────
  {
    const r = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "AB!!cd" }, IOS);
    ok(r.ok && r.buildVersion === "abcd", "build version is sanitized");
  }
  {
    const r = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "" }, IOS);
    ok(r.ok && r.buildVersion === DEV_SW_VERSION, "empty build version degrades to dev");
  }
  {
    const r = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: 999 }, IOS);
    ok(r.ok && r.buildVersion === DEV_SW_VERSION, "non-string build version degrades to dev");
  }
  {
    const r = resolveRegisterHostConfig({ apiBase: PROD }, IOS);
    ok(r.ok && r.buildVersion === DEV_SW_VERSION, "missing build version degrades to dev");
  }
  {
    const r = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "0123456789abcdef" }, IOS);
    ok(r.ok && r.buildVersion.length <= 12, "long build version is truncated, never fatal");
  }

  // ── determinism: same inputs, same result ────────────────────────────────
  {
    const a = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "abc1234" }, IOS);
    const b = resolveRegisterHostConfig({ apiBase: PROD, buildVersion: "abc1234" }, IOS);
    ok(JSON.stringify(a) === JSON.stringify(b), "resolution is deterministic");
  }

  return { passed, failed };
}
