/**
 * R70 S2 - Merch Studio design model (PURE, no I/O, no DOM).
 *
 * A MerchDesign is one product idea: ONE blank + ONE garment colour + art on
 * any number of that blank's placements ("sides"). Every element lives in
 * REAL INCHES inside its placement's print frame (top-left origin), so what
 * you see on the canvas is exactly what Slice 3 renders at 300 DPI.
 *
 * Text widths are MEASURED by the browser (the component passes them in) -
 * never guessed. Letter height is an ESTIMATE from font size (cap height
 * ~0.70 em, x-height ~0.50 em - typical for the fonts in FONT_OPTIONS) and is
 * labelled as such in the UI.
 *
 * Images are stored on this device (IndexedDB) by `assetId`; the design JSON
 * itself stays small enough for localStorage drafts (Slice 4 moves drafts to
 * Supabase with migration 0281+).
 */
import { BLANKS, colorsFor, getBlank, getPlacement, nearestThread, type Blank, type Method, type Placement } from "./garment-catalog-core";
import { checkDesign, type Issue, type RuleElement } from "./print-rules-core";
import { curveGeometry } from "@/lib/cms/banner-curve-core";

export type ElKind = "text" | "image" | "shape" | "icon";
export type ShapeName = "rect" | "circle" | "line" | string; // string = banner ShapeKind polygon id
export type Align = "left" | "center" | "right";

export interface MElement {
  id: string;
  kind: ElKind;
  name?: string;
  /** Inches inside the frame: top-left of the UNROTATED box. */
  x: number; y: number; w: number; h: number;
  rotate: number;        // degrees, -180..180
  opacity: number;       // 0..100
  locked?: boolean;
  hidden?: boolean;
  fill: string;          // hex (text/shape/icon); ignored for images
  strokeIn: number;      // outline width, inches (0 = none)
  strokeColor: string;
  // text
  text?: string;
  fontId?: string;
  weight?: 400 | 700 | 900;
  italic?: boolean;
  fontSizeIn?: number;
  lineHeight?: number;   // multiple of font size
  letterSpacingEm?: number;
  align?: Align;
  curve?: number;        // -100..100 (single-line only)
  /** Browser-measured width of each line at fontSizeIn (inches). */
  lineWidthsIn?: number[];
  // shape / icon
  shape?: ShapeName;
  iconPath?: string;     // SVG path in a 0 0 256 256 box
  radiusIn?: number;     // rect corner radius
  // image
  assetId?: string;
  pxW?: number; pxH?: number;
  /** Auto-analysis (estimate) + owner overrides. */
  imgColors?: string[];
  imgCoverage?: number;  // 0..1 opaque share
  autoPhoto?: boolean;
  /** SVG artwork: scales without pixelation, so no DPI rule. */
  vector?: boolean;
  isPhoto?: boolean;
  hasGradient?: boolean;
}

export interface Side {
  method: Method;
  puff?: boolean;
  elements: MElement[];
}

export interface MerchDesign {
  v: 1;
  id: string;
  name: string;
  blankId: string;
  colorHex: string;
  sides: Record<string, Side>;
  /** Acknowledged "review" issue ids (compliance), per placement: `${placementId}:${issueId}`. */
  ack: string[];
  updatedAt: string;
}

// Constants ------------------------------------------------------------------------
export const CAP_HEIGHT_EM = 0.7;
export const X_HEIGHT_EM = 0.5;
export const NUDGE_IN = 1 / 16;
export const NUDGE_BIG_IN = 1 / 4;
export const MIN_SIZE_IN = 0.05;
export const MAX_ELEMENTS_PER_SIDE = 40;
export const DEFAULT_FONT_IN = 0.6;

const r4 = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

export function newId(prefix = "el"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

/** First-time design for a blank: its default method on the first placement. */
export function newDesign(blank: Blank, colorHex: string, name = "Untitled design"): MerchDesign {
  return { v: 1, id: newId("ds"), name, blankId: blank.id, colorHex, sides: {}, ack: [], updatedAt: new Date(0).toISOString() };
}

/** The side for a placement (created lazily with the placement's first method). */
export function sideFor(d: MerchDesign, p: Placement): Side {
  const s = d.sides[p.id];
  if (s && p.methods.includes(s.method)) return s;
  return { method: s?.method && p.methods.includes(s.method) ? s.method : p.methods[0], puff: s?.puff, elements: s?.elements ?? [] };
}

export function setSide(d: MerchDesign, placementId: string, side: Side): MerchDesign {
  return { ...d, sides: { ...d.sides, [placementId]: side } };
}

/** Placements that carry at least one visible element. */
export function usedPlacements(d: MerchDesign, b: Blank): Placement[] {
  return b.placements.filter((p) => (d.sides[p.id]?.elements ?? []).some((e) => !e.hidden));
}

// Text geometry --------------------------------------------------------------------
export function textLines(t: string | undefined): string[] {
  const lines = (t ?? "").split("\n");
  return lines.length ? lines : [""];
}
/** Letter height used by the print rules (estimate from font size). */
export function letterHeightIn(e: Pick<MElement, "text" | "fontSizeIn">): number {
  const fs = e.fontSizeIn ?? DEFAULT_FONT_IN;
  return r4(fs * (/[A-Z0-9]/.test(e.text ?? "") ? CAP_HEIGHT_EM : X_HEIGHT_EM));
}
/** Font size that gives a target letter (cap) height. */
export function fontSizeForLetterHeight(letterIn: number, text: string): number {
  return r4(letterIn / (/[A-Z0-9]/.test(text) ? CAP_HEIGHT_EM : X_HEIGHT_EM));
}
/** Box size of a straight text element from measured line widths. */
export function textBox(lineWidthsIn: number[], fs: number, lineHeight: number): { w: number; h: number } {
  const w = Math.max(MIN_SIZE_IN, ...lineWidthsIn.map((x) => (Number.isFinite(x) ? x : 0)));
  const n = Math.max(1, lineWidthsIn.length);
  return { w: r4(w), h: r4(fs * (1 + (n - 1) * lineHeight)) };
}

// Geometry -------------------------------------------------------------------------
export interface Box { x: number; y: number; w: number; h: number }
/** Axis-aligned bounding box of a rotated element. */
export function rotatedBox(e: Box & { rotate?: number }): Box {
  const a = ((e.rotate ?? 0) * Math.PI) / 180;
  if (!a) return { x: e.x, y: e.y, w: e.w, h: e.h };
  const c = Math.abs(Math.cos(a)); const s = Math.abs(Math.sin(a));
  const w = e.w * c + e.h * s; const h = e.w * s + e.h * c;
  const cx = e.x + e.w / 2; const cy = e.y + e.h / 2;
  return { x: r4(cx - w / 2), y: r4(cy - h / 2), w: r4(w), h: r4(h) };
}
export const toPct = (b: Box, fw: number, fh: number): Box => ({ x: (b.x / fw) * 100, y: (b.y / fh) * 100, w: (b.w / fw) * 100, h: (b.h / fh) * 100 });
export const fromPct = (x: number, y: number, fw: number, fh: number) => ({ x: r4((x / 100) * fw), y: r4((y / 100) * fh) });

/** Snap a value to a 1/16 inch grid (the studio's precision). */
export const snap16 = (v: number) => Math.round(v * 16) / 16;

/** Resize keeping the opposite corner fixed; `keep` keeps aspect ratio. Returns x,y,w,h. */
export function resizeFrom(start: Box, corner: "nw" | "ne" | "sw" | "se", dx: number, dy: number, keep: boolean): Box {
  let { x, y, w, h } = start;
  const sx = corner === "ne" || corner === "se" ? 1 : -1;
  const sy = corner === "sw" || corner === "se" ? 1 : -1;
  let nw = Math.max(MIN_SIZE_IN, w + sx * dx);
  let nh = Math.max(MIN_SIZE_IN, h + sy * dy);
  if (keep) {
    const k = Math.max(nw / w, nh / h);
    nw = Math.max(MIN_SIZE_IN, w * k); nh = Math.max(MIN_SIZE_IN, h * k);
  }
  if (sx < 0) x = x + w - nw;
  if (sy < 0) y = y + h - nh;
  w = nw; h = nh;
  return { x: r4(x), y: r4(y), w: r4(w), h: r4(h) };
}

/**
 * Corner-resize a ROTATED element: the pointer delta is taken in the
 * element's own axes and the opposite corner stays pinned on the garment.
 */
export function resizeRotated(start: Box & { rotate?: number }, corner: "nw" | "ne" | "sw" | "se", dxWorld: number, dyWorld: number, keep: boolean): Box {
  const a = ((start.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a); const sin = Math.sin(a);
  const dx = dxWorld * cos + dyWorld * sin;
  const dy = -dxWorld * sin + dyWorld * cos;
  const sized = resizeFrom(start, corner, dx, dy, keep);
  if (!a) return sized;
  const ax = corner === "nw" || corner === "sw" ? 1 : -1; // anchor = opposite corner
  const ay = corner === "nw" || corner === "ne" ? 1 : -1;
  const c0x = start.x + start.w / 2; const c0y = start.y + start.h / 2;
  const lx0 = (ax * start.w) / 2; const ly0 = (ay * start.h) / 2;
  const wx = c0x + lx0 * cos - ly0 * sin; const wy = c0y + lx0 * sin + ly0 * cos;
  const lx1 = (ax * sized.w) / 2; const ly1 = (ay * sized.h) / 2;
  const cx = wx - (lx1 * cos - ly1 * sin); const cy = wy - (lx1 * sin + ly1 * cos);
  return { x: r4(cx - sized.w / 2), y: r4(cy - sized.h / 2), w: sized.w, h: sized.h };
}

/** Box for curved (arched) single-line text: arc length = measured line width. */
export function curvedBox(lineW: number, fs: number, curve: number): { w: number; h: number; viewBox: string; d: string } {
  const W = Math.max(MIN_SIZE_IN, lineW);
  const g = curveGeometry(curve, W, fs);
  const [, , vw, vh] = g.viewBox.split(" ").map(Number);
  return { w: r4(vw), h: r4(vh), viewBox: g.viewBox, d: g.d };
}

// Element factories ---------------------------------------------------------------
const base = (kind: ElKind, frame: { w: number; h: number }, w: number, h: number, over: Partial<MElement> = {}): MElement => ({
  id: newId(), kind, x: r4((frame.w - w) / 2), y: r4(Math.max(0, (frame.h - h) / 2)), w: r4(w), h: r4(h), rotate: 0, opacity: 100,
  fill: "#ffffff", strokeIn: 0, strokeColor: "#000000", ...over,
});
export function makeText(frame: { w: number; h: number }, text: string, lineWidthsIn: number[], fs: number, fill: string, fontId = "montserrat"): MElement {
  const box = textBox(lineWidthsIn, fs, 1.1);
  return base("text", frame, box.w, box.h, { text, fontId, weight: 700, fontSizeIn: fs, lineHeight: 1.1, letterSpacingEm: 0, align: "center", curve: 0, lineWidthsIn, fill, name: text.slice(0, 24) });
}
export function makeShape(frame: { w: number; h: number }, shape: ShapeName, fill: string): MElement {
  const s = Math.min(frame.w, frame.h) * 0.4;
  if (shape === "line") return base("shape", frame, Math.min(frame.w * 0.6, 4), 0.1, { shape, fill, name: "Line" });
  if (shape === "rect") return base("shape", frame, s * 1.5, s, { shape, fill, radiusIn: 0, name: "Rectangle" });
  return base("shape", frame, s, s, { shape, fill, name: shape === "circle" ? "Circle" : shape });
}
export function makeIcon(frame: { w: number; h: number }, path: string, label: string, fill: string): MElement {
  const s = Math.min(frame.w, frame.h) * 0.4;
  return base("icon", frame, s, s, { iconPath: path, fill, name: label });
}
export function makeImage(frame: { w: number; h: number }, assetId: string, name: string, pxW: number, pxH: number, analysis?: PixelAnalysis): MElement {
  // Largest size that fits the frame AND stays >= 300 DPI (never upscale past sharp).
  const maxW = Math.min(frame.w, pxW / 300, (frame.h * pxW) / pxH);
  const w = Math.max(0.25, maxW);
  const h = (w * pxH) / pxW;
  return base("image", frame, w, h, {
    assetId, name, pxW, pxH, fill: "#ffffff",
    imgColors: analysis?.colors ?? [], imgCoverage: analysis?.coverage, autoPhoto: analysis?.photoLikely ?? false,
    isPhoto: analysis?.photoLikely ?? false, hasGradient: analysis?.photoLikely ?? false,
  });
}

// Ink estimates (for stitch + DTF weight rules) -------------------------------------
const SHAPE_FILL: Record<string, number> = { rect: 1, circle: Math.PI / 4, line: 1, frame: 0.36 };
export function inkAreaSqIn(e: MElement): number {
  if (e.kind === "image") return r4(e.w * e.h * (e.imgCoverage ?? 1));
  if (e.kind === "text") {
    const fs = e.fontSizeIn ?? DEFAULT_FONT_IN;
    const letters = (e.text ?? "").replace(/\s+/g, "").length;
    const weightK = e.weight === 900 ? 0.42 : e.weight === 700 ? 0.34 : 0.26;
    return r4(letters * fs * fs * weightK * 0.6);
  }
  if (e.kind === "icon") return r4(e.w * e.h * 0.35);
  const f = SHAPE_FILL[e.shape ?? "rect"] ?? 0.55;
  return r4(e.w * e.h * f);
}
export function perimeterIn(e: MElement): number {
  if (e.kind === "shape" && e.shape === "circle") return r4(Math.PI * (e.w + e.h) / 2);
  if (e.kind === "text") return r4((e.text ?? "").replace(/\s+/g, "").length * (e.fontSizeIn ?? DEFAULT_FONT_IN) * 2.5);
  return r4(2 * (e.w + e.h));
}

/** Colours an element puts on the garment. */
export function elementColors(e: MElement): string[] {
  const out: string[] = [];
  if (e.kind === "image") out.push(...(e.imgColors ?? []));
  else out.push(e.fill.toUpperCase());
  if (e.strokeIn > 0 && e.kind !== "image") out.push(e.strokeColor.toUpperCase());
  return [...new Set(out)];
}

/** Convert one design element to the rules engine's view of it. */
export function toRuleElement(e: MElement): RuleElement {
  const bb = rotatedBox(e);
  const r: RuleElement = {
    id: e.id, kind: e.kind === "icon" ? "shape" : e.kind, name: e.name, x: bb.x, y: bb.y, w: bb.w, h: bb.h,
    colors: elementColors(e), opacity: e.opacity / 100, inkAreaSqIn: inkAreaSqIn(e),
  };
  if (e.strokeIn > 0) { r.strokeIn = e.strokeIn; r.strokeLengthIn = perimeterIn(e); }
  if (e.kind === "text") { r.text = e.text; r.fontSizeIn = e.fontSizeIn; r.letterHeightIn = letterHeightIn(e); }
  if (e.kind === "shape") r.minFeatureIn = e.shape === "line" ? Math.min(e.w, e.h) : r4(Math.min(e.w, e.h));
  if (e.kind === "image") { if (!e.vector) { r.pxW = e.pxW; r.pxH = e.pxH; } r.isPhoto = !!e.isPhoto; r.hasGradient = !!e.hasGradient; }
  return r;
}

/** Run the print rules on every used placement (or one). Issue ids are prefixed with the placement id. */
export function checkSides(d: MerchDesign, garmentHex = d.colorHex, only?: string): { placement: Placement; method: Method; issues: Issue[] }[] {
  const b = getBlank(d.blankId);
  if (!b) return [];
  const out: { placement: Placement; method: Method; issues: Issue[] }[] = [];
  for (const p of b.placements) {
    if (only && p.id !== only) continue;
    const s = d.sides[p.id];
    if (!s || (!only && !s.elements.some((e) => !e.hidden))) continue;
    const side = sideFor(d, p);
    const issues = checkDesign({ blank: b, placement: p, method: side.method, garmentHex, elements: side.elements.filter((e) => !e.hidden).map(toRuleElement), puff: side.puff });
    out.push({ placement: p, method: side.method, issues });
  }
  return out;
}

/** Recolour every element of one side to the nearest Printful thread. */
export function snapSideToThreads(side: Side): Side {
  return {
    ...side,
    elements: side.elements.map((e) => {
      if (e.kind === "image") return { ...e, imgColors: [...new Set((e.imgColors ?? []).map((c) => nearestThread(c).hex.toUpperCase()))] };
      return { ...e, fill: nearestThread(e.fill).hex, strokeColor: nearestThread(e.strokeColor).hex, opacity: 100 };
    }),
  };
}

// Pixel analysis (images) ---------------------------------------------------------
export interface PixelAnalysis { coverage: number; distinct: number; colors: string[]; photoLikely: boolean }
const hex2 = (n: number) => n.toString(16).padStart(2, "0");
/**
 * Analyse RGBA pixels (already downscaled by the browser, ideally <= 256 px).
 * Quantises to 4 bits per channel; counts buckets holding >= 0.2% of the
 * opaque pixels. Many busy buckets => photo/gradient likely (ESTIMATE - the
 * owner can override). Returns up to 8 dominant colours (>= 3% share).
 */
export function analyzePixels(data: ArrayLike<number>): PixelAnalysis {
  const n = Math.floor(data.length / 4);
  const bins = new Map<number, { c: number; r: number; g: number; b: number }>();
  let opaque = 0;
  for (let i = 0; i < n; i += 1) {
    const a = data[i * 4 + 3];
    if (a < 128) continue;
    opaque += 1;
    const r = data[i * 4]; const g = data[i * 4 + 1]; const b = data[i * 4 + 2];
    const k = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cur = bins.get(k);
    if (cur) { cur.c += 1; cur.r += r; cur.g += g; cur.b += b; } else bins.set(k, { c: 1, r, g, b });
  }
  if (!opaque) return { coverage: 0, distinct: 0, colors: [], photoLikely: false };
  const busy = [...bins.values()].filter((v) => v.c / opaque >= 0.002);
  const colors = busy
    .filter((v) => v.c / opaque >= 0.03)
    .sort((a, b) => b.c - a.c)
    .slice(0, 8)
    .map((v) => `#${hex2(Math.round(v.r / v.c))}${hex2(Math.round(v.g / v.c))}${hex2(Math.round(v.b / v.c))}`.toUpperCase());
  return { coverage: r4(opaque / n), distinct: busy.length, colors, photoLikely: busy.length > 40 };
}

// Validation (drafts from storage) -------------------------------------------------
const num = (v: unknown, d: number, lo = -1e6, hi = 1e6) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : d);
const ELS: ElKind[] = ["text", "image", "shape", "icon"];
export function normalizeElement(raw: unknown): MElement | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = ELS.includes(o.kind as ElKind) ? (o.kind as ElKind) : null;
  if (!kind || typeof o.id !== "string") return null;
  const e: MElement = {
    id: o.id.slice(0, 40), kind, name: typeof o.name === "string" ? o.name.slice(0, 60) : undefined,
    x: num(o.x, 0, -100, 100), y: num(o.y, 0, -100, 100), w: num(o.w, 1, MIN_SIZE_IN, 100), h: num(o.h, 1, MIN_SIZE_IN, 100),
    rotate: num(o.rotate, 0, -180, 180), opacity: num(o.opacity, 100, 0, 100), locked: o.locked === true, hidden: o.hidden === true,
    fill: isHex(o.fill) ? o.fill : "#ffffff", strokeIn: num(o.strokeIn, 0, 0, 1), strokeColor: isHex(o.strokeColor) ? o.strokeColor : "#000000",
  };
  if (kind === "text") {
    e.text = typeof o.text === "string" ? o.text.slice(0, 400) : "";
    e.fontId = typeof o.fontId === "string" ? o.fontId.slice(0, 80) : "system";
    e.weight = o.weight === 400 || o.weight === 900 ? o.weight : 700;
    e.italic = o.italic === true;
    e.fontSizeIn = num(o.fontSizeIn, DEFAULT_FONT_IN, 0.05, 20);
    e.lineHeight = num(o.lineHeight, 1.1, 0.6, 3);
    e.letterSpacingEm = num(o.letterSpacingEm, 0, -0.2, 1);
    e.align = o.align === "left" || o.align === "right" ? o.align : "center";
    e.curve = num(o.curve, 0, -100, 100);
    e.lineWidthsIn = Array.isArray(o.lineWidthsIn) ? o.lineWidthsIn.map((x) => num(x, 0, 0, 100)).slice(0, 20) : [e.w];
  }
  if (kind === "shape") { e.shape = typeof o.shape === "string" ? o.shape.slice(0, 24) : "rect"; e.radiusIn = num(o.radiusIn, 0, 0, 10); }
  if (kind === "icon") { if (typeof o.iconPath !== "string" || o.iconPath.length > 8000 || !/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/.test(o.iconPath)) return null; e.iconPath = o.iconPath; }
  if (kind === "image") {
    e.assetId = typeof o.assetId === "string" ? o.assetId.slice(0, 60) : undefined;
    e.pxW = num(o.pxW, 0, 0, 100000); e.pxH = num(o.pxH, 0, 0, 100000);
    e.imgColors = Array.isArray(o.imgColors) ? o.imgColors.filter(isHex).slice(0, 8) : [];
    e.imgCoverage = num(o.imgCoverage, 1, 0, 1);
    e.autoPhoto = o.autoPhoto === true; e.vector = o.vector === true; e.isPhoto = o.isPhoto === true; e.hasGradient = o.hasGradient === true;
  }
  return e;
}
export function normalizeDesign(raw: unknown): MerchDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const b = typeof o.blankId === "string" ? getBlank(o.blankId) : undefined;
  if (!b || typeof o.id !== "string") return null;
  const colorHex = isHex(o.colorHex) && colorsFor(b).some((c) => c[1].toLowerCase() === (o.colorHex as string).toLowerCase()) ? (o.colorHex as string) : colorsFor(b)[0][1];
  const sides: Record<string, Side> = {};
  const rawSides = (o.sides && typeof o.sides === "object" ? o.sides : {}) as Record<string, unknown>;
  for (const [pid, sv] of Object.entries(rawSides)) {
    const p = getPlacement(b, pid);
    if (!p || !sv || typeof sv !== "object") continue;
    const s = sv as Record<string, unknown>;
    const method = p.methods.includes(s.method as Method) ? (s.method as Method) : p.methods[0];
    const elements = (Array.isArray(s.elements) ? s.elements : []).map(normalizeElement).filter((e): e is MElement => !!e).slice(0, MAX_ELEMENTS_PER_SIDE);
    sides[pid] = { method, puff: s.puff === true, elements };
  }
  return {
    v: 1, id: o.id.slice(0, 40), name: typeof o.name === "string" && o.name.trim() ? o.name.slice(0, 80) : "Untitled design", blankId: b.id, colorHex, sides,
    ack: Array.isArray(o.ack) ? o.ack.filter((x): x is string => typeof x === "string").slice(0, 200) : [],
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : new Date(0).toISOString(),
  };
}

/** Asset ids referenced by a design (to keep / clean IndexedDB). */
export function assetIds(d: MerchDesign): string[] {
  return [...new Set(Object.values(d.sides).flatMap((s) => s.elements.map((e) => e.assetId).filter((x): x is string => !!x)))];
}

// Self-tests ----------------------------------------------------------------------
export function __runMerchDesignTests(): { passed: number; failed: number } {
  let passed = 0; let failed = 0;
  const ok = (c: boolean, m: string) => { if (c) passed += 1; else { failed += 1; console.error("FAIL merch-design-core:", m); } };
  const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) < e;
  const tee = getBlank("cc-1717")!;
  const front = getPlacement(tee, "front")!;
  const lc = getPlacement(tee, "left_chest")!;
  const d0 = newDesign(tee, "#000000");
  ok(d0.blankId === "cc-1717" && Object.keys(d0.sides).length === 0, "new design empty");
  ok(sideFor(d0, front).method === "dtg", "default method = first offered");
  ok(sideFor(d0, getPlacement(tee, "center_chest_emb")!).method === "embroidery", "emb-only placement");

  // text geometry
  ok(near(letterHeightIn({ text: "ABC", fontSizeIn: 1 }), 0.7), "cap height 0.7 em");
  ok(near(letterHeightIn({ text: "abc", fontSizeIn: 1 }), 0.5), "x-height 0.5 em");
  ok(near(fontSizeForLetterHeight(0.25, "HI"), 0.3571), "font size for 0.25 in caps");
  const tb = textBox([3, 4.5], 1, 1.2);
  ok(near(tb.w, 4.5) && near(tb.h, 2.2), "text box from measured lines");

  // rotation bbox
  const rb = rotatedBox({ x: 0, y: 0, w: 4, h: 2, rotate: 90 });
  ok(near(rb.w, 2) && near(rb.h, 4) && near(rb.x, 1) && near(rb.y, -1), "90 deg bbox");
  ok(rotatedBox({ x: 1, y: 2, w: 3, h: 4 }).x === 1, "no rotation passthrough");

  // resize
  const rs = resizeFrom({ x: 1, y: 1, w: 2, h: 1 }, "nw", -1, 0, true);
  ok(near(rs.w, 3) && near(rs.h, 1.5) && near(rs.x, 0) && near(rs.y, 0.5), "nw keep-aspect resize anchors se corner");
  ok(resizeFrom({ x: 0, y: 0, w: 1, h: 1 }, "se", -5, -5, false).w === MIN_SIZE_IN, "min size");

  // pct bridge
  const p = toPct({ x: 3, y: 4, w: 6, h: 8 }, 12, 16);
  ok(p.x === 25 && p.y === 25 && p.w === 50 && p.h === 50, "inch -> percent");
  ok(fromPct(25, 25, 12, 16).x === 3, "percent -> inch");
  ok(snap16(0.03) === 0 && snap16(0.04) === 0.0625, "1/16 grid");

  // factories + rules bridge
  const t = makeText({ w: 12, h: 16 }, "GREENWAY", [6], 1, "#FFFFFF");
  ok(near(t.x, 3) && t.w === 6 && near(t.h, 1), "text centred");
  const re = toRuleElement(t);
  ok(re.kind === "text" && near(re.letterHeightIn!, 0.7) && re.colors[0] === "#FFFFFF", "text -> rule element");
  const img = makeImage({ w: 12, h: 16 }, "a1", "logo.png", 1200, 600);
  ok(near(img.w, 4) && near(img.h, 2), "image placed at its 300 DPI size");
  const img2 = makeImage({ w: 4, h: 4 }, "a2", "big.png", 6000, 6000);
  ok(near(img2.w, 4), "large image fits frame");
  const sh = makeShape({ w: 12, h: 16 }, "circle", "#FF0000");
  ok(near(inkAreaSqIn(sh), sh.w * sh.h * Math.PI / 4), "circle ink area");
  const icon = makeIcon({ w: 4, h: 4 }, "M0 0 L10 10 Z", "Leaf", "#00FF00");
  ok(toRuleElement(icon).kind === "shape", "icon counts as shape");

  // checkSides end to end
  let d = setSide(d0, front.id, { method: "dtg", elements: [t] });
  let res = checkSides(d);
  ok(res.length === 1 && res[0].placement.id === "front", "only used placements checked");
  ok(!res[0].issues.some((i) => i.level === "blocker"), "valid text has no blocker");
  const off = { ...t, id: "off", x: 10 };
  d = setSide(d, front.id, { method: "dtg", elements: [t, off] });
  res = checkSides(d);
  ok(res[0].issues.some((i) => i.id === "bounds-off" && i.level === "blocker"), "out of frame blocker");
  const tiny = { ...makeText({ w: 4, h: 4 }, "hi", [0.3], 0.3, "#FF0000"), id: "tiny" };
  d = setSide(d, lc.id, { method: "embroidery", elements: [tiny] });
  const lcRes = checkSides(d, d.colorHex, lc.id)[0];
  ok(lcRes.issues.some((i) => i.id === "text-small-tiny" && i.level === "blocker"), "tiny embroidered text blocked");
  ok(lcRes.issues.some((i) => i.id === "thread-palette"), "non-thread colour flagged");
  const snapped = snapSideToThreads(d.sides[lc.id]);
  ok(!checkDesign({ blank: tee, placement: lc, method: "embroidery", garmentHex: "#000000", elements: snapped.elements.map(toRuleElement) }).some((i) => i.id === "thread-palette"), "snap to threads clears palette warning");
  const rot = { ...t, id: "rot", x: 0, y: 0, w: 12, h: 1, rotate: 90 };
  ok(checkSides(setSide(d0, front.id, { method: "dtg", elements: [rot] }))[0].issues.some((i) => i.id === "bounds-rot"), "rotated bbox leaving frame flagged");
  ok(usedPlacements(d, tee).map((x) => x.id).join() === "front,left_chest", "used placements");
  const hid = setSide(d0, front.id, { method: "dtg", elements: [{ ...t, hidden: true }] });
  ok(checkSides(hid).length === 0, "hidden-only side not checked");

  // rotated resize keeps the opposite corner pinned
  const st = { x: 0, y: 0, w: 4, h: 2, rotate: 90 };
  const rr = resizeRotated(st, "se", 0, 2, false); // world +y = local +x at 90 deg
  ok(near(rr.w, 6) && near(rr.h, 2), "rotated resize uses local axes");
  const pin = (b: Box) => { const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; return { x: c.x + (-b.w / 2) * 0 - (-b.h / 2) * 1, y: c.y + (-b.w / 2) * 1 + (-b.h / 2) * 0 }; };
  const p0 = pin(st); const p1 = pin(rr);
  ok(near(p0.x, p1.x) && near(p0.y, p1.y), "nw corner pinned in world space");
  ok(near(resizeRotated({ x: 1, y: 1, w: 2, h: 2 }, "se", 1, 1, false).w, 3), "unrotated passthrough");
  const cb = curvedBox(4, 0.5, 50);
  ok(cb.w > 0 && cb.h > 0 && cb.d.startsWith("M"), "curved box");
  ok(toRuleElement({ ...img, vector: true }).pxW === undefined, "vector art skips DPI");

  // pixels
  const px = new Uint8ClampedArray(100 * 4);
  for (let i = 0; i < 100; i += 1) { px[i * 4] = 255; px[i * 4 + 3] = i < 50 ? 255 : 0; }
  const an = analyzePixels(px);
  ok(an.coverage === 0.5 && an.colors[0] === "#FF0000" && !an.photoLikely, "flat logo analysis");
  const grad = new Uint8ClampedArray(4096 * 4);
  for (let i = 0; i < 4096; i += 1) { grad[i * 4] = (i * 16) % 256; grad[i * 4 + 1] = (i >> 4) % 256; grad[i * 4 + 2] = 128; grad[i * 4 + 3] = 255; }
  ok(analyzePixels(grad).photoLikely, "gradient flagged as photo-like");
  ok(analyzePixels(new Uint8ClampedArray(16)).coverage === 0, "empty image");

  // normalize
  const round = normalizeDesign(JSON.parse(JSON.stringify(d)));
  ok(!!round && round.sides.front.elements.length === 2 && round.sides.left_chest.method === "embroidery", "round trip");
  ok(normalizeDesign({ id: "x", blankId: "nope" }) === null, "unknown blank rejected");
  const bad = normalizeDesign({ id: "x", blankId: "cc-1717", colorHex: "#123456", sides: { nope: { method: "dtg", elements: [] }, front: { method: "embroidery", elements: [{ id: "i", kind: "icon", iconPath: "<script>" }] } } });
  ok(!!bad && !bad.sides.nope && bad.sides.front.method === "dtg" && bad.sides.front.elements.length === 0 && bad.colorHex !== "#123456", "sanitised");
  ok(assetIds(setSide(d0, front.id, { method: "dtg", elements: [img, img2] })).length === 2, "asset ids");
  ok(BLANKS.every((b) => sideFor(newDesign(b, "#000000"), b.placements[0]).elements.length === 0), "every blank opens");
  return { passed, failed };
}
