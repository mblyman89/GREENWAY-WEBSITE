"use client";

/**
 * R45-S1: the one client hook behind BOTH public carousels (home Hero and the
 * Shop banner). All decisions live in the pure, self-tested
 * src/lib/site/carousel-autoplay-core.ts; this file only wires browser events
 * to it.
 *
 *  - Environment (reduced motion, mobile width, tab hidden) is read with
 *    useSyncExternalStore, so there is no setState inside an effect body and
 *    no hydration mismatch (the server snapshot is "desktop, motion ok, visible").
 *  - Each dispatch first syncs that environment and the slide count into the
 *    reducer, so a toggle on a phone (where rotation defaults to off) correctly
 *    STARTS rotation instead of stopping it.
 *  - Focus only stops rotation when it is KEYBOARD focus (:focus-visible).
 *    Otherwise a mouse click on "Stop slide rotation" would focus the button
 *    (stop), then toggle (start), and rotation would keep going.
 *  - Swipe is touch or pen only. Mouse drags are left alone so text selection
 *    and the staff Move mode are not hijacked.
 */

import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";
import {
  MOBILE_MEDIA_QUERY,
  carouselReducer,
  classifySwipe,
  initialCarouselState,
  keyToNav,
  liveRegionMode,
  rotationButtonLabel,
  rotationEnabled,
  shouldRun,
  type CarouselEvent,
  type CarouselState,
} from "@/lib/site/carousel-autoplay-core";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMedia(query: string) {
  return (cb: () => void) => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia(query);
    mq.addEventListener?.("change", cb);
    return () => mq.removeEventListener?.("change", cb);
  };
}
const subscribeReduced = subscribeMedia(REDUCED_MOTION_QUERY);
const subscribeMobile = subscribeMedia(MOBILE_MEDIA_QUERY);
const readMedia = (query: string) => () =>
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
const readReduced = readMedia(REDUCED_MOTION_QUERY);
const readMobile = readMedia(MOBILE_MEDIA_QUERY);

function subscribeVisibility(cb: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
const readHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const serverFalse = () => false;

export type CarouselAutoplay = {
  state: CarouselState;
  active: number;
  rotating: boolean;
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  toggleRotation: () => void;
  /** Spread onto the role="region" element. */
  regionProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: (e: FocusEvent<HTMLElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: PointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
    style: { touchAction: "pan-y" };
  };
  /** Spread onto the APG rotation <button> (put it FIRST inside the region). */
  rotationButtonProps: {
    type: "button";
    onClick: () => void;
    "aria-label": string;
  };
  /** aria-live value for the element that wraps the slides. */
  liveMode: "off" | "polite";
};

export function useCarouselAutoplay(count: number, dwellFor: (index: number) => number): CarouselAutoplay {
  const reducedMotion = useSyncExternalStore(subscribeReduced, readReduced, serverFalse);
  const mobile = useSyncExternalStore(subscribeMobile, readMobile, serverFalse);
  const hidden = useSyncExternalStore(subscribeVisibility, readHidden, serverFalse);

  const [raw, dispatch] = useReducer(carouselReducer, count, (c: number) => initialCarouselState(c));

  // The state the UI and timer see: stored choices + live environment.
  const safeCount = Math.max(0, Math.floor(count));
  const state: CarouselState = {
    ...raw,
    count: safeCount,
    active: safeCount === 0 ? 0 : Math.min(raw.active, safeCount - 1),
    reducedMotion,
    mobile,
    hidden,
  };

  const envRef = useRef({ reducedMotion, mobile, hidden, count: safeCount });
  useEffect(() => {
    envRef.current = { reducedMotion, mobile, hidden, count: safeCount };
  });

  const send = useCallback((e: CarouselEvent) => {
    const env = envRef.current;
    dispatch({ type: "env", reducedMotion: env.reducedMotion, mobile: env.mobile });
    dispatch({ type: "visibility", hidden: env.hidden });
    dispatch({ type: "count", count: env.count });
    dispatch(e);
  }, []);

  // Timer: one setTimeout per slide so each slide gets its own dwell.
  const run = shouldRun(state);
  const dwell = dwellFor(state.active);
  const active = state.active;
  useEffect(() => {
    if (!run) return;
    const t = setTimeout(() => send({ type: "tick" }), dwell);
    return () => clearTimeout(t);
  }, [run, dwell, active, send]);

  const next = useCallback(() => send({ type: "next" }), [send]);
  const prev = useCallback(() => send({ type: "prev" }), [send]);
  const goTo = useCallback((index: number) => send({ type: "goto", index }), [send]);
  const toggleRotation = useCallback(() => send({ type: "toggleRotation" }), [send]);

  const swipe = useRef<{ x: number; y: number; t: number } | null>(null);

  const regionProps: CarouselAutoplay["regionProps"] = {
    onMouseEnter: () => send({ type: "hover", on: true }),
    onMouseLeave: () => send({ type: "hover", on: false }),
    onFocus: (e) => {
      const from = e.relatedTarget as Node | null;
      if (from && e.currentTarget.contains(from)) return; // moving inside
      const target = e.target as HTMLElement;
      let keyboard = false;
      try {
        keyboard = typeof target.matches === "function" && target.matches(":focus-visible");
      } catch {
        keyboard = false; // very old browsers without :focus-visible
      }
      if (keyboard) send({ type: "focusIn" });
    },
    onKeyDown: (e) => {
      const nav = keyToNav(e.key);
      if (!nav || safeCount <= 1) return;
      e.preventDefault();
      send({ type: nav });
    },
    onPointerDown: (e) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return;
      swipe.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    },
    onPointerUp: (e) => {
      const s = swipe.current;
      swipe.current = null;
      if (!s || safeCount <= 1) return;
      const nav = classifySwipe(e.clientX - s.x, e.clientY - s.y, e.timeStamp - s.t);
      if (nav) send({ type: nav });
    },
    onPointerCancel: () => {
      swipe.current = null;
    },
    style: { touchAction: "pan-y" },
  };

  return {
    state,
    active,
    rotating: rotationEnabled(state),
    next,
    prev,
    goTo,
    toggleRotation,
    regionProps,
    rotationButtonProps: {
      type: "button",
      onClick: toggleRotation,
      "aria-label": rotationButtonLabel(state),
    },
    liveMode: liveRegionMode(state),
  };
}
