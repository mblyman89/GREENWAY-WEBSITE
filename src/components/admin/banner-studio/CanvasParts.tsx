"use client";

/**
 * R55-S2 — pieces of the Studio canvas split out to keep StudioCanvas small:
 *  • CanvasShape  — a draggable shape layer (+ corner resize handle).
 *  • CanvasGuides — the AI suggestion "ghost" and the orange snap guides.
 *  • RotateHandle / WidthHandle — R56 on-canvas handles (constant screen size).
 */
import type { CSSProperties, KeyboardEvent as RKeyboardEvent, PointerEvent as RPointerEvent } from "react";
import { elementStyle, type DesignElement } from "@/lib/cms/banner-elements-core";
import { DesignShape } from "@/components/site/DesignShape";

const css = (s: Record<string, string>) => s as unknown as CSSProperties;

export function CanvasShape({
  el,
  selected,
  grouped = false,
  scale,
  z,
  onStart,
  onMove,
  onEnd,
  onKey,
  onFocus,
}: {
  el: DesignElement;
  selected: boolean;
  /** R56: part of a shift-click group (dashed gold outline). */
  grouped?: boolean;
  scale: number;
  z: CSSProperties;
  onStart: (e: RPointerEvent<HTMLElement>, mode: "move" | "resize" | "rotate") => void;
  onMove: (e: RPointerEvent<HTMLElement>) => void;
  onEnd: (e: RPointerEvent<HTMLElement>) => void;
  onKey: (e: RKeyboardEvent) => void;
  onFocus: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${el.kind === "icon" ? `Icon ${el.icon}` : `Shape ${el.shape}`}${el.locked ? " (locked)" : ""}. Drag or use arrow keys to move.`}
      aria-pressed={selected}
      style={{
        ...css(elementStyle(el)),
        pointerEvents: "auto",
        cursor: el.locked ? "default" : "move",
        touchAction: "none",
        outline: selected ? "2px solid #7ed957" : grouped ? "2px dashed #ffd700" : "1px dashed rgba(255,255,255,0.25)",
        outlineOffset: 2,
        ...z,
      }}
      className="gw-dbox"
      data-studio-id={el.id}
      onPointerDown={(e) => onStart(e, "move")}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onKeyDown={onKey}
      onFocus={onFocus}
    >
      <DesignShape el={el} />
      {selected && !el.locked ? <RotateHandle scale={scale} onStart={(e) => onStart(e, "rotate")} onMove={onMove} onEnd={onEnd} /> : null}
      {selected && !el.locked ? (
        <span
          aria-hidden="true"
          title="Drag to resize"
          onPointerDown={(e) => onStart(e, "resize")}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
          style={{
            position: "absolute",
            right: -8,
            bottom: -8,
            width: 16,
            height: 16,
            borderRadius: 4,
            background: "#7ed957",
            cursor: "nwse-resize",
            touchAction: "none",
            transform: `scale(${1 / scale})`,
          }}
        />
      ) : null}
    </div>
  );
}

export function CanvasGuides({
  ghost,
  guides,
  scale,
}: {
  ghost: { zone: { x: number; y: number; w: number; h: number }; focusX: number; focusY: number } | null;
  guides: { v: number[]; h: number[] };
  scale: number;
}) {
  return (
    <>
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
              zIndex: 90,
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
              zIndex: 90,
            }}
          />
        </>
      ) : null}
      {guides.v.map((g) => (
        <div key={`v${g}`} aria-hidden="true" className="pointer-events-none absolute inset-y-0" style={{ left: `${g}%`, width: 0, borderLeft: `${2 / scale}px dashed #ff7f00`, zIndex: 91 }} />
      ))}
      {guides.h.map((g) => (
        <div key={`h${g}`} aria-hidden="true" className="pointer-events-none absolute inset-x-0" style={{ top: `${g}%`, height: 0, borderTop: `${2 / scale}px dashed #ff7f00`, zIndex: 91 }} />
      ))}
    </>
  );
}

type H = {
  scale: number;
  onStart: (e: RPointerEvent<HTMLElement>) => void;
  onMove: (e: RPointerEvent<HTMLElement>) => void;
  onEnd: (e: RPointerEvent<HTMLElement>) => void;
};

/** R56: gold knob above the item — drag to rotate (Shift = 15° steps). Double-click = upright. */
export function RotateHandle({ scale, onStart, onMove, onEnd }: H) {
  return (
    <span
      aria-hidden="true"
      title="Drag to rotate (hold Shift for 15° steps)"
      data-studio-handle="rotate"
      onPointerDown={onStart}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      style={{
        position: "absolute",
        left: "50%",
        top: -30 / scale,
        width: 16,
        height: 16,
        marginLeft: -8,
        borderRadius: 999,
        background: "#ffd700",
        border: "2px solid #000",
        cursor: "grab",
        touchAction: "none",
        transform: `scale(${1 / scale})`,
      }}
    />
  );
}

/** Text wrap-width handle (moved from StudioCanvas). */
export function WidthHandle({ scale, onStart, onMove, onEnd }: H) {
  return (
    <span
      aria-hidden="true"
      title="Drag to change how wide the text can run before it wraps"
      onPointerDown={onStart}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
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
  );
}
