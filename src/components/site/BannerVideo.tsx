"use client";

/**
 * R44 — a looping, silent MP4/WebM banner background (the modern "GIF").
 *
 * Grounding:
 *  • web.dev "Lazy-loading video": a GIF replacement is `autoplay muted loop
 *    playsinline`; `playsinline` is required for autoplay on iOS; a poster is
 *    the placeholder (and for the LCP banner the poster is what is measured, so
 *    the hero poster is preloaded at high priority).
 *  • WCAG 2.2 SC 2.2.2 Pause, Stop, Hide: auto-playing motion that lasts > 5 s
 *    beside other content needs a way to pause it → the visible pause button.
 *  • prefers-reduced-motion / Save-Data: never auto-play; show the still poster
 *    (or first frame) with a Play button so the shopper can opt in.
 *
 * Autoplay is started from an effect (not the `autoplay` attribute) so the
 * reduced-motion check happens BEFORE anything moves. Nothing downloads until
 * the banner is near the screen (preload="none" until then), and the video
 * pauses while scrolled away (saves battery + data).
 *
 * The video is decorative (aria-hidden): banner text/buttons are real HTML
 * laid over it, exactly as with an image.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { preload } from "react-dom";
import { posterForVideoSrc, videoMimeForSrc } from "@/lib/media/upload-policy-core";

export type BannerVideoProps = {
  src: string;
  /** Explicit poster; defaults to the auto-captured one for our own uploads. */
  poster?: string;
  className?: string;
  style?: CSSProperties;
  /** Above-the-fold hero: preload the poster at high priority (LCP). */
  priority?: boolean;
  /** Where the pause button sits. Default top-right (clear of carousel dots). */
  controlPosition?: "top-right" | "bottom-right" | "top-left" | "bottom-left";
  /** Small tiles: no button (they still honour reduced motion + pause offscreen). */
  hideControl?: boolean;
  /** Carousels: false for hidden slides (they overlap the visible one, so the
   *  viewport observer alone would keep them playing unseen). */
  active?: boolean;
};

const POS: Record<NonNullable<BannerVideoProps["controlPosition"]>, string> = {
  "top-right": "top-2 right-2",
  "bottom-right": "bottom-2 right-2",
  "top-left": "top-2 left-2",
  "bottom-left": "bottom-2 left-2",
};

/** Reduced-motion / Save-Data as an external store (server + first paint: no motion). */
function subscribeMotion(cb: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
}
function motionAllowed(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return !conn?.saveData;
}
const noMotionOnServer = () => false;

export function BannerVideo({
  src,
  poster,
  className,
  style,
  priority = false,
  controlPosition = "top-right",
  hideControl = false,
  active = true,
}: BannerVideoProps) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const posterUrl = poster ?? posterForVideoSrc(src);
  if (priority && posterUrl) preload(posterUrl, { as: "image", fetchPriority: "high" });

  const motionOk = useSyncExternalStore(subscribeMotion, motionAllowed, noMotionOnServer);
  // null = follow the motion preference; otherwise the shopper's own choice.
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const wantsPlay = choice ? choice === "play" : motionOk;
  const [playing, setPlaying] = useState(false);

  const visibleRef = useRef(false);
  const wantsRef = useRef(wantsPlay);
  const activeRef = useRef(active);

  /** Play exactly when: wanted, on screen, and its carousel slide is shown. */
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Carousel slides overlap, so "on screen" alone isn't enough: honour the
    // prop (Hero) and the nearest data-gw-slide marker (any carousel).
    const slide = el.parentElement?.closest("[data-gw-slide]");
    const slideShown = !slide || slide.getAttribute("data-gw-slide") !== "hidden";
    const go = wantsRef.current && visibleRef.current && activeRef.current && slideShown;
    if (go && el.paused) {
      el.muted = true; // the property (not just the attribute) gates autoplay
      void el.play().catch(() => setChoice("pause"));
    } else if (!go && !el.paused) {
      el.pause();
    }
  }, []);

  useEffect(() => {
    wantsRef.current = wantsPlay;
    activeRef.current = active;
    sync();
  }, [wantsPlay, active, sync]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const slide = el.parentElement?.closest("[data-gw-slide]");
    const mo = slide ? new MutationObserver(sync) : null;
    mo?.observe(slide!, { attributes: true, attributeFilter: ["data-gw-slide"] });
    if (typeof IntersectionObserver === "undefined") {
      visibleRef.current = true;
      el.preload = "metadata";
      sync();
      return () => mo?.disconnect();
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visibleRef.current = e.isIntersecting;
          // Nothing downloads until the banner is near the screen.
          if (e.isIntersecting && el.preload === "none") el.preload = "metadata";
        }
        sync();
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      mo?.disconnect();
    };
  }, [sync]);

  return (
    <>
      <video
        ref={ref}
        className={className}
        style={style}
        muted
        loop
        playsInline
        disablePictureInPicture
        preload={priority ? "metadata" : "none"}
        poster={posterUrl || undefined}
        aria-hidden="true"
        tabIndex={-1}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={src} type={videoMimeForSrc(src)} />
      </video>
      {hideControl || !active ? null : (
        <button
          type="button"
          onClick={() => setChoice(playing ? "pause" : "play")}
          aria-label={playing ? "Pause background video" : "Play background video"}
          aria-pressed={!playing}
          className={`absolute ${POS[controlPosition]} z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--gold,#d4af37)]`}
        >
          {playing ? (
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
              <rect x="3" y="2" width="3.5" height="12" rx="1" />
              <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="currentColor">
              <path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z" />
            </svg>
          )}
        </button>
      )}
    </>
  );
}
