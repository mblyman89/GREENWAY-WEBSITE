/**
 * R45-S1: carousel auto-rotation policy. This is pure logic, shared by the
 * home Hero and the Shop banner carousel.
 *
 * Sources (all fetched and read in R44/R45, not assumed):
 *  - W3C WAI-ARIA APG, "Carousel (Slide Show or Image Rotator) Pattern":
 *      - A carousel that can auto-rotate has a button for stopping and
 *        restarting rotation, and that button comes FIRST in the Tab order.
 *      - Rotation stops when keyboard focus enters the carousel, and does not
 *        resume unless the user activates the rotation control.
 *      - Rotation stops while the mouse hovers over the carousel.
 *      - The rotation button's label changes ("Stop slide rotation" /
 *        "Start slide rotation") and carries no aria-pressed state.
 *      - Optional live region: aria-live "off" while rotating, "polite" when not.
 *  - W3C Understanding SC 2.2.2 (Pause, Stop, Hide): auto-moving content that
 *    lasts more than 5 s needs a pause mechanism. Hover alone does not serve
 *    keyboard or touch users.
 *  - Baymard, "10 UX Requirements for Homepage Carousels" (updated 3 Apr 2025):
 *      - rotate every 5 to 7 s, up to 10 s for text-heavy slides
 *      - pause on hover
 *      - stop permanently after the user interacts
 *      - no auto-rotation on mobile
 *      - support swipe
 *  - web.dev, "Fetch Priority": fetchpriority="high" only on the first visible
 *    slide, "low" on slides that start hidden.
 *
 * Swipe thresholds (SWIPE_MIN_PX, the 1.5x dominance ratio, SWIPE_MAX_MS) are
 * OUR engineering choices, picked to keep vertical page scrolling working.
 * They are not taken from a standard.
 */

/** Tailwind `md` starts at 768px, so "mobile" here means narrower than that. */
export const MOBILE_MAX_WIDTH_PX = 767;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/** Baymard: 5 to 7 s normally, up to 10 s for text-heavy slides. */
export const MIN_INTERVAL_MS = 5000;
export const MAX_INTERVAL_MS = 10000;
export const TEXT_HEAVY_CAP_MS = 7000; // the ceiling for a normal slide

/** Words a shopper can comfortably read inside a normal dwell. Our choice. */
export const WORDS_PER_BASE_DWELL = 20;
/** Extra dwell per extra word (about 200 words per minute, i.e. 300 ms per word). Our choice. */
export const MS_PER_EXTRA_WORD = 300;

export const SWIPE_MIN_PX = 40;
export const SWIPE_MAX_MS = 800;

/** Why rotation is currently stopped. null means it is allowed to run. */
export type StopReason = "user" | "focus" | null;

export type CarouselState = {
  count: number;
  active: number;
  /** Permanent stop (APG and Baymard): set by focus entering or by any manual nav. */
  stopped: StopReason;
  /** The shopper pressed "Start slide rotation", overriding the reduced-motion and mobile defaults. */
  userStarted: boolean;
  hover: boolean;
  /** The browser tab is hidden, so don't advance unseen. */
  hidden: boolean;
  reducedMotion: boolean;
  mobile: boolean;
};

export type CarouselEvent =
  | { type: "tick" }
  | { type: "next" } // manual (arrow, swipe, key)
  | { type: "prev" }
  | { type: "goto"; index: number }
  | { type: "toggleRotation" }
  | { type: "focusIn" } // focus moved INTO the carousel from outside
  | { type: "hover"; on: boolean }
  | { type: "visibility"; hidden: boolean }
  | { type: "env"; reducedMotion: boolean; mobile: boolean }
  | { type: "count"; count: number };

export function initialCarouselState(count: number, env?: { reducedMotion?: boolean; mobile?: boolean }): CarouselState {
  return {
    count: Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)),
    active: 0,
    stopped: null,
    userStarted: false,
    hover: false,
    hidden: false,
    reducedMotion: Boolean(env?.reducedMotion),
    mobile: Boolean(env?.mobile),
  };
}

function wrap(i: number, count: number): number {
  if (count <= 0) return 0;
  return ((Math.trunc(i) % count) + count) % count;
}

/**
 * Whether the shopper sees rotation as "on". This drives the button label
 * and the live region. Temporary pauses (hover, hidden tab) don't change it.
 */
export function rotationEnabled(s: CarouselState): boolean {
  if (s.count <= 1) return false;
  if (s.stopped) return false;
  if (s.userStarted) return true;
  // Defaults: off for reduced motion (SC 2.2.2 and the OS setting) and on mobile (Baymard).
  return !s.reducedMotion && !s.mobile;
}

/** Whether the timer should actually run right now. */
export function shouldRun(s: CarouselState): boolean {
  return rotationEnabled(s) && !s.hover && !s.hidden;
}

export function carouselReducer(s: CarouselState, e: CarouselEvent): CarouselState {
  switch (e.type) {
    case "tick":
      return shouldRun(s) ? { ...s, active: wrap(s.active + 1, s.count) } : s;
    case "next":
      return s.count <= 1 ? s : { ...s, active: wrap(s.active + 1, s.count), stopped: "user", userStarted: false };
    case "prev":
      return s.count <= 1 ? s : { ...s, active: wrap(s.active - 1, s.count), stopped: "user", userStarted: false };
    case "goto":
      if (s.count <= 1 || !Number.isFinite(e.index)) return s;
      return { ...s, active: wrap(e.index, s.count), stopped: "user", userStarted: false };
    case "toggleRotation":
      if (s.count <= 1) return s;
      return rotationEnabled(s)
        ? { ...s, stopped: "user", userStarted: false }
        : { ...s, stopped: null, userStarted: true };
    case "focusIn":
      // APG: stop when focus enters; only the rotation button restarts it.
      return rotationEnabled(s) ? { ...s, stopped: "focus", userStarted: false } : s;
    case "hover":
      return s.hover === e.on ? s : { ...s, hover: e.on };
    case "visibility":
      return s.hidden === e.hidden ? s : { ...s, hidden: e.hidden };
    case "env":
      if (s.reducedMotion === e.reducedMotion && s.mobile === e.mobile) return s;
      return { ...s, reducedMotion: e.reducedMotion, mobile: e.mobile };
    case "count": {
      const count = Math.max(0, Math.floor(Number.isFinite(e.count) ? e.count : 0));
      return { ...s, count, active: count === 0 ? 0 : Math.min(s.active, count - 1) };
    }
    default:
      return s;
  }
}

/** APG: the button label says what it WILL do. */
export function rotationButtonLabel(s: CarouselState): string {
  return rotationEnabled(s) ? "Stop slide rotation" : "Start slide rotation";
}

/** APG: aria-live "off" while rotating, "polite" otherwise (no chatter mid-rotation). */
export function liveRegionMode(s: CarouselState): "off" | "polite" {
  return rotationEnabled(s) ? "off" : "polite";
}

/** Count readable words in a slide's text (eyebrow, title, description, button labels). */
export function wordCount(parts: ReadonlyArray<unknown>): number {
  let n = 0;
  for (const p of parts) {
    if (typeof p !== "string") continue;
    const m = p.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
    n += m ? m.length : 0;
  }
  return n;
}

/**
 * Dwell for one slide. A normal slide gets `base` (clamped to 5 to 7 s).
 * Text-heavy slides earn extra time, up to the 10 s Baymard ceiling.
 */
export function dwellMs(base: number, words: number): number {
  const b = Math.min(TEXT_HEAVY_CAP_MS, Math.max(MIN_INTERVAL_MS, Number.isFinite(base) ? base : MIN_INTERVAL_MS));
  const w = Math.max(0, Math.floor(Number.isFinite(words) ? words : 0));
  const extra = Math.max(0, w - WORDS_PER_BASE_DWELL) * MS_PER_EXTRA_WORD;
  return Math.min(MAX_INTERVAL_MS, b + extra);
}

/** Classify a finished pointer gesture. Horizontal must dominate, so vertical scrolling is never hijacked. */
export function classifySwipe(dx: number, dy: number, ms: number): "next" | "prev" | null {
  if (![dx, dy, ms].every(Number.isFinite)) return null;
  if (ms < 0 || ms > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "prev"; // finger moves left -> content advances
}

/** web.dev Fetch Priority: only the first (initially visible) slide is high. */
export function slideFetchPriority(index: number): "high" | "low" {
  return index === 0 ? "high" : "low";
}

/** Keyboard: Left/Right arrows on the focused carousel region. */
export function keyToNav(key: string): "next" | "prev" | null {
  if (key === "ArrowRight") return "next";
  if (key === "ArrowLeft") return "prev";
  return null;
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runCarouselAutoplayCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("carousel-autoplay-core FAIL:", m);
    }
  };
  const run = (s: CarouselState, ...es: CarouselEvent[]) => es.reduce(carouselReducer, s);

  // Baseline desktop
  const d = initialCarouselState(3);
  ok(rotationEnabled(d) && shouldRun(d), "desktop rotates by default");
  ok(run(d, { type: "tick" }).active === 1, "tick advances");
  ok(run(d, { type: "tick" }, { type: "tick" }, { type: "tick" }).active === 0, "tick wraps");
  ok(rotationButtonLabel(d) === "Stop slide rotation", "label when rotating");
  ok(liveRegionMode(d) === "off", "live off while rotating");

  // Single and empty
  const one = initialCarouselState(1);
  ok(!rotationEnabled(one) && run(one, { type: "tick" }).active === 0, "single slide never rotates");
  ok(run(one, { type: "next" }) === one, "single next no-op");
  ok(run(initialCarouselState(0), { type: "toggleRotation" }).stopped === null, "empty toggle no-op");
  ok(initialCarouselState(NaN).count === 0 && initialCarouselState(-2).count === 0, "bad count -> 0");

  // Hover is temporary
  const h = run(d, { type: "hover", on: true });
  ok(rotationEnabled(h) && !shouldRun(h), "hover pauses but stays enabled");
  ok(run(h, { type: "tick" }).active === 0, "tick ignored on hover");
  ok(shouldRun(run(h, { type: "hover", on: false })), "unhover resumes");
  ok(run(h, { type: "hover", on: true }) === h, "hover idempotent");

  // Hidden tab is temporary
  const hid = run(d, { type: "visibility", hidden: true });
  ok(!shouldRun(hid) && shouldRun(run(hid, { type: "visibility", hidden: false })), "hidden tab pauses, return resumes");

  // Manual nav stops permanently (Baymard)
  const n = run(d, { type: "next" });
  ok(n.active === 1 && n.stopped === "user" && !rotationEnabled(n), "next stops for good");
  ok(run(n, { type: "tick" }, { type: "tick" }).active === 1, "ticks ignored after manual nav");
  ok(run(d, { type: "prev" }).active === 2, "prev wraps backwards");
  ok(run(d, { type: "goto", index: 2 }).active === 2 && run(d, { type: "goto", index: 2 }).stopped === "user", "goto stops");
  ok(run(d, { type: "goto", index: 7 }).active === 1, "goto wraps");
  ok(run(d, { type: "goto", index: -1 }).active === 2, "goto negative wraps");
  ok(run(d, { type: "goto", index: NaN }) === d, "goto NaN no-op");
  ok(rotationButtonLabel(n) === "Start slide rotation" && liveRegionMode(n) === "polite", "label/live after stop");

  // Focus entering stops (APG) and only the button restarts
  const f = run(d, { type: "focusIn" });
  ok(f.stopped === "focus" && !rotationEnabled(f), "focus stops");
  const fr = run(f, { type: "toggleRotation" });
  ok(rotationEnabled(fr) && fr.userStarted && fr.stopped === null, "button restarts after focus stop");
  ok(run(fr, { type: "hover", on: false }, { type: "tick" }).active === 1, "restarted rotation advances");
  ok(run(n, { type: "focusIn" }) === n, "focus on already-stopped is a no-op");

  // Toggle
  const t1 = run(d, { type: "toggleRotation" });
  ok(!rotationEnabled(t1) && t1.stopped === "user", "toggle stops");
  ok(rotationEnabled(run(t1, { type: "toggleRotation" })), "toggle starts again");
  ok(run(one, { type: "toggleRotation" }) === one, "toggle single no-op");

  // Reduced motion: off by default, user may opt in
  const rm = initialCarouselState(3, { reducedMotion: true });
  ok(!rotationEnabled(rm) && run(rm, { type: "tick" }).active === 0, "reduced motion: no autoplay");
  ok(rotationButtonLabel(rm) === "Start slide rotation", "reduced motion offers Start");
  ok(rotationEnabled(run(rm, { type: "toggleRotation" })), "reduced motion: explicit Start honoured");
  ok(!rotationEnabled(run(d, { type: "env", reducedMotion: true, mobile: false })), "env switch to reduced stops");
  ok(run(d, { type: "env", reducedMotion: false, mobile: false }) === d, "env unchanged is identity");

  // Mobile: off by default (Baymard)
  const mo = initialCarouselState(4, { mobile: true });
  ok(!rotationEnabled(mo) && !shouldRun(mo), "mobile: no autoplay");
  ok(rotationEnabled(run(mo, { type: "toggleRotation" })), "mobile: explicit Start honoured");
  ok(run(mo, { type: "toggleRotation" }, { type: "next" }).stopped === "user", "manual nav after Start stops again");
  ok(MOBILE_MEDIA_QUERY === "(max-width: 767px)", "md breakpoint");

  // Count changes (preview edits)
  const c = run(d, { type: "goto", index: 2 }, { type: "count", count: 2 });
  ok(c.active === 1 && c.count === 2, "shrinking clamps active");
  ok(run(d, { type: "count", count: 0 }).active === 0, "zero count");
  ok(run(d, { type: "count", count: NaN }).count === 0, "NaN count");

  // Dwell (Baymard 5 to 7 s, up to 10 s)
  ok(dwellMs(6000, 8) === 6000, "short slide keeps base");
  ok(dwellMs(6000, 20) === 6000, "20 words still base");
  ok(dwellMs(6000, 25) === 7500, "5 extra words -> +1.5 s");
  ok(dwellMs(6000, 500) === MAX_INTERVAL_MS, "capped at 10 s");
  ok(dwellMs(1000, 0) === MIN_INTERVAL_MS, "base clamps up to 5 s");
  ok(dwellMs(60000, 0) === TEXT_HEAVY_CAP_MS, "base clamps down to 7 s");
  ok(dwellMs(NaN, NaN) === MIN_INTERVAL_MS, "NaN safe");
  ok(dwellMs(6500, -4) === 6500, "negative words safe");

  // wordCount
  ok(wordCount(["Top Shelf Thursday", "20% off", null, 5]) === 5, "word count mixed");
  ok(wordCount(["  ", ""]) === 0, "blank");
  ok(wordCount(["Greenway’s 4/20 deals—don't miss"]) === 6, "apostrophes and digits");

  // Swipe
  ok(classifySwipe(-80, 5, 200) === "next", "swipe left -> next");
  ok(classifySwipe(80, -5, 200) === "prev", "swipe right -> prev");
  ok(classifySwipe(30, 0, 200) === null, "too short");
  ok(classifySwipe(-60, 50, 200) === null, "too vertical (scroll)");
  ok(classifySwipe(-60, 30, 200) === "next", "mostly horizontal ok");
  ok(classifySwipe(-200, 0, 2000) === null, "too slow");
  ok(classifySwipe(-200, 0, -1) === null, "negative time");
  ok(classifySwipe(NaN, 0, 100) === null, "NaN");

  // Priority and keys
  ok(slideFetchPriority(0) === "high" && slideFetchPriority(1) === "low" && slideFetchPriority(9) === "low", "fetch priority");
  ok(keyToNav("ArrowRight") === "next" && keyToNav("ArrowLeft") === "prev" && keyToNav("Enter") === null, "keys");

  return { passed, failed };
}
