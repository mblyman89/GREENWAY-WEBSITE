"use client";

/**
 * R58-S1 — "the cloud blows across, THEN the words appear". The banner's
 * words + buttons wait `seconds`, then fade up. Replays each time the carousel
 * shows the slide again.
 *
 * The server HTML starts them hidden (frame class .gw-rvp) so there's no flash;
 * this tiny component (not lazy) removes that class on mount. With JavaScript
 * off, a <noscript> style shows them, and visitors who ask for reduced motion
 * see them straight away (globals.css). The Web Animations API animates opacity
 * + translate only, so the words' own motion (breathe, glow …) keeps running.
 */
import { useEffect, useRef } from "react";

export function RevealWords({ seconds, replayKey = 0 }: { seconds: number; replayKey?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const play = useRef<() => void>(() => {});

  useEffect(() => {
    const frame = ref.current?.closest(".gw-dframe") as HTMLElement | null;
    if (!frame) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    play.current = () => {
      frame.classList.remove("gw-rvp");
      if (still || !seconds) return;
      const words = frame.querySelectorAll<HTMLElement>(':scope > .gw-dbox:not([aria-hidden="true"])');
      words.forEach((el, i) => {
        el.getAnimations?.().forEach((a) => a.id === "gw-rv" && a.cancel());
        const a = el.animate?.(
          { opacity: [0, 1], translate: ["0 14px", "0 0"] },
          { duration: 900, delay: seconds * 1000 + i * 90, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" },
        );
        if (a) a.id = "gw-rv";
      });
    };
    play.current();
    const slide = frame.closest("[data-gw-slide]");
    if (!slide) return;
    let shown = slide.getAttribute("data-gw-slide") !== "hidden";
    const mo = new MutationObserver(() => {
      const now = slide.getAttribute("data-gw-slide") !== "hidden";
      if (now && !shown) play.current();
      shown = now;
    });
    mo.observe(slide, { attributes: true, attributeFilter: ["data-gw-slide"] });
    return () => mo.disconnect();
  }, [seconds]);

  useEffect(() => {
    if (replayKey) play.current();
  }, [replayKey]);

  return (
    <>
      <span ref={ref} hidden />
      <noscript>
        <style>{".gw-rvp>.gw-dbox{visibility:visible!important}"}</style>
      </noscript>
    </>
  );
}
