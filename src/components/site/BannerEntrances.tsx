"use client";

/**
 * R59-S2/S3 — plays a banner's entrances (banner-enter-core.entrancePlan) and
 * its intro curtain with the Web Animations API. Replaces R58 RevealWords
 * ("words wait for the smoke" is now just part of the plan).
 *
 * • Server HTML hides planned items (frame class .gw-enp + [data-gw-enter]) so
 *   there's no flash; this tiny island (not lazy) starts the animations
 *   (fill: backwards keeps each item invisible through its delay) and then
 *   drops the class.
 * • The curtain is rendered here, so it is in the server HTML from the first
 *   paint; it never takes clicks and leaves after `hold`.
 * • Replays every time the carousel shows the slide again, and on the Studio's
 *   ▶ replay (replayKey).
 * • Reduced motion: everything is shown at once and the curtain is skipped
 *   (WCAG 2.3.3). JavaScript off: a <noscript> rule does the same.
 * • Only opacity / translate / scale / rotate / clip-path / filter animate and
 *   every entrance ends implicitly, so items land on their own styling and
 *   their own motion (breathe, glow …) keeps running underneath.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { enterEasing, enterKeyframes, introOutKeyframes, introStyle, type Intro, type PlanItem } from "@/lib/cms/banner-enter-core";

const ANIM = "gw-en";

export function BannerEntrances({
  plan,
  intro,
  attr = "data-gw-enter",
  replayKey = 0,
  auto = true,
}: {
  plan: PlanItem[];
  intro?: Intro;
  /** which attribute carries the item id (site: data-gw-enter, Studio: data-studio-id). */
  attr?: string;
  replayKey?: number;
  /** false (Studio): only play on ▶ replay, so editing never re-covers the canvas. */
  auto?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const curtain = useRef<HTMLDivElement>(null);
  const play = useRef<() => void>(() => {});
  const planKey = JSON.stringify(plan);
  const introKey = intro ? `${intro.out}|${intro.hold}|${intro.dur}` : "";

  useEffect(() => {
    const frame = ref.current?.closest(".gw-dframe") as HTMLElement | null;
    if (!frame) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const items: PlanItem[] = JSON.parse(planKey);
    play.current = () => {
      const cur = curtain.current;
      if (still) {
        frame.classList.remove("gw-enp");
        if (cur) cur.style.display = "none";
        return;
      }
      for (const p of items) {
        const el = frame.querySelector<HTMLElement>(`[${attr}="${CSS.escape(p.id)}"]`);
        if (!el?.animate) continue;
        el.getAnimations().forEach((a) => a.id === ANIM && a.cancel());
        const filter = getComputedStyle(el).filter;
        const a = el.animate(enterKeyframes(p.fx, { filter }), {
          duration: p.dur * 1000,
          delay: p.start * 1000,
          easing: enterEasing({ fx: p.fx, ease: p.ease }, (el.textContent ?? "").trim().length),
          fill: "backwards",
        });
        a.id = ANIM;
      }
      if (cur && introKey && cur.animate) {
        const [out, hold, dur] = introKey.split("|");
        cur.style.display = "";
        cur.getAnimations().forEach((a) => a.cancel());
        const a = cur.animate(introOutKeyframes(out as Intro["out"]), { duration: Number(dur) * 1000, delay: Number(hold) * 1000, easing: "ease-in-out", fill: "both" });
        a.onfinish = () => {
          cur.style.display = "none";
        };
      }
      frame.classList.remove("gw-enp");
    };
    if (!auto) return;
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
  }, [planKey, introKey, attr, auto]);

  useEffect(() => {
    if (replayKey) play.current();
  }, [replayKey]);

  return (
    <>
      <span ref={ref} hidden />
      {intro ? <div ref={curtain} aria-hidden="true" className="gw-intro" style={{ ...(introStyle(intro) as CSSProperties), ...(auto ? {} : { display: "none" }) }} /> : null}
      <noscript>
        <style>{".gw-enp [data-gw-enter]{visibility:visible!important}.gw-intro{display:none!important}"}</style>
      </noscript>
    </>
  );
}
