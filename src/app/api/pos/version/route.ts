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

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify({ version: resolveBuildVersion(process.env) }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Same revalidation contract as /pos-sw.js — fixed per deploy, but
      // CDNs/browsers must recheck so a new deploy is noticed promptly.
      "cache-control": "public, max-age=0, must-revalidate",
    },
  });
}
