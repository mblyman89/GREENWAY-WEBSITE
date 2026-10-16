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
 * Elements are decorative: rendered aria-hidden, never focusable on the site.
 * Everything optional is written only when used, so banners saved before R55
 * normalize byte-identically.
 */

export const MAX_ELEMENTS = 12;

export type ShapeKind = "rect" | "circle" | "line" | "triangle" | "star" | "burst" | "arrow" | "diamond";
export const SHAPE_KINDS: { id: ShapeKind; label: string; square: boolean }[] = [
  { id: "rect", label: "Rectangle", square: false },
  { id: "circle", label: "Circle", square: true },
  { id: "line", label: "Line", square: false },
  { id: "triangle", label: "Triangle", square: true },
  { id: "star", label: "Star", square: true },
  { id: "burst", label: "Sale burst", square: true },
  { id: "arrow", label: "Arrow", square: false },
  { id: "diamond", label: "Diamond", square: true },
];
const SHAPE_IDS = SHAPE_KINDS.map((s) => s.id);

export type DesignElement = {
  id: string;
  kind: "shape";
  shape: ShapeKind;
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
};

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
export function cleanElementId(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) : "";
  return s || fallback;
}

// ── defaults + normalizer ────────────────────────────────────────────────────

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
  if (raw.kind !== undefined && raw.kind !== "shape") return null;
  const shape = (SHAPE_IDS as string[]).includes(raw.shape as string) ? (raw.shape as ShapeKind) : "rect";
  const d = defaultElement(shape);
  const el: DesignElement = {
    id: cleanElementId(raw.id, fallbackId),
    kind: "shape",
    shape,
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
  return s;
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
  switch (shape) {
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

/** Inner visual: either a CSS box style or an SVG polygon spec. */
export function shapeVisual(el: DesignElement): { css: StyleMap } | { points: string; fill: string; stroke: string | null; strokeWidth: number } {
  const fill = el.fillOpacity > 0 ? rgba(el.fill, el.fillOpacity) : "transparent";
  const pts = shapePoints(el.shape);
  if (pts) return { points: pts, fill, stroke: el.strokeWidth > 0 ? el.stroke : null, strokeWidth: el.strokeWidth };
  if (el.shape === "line") return { css: { width: "100%", height: "100%", background: el.stroke, borderRadius: "999px" } };
  const css: StyleMap = { width: "100%", height: "100%", background: fill, boxSizing: "border-box" };
  if (el.strokeWidth > 0) css.border = `${el.strokeWidth}px solid ${el.stroke}`;
  css.borderRadius = el.shape === "circle" ? "50%" : `${el.radius}px`;
  return { css };
}

/** Element position for a device (phone overrides fall back to computer). */
export function elementPosition(el: DesignElement, device: "desktop" | "mobile"): { x: number; y: number; w: number; h: number | null } {
  if (device === "mobile") return { x: el.mx ?? el.x, y: el.my ?? el.y, w: el.mw ?? el.w, h: el.h === null ? null : (el.mh ?? el.h) };
  return { x: el.x, y: el.y, w: el.w, h: el.h };
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
  ok(J(elementPosition(rect, "mobile")) === J({ x: 70, y: 20, w: 24, h: 40 }), "phone position");
  return { passed, failed };
}
