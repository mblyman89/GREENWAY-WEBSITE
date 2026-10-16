/**
 * banner-motion-core — R57-S2. Micro-interactions for Banner Studio designs.
 * Pure CSS (no animation library ships to shoppers), pure + testable here.
 *
 *  Shapes & icons  motion: breathe · glow · float · spin · wiggle · blob (organic
 *                  corner morph) · morph (shape A ⇄ shape B, e.g. star ⇄ burst)
 *                  orbit: a glowing spark that travels around the shape's border
 *                  hover: react when the shopper points at the banner
 *  Text boxes      motion: breathe · glow · float · wiggle · flicker (neon)
 *                  hover: grow · lift · glow
 *  Banner          beam: a light that travels around the banner's border
 *
 * Every field is optional and written only when used (older designs stay
 * byte-identical). Motion is switched off for visitors who ask their device for
 * reduced motion (WCAG 2.3.3) and paused on carousel slides that aren't shown.
 *
 * Animations use the individual `scale` / `translate` / `rotate` properties on
 * shapes (their own rotation is `transform`) and `transform` on text (its own
 * rotation is the `rotate` property) so a tilted item keeps its tilt.
 *
 * Imports nothing from the other banner cores (they import this).
 */
export type MotionSpeed = "slow" | "fast";
export type ElementMotion = "breathe" | "glow" | "float" | "spin" | "wiggle" | "blob" | "morph";
export type TextMotion = "breathe" | "glow" | "float" | "wiggle" | "flicker";
export type ElementHover = "grow" | "lift" | "spin" | "glow";
export type TextHover = "grow" | "lift" | "glow";
export type Orbit = { color: string; size: number };
export type Beam = { color: string; color2: string; width: number; speed?: MotionSpeed };

export const ELEMENT_MOTIONS: ElementMotion[] = ["breathe", "glow", "float", "spin", "wiggle", "blob", "morph"];
export const TEXT_MOTIONS: TextMotion[] = ["breathe", "glow", "float", "wiggle", "flicker"];
export const ELEMENT_HOVERS: ElementHover[] = ["grow", "lift", "spin", "glow"];
export const TEXT_HOVERS: TextHover[] = ["grow", "lift", "glow"];
export const MOTION_SPEEDS: MotionSpeed[] = ["slow", "fast"];
/** Shapes that can take part in a morph (line has no area). */
export const MORPH_SHAPES = ["rect", "circle", "triangle", "star", "burst", "arrow", "diamond"] as const;
export type MorphShape = (typeof MORPH_SHAPES)[number];
/** Shapes drawn with CSS boxes (rounded corners) — the only ones "blob" applies to. */
export const BLOB_SHAPES = ["rect", "circle"];
export const ORBIT_SIZE = { min: 4, max: 40 };
export const BEAM_WIDTH = { min: 40, max: 400 };
export const MORPH_POINTS = 48;

/** Seconds multiplier for the --gms variable. */
export const SPEED_FACTOR: Record<MotionSpeed | "normal", number> = { slow: 1.8, normal: 1, fast: 0.5 };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const pickOpt = <T extends string>(v: unknown, list: readonly T[]): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;
function hex(v: unknown, def: string): string {
  if (typeof v !== "string") return def;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return def;
}
function int(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : def;
}
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Normalizers (only fields in use come back) ─────────────────────────────

export type ElementMotionFields = { motion?: ElementMotion; motionSpeed?: MotionSpeed; morphTo?: MorphShape; orbit?: Orbit; hover?: ElementHover };
export type TextMotionFields = { motion?: TextMotion; motionSpeed?: MotionSpeed; hover?: TextHover };

export function normalizeElementMotion(raw: Record<string, unknown>, shape: string, isIcon: boolean): ElementMotionFields {
  const out: ElementMotionFields = {};
  let m = pickOpt(raw.motion, ELEMENT_MOTIONS);
  // blob needs a CSS box; morph needs two morphable shapes (icons/lines can't).
  if (m === "blob" && (isIcon || !BLOB_SHAPES.includes(shape))) m = undefined;
  const to = pickOpt(raw.morphTo, MORPH_SHAPES);
  if (m === "morph" && (isIcon || !(MORPH_SHAPES as readonly string[]).includes(shape) || !to || to === shape)) m = undefined;
  if (m) out.motion = m;
  if (m === "morph" && to) out.morphTo = to;
  const o = raw.orbit;
  if (isObj(o) && !isIcon && shape !== "line") out.orbit = { color: hex(o.color, "#ffd700"), size: int(o.size, 10, ORBIT_SIZE.min, ORBIT_SIZE.max) };
  const sp = pickOpt(raw.motionSpeed, MOTION_SPEEDS);
  if (sp && (out.motion || out.orbit)) out.motionSpeed = sp;
  const h = pickOpt(raw.hover, ELEMENT_HOVERS);
  if (h) out.hover = h;
  return out;
}

export function normalizeTextMotion(raw: Record<string, unknown>): TextMotionFields {
  const out: TextMotionFields = {};
  const m = pickOpt(raw.motion, TEXT_MOTIONS);
  if (m) out.motion = m;
  const sp = pickOpt(raw.motionSpeed, MOTION_SPEEDS);
  if (sp && m) out.motionSpeed = sp;
  const h = pickOpt(raw.hover, TEXT_HOVERS);
  if (h) out.hover = h;
  return out;
}

export function normalizeBeam(raw: unknown): Beam | null {
  if (!isObj(raw)) return null;
  const b: Beam = { color: hex(raw.color, "#7ed957"), color2: hex(raw.color2, "#ffd700"), width: int(raw.width, 160, BEAM_WIDTH.min, BEAM_WIDTH.max) };
  const sp = pickOpt(raw.speed, MOTION_SPEEDS);
  if (sp) b.speed = sp;
  return b;
}

// ── Class names + CSS variables (CSS lives in globals.css, R57-S2) ─────────

/**
 * Classes + vars for a shape/icon. `inner` goes on the wrapper INSIDE the
 * positioned box (so motion never fights the box's own rotate / shadow);
 * `outer` (hover, reacts when the shopper points at the banner) + `vars` go on
 * the positioned box. `glow` = the colour it glows in.
 */
export function elementMotion(f: ElementMotionFields, glow: string): { inner: string; outer: string; vars: Record<string, string> } {
  const inner = f.motion && f.motion !== "morph" ? `gw-m gw-em-${f.motion}` : "";
  const outer = f.hover ? `gw-xh gw-xh-${f.hover}` : "";
  const vars: Record<string, string> = {};
  if (f.motion || f.orbit || f.hover === "glow") vars["--gmc"] = glow;
  if (f.motionSpeed) vars["--gms"] = String(SPEED_FACTOR[f.motionSpeed]);
  return { inner, outer, vars };
}

export function textMotion(f: TextMotionFields, glow: string): { className: string; vars: Record<string, string> } {
  const cls: string[] = [];
  if (f.motion) cls.push("gw-m", `gw-tm-${f.motion}`);
  if (f.hover) cls.push("gw-xh", `gw-xh-${f.hover}`);
  const vars: Record<string, string> = {};
  if (f.motion === "glow" || f.hover === "glow") vars["--gmc"] = glow;
  if (f.motionSpeed) vars["--gms"] = String(SPEED_FACTOR[f.motionSpeed]);
  return { className: cls.join(" "), vars };
}

/**
 * Path a spark follows around a shape (CSS offset-path basic shape; the
 * reference box is the shape's own box). Polygons use their real outline.
 */
export function orbitPath(shape: string, radiusPx: number, points: string | null): string {
  if (shape === "circle") return "circle(50%)";
  if (points) return `polygon(${points.split(" ").map((p) => p.split(",").map((n) => `${n}%`).join(" ")).join(", ")})`;
  return `rect(0 auto auto 0 round ${Math.max(0, radiusPx)}px)`;
}

/** Style for the banner border beam (a comet whose tail follows the edge). */
export function beamStyle(b: Beam, frameRadius: number): Record<string, string> {
  return {
    "--gbm-w": `${b.width}px`,
    "--gbm-c": b.color,
    "--gbm-c2": b.color2,
    "--gms": String(SPEED_FACTOR[b.speed ?? "normal"]),
    offsetPath: `rect(0 auto auto 0 round ${frameRadius}px)`,
  };
}

// ── Morph (shape A ⇄ shape B) ──────────────────────────────────────────────

/** Outline points (viewBox 0–100) for any morphable shape. */
function outline(shape: MorphShape, points: string | null): [number, number][] {
  if (shape === "rect") return [[0, 0], [100, 0], [100, 100], [0, 100]];
  if (shape === "circle") return [];
  return (points ?? "").split(" ").filter(Boolean).map((p) => p.split(",").map(Number) as [number, number]);
}

/**
 * Resample a shape to MORPH_POINTS points by casting rays from the centre at
 * equal angles (starting straight up), so any two shapes line up point-for-
 * point and the browser can tween one clip-path polygon into the other.
 */
export function morphPolygon(shape: MorphShape, points: string | null, n = MORPH_POINTS): string {
  const pts = outline(shape, points);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let t = 50; // circle radius
    if (pts.length) {
      t = 0;
      for (let k = 0; k < pts.length; k++) {
        const [x1, y1] = pts[k];
        const [x2, y2] = pts[(k + 1) % pts.length];
        // ray (50,50)+t(dx,dy) vs segment (x1,y1)→(x2,y2)
        const ex = x2 - x1;
        const ey = y2 - y1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = x1 - 50;
        const wy = y1 - 50;
        const tt = (wx * ey - wy * ex) / den;
        const u = (wx * dy - wy * dx) / den;
        if (tt >= 0 && u >= -1e-9 && u <= 1 + 1e-9 && tt > t) t = tt;
      }
    }
    out.push(`${r2(50 + t * dx)}% ${r2(50 + t * dy)}%`);
  }
  return `polygon(${out.join(", ")})`;
}

export const morphName = (a: MorphShape, b: MorphShape) => `gw-morph-${a}-${b}`;

/** @keyframes for a pair (deterministic name, so identical pairs dedupe). */
export function morphKeyframes(a: MorphShape, b: MorphShape, pointsOf: (s: MorphShape) => string | null): string {
  const pa = morphPolygon(a, pointsOf(a));
  const pb = morphPolygon(b, pointsOf(b));
  return `@keyframes ${morphName(a, b)}{0%,100%{clip-path:${pa}}50%{clip-path:${pb}}}`;
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runBannerMotionTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  ✗ banner-motion: ${m}`);
    }
  };
  const J = JSON.stringify;
  ok(J(normalizeElementMotion({}, "rect", false)) === "{}", "nothing set → nothing written");
  ok(normalizeElementMotion({ motion: "breathe" }, "star", false).motion === "breathe", "breathe kept");
  ok(normalizeElementMotion({ motion: "explode" }, "star", false).motion === undefined, "unknown motion dropped");
  ok(normalizeElementMotion({ motion: "blob" }, "circle", false).motion === "blob", "blob on circle");
  ok(normalizeElementMotion({ motion: "blob" }, "star", false).motion === undefined, "no blob on polygons");
  ok(normalizeElementMotion({ motion: "blob" }, "rect", true).motion === undefined, "no blob on icons");
  const mo = normalizeElementMotion({ motion: "morph", morphTo: "burst" }, "star", false);
  ok(mo.motion === "morph" && mo.morphTo === "burst", "morph star → burst");
  ok(normalizeElementMotion({ motion: "morph", morphTo: "star" }, "star", false).motion === undefined, "morph to itself dropped");
  ok(normalizeElementMotion({ motion: "morph" }, "star", false).motion === undefined, "morph needs a target");
  ok(normalizeElementMotion({ motion: "morph", morphTo: "circle" }, "line", false).motion === undefined, "line can't morph");
  ok(normalizeElementMotion({ morphTo: "circle" }, "star", false).morphTo === undefined, "stray morphTo dropped");
  const ob = normalizeElementMotion({ orbit: { color: "#F00", size: 999 } }, "rect", false);
  ok(ob.orbit?.color === "#ff0000" && ob.orbit.size === ORBIT_SIZE.max, "orbit cleaned + clamped");
  ok(normalizeElementMotion({ orbit: {} }, "line", false).orbit === undefined && normalizeElementMotion({ orbit: {} }, "rect", true).orbit === undefined, "no orbit on lines/icons");
  ok(normalizeElementMotion({ motionSpeed: "fast" }, "rect", false).motionSpeed === undefined, "speed only with motion");
  ok(normalizeElementMotion({ motion: "spin", motionSpeed: "slow", hover: "glow" }, "rect", false).motionSpeed === "slow", "speed kept");
  ok(normalizeElementMotion({ hover: "teleport" }, "rect", false).hover === undefined, "unknown hover dropped");
  ok(J(normalizeTextMotion({})) === "{}" && normalizeTextMotion({ motion: "flicker", motionSpeed: "fast" }).motionSpeed === "fast", "text motion");
  ok(normalizeTextMotion({ motion: "spin" }).motion === undefined && normalizeTextMotion({ hover: "spin" }).hover === undefined, "text: no spin");
  ok(normalizeBeam(null) === null && normalizeBeam({ width: 9999 })!.width === BEAM_WIDTH.max, "beam");
  ok(normalizeBeam({ color: "#abc", speed: "fast" })!.color === "#aabbcc" && normalizeBeam({ speed: "x" })!.speed === undefined, "beam colour + speed");

  const em = elementMotion({ motion: "breathe", motionSpeed: "fast", hover: "grow" }, "#ff0000");
  ok(em.inner === "gw-m gw-em-breathe" && em.outer === "gw-xh gw-xh-grow" && em.vars["--gms"] === "0.5" && em.vars["--gmc"] === "#ff0000", "element classes + vars");
  ok(elementMotion({}, "#fff").inner === "" && elementMotion({}, "#fff").outer === "" && J(elementMotion({}, "#fff").vars) === "{}", "no motion → nothing");
  ok(elementMotion({ motion: "morph", morphTo: "star" }, "#fff").inner === "", "morph is drawn by the shape itself");
  ok(textMotion({ motion: "glow" }, "#00ff00").className === "gw-m gw-tm-glow" && textMotion({ motion: "glow" }, "#00ff00").vars["--gmc"] === "#00ff00", "text classes");
  ok(orbitPath("circle", 0, null) === "circle(50%)" && orbitPath("rect", 12, null) === "rect(0 auto auto 0 round 12px)", "orbit paths");
  ok(orbitPath("triangle", 0, "50,0 100,100 0,100") === "polygon(50% 0%, 100% 100%, 0% 100%)", "orbit follows polygon");
  ok(beamStyle({ color: "#000000", color2: "#ffffff", width: 100 }, 16).offsetPath === "rect(0 auto auto 0 round 16px)", "beam path");

  const sq = morphPolygon("rect", null, 4);
  ok(sq === "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)", "rect resampled from centre");
  const c = morphPolygon("circle", null);
  ok(c.split(",").length === MORPH_POINTS && c.startsWith("polygon(50% 0%"), "circle 48 points from the top");
  const tri = morphPolygon("triangle", "50,0 100,100 0,100", 4);
  ok(tri.startsWith("polygon(50% 0%") && tri.includes("50% 100%"), "triangle apex + base");
  const kf = morphKeyframes("star", "circle", (s) => (s === "star" ? "50,0 61,35 98,35 68,57 79,91 50,70 21,91 32,57 2,35 39,35" : null));
  ok(kf.startsWith("@keyframes gw-morph-star-circle{0%,100%{clip-path:polygon(") && kf.includes("50%{clip-path:polygon("), "keyframes");
  ok((kf.match(/%,/g) ?? []).length > 0 && kf.split("polygon(").length === 3, "two polygons");
  return { passed, failed };
}
