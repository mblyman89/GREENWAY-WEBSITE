import { ShopPage } from "@/components/menu/ShopPage";
import { pageMetadata } from "@/lib/seo/seo";
import { MENU_ROOT_PATH } from "@/lib/menu/menu-facet-core";

/**
 * SLICE H — THE SHOP PAGE CAN FINALLY BE CACHED.
 *
 * THE DEFECT, MEASURED
 * ────────────────────
 * This route read `searchParams`, and Next.js documents what that costs:
 *
 *   "`searchParams` is a Request-time API whose values cannot be known ahead
 *    of time. Using it will opt the page into dynamic rendering at request
 *    time."
 *   — nextjs.org/docs/app/api-reference/file-conventions/page
 *
 * Measured against the live deployment, that is exactly what happened. `/menu`
 * was the ONLY public route on the site that never came from the CDN:
 *
 *     /menu       MISS  MISS  MISS   private, no-cache, no-store
 *     /           STALE (age 753)    public
 *     /vendors    HIT   (age 3494)   public
 *     /about      PRERENDER          public
 *     /blog       PRERENDER          public
 *
 * PageSpeed saw the consequence as "server responded slowly (observed 1324 ms)",
 * est. savings 1,220 ms.
 *
 * WHY draftMode() WAS NOT THE CAUSE
 * ─────────────────────────────────
 * It was suspected three separate times across earlier slices. Ruled out by
 * controlled comparison rather than by argument: the home page calls
 * `draftMode()` through `getSectionsForRender`, has `revalidate = 60`, reads the
 * database — and caches as `STALE`. `/blog` does the same and is `PRERENDER`.
 * The single structural difference between `/` and `/menu` was `searchParams`.
 *
 * THE FIX
 * ───────
 * `searchParams` is gone from this file. The category facet — the only filter
 * with a closed, enumerable value set — was promoted to a real route segment at
 * `src/app/menu/[category]/page.tsx`, which `generateStaticParams` prerenders
 * into the CDN as 21 indexable pages.
 *
 * NOTHING BREAKS FOR SHOPPERS
 * ───────────────────────────
 * `InteractiveMenuBrowser.resolveInitialParams` (InteractiveMenuBrowser.tsx:630)
 * already merges the server-provided params with the LIVE browser URL, and the
 * live URL takes precedence. Every filter therefore still applies from the
 * address bar — including old external `/menu?category=flower` bookmarks — the
 * work simply happens on the client instead of forcing a dynamic render on the
 * server. All internal links now point at the new paths.
 *
 * `revalidate = 60` matches MENU_CACHE_TTL_SECONDS so the page cache and the
 * menu data cache expire together. Publishing stays INSTANT: `/menu` is listed
 * in PUBLIC_MENU_SURFACES, so `revalidatePublicMenuSurfaces()` clears the data
 * tag and revalidates the path in the same action.
 */
export const revalidate = 60;

export const metadata = pageMetadata({
  title: "Shop Cannabis Menu — Flower, Vapes, Edibles & More",
  description:
    "Shop Greenway Marijuana's full Port Orchard cannabis menu: flower, prerolls, cartridges, concentrates, edibles, tinctures, topicals, and accessories with live prices and stock.",
  path: MENU_ROOT_PATH,
  image: "/og/menu.png",
});

export default function MenuPage() {
  // No `searchParams`, no `await`, no request-time API of any kind — that is
  // what makes this route prerenderable. The shared renderer holds the actual
  // page so `/menu` and `/menu/[category]` cannot drift apart.
  return <ShopPage breadcrumbs={[{ label: "Shop", href: MENU_ROOT_PATH }]} />;
}
