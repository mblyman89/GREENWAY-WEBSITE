/**
 * src/lib/cms/design-drag-core.ts — R41 S7 (hub preview "Move mode").
 *
 * PURE, client-safe geometry for dragging a designed-banner text box or button
 * inside the Website Sync preview iframe. No DOM access here (the caller passes
 * plain rects) so it is unit-testable and tiny in the client bundle.
 *
 * Facts this mirrors (verified in banner-design-core + globals.css):
 *   • a box/button's x/y are its TOP-LEFT corner as a % of the banner frame;
 *   • the phone layout (mx/my) applies when the BANNER is < 768px wide
 *     (`@container gwb (max-width: 767px)`), not the browser window.
 */
import { MOBILE_BREAKPOINT_PX, type DesignDevice } from "./banner-design-core";

export type Rect = { left: number; top: number; width: number; height: number };

const half = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Which layout the owner is editing: matches the CSS container query exactly. */
export function deviceForFrameWidth(frameWidthPx: number): DesignDevice {
  return frameWidthPx < MOBILE_BREAKPOINT_PX ? "mobile" : "desktop";
}

/**
 * Where an item lands after being dragged by (dx, dy) px, as % of the frame
 * (top-left corner, rounded to 0.5, clamped 0–100). Returns null if the frame
 * has no size (not laid out yet).
 */
export function dropPercent(item: Rect, frame: Rect, dx: number, dy: number): { x: number; y: number } | null {
  if (!(frame.width > 0) || !(frame.height > 0)) return null;
  const left = item.left - frame.left + dx;
  const top = item.top - frame.top + dy;
  return { x: half(clamp((left / frame.width) * 100, 0, 100)), y: half(clamp((top / frame.height) * 100, 0, 100)) };
}

/** Keep the dragged item's preview inside the frame (px deltas). */
export function clampDelta(item: Rect, frame: Rect, dx: number, dy: number): { dx: number; dy: number } {
  const minDx = frame.left - item.left;
  const maxDx = frame.left + frame.width - (item.left + item.width);
  const minDy = frame.top - item.top;
  const maxDy = frame.top + frame.height - (item.top + item.height);
  return { dx: clamp(dx, Math.min(minDx, 0), Math.max(maxDx, 0)), dy: clamp(dy, Math.min(minDy, 0), Math.max(maxDy, 0)) };
}

/** Arrow-key nudge in px for a frame: 0.5% (Shift = 5%) of the frame size. */
export function nudgePx(frame: Rect, key: string, shift: boolean): { dx: number; dy: number } | null {
  const pct = shift ? 5 : 0.5;
  const sx = (frame.width * pct) / 100;
  const sy = (frame.height * pct) / 100;
  switch (key) {
    case "ArrowLeft":
      return { dx: -sx, dy: 0 };
    case "ArrowRight":
      return { dx: sx, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -sy };
    case "ArrowDown":
      return { dx: 0, dy: sy };
    default:
      return null;
  }
}

/** A tiny move under this many px is treated as a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4;

export function isDrag(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX;
}

// ── Self-tests (registered in scripts/compliance/run-pure-selftests.ts) ─────
export function __runDesignDragCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error(`design-drag-core: ${m}`);
    passed += 1;
  };
  const frame: Rect = { left: 100, top: 50, width: 1000, height: 400 };
  const item: Rect = { left: 140, top: 170, width: 300, height: 60 }; // x=4% y=30%
  ok(deviceForFrameWidth(1000) === "desktop", "wide = desktop");
  ok(deviceForFrameWidth(767) === "mobile", "767 = mobile");
  ok(deviceForFrameWidth(768) === "desktop", "768 = desktop (matches max-width:767px)");
  ok(deviceForFrameWidth(390) === "mobile", "phone");
  const p0 = dropPercent(item, frame, 0, 0)!;
  ok(p0.x === 4 && p0.y === 30, "no drag keeps position");
  const p1 = dropPercent(item, frame, 160, 40)!;
  ok(p1.x === 20 && p1.y === 40, "drag converts px to %");
  const p2 = dropPercent(item, frame, 3, 0)!;
  ok(p2.x === 4.5, "rounded to 0.5");
  const p3 = dropPercent(item, frame, -9999, -9999)!;
  ok(p3.x === 0 && p3.y === 0, "clamped low");
  const p4 = dropPercent(item, frame, 99999, 99999)!;
  ok(p4.x === 100 && p4.y === 100, "clamped high");
  ok(dropPercent(item, { ...frame, width: 0 }, 1, 1) === null, "unsized frame");
  const c = clampDelta(item, frame, -500, 500);
  ok(c.dx === -40 && c.dy === 220, "preview stays inside frame");
  const c2 = clampDelta(item, frame, 10, 10);
  ok(c2.dx === 10 && c2.dy === 10, "inside drag untouched");
  ok(JSON.stringify(nudgePx(frame, "ArrowRight", false)) === JSON.stringify({ dx: 5, dy: 0 }), "nudge right 0.5%");
  ok(JSON.stringify(nudgePx(frame, "ArrowUp", true)) === JSON.stringify({ dx: 0, dy: -20 }), "nudge up shift 5%");
  ok(nudgePx(frame, "Enter", false) === null, "non-arrow ignored");
  ok(!isDrag(2, 2) && isDrag(3, 3), "drag threshold");
  return { passed, failed: 0 };
}
