"use client";

/**
 * D263 S11 — the Print Studio zoom viewport. The canvas sits in a scrollable
 * "pasteboard" so the owner can zoom far in for fine corrections and scroll
 * left/right/up/down around the design. All the maths lives in
 * studio-zoom-core (pure, tested); this file only wires events to it.
 *
 * Zoom: slider (log scale), − / +, a % menu (Fit, Selection, 10%…3200% of
 * actual printed size), Ctrl/⌘ + / − / 0, Shift+0 (100%), Shift+1 (fit),
 * Shift+2 (selection), Ctrl/⌘ + wheel or trackpad pinch (anchored at the
 * pointer). Pan: scroll bars, wheel / Shift+wheel, Space+drag, middle-drag.
 * "Fit" follows the window size until the owner zooms.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { pctToIn, type BannerDesign, type DesignDevice } from "@/lib/cms/banner-design-core";
import { canvasRefPx } from "@/lib/cms/studio-widths-core";
import type { ItemRef } from "@/lib/cms/banner-arrange-core";
import {
  ZOOM_MIN_LOG,
  ZOOM_PRESETS,
  actualOf,
  anchorScroll,
  canvasOffset,
  clampScale,
  contentSize,
  fitScale,
  pctLabel,
  scaleForActual,
  scaleLimits,
  scaleOfSlider,
  sliderOf,
  stepScale,
  wheelFactor,
  zoomToRect,
  type Size,
} from "@/lib/cms/studio-zoom-core";

type Pt = { x: number; y: number };
const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (!!el.closest?.("input, textarea, select") || el.isContentEditable);
};
const btn = "rounded-md bg-white/10 px-2 py-1 text-xs text-white/85 hover:bg-white/20 disabled:opacity-30";

export function ZoomViewport({
  design,
  device,
  refs,
  canvas,
  tools,
  arrange,
  scopeRef,
  onBlank,
}: {
  design: BannerDesign;
  device: DesignDevice;
  /** Selected items (for zoom to selection). */
  refs: ItemRef[];
  /** Renders StudioCanvas at the given scale. */
  canvas: (scale: number) => ReactNode;
  tools?: ReactNode;
  arrange?: ReactNode;
  /** Keyboard shortcuts work while focus is inside this element (or the pointer is over the canvas). */
  scopeRef: React.RefObject<HTMLElement | null>;
  /** Click on the empty pasteboard (clears the selection). */
  onBlank?: () => void;
}) {
  const print = design.frame.print;
  const ref: Size = (() => {
    const r = canvasRefPx(design, device, null);
    return { w: r.w, h: r.h };
  })();
  const widthIn = print ? print.w + 2 * print.bleed : 0;
  const viewRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<Size>({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<number | null>(null); // null = fit (follows the window)
  const fit = fitScale(view, ref);
  const scale = zoom === null ? fit : clampScale(zoom, fit, ref.w);
  const limits = scaleLimits(fit, ref.w);

  // Pending scroll for the next layout (applied after the canvas resizes) and the
  // in-flight target, so fast wheel/pinch events chain from the latest zoom.
  const pending = useRef<Pt | null>(null);
  const inflight = useRef<{ scale: number; scroll: Pt } | null>(null);

  useLayoutEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = viewRef.current;
    const p = pending.current;
    if (el && p) {
      el.scrollLeft = p.x;
      el.scrollTop = p.y;
    }
    pending.current = null;
    inflight.current = null;
  }, [scale, zoom, view.w, view.h]);

  function apply(to: number, scroll: Pt) {
      const el = viewRef.current;
      inflight.current = { scale: to, scroll };
      if (Math.abs(to - scale) < 1e-6 && el) {
        el.scrollLeft = scroll.x;
        el.scrollTop = scroll.y;
        inflight.current = null;
        return;
      }
      pending.current = scroll;
      setZoom(Math.abs(to - fit) < fit * 1e-4 ? null : to);
  }

  /** Zoom to `to`, keeping the canvas point under `at` (viewport px; default = centre) still. */
  function zoomTo(to: number, at?: Pt) {
      const el = viewRef.current;
      if (!el || !view.w) return;
      const from = inflight.current?.scale ?? scale;
      const scroll = inflight.current?.scroll ?? { x: el.scrollLeft, y: el.scrollTop };
      const t = clampScale(to, fit, ref.w);
      apply(t, anchorScroll({ view, ref, scroll, at: at ?? { x: view.w / 2, y: view.h / 2 }, from, to: t }));
  }

  const toFit = () => {
    inflight.current = null;
    if (zoom === null) {
      viewRef.current?.scrollTo(0, 0);
      return;
    }
    pending.current = { x: 0, y: 0 };
    setZoom(null);
  };

  /** Zoom so the selected item(s) fill the view (nothing selected = fit). */
  const toSelection = () => {
    const el = viewRef.current;
    const frame = el?.querySelector<HTMLElement>(".gw-dframe");
    if (!el || !frame || !refs.length) return toFit();
    const fr = frame.getBoundingClientRect();
    let b: { l: number; t: number; r: number; b: number } | null = null;
    for (const r of refs) {
      const n = frame.querySelector<HTMLElement>(`[data-studio-id="${CSS.escape(r.id)}"]`);
      if (!n) continue;
      const q = n.getBoundingClientRect();
      b = b ? { l: Math.min(b.l, q.left), t: Math.min(b.t, q.top), r: Math.max(b.r, q.right), b: Math.max(b.b, q.bottom) } : { l: q.left, t: q.top, r: q.right, b: q.bottom };
    }
    if (!b) return toFit();
    const s = fr.width / ref.w; // live on-screen scale
    const z = zoomToRect(view, ref, { x: (b.l - fr.left) / s, y: (b.t - fr.top) / s, w: (b.r - b.l) / s, h: (b.b - b.t) / s }, fit);
    apply(z.scale, z.scroll);
  };

  const step = (dir: 1 | -1) => zoomTo(stepScale(inflight.current?.scale ?? scale, dir, fit, ref.w, widthIn));
  const actual = (a: number) => zoomTo(scaleForActual(a, ref.w, widthIn));

  // Latest handlers for the long-lived DOM listeners below.
  const live = useRef({ zoomTo, step, toFit, toSelection, actual, scale });
  useLayoutEffect(() => {
    live.current = { zoomTo, step, toFit, toSelection, actual, scale };
  });

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms at the pointer.
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const L = live.current;
      const from = inflight.current?.scale ?? L.scale;
      L.zoomTo(from * wheelFactor(e.deltaY, e.deltaMode), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keyboard: zoom keys + Space-to-pan. Active while the pointer is over the
  // canvas or focus is inside the studio, so the rest of the page is untouched.
  const hover = useRef(false);
  const [space, setSpace] = useState(false);
  useEffect(() => {
    const inScope = () => hover.current || !!scopeRef.current?.contains(document.activeElement);
    const down = (e: KeyboardEvent) => {
      if (!inScope()) return;
      const L = live.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && (e.key === "=" || e.key === "+" || e.code === "NumpadAdd")) {
        e.preventDefault();
        L.step(1);
      } else if (mod && !e.altKey && (e.key === "-" || e.key === "_" || e.code === "NumpadSubtract")) {
        e.preventDefault();
        L.step(-1);
      } else if (mod && !e.altKey && (e.key === "0" || e.code === "Numpad0")) {
        e.preventDefault();
        L.toFit();
      } else if (!mod && e.shiftKey && !e.altKey && !typing(e.target) && (e.code === "Digit0" || e.code === "Digit1" || e.code === "Digit2")) {
        e.preventDefault();
        if (e.code === "Digit0") L.actual(1);
        else if (e.code === "Digit1") L.toFit();
        else L.toSelection();
      } else if (e.code === "Space" && !mod && hover.current && !typing(e.target)) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpace(false);
    };
    const off = () => setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", off);
    };
  }, [scopeRef]);

  // Pan with Space+drag or the middle button (captured before the canvas sees it).
  const pan = useRef<{ id: number; x: number; y: number; sl: number; st: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const spaceRef = useRef(false);
  useEffect(() => {
    spaceRef.current = space;
  }, [space]);

  // Pointer position readout (inches from the trim's top-left), written straight to the DOM.
  const posRef = useRef<HTMLSpanElement>(null);
  const showPos = (e: React.PointerEvent) => {
    const out = posRef.current;
    const frame = viewRef.current?.querySelector<HTMLElement>(".gw-dframe");
    if (!out || !frame || !print) return;
    const fr = frame.getBoundingClientRect();
    const px = ((e.clientX - fr.left) / fr.width) * 100;
    const py = ((e.clientY - fr.top) / fr.height) * 100;
    out.textContent = px < 0 || px > 100 || py < 0 || py > 100 ? "" : `x ${pctToIn(px, "x", print).toFixed(3)}″  y ${pctToIn(py, "y", print).toFixed(3)}″`;
  };

  const off = canvasOffset(view, ref, scale);
  const content = contentSize(view, ref, scale);
  const maxLog = Math.log2(limits.max / fit);
  const presets = ZOOM_PRESETS.filter((a) => {
    const s = scaleForActual(a, ref.w, widthIn);
    return s >= limits.min - 1e-6 && s <= limits.max + 1e-6;
  });
  const label = pctLabel(actualOf(scale, ref.w, widthIn));

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md bg-white/5 px-2 py-1.5" role="toolbar" aria-label="Zoom">
        {tools}
        <span className="mx-1 h-4 w-px bg-white/15" aria-hidden="true" />
        <button type="button" className={btn} onClick={() => step(-1)} disabled={scale <= limits.min + 1e-6} title="Zoom out (Ctrl/⌘ −)" aria-label="Zoom out">
          −
        </button>
        <input
          type="range"
          aria-label="Zoom"
          className="w-28 accent-[var(--admin-accent)] sm:w-40"
          min={ZOOM_MIN_LOG}
          max={Math.max(0, Math.round(maxLog * 100) / 100)}
          step={0.01}
          value={sliderOf(scale, fit)}
          onChange={(e) => zoomTo(scaleOfSlider(Number(e.target.value), fit))}
        />
        <button type="button" className={btn} onClick={() => step(1)} disabled={scale >= limits.max - 1e-6} title="Zoom in (Ctrl/⌘ +)" aria-label="Zoom in">
          +
        </button>
        <select
          aria-label="Zoom level"
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (v === "fit") toFit();
            else if (v === "sel") toSelection();
            else if (v) actual(Number(v));
          }}
          className="w-[5.5rem] rounded-md border border-white/15 bg-black/40 px-1.5 py-1 text-xs tabular-nums text-white/90"
          title="Zoom level (100% = real printed size on a typical screen)"
        >
          <option value="" hidden>
            {zoom === null ? `Fit ${label}` : label}
          </option>
          <option value="fit">Fit (Shift+1)</option>
          <option value="sel" disabled={!refs.length}>
            Selection (Shift+2)
          </option>
          {presets.map((a) => (
            <option key={a} value={a}>
              {pctLabel(a)}
              {a === 1 ? " · actual (Shift+0)" : ""}
            </option>
          ))}
        </select>
        <button type="button" className={zoom === null ? `${btn} ring-1 ring-[var(--admin-accent)]` : btn} onClick={toFit} title="Fit the whole design (Shift+1 or Ctrl/⌘ 0)">
          Fit
        </button>
        <button type="button" className={btn} onClick={() => actual(1)} disabled={!presets.includes(1)} title="Real printed size (Shift+0)">
          100%
        </button>
        <button type="button" className={btn} onClick={toSelection} disabled={!refs.length} title="Zoom to the selected item(s) (Shift+2)">
          ⌖ Selection
        </button>
      </div>
      {arrange}
      <div
        ref={viewRef}
        tabIndex={-1}
        aria-label="Canvas. Ctrl/⌘ + wheel to zoom, Space + drag to move around."
        className="relative min-h-0 flex-1 overflow-scroll rounded-md border border-white/10 bg-[#15171b] outline-none"
        style={{
          cursor: panning ? "grabbing" : space ? "grab" : undefined,
          backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
        onPointerEnter={() => (hover.current = true)}
        onPointerLeave={() => {
          hover.current = false;
          if (posRef.current) posRef.current.textContent = "";
        }}
        onPointerDownCapture={(e) => {
          if (!(spaceRef.current || e.button === 1)) return;
          const el = viewRef.current;
          if (!el) return;
          e.preventDefault();
          e.stopPropagation();
          el.setPointerCapture(e.pointerId);
          pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop };
          setPanning(true);
        }}
        onMouseDown={(e) => {
          if (e.button === 1) e.preventDefault(); // no browser auto-scroll
        }}
        onPointerMove={(e) => {
          const p = pan.current;
          const el = viewRef.current;
          if (p && el && p.id === e.pointerId) {
            el.scrollLeft = p.sl - (e.clientX - p.x);
            el.scrollTop = p.st - (e.clientY - p.y);
          } else showPos(e);
        }}
        onPointerUp={() => {
          pan.current = null;
          setPanning(false);
        }}
        onPointerCancel={() => {
          pan.current = null;
          setPanning(false);
        }}
        onPointerDown={(e) => {
          const el = e.currentTarget;
          const r = el.getBoundingClientRect();
          const onBar = e.clientX - r.left >= el.clientWidth || e.clientY - r.top >= el.clientHeight; // scroll bars keep the selection
          if (!onBar && (e.target === el || e.target === el.firstElementChild)) onBlank?.();
        }}
      >
        <div style={{ position: "relative", width: content.w, height: content.h }}>
          {view.w ? (
            <div className="shadow-[0_8px_32px_rgba(0,0,0,0.6)]" style={{ position: "absolute", left: off.x, top: off.y, width: ref.w * scale, height: ref.h * scale }}>
              {canvas(scale)}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[0.7rem] text-white/50">
        <span>Ctrl/⌘ + wheel or pinch = zoom · Space + drag or middle-drag = move around · Shift+1 fit · Shift+2 selection · Shift+0 real size</span>
        <span ref={posRef} className="tabular-nums text-white/75" aria-live="off" />
      </div>
    </div>
  );
}
