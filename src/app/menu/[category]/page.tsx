import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShopPage } from "@/components/menu/ShopPage";
import { pageMetadata } from "@/lib/seo/seo";
import {
  allCategoryRouteParams,
  categoryBreadcrumbs,
  categoryHelper,
  categoryLabel,
  categoryMetaDescription,
  categoryMetaTitle,
  categoryPath,
  isRoutableCategorySlug,
} from "@/lib/menu/menu-facet-core";

/**
 * SLICE H — /menu/<category>, PRERENDERED AND INDEXABLE.
 *
 * WHY THIS ROUTE EXISTS
 * ─────────────────────
 * `/menu` reads `searchParams`, which Next.js documents as a request-time API
 * that "will opt the page into dynamic rendering at request time". Measured on
 * the live deployment, that is exactly what happened — `/menu` returned
 * `x-vercel-cache: MISS` on every single request while every other public route
 * on the site cached (`/` STALE, `/blog` PRERENDER, `/vendors` HIT). PageSpeed
 * reported the cost as "server responded slowly (observed 1324 ms)".
 *
 * The category facet is therefore promoted from a query string to a real route
 * segment. A segment is known at build time, so this route can be enumerated by
 * `generateStaticParams` and prerendered into the CDN.
 *
 * WHAT THIS BUYS BEYOND SPEED
 * ───────────────────────────
 * `/menu?category=flower` was, to a search engine, the shop page with a
 * parameter on it — one page, not twenty. `/menu/flower` is a distinct document
 * with its own canonical URL, title, description and breadcrumb trail. The 21
 * category pages become 21 indexable landing pages, each targeting the query
 * that actually converts ("flower port orchard"), and each one is served from
 * the edge.
 *
 * WHAT DELIBERATELY DID NOT BECOME A ROUTE
 * ────────────────────────────────────────
 * Brands (191), vendors (113), strains, terpenes, weights, the THC/CBD/price
 * sliders and sort order all stay client-side. Categories are a closed set of
 * 21 owned by `category-taxonomy.ts`; the others are open sets that change with
 * every receiving run, and their combinations are unbounded. Promoting them
 * would create an infinite prerender surface and a crawl trap. The reasoning is
 * pinned in `menu-facet-core.ts` and asserted by its self-tests.
 */

type CategoryRouteProps = {
  params: Promise<{ category: string }>;
};

/**
 * Enumerate every category route at build time.
 *
 * Derived from the shared taxonomy through the pure core, which is the SAME
 * source the sitemap uses — so the set of prerendered routes and the set of
 * advertised routes cannot disagree.
 */
export function generateStaticParams(): Array<{ category: string }> {
  return allCategoryRouteParams();
}

/**
 * Reject anything that is not a known category.
 *
 * With `dynamicParams = false`, a request for a slug outside
 * `generateStaticParams` returns a 404 without ever reaching the origin. That
 * is both the fast answer and the correct one: it stops crawlers manufacturing
 * infinite bogus category URLs, and it means no un-enumerated route can quietly
 * render the whole menu under a wrong canonical.
 */
export const dynamicParams = false;

/**
 * Matches MENU_CACHE_TTL_SECONDS and the `/menu` root, so the page cache and the
 * menu data cache expire on the same schedule instead of fighting each other.
 *
 * Publishing stays INSTANT regardless: `revalidatePublicMenuSurfaces()` clears
 * the data tag and revalidates the menu surfaces in the same action.
 */
export const revalidate = 60;

export async function generateMetadata({ params }: CategoryRouteProps): Promise<Metadata> {
  const { category } = await params;
  if (!isRoutableCategorySlug(category)) {
    // Unreachable in practice because `dynamicParams = false` 404s first, but
    // metadata must never invent a canonical for a slug the route rejects.
    return pageMetadata({
      title: "Shop Cannabis Menu | Greenway Marijuana Port Orchard",
      description: "Browse the full Greenway Marijuana cannabis menu in Port Orchard, WA.",
      path: "/menu",
      image: "/og/menu.png",
      noindex: true,
    });
  }
  return pageMetadata({
    title: categoryMetaTitle(category),
    description: categoryMetaDescription(category),
    // The canonical points at THIS route, not at /menu. Pointing every category
    // back to the shop root would tell search engines these 21 pages are
    // duplicates and undo the entire reason for the slice.
    path: categoryPath(category),
    image: "/og/menu.png",
  });
}

export default async function MenuCategoryPage({ params }: CategoryRouteProps) {
  const { category } = await params;

  // Fails closed. `dynamicParams = false` should make this unreachable, but the
  // route must not render the full menu under a category canonical if that ever
  // changes.
  if (!isRoutableCategorySlug(category)) notFound();

  return (
    <ShopPage
      initialCategory={category}
      breadcrumbs={categoryBreadcrumbs(category)}
      heading={categoryLabel(category)}
      subheading={categoryHelper(category)}
    />
  );
}
