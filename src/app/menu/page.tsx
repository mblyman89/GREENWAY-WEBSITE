import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { InteractiveMenuBrowser } from "@/components/menu/InteractiveMenuBrowser";
import { MenuCollectionShell } from "@/components/menu/MenuCollectionShell";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";

export const metadata: Metadata = {
  title: "Shop Menu | Greenway Marijuana",
  description: "Shop Greenway Marijuana's menu using exact-match POS inventory data with real product names, brands, prices, package labels, potency values, and stock levels.",
};

function totalInventoryUnits() {
  return posMenuPreviewItems.reduce((total, item) => {
    return total + item.variants.reduce((variantTotal, variant) => variantTotal + variant.inventoryLevel, 0);
  }, 0);
}

export default function MenuPage() {
  return (
    <main id="top">
      <Header />
      <Breadcrumbs items={[{ label: "Shop" }]} />
      <section className="relative overflow-hidden border-b border-white/10 bg-black px-4 py-4 md:px-8 md:py-7">
        <div className="mx-auto max-w-7xl">
          <div className="film-strip relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-[var(--charcoal)] p-4 shadow-2xl shadow-black/40 md:rounded-[1.65rem] md:px-8 md:py-9">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_84%_24%,rgba(126,217,87,0.34),transparent_9rem),radial-gradient(circle_at_96%_86%,rgba(255,127,0,0.24),transparent_10rem),linear-gradient(100deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.78)_54%,rgba(0,0,0,0.34)_100%)]" />
            <div className="absolute right-3 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full border border-[var(--greenway)]/35 bg-black/35 shadow-[0_0_45px_rgba(126,217,87,0.18)] md:right-8 md:h-36 md:w-36" aria-hidden="true">
              <div className="absolute left-1/2 top-1/2 h-14 w-10 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-white/20 bg-gradient-to-br from-[var(--greenway)] via-[var(--gold)] to-white p-1 shadow-2xl shadow-black/50 md:h-20 md:w-14">
                <div className="h-full rounded-md bg-black/80" />
              </div>
            </div>
            <div className="relative max-w-[75%] md:max-w-3xl">
              <div className="flex flex-wrap gap-2">
                <p className="rounded-full bg-[var(--greenway)] px-3 py-1.5 text-[0.58rem] font-black uppercase tracking-[0.16em] text-black md:text-xs">Greenway · Port Orchard</p>
                <p className="rounded-full border border-[var(--orange)]/45 bg-[var(--orange)]/10 px-3 py-1.5 text-[0.58rem] font-black uppercase tracking-[0.16em] text-[var(--orange)] md:text-xs">Exact POS matches</p>
              </div>
              <h1 className="mt-3 text-3xl font-black uppercase leading-none tracking-tight text-white md:text-6xl">
                Shop Our Menu
              </h1>
              <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:max-w-2xl md:text-base md:leading-7">
                Browse {posMenuPreviewItems.length.toLocaleString()} exact-match products from Greenway's POS export with real brands, prices, package labels, potency values, and {totalInventoryUnits().toLocaleString()} available inventory units represented.
              </p>
              <p className="mt-3 max-w-2xl rounded-2xl border border-white/10 bg-black/35 p-3 text-[0.7rem] font-semibold leading-5 text-zinc-400 md:text-xs md:leading-6">
                This is the first live-data pass. Ambiguous, fuzzy, and unmatched products are still held back until their matching rules are approved.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-[0.62rem] font-black uppercase tracking-[0.13em]">
                <a href="#products" className="rounded-full bg-white px-3 py-2 text-black transition hover:bg-[var(--orange)]">Start shopping</a>
                <Link href="/menu/pos-preview" className="rounded-full border border-white/15 px-3 py-2 text-zinc-300 transition hover:border-white hover:text-white">Inspection lane</Link>
                <Link href="/menu/mock-preview" className="rounded-full border border-white/15 px-3 py-2 text-zinc-300 transition hover:border-white hover:text-white">Mock fallback</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="hidden md:block">
        <MenuCollectionShell items={posMenuPreviewItems} />
      </div>

      <section id="products">
        <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-10 text-sm font-bold text-zinc-400 md:px-8">Loading menu filters...</div>}>
          <InteractiveMenuBrowser items={posMenuPreviewItems} />
        </Suspense>
      </section>
      <Footer />
    </main>
  );
}
