"use client";

import Link from "next/link";
import { useCallback } from "react";
import type { RenderSlide } from "@/lib/cms/carousel-types";
import { BannerMedia } from "@/components/site/BannerMedia";
import { CarouselRotationButton } from "@/components/site/CarouselRotationButton";
import { useCarouselAutoplay } from "@/components/site/useCarouselAutoplay";
import { dwellMs, slideFetchPriority, wordCount } from "@/lib/site/carousel-autoplay-core";
import { DesignedBanner } from "@/components/site/DesignedBanner";
import { ensureBoundBoxes } from "@/lib/cms/banner-design-core";
import { clickZoneAttrs } from "@/lib/analytics/click-events-core";
import {
  effectiveLayout,
  homeLegacyWords,
  type HomeLineStyle,
} from "@/lib/cms/home-slide-advanced-core";
import {
  heroColorHex,
  heroFontStack,
  isScriptHeroFont,
  type ImageFocus,
  type TextAlign,
  type TextVAlign,
} from "@/lib/loyalty/loyalty-hero-core";

/** Base dwell per slide; text-heavy slides earn more (R45-S1, Baymard 5-10 s). */
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
 * never renders blank.
 *
 * R45-S1 (W3C APG carousel pattern + WCAG 2.2.2 + Baymard): a Stop/Start
 * rotation button comes first in Tab order; keyboard focus entering the
 * carousel or any manual nav (arrow, dot, swipe, Left/Right key) stops rotation
 * for good; hover and a hidden browser tab pause it; phones and
 * "reduce motion" users start with rotation OFF; text-heavy slides stay up
 * longer; only the first slide's image is fetched at high priority. All rules
 * live in src/lib/site/carousel-autoplay-core.ts (self-tested).
 */
export function Hero({
  slides,
  editable = false,
}: {
  slides: RenderSlide[];
  /** R43: staff preview only — tags the carousel for its green ✎ Edit button. */
  editable?: boolean;
}) {
  const safeSlides = slides.length > 0 ? slides : [];
  const count = safeSlides.length;

  const dwellFor = useCallback(
    (index: number) => {
      const slide = slides[index];
      if (!slide) return AUTOPLAY_MS;
      return dwellMs(
        AUTOPLAY_MS,
        wordCount([slide.eyebrow, slide.title, slide.description, ...slide.ctas.map((c) => c.label)]),
      );
    },
    [slides],
  );
  const carousel = useCarouselAutoplay(count, dwellFor);
  const { active, next, prev, goTo } = carousel;

  if (count === 0) return null;

  return (
    <section
      id="top"
      className="border-b border-white/10 px-4 py-4 md:px-8 md:py-5"
    >
      <div className="mx-auto max-w-[88rem]">
        <div
          {...(editable ? { "data-gw-edit-area": "home-carousel" } : {})}
          className="relative isolate overflow-hidden rounded-2xl border border-white/10 bg-[var(--charcoal)] shadow-2xl shadow-black/40"
          role="region"
          aria-roledescription="carousel"
          aria-label="Greenway featured highlights"
          {...carousel.regionProps}
        >
          {/* APG: the rotation control is the FIRST focusable thing inside, so
              the control row (rotation + dots) comes first in the DOM; it is
              positioned at the bottom centre visually. */}
          {count > 1 ? (
            <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 md:bottom-3">
              <CarouselRotationButton {...carousel.rotationButtonProps} rotating={carousel.rotating} />
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
          ) : null}
          <div aria-live={carousel.liveMode} aria-atomic="false">
          {safeSlides.map((slide, index) => {
            const isActive = index === active;
            // R47: a slide with advanced options (Banner Studio design, line
            // styles, phone picture, 5-way focus, centre / top / bottom text)
            // renders through AdvancedSlide. advanced === null keeps the
            // classic markup below exactly as before.
            if (slide.advanced) {
              return (
                <AdvancedSlide
                  key={slide.key}
                  slide={slide}
                  index={index}
                  count={count}
                  isActive={isActive}
                  designOwner={editable && slide.id ? `home-slide:${slide.id}` : undefined}
                />
              );
            }
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
                data-gw-slide={isActive ? "shown" : "hidden"}
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}: ${slide.title}`}
                {...clickZoneAttrs({
                  place: "home_hero",
                  slot: slide.key,
                  label: slide.title || slide.eyebrow || null,
                  position: index,
                })}
              >
                {slide.image ? (
                  <BannerMedia
                    src={slide.image}
                    alt={slide.imageAlt || slide.title || "Greenway"}
                    priority={index === 0}
                    fetchPriority={slideFetchPriority(index)}
                    active={isActive}
                    blurDataURL={slide.imageBlur}
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
                    // R45-S1: one <h1> per page. Slide 1 owns it; the others
                    // are <h2> with the identical look.
                    <SlideHeading first={index === 0}>{slide.title}</SlideHeading>
                  ) : null}
                  {slide.description ? (
                    <p className="mt-2 max-w-md whitespace-pre-line text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:text-base">
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
          </div>

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

            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** R45-S1: slide 1 owns the page's single <h1>; later slides use an identical-looking <h2>. */
function SlideHeading({
  first,
  children,
  style,
  extraClass,
}: {
  first: boolean;
  children: React.ReactNode;
  /** R47: advanced line style (absent on classic slides = unchanged markup). */
  style?: React.CSSProperties;
  extraClass?: string;
}) {
  if (style === undefined && extraClass === undefined) {
    // Classic slides: byte-identical markup to before R47.
    return first ? (
      <h1 className="mt-2 whitespace-pre-line text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-5xl lg:text-6xl">
        {children}
      </h1>
    ) : (
      <h2 className="mt-2 whitespace-pre-line text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-5xl lg:text-6xl">
        {children}
      </h2>
    );
  }
  const cls = `mt-2 whitespace-pre-line text-3xl font-black uppercase leading-none tracking-tight text-white md:mt-3 md:text-5xl lg:text-6xl${extraClass ? ` ${extraClass}` : ""}`;
  return first ? (
    <h1 className={cls} style={style}>
      {children}
    </h1>
  ) : (
    <h2 className={cls} style={style}>
      {children}
    </h2>
  );
}

// ── R47: advanced home slides ──────────────────────────────────────────────

const OBJ: Record<ImageFocus, string> = {
  center: "object-center",
  top: "object-top",
  bottom: "object-bottom",
  left: "object-left",
  right: "object-right",
};
const MD_OBJ: Record<ImageFocus, string> = {
  center: "md:object-center",
  top: "md:object-top",
  bottom: "md:object-bottom",
  left: "md:object-left",
  right: "md:object-right",
};

function advGradient(textAlign: TextAlign): string {
  if (textAlign === "right")
    return "bg-[linear-gradient(270deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]";
  if (textAlign === "center")
    return "bg-[linear-gradient(180deg,rgba(0,0,0,0.5)_0%,rgba(0,0,0,0.68)_50%,rgba(0,0,0,0.5)_100%)]";
  return "bg-[linear-gradient(90deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.82)_42%,rgba(0,0,0,0.34)_72%,rgba(0,0,0,0.08)_100%)]";
}

/** Inline font / colour / cursive size for one line ("" font/colour = classic). */
function lineStyle(l: HomeLineStyle): { style: React.CSSProperties; className: string } {
  const style: React.CSSProperties = {};
  if (l.font) style.fontFamily = heroFontStack(l.font);
  if (l.color) style.color = heroColorHex(l.color);
  const script = l.font ? isScriptHeroFont(l.font) : false;
  if (script && l.scriptScale > 1) style.fontSize = `${l.scriptScale}em`;
  return { style, className: script ? "normal-case tracking-normal" : "" };
}

function AdvancedSlide({
  slide,
  index,
  count,
  isActive,
  designOwner,
}: {
  slide: RenderSlide;
  index: number;
  count: number;
  isActive: boolean;
  /** R48: "home-slide:<uuid>" in staff preview only, so Move mode can save drags. */
  designOwner?: string;
}) {
  const adv = slide.advanced!;
  const layout = effectiveLayout({ imageFocus: slide.imageFocus, textAlign: slide.textAlign }, adv);
  const words = homeLegacyWords(
    { eyebrow: slide.eyebrow, title: slide.title, description: slide.description },
    adv,
  );
  const wrapperCls = isActive
    ? "relative opacity-100 transition-opacity duration-700"
    : "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-700";
  const common = {
    "aria-hidden": !isActive,
    "data-gw-slide": isActive ? "shown" : "hidden",
    "aria-roledescription": "slide",
    "aria-label": `${index + 1} of ${count}: ${slide.title}`,
    // R47-S2: click analytics zone.
    ...clickZoneAttrs({
      place: "home_hero",
      slot: slide.key,
      label: words.title || words.eyebrow || slide.title || null,
      position: index,
    }),
  };

  // Banner Studio design (drag-anywhere text / buttons, tint, zoom…).
  if (adv.design?.enabled) {
    return (
      <div className={`w-full ${wrapperCls}`} {...common}>
        <DesignedBanner
          design={ensureBoundBoxes(adv.design, words)}
          imageSrc={slide.image || adv.imageMobile}
          imageAlt={slide.imageAlt || slide.title || "Greenway"}
          legacy={words}
          headingLevel={index === 0 ? 1 : 2}
          priority={index === 0}
          editable={!!designOwner}
          owner={designOwner}
        />
      </div>
    );
  }

  const v: TextVAlign = layout.verticalAlign;
  const rowAlign = v === "top" ? "items-start" : v === "bottom" ? "items-end" : "items-center";
  const ta = layout.textAlign;
  const textBox =
    ta === "right" ? "ml-auto text-right md:pr-14" : ta === "center" ? "mx-auto text-center" : "";
  const ctaJustify = ta === "right" ? "justify-end" : ta === "center" ? "justify-center" : "";
  const eb = lineStyle(adv.eyebrow);
  const ti = lineStyle(adv.title);
  const de = lineStyle(adv.description);
  const alt = slide.imageAlt || slide.title || "Greenway";
  const sizes = "(max-width: 768px) 100vw, 1408px";

  return (
    <div className={`flex min-h-[8.5rem] md:min-h-[10.5rem] ${rowAlign} ${wrapperCls}`} {...common}>
      {adv.imageMobile ? (
        <>
          <div className="absolute inset-0 md:hidden">
            <BannerMedia
              src={adv.imageMobile}
              alt={alt}
              priority={index === 0}
              fetchPriority={slideFetchPriority(index)}
              active={isActive}
              blurDataURL={slide.imageMobileBlur}
              sizes="100vw"
              className={`object-cover ${OBJ[layout.imageFocusMobile]}`}
            />
          </div>
          {slide.image ? (
            <div className="absolute inset-0 hidden md:block">
              <BannerMedia
                src={slide.image}
                alt={alt}
                priority={index === 0}
                fetchPriority={slideFetchPriority(index)}
                active={isActive}
                blurDataURL={slide.imageBlur}
                sizes={sizes}
                className={`object-cover ${OBJ[layout.imageFocus]}`}
              />
            </div>
          ) : null}
        </>
      ) : slide.image ? (
        <BannerMedia
          src={slide.image}
          alt={alt}
          priority={index === 0}
          fetchPriority={slideFetchPriority(index)}
          active={isActive}
          blurDataURL={slide.imageBlur}
          sizes={sizes}
          className={`object-cover ${OBJ[layout.imageFocusMobile]} ${MD_OBJ[layout.imageFocus]}`}
        />
      ) : null}
      <div className={`absolute inset-0 ${advGradient(ta)}`} aria-hidden="true" />
      <div className={`relative max-w-[80%] px-5 py-6 md:max-w-[58%] md:px-10 ${textBox}`}>
        {words.eyebrow ? (
          <p
            className={`inline-flex whitespace-pre-line rounded-full border border-white/20 bg-black/40 px-3 py-1 text-[0.6rem] font-black uppercase tracking-[0.2em] text-[var(--greenway)] backdrop-blur md:text-xs ${eb.className}`}
            style={eb.style}
          >
            {words.eyebrow}
          </p>
        ) : null}
        {words.title ? (
          <SlideHeading first={index === 0} style={ti.style} extraClass={ti.className}>
            {words.title}
          </SlideHeading>
        ) : null}
        {words.subtitle ? (
          <p
            className={`mt-2 max-w-md whitespace-pre-line text-xs font-semibold leading-5 text-zinc-300 md:mt-3 md:text-base ${ta === "center" ? "mx-auto" : ta === "right" ? "ml-auto" : ""} ${de.className}`}
            style={de.style}
          >
            {words.subtitle}
          </p>
        ) : null}
        {slide.ctas.length > 0 ? (
          <div className={`mt-4 flex flex-wrap gap-3 md:mt-5 ${ctaJustify}`}>
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
}
