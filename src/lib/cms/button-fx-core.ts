/**
 * R56-S4 — button upgrades + badge stickers for the Banner Studio.
 *
 * Optional extras on a design button. Each one is written only when it's used,
 * so older designs stay byte-identical:
 *   • icon      — any curated Phosphor icon, left / right / icon-only
 *   • gradient  — two-colour fill in any colours (solid buttons)
 *   • shadow    — soft drop shadow in any colour
 *   • hover     — lift / grow / glow / darken (pure CSS; respects reduced motion)
 *   • attention — gentle pulse or wiggle to draw the eye (off for reduced motion)
 *   • corner    — custom corner rounding in px (overrides pill/rounded/square)
 *
 * Plus one-click badge "stickers" (sale burst, circle seal, ribbon tag …):
 * a shape + a centred badge text box, built with the normal pieces so every
 * part stays editable.
 *
 * Pure: no React, no I/O. Must NOT import banner-design-core (it imports us).
 */
import { isSafeIconPath, type DesignElement, type ShapeKind } from "./banner-elements-core";

export type ButtonIconPos = "left" | "right" | "only";
export type ButtonHover = "lift" | "grow" | "glow" | "darken";
export type ButtonAttention = "pulse" | "wiggle";
export type ButtonGradient = { from: string; to: string; angle: number };

export const BUTTON_ICON_POS: ButtonIconPos[] = ["left", "right", "only"];
export const BUTTON_HOVERS: ButtonHover[] = ["lift", "grow", "glow", "darken"];
export const BUTTON_ATTENTIONS: ButtonAttention[] = ["pulse", "wiggle"];
export const BUTTON_SHADOW_MAX = 40;
export const BUTTON_CORNER_MAX = 40;

/** The optional extras (mixed into DesignButton). */
export type ButtonFx = {
  icon?: string;
  iconPath?: string;
  iconPos?: ButtonIconPos;
  gradient?: ButtonGradient;
  shadow?: number;
  shadowColor?: string;
  hover?: ButtonHover;
  attention?: ButtonAttention;
  corner?: number;
};

type StyleMap = Record<string, string>;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  return Math.round(Math.min(max, Math.max(min, n)));
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
  return `rgba(${parseInt(c.slice(1, 3), 16)}, ${parseInt(c.slice(3, 5), 16)}, ${parseInt(c.slice(5, 7), 16)}, ${pct / 100})`;
}
const pickOpt = <T extends string>(v: unknown, list: readonly T[]): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : undefined;

/** Clean the extras from stored/posted JSON. Only fields in use come back. */
export function normalizeButtonFx(raw: Record<string, unknown>, fallbackColor = "#7ed957"): ButtonFx {
  const out: ButtonFx = {};
  if (isSafeIconPath(raw.iconPath)) {
    out.icon = typeof raw.icon === "string" ? raw.icon.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) : "";
    out.iconPath = raw.iconPath;
    out.iconPos = pickOpt(raw.iconPos, BUTTON_ICON_POS) ?? "left";
  }
  const g = raw.gradient;
  if (isObj(g) && typeof g.from === "string" && typeof g.to === "string") {
    out.gradient = { from: hex(g.from, fallbackColor), to: hex(g.to, fallbackColor), angle: num(g.angle, 90, 0, 360) };
  }
  const sh = num(raw.shadow, 0, 0, BUTTON_SHADOW_MAX);
  if (sh > 0) {
    out.shadow = sh;
    out.shadowColor = hex(raw.shadowColor, "#000000");
  }
  const hv = pickOpt(raw.hover, BUTTON_HOVERS);
  if (hv) out.hover = hv;
  const at = pickOpt(raw.attention, BUTTON_ATTENTIONS);
  if (at) out.attention = at;
  if (raw.corner !== undefined && raw.corner !== null && raw.corner !== "") {
    const c = num(raw.corner, -1, 0, BUTTON_CORNER_MAX);
    if (c >= 0) out.corner = c;
  }
  return out;
}

/** Extra inline styles (merged after the base button style). */
export function buttonFxStyle(fx: ButtonFx & { style: string; bg: string }): StyleMap {
  const s: StyleMap = {};
  if (fx.iconPath) s.gap = "0.5em";
  if (fx.iconPath && fx.iconPos === "only") s.aspectRatio = "1 / 1";
  if (fx.gradient && fx.style === "solid") s.backgroundImage = `linear-gradient(${fx.gradient.angle}deg, ${fx.gradient.from}, ${fx.gradient.to})`;
  if (fx.shadow) s.boxShadow = `0 ${Math.round(fx.shadow / 4)}px ${fx.shadow}px ${rgba(fx.shadowColor ?? "#000000", 55)}`;
  if (fx.corner !== undefined) s.borderRadius = `${fx.corner}px`;
  if (fx.hover === "glow") s["--gbfx"] = fx.style === "solid" ? (fx.gradient?.to ?? fx.bg) : fx.bg;
  return s;
}

/** Class names for hover / attention (CSS lives in globals.css, R56-S4). */
export function buttonFxClass(fx: ButtonFx): string {
  return [fx.hover ? `gw-bh-${fx.hover}` : "", fx.attention ? `gw-ba-${fx.attention}` : ""].filter(Boolean).join(" ");
}

/** True when the visible label is replaced by the icon (label → aria-label). */
export const isIconOnly = (fx: ButtonFx) => !!fx.iconPath && fx.iconPos === "only";

// ── Badge stickers ──────────────────────────────────────────────────────────

export type BadgePreset = {
  id: string;
  label: string;
  shape: ShapeKind;
  fill: string;
  text: string;
  color: string;
  /** Desktop width (% of banner) and phone width. */
  w: number;
  mw: number;
  rotate: number;
  stroke?: string;
  strokeWidth?: number;
};

export const BADGE_PRESETS: BadgePreset[] = [
  { id: "sale-burst", label: "Sale burst", shape: "burst", fill: "#ffd700", text: "SALE", color: "#000000", w: 11, mw: 26, rotate: -12 },
  { id: "pct-seal", label: "% off seal", shape: "circle", fill: "#e11d48", text: "20% OFF", color: "#ffffff", w: 10, mw: 24, rotate: 0, stroke: "#ffffff", strokeWidth: 3 },
  { id: "new-star", label: "New star", shape: "star", fill: "#7ed957", text: "NEW", color: "#000000", w: 11, mw: 26, rotate: 0 },
  { id: "hot-diamond", label: "Hot diamond", shape: "diamond", fill: "#ff7f00", text: "HOT", color: "#ffffff", w: 10, mw: 24, rotate: 0 },
  { id: "deal-tag", label: "Deal tag", shape: "rect", fill: "#000000", text: "TODAY ONLY", color: "#ffd700", w: 16, mw: 36, rotate: -6, stroke: "#ffd700", strokeWidth: 2 },
];

/** Frame size the placement maths needs (px). */
export type BadgeFrame = { height: number; heightMobile: number; refW: number; refWm: number };

export type BadgeParts = {
  element: Partial<DesignElement> & { shape: ShapeKind };
  /** Text-box overrides (role "badge", no backdrop — the shape is the backdrop). */
  box: { x: number; y: number; w: number; mx: number; my: number; mw: number; text: string; color: string; size: number; sizeMobile: number; align: "center"; rotate?: number };
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Place a sticker at (x, y)% with its text centred on the shape at BOTH
 * device sizes (square shapes are w% of banner WIDTH tall, so the centre in
 * % of height differs between computer and phone — computed for each).
 */
export function badgeParts(p: BadgePreset, x: number, y: number, frame: BadgeFrame): BadgeParts {
  const square = p.shape !== "rect";
  const hPctD = square ? (p.w * frame.refW) / frame.height : 9;
  const hPctM = square ? (p.mw * frame.refWm) / frame.heightMobile : 12;
  const cx = x + p.w / 2;
  // Phone stickers are wider (% of a narrow screen): keep the whole sticker inside.
  const mx = r2(Math.max(0, Math.min(x, 100 - p.mw)));
  const cy = y + hPctD / 2;
  const cym = y + hPctM / 2;
  // Text size scales with the sticker: ~20% of its pixel width, shorter for long words.
  const longF = p.text.length > 6 ? 0.55 : 1;
  const size = Math.max(10, Math.round(((p.w / 100) * frame.refW * 0.2 * longF)));
  const sizeMobile = Math.max(9, Math.round(((p.mw / 100) * frame.refWm * 0.2 * longF)));
  const textHD = ((size * 1.1) / frame.height) * 100;
  const textHM = ((sizeMobile * 1.1) / frame.heightMobile) * 100;
  const tw = p.w * 0.9;
  const twm = p.mw * 0.9;
  const element: BadgeParts["element"] = {
    shape: p.shape,
    x: r2(x),
    y: r2(y),
    w: p.w,
    h: square ? null : r2(hPctD),
    mx,
    my: r2(y),
    mw: p.mw,
    mh: square ? null : r2(hPctM),
    fill: p.fill,
    rotate: p.rotate,
    radius: p.shape === "rect" ? 8 : 0,
    ...(p.stroke ? { stroke: p.stroke, strokeWidth: p.strokeWidth ?? 2 } : {}),
  };
  return {
    element,
    box: {
      x: r2(cx - tw / 2),
      y: r2(Math.max(0, cy - textHD / 2)),
      w: r2(tw),
      mx: r2(mx + p.mw / 2 - twm / 2),
      my: r2(Math.max(0, cym - textHM / 2)),
      mw: r2(twm),
      text: p.text,
      color: p.color,
      size,
      sizeMobile,
      align: "center",
      ...(p.rotate ? { rotate: p.rotate } : {}),
    },
  };
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runButtonFxTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  ✗ button-fx: ${m}`);
    }
  };
  const P = "M10 10L20 20Z";
  ok(Object.keys(normalizeButtonFx({})).length === 0, "nothing set → nothing written");
  const a = normalizeButtonFx({ icon: "Arrow-Right!", iconPath: P });
  ok(a.icon === "arrow-right" && a.iconPos === "left", "icon cleaned, defaults left");
  ok(Object.keys(normalizeButtonFx({ icon: "x", iconPath: "<script>" })).length === 0, "unsafe icon path dropped");
  ok(normalizeButtonFx({ iconPath: P, iconPos: "only" }).iconPos === "only", "icon-only kept");
  ok(normalizeButtonFx({ iconPath: P, iconPos: "top" }).iconPos === "left", "bad icon pos → left");
  const g = normalizeButtonFx({ gradient: { from: "#F00", to: "nope", angle: 999 } }, "#123456");
  ok(g.gradient?.from === "#ff0000" && g.gradient.to === "#123456" && g.gradient.angle === 360, "gradient cleaned + clamped");
  ok(normalizeButtonFx({ shadow: 0 }).shadow === undefined, "shadow 0 not written");
  const sh = normalizeButtonFx({ shadow: 99, shadowColor: "#abc" });
  ok(sh.shadow === BUTTON_SHADOW_MAX && sh.shadowColor === "#aabbcc", "shadow clamped + colour");
  ok(normalizeButtonFx({ hover: "glow", attention: "pulse" }).hover === "glow", "hover kept");
  ok(normalizeButtonFx({ hover: "spin", attention: "explode" }).hover === undefined, "unknown hover dropped");
  ok(normalizeButtonFx({ attention: "explode" }).attention === undefined, "unknown attention dropped");
  ok(normalizeButtonFx({ corner: 0 }).corner === 0 && normalizeButtonFx({ corner: 400 }).corner === BUTTON_CORNER_MAX, "corner 0 kept, clamped");
  ok(normalizeButtonFx({ corner: "x" }).corner === undefined && normalizeButtonFx({ corner: null }).corner === undefined, "bad corner dropped");

  const base = { style: "solid", bg: "#7ed957" };
  ok(Object.keys(buttonFxStyle(base)).length === 0, "no extras → no style");
  const st = buttonFxStyle({ ...base, gradient: { from: "#000000", to: "#ffffff", angle: 45 }, shadow: 8, shadowColor: "#ff0000", corner: 4, hover: "glow" });
  ok(st.backgroundImage === "linear-gradient(45deg, #000000, #ffffff)", "gradient css");
  ok(st.boxShadow === "0 2px 8px rgba(255, 0, 0, 0.55)", "shadow css");
  ok(st.borderRadius === "4px", "corner css");
  ok(st["--gbfx"] === "#ffffff", "glow colour follows gradient end");
  ok(!("backgroundImage" in buttonFxStyle({ style: "outline", bg: "#000", gradient: { from: "#000000", to: "#ffffff", angle: 0 } })), "no gradient on outline");
  const io = buttonFxStyle({ ...base, iconPath: P, iconPos: "only" });
  ok(io.gap === "0.5em" && io.aspectRatio === "1 / 1", "icon-only is square");
  ok(buttonFxClass({ hover: "lift", attention: "wiggle" }) === "gw-bh-lift gw-ba-wiggle" && buttonFxClass({}) === "", "classes");
  ok(isIconOnly({ iconPath: P, iconPos: "only" }) && !isIconOnly({ iconPos: "only" }), "icon-only needs a path");

  const frame = { height: 200, heightMobile: 160, refW: 1408, refWm: 390 };
  const b = badgeParts(BADGE_PRESETS[0], 80, 10, frame);
  ok(b.element.h === null && b.element.shape === "burst" && b.element.rotate === -12, "burst sticker shape");
  const hD = (11 * 1408) / 200;
  ok(Math.abs(b.box.y + ((b.box.size * 1.1) / 200) * 50 - (10 + hD / 2)) < 0.05, "text centred on shape (computer)");
  const hM = (26 * 390) / 160;
  ok(Math.abs(b.box.my + ((b.box.sizeMobile * 1.1) / 160) * 50 - (10 + hM / 2)) < 0.05, "text centred on shape (phone)");
  ok(Math.abs(b.box.x + b.box.w / 2 - (80 + 11 / 2)) < 0.02, "text centred across");
  ok((b.element.mx ?? 0) + 26 <= 100.001, "phone sticker stays inside the banner");
  ok(b.box.rotate === -12, "text tilts with sticker");
  const t = badgeParts(BADGE_PRESETS[4], 5, 5, frame);
  ok(t.element.h !== null && t.element.radius === 8 && t.element.strokeWidth === 2, "tag is a rounded rectangle with border");
  ok(!("rotate" in badgeParts(BADGE_PRESETS[2], 5, 5, frame).box), "no rotate written when upright");
  ok(BADGE_PRESETS.every((p) => /^#[0-9a-f]{6}$/.test(p.fill) && p.text.length > 0), "presets valid");
  return { passed, failed };
}
