/**
 * GET /api/pos/version  (POS Slice AN-1)
 *
 * Tiny UNAUTHENTICATED build-identity probe for the register's lock-screen
 * staleness check. Returns the deploy's short commit SHA — the exact same
 * value baked into the service-worker cache names (sw-core) and shown in the
 * home-screen footer — so a locked register can compare its RUNNING build to
 * the server's CURRENT build and surface "Update available" / force-refresh
 * without waiting for the browser's own (unreliable on installed iPad PWAs)
 * service-worker update check.
 *
 * No auth on purpose: the SHA of a public deployment is not a secret (it's
 * already in every /pos-sw.js response), and the probe must work on a device
 * whose stale build might predate a key rotation.
 *
 * force-static like /pos-sw.js/route.ts: the value is fixed per deploy, and
 * cache-control tells CDNs/browsers to revalidate so a new deploy is noticed
 * promptly.
 */
import { resolveBuildVersion } from "@/lib/pos/sw-core";
import { CAPACITOR_IOS_ORIGIN } from "@/lib/pos/cors-core";

export const dynamic = "force-static";

/**
 * CORS for the packaged register app.
 *
 * This route is deliberately `force-static` and UNAUTHENTICATED (see above),
 * so it must not read the incoming request — doing so would opt it into
 * dynamic rendering and lose the per-deploy caching. It therefore cannot echo
 * the caller's Origin.
 *
 * That is safe here precisely BECAUSE the payload is already public: it is the
 * same deploy SHA served in every /pos-sw.js response. There is no session, no
 * cookie and no device key involved, so there is nothing for a hostile origin
 * to steal. We pin the native iOS origin (the packaged app is the only
 * cross-origin caller that needs this probe); the browser PWA at /pos calls it
 * same-origin and needs no CORS header at all.
 */
const VERSION_CORS_ORIGIN = CAPACITOR_IOS_ORIGIN;

export function GET(): Response {
  return new Response(JSON.stringify({ version: resolveBuildVersion(process.env) }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Same revalidation contract as /pos-sw.js — fixed per deploy, but
      // CDNs/browsers must recheck so a new deploy is noticed promptly.
      "cache-control": "public, max-age=0, must-revalidate",
      "access-control-allow-origin": VERSION_CORS_ORIGIN,
      vary: "Origin",
    },
  });
}

/** Preflight for the same static, public probe. */
export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": VERSION_CORS_ORIGIN,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-max-age": "86400",
      vary: "Origin",
    },
  });
}
