"use client";

/**
 * D225 — what the browser says about rotating menu card pictures.
 *
 *  - reducedMotion: the shopper asked their device to reduce motion. Nothing
 *    rotates (WCAG 2.2 SC 2.3.3 / 2.2.2 good practice).
 *  - paused: the shopper pressed the pause control on any rotating card. It is
 *    one choice for the whole site, kept in localStorage, so pausing one card
 *    stops them all, and it is remembered on the next visit (WCAG 2.2 SC
 *    2.2.2 Pause, Stop, Hide).
 *  - hidden: the tab is in the background. No timers run.
 *
 * Read with useSyncExternalStore, so there is no setState in an effect body
 * and no hydration mismatch (the server snapshot is "motion ok, not paused,
 * visible", and the first paint shows the same picture either way).
 */
import { useCallback, useSyncExternalStore } from "react";
import { ROTATION_PAUSE_STORAGE_KEY, parsePausedFlag } from "@/lib/menu/menu-card-fallback-core";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const PAUSE_EVENT = "gw:menu-card-rotation-pause";

function subscribeReduced(cb: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}
const readReduced = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED_MOTION_QUERY).matches;

function subscribePaused(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(PAUSE_EVENT, cb);
  window.addEventListener("storage", cb); // another tab pressed pause
  return () => {
    window.removeEventListener(PAUSE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
/** Used only when localStorage is blocked (private mode on some browsers). */
let memoryPaused: boolean | null = null;

function readPaused(): boolean {
  if (memoryPaused !== null) return memoryPaused;
  try {
    return parsePausedFlag(window.localStorage.getItem(ROTATION_PAUSE_STORAGE_KEY));
  } catch {
    return false;
  }
}

function subscribeVisibility(cb: () => void) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
const readHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const serverFalse = () => false;

export function useRotationEnv(): { reducedMotion: boolean; paused: boolean; hidden: boolean; togglePaused: () => void } {
  const reducedMotion = useSyncExternalStore(subscribeReduced, readReduced, serverFalse);
  const paused = useSyncExternalStore(subscribePaused, readPaused, serverFalse);
  const hidden = useSyncExternalStore(subscribeVisibility, readHidden, serverFalse);

  const togglePaused = useCallback(() => {
    const next = !readPaused();
    try {
      if (next) window.localStorage.setItem(ROTATION_PAUSE_STORAGE_KEY, "1");
      else window.localStorage.removeItem(ROTATION_PAUSE_STORAGE_KEY);
      memoryPaused = null;
    } catch {
      memoryPaused = next;
    }
    window.dispatchEvent(new Event(PAUSE_EVENT));
  }, []);

  return { reducedMotion, paused, hidden, togglePaused };
}
