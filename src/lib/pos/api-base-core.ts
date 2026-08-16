/**
 * pos/api-base-core — the ONE place that decides what URL the register calls.
 *
 * WHY THIS EXISTS
 * Today every register request is a RELATIVE path like "/api/pos/sync". In a
 * browser that is perfect: the path resolves against the page's own origin
 * (https://greenwaymarijuana.com/api/pos/sync) and always hits our server.
 *
 * Inside the packaged iPad app ("Greenway Point of Transaction") the very same
 * string resolves against the app's LOCAL origin — capacitor://localhost — so
 * "/api/pos/sync" becomes "capacitor://localhost/api/pos/sync", which is a
 * file inside the app bundle that does not exist. Every call would fail. The
 * register would boot and then be unable to unlock, sync, or ring a sale.
 *
 * So the native build must prefix an ABSOLUTE server base, while the browser
 * PWA must keep using relative paths (changing it there would be a pointless
 * cross-origin hop and would break same-origin cookies/caching).
 *
 * THE RULE THIS MODULE ENCODES
 *   base "" (default, browser)  -> "/api/pos/sync"                    (relative)
 *   base "https://site.com"     -> "https://site.com/api/pos/sync"    (absolute)
 *
 * DESIGN LAWS (deliberate, and each one is tested below)
 *  1. DEFAULT SAFE. No configuration = today's exact behavior, byte for byte.
 *     The web PWA cannot regress because someone forgot to set a variable.
 *  2. HTTPS ONLY (except localhost). A POS carries customer PII and device
 *     keys. An http:// base would put that on the wire in cleartext, so it is
 *     REFUSED, not silently accepted. localhost is exempt so a developer can
 *     point a simulator at a laptop.
 *  3. NO TRAILING SLASH, EXACTLY ONE JOINING SLASH. "https://a.com/" + "/x"
 *     must be "https://a.com/x", never "https://a.com//x" (which some CDNs and
 *     WAFs treat as a different, uncached path).
 *  4. PATHS STAY ABSOLUTE. We only ever prefix a base; we never rewrite,
 *     re-encode, or reorder the caller's path or query string. Query strings
 *     already contain encodeURIComponent output and must pass through untouched.
 *  5. FAIL LOUD IN CONFIG, NEVER AT THE COUNTER. A malformed base is rejected
 *     when it is resolved (startup), with a plain-English reason — it never
 *     produces a half-broken URL that fails mysteriously mid-sale.
 *
 * PURE MODULE: no next/*, no I/O, no import-time env reads. Everything is a
 * function of its arguments, so it is fully testable (repo rule 5).
 */

/** Result of validating a configured API base. */
export type ApiBaseResult =
  | { ok: true; base: string }
  | { ok: false; base: ""; error: string };

/**
 * Normalize a configured base URL.
 *
 * Accepts "" / null / undefined and returns the SAME-ORIGIN default (""), which
 * is what the browser PWA uses. Anything non-empty must be a valid, secure,
 * origin-only https URL.
 */
export function resolveApiBase(raw: string | null | undefined): ApiBaseResult {
  const value = (raw ?? "").trim();

  // Law 1: no configuration = today's behavior (relative, same-origin).
  if (value === "") return { ok: true, base: "" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      base: "",
      error:
        "The register's server address isn't a valid web address. It should look like https://greenwaymarijuana.com (no path, no trailing slash).",
    };
  }

  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";

  // Law 2: https only (localhost exempt for simulator/dev work).
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
    return {
      ok: false,
      base: "",
      error:
        "The register's server address must start with https:// so customer and device information is encrypted in transit.",
    };
  }

  // Origin-only: a base carrying a path/query/hash would silently corrupt every
  // request built from it (e.g. base ".../pos" + "/api/pos/sync").
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    return {
      ok: false,
      base: "",
      error:
        "The register's server address must be just the site address (like https://greenwaymarijuana.com) with no page, folder, or question mark after it.",
    };
  }

  // Law 3: store without a trailing slash so joining is unambiguous.
  return { ok: true, base: url.origin };
}

/**
 * Build the final request URL.
 *
 * `path` is always an app-absolute path beginning with "/" (e.g. "/api/pos/sync"
 * or "/api/pos/member?q=abc"). With an empty base the path is returned
 * unchanged — identical to the code that exists today.
 */
export function buildApiUrl(base: string, path: string): string {
  const b = (base ?? "").replace(/\/+$/, "");
  const p = (path ?? "").trim();

  // Law 4: never rewrite the caller's path; only guarantee the leading slash.
  const normalizedPath = p.startsWith("/") ? p : `/${p}`;

  if (b === "") return normalizedPath;
  return `${b}${normalizedPath}`;
}

/**
 * True when the register is talking to a DIFFERENT origin than the page it is
 * running on — i.e. the packaged native app. Callers use this only for
 * diagnostics/telemetry; request building never branches on it.
 */
export function isCrossOriginApi(base: string): boolean {
  return (base ?? "").trim() !== "";
}

/**
 * Plain-English description of where the register is sending its traffic, for
 * the status footer / device diagnostics screen.
 */
export function describeApiBase(base: string): string {
  const b = (base ?? "").trim();
  if (b === "") return "This device talks to the same website it was opened from.";
  return `This device sends register traffic to ${b}.`;
}

// ---------------------------------------------------------------------------
// Self-tests — run in CI via scripts/compliance/run-pure-selftests.ts
// (which asserts failed === 0).
// ---------------------------------------------------------------------------
export function __runPosApiBaseCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`FAIL pos/api-base-core: ${label}`);
    }
  };

  const PROD = "https://greenwaymarijuana.com";

  // --- Law 1: default safe (this is the web-PWA no-regression guarantee) ---
  ok("empty string -> same-origin", resolveApiBase("").ok && resolveApiBase("").base === "");
  ok("null -> same-origin", resolveApiBase(null).base === "");
  ok("undefined -> same-origin", resolveApiBase(undefined).base === "");
  ok("whitespace -> same-origin", resolveApiBase("   ").base === "");
  ok("empty base keeps path EXACTLY as today", buildApiUrl("", "/api/pos/sync") === "/api/pos/sync");
  ok(
    "empty base keeps query EXACTLY as today",
    buildApiUrl("", "/api/pos/member?q=a%20b") === "/api/pos/member?q=a%20b",
  );

  // --- valid absolute bases ---
  const prod = resolveApiBase(PROD);
  ok("valid https accepted", prod.ok && prod.base === PROD);
  ok("trailing slash stripped", resolveApiBase(`${PROD}/`).base === PROD);
  ok("uppercase host normalized", resolveApiBase("HTTPS://GREENWAYMARIJUANA.COM").base === PROD);
  ok("port preserved", resolveApiBase("https://example.com:8443").base === "https://example.com:8443");
  ok("http localhost allowed (dev)", resolveApiBase("http://localhost:3000").ok);
  ok("http 127.0.0.1 allowed (dev)", resolveApiBase("http://127.0.0.1:3000").ok);

  // --- Law 2: refuse insecure ---
  const insecure = resolveApiBase("http://greenwaymarijuana.com");
  ok("http public host REFUSED", !insecure.ok);
  ok("http refusal falls back to same-origin", insecure.base === "");
  ok("http refusal explains why in plain English", insecure.ok === false && insecure.error.includes("https://"));
  ok("ftp refused", !resolveApiBase("ftp://greenwaymarijuana.com").ok);
  ok("javascript: refused", !resolveApiBase("javascript:alert(1)").ok);
  ok("data: refused", !resolveApiBase("data:text/html,x").ok);
  ok("file: refused", !resolveApiBase("file:///etc/passwd").ok);

  // --- malformed input ---
  ok("garbage refused", !resolveApiBase("not a url").ok);
  ok("bare host refused (no scheme)", !resolveApiBase("greenwaymarijuana.com").ok);
  ok("scheme-relative refused", !resolveApiBase("//greenwaymarijuana.com").ok);
  const malformed = resolveApiBase("not a url");
  ok("malformed refusal is plain English", !malformed.ok && malformed.error.length > 20);

  // --- origin-only enforcement ---
  ok("path in base refused", !resolveApiBase(`${PROD}/pos`).ok);
  ok("query in base refused", !resolveApiBase(`${PROD}/?x=1`).ok);
  ok("hash in base refused", !resolveApiBase(`${PROD}/#x`).ok);
  ok("deep path refused", !resolveApiBase(`${PROD}/a/b/c`).ok);

  // --- Law 3: exactly one joining slash ---
  ok("join base+path", buildApiUrl(PROD, "/api/pos/sync") === `${PROD}/api/pos/sync`);
  ok("base with trailing slash never doubles", buildApiUrl(`${PROD}/`, "/api/pos/sync") === `${PROD}/api/pos/sync`);
  ok("many trailing slashes collapse", buildApiUrl(`${PROD}///`, "/api/pos/sync") === `${PROD}/api/pos/sync`);
  ok("no double slash anywhere", !buildApiUrl(`${PROD}/`, "/api/pos/sync").includes(".com//"));
  ok("path missing leading slash is fixed", buildApiUrl(PROD, "api/pos/sync") === `${PROD}/api/pos/sync`);

  // --- Law 4: query strings pass through byte-for-byte ---
  const encoded = "/api/pos/member?q=" + encodeURIComponent("Smith & Sons, #4");
  ok("encoded query preserved (absolute)", buildApiUrl(PROD, encoded) === `${PROD}${encoded}`);
  ok("encoded query preserved (relative)", buildApiUrl("", encoded) === encoded);
  ok("percent encoding untouched", buildApiUrl(PROD, "/api/pos/x?a=%20%26").endsWith("?a=%20%26"));
  ok("plus sign untouched", buildApiUrl(PROD, "/api/pos/x?a=b+c").endsWith("?a=b+c"));
  ok("multiple params untouched", buildApiUrl(PROD, "/api/pos/x?a=1&b=2").endsWith("?a=1&b=2"));

  // --- every real register endpoint round-trips correctly ---
  const endpoints = [
    "/api/pos/sync", "/api/pos/unlock", "/api/pos/menu", "/api/pos/till",
    "/api/pos/void", "/api/pos/returns", "/api/pos/witness", "/api/pos/approve",
    "/api/pos/loyalty", "/api/pos/pickup", "/api/pos/day-report", "/api/pos/version",
    "/api/pos/leaderboard", "/api/pos/stock-flag", "/api/pos/email-receipt",
    "/api/pos/member", "/api/pos/member-match", "/api/pos/member-history",
    "/api/pos/product-image",
  ];
  let allRelativeMatch = true;
  let allAbsoluteMatch = true;
  for (const e of endpoints) {
    if (buildApiUrl("", e) !== e) allRelativeMatch = false;
    if (buildApiUrl(PROD, e) !== `${PROD}${e}`) allAbsoluteMatch = false;
  }
  ok("all 19 endpoints unchanged when base is empty", allRelativeMatch);
  ok("all 19 endpoints prefixed when base is set", allAbsoluteMatch);

  // --- resulting URLs must be parseable and point at the intended host ---
  const built = buildApiUrl(PROD, "/api/pos/sync");
  ok("built absolute URL parses", (() => { try { return new URL(built).host === "greenwaymarijuana.com"; } catch { return false; } })());
  ok("built absolute URL keeps https", built.startsWith("https://"));

  // --- helpers ---
  ok("isCrossOriginApi false when empty", !isCrossOriginApi(""));
  ok("isCrossOriginApi true when set", isCrossOriginApi(PROD));
  ok("describe empty mentions same website", describeApiBase("").toLowerCase().includes("same website"));
  ok("describe set mentions the host", describeApiBase(PROD).includes(PROD));

  console.log(`pos/api-base-core self-tests: ${passed} passed, ${failed} failed`);
  if (failed > 0 && typeof process !== "undefined") process.exitCode = 1;
  return { passed, failed };
}
