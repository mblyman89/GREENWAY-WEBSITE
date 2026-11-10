"use client";

/**
 * D225 — a menu card picture that cross-fades through its category's
 * fallback pictures.
 *
 * Owner: "the cards with fallback images, should rotate images. that would be
 * fun I think."
 *
 * Only for cards the server marked imageIsFallback whose website category has
 * two or more owner pictures (Admin -> Menu Card Fallbacks). A card with its
 * OWN photo never reaches this component (ProductCardVisual decides).
 *
 * The rules (all pure, in menu-card-fallback-core):
 *   - the first paint is EXACTLY the server picture, in the same <img> markup
 *     as before, so nothing shifts and nothing differs at hydration;
 *   - the order starts from that picture and wraps (fallbackRotationOrder);
 *   - each card waits ROTATION_DWELL_MS plus its own stagger before the first
 *     change, so a grid never flips in unison;
 *   - the next picture is downloaded BEFORE it is shown, then fades in over
 *     the old one;
 *   - it only runs while the card is on screen, the tab is visible, the
 *     shopper has not asked for reduced motion, and the shopper has not
 *     pressed pause (shouldRotate). WCAG 2.2 SC 2.2.2: the pause control is a
 *     real button next to the picture (outside the product link), keyboard
 *     reachable, and the choice applies to every card and is remembered.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ROTATION_DWELL_MS,
  fallbackRotationOrder,
  rotationStaggerMs,
  shouldRotate,
} from "@/lib/menu/menu-card-fallback-core";
import { useRotationList } from "./MenuCardRotationProvider";
import { useRotationEnv } from "./useRotationEnv";

type Props = {
  itemId: string;
  category: string | null | undefined;
  imageUrl: string;
  alt: string;
};

/** The rotating list for this card (empty = do not rotate). */
export function useFallbackRotationOrder(category: string | null | undefined, imageUrl: string): string[] {
  const list = useRotationList(category);
  return useMemo(() => fallbackRotationOrder(list, imageUrl), [list, imageUrl]);
}

export function RotatingFallbackImage({ itemId, category, imageUrl, alt }: Props) {
  const order = useFallbackRotationOrder(category, imageUrl);
  const { reducedMotion, paused, hidden } = useRotationEnv();
  const [step, setStep] = useState(0);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);

  const count = order.length;
  const current = count > 0 ? order[step % count]! : imageUrl;
  const previous = count > 0 && step > 0 ? order[(step - 1) % count]! : null;
  const run = shouldRotate({ pictures: count, reducedMotion, paused, inView, hidden });

  // On screen? Only cards the shopper can see spend timers and downloads.
  useEffect(() => {
    const el = ref.current;
    if (!el || count < 2 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setInView(e.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [count]);

  // One timer at a time: wait, download the next picture, then show it.
  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    const wait = ROTATION_DWELL_MS + (step === 0 ? rotationStaggerMs(itemId) : 0);
    const t = setTimeout(() => {
      const nextUrl = order[(step + 1) % count]!;
      const img = new Image();
      const advance = () => {
        if (!cancelled) setStep((s) => s + 1);
      };
      img.onload = advance;
      img.onerror = advance;
      img.src = nextUrl;
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [run, step, count, order, itemId]);

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={previous ?? current}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-cover"
        data-slot="fallback-rotation"
      />
      {previous ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${step}:${current}`}
          src={current}
          alt=""
          aria-hidden="true"
          className="gw-fallback-fade-in absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </>
  );
}

/**
 * The pause / play control. Rendered by ProductCardVisual OUTSIDE the product
 * link (a button inside a link is invalid and unreachable for some readers),
 * positioned over the bottom-left corner of the picture. Hidden when the card
 * does not rotate or the shopper asked for reduced motion (nothing moves then).
 */
export function FallbackRotationToggle({
  category,
  imageUrl,
  productName,
}: {
  category: string | null | undefined;
  imageUrl: string;
  productName: string;
}) {
  const order = useFallbackRotationOrder(category, imageUrl);
  const { reducedMotion, paused, togglePaused } = useRotationEnv();
  if (order.length < 2 || reducedMotion) return null;
  return (
    <button
      type="button"
      onClick={togglePaused}
      aria-pressed={paused}
      aria-label={paused ? `Play picture rotation (${productName})` : `Pause picture rotation (${productName})`}
      title={paused ? "Play picture rotation on all cards" : "Pause picture rotation on all cards"}
      data-slot="fallback-rotation-toggle"
      className="absolute bottom-1 left-1 z-10 inline-flex h-6 w-6 items-center justify-center rounded bg-black/55 text-[0.65rem] font-black text-white/90 backdrop-blur-sm transition hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
    >
      <span aria-hidden="true">{paused ? "\u25B6" : "\u275A\u275A"}</span>
    </button>
  );
}
