"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { HomeProductCard } from "@/components/home/HomeProductCard";
import { mockMenuItems } from "@/lib/leafly/mock-menu";

const heroSlides = [
  {
    eyebrow: "Weekly sale",
    title: "Greenway deal carousel",
    promo: "50% off clearance lane",
    body: "A banner-led homepage pattern inspired by fast retail shopping flows, routing customers quickly into specials and menu collections.",
    primaryLabel: "Shop clearance",
    primaryHref: "/menu?special=clearance-50",
    secondaryLabel: "Browse menu",
    secondaryHref: "/menu",
    accent: "from-[var(--gold)] via-[var(--orange)] to-[var(--greenway)]",
    background: "bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.36),transparent_10rem),linear-gradient(135deg,#ffd700_0%,#ff7f00_54%,#12351f_100%)]",
  },
  {
    eyebrow: "Category spotlight",
    title: "Flower and pre-rolls",
    promo: "Customer favorites",
    body: "Quick links and product cards keep the homepage commerce-forward with the categories shoppers expect first.",
    primaryLabel: "Flower collection",
    primaryHref: "/menu?category=flower",
    secondaryLabel: "Pre-rolls",
    secondaryHref: "/menu?category=preroll",
    accent: "from-[var(--greenway)] via-emerald-300 to-[var(--gold)]",
    background: "bg-[radial-gradient(circle_at_78%_18%,rgba(126,217,87,0.42),transparent_12rem),linear-gradient(135deg,#07140b_0%,#12351f_46%,#ff7f00_100%)]",
  },
  {
    eyebrow: "Brand spotlight",
    title: "Shop by brand",
    promo: "Featured Greenway picks",
    body: "Browse brand-forward sale cards and jump directly into filtered menu results for the product lines you want.",
    primaryLabel: "Shop brands",
    primaryHref: "#shop-by-brand",
    secondaryLabel: "Vape collection",
    secondaryHref: "/menu?category=cartridge",
    accent: "from-emerald-400 via-blue-300 to-[var(--orange)]",
    background: "bg-[radial-gradient(circle_at_24%_24%,rgba(59,130,246,0.42),transparent_12rem),linear-gradient(135deg,#020617_0%,#12351f_48%,#1d4ed8_100%)]",
  },
];

const featuredProducts = mockMenuItems.slice(0, 4);

function discountedPrice(priceMinorUnits: number, index: number) {
  const discount = index % 2 === 0 ? 50 : 25;
  return {
    discount,
    salePrice: Math.round(priceMinorUnits * (1 - discount / 100)),
  };
}

export function Hero() {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const activeSlide = heroSlides[activeSlideIndex];

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveSlideIndex((current) => (current + 1) % heroSlides.length);
    }, 6500);

    return () => window.clearInterval(interval);
  }, []);

  const nextSlideLabel = useMemo(() => {
    const nextIndex = (activeSlideIndex + 1) % heroSlides.length;
    return heroSlides[nextIndex].eyebrow;
  }, [activeSlideIndex]);

  const advanceSlide = () => setActiveSlideIndex((activeSlideIndex + 1) % heroSlides.length);
  const previousSlide = () => setActiveSlideIndex((activeSlideIndex - 1 + heroSlides.length) % heroSlides.length);

  return (
    <section id="top" className="relative isolate overflow-hidden border-b border-white/10 bg-black text-white">
      <div className="noise-overlay" />

      <div className="relative px-3 pt-3 md:px-0 md:pt-0">
        <div className="relative h-[560px] overflow-hidden rounded-[1.35rem] border border-white/10 bg-zinc-950 shadow-2xl shadow-black/50 sm:h-[530px] md:h-[620px] md:rounded-none md:border-x-0 md:border-t-0 lg:h-[650px]">
          <div className={`absolute inset-0 ${activeSlide.background}`} aria-hidden="true" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.58),rgba(0,0,0,0.10),rgba(0,0,0,0.62))]" aria-hidden="true" />
          <div className={`absolute inset-x-0 top-0 h-2 bg-gradient-to-r md:h-3 ${activeSlide.accent}`} aria-hidden="true" />

          <button
            type="button"
            onClick={previousSlide}
            className="absolute left-2 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-xl font-black text-white backdrop-blur transition hover:bg-black/70 sm:flex"
            aria-label="Show previous hero slide"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={advanceSlide}
            className="absolute right-2 top-1/2 z-20 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-xl font-black text-white backdrop-blur transition hover:bg-black/70"
            aria-label={`Advance hero carousel to ${nextSlideLabel}`}
          >
            ›
          </button>

          <div className="relative z-10 grid h-full items-end gap-5 overflow-hidden p-4 pt-9 md:grid-cols-[1.05fr_0.95fr] md:p-8 lg:p-10">
            <div className="max-w-3xl pb-8 md:pb-12">
              <p className="inline-flex rounded-full border border-white/20 bg-black/45 px-3 py-1.5 text-[0.64rem] font-black uppercase tracking-[0.18em] text-white backdrop-blur md:px-4 md:py-2 md:text-xs">
                {activeSlide.eyebrow}
              </p>
              <h1 className="mt-4 text-4xl font-black uppercase leading-[0.88] tracking-tight text-white md:text-7xl lg:text-8xl">
                {activeSlide.title}
              </h1>
              <p className="mt-3 inline-flex rounded-xl bg-[var(--gold)] px-3 py-2 text-sm font-black uppercase tracking-[0.12em] text-black md:mt-5 md:text-lg">
                {activeSlide.promo}
              </p>
              <p className="mt-4 max-w-2xl text-sm font-medium leading-6 text-zinc-100 md:text-lg md:leading-8">
                {activeSlide.body}
              </p>
              <div className="mt-5 flex gap-3 md:mt-8">
                <Link href={activeSlide.primaryHref} className="rounded-full bg-white px-5 py-3 text-center text-[0.7rem] font-black uppercase tracking-[0.14em] text-black transition hover:bg-[var(--gold)] md:px-7 md:py-4 md:text-sm">
                  {activeSlide.primaryLabel}
                </Link>
                <Link href={activeSlide.secondaryHref} className="rounded-full border border-white/20 bg-black/30 px-5 py-3 text-center text-[0.7rem] font-black uppercase tracking-[0.14em] text-white backdrop-blur transition hover:bg-black/55 md:px-7 md:py-4 md:text-sm">
                  {activeSlide.secondaryLabel}
                </Link>
              </div>
            </div>

            <div className="hidden rounded-[2rem] border border-white/15 bg-black/35 p-5 backdrop-blur md:block">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-[var(--gold)]">Rotating homepage promo</p>
              <h2 className="mt-3 text-3xl font-black uppercase leading-none text-white">Built like a storefront banner.</h2>
              <p className="mt-4 text-sm leading-6 text-zinc-200">The homepage starts with a fixed-height carousel area, then pushes directly into product deal cards and filtered shopping lanes.</p>
            </div>
          </div>

          <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 gap-2" aria-label="Hero carousel slide selector">
            {heroSlides.map((slide, index) => (
              <button
                key={slide.eyebrow}
                type="button"
                onClick={() => setActiveSlideIndex(index)}
                className={`h-2.5 rounded-full transition ${index === activeSlideIndex ? "w-8 bg-white" : "w-2.5 bg-white/45 hover:bg-white/70"}`}
                aria-label={`Show slide ${index + 1}: ${slide.eyebrow}`}
                aria-pressed={index === activeSlideIndex}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="relative mx-auto max-w-7xl px-3 pb-10 md:px-8 md:pb-12">
        <section className="mt-4 md:mt-7" aria-label="50% off clearance products">
          <div className="mb-3 flex items-center justify-between gap-4 md:mb-5">
            <div>
              <h2 className="text-2xl font-black uppercase leading-none text-white md:text-4xl">50% OFF CLEARANCE</h2>
            </div>
            <Link href="/menu?special=clearance-50" className="inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-white/15 px-3 text-center text-[0.64rem] font-black uppercase tracking-[0.12em] text-white transition hover:border-[var(--orange)] hover:text-[var(--orange)] md:h-auto md:px-4 md:py-2 md:text-xs">
              SHOP ALL
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
            {featuredProducts.map((item, index) => {
              const deal = discountedPrice(item.priceMinorUnits, index);

              return <HomeProductCard key={item.id} item={item} discount={deal.discount} />;
            })}
          </div>
        </section>
      </div>
    </section>
  );
}
