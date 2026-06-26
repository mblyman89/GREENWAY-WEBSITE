import { Suspense } from "react";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { InteractiveMenuBrowser } from "@/components/menu/InteractiveMenuBrowser";
import { pageMetadata } from "@/lib/seo/seo";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";

export const metadata = pageMetadata({
  title: "Shop Cannabis Menu — Flower, Vapes, Edibles & More",
  description:
    "Shop Greenway Marijuana's full Port Orchard cannabis menu: flower, prerolls, cartridges, concentrates, edibles, tinctures, topicals, and accessories with live prices and stock.",
  path: "/menu",
});

type MenuPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function MenuPage({ searchParams }: MenuPageProps) {
  const resolvedSearchParams = await searchParams;
  const initialSearchParams = {
    search: firstSearchParamValue(resolvedSearchParams?.search),
    category: firstSearchParamValue(resolvedSearchParams?.category),
    brand: firstSearchParamValue(resolvedSearchParams?.brand),
    special: firstSearchParamValue(resolvedSearchParams?.special),
    // Richer persisted filter params (Task G) so server + client agree and the
    // menu restores the shopper's exact state when returning from a product page.
    categories: firstSearchParamValue(resolvedSearchParams?.categories),
    strains: firstSearchParamValue(resolvedSearchParams?.strains),
    brands: firstSearchParamValue(resolvedSearchParams?.brands),
    weights: firstSearchParamValue(resolvedSearchParams?.weights),
    maxThc: firstSearchParamValue(resolvedSearchParams?.maxThc),
    maxCbd: firstSearchParamValue(resolvedSearchParams?.maxCbd),
    maxPrice: firstSearchParamValue(resolvedSearchParams?.maxPrice),
    sort: firstSearchParamValue(resolvedSearchParams?.sort),
  };
  return (
    <main id="top">
      <Header />

      {/* Breadcrumb sits ABOVE the hero, consistent with every other page.
          (BreadcrumbList JSON-LD is emitted automatically by <Breadcrumbs>.) */}
      <Breadcrumbs items={[{ label: "Shop", href: "/menu" }]} />

      {/* Wide, short hero banner — clean, left-aligned title with a single subtitle line */}
      <section className="border-b border-white/10 bg-black px-4 py-4 md:px-8 md:py-5">
        <div className="mx-auto max-w-[88rem]">
          <div className="relative flex min-h-[8.5rem] items-center overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] px-5 py-6 shadow-2xl shadow-black/40 md:min-h-[10.5rem] md:px-10">
            <div
              className="absolute inset-0 bg-[radial-gradient(circle_at_88%_28%,rgba(255,127,0,0.42),transparent_42%),radial-gradient(circle_at_70%_85%,rgba(126,217,87,0.28),transparent_45%),linear-gradient(100deg,rgba(0,0,0,0.96)_0%,rgba(0,0,0,0.7)_48%,rgba(0,0,0,0.18)_100%)]"
              aria-hidden="true"
            />
            {/* Right-side decorative illustration (no logo icon) */}
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-1/3 items-center justify-center md:flex" aria-hidden="true">
              <div className="relative h-28 w-28 rotate-6">
                <div className="absolute inset-0 rounded-[40%_60%_55%_45%/55%_45%_60%_40%] bg-gradient-to-br from-[var(--greenway)] via-[var(--gold)] to-[var(--orange)] opacity-70 blur-[2px]" />
                <div className="absolute inset-4 rounded-[45%_55%_50%_50%/50%_50%_55%_45%] border border-white/30 bg-black/30" />
                <div className="absolute left-1/2 top-1/2 h-16 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/30" />
              </div>
            </div>
            <div className="relative max-w-[78%] md:max-w-[60%]">
              <h1 className="text-3xl font-black uppercase leading-none tracking-tight text-white md:text-5xl">
                Shop Our Menu
              </h1>
              <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:text-base">
                Explore Greenway&apos;s full selection of premium cannabis products. Use the filters to find your perfect match.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="products">
        <Suspense fallback={<div className="mx-auto max-w-[88rem] px-4 py-10 text-sm font-bold text-zinc-400 md:px-8">Loading menu filters...</div>}>
          <InteractiveMenuBrowser items={posMenuPreviewItems} initialSearchParams={initialSearchParams} />
        </Suspense>
      </section>
      <Footer />
    </main>
  );
}
