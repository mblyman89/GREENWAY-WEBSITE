"use client";

/**
 * ShopBannerCarousel (SLICE A / SHOP-1) — the Shop (/menu) top banner, rebuilt
 * as a CAROUSEL of up to ten fully-editable "special" slides. It fuses two
 * proven pieces:
 *
 *   • the HOME carousel engine (src/components/home/Hero.tsx): auto-rotate,
 *     prev/next arrows, dot indicators, pause-on-hover, and now ALSO honors the
 *     user's reduce-motion preference + full keyboard/ARIA, and
 *   • the LOYALTY hero's rich per-slide presentation (SLICE 123): a textless
 *     background image (desktop + mobile, each with its own focus) under three
 *     independently styled overlay text blocks (eyebrow / title / subtitle) with
 *     per-block fonts (bold display / clean sans / cursive script), on-brand
 *     colors, hard-line-break stacking, and an optional cursive size bump — plus
 *     per-slide CTA buttons.
 *
 * Each slide's look comes from a ShopHeroPresentation (see shop-carousel-core).
 * The single-slide render (SlideView) is intentionally presentational + pure
 * over its props so the admin editor can preview ONE slide with the EXACT same
 * output shoppers see. When only one slide is present the arrows/dots are
 * hidden and it reads like the old single banner.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  heroFontStack,
  heroColorHex,
  isScriptHeroFont,
  heroTextLines,
  type HeroTextBlock,
  type TextAlign,
  type TextVAlign,
  type ImageFocus,
} from "@/lib/loyalty/loyalty-hero-core";
import {
  SHOP_CAROUSEL_AUTOPLAY_MS,
  type ShopHeroPresentation,
} from "@/lib/cms/shop-carousel-core";
import type { ShopRenderSlide } from "@/lib/cms/shop-carousel-types";

// ── Presentation helpers (shared by public render + editor preview) ──────────

const FOCUS_OBJECT_CLASS: Record<ImageFocus, string> = {
  center: "object-center",
  top: "object-top",
  bottom: "object-bottom",
  left: "object-left",
  right: "object-right",
};

/** Gradient weighted toward the text side so copy stays legible over art. */
function gradientClass(textAlign: TextAlign): string {
  if (textAlign === "right")
    return "bg-[linear-gradient(270deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]";
  if (textAlign === "center")
    return "bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,rgba(0,0,0,0.68)_50%,rgba(0,0,0,0.5)_100%)]";
  return "bg-[linear-gradient(90deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]";
}

function textBlockClass(textAlign: TextAlign, valign: TextVAlign): string {
  const h =
    textAlign === "right"
      ? "items-end text-right"
      : textAlign === "center"
        ? "items-center text-center"
        : "items-start text-left";
  const v =
    valign === "top" ? "justify-start" : valign === "bottom" ? "justify-end" : "justify-center";
  return `${h} ${v}`;
}

/** Render one styled text block (font + color + cursive + stacked lines). */
function BlockLines({
  block,
  baseClass,
  allowScriptScale = false,
}: {
  block: HeroTextBlock;
  baseClass: string;
  allowScriptScale?: boolean;
}) {
  const lines = heroTextLines(block.text);
  if (!block.show || lines.length === 0) return null;
  const isScript = isScriptHeroFont(block.font);
  const style: React.CSSProperties = {
    fontFamily: heroFontStack(block.font),
    color: heroColorHex(block.color),
  };
  if (allowScriptScale && isScript && block.scriptScale > 1) {
    style.fontSize = `${block.scriptScale}em`;
  }
  const scriptClass = isScript ? "normal-case tracking-normal" : "";
  return (
    <p className={`${baseClass} ${scriptClass}`} style={style}>
      {lines.map((line, i) => (
        <span key={i} className="block">
          {line === "" ? "\u00A0" : line}
        </span>
      ))}
    </p>
  );
}

function CtaButtons({ pres }: { pres: ShopHeroPresentation }) {
  if (pres.ctas.length === 0) return null;
  const justify =
    pres.textAlign === "right"
      ? "justify-end"
      : pres.textAlign === "center"
        ? "justify-center"
        : "";
  return (
    <div className={`mt-3 flex flex-wrap gap-2 md:mt-4 md:gap-3 ${justify}`}>
      {pres.ctas.map((cta) => (
        <Link
          key={cta.href + cta.label}
          href={cta.href}
          className={
            cta.variant === "solid"
              ? "rounded-full bg-white px-5 py-2 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-black transition hover:bg-[var(--gold)] md:px-7 md:py-2.5 md:text-sm"
              : "rounded-full border border-white/25 bg-black/30 px-5 py-2 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-white backdrop-blur transition hover:bg-black/55 md:px-7 md:py-2.5 md:text-sm"
          }
        >
          {cta.label}
        </Link>
      ))}
    </div>
  );
}

/**
 * ONE slide's inner content (image + gradient + overlay text + CTAs). Pure over
 * its props; shared by the carousel and the editor's live preview. `image` picks
 * desktop vs mobile art at the call site so we can render both breakpoints.
 */
function SlideBody({
  pres,
  image,
  focus,
  priority,
  sizes,
  compact,
}: {
  pres: ShopHeroPresentation;
  image: string;
  focus: ImageFocus;
  priority: boolean;
  sizes: string;
  compact: boolean;
}) {
  return (
    <>
      {image && image.trim() ? (
        <Image
          src={image}
          alt={heroTextLines(pres.title.text)[0] || "Greenway Shop banner"}
          fill
          priority={priority}
          sizes={sizes}
          className={`object-cover ${FOCUS_OBJECT_CLASS[focus]}`}
        />
      ) : (
        <div className="absolute inset-0 bg-[var(--charcoal)]" aria-hidden="true" />
      )}
      <div
        className={`absolute inset-0 ${gradientClass(pres.textAlign)}`}
        aria-hidden="true"
      />
      <div
        className={`relative flex h-full flex-col gap-1 px-5 py-5 md:gap-1.5 md:px-10 md:py-6 ${textBlockClass(
          pres.textAlign,
          pres.verticalAlign,
        )}`}
      >
        <BlockLines
          block={pres.eyebrow}
          baseClass={
            compact
              ? "text-[0.62rem] font-black uppercase tracking-[0.2em]"
              : "text-xs font-black uppercase tracking-[0.24em] md:text-sm"
          }
        />
        <BlockLines
          block={pres.title}
          baseClass={
            compact
              ? "text-2xl font-black uppercase leading-none tracking-tight"
              : "text-3xl font-black uppercase leading-[0.95] tracking-tight md:text-5xl lg:text-6xl"
          }
        />
        <BlockLines
          block={pres.subtitle}
          baseClass={
            compact
              ? "text-sm font-semibold leading-tight"
              : "text-sm font-semibold leading-snug md:text-lg lg:text-xl"
          }
          allowScriptScale
        />
        <CtaButtons pres={pres} />
      </div>
    </>
  );
}

/**
 * A single slide rendered at BOTH breakpoints (mobile art ~3:1, desktop wide).
 * Presentational + pure — the editor renders exactly this for its live preview.
 */
export function SlideView({
  presentation,
  priority = false,
}: {
  presentation: ShopHeroPresentation;
  priority?: boolean;
}) {
  return (
    <>
      {/* MOBILE (own art + focus, ~3:1). */}
      <div className="relative aspect-[3/1] overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40 md:hidden">
        <SlideBody
          pres={presentation}
          image={presentation.imageMobile || presentation.image}
          focus={presentation.imageFocusMobile}
          priority={priority}
          sizes="calc(100vw - 2rem)"
          compact
        />
      </div>
      {/* DESKTOP (own art + focus, wide/short). */}
      <div className="relative hidden min-h-[8.5rem] overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40 md:block md:min-h-[10.5rem]">
        <SlideBody
          pres={presentation}
          image={presentation.image}
          focus={presentation.imageFocus}
          priority={priority}
          sizes="(min-width: 1408px) 1408px, calc(100vw - 4rem)"
          compact={false}
        />
      </div>
    </>
  );
}

// ── The carousel wrapper (Hero.tsx engine + reduce-motion + keyboard/ARIA) ────

/** Read the current reduced-motion preference (SSR-safe: false on the server). */
function readReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Detect the user's reduced-motion preference (SSR-safe). */
function usePrefersReducedMotion(): boolean {
  // Lazy initializer reads the real value on the client's first render, so the
  // effect only needs to SUBSCRIBE for later changes — no synchronous setState
  // in the effect body (avoids react-hooks/set-state-in-effect cascades).
  const [reduced, setReduced] = useState<boolean>(readReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

export function ShopBannerCarousel({ slides }: { slides: ShopRenderSlide[] }) {
  const count = slides.length;
  const [activeRaw, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reducedMotion = usePrefersReducedMotion();

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
    setActive((c) => (c + 1) % count);
  }, [count]);
  const prev = useCallback(() => {
    if (count === 0) return;
    setActive((c) => (c - 1 + count) % count);
  }, [count]);

  // Auto-rotate — paused on hover/focus AND fully disabled for reduce-motion.
  useEffect(() => {
    if (paused || reducedMotion || count <= 1) return;
    timer.current = setInterval(() => {
      setActive((c) => (c + 1) % count);
    }, SHOP_CAROUSEL_AUTOPLAY_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [paused, reducedMotion, count]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (count <= 1) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      }
    },
    [count, prev, next],
  );

  if (count === 0) return null;

  return (
    <section className="border-b border-white/10 bg-black px-4 py-4 md:px-8 md:py-5">
      <div className="mx-auto max-w-[var(--shop-max)]">
        <div
          className="relative isolate"
          role="region"
          aria-roledescription="carousel"
          aria-label="Greenway Shop highlights"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          {slides.map((slide, index) => {
            const isActive = index === active;
            return (
              <div
                key={slide.key}
                className={
                  isActive
                    ? "relative opacity-100 transition-opacity duration-700"
                    : "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-700"
                }
                aria-hidden={!isActive}
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}`}
              >
                <SlideView presentation={slide.presentation} priority={index === 0} />
              </div>
            );
          })}

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

              <div className="absolute bottom-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 md:bottom-3.5">
                {slides.map((slide, index) => (
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
