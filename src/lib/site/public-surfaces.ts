/**
 * src/lib/site/public-surfaces.ts
 *
 * SLICE 59 — ONE canonical list of the public, menu-derived pages.
 *
 * WHY THIS EXISTS (owner-reported ghost-vendors bug): after "Reset operational
 * data" wiped the published menu, the public "Vendors & Partners" page kept
 * showing two stale vendors until the next delivery was accepted. Root cause:
 * each write path kept its OWN hand-typed list of public pages to refresh —
 * the publish paths refreshed "/", "/menu", and "/specials" but forgot
 * "/vendor-delivery", and the reset action refreshed only ADMIN pages, so the
 * public site could keep serving a pre-reset copy indefinitely.
 *
 * The fix is structural, not another hand-typed list: every path that changes
 * what the public menu shows (publish, auto-publish from intake, reset) calls
 * revalidatePublicMenuSurfaces() below. Adding a future public surface means
 * adding ONE entry here and every write path is covered automatically.
 *
 * SLICE 48 policy this enforces: "no stale product data, ever" — an empty
 * back office must mean an empty public menu AND an empty vendor directory.
 */
import "server-only";
import { revalidatePath } from "next/cache";

/**
 * Every public page whose content is derived from the published menu snapshot:
 *   "/"                — home (featured products come from the live menu)
 *   "/menu"            — the shop menu itself
 *   "/specials"        — menu items on special
 *   "/vendor-delivery" — Vendors & Partners (directory is DERIVED from the
 *                        live menu's vendor names — see vendor-directory-core)
 */
export const PUBLIC_MENU_SURFACES = [
  "/",
  "/menu",
  "/specials",
  "/vendor-delivery",
] as const;

/**
 * Refresh every public menu-derived page so the next visit re-reads the
 * database instead of serving a cached copy. Never throws: a revalidation
 * hiccup must not abort the publish/reset that already succeeded — the pages
 * would simply refresh on their normal schedule instead.
 */
export function revalidatePublicMenuSurfaces(): void {
  for (const path of PUBLIC_MENU_SURFACES) {
    try {
      revalidatePath(path);
    } catch (err) {
      console.error(`[public-surfaces] revalidate ${path} failed:`, err);
    }
  }
}
