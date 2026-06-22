import { Suspense } from "react";
import type { Metadata } from "next";
import { Header } from "@/components/site/Header";
import { Breadcrumbs } from "@/components/site/Breadcrumbs";
import { Footer } from "@/components/site/Footer";
import { InteractiveMenuBrowser } from "@/components/menu/InteractiveMenuBrowser";
import { MenuCollectionShell } from "@/components/menu/MenuCollectionShell";
import { mockMenuItems } from "@/lib/leafly/mock-menu";

export const metadata: Metadata = {
  title: "Mock Menu Fallback | Greenway Marijuana",
  description: "Greenway Marijuana's original mock menu fallback retained for comparison while exact POS menu data is tested.",
};

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
            <div className="relative max-w-[70%] md:max-w-2xl">
              <p className="text-[0.62rem] font-black uppercase tracking-[0.2em] text-[var(--greenway)] md:text-xs">Greenway · Mock fallback</p>
              <h1 className="mt-2 text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-6xl">
                Mock Menu Fallback
              </h1>
              <p className="mt-2 text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:max-w-xl md:text-base md:leading-7">
                Original mock catalog preserved for comparison while the main shop uses exact-match POS data.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="hidden md:block">
        <MenuCollectionShell items={mockMenuItems} />
      </div>

      <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-10 text-sm font-bold text-zinc-400 md:px-8">Loading menu filters...</div>}>
        <InteractiveMenuBrowser items={mockMenuItems} />
      </Suspense>
      <Footer />
    </main>
  );
}
