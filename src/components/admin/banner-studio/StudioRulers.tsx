"use client";

/**
 * D263 S12 — inch rulers along the top and left of the Print Studio canvas
 * viewport. 0" = the trim's top-left (bleed reads as negative), matching the
 * X/Y inch fields. Ticks come from studio-zoom-core (rulerTicks) and re-measure
 * on scroll / zoom / resize via requestAnimationFrame, so scrolling never
 * re-renders the canvas itself. A marker follows the pointer.
 */
import { useEffect, useRef, useState } from "react";
import type { DesignPrint } from "@/lib/cms/banner-design-core";
import { rulerTicks, type RulerTick } from "@/lib/cms/studio-zoom-core";

export const RULER_PX = 18;

type Geo = { x: RulerTick[]; y: RulerTick[]; w: number; h: number };

export function StudioRulers({
  viewRef,
  print,
  scale,
  children,
}: {
  viewRef: React.RefObject<HTMLDivElement | null>;
  print: DesignPrint;
  scale: number;
  children: React.ReactNode;
}) {
  const [geo, setGeo] = useState<Geo>({ x: [], y: [], w: 0, h: 0 });
  const markX = useRef<HTMLDivElement>(null);
  const markY = useRef<HTMLDivElement>(null);
  const wIn = print.w + 2 * print.bleed;

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const frame = view.querySelector<HTMLElement>(".gw-dframe");
      if (!frame) return;
      const vr = view.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      const ppi = fr.width / wIn;
      const w = view.clientWidth;
      const h = view.clientHeight;
      setGeo({
        x: rulerTicks(fr.left - vr.left + print.bleed * ppi, ppi, w),
        y: rulerTicks(fr.top - vr.top + print.bleed * ppi, ppi, h),
        w,
        h,
      });
    };
    const queue = () => {
      if (!raf) raf = window.requestAnimationFrame(measure);
    };
    const move = (e: PointerEvent) => {
      const vr = view.getBoundingClientRect();
      if (markX.current) markX.current.style.transform = `translateX(${e.clientX - vr.left}px)`;
      if (markY.current) markY.current.style.transform = `translateY(${e.clientY - vr.top}px)`;
    };
    queue();
    view.addEventListener("scroll", queue, { passive: true });
    view.addEventListener("pointermove", move, { passive: true });
    const ro = new ResizeObserver(queue);
    ro.observe(view);
    if (view.firstElementChild) ro.observe(view.firstElementChild);
    return () => {
      view.removeEventListener("scroll", queue);
      view.removeEventListener("pointermove", move);
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [viewRef, wIn, print.bleed, scale]);

  const strip = "relative overflow-hidden bg-[#202329] text-[9px] leading-none text-white/55 select-none";
  return (
    <div className="grid min-h-0 flex-1 overflow-hidden rounded-md border border-white/10" style={{ gridTemplateColumns: `${RULER_PX}px 1fr`, gridTemplateRows: `${RULER_PX}px 1fr` }}>
      <div className="rounded-tl-md bg-[#202329] text-center text-[9px] leading-[18px] text-white/40" title="Rulers in inches from the trim (cut) edge">
        in
      </div>
      <div className={`${strip} border-b border-white/10`} aria-hidden="true" style={{ width: "100%" }}>
        {geo.x.map((t) => (
          <div key={t.at} className="absolute bottom-0" style={{ left: t.at }}>
            <div className="w-px bg-white/45" style={{ height: t.major ? 10 : 4 }} />
            {t.label !== undefined ? <span className="absolute left-0.5 top-[-8px]">{t.label}</span> : null}
          </div>
        ))}
        <div ref={markX} className="absolute left-0 top-0 h-full w-px bg-[var(--admin-accent)]" />
      </div>
      <div className={`${strip} border-r border-white/10`} aria-hidden="true">
        {geo.y.map((t) => (
          <div key={t.at} className="absolute right-0 flex justify-end" style={{ top: t.at }}>
            <div className="h-px bg-white/45" style={{ width: t.major ? 10 : 4 }} />
            {t.label !== undefined ? (
              <span className="absolute right-[10px] top-0.5 origin-top-right -rotate-90 whitespace-nowrap">{t.label}</span>
            ) : null}
          </div>
        ))}
        <div ref={markY} className="absolute left-0 top-0 h-px w-full bg-[var(--admin-accent)]" />
      </div>
      {children}
    </div>
  );
}
