/**
 * POS Slice AN-0 — versioned register service worker (pure core).
 *
 * The installed Home-Screen register app had NO update path: public/pos-sw.js
 * used fixed "-v1" cache names, called skipWaiting() unconditionally on
 * install (an update could activate under a cashier MID-SALE), and the shell
 * had no update UI — the owner's "I can't see the new front end" pain.
 *
 * AN-0 fixes all three (verified against the previous worker, not guessed):
 *  - Cache names carry the BUILD VERSION (the Vercel commit SHA), so every
 *    deploy produces a byte-different worker → the browser detects the update.
 *  - The new worker NEVER auto-activates over a controlled page: it waits
 *    until the register posts {type:"SKIP_WAITING"} — which RegisterShell only
 *    does from the home-screen banner, never during a sale.
 *  - The worker is now SERVED by a route (src/app/pos-sw.js/route.ts) that
 *    injects the version at build time; the static public/ copy is gone.
 *
 * Pure: no I/O, no React — this module only BUILDS the worker source string.
 * Self-tested below (registered in scripts/compliance/run-pure-selftests.ts)
 * and mirrored in vitest.
 */

/** Fallback version when no build id is available (local dev). */
export const DEV_SW_VERSION = "dev";

/**
 * Sanitize an untrusted build-id into a safe cache-name fragment: lowercase
 * alphanumerics/dashes only, max 12 chars (a short SHA is 7). Anything that
 * sanitizes to empty (null, "", punctuation) degrades to "dev" — a bad env
 * var can never produce a malformed cache name.
 */
export function sanitizeSwVersion(raw: unknown): string {
  if (typeof raw !== "string") return DEV_SW_VERSION;
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 12);
  return cleaned.length > 0 ? cleaned : DEV_SW_VERSION;
}

/**
 * Resolve the build version from the environment. Vercel exposes the commit
 * SHA at build time when system env vars are enabled (the default); local
 * dev has neither and degrades to "dev". A 7-char short SHA is plenty to
 * distinguish deploys.
 */
export function resolveBuildVersion(env: Record<string, string | undefined>): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  if (typeof sha === "string" && sha.length > 0) return sanitizeSwVersion(sha.slice(0, 7));
  return DEV_SW_VERSION;
}

/** The versioned cache names the worker will use. */
export function posSwCacheNames(version: string): { shell: string; assets: string } {
  const v = sanitizeSwVersion(version);
  return { shell: `gw-pos-shell-${v}`, assets: `gw-pos-assets-${v}` };
}

/** Every register cache this worker family owns starts with this prefix. */
export const POS_CACHE_PREFIX = "gw-pos-";

/**
 * AN-1 — is this Cache Storage name one of ours? Used by the register's
 * "Force refresh" to delete ONLY gw-pos-* caches (the admin push worker and
 * anything else on the origin is never touched).
 */
export function isPosCacheName(name: unknown): boolean {
  return typeof name === "string" && name.startsWith(POS_CACHE_PREFIX);
}

/**
 * AN-1 — is the RUNNING register build stale relative to the server's current
 * deploy? Compares sanitized versions; "dev" on EITHER side is never stale
 * (local dev has no deploy identity, and a failed/garbage fetch must never
 * trigger refresh loops).
 */
export function isBuildStale(
  clientVersion: string | null | undefined,
  serverVersion: string | null | undefined,
): boolean {
  const client = sanitizeSwVersion(clientVersion);
  const server = sanitizeSwVersion(serverVersion);
  if (client === DEV_SW_VERSION || server === DEV_SW_VERSION) return false;
  return client !== server;
}

/**
 * AN-1 — may a parked (waiting) worker be activated automatically right now?
 * ONLY on the lock screen: locked means no cashier is mid-sale, so the reload
 * that follows activation can never eat a cart. (A held sale is parked in
 * localStorage and survives the reload by design — B17.) Every other screen
 * keeps the AN-0 rule: activation only via the explicit home-screen banner.
 */
export function shouldAutoApplyUpdate(screen: unknown, hasWaitingWorker: boolean): boolean {
  return hasWaitingWorker && screen === "locked";
}

/**
 * Build the full service-worker source for a given build version.
 *
 * Behavior preserved from the B11 worker (verified line-by-line):
 *  - "/pos" HTML: network-first, cache fallback (offline boot).
 *  - /_next/static/* + /pos/* assets: cache-first.
 *  - /api/* and cross-origin requests are NEVER intercepted — sync semantics
 *    stay exactly as built.
 *  - activate deletes every gw-pos-* cache that isn't this version's pair.
 *
 * Behavior CHANGED for AN-0:
 *  - install no longer calls skipWaiting() — an updated worker WAITS until
 *    the register explicitly posts {type:"SKIP_WAITING"} (home screen only).
 */
export function buildPosServiceWorkerSource(version: string): string {
  const names = posSwCacheNames(version);
  return `/**
 * Greenway register service worker — built by src/lib/pos/sw-core.ts (AN-0).
 * Version: ${sanitizeSwVersion(version)}
 */

const SHELL_CACHE = ${JSON.stringify(names.shell)};
const ASSET_CACHE = ${JSON.stringify(names.assets)};

self.addEventListener("install", (event) => {
  // AN-0: no auto-activation here — the updated worker waits until the
  // register asks (home-screen banner), so an update can never land mid-sale.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.add("/pos")).catch(() => {}));
});

self.addEventListener("message", (event) => {
  // AN-0: the register's "Update available" banner posts this to activate
  // the waiting worker; RegisterShell reloads on the controllerchange that
  // follows.
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API traffic — sync/menu/unlock behave exactly as built.
  if (url.pathname.startsWith("/api/")) return;

  // The register shell: network-first with cache fallback (offline boot).
  if (url.pathname === "/pos" || url.pathname === "/pos/") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put("/pos", copy));
          }
          return res;
        })
        .catch(() => caches.match("/pos")),
    );
    return;
  }

  // Content-hashed build assets + register icons: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pos/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
`;
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runSwCoreTests(): void {
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

  // sanitizeSwVersion — valid ids pass, garbage degrades to "dev".
  ok(sanitizeSwVersion("abc1234") === "abc1234", "short sha passes through");
  ok(sanitizeSwVersion("ABC1234") === "abc1234", "uppercase lowered");
  ok(sanitizeSwVersion("a".repeat(40)) === "a".repeat(12), "truncated to 12");
  ok(sanitizeSwVersion("../../etc") === "etc", "path punctuation stripped");
  ok(sanitizeSwVersion("!!!") === "dev", "all-punctuation degrades to dev");
  ok(sanitizeSwVersion("") === "dev", "empty degrades to dev");
  ok(sanitizeSwVersion(null) === "dev", "null degrades to dev");
  ok(sanitizeSwVersion(42) === "dev", "non-string degrades to dev");

  // resolveBuildVersion — Vercel sha wins (short), absent env degrades to dev.
  ok(
    resolveBuildVersion({ VERCEL_GIT_COMMIT_SHA: "0123456789abcdef" }) === "0123456",
    "commit sha shortened to 7",
  );
  ok(resolveBuildVersion({}) === "dev", "no env → dev");
  ok(resolveBuildVersion({ VERCEL_GIT_COMMIT_SHA: "" }) === "dev", "empty sha → dev");

  // posSwCacheNames — version embedded in BOTH names.
  const names = posSwCacheNames("abc1234");
  ok(names.shell === "gw-pos-shell-abc1234", "shell cache carries version");
  ok(names.assets === "gw-pos-assets-abc1234", "asset cache carries version");

  // buildPosServiceWorkerSource — the source honors the AN-0 contract.
  const src = buildPosServiceWorkerSource("abc1234");
  ok(src.includes('"gw-pos-shell-abc1234"'), "source embeds versioned shell cache");
  ok(src.includes('"gw-pos-assets-abc1234"'), "source embeds versioned asset cache");
  ok(src.includes('type === "SKIP_WAITING"'), "source has the SKIP_WAITING message handler");
  // The ONLY skipWaiting call must be inside the message handler — install
  // must never auto-activate (that's what could land an update mid-sale).
  ok((src.match(/skipWaiting\(\)/g) ?? []).length === 1, "exactly one skipWaiting call (message-driven)");
  const installBlock = src.slice(src.indexOf('"install"'), src.indexOf('"message"'));
  ok(!installBlock.includes("skipWaiting"), "install handler never auto-activates");
  ok(src.includes('url.pathname.startsWith("/api/")'), "API traffic still never intercepted");
  ok(src.includes('caches.match("/pos")'), "offline shell fallback preserved");
  ok(src.includes("clients.claim()"), "activate still claims clients");
  // Different versions must produce byte-different workers (that byte diff IS
  // the update signal browsers use).
  ok(
    buildPosServiceWorkerSource("abc1234") !== buildPosServiceWorkerSource("def5678"),
    "distinct versions produce distinct sources",
  );
  // Garbage version degrades to the dev worker rather than throwing.
  ok(buildPosServiceWorkerSource("").includes('"gw-pos-shell-dev"'), "empty version builds the dev worker");

  // AN-1 — isPosCacheName guards the force-refresh cache sweep.
  ok(isPosCacheName("gw-pos-shell-abc1234"), "shell cache is ours");
  ok(isPosCacheName("gw-pos-assets-dev"), "asset cache is ours");
  ok(!isPosCacheName("gw-push-v1"), "push worker cache is NOT ours");
  ok(!isPosCacheName("workbox-precache"), "foreign cache is NOT ours");
  ok(!isPosCacheName(null), "non-string is NOT ours");

  // AN-1 — isBuildStale: differing real versions are stale; dev never is.
  ok(isBuildStale("abc1234", "def5678"), "differing deploy shas are stale");
  ok(!isBuildStale("abc1234", "abc1234"), "same sha is fresh");
  ok(!isBuildStale("dev", "abc1234"), "dev client never stale");
  ok(!isBuildStale("abc1234", "dev"), "dev server answer never stale");
  ok(!isBuildStale(null, "abc1234"), "missing client version never stale");
  ok(!isBuildStale("abc1234", ""), "empty server answer never stale");
  ok(isBuildStale("ABC1234", "def5678"), "versions sanitized before compare");
  ok(!isBuildStale("ABC1234", "abc1234"), "case difference alone is fresh");

  // AN-1 — shouldAutoApplyUpdate: lock screen only, and only with a waiting worker.
  ok(shouldAutoApplyUpdate("locked", true), "locked + waiting -> auto-apply");
  ok(!shouldAutoApplyUpdate("locked", false), "locked without waiting -> no");
  ok(!shouldAutoApplyUpdate("home", true), "home screen -> banner only, never auto");
  ok(!shouldAutoApplyUpdate("sale", true), "mid-sale -> never");
  ok(!shouldAutoApplyUpdate("loading", true), "loading -> never");
  ok(!shouldAutoApplyUpdate(undefined, true), "unknown screen -> never");

  if (failed > 0) {
    throw new Error(`sw-core self-tests FAILED (${failed}): ${failures.join("; ")}`);
  }
  console.log(`sw-core self-tests: ${passed} passed`);
}
