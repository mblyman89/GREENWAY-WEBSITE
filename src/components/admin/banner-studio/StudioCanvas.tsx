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
 *  - R53: clicking an item focuses it, so the arrow keys work straight away
 *    (before, pointerdown's preventDefault stopped focus, so only Tab worked).
 *  - R53: double-click a text box to type on the canvas. contenteditable
 *    "plaintext-only" (Enter = new line, no pasted formatting); Esc or
 *    clicking away commits as ONE change (one undo step for free-text boxes).
 *    Bound boxes (eyebrow/title/description) write the banner's own field.
 *  - R55: shapes (drag, width handle, arrows) and layer order (z-index, same
 *    rule as the public banner). Locked items select but never move.
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
  layerZ,
  nudge,
  overlayStyle,
  resolveBoxText,
  roleInfo,
  type BannerDesign,
  type DesignBind,
  type DesignDevice,
} from "@/lib/cms/banner-design-core";
import { isVideoSrc } from "@/lib/media/upload-policy-core";
import { elementPosition } from "@/lib/cms/banner-elements-core";
import { CanvasGuides, CanvasShape, RotateHandle, WidthHandle } from "./CanvasParts";
import { angleFromPointer, hasRef, moveGroup, rotateItem, snapMove, type ItemRef } from "@/lib/cms/banner-arrange-core";

export type StudioTarget = "box" | "button" | "element";
export type StudioSelection = { target: StudioTarget; id: string } | null;

const css = (s: Record<string, string>) => s as unknown as CSSProperties;
const half = (n: number) => Math.round(n * 2) / 2;
const SNAP = 1.5;

type Drag = {
  mode: "move" | "resize" | "rotate" | "group";
  /** R56: the design when the drag began + the group being moved / rotation centre (px). */
  from: BannerDesign;
  refs: ItemRef[];
  cx: number;
  cy: number;
  target: StudioTarget;
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
  onLegacyEdit,
  group = [],
  onToggle,
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
  /** R53: inline edit of a bound box (eyebrow/title/subtitle) → the banner's own field. */
  onLegacyEdit?: (bind: NonNullable<DesignBind>, text: string) => void;
  /** R56: shift-click multi-selection (2+ items) and the toggle for it. */
  group?: ItemRef[];
  onToggle?: (r: ItemRef) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const editDone = useRef(false);
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
  const z = layerZ(design);
  const zOf = (id: string): CSSProperties => {
    const n = z?.get(id);
    return n ? { zIndex: n } : {};
  };
  const isLocked = (target: StudioTarget, id: string) =>
    target === "box"
      ? !!design.boxes.find((b) => b.id === id)?.locked
      : target === "button"
        ? !!design.buttons.find((b) => b.id === id)?.locked
        : !!(design.elements ?? []).find((b) => b.id === id)?.locked;

  function startDrag(e: RPointerEvent<HTMLElement>, target: StudioTarget, id: string, mode: "move" | "resize" | "rotate") {
    if (e.button !== 0) return;
    if (editing && editing === id) return; // typing: let the caret move normally
    const frame = frameRef.current;
    if (!frame) return;
    e.preventDefault();
    e.stopPropagation();
    // R56: Shift/Ctrl/⌘-click adds or removes the item from a group selection.
    if (mode === "move" && (e.shiftKey || e.metaKey || e.ctrlKey) && onToggle) {
      onToggle({ target, id });
      return;
    }
    const inGroup = mode === "move" && group.length > 1 && hasRef(group, { target, id });
    // R53: preventDefault blocks the browser's focus-on-click — focus the item
    // ourselves so the arrow keys nudge it right after a click.
    const itemEl = (mode === "move" ? e.currentTarget : e.currentTarget.parentElement) as HTMLElement | null;
    itemEl?.focus({ preventScroll: true });
    if (!inGroup) onSelect({ target, id });
    if (!inGroup && isLocked(target, id)) return; // R55: locked = select only
    const rect = frame.getBoundingClientRect();
    const itemRect = (itemEl ?? e.currentTarget).getBoundingClientRect();
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
    } else if (target === "element") {
      const el = (d.elements ?? []).find((x) => x.id === id);
      if (!el) return;
      const p = elementPosition(el, device);
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
      mode: inGroup ? "group" : mode,
      from: d,
      refs: inGroup ? group : [],
      cx: itemRect.left + itemRect.width / 2,
      cy: itemRect.top + itemRect.height / 2,
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
    if (g.mode === "rotate") {
      onChange(rotateItem(designRef.current, { target: g.target, id: g.id }, angleFromPointer(g.cx, g.cy, e.clientX, e.clientY, e.shiftKey)));
      return;
    }
    if (g.mode === "group") {
      onChange(moveGroup(g.from, g.refs, dx, dy, device));
      return;
    }
    if (g.mode === "resize" && g.target === "element") {
      const el = (next.elements ?? []).find((x) => x.id === g.id);
      if (!el) return;
      const w = half(Math.min(100, Math.max(1, g.origW + dx)));
      if (device === "mobile") el.mw = w;
      else el.w = w;
    } else if (g.mode === "resize" && g.target === "box") {
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
      const sn = snapMove(g.origX + dx, g.origY + dy, g.itemWpct, g.itemHpct, snapOn);
      v.push(...sn.v);
      h.push(...sn.h);
      const { x, y } = sn;
      const item =
        g.target === "box"
          ? next.boxes.find((b) => b.id === g.id)
          : g.target === "element"
            ? (next.elements ?? []).find((b) => b.id === g.id)
            : next.buttons.find((b) => b.id === g.id);
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

  function startEdit(id: string) {
    const b = designRef.current.boxes.find((x) => x.id === id);
    if (!b || (b.bind && !onLegacyEdit)) return;
    editDone.current = false;
    setEditing(id);
  }

  function commitEdit(el: HTMLElement, id: string) {
    if (editDone.current) return;
    editDone.current = true;
    setEditing(null);
    // innerText turns the line breaks the browser inserted into "\n".
    const text = el.innerText.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    const d = designRef.current;
    const b = d.boxes.find((x) => x.id === id);
    if (!b || text === resolveBoxText(b, legacy)) return;
    if (b.bind) onLegacyEdit?.(b.bind, text);
    else onChange({ ...d, boxes: d.boxes.map((x) => (x.id === id ? { ...x, text } : x)) });
  }

  function onItemKey(e: React.KeyboardEvent, target: StudioTarget, id: string) {
    if (editing === id) {
      if (e.key === "Escape") {
        e.preventDefault();
        commitEdit(e.currentTarget as HTMLElement, id);
      }
      return; // every other key types (Enter = new line)
    }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const many = group.length > 1 && hasRef(group, { target, id });
    if (many && (e.key === "Delete" || e.key === "Backspace")) return; // the Arrange bar removes the whole group
    if (dirs[e.key] && many) {
      e.preventDefault();
      const st = e.shiftKey ? 5 : 0.5;
      onChange(moveGroup(designRef.current, group, dirs[e.key][0] * st, dirs[e.key][1] * st, device));
    } else if (dirs[e.key]) {
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

  const isSel = (t: StudioTarget, id: string) => selection?.target === t && selection.id === id && group.length < 2;
  const inGrp = (t: StudioTarget, id: string) => group.length > 1 && hasRef(group, { target: t, id });
  const outline = (t: StudioTarget, id: string, idle: string) => (isSel(t, id) ? "2px solid #7ed957" : inGrp(t, id) ? "2px dashed #ffd700" : idle);
  const handles = (t: StudioTarget, id: string, locked?: boolean) =>
    isSel(t, id) && !locked ? (
      <RotateHandle scale={scale} onStart={(e) => startDrag(e, t, id, "rotate")} onMove={onPointerMove} onEnd={endDrag} />
    ) : null;

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
                  {isVideoSrc(imageSrc) ? (
                    // R44: video banners preview live (muted loop), same focus/zoom/filters.
                    <video
                      src={imageSrc}
                      muted
                      loop
                      playsInline
                      autoPlay
                      preload="metadata"
                      aria-label={imageAlt || "Banner video"}
                      className="gw-dimg absolute inset-0 h-full w-full"
                      style={css(imageStyle(design))}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- editor preview must show any path/URL, like ContentImageField
                    <img
                      src={imageSrc}
                      alt={imageAlt}
                      className="gw-dimg absolute inset-0 h-full w-full"
                      style={css(imageStyle(design))}
                      draggable={false}
                    />
                  )}
                </div>
              ) : null}
              {overlay ? <div style={css(overlay)} aria-hidden="true" /> : null}

              {(design.elements ?? []).map((el) =>
                el.hidden || (device === "mobile" && el.hideOnMobile) ? null : (
                  <CanvasShape
                    key={el.id}
                    el={el}
                    selected={isSel("element", el.id)}
                    grouped={inGrp("element", el.id)}
                    scale={scale}
                    z={zOf(el.id)}
                    onStart={(e, mode) => startDrag(e, "element", el.id, mode)}
                    onMove={onPointerMove}
                    onEnd={endDrag}
                    onKey={(e) => onItemKey(e, "element", el.id)}
                    onFocus={() => onSelect({ target: "element", id: el.id })}
                  />
                ),
              )}

              {design.boxes.map((b) => {
                if (b.hidden) return null;
                if (device === "mobile" && b.hideOnMobile) return null;
                const text = resolveBoxText(b, legacy);
                const sel = isSel("box", b.id);
                const isEd = editing === b.id;
                if (isEd) {
                  // Remounts (new key) on enter/exit so React never fights the
                  // browser over the text nodes the user is typing into.
                  return (
                    <div
                      key={`${b.id}-edit`}
                      ref={(el) => {
                        if (el && document.activeElement !== el) {
                          el.focus({ preventScroll: true });
                          const r = document.createRange();
                          r.selectNodeContents(el);
                          r.collapse(false); // caret at the end
                          const s = window.getSelection();
                          s?.removeAllRanges();
                          s?.addRange(r);
                        }
                      }}
                      contentEditable="plaintext-only"
                      suppressContentEditableWarning
                      role="textbox"
                      aria-multiline="true"
                      aria-label={`Editing ${roleInfo(b.role).label}. Enter for a new line, Escape to finish.`}
                      style={{ ...css(boxStyle(b)), cursor: "text", outline: "2px solid #ffd700", outlineOffset: 2, minHeight: "1em", userSelect: "text", WebkitUserSelect: "text", ...zOf(b.id) }}
                      className="gw-dbox"
                      onKeyDown={(e) => onItemKey(e, "box", b.id)}
                      onBlur={(e) => commitEdit(e.currentTarget, b.id)}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {text}
                    </div>
                  );
                }
                return (
                  <div
                    key={b.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${roleInfo(b.role).label}: ${text.slice(0, 40) || "empty"}. Drag or use arrow keys to move. Double-click to type.`}
                    aria-pressed={sel}
                    title={b.bind && !onLegacyEdit ? undefined : "Double-click to type on the banner"}
                    style={{ ...css(boxStyle(b)), cursor: b.locked ? "default" : "move", touchAction: "none", outline: outline("box", b.id, "1px dashed rgba(255,255,255,0.35)"), outlineOffset: 2, minHeight: "1em", ...zOf(b.id) }}
                    className="gw-dbox"
                    data-studio-id={b.id}
                    onPointerDown={(e) => startDrag(e, "box", b.id, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onDoubleClick={() => startEdit(b.id)}
                    onKeyDown={(e) => onItemKey(e, "box", b.id)}
                    onFocus={() => onSelect({ target: "box", id: b.id })}
                  >
                    {text || <span style={{ opacity: 0.45 }}>(empty {roleInfo(b.role).label.toLowerCase()})</span>}
                    {sel && !b.locked ? <WidthHandle scale={scale} onStart={(e) => startDrag(e, "box", b.id, "resize")} onMove={onPointerMove} onEnd={endDrag} /> : null}
                    {handles("box", b.id, b.locked)}
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
                    style={{ ...css(buttonStyle(btn)), cursor: btn.locked ? "default" : "move", touchAction: "none", outline: outline("button", btn.id, "none"), outlineOffset: 3, ...zOf(btn.id) }}
                    className="gw-dbox gw-dbtn"
                    data-studio-id={btn.id}
                    onPointerDown={(e) => startDrag(e, "button", btn.id, "move")}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(e) => onItemKey(e, "button", btn.id)}
                    onFocus={() => onSelect({ target: "button", id: btn.id })}
                  >
                    {btn.label}
                    {handles("button", btn.id, btn.locked)}
                  </div>
                );
              })}

              <CanvasGuides ghost={ghost} guides={guides} scale={scale} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
