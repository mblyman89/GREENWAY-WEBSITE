import {
  ShopBreadcrumbSkeleton,
  ShopBannerSkeleton,
  ShopBrowserSkeleton,
} from "@/components/menu/MenuSkeleton";

/**
 * SLICE F1 — THE SHOP PAGE'S OWN SKELETON.
 *
 * Before this file existed, `/menu` inherited `src/app/loading.tsx` — the ROOT
 * skeleton, shaped like the HOME page (film-strip hero + three promo cards).
 * Shoppers tapping "Shop" stared at a picture of the home page for ~2.3s.
 * Verified by dumping the raw first chunk off the wire and matching it
 * byte-for-byte to the root loading file.
 *
 * Next.js resolves `loading.js` by walking UP from the requested segment, so
 * placing this file at `src/app/menu/` stops that walk here. `/menu` now falls
 * back to a SHOP-shaped skeleton; every other route is untouched.
 *
 * The pieces are shared with the `<Suspense>` fallback inside
 * `src/app/menu/page.tsx` (Slice F2) so the navigation placeholder and the
 * streaming placeholder are literally the same markup and cannot diverge.
 *
 * No data is read here. This renders instantly — the moment it awaits anything
 * it stops being a skeleton and becomes part of the problem.
 */
export default function MenuLoading() {
  return (
    <main className="min-h-screen bg-black text-white">
      <ShopBreadcrumbSkeleton />
      <ShopBannerSkeleton />
      <ShopBrowserSkeleton />
    </main>
  );
}
