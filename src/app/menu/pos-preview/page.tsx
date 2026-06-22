import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { Header } from "@/components/site/Header";
import { InteractiveMenuBrowser } from "@/components/menu/InteractiveMenuBrowser";
import { MenuCollectionShell } from "@/components/menu/MenuCollectionShell";
import { posMenuPreviewItems } from "@/lib/pos/preview-menu";

export const metadata: Metadata = {
  title: "Exact POS Inspection Lane | Greenway Marijuana",
  description: "Inspection lane for the exact-match POS menu feed now powering Greenway Marijuana's shop page.",
};

export default function PosPreviewMenuPage() {
  return (
    <main id="top">
      <Header />
      <Breadcrumbs items={[{ label: "Shop", href: "/menu" }, { label: "Exact POS Inspection" }]} />
      <section className="border-b border-white/10 bg-black px-4 py-5 md:px-8 md:py-8">
        <div className="mx-auto max-w-7xl">
          <div className="film-strip relative overflow-hidden rounded-[1.35rem] border border-[var(--greenway)]/35 bg-[var(--charcoal)] p-4 shadow-2xl shadow-black/40 md:rounded-[1.65rem] md:p-8">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_18%,rgba(126,217,87,0.32),transparent_12rem),radial-gradient(circle_at_92%_84%,rgba(255,127,0,0.24),transparent_12rem),linear-gradient(100deg,rgba(0,0,0,0.96)_0%,rgba(0,0,0,0.82)_58%,rgba(0,0,0,0.42)_100%)]" />
            <div className="relative max-w-3xl">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-[var(--greenway)] px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.16em] text-black">Inspection lane</span>
                <span className="rounded-full border border-[var(--orange)]/45 bg-[var(--orange)]/10 px-3 py-1.5 text-[0.62rem] font-black uppercase tracking-[0.16em] text-[var(--orange)]">Same exact POS feed as /menu</span>
              </div>
              <h1 className="mt-3 text-3xl font-black uppercase leading-none tracking-tight text-white md:text-6xl">Exact POS Feed</h1>
              <p className="mt-3 text-sm font-semibold leading-6 text-zinc-300 md:text-base md:leading-7">
                This lane remains available for focused inspection, but the main shop page now uses the same exact-match POS menu data. Use this route to compare behavior without changing navigation assumptions.
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-black uppercase tracking-[0.12em]">
                <Link href="/menu" className="rounded-full bg-white px-3 py-2 text-black transition hover:bg-[var(--orange)]">Main shop</Link>
                <Link href="/menu/mock-preview" className="rounded-full border border-white/15 px-3 py-2 text-zinc-300 transition hover:border-white hover:text-white">Mock fallback</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="hidden md:block">
        <MenuCollectionShell items={posMenuPreviewItems} />
      </div>

      <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-10 text-sm font-bold text-zinc-400 md:px-8">Loading POS inspection filters...</div>}>
        <InteractiveMenuBrowser items={posMenuPreviewItems} />
      </Suspense>
      <Footer />
    </main>
  );
}
