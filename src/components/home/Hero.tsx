"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type HeroSlide = {
  key: string;
  image: string;
  imageAlt: string;
  objectClass: string;
  gradientClass: string;
  eyebrow: string;
  title: string;
  description: string;
  ctas: { href: string; label: string; variant: "solid" | "outline" }[];
};

const SLIDES: HeroSlide[] = [
  {
    key: "welcome",
    image: "/home/hero-banner.webp",
    imageAlt: "Greenway Marijuana premium cannabis selection",
    objectClass: "object-cover object-right",
    gradientClass:
      "bg-[linear-gradient(90deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]",
    eyebrow: "Greenway Marijuana",
    title: "Premium Cannabis, Everyday Deals",
    description: "Fresh daily discounts, top brands, and the full menu — all in one place.",
    ctas: [
      { href: "/menu", label: "Shop the Menu", variant: "solid" },
      { href: "/specials", label: "Today's Specials", variant: "outline" },
    ],
  },
  {
    key: "daily-deal",
    image: "/home/hero-dailydeal.webp",
    imageAlt: "Today's featured cannabis daily deal at Greenway Marijuana",
    objectClass: "object-cover object-left",
    gradientClass:
      "bg-[linear-gradient(270deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]",
    eyebrow: "Deal of the Day",
    title: "A New Daily Deal, Every Day",
    description: "From Munchie Monday to Ounce Friday — rotating discounts on the categories you love.",
    ctas: [
      { href: "/specials", label: "See Today's Deal", variant: "solid" },
      { href: "/menu", label: "Browse the Menu", variant: "outline" },
    ],
  },
  {
    key: "car-show",
    image: "/home/hero-carshow.webp",
    imageAlt: "Greenway Summer Car Show event banner",
    objectClass: "object-cover object-right",
    gradientClass:
      "bg-[linear-gradient(90deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]",
    eyebrow: "Special Event · July 25, 2026",
    title: "Greenway Summer Car Show",
    description: "Classic rides, food, and community — join us July 25th, 2026 for a free day of horsepower and good vibes.",
    ctas: [
      { href: "/blog", label: "Event Details", variant: "solid" },
      { href: "/locations", label: "Get Directions", variant: "outline" },
    ],
  },
];

const AUTOPLAY_MS = 6000;

/**
 * The first ("welcome") slide's copy is editable from Admin → Site Content.
 * The server page fetches the published (or draft, in staff preview) values and
 * passes them here. Falling back to the hardcoded SLIDES copy keeps the hero
 * working if the blocks are unseeded. `editable` tags the elements for the
 * click-to-edit overlay when a staff member is previewing.
 */
type HeroContent = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  editable?: boolean;
};

export function Hero({ content }: { content?: HeroContent } = {}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback((index: number) => {
    setActive((index + SLIDES.length) % SLIDES.length);
  }, []);
  const next = useCallback(() => setActive((current) => (current + 1) % SLIDES.length), []);
  const prev = useCallback(() => setActive((current) => (current - 1 + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    if (paused) return;
    timer.current = setInterval(() => {
      setActive((current) => (current + 1) % SLIDES.length);
    }, AUTOPLAY_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused]);

  return (
    <section id="top" className="border-b border-white/10 bg-black px-4 py-4 md:px-8 md:py-5">
      <div className="mx-auto max-w-[88rem]">
        <div
          className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40"
          role="region"
          aria-roledescription="carousel"
          aria-label="Greenway featured highlights"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {SLIDES.map((slide, index) => {
            const isActive = index === active;
            // The first slide ("welcome") is the one wired to Site Content.
            const isEditable = slide.key === "welcome";
            const eyebrow =
              isEditable && content?.eyebrow ? content.eyebrow : slide.eyebrow;
            const title =
              isEditable && content?.title ? content.title : slide.title;
            const description =
              isEditable && content?.subtitle
                ? content.subtitle
                : slide.description;
            const previewProps =
              isEditable && content?.editable
                ? { "data-gw-editable": "true" as const }
                : {};
            return (
              <div
                key={slide.key}
                className={`flex min-h-[8.5rem] items-center transition-opacity duration-700 md:min-h-[10.5rem] ${
                  isActive ? "relative opacity-100" : "pointer-events-none absolute inset-0 opacity-0"
                }`}
                aria-hidden={!isActive}
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${SLIDES.length}: ${slide.title}`}
              >
                <Image
                  src={slide.image}
                  alt={slide.imageAlt}
                  fill
                  priority={index === 0}
                  sizes="(max-width: 768px) 100vw, 1408px"
                  className={slide.objectClass}
                />
                <div className={`absolute inset-0 ${slide.gradientClass}`} aria-hidden="true" />
                <div
                  className={`relative max-w-[80%] px-5 py-6 md:max-w-[58%] md:px-10 ${
                    slide.key === "daily-deal" ? "ml-auto text-right md:pr-14" : ""
                  }`}
                >
                  <p
                    className="inline-flex rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[0.6rem] font-black uppercase tracking-[0.2em] text-[var(--greenway)] backdrop-blur md:text-xs"
                    {...(isEditable && content?.editable
                      ? { "data-gw-block": "home.hero.eyebrow", ...previewProps }
                      : {})}
                  >
                    {eyebrow}
                  </p>
                  <h1
                    className="mt-2 text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-5xl lg:text-6xl"
                    {...(isEditable && content?.editable
                      ? { "data-gw-block": "home.hero.title", ...previewProps }
                      : {})}
                  >
                    {title}
                  </h1>
                  <p
                    className="mt-2 max-w-md text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:text-base"
                    {...(isEditable && content?.editable
                      ? { "data-gw-block": "home.hero.subtitle", ...previewProps }
                      : {})}
                  >
                    {description}
                  </p>
                  <div
                    className={`mt-4 flex flex-wrap gap-3 md:mt-5 ${
                      slide.key === "daily-deal" ? "justify-end" : ""
                    }`}
                  >
                    {slide.ctas.map((cta) => (
                      <Link
                        key={cta.href + cta.label}
                        href={cta.href}
                        className={
                          cta.variant === "solid"
                            ? "rounded-full bg-white px-5 py-2.5 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-black transition hover:bg-[var(--gold)] md:px-7 md:py-3 md:text-sm"
                            : "rounded-full border border-white/20 bg-black/30 px-5 py-2.5 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-white backdrop-blur transition hover:bg-black/55 md:px-7 md:py-3 md:text-sm"
                        }
                      >
                        {cta.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Prev / Next arrows */}
          <button
            type="button"
            onClick={prev}
            aria-label="Previous slide"
            className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur transition hover:bg-black/70 md:left-3 md:h-10 md:w-10"
          >
            <span className="text-lg leading-none md:text-xl" aria-hidden="true">‹</span>
          </button>
          <button
            type="button"
            onClick={next}
            aria-label="Next slide"
            className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur transition hover:bg-black/70 md:right-3 md:h-10 md:w-10"
          >
            <span className="text-lg leading-none md:text-xl" aria-hidden="true">›</span>
          </button>

          {/* Dot indicators */}
          <div className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 md:bottom-3.5">
            {SLIDES.map((slide, index) => (
              <button
                key={slide.key}
                type="button"
                onClick={() => goTo(index)}
                aria-label={`Go to slide ${index + 1}`}
                aria-current={index === active}
                className={`h-2 rounded-full transition-all ${
                  index === active ? "w-6 bg-[var(--greenway)]" : "w-2 bg-white/40 hover:bg-white/70"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
