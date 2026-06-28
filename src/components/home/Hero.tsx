"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderSlide } from "@/lib/cms/carousel-types";

const AUTOPLAY_MS = 6000;

/** Map the slide's image-focus knob to a Tailwind object-position class. */
function focusClass(focus: RenderSlide["imageFocus"]): string {
  switch (focus) {
    case "left":
      return "object-cover object-left";
    case "center":
      return "object-cover object-center";
    default:
      return "object-cover object-right";
  }
}

/** Gradient direction follows the text side so the copy stays legible. */
function gradientClass(textAlign: RenderSlide["textAlign"]): string {
  return textAlign === "right"
    ? "bg-[linear-gradient(270deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]"
    : "bg-[linear-gradient(90deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]";
}

/**
 * Hero — the homepage carousel. Slides come from the staff-managed Home
 * Carousel (Admin → Content → Home Carousel, table home_carousel_slides). The
 * server page resolves them draft-aware via getCarouselForRender() and passes
 * them in. If none are configured it falls back to the seed slides so the hero
 * never renders blank. Each slide auto-rotates; arrows + dots allow manual
 * control; hovering pauses autoplay.
 */
export function Hero({ slides }: { slides: RenderSlide[] }) {
  const safeSlides = slides.length > 0 ? slides : [];
  const count = safeSlides.length;

  const [activeRaw, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clamp during render so a shrinking slide count (e.g. in preview) never
  // points past the end — no setState-in-effect needed.
  const active = count === 0 ? 0 : Math.min(activeRaw, count - 1);

  const goTo = useCallback(
    (index: number) => {
      if (count === 0) return;
      setActive((index + count) % count);
    },
    [count],
  );
  const next = useCallback(() => {
    if (count === 0) return;
    setActive((current) => (current + 1) % count);
  }, [count]);
  const prev = useCallback(() => {
    if (count === 0) return;
    setActive((current) => (current - 1 + count) % count);
  }, [count]);

  useEffect(() => {
    if (paused || count <= 1) return;
    timer.current = setInterval(() => {
      setActive((current) => (current + 1) % count);
    }, AUTOPLAY_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused, count]);

  if (count === 0) return null;

  return (
    <section
      id="top"
      className="border-b border-white/10 bg-black px-4 py-4 md:px-8 md:py-5"
    >
      <div className="mx-auto max-w-[88rem]">
        <div
          className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40"
          role="region"
          aria-roledescription="carousel"
          aria-label="Greenway featured highlights"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {safeSlides.map((slide, index) => {
            const isActive = index === active;
            const alignRight = slide.textAlign === "right";
            return (
              <div
                key={slide.key}
                className={`flex min-h-[8.5rem] items-center transition-opacity duration-700 md:min-h-[10.5rem] ${
                  isActive
                    ? "relative opacity-100"
                    : "pointer-events-none absolute inset-0 opacity-0"
                }`}
                aria-hidden={!isActive}
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}: ${slide.title}`}
              >
                {slide.image ? (
                  <Image
                    src={slide.image}
                    alt={slide.imageAlt || slide.title || "Greenway"}
                    fill
                    priority={index === 0}
                    sizes="(max-width: 768px) 100vw, 1408px"
                    className={focusClass(slide.imageFocus)}
                  />
                ) : null}
                <div
                  className={`absolute inset-0 ${gradientClass(slide.textAlign)}`}
                  aria-hidden="true"
                />
                <div
                  className={`relative max-w-[80%] px-5 py-6 md:max-w-[58%] md:px-10 ${
                    alignRight ? "ml-auto text-right md:pr-14" : ""
                  }`}
                >
                  {slide.eyebrow ? (
                    <p className="inline-flex rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[0.6rem] font-black uppercase tracking-[0.2em] text-[var(--greenway)] backdrop-blur md:text-xs">
                      {slide.eyebrow}
                    </p>
                  ) : null}
                  {slide.title ? (
                    <h1 className="mt-2 text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-5xl lg:text-6xl">
                      {slide.title}
                    </h1>
                  ) : null}
                  {slide.description ? (
                    <p className="mt-2 max-w-md text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:text-base">
                      {slide.description}
                    </p>
                  ) : null}
                  {slide.ctas.length > 0 ? (
                    <div
                      className={`mt-4 flex flex-wrap gap-3 md:mt-5 ${
                        alignRight ? "justify-end" : ""
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
                  ) : null}
                </div>
              </div>
            );
          })}

          {/* Prev / Next arrows (only when more than one slide) */}
          {count > 1 ? (
            <>
              <button
                type="button"
                onClick={prev}
                aria-label="Previous slide"
                className="absolute left-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur transition hover:bg-black/70 md:left-3 md:h-10 md:w-10"
              >
                <span className="text-lg leading-none md:text-xl" aria-hidden="true">
                  ‹
                </span>
              </button>
              <button
                type="button"
                onClick={next}
                aria-label="Next slide"
                className="absolute right-2 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur transition hover:bg-black/70 md:right-3 md:h-10 md:w-10"
              >
                <span className="text-lg leading-none md:text-xl" aria-hidden="true">
                  ›
                </span>
              </button>

              {/* Dot indicators */}
              <div className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 md:bottom-3.5">
                {safeSlides.map((slide, index) => (
                  <button
                    key={slide.key}
                    type="button"
                    onClick={() => goTo(index)}
                    aria-label={`Go to slide ${index + 1}`}
                    aria-current={index === active}
                    className={`h-2 rounded-full transition-all ${
                      index === active
                        ? "w-6 bg-[var(--greenway)]"
                        : "w-2 bg-white/40 hover:bg-white/70"
                    }`}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
