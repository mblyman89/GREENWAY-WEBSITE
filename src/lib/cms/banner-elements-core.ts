/**
 * R55-S2 — Banner Studio shapes + layers (roadmap R52 §"Layers v2 + shapes").
 *
 * Pure, dependency-free (banner-design-core imports THIS file, never the
 * other way round, so there is no import cycle).
 *
 *  • DesignElement — a decorative layer drawn on the banner: a shape
 *    (rectangle, circle, line, triangle, star, sale burst, arrow, diamond).
 *    Positions/sizes are % of the banner like text boxes, with optional phone
 *    overrides (mx/my/mw/mh). `h: null` = keep square (height follows width),
 *    so circles stay round on any banner shape.
 *  • Layer order — `design.order` (optional) lists item ids back → front.
 *    The public banner keeps a stable DOM/reading order (shapes, text, buttons
 *    — WCAG 1.3.2) and paints the chosen order with z-index.
 *  • Lock — `locked: true` items can still be selected and edited in the
 *    panels but can't be dragged or nudged by accident.
 *
 *  • R55-S3 icons — `kind: "icon"` carries the SVG path data itself (copied
 *    from the curated Phosphor set at pick time), so the public banner needs
 *    no icon library and no lookup table. The path is validated to SVG path
 *    commands only (no markup can be smuggled in).
 *
 * Elements are decorative: rendered aria-hidden, never focusable on the site.
 * Everything optional is written only when used, so banners saved before R55
 * normalize byte-identically.
 */

import { elementMotion, normalizeElementMotion, type ElementMotionFields } from "./banner-motion-core";

export const MAX_ELEMENTS = 12;

export type ShapeKind =
  | "rect" | "circle" | "line" | "triangle" | "star" | "burst" | "arrow" | "diamond"
  // R58-S4 — bigger shape library (all polygons, so outline/orbit/morph just work)
  | "pentagon" | "hexagon" | "octagon" | "star4" | "star6" | "seal" | "heart" | "cloud" | "bubble"
  | "ribbon" | "tag" | "shield" | "cross" | "chevron" | "parallelogram" | "trapezoid" | "bolt"
  | "drop" | "moon" | "half" | "arrow2" | "frame";
export const SHAPE_KINDS: { id: ShapeKind; label: string; square: boolean }[] = [
  { id: "rect", label: "Rectangle", square: false },
  { id: "circle", label: "Circle", square: true },
  { id: "line", label: "Line", square: false },
  { id: "triangle", label: "Triangle", square: true },
  { id: "star", label: "Star", square: true },
  { id: "burst", label: "Sale burst", square: true },
  { id: "arrow", label: "Arrow", square: false },
  { id: "diamond", label: "Diamond", square: true },
  { id: "pentagon", label: "Pentagon", square: true },
  { id: "hexagon", label: "Hexagon", square: true },
  { id: "octagon", label: "Octagon", square: true },
  { id: "star4", label: "Sparkle star", square: true },
  { id: "star6", label: "6-point star", square: true },
  { id: "seal", label: "Seal", square: true },
  { id: "heart", label: "Heart", square: true },
  { id: "cloud", label: "Cloud", square: false },
  { id: "bubble", label: "Speech bubble", square: false },
  { id: "ribbon", label: "Ribbon", square: false },
  { id: "tag", label: "Price tag", square: false },
  { id: "shield", label: "Shield", square: true },
  { id: "cross", label: "Plus", square: true },
  { id: "chevron", label: "Chevron", square: false },
  { id: "parallelogram", label: "Slant box", square: false },
  { id: "trapezoid", label: "Trapezoid", square: false },
  { id: "bolt", label: "Lightning", square: true },
  { id: "drop", label: "Drop", square: true },
  { id: "moon", label: "Moon", square: true },
  { id: "half", label: "Half circle", square: false },
  { id: "arrow2", label: "Double arrow", square: false },
  { id: "frame", label: "Ring", square: true },
];
/** R58-S4 — search words for the shape picker. */
export const SHAPE_KEYWORDS: Partial<Record<ShapeKind, string>> = {
  rect: "box square banner pill background", circle: "dot round oval", line: "divider rule", burst: "sale starburst explosion",
  star: "rating favourite", seal: "badge sticker certified", star4: "twinkle shine glint", heart: "love valentine",
  cloud: "smoke weather puff", bubble: "chat talk quote speech", ribbon: "banner label sash", tag: "price label sale",
  shield: "badge security crest", cross: "plus add medical", chevron: "arrow next", bolt: "flash lightning energy power",
  drop: "water oil tincture rain", moon: "night crescent sleep indica", half: "semicircle sun rise arch", arrow2: "both swap",
  frame: "ring donut circle outline", parallelogram: "slant skew", hexagon: "honeycomb molecule thc",
};
const SHAPE_IDS = SHAPE_KINDS.map((s) => s.id);

export const ICON_PATH_MAX = 4000;
export type ElementKind = "shape" | "icon";

export type DesignElement = {
  id: string;
  kind: ElementKind;
  shape: ShapeKind;
  /** Icons only: curated icon id (e.g. "leaf"), weight and SVG path (viewBox 0 0 256 256). */
  icon?: string;
  iconWeight?: string;
  iconPath?: string;
  x: number;
  y: number;
  w: number;
  /** % of banner height; null = square (height follows width). */
  h: number | null;
  mx: number | null;
  my: number | null;
  mw: number | null;
  mh: number | null;
  fill: string;
  fillOpacity: number;
  stroke: string;
  /** px; for "line" this is the line thickness. */
  strokeWidth: number;
  /** Corner rounding (px) for rectangles. */
  radius: number;
  rotate: number;
  opacity: number;
  hidden: boolean;
  hideOnMobile: boolean;
  locked?: boolean;
  /** R56: gradient fill (any colours); `fill` stays as the fallback. */
  gradient?: ElementGradient;
  /** R56: soft drop shadow (blur px, 0 = off) in any colour. */
  shadow?: number;
  shadowColor?: string;
} & ElementMotionFields;

export type ElementGradient = { from: string; to: string; angle: number };
export const ELEMENT_SHADOW_MAX = 40;

export type LayerKind = "box" | "button" | "element";
export type LayerRef = { kind: LayerKind; id: string };
export type LayerMove = "forward" | "backward" | "front" | "back";

type StyleMap = Record<string, string>;

// ── tiny local helpers (kept here to avoid importing banner-design-core) ─────
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const r4 = (n: number) => Math.round(n * 10000) / 10000;
function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return r4(Math.min(max, Math.max(min, n)));
}
function numOrNull(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? r4(Math.min(max, Math.max(min, n))) : null;
}
function hex(v: unknown, def: string): string {
  if (typeof v !== "string") return def;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return def;
}
function rgba(h: string, pct: number): string {
  const c = hex(h, "#000000");
  return `rgba(${parseInt(c.slice(1, 3), 16)}, ${parseInt(c.slice(3, 5), 16)}, ${parseInt(c.slice(5, 7), 16)}, ${r4(pct / 100)})`;
}
/** True when `d` is a plain SVG path (commands + numbers only), within size. */
export function isSafeIconPath(d: unknown): d is string {
  return typeof d === "string" && d.length > 0 && d.length <= ICON_PATH_MAX && /^[MmLlHhVvCcSsQqTtAaZz0-9.,\-\seE]+$/.test(d);
}

export function cleanElementId(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) : "";
  return s || fallback;
}

// ── defaults + normalizer ────────────────────────────────────────────────────

/** A new icon layer (square, coloured with `fill`). */
export function defaultIcon(icon: string, weight: string, path: string, overrides: Partial<DesignElement> = {}): DesignElement {
  const { id: _id, kind: _kind, shape, ...rest } = defaultElement("rect");
  void _id;
  void _kind;
  // Key order matches normalizeElement so a saved icon round-trips byte-identically.
  return {
    id: "icon",
    kind: "icon",
    shape,
    icon,
    iconWeight: weight,
    iconPath: path,
    ...rest,
    w: 6,
    h: null,
    fill: "#ffffff",
    strokeWidth: 0,
    radius: 0,
    ...overrides,
  };
}

export function defaultElement(shape: ShapeKind = "rect", overrides: Partial<DesignElement> = {}): DesignElement {
  const square = SHAPE_KINDS.find((s) => s.id === shape)?.square ?? false;
  const base: DesignElement = {
    id: "shape",
    kind: "shape",
    shape,
    x: 70,
    y: 20,
    w: shape === "line" ? 30 : square ? 12 : 24,
    h: square ? null : shape === "line" ? 2 : shape === "arrow" ? 14 : 30,
    mx: null,
    my: null,
    mw: null,
    mh: null,
    fill: shape === "burst" ? "#ffd700" : shape === "line" ? "#ffffff" : "#7ed957",
    fillOpacity: 100,
    stroke: "#ffffff",
    strokeWidth: shape === "line" ? 3 : 0,
    radius: shape === "rect" ? 12 : 0,
    rotate: 0,
    opacity: 100,
    hidden: false,
    hideOnMobile: false,
  };
  return { ...base, ...overrides };
}

export function normalizeElement(raw: unknown, fallbackId: string): DesignElement | null {
  if (!isObj(raw)) return null;
  if (raw.kind !== undefined && raw.kind !== "shape" && raw.kind !== "icon") return null;
  const isIcon = raw.kind === "icon";
  if (isIcon && !isSafeIconPath(raw.iconPath)) return null;
  const shape = !isIcon && (SHAPE_IDS as string[]).includes(raw.shape as string) ? (raw.shape as ShapeKind) : "rect";
  const d = isIcon ? defaultIcon("", "", "M0 0") : defaultElement(shape);
  const el: DesignElement = {
    id: cleanElementId(raw.id, fallbackId),
    kind: isIcon ? "icon" : "shape",
    shape,
    ...(isIcon
      ? {
          icon: typeof raw.icon === "string" ? raw.icon.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) : "",
          iconWeight: raw.iconWeight === "bold" || raw.iconWeight === "fill" ? raw.iconWeight : "regular",
          iconPath: raw.iconPath as string,
        }
      : {}),
    x: num(raw.x, d.x, 0, 100),
    y: num(raw.y, d.y, 0, 100),
    w: num(raw.w, d.w, 1, 100),
    h: raw.h === null ? null : raw.h === undefined ? d.h : numOrNull(raw.h, 0.5, 100),
    mx: numOrNull(raw.mx, 0, 100),
    my: numOrNull(raw.my, 0, 100),
    mw: numOrNull(raw.mw, 1, 100),
    mh: numOrNull(raw.mh, 0.5, 100),
    fill: hex(raw.fill, d.fill),
    fillOpacity: num(raw.fillOpacity, 100, 0, 100),
    stroke: hex(raw.stroke, d.stroke),
    strokeWidth: num(raw.strokeWidth, d.strokeWidth, 0, 24),
    radius: num(raw.radius, d.radius, 0, 200),
    rotate: num(raw.rotate, 0, -180, 180),
    opacity: num(raw.opacity, 100, 5, 100),
    hidden: raw.hidden === true,
    hideOnMobile: raw.hideOnMobile === true,
  };
  if (raw.locked === true) el.locked = true;
  // R56: optional fx, written only when used (older designs byte-identical).
  const g = raw.gradient;
  if (isObj(g) && typeof g.from === "string" && typeof g.to === "string" && el.shape !== "line") {
    el.gradient = { from: hex(g.from, el.fill), to: hex(g.to, el.fill), angle: Math.round(num(g.angle, 90, 0, 360)) };
  }
  const sh = num(raw.shadow, 0, 0, ELEMENT_SHADOW_MAX);
  if (sh > 0) {
    el.shadow = Math.round(sh);
    el.shadowColor = hex(raw.shadowColor, "#000000");
  }
  // R57: micro-interactions (breathe/glow/float/spin/wiggle/blob/morph, orbit spark, hover).
  Object.assign(el, normalizeElementMotion(raw, el.shape, isIcon));
  return el;
}

/**
 * Clean a stored `order` against the ids that exist: unknown ids dropped,
 * duplicates removed. Returns null when nothing useful remains.
 */
export function normalizeOrder(raw: unknown, ids: string[]): string[] | null {
  if (!Array.isArray(raw)) return null;
  const known = new Set(ids);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !known.has(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out.length ? out : null;
}

/**
 * Paint order back → front. Default (no order): shapes, then text boxes, then
 * buttons — the same as the DOM order. Items missing from `order` keep their
 * default relative position at the end.
 */
export function resolveLayers(defaults: LayerRef[], order: string[] | null | undefined): LayerRef[] {
  if (!order || !order.length) return defaults.slice();
  const byId = new Map(defaults.map((r) => [r.id, r]));
  const out: LayerRef[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const r = byId.get(id);
    if (r && !seen.has(id)) {
      out.push(r);
      seen.add(id);
    }
  }
  for (const r of defaults) if (!seen.has(r.id)) out.push(r);
  return out;
}

/** Reorder one layer. Returns the new back → front id list (unchanged if id unknown). */
export function moveLayer(ids: string[], id: string, move: LayerMove): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return ids.slice();
  const out = ids.slice();
  out.splice(i, 1);
  const j = move === "front" ? out.length : move === "back" ? 0 : move === "forward" ? Math.min(out.length, i + 1) : Math.max(0, i - 1);
  out.splice(j, 0, id);
  return out;
}

// ── rendering helpers ────────────────────────────────────────────────────────

/** Wrapper style (position/size/rotation). Phone overrides via --gm* vars (globals.css). */
export function elementStyle(el: DesignElement): StyleMap {
  const s: StyleMap = {
    position: "absolute",
    "--gx": `${el.x}%`,
    "--gy": `${el.y}%`,
    "--gw": `${el.w}%`,
    left: "var(--gbx, var(--gx))",
    top: "var(--gby, var(--gy))",
    width: "var(--gbw, var(--gw))",
    margin: "0",
    pointerEvents: "none",
  };
  if (el.h === null) {
    s.aspectRatio = "1 / 1";
    s.height = "auto";
  } else if (el.shape === "line") {
    s.height = `${Math.max(1, el.strokeWidth)}px`;
  } else {
    s["--gh"] = `${el.h}%`;
    s.height = "var(--gbh, var(--gh))";
  }
  if (el.mx !== null) s["--gmx"] = `${el.mx}%`;
  if (el.my !== null) s["--gmy"] = `${el.my}%`;
  if (el.mw !== null) s["--gmw"] = `${el.mw}%`;
  if (el.mh !== null && el.h !== null && el.shape !== "line") s["--gmh"] = `${el.mh}%`;
  if (el.rotate) s.transform = `rotate(${el.rotate}deg)`;
  if (el.opacity < 100) s.opacity = String(r4(el.opacity / 100));
  // drop-shadow follows the real outline of stars, icons, arrows (box-shadow wouldn't).
  if (el.shadow) s.filter = `drop-shadow(0 ${r4(el.shadow / 4)}px ${el.shadow}px ${rgba(el.shadowColor ?? "#000000", 70)})`;
  // R57: motion colour + speed variables (only when motion / hover is used).
  Object.assign(s, elementMotion(el, elementGlow(el)).vars);
  return s;
}

/** R57: the colour a shape glows / sparks in. */
export function elementGlow(el: DesignElement): string {
  return el.shape === "line" ? el.stroke : (el.gradient?.to ?? el.fill);
}

/** R57: hover classes for the positioned box ("" when none). */
export function elementHoverClass(el: DesignElement): string {
  return elementMotion(el, "").outer;
}

/** R57: CSS background for a morphing shape (fill strength + gradient respected). */
export function morphFill(el: DesignElement): string {
  if (el.gradient && el.fillOpacity > 0) return `linear-gradient(${el.gradient.angle}deg, ${rgba(el.gradient.from, el.fillOpacity)}, ${rgba(el.gradient.to, el.fillOpacity)})`;
  return rgba(el.fill, Math.max(el.fillOpacity, 10));
}

/** Polygon points (viewBox 0 0 100 100) for SVG shapes; null = drawn with CSS. */
export function shapePoints(shape: ShapeKind): string | null {
  const star = (points: number, inner: number) => {
    const out: string[] = [];
    for (let i = 0; i < points * 2; i += 1) {
      const r = i % 2 === 0 ? 50 : 50 * inner;
      const a = (Math.PI / points) * i - Math.PI / 2;
      out.push(`${r4(50 + r * Math.cos(a))},${r4(50 + r * Math.sin(a))}`);
    }
    return out.join(" ");
  };
  const poly = (sides: number, rot = -Math.PI / 2) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < sides; i += 1) {
      const a = rot + (2 * Math.PI * i) / sides;
      pts.push([Math.cos(a), Math.sin(a)]);
    }
    return fit(pts);
  };
  switch (shape) {
    case "pentagon":
      return poly(5);
    case "hexagon":
      return poly(6, 0);
    case "octagon":
      return poly(8, Math.PI / 8);
    case "star4":
      return star(4, 0.32);
    case "star6":
      return star(6, 0.55);
    case "seal":
      return star(12, 0.86);
    case "heart":
      return heartPoints();
    case "cloud":
      return cloudPoints();
    case "bubble":
      return "0,0 100,0 100,78 38,78 18,100 22,78 0,78";
    case "ribbon":
      return "0,0 100,0 90,50 100,100 0,100 10,50";
    case "tag":
      return "0,0 78,0 100,50 78,100 0,100";
    case "shield":
      return "50,0 100,14 96,52 82,78 50,100 18,78 4,52 0,14";
    case "cross":
      return "34,0 66,0 66,34 100,34 100,66 66,66 66,100 34,100 34,66 0,66 0,34 34,34";
    case "chevron":
      return "0,0 70,0 100,50 70,100 0,100 30,50";
    case "parallelogram":
      return "22,0 100,0 78,100 0,100";
    case "trapezoid":
      return "20,0 80,0 100,100 0,100";
    case "bolt":
      return "58,0 12,58 44,58 34,100 88,38 56,38 70,0";
    case "drop":
      return dropPoints();
    case "moon":
      return moonPoints();
    case "half":
      return halfPoints();
    case "arrow2":
      return "0,50 24,0 24,28 76,28 76,0 100,50 76,100 76,72 24,72 24,100";
    case "frame":
      return ringPoints();
    case "triangle":
      return "50,0 100,100 0,100";
    case "diamond":
      return "50,0 100,50 50,100 0,50";
    case "arrow":
      return "0,30 62,30 62,0 100,50 62,100 62,70 0,70";
    case "star":
      return star(5, 0.45);
    case "burst":
      return star(14, 0.78);
    default:
      return null;
  }
}

/** Scale any point cloud to fill the 0–100 box. */
function fit(pts: [number, number][]): string {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pts.map(([x, y]) => `${r4(((x - x0) / (x1 - x0 || 1)) * 100)},${r4(((y - y0) / (y1 - y0 || 1)) * 100)}`).join(" ");
}
function heartPoints(): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < 48; i += 1) {
    const t = (2 * Math.PI * i) / 48;
    pts.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  }
  return fit(pts);
}
/** Cloud = outline of overlapping puffs, ray-cast from the middle (star-shaped). */
function cloudPoints(): string {
  const puffs: [number, number, number][] = [[24, 62, 20], [44, 44, 25], [68, 46, 21], [82, 64, 16], [52, 66, 22], [30, 72, 14], [70, 72, 14]];
  const pts: [number, number][] = [];
  for (let i = 0; i < 64; i += 1) {
    const a = (2 * Math.PI * i) / 64;
    const [dx, dy] = [Math.cos(a), Math.sin(a)];
    let best = 0;
    for (const [cx, cy, r] of puffs) {
      const [ox, oy] = [52 - cx, 60 - cy];
      const b = ox * dx + oy * dy;
      const c = ox * ox + oy * oy - r * r;
      const disc = b * b - c;
      if (disc >= 0) best = Math.max(best, -b + Math.sqrt(disc));
    }
    pts.push([52 + best * dx, 60 + best * dy]);
  }
  return fit(pts);
}
function dropPoints(): string {
  const pts: [number, number][] = [[0, -1.9]];
  for (let i = 0; i <= 32; i += 1) {
    const a = -Math.PI / 6 + ((Math.PI * 4) / 3) * (i / 32);
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return fit(pts);
}
function moonPoints(): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 32; i += 1) {
    const a = Math.PI / 2 + Math.PI * 1.6 * (i / 32) - Math.PI * 0.3;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  for (let i = 32; i >= 0; i -= 1) {
    const a = Math.PI / 2 + Math.PI * 1.6 * (i / 32) - Math.PI * 0.3;
    const [x, y] = [Math.cos(a) * 0.8 + 0.42, Math.sin(a) * 0.8];
    if (Math.hypot(x, y) <= 1) pts.push([x, y]);
  }
  return fit(pts);
}
function halfPoints(): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 32; i += 1) {
    const a = Math.PI + Math.PI * (i / 32);
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  return fit(pts);
}
/** Ring: outer circle then inner circle reversed, joined by a hair-thin seam. */
function ringPoints(): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i += 1) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 40;
    pts.push([Math.cos(a), Math.sin(a)]);
  }
  for (let i = 40; i >= 0; i -= 1) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 40;
    pts.push([Math.cos(a) * 0.72, Math.sin(a) * 0.72]);
  }
  return fit(pts);
}

/** Inner visual: either a CSS box style or an SVG polygon spec. */
export function shapeVisual(
  el: DesignElement,
): { css: StyleMap } | { points: string; fill: string; stroke: string | null; strokeWidth: number; grad?: SvgGradient } | { iconPath: string; fill: string; grad?: SvgGradient } {
  const fill = el.fillOpacity > 0 ? rgba(el.fill, el.fillOpacity) : "transparent";
  const grad = el.gradient && el.fillOpacity > 0 ? svgGradient(el.gradient, el.fillOpacity) : undefined;
  const svgFill = grad ? `url(#${grad.id})` : fill;
  if (el.kind === "icon") return { iconPath: isSafeIconPath(el.iconPath) ? el.iconPath : "", fill: svgFill, ...(grad ? { grad } : {}) };
  const pts = shapePoints(el.shape);
  if (pts) return { points: pts, fill: svgFill, stroke: el.strokeWidth > 0 ? el.stroke : null, strokeWidth: el.strokeWidth, ...(grad ? { grad } : {}) };
  if (el.shape === "line") return { css: { width: "100%", height: "100%", background: el.stroke, borderRadius: "999px" } };
  const bg = grad ? `linear-gradient(${el.gradient!.angle}deg, ${rgba(el.gradient!.from, el.fillOpacity)}, ${rgba(el.gradient!.to, el.fillOpacity)})` : fill;
  const css: StyleMap = { width: "100%", height: "100%", background: bg, boxSizing: "border-box" };
  if (el.strokeWidth > 0) css.border = `${el.strokeWidth}px solid ${el.stroke}`;
  css.borderRadius = el.shape === "circle" ? "50%" : `${el.radius}px`;
  return { css };
}

/**
 * SVG gradient for a shape/icon. The id is derived from the colours + angle,
 * so two shapes sharing an id always define the SAME gradient (no clashes when
 * several banners sit on one page). CSS angle → SVG rotation: CSS 90deg is
 * left→right, which is SVG's default x1=0→x2=1, so rotate by (angle − 90).
 */
export type SvgGradient = { id: string; from: string; to: string; rotate: number };
export function svgGradient(g: ElementGradient, fillOpacity = 100): SvgGradient {
  const a = Math.round(fillOpacity);
  return { id: `gwg-${g.from.slice(1)}-${g.to.slice(1)}-${g.angle}-${a}`, from: rgba(g.from, a), to: rgba(g.to, a), rotate: g.angle - 90 };
}

/** Element position for a device (phone overrides fall back to computer). */
export function elementPosition(el: DesignElement, device: "desktop" | "mobile"): { x: number; y: number; w: number; h: number | null } {
  if (device === "mobile") return { x: el.mx ?? el.x, y: el.my ?? el.y, w: el.mw ?? el.w, h: el.h === null ? null : (el.mh ?? el.h) };
  return { x: el.x, y: el.y, w: el.w, h: el.h };
}

/** Friendly name for a shape/icon layer. */
export function elementLabel(el: DesignElement, iconLabels: Record<string, string> = {}): string {
  if (el.kind === "icon") return `${el.icon?.startsWith("o-") ? "Object" : "Icon"} — ${iconLabels[el.icon ?? ""] ?? el.icon ?? "icon"}`;
  return SHAPE_KINDS.find((k) => k.id === el.shape)?.label ?? "Shape";
}

export function layerLabel(kind: LayerKind): string {
  return kind === "box" ? "Text" : kind === "button" ? "Button" : "Shape";
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runBannerElementsTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL banner-elements-core: ${m}`);
    }
  };
  const J = (v: unknown) => JSON.stringify(v);
  const d = defaultElement("circle", { id: "dot" });
  ok(J(normalizeElement(JSON.parse(J(d)), "x")) === J(d), "default circle round-trips");
  ok(d.h === null, "circle keeps square");
  ok(defaultElement("rect").h === 30 && defaultElement("line").strokeWidth === 3, "rect/line defaults");
  ok(normalizeElement({ kind: "video" }, "x") === null, "unknown kind rejected");
  ok(normalizeElement("nope", "x") === null, "non-object rejected");
  const bad = normalizeElement({ shape: "blob", x: 500, w: -3, fill: "red", rotate: 999, opacity: 0, id: "A B!" }, "el-1")!;
  ok(bad.shape === "rect" && bad.x === 100 && bad.w === 1, "clamped shape/x/w");
  ok(bad.fill === "#7ed957" && bad.rotate === 180 && bad.opacity === 5, "bad colour/rotate/opacity fixed");
  ok(bad.id === "ab", "id cleaned");
  ok(!("locked" in bad) && normalizeElement({ locked: true }, "e")!.locked === true, "locked only when true");
  ok(normalizeElement({ shape: "rect", h: null }, "e")!.h === null, "explicit null h kept");
  // order
  ok(J(normalizeOrder(["b", "zz", "a", "b"], ["a", "b"])) === J(["b", "a"]), "order cleaned + deduped");
  ok(normalizeOrder([], ["a"]) === null && normalizeOrder("x", ["a"]) === null, "empty/invalid order -> null");
  const defs: LayerRef[] = [
    { kind: "element", id: "s" },
    { kind: "box", id: "t" },
    { kind: "button", id: "b" },
  ];
  ok(J(resolveLayers(defs, null).map((r) => r.id)) === J(["s", "t", "b"]), "default layer order");
  ok(J(resolveLayers(defs, ["b", "s"]).map((r) => r.id)) === J(["b", "s", "t"]), "missing ids appended");
  ok(J(moveLayer(["a", "b", "c"], "a", "forward")) === J(["b", "a", "c"]), "forward");
  ok(J(moveLayer(["a", "b", "c"], "c", "backward")) === J(["a", "c", "b"]), "backward");
  ok(J(moveLayer(["a", "b", "c"], "a", "front")) === J(["b", "c", "a"]), "to front");
  ok(J(moveLayer(["a", "b", "c"], "c", "back")) === J(["c", "a", "b"]), "to back");
  ok(J(moveLayer(["a", "b"], "b", "forward")) === J(["a", "b"]), "front item forward = no-op");
  ok(J(moveLayer(["a"], "x", "front")) === J(["a"]), "unknown id unchanged");
  // styles
  const st = elementStyle(d);
  ok(st.aspectRatio === "1 / 1" && st.height === "auto" && st.pointerEvents === "none", "square style");
  const rect = defaultElement("rect", { mh: 40, rotate: 15, opacity: 50 });
  const rs = elementStyle(rect);
  ok(rs["--gh"] === "30%" && rs["--gmh"] === "40%" && rs.transform === "rotate(15deg)" && rs.opacity === "0.5", "rect style + phone height");
  ok(elementStyle(defaultElement("line")).height === "3px", "line thickness = height");
  const v = shapeVisual(defaultElement("circle"));
  ok("css" in v && v.css.borderRadius === "50%", "circle via css");
  const sv = shapeVisual(defaultElement("star", { strokeWidth: 2 }));
  ok("points" in sv && sv.points.split(" ").length === 10 && sv.stroke === "#ffffff", "star polygon 10 points + stroke");
  ok((shapePoints("burst") ?? "").split(" ").length === 28, "burst 28 points");
  ok(SHAPE_KINDS.length >= 30 && new Set(SHAPE_KINDS.map((k) => k.id)).size === SHAPE_KINDS.length, "R58 shape library ≥30, unique ids");
  ok(
    SHAPE_KINDS.filter((k) => !["rect", "circle", "line"].includes(k.id)).every((k) => {
      const nums = (shapePoints(k.id) ?? "").split(/[ ,]/).map(Number);
      return nums.length >= 6 && nums.every((n) => Number.isFinite(n) && n >= -0.01 && n <= 100.01);
    }),
    "every polygon shape has finite points inside 0–100",
  );
  ok(normalizeElement({ id: "h", kind: "shape", shape: "heart" }, "h")?.shape === "heart", "new shapes survive normalize");
  ok(J(elementPosition(rect, "mobile")) === J({ x: 70, y: 20, w: 24, h: 40 }), "phone position");
  // R55-S3 icons
  const ic = defaultIcon("leaf", "bold", "M10,20 L30 40Z", { id: "leaf" });
  ok(J(normalizeElement(JSON.parse(J(ic)), "x")) === J(ic), "icon round-trips");
  ok(normalizeElement({ kind: "icon", iconPath: "M0 0\"/><script>" }, "x") === null, "unsafe icon path rejected");
  ok(normalizeElement({ kind: "icon" }, "x") === null, "icon without path rejected");
  ok(normalizeElement({ kind: "icon", iconPath: "M1 1", iconWeight: "huge", icon: "Le af!" }, "x")!.iconWeight === "regular", "icon weight defaulted");
  ok(normalizeElement({ kind: "icon", iconPath: "M1 1", icon: "Le af!" }, "x")!.icon === "leaf", "icon id cleaned");
  ok(!("icon" in normalizeElement({ shape: "star" }, "x")!), "shapes carry no icon fields");
  const iv = shapeVisual(ic);
  ok("iconPath" in iv && iv.iconPath === "M10,20 L30 40Z" && iv.fill === "rgba(255, 255, 255, 1)", "icon visual");
  ok(elementLabel(ic, { leaf: "Leaf" }) === "Icon — Leaf" && elementLabel(defaultElement("burst")) === "Sale burst", "labels");
  ok(isSafeIconPath("M1e-3 2") && !isSafeIconPath("x".repeat(5)) && !isSafeIconPath("M".repeat(ICON_PATH_MAX + 1)), "path guard");
  // R56-S1: gradient + shadow on shapes/icons (any colour), only when used.
  {
    const plain = normalizeElement({ shape: "star" }, "s")!;
    ok(!("gradient" in plain) && !("shadow" in plain), "R56 fx absent by default");
    const fx = normalizeElement({ shape: "star", fill: "#ff00ff", gradient: { from: "#f00", to: "nope", angle: 45.6 }, shadow: 99, shadowColor: "#123456" }, "s")!;
    ok(fx.gradient!.from === "#ff0000" && fx.gradient!.to === "#ff00ff" && fx.gradient!.angle === 46, "R56 gradient cleaned (bad colour → fill)");
    ok(fx.shadow === ELEMENT_SHADOW_MAX && fx.shadowColor === "#123456", "R56 shadow clamped");
    ok(JSON.stringify(normalizeElement(JSON.parse(JSON.stringify(fx)), "s")) === JSON.stringify(fx), "R56 fx round trip");
    const v = shapeVisual(fx) as { fill: string; grad?: SvgGradient };
    ok(v.grad!.rotate === -44 && v.fill === `url(#${v.grad!.id})`, "R56 svg gradient wired");
    ok(svgGradient({ from: "#000000", to: "#ffffff", angle: 90 }).id === svgGradient({ from: "#000000", to: "#ffffff", angle: 90 }).id, "R56 gradient id deterministic");
    const rect = shapeVisual(normalizeElement({ shape: "rect", gradient: { from: "#000000", to: "#ffffff", angle: 180 } }, "r")!) as { css: StyleMap };
    ok(rect.css.background.startsWith("linear-gradient(180deg"), "R56 css gradient for rects");
    ok((elementStyle(fx).filter ?? "").startsWith("drop-shadow(0 10px 40px rgba(18, 52, 86, 0.7"), "R56 shadow via drop-shadow");
    ok(!("gradient" in normalizeElement({ shape: "line", gradient: { from: "#000", to: "#fff" } }, "l")!), "R56 no gradient on lines");
  }

  return { passed, failed };
}
