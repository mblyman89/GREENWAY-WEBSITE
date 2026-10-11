"use client";

/**
 * PreviewDesignDrag — R41 S7 "Move mode" (bible PART 5.7, M-1/M-2).
 *
 * Runs inside the public page ONLY in Draft Mode (mounted by
 * <PreviewEditOverlay>, which layout.tsx renders only when isPreview). It does
 * nothing at all until the Website Sync preview window (the PARENT frame, same
 * origin) sends `{ type: "gw-move-mode", on: true }`. Then:
 *
 *   • every text box / button of a designed banner that the server marked
 *     editable (`data-gw-design-box` / `data-gw-design-button` inside a
 *     `data-gw-design-frame` with a `data-gw-design-owner`) gets a dashed
 *     outline and a move cursor; links stop navigating while Move is on;
 *   • the owner drags with mouse, pen or finger (Pointer Events +
 *     setPointerCapture). The item follows via a CSS transform only — nothing
 *     is saved while dragging;
 *   • on release we compute the new TOP-LEFT position as % of the banner and
 *     post `{ type: "gw-design-move", owner, target, id, x, y, device }` to the
 *     parent, which re-validates, saves a DRAFT on the server and reloads;
 *   • keyboard alternative (WCAG 2.1.1 / 2.5.7): Tab to an item, arrow keys
 *     nudge 0.5% (Shift = 5%), Enter saves, Escape cancels.
 *
 * Messages are only accepted from / sent to our own origin and our parent.
 */
import { useEffect } from "react";
import { clampDelta, deviceForFrameWidth, dropPercent, isDrag, nudgePx, type Rect } from "@/lib/cms/design-drag-core";

const ITEM_SEL = "[data-gw-design-box],[data-gw-design-button]";
const FRAME_SEL = "[data-gw-design-frame][data-gw-design-owner]";
const ON_CLASS = "gw-move-on";

const CSS = `
html.${ON_CLASS} ${FRAME_SEL} { outline: 2px solid rgba(126,217,87,.55); outline-offset: -2px; }
html.${ON_CLASS} ${FRAME_SEL} :is(${ITEM_SEL}) {
  outline: 2px dashed #7ed957; outline-offset: 2px; cursor: move; touch-action: none;
  user-select: none; -webkit-user-select: none;
}
html.${ON_CLASS} ${FRAME_SEL} :is(${ITEM_SEL}):focus-visible { outline: 3px solid #ffd700; }
html.${ON_CLASS} ${FRAME_SEL} :is(${ITEM_SEL})[data-gw-dragging] {
  outline: 3px solid #ffd700; z-index: 50; box-shadow: 0 8px 24px rgba(0,0,0,.45);
}
`;

function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function itemInfo(el: HTMLElement): { frame: HTMLElement; owner: string; target: "box" | "button"; id: string } | null {
  const frame = el.closest<HTMLElement>(FRAME_SEL);
  const owner = frame?.getAttribute("data-gw-design-owner") ?? "";
  const boxId = el.getAttribute("data-gw-design-box");
  const btnId = el.getAttribute("data-gw-design-button");
  if (!frame || !owner) return null;
  if (btnId) return { frame, owner, target: "button", id: btnId };
  if (boxId) return { frame, owner, target: "box", id: boxId };
  return null;
}

export function PreviewDesignDrag() {
  useEffect(() => {
    if (window.self === window.top) return; // only inside the admin preview frame
    const origin = window.location.origin;
    const root = document.documentElement;
    let on = false;
    let style: HTMLStyleElement | null = null;

    const post = (data: Record<string, unknown>) => window.parent.postMessage(data, origin);
    const items = () => Array.from(document.querySelectorAll<HTMLElement>(`${FRAME_SEL} :is(${ITEM_SEL})`));
    const announce = () => post({ type: "gw-move-ready", count: items().length });

    // Keyboard nudge state per element (px offsets not yet saved).
    const pending = new WeakMap<HTMLElement, { dx: number; dy: number }>();

    function setTransform(el: HTMLElement, dx: number, dy: number) {
      el.style.translate = dx || dy ? `${dx}px ${dy}px` : "";
    }

    function commit(el: HTMLElement, dx: number, dy: number) {
      const info = itemInfo(el);
      if (!info) return;
      // Measure BEFORE the transform so the delta is applied once.
      setTransform(el, 0, 0);
      const frameRect = rectOf(info.frame);
      const p = dropPercent(rectOf(el), frameRect, dx, dy);
      setTransform(el, dx, dy); // keep it where the owner dropped it until reload
      if (!p) return;
      post({
        type: "gw-design-move",
        owner: info.owner,
        target: info.target,
        id: info.id,
        x: p.x,
        y: p.y,
        device: deviceForFrameWidth(frameRect.width),
      });
    }

    function enable(next: boolean) {
      on = next;
      root.classList.toggle(ON_CLASS, on);
      if (on && !style) {
        style = document.createElement("style");
        style.setAttribute("data-gw-move-style", "");
        style.textContent = CSS;
        document.head.appendChild(style);
      }
      for (const el of items()) {
        if (on) {
          if (!el.hasAttribute("tabindex")) el.setAttribute("data-gw-added-tab", "");
          el.setAttribute("tabindex", "0");
          el.setAttribute("draggable", "false");
          el.setAttribute("aria-roledescription", "movable");
          el.setAttribute("aria-description", "Drag, or use the arrow keys then Enter to save. Escape cancels.");
        } else {
          if (el.hasAttribute("data-gw-added-tab")) {
            el.removeAttribute("tabindex");
            el.removeAttribute("data-gw-added-tab");
          }
          el.removeAttribute("aria-roledescription");
          el.removeAttribute("aria-description");
          setTransform(el, 0, 0);
          pending.delete(el);
        }
      }
      announce();
    }

    // ── pointer drag ──
    let drag: { el: HTMLElement; id: number; sx: number; sy: number; item: Rect; frame: Rect; dx: number; dy: number } | null = null;

    function onPointerDown(e: PointerEvent) {
      if (!on || e.button !== 0) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(ITEM_SEL);
      if (!el) return;
      const info = itemInfo(el);
      if (!info) return;
      e.preventDefault(); // no text selection / native image-link drag
      // preventDefault also suppresses the browser's focus-on-press, so focus
      // explicitly: "click it, then use the arrow keys" must keep working.
      el.focus({ preventScroll: true });
      setTransform(el, 0, 0);
      pending.delete(el);
      drag = { el, id: e.pointerId, sx: e.clientX, sy: e.clientY, item: rectOf(el), frame: rectOf(info.frame), dx: 0, dy: 0 };
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is an enhancement; window listeners still track the drag */
      }
      el.setAttribute("data-gw-dragging", "");
    }

    function onPointerMove(e: PointerEvent) {
      if (!drag || e.pointerId !== drag.id) return;
      const c = clampDelta(drag.item, drag.frame, e.clientX - drag.sx, e.clientY - drag.sy);
      drag.dx = c.dx;
      drag.dy = c.dy;
      setTransform(drag.el, c.dx, c.dy);
    }

    function endDrag(e: PointerEvent, cancelled: boolean) {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      d.el.removeAttribute("data-gw-dragging");
      try {
        d.el.releasePointerCapture(d.id);
      } catch {
        /* already released */
      }
      if (cancelled || !isDrag(d.dx, d.dy)) {
        setTransform(d.el, 0, 0);
        return;
      }
      commit(d.el, d.dx, d.dy);
    }
    const onPointerUp = (e: PointerEvent) => endDrag(e, false);
    const onPointerCancel = (e: PointerEvent) => endDrag(e, true);

    // Links must not navigate while Move is on (capture phase beats next/link).
    function onClick(e: MouseEvent) {
      if (!on) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(ITEM_SEL);
      if (el && el.closest(FRAME_SEL)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    // ── keyboard ──
    function onKeyDown(e: KeyboardEvent) {
      if (!on) return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(ITEM_SEL);
      const info = el ? itemInfo(el) : null;
      if (!el || !info) return;
      const cur = pending.get(el) ?? { dx: 0, dy: 0 };
      if (e.key === "Escape") {
        e.preventDefault();
        pending.delete(el);
        setTransform(el, 0, 0);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (cur.dx || cur.dy) {
          pending.delete(el);
          commit(el, cur.dx, cur.dy);
        }
        return;
      }
      setTransform(el, 0, 0);
      const step = nudgePx(rectOf(info.frame), e.key, e.shiftKey);
      if (!step) {
        setTransform(el, cur.dx, cur.dy);
        return;
      }
      e.preventDefault();
      const c = clampDelta(rectOf(el), rectOf(info.frame), cur.dx + step.dx, cur.dy + step.dy);
      pending.set(el, c);
      setTransform(el, c.dx, c.dy);
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== origin || e.source !== window.parent) return;
      const data = e.data as { type?: string; on?: unknown } | null;
      if (data?.type === "gw-move-mode") enable(data.on === true);
    }

    window.addEventListener("message", onMessage);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown);
    // Tell the parent we're ready so it can (re)send the current Move state.
    post({ type: "gw-move-hello" });

    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown);
      enable(false);
      style?.remove();
    };
  }, []);

  return null;
}
