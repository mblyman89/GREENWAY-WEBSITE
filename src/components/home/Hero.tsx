import Image from "next/image";
import Link from "next/link";

/**
 * Home hero — short, wide banner that mirrors the shop page proportions
 * (min-h-[8.5rem] mobile / md:min-h-[10.5rem]) inside the max-w-[88rem]
 * container. Replaces the old tall (560–650px) auto-advancing carousel.
 */
export function Hero() {
  return (
    <section id="top" className="border-b border-white/10 bg-black px-4 py-4 md:px-8 md:py-5">
      <div className="mx-auto max-w-[88rem]">
        <div className="relative isolate flex min-h-[8.5rem] items-center overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40 md:min-h-[10.5rem]">
          <Image
            src="/home/hero-banner.webp"
            alt="Greenway Marijuana premium cannabis selection"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 1408px"
            className="object-cover object-right"
          />
          {/* Left-weighted dark gradient keeps the headline legible over the art. */}
          <div
            className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]"
            aria-hidden="true"
          />
          <div className="relative max-w-[80%] px-5 py-6 md:max-w-[58%] md:px-10">
            <p className="inline-flex rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[0.6rem] font-black uppercase tracking-[0.2em] text-[var(--greenway)] backdrop-blur md:text-xs">
              Greenway Marijuana
            </p>
            <h1 className="mt-2 text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-5xl lg:text-6xl">
              Premium Cannabis, Everyday Deals
            </h1>
            <p className="mt-2 max-w-md text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:text-base">
              Fresh daily discounts, top brands, and the full menu — all in one place.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 md:mt-5">
              <Link
                href="/menu"
                className="rounded-full bg-white px-5 py-2.5 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-black transition hover:bg-[var(--gold)] md:px-7 md:py-3 md:text-sm"
              >
                Shop the Menu
              </Link>
              <Link
                href="/specials"
                className="rounded-full border border-white/20 bg-black/30 px-5 py-2.5 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-white backdrop-blur transition hover:bg-black/55 md:px-7 md:py-3 md:text-sm"
              >
                Today&apos;s Specials
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
