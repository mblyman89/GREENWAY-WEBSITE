/**
 * picture-shape-core — D234 slice C-5 (SOP-11b G-101; F-11-32). Pure.
 *
 * Before C-5 every banner slot recommended the same 1600 × 560 picture
 * (`image-spec-core.ts` WIDE_BANNER, 2.86 : 1), while the banner itself is
 * 1408 × 260 on a computer (5.4 : 1), 390 × 200 on a phone (1.95 : 1), and a
 * different shape at every width in between (fluid height, `interpPx`). The
 * picture is drawn with `object-fit: cover` around the focus point
 * (`banner-design-core.ts` `imageStyle`), so a wrongly shaped picture is cut
 * where the owner cannot see it in the studio.
 *
 * These rules use the banner's REAL shape at every width the site shows
 * (`WIDTH_STOPS` + `canvasRefPx`, the same layout the studio canvas uses):
 *   - `pictureAdvice`: the picture shape and size that fits this banner in
 *     every placement width (the tallest shape, so wider widths only trim top
 *     and bottom), per layout and for one picture used for both;
 *   - `visibleWindow` / `safeArea`: exactly which part of a picture shows at a
 *     width, with cover + object-position + zoom (transform-origin = focus) +
 *     flips, and the part that shows at EVERY width (the studio overlay);
 *   - `cropEdgeHint`: a hint when the picture is cut close to the focus point
 *     (the subject) at some width.
 */
import { CARD_REF_PX, DESKTOP_REF_PX, MOBILE_REF_PX, type BannerDesign, type DesignDevice } from "./banner-design-core";
import { WIDTH_STOPS, canvasRefPx } from "./studio-widths-core";
import { aspectLabelFor, type ImageSpec } from "./image-spec-core";

export type ShapeAt = { w: number; ratio: number };
export type Window = { x0: number; x1: number; y0: number; y1: number };
export type PictureSize = { w: number; h: number; ratio: number; label: string };
export type PictureAdvice = {
  /** Banner shapes (width ÷ height) at each width stop, per layout. */
  desktop: ShapeAt[];
  mobile: ShapeAt[];
  /** Best picture for the computer layout, the phone layout, and one picture for both. */
  forDesktop: PictureSize;
  forMobile: PictureSize;
  forBoth: PictureSize;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** The banner's shape (width ÷ height) at every width stop of a layout. Cards have one shape per layout. */
export function shapesAt(design: Pick<BannerDesign, "frame">, device: DesignDevice): ShapeAt[] {
  const c = design.frame.card;
  if (c) return [{ w: CARD_REF_PX, ratio: device === "mobile" ? c.ratioMobile : c.ratio }];
  return WIDTH_STOPS.filter((s) => s.device === device).map((s) => {
    const { w, h } = canvasRefPx(design, device, s.w);
    return { w: s.w, ratio: w / Math.max(1, h) };
  });
}

/** "2:1", "5.4:1" — a short label for a width ÷ height ratio. */
export function ratioLabel(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return "—";
  if (ratio < 1) return `1:${r2(1 / ratio)}`;
  return `${r2(ratio)}:1`;
}

/** A picture size for a shape: 2400 px wide for banners (sharp on big screens), 1200 for cards. */
export function sizeForRatio(ratio: number, card = false): PictureSize {
  const w = card ? 1200 : 2400;
  const h = Math.round(w / ratio);
  return { w, h, ratio: r2(ratio), label: `${w} × ${h} px (${ratioLabel(ratio)})` };
}

/** The tallest shape covers every width: wider widths only trim the top and bottom. */
export function pictureAdvice(design: Pick<BannerDesign, "frame">): PictureAdvice {
  const desktop = shapesAt(design, "desktop");
  const mobile = shapesAt(design, "mobile");
  const minR = (xs: ShapeAt[]) => Math.min(...xs.map((x) => x.ratio));
  const card = !!design.frame.card;
  return {
    desktop,
    mobile,
    forDesktop: sizeForRatio(minR(desktop), card),
    forMobile: sizeForRatio(minR(mobile), card),
    forBoth: sizeForRatio(Math.min(minR(desktop), minR(mobile)), card),
  };
}

/** Focus, zoom and flips the site uses for a layout (phone focus falls back to the computer focus). */
export function focusFor(design: Pick<BannerDesign, "image">, device: DesignDevice) {
  const im = design.image;
  return {
    fx: device === "mobile" ? (im.focusXMobile ?? im.focusX) : im.focusX,
    fy: device === "mobile" ? (im.focusYMobile ?? im.focusY) : im.focusY,
    zoom: Math.max(1, (im.zoom || 100) / 100),
    flipX: !!im.flip,
    flipY: !!im.fx?.flipY,
  };
}

/**
 * The part of a picture (fractions 0…1 of its width and height) visible in a
 * frame, matching `imageStyle`: object-fit cover, object-position fx% fy%,
 * transform scale(zoom) (and scaleX/Y(-1) flips) around the same point.
 */
export function visibleWindow(picRatio: number, frameRatio: number, fx: number, fy: number, zoom = 1, flipX = false, flipY = false): Window {
  const axis = (k: number, p: number, mirror: boolean): [number, number] => {
    const o = p / 100;
    const m = mirror ? -1 : 1;
    // frame t → element e = o + (t − o)/(zoom·m); the element shows the picture at scale k, offset (1 − k)·o.
    const ends = [o + (0 - o) / (zoom * m), o + (1 - o) / (zoom * m)].map((e) => Math.min(1, Math.max(0, e)));
    const lo = Math.min(...ends);
    const hi = Math.max(...ends);
    const u = (e: number) => Math.min(1, Math.max(0, (e - (1 - k) * o) / k));
    return [u(lo), u(hi)];
  };
  const kx = Math.max(1, picRatio / frameRatio);
  const ky = Math.max(1, frameRatio / picRatio);
  const [x0, x1] = axis(kx, fx, flipX);
  const [y0, y1] = axis(ky, fy, flipY);
  return { x0, x1, y0, y1 };
}

/** The part of the picture that shows at EVERY width of a layout (the studio's safe-area overlay). */
export function safeArea(design: Pick<BannerDesign, "frame" | "image">, picRatio: number, device: DesignDevice): Window {
  const f = focusFor(design, device);
  return shapesAt(design, device)
    .map((s) => visibleWindow(picRatio, s.ratio, f.fx, f.fy, f.zoom, f.flipX, f.flipY))
    .reduce((a, b) => ({ x0: Math.max(a.x0, b.x0), x1: Math.min(a.x1, b.x1), y0: Math.max(a.y0, b.y0), y1: Math.min(a.y1, b.y1) }));
}

/** How close a cut may come to the focus point (fraction of the part that shows) before we hint. */
export const CROP_EDGE_MARGIN = 0.15;
const EPS = 0.001;

/**
 * A hint when, at some width, the picture is cut within CROP_EDGE_MARGIN of
 * the focus point (the subject's centre), measured in the part that shows
 * (what the visitor sees). A picture edge is not a cut.
 */
export function cropEdgeHint(design: Pick<BannerDesign, "frame" | "image">, picRatio: number, device: DesignDevice): string | null {
  const f = focusFor(design, device);
  const u = f.fx / 100;
  const v = f.fy / 100;
  const sides = new Map<string, number[]>();
  for (const s of shapesAt(design, device)) {
    const win = visibleWindow(picRatio, s.ratio, f.fx, f.fy, f.zoom, f.flipX, f.flipY);
    const sx = Math.max(EPS, win.x1 - win.x0);
    const sy = Math.max(EPS, win.y1 - win.y0);
    const near: [string, boolean][] = [
      ["left", win.x0 > EPS && (u - win.x0) / sx < CROP_EDGE_MARGIN],
      ["right", win.x1 < 1 - EPS && (win.x1 - u) / sx < CROP_EDGE_MARGIN],
      ["top", win.y0 > EPS && (v - win.y0) / sy < CROP_EDGE_MARGIN],
      ["bottom", win.y1 < 1 - EPS && (win.y1 - v) / sy < CROP_EDGE_MARGIN],
    ];
    for (const [side, hit] of near) if (hit) sides.set(side, [...(sides.get(side) ?? []), s.w]);
  }
  if (!sides.size) return null;
  const where = design.frame.card ? "on the card" : `at ${[...new Set([...sides.values()].flat())].sort((a, b) => b - a).join(", ")} px wide`;
  const list = [...sides.keys()];
  const sideText = list.length === 1 ? `the ${list[0]}` : `the ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `The picture is cut close to the focus point (on ${sideText}) ${where}, so a subject bigger than a small spot may be cut off. Zoom out, move the focus point, or use a picture shaped like the banner (see Picture shape).`;
}

/** Plain words for how a picture of picW × picH fits this banner (null = it fits). */
export function shapeVerdict(picW: number, picH: number, advice: PictureAdvice): string | null {
  if (!(picW > 0 && picH > 0)) return null;
  const pr = picW / picH;
  const need = advice.forBoth.ratio;
  if (pr < need * 0.9) return `Your picture is ${picW} × ${picH} (${ratioLabel(pr)}), taller than this banner ever is, so the top and bottom are always cut. That is fine if the subject is in the middle band shown below.`;
  if (pr > need * 1.1) {
    const phoneCut = advice.mobile.length ? Math.round((1 - Math.min(...advice.mobile.map((s) => s.ratio)) / pr) * 100) : 0;
    return `Your picture is ${picW} × ${picH} (${ratioLabel(pr)}), wider than this banner on a phone, so phones cut about ${phoneCut}% of its width. For one picture that fits everywhere, use about ${advice.forBoth.label}.`;
  }
  return null;
}

/**
 * The upload hint (ImageSpecHelper) for a placement whose banner has a studio
 * design: the size that fits THAT banner at every width. No design = the
 * placement's existing spec, unchanged (classic look).
 */
export function specForDesign(base: ImageSpec, design: Pick<BannerDesign, "frame"> | null | undefined, device?: DesignDevice | "both"): ImageSpec;
export function specForDesign(base: ImageSpec | undefined, design: Pick<BannerDesign, "frame"> | null | undefined, device?: DesignDevice | "both"): ImageSpec | undefined;
export function specForDesign(base: ImageSpec | undefined, design: Pick<BannerDesign, "frame"> | null | undefined, device: DesignDevice | "both" = "both"): ImageSpec | undefined {
  if (!base || !design) return base;
  const a = pictureAdvice(design);
  const main = device === "desktop" ? a.forDesktop : device === "mobile" ? a.forMobile : a.forBoth;
  const extra = device === "both" ? [{ label: "Computer only", width: a.forDesktop.w, height: a.forDesktop.h }, { label: "Phone only", width: a.forMobile.w, height: a.forMobile.h }] : [];
  const who = device === "desktop" ? "on computers" : device === "mobile" ? "on phones" : "on computers and phones";
  return {
    ...base,
    aspectLabel: aspectLabelFor(main.w, main.h),
    aspectRatio: main.ratio,
    presets: [{ label: "Fits this banner", width: main.w, height: main.h }, ...extra],
    tip: `Shaped like this banner's design, so it fills the banner at every width ${who} with the least cut off. Keep the subject inside the safe area the studio shows (Picture tab).`,
  };
}

/** Banner widths, for the advice text. */
export const PICTURE_REF = { desktop: DESKTOP_REF_PX, mobile: MOBILE_REF_PX };

export function __runPictureShapeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL picture-shape-core: ${m}`);
    }
  };
  const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) < e;
  const img = { focusX: 50, focusY: 50, focusXMobile: null, focusYMobile: null, zoom: 100, brightness: 100, saturation: 100, blur: 0, flip: false };
  const hero = { frame: { height: 260, heightMobile: 200, radius: 16 }, image: img } as unknown as BannerDesign;
  const scale = { frame: { height: 260, heightMobile: 200, radius: 16, scale: true as const }, image: img } as unknown as BannerDesign;
  // shapes
  const sd = shapesAt(hero, "desktop");
  ok(sd.length === 5 && near(sd[0].ratio, 1408 / 260), "computer shape at 1408 = 1408 ÷ 260");
  ok(shapesAt(scale, "desktop").every((s) => near(s.ratio, 1408 / 260, 0.02)), "Scale keeps one shape at every width");
  ok(shapesAt(scale, "mobile").every((s) => near(s.ratio, 390 / 200, 0.02)), "Scale phone shape = 390 ÷ phone height");
  const card = { frame: { height: 200, heightMobile: 160, radius: 16, card: { ratio: 0.75, ratioMobile: 1 } }, image: img } as unknown as BannerDesign;
  ok(shapesAt(card, "desktop")[0].ratio === 0.75 && shapesAt(card, "mobile")[0].ratio === 1, "cards use their shapes");
  // advice
  const a = pictureAdvice(scale);
  ok(near(a.forDesktop.ratio, 5.42, 0.02) && near(a.forMobile.ratio, 1.95, 0.02) && a.forBoth.ratio === a.forMobile.ratio, "advice: tallest shape, both = phone here");
  ok(a.forBoth.w === 2400 && Math.abs(a.forBoth.h - Math.round(2400 / (390 / 200))) <= 4 && a.forBoth.label.startsWith("2400 × "), "advice size 2400 wide");
  ok(pictureAdvice(card).forBoth.w === 1200 && pictureAdvice(card).forBoth.ratio === 0.75, "card advice");
  ok(ratioLabel(2) === "2:1" && ratioLabel(0.5) === "1:2" && ratioLabel(0) === "—", "ratio labels");
  // visible window
  const full = visibleWindow(2, 2, 50, 50);
  ok(full.x0 === 0 && full.x1 === 1 && full.y0 === 0 && full.y1 === 1, "same shape = whole picture");
  const w1 = visibleWindow(4, 2, 50, 50);
  ok(near(w1.x0, 0.25) && near(w1.x1, 0.75) && w1.y0 === 0 && w1.y1 === 1, "wider picture: middle half shows");
  const w2 = visibleWindow(4, 2, 0, 50);
  ok(near(w2.x0, 0) && near(w2.x1, 0.5), "focus 0% = left half");
  const w3 = visibleWindow(4, 2, 100, 50);
  ok(near(w3.x0, 0.5) && near(w3.x1, 1), "focus 100% = right half");
  const w4 = visibleWindow(1, 4, 50, 50);
  ok(near(w4.y0, 0.375) && near(w4.y1, 0.625) && w4.x0 === 0, "taller picture: middle band shows");
  const z = visibleWindow(2, 2, 50, 50, 2);
  ok(near(z.x0, 0.25) && near(z.x1, 0.75) && near(z.y0, 0.25), "zoom 200% around the focus");
  const zf = visibleWindow(2, 2, 20, 50, 2);
  ok(near(zf.x0, 0.1) && near(zf.x1, 0.6), "zoom keeps the focus point fixed");
  const fl = visibleWindow(4, 2, 50, 50, 1, true);
  ok(near(fl.x0, 0.25) && near(fl.x1, 0.75), "a flip around the centre shows the same part");
  // safe area
  const sa = safeArea(hero, 390 / 200, "desktop");
  ok(sa.x0 === 0 && sa.x1 === 1 && sa.y1 - sa.y0 < 0.4 && sa.y1 - sa.y0 > 0.3, "phone-shaped picture on a computer banner: a middle band");
  const sm = safeArea(scale, 390 / 200, "mobile");
  ok(near(sm.x0, 0, 0.02) && near(sm.x1, 1, 0.02) && near(sm.y0, 0, 0.02) && near(sm.y1, 1, 0.02), "picture shaped like the phone banner: all of it shows on phones");
  // crop-edge hint
  ok(cropEdgeHint(scale, 390 / 200, "mobile") === null, "picture shaped like the banner: no hint");
  const side = { ...scale, image: { ...img, focusXMobile: 8 } } as unknown as BannerDesign;
  const h = cropEdgeHint(side, 1600 / 560, "mobile");
  ok(!!h && h.includes("left") && h.includes("398") && h.includes("328"), "focus near a cut on phones: hint names side and widths");
  ok(cropEdgeHint(side, 1600 / 560, "desktop") === null || !cropEdgeHint(side, 1600 / 560, "desktop")!.includes("left"), "computer focus unaffected by the phone focus");
  const edge = { ...scale, image: { ...img, focusXMobile: 100 } } as unknown as BannerDesign;
  ok(!(cropEdgeHint(edge, 1600 / 560, "mobile") ?? "").includes("right"), "the picture's own edge is not a cut");
  const offC = { ...scale, image: { ...img, focusX: 10 } } as unknown as BannerDesign;
  const zoomed = { ...scale, image: { ...img, focusX: 10, zoom: 250 } } as unknown as BannerDesign;
  ok(cropEdgeHint(offC, 1408 / 260, "desktop") === null && !!cropEdgeHint(zoomed, 1408 / 260, "desktop")?.includes("left"), "zoom with the focus near a side: hint; no zoom: none");
  // verdict
  ok(shapeVerdict(1600, 560, a)!.includes("phones cut about") && shapeVerdict(2400, 1231, a) === null && shapeVerdict(1000, 1000, a)!.includes("taller"), "verdicts");
  ok(shapeVerdict(0, 0, a) === null, "unknown size: no verdict");
  const base = { id: "x", title: "X", aspectLabel: "20:7", aspectRatio: 2.86, presets: [{ label: "Desktop banner", width: 1600, height: 560 }], transparent: false, formatNote: "f", tip: "t" };
  ok(specForDesign(base, null) === base && specForDesign(undefined, scale) === undefined, "no design: the placement's spec, unchanged");
  const sp = specForDesign(base, scale);
  ok(sp.presets[0].width === 2400 && sp.presets.length === 3 && near(sp.aspectRatio, 1.95, 0.02) && sp.id === "x", "design: size that fits the banner, computer and phone extras");
  ok(near(specForDesign(base, scale, "desktop").aspectRatio, 5.42, 0.02) && specForDesign(base, scale, "desktop").presets.length === 1, "per layout");
  return { passed, failed };
}
