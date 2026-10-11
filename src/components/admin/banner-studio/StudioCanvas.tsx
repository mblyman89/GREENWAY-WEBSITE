"use client";

/**
 * R41 S2 — Banner Studio live canvas (bible PART 5.6 / 5.7, Q6).
 *
 * WYSIWYG: renders the banner with the SAME pure style helpers as the public
 * DesignedBanner at the real reference widths — Desktop is laid out at 1408px
 * and scaled down to fit the card; Phone is laid out at 390px, so the same
 * `@container gwb (max-width: 767px)` rules from globals.css apply exactly as
 * they do for shoppers on a phone.
 *
 * Interactions:
 *  - Drag any text box or button (pointer events + setPointerCapture, works
 *    with mouse, pen and touch). Positions are stored in % of the banner.
 *  - Drag the right-edge handle of a selected text box to change its wrap width.
 *  - Snap guides: left edge 0%, centre 50%, right edge 100% (and top/middle).
 *    Hold Alt while dragging to turn snapping off.
 *  - Keyboard (WCAG 2.2 SC 2.5.7 — dragging always has a non-drag path):
 *    Tab to an item, arrows move 0.5% (Shift = 5%), Delete removes (asks
 *    first), Escape deselects. The side panels also have X/Y number boxes.
 *  - On "Phone" every move writes the phone overrides (mx/my/mw) only.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import {
  DESKTOP_REF_PX,
  MOBILE_REF_PX,
  boxPosition,
  boxStyle,
  buttonStyle,
  containerStyle,
  frameStyle,
  imageStyle,
  nudge,
  overlayStyle,
  resolveBoxText,
  roleInfo,
  type BannerDesign,
  type DesignDevice,
} from "@/lib/cms/banner-design-core";

export type StudioSelection = { target: "box" | "button"; id: string } | null;

const css = (s: Record<string, string>) => s as unknown as CSSProperties;
const half = (n: number) => Math.round(n * 2) / 2;
const SNAP = 1.5;

type Drag = {
  mode: "move" | "resize";
  target: "box" | "button";
  id: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  itemWpct: number;
  itemHpct: number;
  rectW: number;
  rectH: number;
  pointerId: number;
};

export function StudioCanvas({
  design,
  device,
  legacy,
  imageSrc,
  imageAlt,
  selection,
  onSelect,
  onChange,
  onRequestDelete,
  ghost = null,
}: {
  design: BannerDesign;
  device: DesignDevice;
  legacy: { eyebrow?: string; title?: string; subtitle?: string };
  imageSrc: string;
  imageAlt: string;
  selection: StudioSelection;
  onSelect: (s: StudioSelection) => void;
  onChange: (d: BannerDesign) => void;
  onRequestDelete: (s: NonNullable<StudioSelection>) => void;
  /** R41 S8: an AI suggestion to preview as a dotted "ghost" (zone + focal point). Display only. */
  ghost?: { zone: { x: number; y: number; w: number; h: number }; focusX: number; focusY: number } | null;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [availW, setAvailW] = useState(800);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const drag = useRef<Drag | null>(null);
  // Latest design for pointer handlers (avoid stale closures mid-drag).
  const designRef = useRef(design);
  useEffect(() => {
    designRef.current = design;
  }, [design]);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setAvailW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const refW = device === "mobile" ? MOBILE_REF_PX : DESKTOP_REF_PX;
  const scale = Math.min(1, availW / refW);
  const frameH = device === "mobile" ? design.frame.heightMobile : design.frame.height;

  const headline = design.boxes.find((b) => b.role === "headline" && !b.hidden);
  const overlay = overlayStyle(design, headline ? { x: headline.x + headline.w / 2, y: headline.y + 10 } : undefined);

  function startDrag(e: RPointerEvent<HTMLElement>, target: "box" | "button", id: string, mode: "move" | "resize") {
    if (e.button !== 0) return;
    const frame = frameRef.current;
    if (!frame) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect({ target, id });
    const rect = frame.getBoundingClientRect();
    const itemRect = (mode === "resize" ? (e.currentTarget.parentElement as HTMLElement) : e.currentTarget).getBoundingClientRect();
    const d = designRef.current;
    let origX = 0;
    let origY = 0;
    let origW = 0;
    if (target === "box") {
      const b = d.boxes.find((x) => x.id === id);
      if (!b) return;
      const p = boxPosition(b, device);
      origX = p.x;
      origY = p.y;
      origW = p.w;
    } else {
      const b = d.buttons.find((x) => x.id === id);
      if (!b) return;
      origX = device === "mobile" ? (b.mx ?? b.x) : b.x;
      origY = device === "mobile" ? (b.my ?? b.y) : b.y;
    }
    drag.current = {
      mode,
      target,
      id,
      startX: e.clientX,
      startY: e.clientY,
      origX,
      origY,
      origW,
      itemWpct: (itemRect.width / rect.width) * 100,
      itemHpct: (itemRect.height / rect.height) * 100,
      rectW: rect.width,
      rectH: rect.height,
      pointerId: e.pointerId,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: RPointerEvent<HTMLElement>) {
    const g = drag.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const dx = ((e.clientX - g.startX) / g.rectW) * 100;
    const dy = ((e.clientY - g.startY) / g.rectH) * 100;
    const snapOn = !e.altKey;
    const next: BannerDesign = JSON.parse(JSON.stringify(designRef.current));
    const v: number[] = [];
    const h: number[] = [];
    if (g.mode === "resize" && g.target === "box") {
      const b = next.boxes.find((x) => x.id === g.id);
      if (!b) return;
      let w = Math.min(100 - g.origX, Math.max(5, g.origW + dx));
      if (snapOn && Math.abs(g.origX + w - 100) <= SNAP) {
        w = 100 - g.origX;
        v.push(100);
      }
      if (snapOn && Math.abs(g.origX + w / 2 - 50) <= SNAP && g.origX < 50) {
        w = (50 - g.origX) * 2;
        v.push(50);
      }
      if (device === "mobile") b.mw = half(w);
      else b.w = half(w);
    } else {
      const w = g.itemWpct;
      let x = g.origX + dx;
      let y = g.origY + dy;
      if (snapOn) {
        if (Math.abs(x) <= SNAP) {
          x = 0;
          v.push(0);
        } else if (Math.abs(x + w / 2 - 50) <= SNAP) {
          x = 50 - w / 2;
          v.push(50);
        } else if (Math.abs(x + w - 100) <= SNAP) {
          x = 100 - w;
          v.push(100);
        }
        if (Math.abs(y) <= SNAP) {
          y = 0;
          h.push(0);
        } else if (Math.abs(y + g.itemHpct / 2 - 50) <= SNAP) {
          y = 50 - g.itemHpct / 2;
          h.push(50);
        } else if (Math.abs(y + g.itemHpct - 100) <= SNAP) {
          y = 100 - g.itemHpct;
          h.push(100);
        }
      }
      x = half(Math.min(100 - Math.min(w, 100), Math.max(0, x)));
      y = half(Math.min(100 - Math.min(g.itemHpct, 100), Math.max(0, y)));
      const item = g.target === "box" ? next.boxes.find((b) => b.id === g.id) : next.buttons.find((b) => b.id === g.id);
      if (!item) return;
      if (device === "mobile") {
        item.mx = x;
        item.my = y;
      } else {
        item.x = x;
        item.y = y;
      }
    }
    setGuides({ v, h });
    onChange(next);
  }

  function endDrag(e: RPointerEvent<HTMLElement>) {
    const g = drag.current;
    if (!g || g.pointerId !== e.pointerId) return;
    drag.current = null;
    setGuides({ v: [], h: [] });
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function onItemKey(e: React.KeyboardEvent, target: "box" | "button", id: string) {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dirs[e.key]) {
      e.preventDefault();
      const [dx, dy] = dirs[e.key];
      onSelect({ target, id });
      onChange(nudge(designRef.current, target, id, dx, dy, device, e.shiftKey));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRequestDelete({ target, id });
    } else if (e.key === "Escape") {
      e.preventDefault();
      onSelect(null);
      (e.currentTarget as HTMLElement).blur();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect({ target, id });
    }
  }

  const isSel = (t: "box" | "button", id: string) => selection?.target === t && selection.id === id;

  return (
    <div ref={outerRef} className="w-full">
      <div
        className="mx-auto"
        style={{ width: refW * scale, height: frameH * scale, maxWidth: "100%" }}
      >
        <div style={{ width: refW, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <div style={css(containerStyle())}>
            <div
              ref={frameRef}
              style={css(frameStyle(design))}
              className="gw-dframe select-none border border-white/10 bg-[var(--charcoal)]"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) onSelect(null);
              }}
            >
              {imageSrc ? (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element -- editor preview must show any path/URL, like ContentImageField */}
                  <img
                    src={imageSrc}
                    alt={imageAlt}
                    className="gw-dimg absolute inset-0 h-full w-full"
                    style={css(imageStyle(design))}
                    draggable={false}
                  />
                </div>
              ) : null}
              {overlay ? <div style={css(overlay)} aria-hidden="true" /> : null}

              {design.boxes.map((b) => {
                if (b.hidden) return null;
                if (device === "mobile" && b.hideOnMobile) return null;
                const text = resolveBoxText(b, legacy);
                const sel = isSel("box", b.id);
                return (
                  <div
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${roleInfo(b.role).label}: ${text.slice(0, 40) || "empty"}. Drag or use arrow keys to move.`}
                    aria-pressed={sel}
                    style={{ ...css(boxStyle(b)), cursor: "move", touchAction: "none", outline: sel ? "2px solid #7ed957" : "1px dashed rgba(255,255,255,0.35)", outlineOffset: 2, minHeight: "1em" }}
                    className="gw-dbox"
                    onPointerDown={(e) => startDrag(e, "box", b.id, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(e) => onItemKey(e, "box", b.id)}
                    onFocus={() => onSelect({ target: "box", id: b.id })}
                  >
                    {text || <span style={{ opacity: 0.45 }}>(empty {roleInfo(b.role).label.toLowerCase()})</span>}
                    {sel ? (
                      <span
                        aria-hidden="true"
                        title="Drag to change how wide the text can run before it wraps"
                        onPointerDown={(e) => startDrag(e, "box", b.id, "resize")}
                        onPointerMove={onPointerMove}
                        onPointerUp={endDrag}
                        onPointerCancel={endDrag}
                        style={{
                          position: "absolute",
                          right: -8,
                          top: "50%",
                          width: 14,
                          height: 28,
                          marginTop: -14,
                          borderRadius: 4,
                          background: "#7ed957",
                          cursor: "ew-resize",
                          touchAction: "none",
                          transform: `scale(${1 / scale})`,
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}

              {design.buttons.map((btn) => {
                if (!btn.enabled) return null;
                if (device === "mobile" && btn.hideOnMobile) return null;
                const sel = isSel("button", btn.id);
                return (
                  <div
                    key={btn.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Button ${btn.label}. Drag or use arrow keys to move.`}
                    aria-pressed={sel}
                    style={{ ...css(buttonStyle(btn)), cursor: "move", touchAction: "none", outline: sel ? "2px solid #7ed957" : "none", outlineOffset: 3 }}
                    className="gw-dbox gw-dbtn"
                    onPointerDown={(e) => startDrag(e, "button", btn.id, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(e) => onItemKey(e, "button", btn.id)}
                    onFocus={() => onSelect({ target: "button", id: btn.id })}
                  >
                    {btn.label}
                  </div>
                );
              })}

              {ghost ? (
                <>
                  <div
                    aria-hidden="true"
                    data-gw-ai-ghost="zone"
                    className="pointer-events-none absolute"
                    style={{
                      left: `${ghost.zone.x}%`,
                      top: `${ghost.zone.y}%`,
                      width: `${ghost.zone.w}%`,
                      height: `${ghost.zone.h}%`,
                      border: `${3 / scale}px dotted #ffd700`,
                      background: "rgba(255,215,0,0.10)",
                      borderRadius: 8 / scale,
                    }}
                  />
                  <div
                    aria-hidden="true"
                    data-gw-ai-ghost="focus"
                    className="pointer-events-none absolute"
                    style={{
                      left: `${ghost.focusX}%`,
                      top: `${ghost.focusY}%`,
                      width: 28 / scale,
                      height: 28 / scale,
                      transform: "translate(-50%, -50%)",
                      border: `${3 / scale}px solid #ffd700`,
                      borderRadius: "999px",
                      boxShadow: "0 0 0 3px rgba(0,0,0,0.5)",
                    }}
                  />
                </>
              ) : null}
              {guides.v.map((g) => (
                <div key={`v${g}`} aria-hidden="true" className="pointer-events-none absolute inset-y-0" style={{ left: `${g}%`, width: 0, borderLeft: `${2 / scale}px dashed #ff7f00` }} />
              ))}
              {guides.h.map((g) => (
                <div key={`h${g}`} aria-hidden="true" className="pointer-events-none absolute inset-x-0" style={{ top: `${g}%`, height: 0, borderTop: `${2 / scale}px dashed #ff7f00` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
