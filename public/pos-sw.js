/**
 * public/pos-sw.js  (POS Slice B11)
 *
 * Minimal service worker so /pos installs to the iPad Home Screen and BOOTS
 * OFFLINE. Deliberately tiny — the register is already offline-first at the
 * app layer (localStorage event queue + cached menu bundle); this worker only
 * guarantees the SHELL itself loads without a network:
 *
 *  - "/pos" HTML: network-first, falling back to the last good cached copy.
 *  - Hashed build assets (/_next/static/*) + /pos/* icons: cache-first
 *    (immutable by content hash, safe forever).
 *  - EVERYTHING ELSE (API calls, sync, admin) passes straight through —
 *    the worker never touches /api/* so sync semantics stay exactly as built.
 */

const SHELL_CACHE = "gw-pos-shell-v1";
const ASSET_CACHE = "gw-pos-assets-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add("/pos"))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
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
