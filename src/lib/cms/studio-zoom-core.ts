/**
 * D263 S10 - Studio zoom maths (pure, no DOM). Used by the Print Studio
 * workspace: fit, actual-size %, slider mapping, cursor-anchored zoom and
 * zoom-to-selection. `scale` is always SCREEN px per canvas REFERENCE px
 * (the canvas is laid out at refW x refH and CSS-scaled).
 *
 * Actual size: 100% = the printed piece at its real size on a 96 CSS-px/in
 * screen (Illustrator / InDesign convention), so "100%" means the same on a
 * business card and a 10 ft banner.
 */

export const CSS_PX_PER_IN = 96;
/** Slider/zoom limits, as powers of two around Fit. */
export const ZOOM_MIN_LOG = -2; // 1/4 of fit
export const ZOOM_MAX_LOG = 7; // 128x fit
/** Never lay the canvas out wider than this many screen px (browser safety). */
export const ZOOM_MAX_SCREEN_PX = 120_000;
export const ZOOM_PAD = 48;
export const ZOOM_PRESETS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32]; // actual-size factors

export type Size = { w: number; h: number };

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Scale that fits the whole canvas in the viewport (with padding). */
export function fitScale(view: Size, ref: Size, pad = ZOOM_PAD): number {
  if (!(view.w > 0 && view.h > 0 && ref.w > 0 && ref.h > 0)) return 1;
  return Math.max(0.01, Math.min((view.w - 2 * pad) / ref.w, (view.h - 2 * pad) / ref.h));
}

export function scaleLimits(fit: number, refW: number): { min: number; max: number } {
  const max = Math.min(fit * 2 ** ZOOM_MAX_LOG, ZOOM_MAX_SCREEN_PX / Math.max(1, refW));
  return { min: fit * 2 ** ZOOM_MIN_LOG, max: Math.max(fit, max) };
}

export function clampScale(s: number, fit: number, refW: number): number {
  const { min, max } = scaleLimits(fit, refW);
  return r4(Math.min(max, Math.max(min, s)));
}

/** Screen px per real inch -> actual-size factor (1 = 100%). widthIn = canvas width in inches (trim + bleed). */
export function actualOf(scale: number, refW: number, widthIn: number): number {
  return widthIn > 0 ? (scale * refW) / (widthIn * CSS_PX_PER_IN) : scale;
}
export function scaleForActual(actual: number, refW: number, widthIn: number): number {
  return widthIn > 0 ? (actual * widthIn * CSS_PX_PER_IN) / refW : actual;
}

/** Slider position (log2 of scale/fit) <-> scale. */
export function sliderOf(scale: number, fit: number): number {
  return Math.round(Math.log2(scale / fit) * 100) / 100;
}
export function scaleOfSlider(v: number, fit: number): number {
  return fit * 2 ** v;
}

/** Next zoom step in or out: snaps to the preset list (actual-size) like pro tools, passing through Fit. */
export function stepScale(scale: number, dir: 1 | -1, fit: number, refW: number, widthIn: number): number {
  const stops = [...ZOOM_PRESETS.map((a) => scaleForActual(a, refW, widthIn)), fit].sort((a, b) => a - b);
  const eps = scale * 0.001;
  const next = dir > 0 ? stops.find((s) => s > scale + eps) : [...stops].reverse().find((s) => s < scale - eps);
  return clampScale(next ?? scale * (dir > 0 ? 2 : 0.5), fit, refW);
}

/** Smooth wheel / pinch zoom factor (deltaY in px; trackpads send small deltas). */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0025);
}

/** Where the canvas's top-left sits inside the scroll content (centred when smaller than the view). */
export function canvasOffset(view: Size, ref: Size, scale: number, pad = ZOOM_PAD): { x: number; y: number } {
  return { x: Math.max(pad, (view.w - ref.w * scale) / 2), y: Math.max(pad, (view.h - ref.h * scale) / 2) };
}

/** Total scroll content size. */
export function contentSize(view: Size, ref: Size, scale: number, pad = ZOOM_PAD): Size {
  const o = canvasOffset(view, ref, scale, pad);
  return { w: Math.max(view.w, ref.w * scale + 2 * o.x), h: Math.max(view.h, ref.h * scale + 2 * o.y) };
}

/**
 * New scroll position so the canvas point under `at` (viewport px) stays put
 * when the scale changes from `from` to `to`.
 */
export function anchorScroll(p: { view: Size; ref: Size; scroll: { x: number; y: number }; at: { x: number; y: number }; from: number; to: number; pad?: number }): { x: number; y: number } {
  const pad = p.pad ?? ZOOM_PAD;
  const o0 = canvasOffset(p.view, p.ref, p.from, pad);
  const o1 = canvasOffset(p.view, p.ref, p.to, pad);
  const ux = (p.scroll.x + p.at.x - o0.x) / p.from;
  const uy = (p.scroll.y + p.at.y - o0.y) / p.from;
  const c = contentSize(p.view, p.ref, p.to, pad);
  const clampS = (v: number, max: number) => Math.round(Math.min(Math.max(0, max), Math.max(0, v)));
  return { x: clampS(ux * p.to + o1.x - p.at.x, c.w - p.view.w), y: clampS(uy * p.to + o1.y - p.at.y, c.h - p.view.h) };
}

/** Zoom so a rect (in canvas reference px) fills the view, then centre it. */
export function zoomToRect(view: Size, ref: Size, rect: { x: number; y: number; w: number; h: number }, fit: number, pad = ZOOM_PAD): { scale: number; scroll: { x: number; y: number } } {
  const s = clampScale(Math.min((view.w - 4 * pad) / Math.max(1, rect.w), (view.h - 4 * pad) / Math.max(1, rect.h)), fit, ref.w);
  const o = canvasOffset(view, ref, s, pad);
  const c = contentSize(view, ref, s, pad);
  const cx = o.x + (rect.x + rect.w / 2) * s - view.w / 2;
  const cy = o.y + (rect.y + rect.h / 2) * s - view.h / 2;
  return { scale: s, scroll: { x: Math.round(Math.min(Math.max(0, c.w - view.w), Math.max(0, cx))), y: Math.round(Math.min(Math.max(0, c.h - view.h), Math.max(0, cy))) } };
}

export function pctLabel(actual: number): string {
  const p = actual * 100;
  return `${p >= 100 ? Math.round(p) : p >= 10 ? Math.round(p) : Math.round(p * 10) / 10}%`;
}

/**
 * D263 S12 — ruler ticks in inches. `origin` = screen px where 0" (the trim's
 * top-left) sits, `pxPerIn` = on-screen px per real inch, `length` = ruler
 * length in px. Minor ticks are at least ~6 px apart, labels ~56 px apart;
 * steps are binary fractions below 1" (1/64 … 1/2) and 1, 2, 3, 6, 12 … above.
 */
export type RulerTick = { at: number; major: boolean; label?: string };
const RULER_STEPS = [1 / 64, 1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 3, 6, 12, 24, 48, 96, 192];
export function rulerStep(pxPerIn: number, minPx: number): number {
  return RULER_STEPS.find((st) => st * pxPerIn >= minPx) ?? RULER_STEPS[RULER_STEPS.length - 1]!;
}
export function inchLabel(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  if (Number.isInteger(r)) return `${r}`;
  return `${r}`.replace(/^(-?)0\./, "$1.");
}
export function rulerTicks(origin: number, pxPerIn: number, length: number, max = 2000): RulerTick[] {
  if (!(pxPerIn > 0) || !(length > 0)) return [];
  const minor = rulerStep(pxPerIn, 6);
  const major = Math.max(minor, rulerStep(pxPerIn, 56));
  const ratio = Math.round(major / minor);
  const first = Math.ceil(-origin / pxPerIn / minor);
  const last = Math.floor((length - origin) / pxPerIn / minor);
  const out: RulerTick[] = [];
  for (let k = first; k <= last && out.length < max; k++) {
    const v = k * minor;
    const isMajor = ((k % ratio) + ratio) % ratio === 0;
    out.push({ at: Math.round((origin + v * pxPerIn) * 10) / 10, major: isMajor, ...(isMajor ? { label: inchLabel(v) } : {}) });
  }
  return out;
}

export function __runStudioZoomTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  const near = (a: number, b: number, e = 0.01) => Math.abs(a - b) <= e;
  const view = { w: 1096, h: 696 };
  const ref = { w: 320, h: 160 };
  const fit = fitScale(view, ref);
  ok(near(fit, 3.125), "fit uses the tighter axis");
  ok(fitScale({ w: 0, h: 10 }, ref) === 1, "fit guards zero");
  // 3.61in wide business card canvas at refW 320.
  ok(near(actualOf(scaleForActual(1, 320, 3.61), 320, 3.61), 1), "actual round trip");
  ok(near(scaleForActual(1, 320, 3.61), (3.61 * 96) / 320), "100% = 96 px/in");
  ok(near(scaleOfSlider(sliderOf(7.3, fit), fit), 7.3, 0.05), "slider round trip");
  const lim = scaleLimits(fit, 320);
  ok(near(lim.min, fit / 4) && near(lim.max, Math.min(fit * 128, ZOOM_MAX_SCREEN_PX / 320)), "limits (browser cap)");
  ok(scaleLimits(1, 1e6).max === 1, "huge canvas never below fit");
  ok(clampScale(1e9, fit, 320) === clampScale(lim.max, fit, 320), "clamp max");
  const up = stepScale(fit, 1, fit, 320, 3.61);
  ok(up > fit, "step in grows");
  ok(ZOOM_PRESETS.some((a) => near(actualOf(up, 320, 3.61), a, 0.001)), "step lands on a preset");
  ok(stepScale(up, -1, fit, 320, 3.61) < up, "step out");
  ok(wheelFactor(-100) > 1 && wheelFactor(100) < 1 && near(wheelFactor(100) * wheelFactor(-100), 1), "wheel symmetric");
  ok(near(wheelFactor(1e6), wheelFactor(200)), "wheel clamped");
  const o = canvasOffset(view, ref, 1);
  ok(o.x === (1096 - 320) / 2 && o.y === (696 - 160) / 2, "centred when small");
  ok(canvasOffset(view, ref, 10).x === ZOOM_PAD, "padded when big");
  // Anchor: the canvas point under the cursor must stay under the cursor.
  const at = { x: 300, y: 200 };
  const s0 = 3, s1 = 12;
  const sc = anchorScroll({ view, ref, scroll: { x: 0, y: 0 }, at, from: s0, to: s1 });
  const o0 = canvasOffset(view, ref, s0), o1 = canvasOffset(view, ref, s1);
  const u0 = (at.x - o0.x) / s0, u1 = (sc.x + at.x - o1.x) / s1;
  ok(near(u0, u1, 0.5 / s1), "anchor keeps x");
  const v0 = (at.y - o0.y) / s0, v1 = (sc.y + at.y - o1.y) / s1;
  ok(near(v0, v1, 0.5 / s1), "anchor keeps y");
  ok(anchorScroll({ view, ref, scroll: { x: 0, y: 0 }, at, from: 3, to: 1 }).x === 0, "zoom out clamps scroll at 0");
  const z = zoomToRect(view, ref, { x: 100, y: 50, w: 20, h: 10 }, fit);
  ok(z.scale > fit * 4, "zoom to small rect zooms in");
  const oz = canvasOffset(view, ref, z.scale);
  ok(near(oz.x + 110 * z.scale - z.scroll.x, view.w / 2, 1), "rect centred");
  ok(pctLabel(1) === "100%" && pctLabel(0.123) === "12%" && pctLabel(0.0456) === "4.6%", "labels");
  // S12 rulers
  ok(rulerStep(96, 6) === 1 / 16 && rulerStep(96, 56) === 1, "steps at 100%");
  ok(rulerStep(2, 6) === 3 && rulerStep(0.1, 56) === 192, "steps when far out");
  const rt = rulerTicks(10, 96, 300);
  ok(rt.find((t) => t.label === "0")?.at === 10 && rt[0]!.at === 4 && !rt[0]!.major, "0 at origin, ticks before it");
  ok(rt.filter((t) => t.major).map((t) => t.label).join() === "0,1,2,3", "inch labels");
  ok(near(rt[2]!.at - rt[1]!.at, 6), "minor 1/16 = 6px");
  const neg = rulerTicks(50, 96, 100);
  ok(neg[0]!.at >= 0 && neg.some((t) => t.label === "0") && neg[0]!.at < 6, "ticks left of 0 (bleed)");
  ok(rulerTicks(-1e6, 96, 300).every((t) => t.at >= 0 && t.at <= 300), "deep scroll stays in range");
  ok(inchLabel(0.5) === ".5" && inchLabel(-0.125) === "-.125" && inchLabel(12) === "12", "labels trim zero");
  ok(rulerTicks(0, 0, 100).length === 0 && rulerTicks(0, 5000, 100000, 50).length === 50, "guards");
  return { passed, failed: failures.length, failures };
}
