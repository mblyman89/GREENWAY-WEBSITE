/**
 * GET /pos-sw.js — the register service worker (POS Slice AN-0).
 *
 * Replaces the static public/pos-sw.js: the worker source is now BUILT with
 * the deploy's commit SHA baked into its cache names (sw-core), so every
 * deploy yields a byte-different worker → installed registers detect the
 * update, and RegisterShell can offer "Update available" between sales.
 *
 * Served from the same /pos-sw.js URL the registers already registered, so
 * existing installs pick up the new worker on their next update check —
 * no re-provisioning needed.
 */
import { buildPosServiceWorkerSource, resolveBuildVersion } from "@/lib/pos/sw-core";

export const dynamic = "force-static";

export function GET(): Response {
  const source = buildPosServiceWorkerSource(resolveBuildVersion(process.env));
  return new Response(source, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Workers should revalidate promptly so a deploy is noticed within
      // minutes, not after a long CDN TTL. Browsers additionally cap SW
      // script caching at 24 h by spec.
      "cache-control": "public, max-age=0, must-revalidate",
      // Explicit scope allowance (the worker lives at the root path but only
      // controls /pos — same as the static file it replaces).
      "service-worker-allowed": "/pos",
    },
  });
}
