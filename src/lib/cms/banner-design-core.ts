/**
 * src/lib/cms/banner-design-core.ts — R41 S1 (bible PART 5, SLICE S1).
 *
 * ONE pure design model for every banner on the site. The owner asked for
 * text boxes he can drag into place, real wrapping, Enter = new line, font /
 * size / bold / italic / underline / strike-through / color, image options,
 * button move / size / style / color, and "new text boxes with purpose".
 *
 * Everything here is pure (no React, no DB, no `server-only`): types, defaults,
 * a defensive normalizer for stored JSON, legacy → design conversion so the
 * first design looks like today's banner, CSS style objects (React-compatible
 * keys) for the renderer, WCAG contrast estimates, purpose warnings, and the
 * drag/move math shared by the editor canvas and the hub Move mode.
 *
 * A design is OPT-IN: renderers only use it when `design.enabled === true`;
 * otherwise the legacy SectionBanner path renders byte-identically (bible 5.1).
 *
 * Research behind the rules: bible PART 3 (WCAG 2.2 SC 1.4.3, NN/g "Ensure
 * High Contrast for Text Over Images", WAC 314-55-155, Pointer Events).
 */
import { normalizeCurve } from "./banner-curve-core";
import { normalizeLive, type LiveText } from "./banner-live-core";
import { normalizeReveal, normalizeSmoke, type SmokeLayer } from "./banner-atmos-core";
import { imageFxFilters, normalizeImageFx, type ImageFx } from "./banner-image-core";
import { checkHref } from "@/lib/cms/link-target-core";
import { FONT_OPTIONS, fontStack } from "@/lib/cms/fonts";
import { isCustomFontId } from "@/lib/cms/custom-font-core";
import { buttonFxStyle, normalizeButtonFx, type ButtonFx } from "@/lib/cms/button-fx-core";
import { normalizeBeam, normalizeTextMotion, textMotion, type Beam, type TextMotionFields } from "@/lib/cms/banner-motion-core";
import { MAX_ELEMENTS, normalizeElement, normalizeOrder, resolveLayers, type DesignElement, type LayerRef } from "@/lib/cms/banner-elements-core";

// ── Constants ────────────────────────────────────────────────────────────────

export const DESIGN_VERSION = 1 as const;
export const MAX_TEXT_BOXES = 8;
export const MAX_DESIGN_BUTTONS = 4;
export const DESKTOP_REF_PX = 1408;
export const MOBILE_REF_PX = 390;
export const MOBILE_BREAKPOINT_PX = 768;
export const MAX_BOX_TEXT = 600;
export const MAX_BUTTON_LABEL = 40;

export type DesignRole = "eyebrow" | "headline" | "subhead" | "body" | "badge" | "legal";
export type DesignAlign = "left" | "center" | "right" | "justify";
export type DesignTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type DesignShadow = "none" | "soft" | "strong" | "glow" | "lift" | "neon";
/** R55: gradient fill for text (written only when used). */
export type DesignGradient = { from: string; to: string; angle: number };
export type DesignBackdrop = "none" | "box" | "blur" | "pill";
export type DesignWrap = "normal" | "balance" | "nowrap";
export type DesignBind = "eyebrow" | "title" | "subtitle" | null;
export type DesignDevice = "desktop" | "mobile";

export type RoleInfo = {
  role: DesignRole;
  label: string;
  purpose: string;
  html: "p" | "h2" | "span";
  size: number;
  sizeMobile: number;
  weight: number;
  dos: string;
  donts: string;
};

/** Bible PART 3.4 table, as data (the editor shows purpose / dos / don'ts). */
export const DESIGN_ROLES: RoleInfo[] = [
  {
    role: "eyebrow",
    label: "Eyebrow (kicker)",
    purpose: "Short label that sets context above the headline (“Today's Deal”).",
    html: "p",
    size: 12,
    sizeMobile: 10,
    weight: 900,
    dos: "1–4 words, uppercase ok, accent color.",
    donts: "Don't make it bigger than the headline.",
  },
  {
    role: "headline",
    label: "Headline",
    purpose: "The one main message.",
    html: "h2",
    size: 48,
    sizeMobile: 24,
    weight: 900,
    dos: "8 words or fewer, strongest contrast.",
    donts: "Only ONE headline per banner.",
  },
  {
    role: "subhead",
    label: "Sub-headline",
    purpose: "Supports the headline with a benefit.",
    html: "p",
    size: 16,
    sizeMobile: 12,
    weight: 600,
    dos: "20 words or fewer.",
    donts: "Don't repeat the headline.",
  },
  {
    role: "body",
    label: "Body text",
    purpose: "Longer supporting copy.",
    html: "p",
    size: 14,
    sizeMobile: 12,
    weight: 400,
    dos: "Two short sentences at most on a banner.",
    donts: "Don't put paragraphs on photos without a box behind them.",
  },
  {
    role: "badge",
    label: "Badge",
    purpose: "A sticker / price / limited-time callout (“20% OFF”).",
    html: "span",
    size: 14,
    sizeMobile: 12,
    weight: 900,
    dos: "High-contrast pill.",
    donts: "No more than one or two.",
  },
  {
    role: "legal",
    label: "Legal / fine print",
    purpose: "Fine print and required notices (e.g. “21+”).",
    html: "p",
    size: 11,
    sizeMobile: 10,
    weight: 400,
    dos: "Must remain readable (contrast).",
    donts: "Never hide required text; never below the WAC size rule for required warnings.",
  },
];

const ROLE_BY_ID = new Map(DESIGN_ROLES.map((r) => [r.role, r]));
export function roleInfo(role: DesignRole): RoleInfo {
  return ROLE_BY_ID.get(role) ?? DESIGN_ROLES[3];
}

export const DESIGN_ALIGNS: DesignAlign[] = ["left", "center", "right", "justify"];
export const DESIGN_TRANSFORMS: DesignTransform[] = ["none", "uppercase", "lowercase", "capitalize"];
export const DESIGN_SHADOWS: DesignShadow[] = ["none", "soft", "strong", "glow", "lift", "neon"];
/** R55: outline width range in px (0 = off). */
export const STROKE_MAX = 8;
export const DESIGN_BACKDROPS: DesignBackdrop[] = ["none", "box", "blur", "pill"];
export const DESIGN_WRAPS: DesignWrap[] = ["normal", "balance", "nowrap"];

export type DesignButtonSize = "sm" | "md" | "lg";
export type DesignButtonShape = "pill" | "rounded" | "square";
export type DesignButtonStyle = "solid" | "outline" | "ghost";
export const BUTTON_SIZES: DesignButtonSize[] = ["sm", "md", "lg"];
export const BUTTON_SHAPES: DesignButtonShape[] = ["pill", "rounded", "square"];
export const BUTTON_STYLES: DesignButtonStyle[] = ["solid", "outline", "ghost"];

export type DesignOverlayKind = "none" | "full" | "gradient" | "floor" | "radial";
export const OVERLAY_KINDS: DesignOverlayKind[] = ["none", "full", "gradient", "floor", "radial"];
export type DesignDirection = "left" | "right" | "top" | "bottom";
export const OVERLAY_DIRECTIONS: DesignDirection[] = ["left", "right", "top", "bottom"];

/** Brand swatches; values read from src/app/globals.css (:root) — not guessed. */
export const BRAND_SWATCHES: { name: string; hex: string }[] = [
  { name: "White", hex: "#ffffff" },
  { name: "Black", hex: "#000000" },
  { name: "Greenway green", hex: "#7ed957" },
  { name: "Greenway dark", hex: "#12351f" },
  { name: "Gold", hex: "#ffd700" },
  { name: "Orange", hex: "#ff7f00" },
  { name: "Soft gray", hex: "#d4d4d8" },
  { name: "Charcoal", hex: "#1a1a1a" },
];

/**
 * "site" = inherit the site-wide font the owner picked in Site Content (what
 * legacy banners do). Any FONT_OPTIONS id forces that font for one box/button.
 */
export const DEFAULT_FONT_ID = "site";
const FONT_IDS = new Set([DEFAULT_FONT_ID, ...FONT_OPTIONS.map((f) => f.id)]);
/** R56-S2: a library font OR an owner-uploaded `custom:<hex>.<ext>` font. */
const isDesignFont = (id: unknown): id is string => typeof id === "string" && (FONT_IDS.has(id) || isCustomFontId(id));
export const DESIGN_FONTS: { id: string; label: string; stack: string | null }[] = [
  { id: DEFAULT_FONT_ID, label: "Site font (default)", stack: null },
  ...FONT_OPTIONS.map((f) => ({ id: f.id, label: f.label, stack: f.stack })),
];

/** CSS font-family for a design font id; null = inherit the site font. */
export function designFontFamily(id: string): string | null {
  if (!id || id === DEFAULT_FONT_ID || !isDesignFont(id)) return null;
  return fontStack(id, "system");
}

// ── Types ────────────────────────────────────────────────────────────────────

export type DesignTextBox = {
  id: string;
  role: DesignRole;
  bind: DesignBind;
  text: string;
  x: number;
  y: number;
  w: number;
  mx: number | null;
  my: number | null;
  mw: number | null;
  align: DesignAlign;
  font: string;
  size: number;
  sizeMobile: number;
  weight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  transform: DesignTransform;
  color: string;
  opacity: number;
  letterSpacing: number;
  lineHeight: number;
  shadow: DesignShadow;
  outline: boolean;
  backdrop: DesignBackdrop;
  backdropColor: string;
  backdropOpacity: number;
  wrap: DesignWrap;
  hidden: boolean;
  hideOnMobile: boolean;
  /** R55: locked = can't be dragged/nudged by accident (still editable in the panel). */
  locked?: boolean;
  /** R55: letter outline (px) + colour. Overrides the legacy 1px `outline`. */
  strokeWidth?: number;
  strokeColor?: string;
  /** R55: gradient-filled letters; `color` stays as the fallback. */
  gradient?: DesignGradient;
  /** R56: rotation in degrees (−180…180); absent = upright. */
  rotate?: number;
  /** R58: curved text −100…100 (+ arch ∩, − smile ∪); absent = straight. */
  curve?: number;
  /** R58: countdown / auto deal badge — `text` becomes a template ({left}, {offer}…). */
  live?: LiveText;
} & TextMotionFields;

export type DesignButton = {
  id: string;
  label: string;
  href: string;
  x: number;
  y: number;
  mx: number | null;
  my: number | null;
  size: DesignButtonSize;
  shape: DesignButtonShape;
  style: DesignButtonStyle;
  bg: string;
  fg: string;
  border: string;
  font: string;
  uppercase: boolean;
  newTab: boolean;
  enabled: boolean;
  hideOnMobile: boolean;
  /** R55: see DesignTextBox.locked. */
  locked?: boolean;
  /** R56: rotation in degrees; absent = upright. */
  rotate?: number;
} & ButtonFx;

export type DesignOverlay = {
  kind: DesignOverlayKind;
  color: string;
  opacity: number;
  direction: DesignDirection;
};

export type DesignImage = {
  focusX: number;
  focusY: number;
  focusXMobile: number | null;
  focusYMobile: number | null;
  zoom: number;
  brightness: number;
  saturation: number;
  blur: number;
  flip: boolean;
  /**
   * R42 (owner Q4): optional separate PHONE picture. Shown instead of the main
   * picture when the banner is narrower than 768px (the same container rule
   * as every other phone setting). Absent = the main picture on both sizes
   * (the R41 behavior). Only written when set, so existing designs stay
   * byte-identical. Site-relative path or Supabase public-storage URL only.
   */
  srcMobile?: string;
  /** R59-S1: pro picture tools (banner-image-core). Written only when used. */
  fx?: ImageFx;
};

export type DesignFrame = {
  height: number;
  heightMobile: number;
  radius: number;
};

export type BannerDesign = {
  v: 1;
  enabled: boolean;
  frame: DesignFrame;
  image: DesignImage;
  overlay: DesignOverlay;
  boxes: DesignTextBox[];
  buttons: DesignButton[];
  /** R57: a light that travels around the banner's border. Written only when on. */
  beam?: Beam;
  /** R58: smoke / fog / haze layers (banner-atmos-core). Written only when used. */
  smoke?: SmokeLayer[];
  /** R58: seconds the words + buttons wait before fading in (after the smoke). */
  reveal?: number;
  /** R55: decorative shapes (banner-elements-core). Written only when there are any. */
  elements?: DesignElement[];
  /** R55: layer paint order, back → front (ids). Written only after the owner reorders. */
  order?: string[];
};

export type DesignPreset = "section" | "hero";

// ── Small helpers ────────────────────────────────────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown, def: number, min: number, max: number, step = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return def;
  let out = Math.min(max, Math.max(min, n));
  if (step > 0) out = Math.round(out / step) * step;
  out = Math.min(max, Math.max(min, out));
  return Math.round(out * 10000) / 10000;
}

function numOrNull(v: unknown, min: number, max: number, step = 0): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return num(n, 0, min, max, step);
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}

function pick<T extends string>(v: unknown, list: readonly T[], def: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : def;
}

/** Coerce to lowercase #rrggbb; accepts #rgb; anything else → def. */
export function normalizeHex(v: unknown, def: string): string {
  if (typeof v !== "string") return def;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return def;
}

function str(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  // normalize Windows line breaks so "\n" is the only hard break
  return v.replace(/\r\n?/g, "\n").slice(0, max);
}

function cleanId(v: unknown, fallback: string): string {
  const s = typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) : "";
  return s || fallback;
}

function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let i = 2; i < 1000; i += 1) {
    const cand = `${base.slice(0, 20)}-${i}`;
    if (!used.has(cand)) {
      used.add(cand);
      return cand;
    }
  }
  return base;
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export function defaultTextBox(role: DesignRole = "body", overrides: Partial<DesignTextBox> = {}): DesignTextBox {
  const info = roleInfo(role);
  const base: DesignTextBox = {
    id: role,
    role,
    bind: null,
    text: "",
    x: 4,
    y: 10,
    w: 60,
    mx: null,
    my: null,
    mw: null,
    align: "left",
    font: DEFAULT_FONT_ID,
    size: info.size,
    sizeMobile: info.sizeMobile,
    weight: info.weight,
    italic: false,
    underline: false,
    strike: false,
    transform: role === "eyebrow" || role === "headline" || role === "badge" ? "uppercase" : "none",
    color: role === "eyebrow" ? "#7ed957" : role === "subhead" ? "#d4d4d8" : role === "badge" ? "#000000" : "#ffffff",
    opacity: 100,
    letterSpacing: role === "eyebrow" ? 0.22 : role === "headline" ? -0.025 : 0,
    lineHeight: role === "headline" ? 1 : role === "eyebrow" ? 1.2 : 1.4,
    shadow: "none",
    outline: false,
    backdrop: role === "badge" ? "pill" : "none",
    backdropColor: role === "badge" ? "#ffd700" : "#000000",
    backdropOpacity: role === "badge" ? 100 : 50,
    wrap: role === "headline" ? "balance" : "normal",
    hidden: false,
    hideOnMobile: false,
  };
  return { ...base, ...overrides };
}

export function defaultButton(overrides: Partial<DesignButton> = {}): DesignButton {
  return {
    id: "button",
    label: "Shop now",
    href: "/menu",
    x: 4,
    y: 72,
    mx: null,
    my: null,
    size: "md",
    shape: "pill",
    style: "solid",
    bg: "#7ed957",
    fg: "#000000",
    border: "#7ed957",
    font: DEFAULT_FONT_ID,
    uppercase: true,
    newTab: false,
    enabled: true,
    hideOnMobile: false,
    ...overrides,
  };
}

export function defaultDesign(preset: DesignPreset = "section"): BannerDesign {
  return {
    v: DESIGN_VERSION,
    enabled: true,
    frame: preset === "hero" ? { height: 260, heightMobile: 200, radius: 16 } : { height: 200, heightMobile: 160, radius: 16 },
    image: { focusX: 50, focusY: 50, focusXMobile: null, focusYMobile: null, zoom: 100, brightness: 100, saturation: 100, blur: 0, flip: false },
    overlay: { kind: "gradient", color: "#000000", opacity: 85, direction: "left" },
    boxes: [
      defaultTextBox("eyebrow", { id: "eyebrow", bind: "eyebrow", x: 4, y: 18, w: 60 }),
      defaultTextBox("headline", { id: "headline", bind: "title", x: 4, y: 30, w: 60 }),
      defaultTextBox("subhead", { id: "subhead", bind: "subtitle", x: 4, y: 62, w: 50 }),
    ],
    buttons: [],
  };
}

// ── Normalizer ───────────────────────────────────────────────────────────────

export function normalizeTextBox(raw: unknown, fallbackId: string): DesignTextBox | null {
  if (!isObj(raw)) return null;
  const role = pick(raw.role, DESIGN_ROLES.map((r) => r.role), "body");
  const d = defaultTextBox(role);
  const bind = raw.bind === "eyebrow" || raw.bind === "title" || raw.bind === "subtitle" ? raw.bind : null;
  const font = isDesignFont(raw.font) ? raw.font : DEFAULT_FONT_ID;
  const w = num(raw.w, d.w, 5, 100);
  return {
    id: cleanId(raw.id, fallbackId),
    role,
    bind,
    text: str(raw.text, MAX_BOX_TEXT),
    x: num(raw.x, d.x, 0, 100),
    y: num(raw.y, d.y, 0, 100),
    w,
    mx: numOrNull(raw.mx, 0, 100),
    my: numOrNull(raw.my, 0, 100),
    mw: numOrNull(raw.mw, 5, 100),
    align: pick(raw.align, DESIGN_ALIGNS, "left"),
    font,
    size: num(raw.size, d.size, 8, 160),
    sizeMobile: num(raw.sizeMobile, d.sizeMobile, 6, 96),
    weight: num(raw.weight, d.weight, 100, 900, 100),
    italic: bool(raw.italic, false),
    underline: bool(raw.underline, false),
    strike: bool(raw.strike, false),
    transform: pick(raw.transform, DESIGN_TRANSFORMS, d.transform),
    color: normalizeHex(raw.color, d.color),
    opacity: num(raw.opacity, 100, 10, 100),
    letterSpacing: num(raw.letterSpacing, d.letterSpacing, -0.1, 0.5),
    lineHeight: num(raw.lineHeight, d.lineHeight, 0.7, 3),
    shadow: pick(raw.shadow, DESIGN_SHADOWS, "none"),
    outline: bool(raw.outline, false),
    backdrop: pick(raw.backdrop, DESIGN_BACKDROPS, d.backdrop),
    backdropColor: normalizeHex(raw.backdropColor, d.backdropColor),
    backdropOpacity: num(raw.backdropOpacity, d.backdropOpacity, 0, 100),
    wrap: pick(raw.wrap, DESIGN_WRAPS, d.wrap),
    hidden: bool(raw.hidden, false),
    hideOnMobile: bool(raw.hideOnMobile, false),
    ...(raw.locked === true ? { locked: true } : {}),
    ...normalizeTextFx(raw),
    ...rotateField(raw.rotate),
    ...(normalizeCurve(raw.curve) ? { curve: normalizeCurve(raw.curve) } : {}),
    ...(normalizeLive(raw.live) ? { live: normalizeLive(raw.live) } : {}),
    ...normalizeTextMotion(raw),
  };
}

/** R55: optional text effects, emitted only when actually used (old designs stay byte-identical). */
function normalizeTextFx(raw: Record<string, unknown>): Pick<DesignTextBox, "strokeWidth" | "strokeColor" | "gradient"> {
  const out: Pick<DesignTextBox, "strokeWidth" | "strokeColor" | "gradient"> = {};
  const sw = num(raw.strokeWidth, 0, 0, STROKE_MAX, 0.5);
  if (sw > 0) {
    out.strokeWidth = sw;
    out.strokeColor = normalizeHex(raw.strokeColor, "#000000");
  }
  const g = raw.gradient;
  if (isObj(g) && typeof g.from === "string" && typeof g.to === "string") {
    out.gradient = { from: normalizeHex(g.from, "#ffffff"), to: normalizeHex(g.to, "#7ed957"), angle: num(g.angle, 90, 0, 360, 1) };
  }
  return out;
}

export function normalizeButton(raw: unknown, fallbackId: string): DesignButton | null {
  if (!isObj(raw)) return null;
  const href = typeof raw.href === "string" ? raw.href.trim() : "";
  if (checkHref(href).level === "block") return null;
  const d = defaultButton();
  const style = pick(raw.style, BUTTON_STYLES, "solid");
  return {
    id: cleanId(raw.id, fallbackId),
    label: str(raw.label, MAX_BUTTON_LABEL).replace(/\n/g, " ").trim() || d.label,
    href,
    x: num(raw.x, d.x, 0, 100),
    y: num(raw.y, d.y, 0, 100),
    mx: numOrNull(raw.mx, 0, 100),
    my: numOrNull(raw.my, 0, 100),
    size: pick(raw.size, BUTTON_SIZES, "md"),
    shape: pick(raw.shape, BUTTON_SHAPES, "pill"),
    style,
    bg: normalizeHex(raw.bg, d.bg),
    fg: normalizeHex(raw.fg, d.fg),
    border: normalizeHex(raw.border, d.border),
    font: isDesignFont(raw.font) ? raw.font : DEFAULT_FONT_ID,
    uppercase: bool(raw.uppercase, true),
    newTab: bool(raw.newTab, false),
    enabled: bool(raw.enabled, true),
    hideOnMobile: bool(raw.hideOnMobile, false),
    ...(raw.locked === true ? { locked: true } : {}),
    ...rotateField(raw.rotate),
    // R56-S4: icon / gradient / shadow / hover / attention / corner — only when used.
    ...normalizeButtonFx(raw, normalizeHex(raw.bg, d.bg)),
  };
}

/** R56: rotation is written only when non-zero (older designs stay byte-identical). */
function rotateField(v: unknown): { rotate?: number } {
  const r = num(v, 0, -180, 180, 1);
  return r ? { rotate: r } : {};
}

/** Defensive normalizer for stored/posted JSON. Null when raw isn't an object. */
export function normalizeDesign(raw: unknown): BannerDesign | null {
  if (!isObj(raw)) return null;
  const def = defaultDesign("section");
  const fr = isObj(raw.frame) ? raw.frame : {};
  const im = isObj(raw.image) ? raw.image : {};
  const ov = isObj(raw.overlay) ? raw.overlay : {};
  const used = new Set<string>();
  const boxes: DesignTextBox[] = [];
  for (const [i, b] of (Array.isArray(raw.boxes) ? raw.boxes : []).entries()) {
    if (boxes.length >= MAX_TEXT_BOXES) break;
    const nb = normalizeTextBox(b, `box-${i + 1}`);
    if (!nb) continue;
    nb.id = uniqueId(nb.id, used);
    boxes.push(nb);
  }
  const buttons: DesignButton[] = [];
  for (const [i, b] of (Array.isArray(raw.buttons) ? raw.buttons : []).entries()) {
    if (buttons.length >= MAX_DESIGN_BUTTONS) break;
    const nb = normalizeButton(b, `button-${i + 1}`);
    if (!nb) continue;
    nb.id = uniqueId(nb.id, used);
    buttons.push(nb);
  }
  // R55: shapes + layer order (only written when used → older designs unchanged).
  const elements: DesignElement[] = [];
  for (const [i, e] of (Array.isArray(raw.elements) ? raw.elements : []).entries()) {
    if (elements.length >= MAX_ELEMENTS) break;
    const ne = normalizeElement(e, `shape-${i + 1}`);
    if (!ne) continue;
    ne.id = uniqueId(ne.id, used);
    elements.push(ne);
  }
  const order = normalizeOrder(raw.order, [...elements, ...boxes, ...buttons].map((x) => x.id));
  const out: BannerDesign = {
    v: DESIGN_VERSION,
    enabled: bool(raw.enabled, false),
    frame: {
      height: num(fr.height, def.frame.height, 80, 720),
      heightMobile: num(fr.heightMobile, def.frame.heightMobile, 80, 720),
      radius: num(fr.radius, def.frame.radius, 0, 48),
    },
    image: {
      focusX: num(im.focusX, 50, 0, 100),
      focusY: num(im.focusY, 50, 0, 100),
      focusXMobile: numOrNull(im.focusXMobile, 0, 100),
      focusYMobile: numOrNull(im.focusYMobile, 0, 100),
      zoom: num(im.zoom, 100, 100, 250),
      brightness: num(im.brightness, 100, 50, 150),
      saturation: num(im.saturation, 100, 0, 200),
      blur: num(im.blur, 0, 0, 12),
      flip: bool(im.flip, false),
      // R53: one picture per banner (owner, dev phase) — any old R42 phone
      // picture (srcMobile) is dropped here, so phones use the main picture.
    },
    overlay: {
      kind: pick(ov.kind, OVERLAY_KINDS, "none"),
      color: normalizeHex(ov.color, "#000000"),
      opacity: num(ov.opacity, 0, 0, 100),
      direction: pick(ov.direction, OVERLAY_DIRECTIONS, "left"),
    },
    boxes,
    buttons,
  };
  if (elements.length) out.elements = elements;
  if (order) out.order = order;
  const beam = normalizeBeam(raw.beam);
  if (beam) out.beam = beam;
  const smoke = normalizeSmoke(raw.smoke);
  if (smoke.length) out.smoke = smoke;
  const reveal = normalizeReveal(raw.reveal);
  if (reveal) out.reveal = reveal;
  const ifx = normalizeImageFx(im.fx);
  if (ifx) out.image.fx = ifx;
  return out;
}

/**
 * R42: an image path the public renderer can safely hand to next/image —
 * a site-relative path ("/brand/x.webp", not "//host") or a Supabase public
 * storage URL (the only remote host allowed in next.config images). Anything
 * else (http, data:, javascript:, other hosts) returns null.
 */
export function safeImageSrc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 2048) return null;
  if (t.startsWith("/") && !t.startsWith("//") && !t.includes("\\")) return t;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (!/^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname)) return null;
    if (!u.pathname.startsWith("/storage/v1/object/public/")) return null;
    return t;
  } catch {
    return null;
  }
}

/** R42: the phone picture to use (separate one if set, else the main one). */
export function mobileImageSrc(design: BannerDesign, mainSrc: string): string {
  return design.image.srcMobile || mainSrc;
}

/** Read `settings[key]` as a design (disabled designs are still returned so the editor can toggle). */
export function readDesign(settings: unknown, key = "design"): BannerDesign | null {
  if (!isObj(settings)) return null;
  return normalizeDesign(settings[key]);
}

/** Return a NEW settings object with the design written (or removed when null). Never mutates. */
export function writeDesign(settings: unknown, design: BannerDesign | null, key = "design"): Record<string, unknown> {
  const base: Record<string, unknown> = isObj(settings) ? { ...settings } : {};
  if (design === null) delete base[key];
  else base[key] = normalizeDesign(design);
  return base;
}

// ── Legacy → design ──────────────────────────────────────────────────────────

export type LegacyImageFocus = "center" | "top" | "bottom" | "left" | "right";
export type LegacyBannerInput = {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "center" | "bottom";
  imageFocus?: LegacyImageFocus | null;
  buttons?: { label: string; href: string; variant?: "solid" | "outline" | "ghost"; enabled?: boolean }[];
  preset?: DesignPreset;
};

const FOCUS_MAP: Record<LegacyImageFocus, [number, number]> = {
  center: [50, 50],
  top: [50, 0],
  bottom: [50, 100],
  left: [0, 50],
  right: [100, 50],
};

/** Build a design that looks like today's SectionBanner (bible PART 5.5). */
export function designFromLegacy(input: LegacyBannerInput): BannerDesign {
  const preset = input.preset ?? "section";
  const d = defaultDesign(preset);
  const align = input.textAlign ?? "left";
  const vAlign = input.verticalAlign ?? "center";
  const legacyFocus: LegacyImageFocus = align === "right" ? "left" : align === "center" ? "center" : "right";
  const [fx, fy] = FOCUS_MAP[input.imageFocus ?? legacyFocus];
  d.image.focusX = fx;
  d.image.focusY = fy;
  // SectionBanner: rgba(0,0,0,0.94) from the text side; center = soft 0.55–0.72 all over.
  d.overlay =
    align === "center"
      ? { kind: "full", color: "#000000", opacity: 65, direction: "left" }
      : { kind: "gradient", color: "#000000", opacity: 94, direction: align === "right" ? "right" : "left" };

  const w = 60;
  const x = align === "center" ? 50 - w / 2 : align === "right" ? 96 - w : 4;
  const boxAlign: DesignAlign = align;
  const hasEyebrow = !!input.eyebrow?.trim();
  const hasSub = !!input.subtitle?.trim();
  const visibleButtons = (input.buttons ?? []).filter((b) => b.enabled !== false && b.label?.trim() && b.href?.trim());
  // Stack heights in % of the frame (approximate legacy rhythm).
  const parts: { kind: "eyebrow" | "headline" | "subhead" | "buttons"; h: number }[] = [];
  if (hasEyebrow) parts.push({ kind: "eyebrow", h: 10 });
  parts.push({ kind: "headline", h: 28 });
  if (hasSub) parts.push({ kind: "subhead", h: 16 });
  if (visibleButtons.length) parts.push({ kind: "buttons", h: 20 });
  const total = parts.reduce((s, p) => s + p.h + 2, -2);
  let y = vAlign === "top" ? 8 : vAlign === "bottom" ? Math.max(0, 92 - total) : Math.max(0, (100 - total) / 2);
  const ys: Record<string, number> = {};
  for (const p of parts) {
    ys[p.kind] = r4(y);
    y += p.h + 2;
  }
  const boxes: DesignTextBox[] = [];
  if (hasEyebrow)
    boxes.push(
      defaultTextBox("eyebrow", { id: "eyebrow", bind: "eyebrow", x, y: ys.eyebrow, w, align: boxAlign, size: 12, sizeMobile: 10, weight: 900, color: "#7ed957", letterSpacing: 0.22 }),
    );
  boxes.push(
    defaultTextBox("headline", { id: "headline", bind: "title", x, y: ys.headline, w, align: boxAlign, size: 48, sizeMobile: 24, weight: 900, color: "#ffffff", lineHeight: 1 }),
  );
  if (hasSub)
    boxes.push(
      defaultTextBox("subhead", { id: "subhead", bind: "subtitle", x, y: ys.subhead, w: Math.min(w, 45), align: boxAlign, size: 14, sizeMobile: 11.5, weight: 600, color: "#d4d4d8" }),
    );
  if (align === "center" && hasSub) boxes[boxes.length - 1].x = 50 - Math.min(w, 45) / 2;
  if (align === "right" && hasSub) boxes[boxes.length - 1].x = 96 - Math.min(w, 45);
  d.boxes = boxes;

  const used = new Set(boxes.map((b) => b.id));
  const btnW = 14;
  const rowW = visibleButtons.length * btnW + Math.max(0, visibleButtons.length - 1) * 1;
  let bx = align === "center" ? 50 - rowW / 2 : align === "right" ? 96 - rowW : 4;
  d.buttons = visibleButtons.slice(0, MAX_DESIGN_BUTTONS).map((b, i) => {
    const variant = b.variant ?? "solid";
    const colors =
      variant === "solid"
        ? { style: "solid" as const, bg: "#7ed957", fg: "#000000", border: "#7ed957" }
        : variant === "outline"
          ? { style: "outline" as const, bg: "#000000", fg: "#ffffff", border: "#ffffff" }
          : { style: "ghost" as const, bg: "#000000", fg: "#7ed957", border: "#7ed957" };
    const btn = defaultButton({ id: uniqueId(`button-${i + 1}`, used), label: b.label.trim().slice(0, MAX_BUTTON_LABEL), href: b.href.trim(), x: r4(Math.max(0, bx)), y: ys.buttons ?? 72, ...colors });
    bx += btnW + 1;
    return btn;
  });
  d.enabled = true;
  return normalizeDesign(d)!;
}

/**
 * R47: make sure every banner field that is switched ON and has words has a
 * text box bound to it. A design made while (say) the eyebrow was hidden has
 * no eyebrow box, so ticking "Show" later did nothing on a custom design.
 * Missing boxes are added next to the headline in the legacy style; boxes the
 * owner already has (even hidden ones) are left alone unless `unhide` names
 * that field. Returns the SAME object when nothing changes.
 */
export function ensureBoundBoxes(
  design: BannerDesign,
  legacy: { eyebrow?: string; title?: string; subtitle?: string },
  unhide: DesignBind = null,
): BannerDesign {
  let boxes = design.boxes;
  let changed = false;
  if (unhide) {
    const i = boxes.findIndex((b) => b.bind === unhide && b.hidden);
    if (i >= 0) {
      boxes = boxes.map((b, j) => (j === i ? { ...b, hidden: false } : b));
      changed = true;
    }
  }
  const head = boxes.find((b) => b.bind === "title") ?? boxes.find((b) => b.role === "headline");
  const x = head ? head.x : 4;
  const w = head ? head.w : 60;
  const align: DesignAlign = head ? head.align : "left";
  const hy = head ? head.y : 30;
  const used = new Set(boxes.map((b) => b.id));
  const add: DesignTextBox[] = [];
  const has = (k: Exclude<DesignBind, null>) => boxes.some((b) => b.bind === k);
  if (legacy.eyebrow?.trim() && !has("eyebrow") && boxes.length + add.length < MAX_TEXT_BOXES)
    add.push(
      defaultTextBox("eyebrow", { id: uniqueId("eyebrow", used), bind: "eyebrow", x, y: r4(Math.max(0, hy - 12)), w, align, size: 12, sizeMobile: 10, weight: 900, color: "#7ed957", letterSpacing: 0.22 }),
    );
  if (legacy.title?.trim() && !has("title") && boxes.length + add.length < MAX_TEXT_BOXES)
    add.push(
      defaultTextBox("headline", { id: uniqueId("headline", used), bind: "title", x, y: hy, w, align, size: 48, sizeMobile: 24, weight: 900, color: "#ffffff", lineHeight: 1 }),
    );
  if (legacy.subtitle?.trim() && !has("subtitle") && boxes.length + add.length < MAX_TEXT_BOXES)
    add.push(
      defaultTextBox("subhead", { id: uniqueId("subhead", used), bind: "subtitle", x, y: r4(Math.min(90, hy + 30)), w: Math.min(w, 45), align, size: 14, sizeMobile: 11.5, weight: 600, color: "#d4d4d8" }),
    );
  if (add.length) {
    boxes = [...boxes, ...add];
    changed = true;
  }
  return changed ? { ...design, boxes } : design;
}

/** The text a box shows (bound boxes follow the banner's own fields). */
export function resolveBoxText(box: Pick<DesignTextBox, "bind" | "text">, legacy: { eyebrow?: string; title?: string; subtitle?: string }): string {
  if (box.bind === "eyebrow") return legacy.eyebrow ?? "";
  if (box.bind === "title") return legacy.title ?? "";
  if (box.bind === "subtitle") return legacy.subtitle ?? "";
  return box.text;
}

// ── Rendering math (bible PART 5.3) ──────────────────────────────────────────

/** Fluid px between the mobile (390) and desktop (1408) reference widths, in container units. */
export function interpPx(mobilePx: number, desktopPx: number): string {
  const lo = Math.min(mobilePx, desktopPx);
  const hi = Math.max(mobilePx, desktopPx);
  if (mobilePx === desktopPx) return `${r4(desktopPx)}px`;
  const slope = r4((desktopPx - mobilePx) / (DESKTOP_REF_PX - MOBILE_REF_PX));
  return `clamp(${r4(lo)}px, calc(${r4(mobilePx)}px + ${slope} * (100cqw - ${MOBILE_REF_PX}px)), ${r4(hi)}px)`;
}

export type StyleMap = Record<string, string>;

function rgba(hex: string, opacityPct: number): string {
  const h = normalizeHex(hex, "#000000");
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${r4(Math.min(100, Math.max(0, opacityPct)) / 100)})`;
}

/**
 * The OUTER wrapper is the size container. Container units (cqw) on an element
 * resolve against its nearest ANCESTOR container, so the frame (which uses
 * 100cqw for its own height) must sit inside this wrapper, not be it.
 */
export function containerStyle(): StyleMap {
  return { containerType: "inline-size", containerName: "gwb", width: "100%" };
}

export function frameStyle(design: BannerDesign): StyleMap {
  return {
    position: "relative",
    overflow: "hidden",
    isolation: "isolate",
    height: interpPx(design.frame.heightMobile, design.frame.height),
    borderRadius: `${design.frame.radius}px`,
  };
}

export function imageStyle(design: BannerDesign): StyleMap {
  const im = design.image;
  const pos = `${im.focusX}% ${im.focusY}%`;
  const mpos = `${im.focusXMobile ?? im.focusX}% ${im.focusYMobile ?? im.focusY}%`;
  const transforms: string[] = [];
  if (im.zoom !== 100) transforms.push(`scale(${r4(im.zoom / 100)})`);
  if (im.flip) transforms.push("scaleX(-1)");
  if (im.fx?.flipY) transforms.push("scaleY(-1)");
  const filters: string[] = [];
  if (im.brightness !== 100) filters.push(`brightness(${r4(im.brightness / 100)})`);
  if (im.saturation !== 100) filters.push(`saturate(${r4(im.saturation / 100)})`);
  if (im.blur > 0) filters.push(`blur(${im.blur}px)`);
  filters.push(...imageFxFilters(im.fx));
  const s: StyleMap = {
    objectFit: "cover",
    objectPosition: `var(--gip, ${pos})`,
    transformOrigin: `var(--gip, ${pos})`,
    "--gip-d": pos,
    "--gip-m": mpos,
  };
  if (transforms.length) s.transform = transforms.join(" ");
  if (filters.length) s.filter = filters.join(" ");
  return s;
}

/** Overlay background. `headlineCenter` (percent) centers the radial overlay. */
export function overlayStyle(design: BannerDesign, headlineCenter?: { x: number; y: number }): StyleMap | null {
  const o = design.overlay;
  if (o.kind === "none" || o.opacity <= 0) return null;
  const dark = rgba(o.color, o.opacity);
  const mid = rgba(o.color, o.opacity * 0.35);
  const clear = rgba(o.color, 0);
  let background: string;
  if (o.kind === "full") background = dark;
  else if (o.kind === "floor") background = `linear-gradient(to top, ${dark} 0%, ${mid} 50%, ${clear} 100%)`;
  else if (o.kind === "radial") {
    const c = headlineCenter ?? { x: 50, y: 50 };
    background = `radial-gradient(ellipse at ${r4(c.x)}% ${r4(c.y)}%, ${dark} 0%, ${mid} 50%, ${clear} 100%)`;
  } else {
    // gradient: darkest at `direction`, fading toward the opposite side
    const to = { left: "to right", right: "to left", top: "to bottom", bottom: "to top" }[o.direction];
    background = `linear-gradient(${to}, ${dark} 0%, ${mid} 50%, ${clear} 100%)`;
  }
  return { position: "absolute", inset: "0", pointerEvents: "none", background };
}

const SHADOWS: Record<DesignShadow, string> = {
  none: "",
  soft: "0 1px 3px rgba(0,0,0,0.6)",
  strong: "0 2px 6px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.9)",
  glow: "0 0 12px rgba(255,255,255,0.65)",
  lift: "3px 3px 0 rgba(0,0,0,0.9)",
  neon: "", // colour-matched, built in shadowCss
};

/** Text-shadow value for a box (neon follows the letter/gradient colour). */
export function shadowCss(box: DesignTextBox): string {
  if (box.shadow !== "neon") return SHADOWS[box.shadow];
  const c = box.gradient ? box.gradient.to : box.color;
  return `0 0 4px ${rgba(c, 90)}, 0 0 12px ${rgba(c, 70)}, 0 0 28px ${rgba(c, 50)}`;
}

/**
 * drop-shadow() equivalent of a text-shadow list. Gradient text paints its
 * fill as a clipped background, and text-shadow would paint OVER it — so
 * gradient boxes use filter: drop-shadow instead (follows the glyph alpha).
 */
export function shadowAsFilter(textShadow: string): string {
  return textShadow
    .split(/,(?![^(]*\))/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `drop-shadow(${p})`)
    .join(" ");
}

export function boxStyle(box: DesignTextBox): StyleMap {
  const s: StyleMap = {
    position: "absolute",
    "--gx": `${box.x}%`,
    "--gy": `${box.y}%`,
    "--gw": `${box.w}%`,
    left: "var(--gbx, var(--gx))",
    top: "var(--gby, var(--gy))",
    width: "var(--gbw, var(--gw))",
    margin: "0",
    textAlign: box.align,
    fontSize: interpPx(box.sizeMobile, box.size),
    fontWeight: String(box.weight),
    fontStyle: box.italic ? "italic" : "normal",
    textTransform: box.transform,
    color: box.color,
    lineHeight: String(box.lineHeight),
    letterSpacing: `${box.letterSpacing}em`,
    whiteSpace: box.wrap === "nowrap" ? "pre" : "pre-line",
    overflowWrap: box.wrap === "nowrap" ? "normal" : "anywhere",
  };
  const ff = designFontFamily(box.font);
  if (ff) s.fontFamily = ff;
  if (box.rotate) s.rotate = `${box.rotate}deg`;
  if (box.mx !== null) s["--gmx"] = `${box.mx}%`;
  if (box.my !== null) s["--gmy"] = `${box.my}%`;
  if (box.mw !== null) s["--gmw"] = `${box.mw}%`;
  if (box.wrap === "balance") s.textWrap = "balance";
  const deco = [box.underline ? "underline" : "", box.strike ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) s.textDecorationLine = deco;
  if (box.opacity < 100) s.opacity = String(r4(box.opacity / 100));
  const gradient = box.gradient && box.backdrop === "none" ? box.gradient : null;
  if (box.shadow !== "none") {
    const sh = shadowCss(box);
    if (gradient) s.filter = shadowAsFilter(sh);
    else s.textShadow = sh;
  }
  if (box.strokeWidth && box.strokeWidth > 0) {
    // paint-order puts the stroke BEHIND the fill, so thick outlines don't eat
    // into the letters (sticker look). Width doubled because half is hidden.
    s.WebkitTextStroke = `${r4(box.strokeWidth * 2)}px ${box.strokeColor ?? "#000000"}`;
    s.paintOrder = "stroke fill";
  } else if (box.outline) s.WebkitTextStroke = `1px ${box.backdropColor}`;
  if (gradient) {
    // `color` stays as the fallback for browsers without background-clip:text.
    s.backgroundImage = `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`;
    s.WebkitBackgroundClip = "text";
    s.backgroundClip = "text";
    s.WebkitTextFillColor = "transparent";
  }
  if (box.backdrop !== "none" && box.backdropOpacity > 0) {
    s.backgroundColor = rgba(box.backdropColor, box.backdropOpacity);
    s.padding = box.backdrop === "pill" ? "0.25em 0.75em" : "0.4em 0.6em";
    s.borderRadius = box.backdrop === "pill" ? "999px" : "0.5em";
    if (box.backdrop === "pill") s.width = "auto";
    if (box.backdrop === "blur") s.backdropFilter = "blur(8px)";
  }
  // R57: motion colour + speed variables (only when motion / hover is used).
  return { ...s, ...textMotion(box, box.gradient?.to ?? box.color).vars };
}

/** R58: style of the box that HOLDS curved text — positioning/font only;
 * paint (fill, gradient, outline, shadow) moves onto the SVG letters. */
const CURVE_STRIP = ["backgroundImage", "WebkitBackgroundClip", "backgroundClip", "WebkitTextFillColor", "WebkitTextStroke", "paintOrder", "textShadow", "filter", "backgroundColor", "padding", "borderRadius", "backdropFilter", "textDecorationLine"];
export function curvedBoxStyle(box: DesignTextBox): StyleMap {
  const s = boxStyle(box);
  for (const k of CURVE_STRIP) delete s[k];
  s.width = "var(--gbw, var(--gw))";
  s.lineHeight = "1";
  return s;
}

/** R57: motion + hover classes for a text box ("" when none). */
export function boxMotionClass(box: DesignTextBox): string {
  return textMotion(box, "").className;
}

export const BUTTON_SIZE_PX: Record<DesignButtonSize, { h: number; hm: number; font: number; fontM: number; px: number }> = {
  sm: { h: 32, hm: 28, font: 11, fontM: 10, px: 12 },
  md: { h: 40, hm: 34, font: 13, fontM: 11, px: 18 },
  lg: { h: 48, hm: 40, font: 15, fontM: 13, px: 24 },
};

export function buttonStyle(btn: DesignButton): StyleMap {
  const sz = BUTTON_SIZE_PX[btn.size];
  const s: StyleMap = {
    position: "absolute",
    "--gx": `${btn.x}%`,
    "--gy": `${btn.y}%`,
    left: "var(--gbx, var(--gx))",
    top: "var(--gby, var(--gy))",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    whiteSpace: "nowrap",
    height: interpPx(sz.hm, sz.h),
    padding: `0 ${sz.px}px`,
    fontSize: interpPx(sz.fontM, sz.font),
    fontWeight: "900",
    letterSpacing: btn.uppercase ? "0.12em" : "0.02em",
    textTransform: btn.uppercase ? "uppercase" : "none",
    borderRadius: btn.shape === "pill" ? "999px" : btn.shape === "rounded" ? "10px" : "0px",
    color: btn.fg,
    textDecoration: "none",
  };
  const ff = designFontFamily(btn.font);
  if (ff) s.fontFamily = ff;
  if (btn.rotate) s.rotate = `${btn.rotate}deg`;
  if (btn.mx !== null) s["--gmx"] = `${btn.mx}%`;
  if (btn.my !== null) s["--gmy"] = `${btn.my}%`;
  if (btn.style === "solid") {
    s.backgroundColor = btn.bg;
    s.border = `1px solid ${btn.border}`;
  } else if (btn.style === "outline") {
    s.backgroundColor = "transparent";
    s.border = `1px solid ${btn.border}`;
  } else {
    s.backgroundColor = "transparent";
    s.border = "1px solid transparent";
    s.textDecoration = "underline";
    s.textUnderlineOffset = "4px";
  }
  return { ...s, ...buttonFxStyle(btn) };
}

// ── Contrast (bible PART 5.4, WCAG 2.2 SC 1.4.3) ─────────────────────────────

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const h = normalizeHex(hex, "#000000");
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` (0–1) over `bg` → #rrggbb. */
export function compositeOver(fg: string, alpha: number, bg: string): string {
  const f = normalizeHex(fg, "#000000");
  const b = normalizeHex(bg, "#000000");
  const a = Math.min(1, Math.max(0, alpha));
  const mix = (i: number) => {
    const v = Math.round(parseInt(f.slice(i, i + 2), 16) * a + parseInt(b.slice(i, i + 2), 16) * (1 - a));
    return v.toString(16).padStart(2, "0");
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** WCAG large text: ≥ 24px, or ≥ 18.67px bold (≥ 700). */
export function requiredRatio(sizePx: number, weight: number): number {
  return sizePx >= 24 || (sizePx >= 18.66 && weight >= 700) ? 3 : 4.5;
}

/** Overlay alpha (0–1) at a point (percent) — linear model matching overlayStyle stops. */
export function overlayAlphaAt(overlay: DesignOverlay, px: number, py: number): number {
  const a = Math.min(100, Math.max(0, overlay.opacity)) / 100;
  if (overlay.kind === "none") return 0;
  if (overlay.kind === "full") return a;
  if (overlay.kind === "radial") return a * 0.8; // approximation (labeled "estimate" in UI)
  // distance (0..1) from the dark side
  let t: number;
  if (overlay.kind === "floor") t = 1 - py / 100;
  else
    t = overlay.direction === "left" ? px / 100 : overlay.direction === "right" ? 1 - px / 100 : overlay.direction === "top" ? py / 100 : 1 - py / 100;
  t = Math.min(1, Math.max(0, t));
  // stops: 0 → a, 0.5 → 0.35a, 1 → 0
  return t <= 0.5 ? a - (a - 0.35 * a) * (t / 0.5) : 0.35 * a * (1 - (t - 0.5) / 0.5);
}

export type ContrastResult = { boxId: string; device: DesignDevice; ratio: number; needed: number; ok: boolean; background: string };

/** Approximate rendered box height in % of the frame (for centers / overlap). */
export function estimateBoxHeightPct(box: DesignTextBox, textLen: number, device: DesignDevice, design: BannerDesign): number {
  const refW = device === "mobile" ? MOBILE_REF_PX : DESKTOP_REF_PX;
  const frameH = device === "mobile" ? design.frame.heightMobile : design.frame.height;
  const size = device === "mobile" ? box.sizeMobile : box.size;
  const wPct = device === "mobile" ? (box.mw ?? box.w) : box.w;
  const boxPx = (wPct / 100) * refW;
  const charsPerLine = Math.max(1, Math.floor(boxPx / (size * 0.55)));
  const lines = box.wrap === "nowrap" ? 1 : Math.max(1, Math.ceil(textLen / charsPerLine));
  return Math.min(100, ((lines * size * box.lineHeight) / frameH) * 100);
}

export function boxPosition(box: DesignTextBox, device: DesignDevice): { x: number; y: number; w: number } {
  if (device === "mobile") return { x: box.mx ?? box.x, y: box.my ?? box.y, w: box.mw ?? box.w };
  return { x: box.x, y: box.y, w: box.w };
}

/** Worst-case contrast for every visible box at both devices. */
export function checkDesignContrast(design: BannerDesign, legacy: { eyebrow?: string; title?: string; subtitle?: string } = {}): ContrastResult[] {
  const out: ContrastResult[] = [];
  for (const box of design.boxes) {
    if (box.hidden) continue;
    const text = resolveBoxText(box, legacy);
    for (const device of ["desktop", "mobile"] as DesignDevice[]) {
      if (device === "mobile" && box.hideOnMobile) continue;
      const pos = boxPosition(box, device);
      const h = estimateBoxHeightPct(box, text.length, device, design);
      const cx = pos.x + pos.w / 2;
      const cy = pos.y + h / 2;
      const textLight = relativeLuminance(box.color) > 0.5;
      const worstImage = textLight ? "#ffffff" : "#000000";
      let bg = compositeOver(design.overlay.color, overlayAlphaAt(design.overlay, cx, cy), worstImage);
      if (box.backdrop !== "none" && box.backdropOpacity >= 1) bg = compositeOver(box.backdropColor, box.backdropOpacity / 100, bg);
      // Text opacity lightens/darkens the effective text color toward the background.
      const fg = box.opacity < 100 ? compositeOver(box.color, box.opacity / 100, bg) : box.color;
      const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
      const size = device === "mobile" ? box.sizeMobile : box.size;
      const needed = requiredRatio(size, box.weight);
      out.push({ boxId: box.id, device, ratio, needed, ok: ratio >= needed, background: bg });
    }
  }
  return out;
}

// ── Purpose warnings (bible PART 3.4 / 3.5) ──────────────────────────────────

export type DesignWarningCode =
  | "MULTI_HEADLINE"
  | "LONG_HEADLINE"
  | "TOO_MANY_BUTTONS"
  | "LOW_CONTRAST"
  | "OUT_OF_FRAME"
  | "EMPTY_BOX"
  | "LEGAL_TOO_SMALL"
  | "OVERLAP"
  | "BUTTON_LINK";

export type DesignWarning = { code: DesignWarningCode; message: string; boxId?: string; buttonId?: string };

function rawOutOfFrame(raw: unknown): { id: string }[] {
  if (!isObj(raw) || !Array.isArray(raw.boxes)) return [];
  const out: { id: string }[] = [];
  for (const b of raw.boxes) {
    if (!isObj(b)) continue;
    const x = Number(b.x);
    const w = Number(b.w);
    const y = Number(b.y);
    if ((Number.isFinite(x) && Number.isFinite(w) && x + w > 100) || x < 0 || y < 0 || y > 100) out.push({ id: String(b.id ?? "") });
  }
  return out;
}

/**
 * Warnings (never blocks). Accepts raw (pre-normalize) input so OUT_OF_FRAME
 * can be reported before clamping; everything else is computed on the
 * normalized design.
 */
export function checkDesign(rawOrDesign: unknown, legacy: { eyebrow?: string; title?: string; subtitle?: string } = {}): DesignWarning[] {
  const design = normalizeDesign(rawOrDesign);
  if (!design) return [];
  const w: DesignWarning[] = [];
  const visible = design.boxes.filter((b) => !b.hidden);
  const heads = visible.filter((b) => b.role === "headline");
  if (heads.length > 1) w.push({ code: "MULTI_HEADLINE", message: "Use only one headline per banner — it tells people (and Google) the one main message." });
  for (const h of heads) {
    const t = resolveBoxText(h, legacy);
    if (t.length > 60) w.push({ code: "LONG_HEADLINE", boxId: h.id, message: `Headlines read best under ~8 words (this one is ${t.length} characters).` });
  }
  const enabledButtons = design.buttons.filter((b) => b.enabled);
  if (enabledButtons.length > 2) w.push({ code: "TOO_MANY_BUTTONS", message: "More than two buttons dilutes the action. Consider keeping the best two." });
  for (const b of enabledButtons) {
    const c = checkHref(b.href);
    if (c.level === "warn") w.push({ code: "BUTTON_LINK", buttonId: b.id, message: `Button “${b.label}”: ${c.message}` });
  }
  for (const r of checkDesignContrast(design, legacy)) {
    if (!r.ok)
      w.push({
        code: "LOW_CONTRAST",
        boxId: r.boxId,
        message: `Hard to read (estimate): ${r.ratio.toFixed(1)} : 1 on ${r.device === "mobile" ? "phones" : "computers"} (needs ${r.needed} : 1). Try a darker overlay, a box behind the text, or a different color.`,
      });
  }
  for (const o of rawOutOfFrame(rawOrDesign)) w.push({ code: "OUT_OF_FRAME", boxId: o.id, message: "A text box ran past the edge of the banner — it was pulled back inside." });
  for (const b of visible) {
    if (!resolveBoxText(b, legacy).trim()) w.push({ code: "EMPTY_BOX", boxId: b.id, message: `The ${roleInfo(b.role).label.toLowerCase()} box is empty — add text or hide it.` });
  }
  const largest = Math.max(0, ...visible.map((b) => b.size));
  for (const b of visible.filter((x) => x.role === "legal")) {
    if (b.size < largest * 0.1)
      w.push({ code: "LEGAL_TOO_SMALL", boxId: b.id, message: "This small-print box is under 10% of your biggest text. You don't need warnings on banners (your age-gated site shows them in the footer on every page), but if you add one here, WAC 314-55-155(7) wants it at least 10% of the largest text." });
  }
  // Overlap (desktop, approximate)
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      const a = visible[i];
      const b = visible[j];
      const ah = estimateBoxHeightPct(a, resolveBoxText(a, legacy).length, "desktop", design);
      const bh = estimateBoxHeightPct(b, resolveBoxText(b, legacy).length, "desktop", design);
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + ah, b.y + bh) - Math.max(a.y, b.y));
      const smaller = Math.min(a.w * ah, b.w * bh);
      if (smaller > 0 && (ix * iy) / smaller > 0.3)
        w.push({ code: "OVERLAP", boxId: b.id, message: `The ${roleInfo(a.role).label.toLowerCase()} and ${roleInfo(b.role).label.toLowerCase()} boxes might overlap.` });
    }
  }
  return w;
}

// ── Move / drag math (bible PART 5.7) ────────────────────────────────────────

export type DesignMove = { target: "box" | "button" | "element"; id: string; x: number; y: number; device: DesignDevice };

export function snapPercent(v: number, guides: number[] = [0, 50, 100], threshold = 2): number {
  for (const g of guides) if (Math.abs(v - g) <= threshold) return g;
  return v;
}

const half = (n: number) => Math.round(n * 2) / 2;

/** Apply a move (desktop writes x/y, mobile writes mx/my). Unknown id → unchanged design. */
export function applyMove(design: BannerDesign, move: DesignMove): BannerDesign {
  // R55: locked items never move (Draft Mode drag included).
  if (move.target === "element") {
    // R56: shapes/icons move in Draft Mode too (free within 0–100%, like the Studio).
    const el = (design.elements ?? []).find((e) => e.id === move.id);
    if (!el || el.locked) return design;
    const x = half(Math.min(100, Math.max(0, move.x)));
    const y = half(Math.min(100, Math.max(0, move.y)));
    const elements = (design.elements ?? []).map((e) => (e.id !== move.id ? e : move.device === "mobile" ? { ...e, mx: x, my: y } : { ...e, x, y }));
    return { ...design, elements };
  }
  const target = move.target === "box" ? design.boxes.find((x) => x.id === move.id) : design.buttons.find((x) => x.id === move.id);
  if (target?.locked) return design;
  const next: BannerDesign = JSON.parse(JSON.stringify(design));
  if (move.target === "box") {
    const b = next.boxes.find((x) => x.id === move.id);
    if (!b) return design;
    const w = move.device === "mobile" ? (b.mw ?? b.w) : b.w;
    const x = half(Math.min(100 - w, Math.max(0, move.x)));
    const y = half(Math.min(100, Math.max(0, move.y)));
    if (move.device === "mobile") {
      b.mx = x;
      b.my = y;
    } else {
      b.x = x;
      b.y = y;
    }
  } else {
    const b = next.buttons.find((x) => x.id === move.id);
    if (!b) return design;
    const x = half(Math.min(100, Math.max(0, move.x)));
    const y = half(Math.min(100, Math.max(0, move.y)));
    if (move.device === "mobile") {
      b.mx = x;
      b.my = y;
    } else {
      b.x = x;
      b.y = y;
    }
  }
  return next;
}

/** Keyboard alternative to dragging (WCAG 2.5.7). Step 0.5%, Shift = 5%. */
export function nudge(design: BannerDesign, target: "box" | "button" | "element", id: string, dx: number, dy: number, device: DesignDevice, shift = false): BannerDesign {
  const step = shift ? 5 : 0.5;
  if (target === "element") {
    // R55: shapes move freely (they may bleed off the edge for effect, within 0–100%).
    const el = (design.elements ?? []).find((e) => e.id === id);
    if (!el || el.locked) return design;
    const cx = device === "mobile" ? (el.mx ?? el.x) : el.x;
    const cy = device === "mobile" ? (el.my ?? el.y) : el.y;
    const x = half(Math.min(100, Math.max(0, cx + dx * step)));
    const y = half(Math.min(100, Math.max(0, cy + dy * step)));
    const elements = (design.elements ?? []).map((e) => (e.id !== id ? e : device === "mobile" ? { ...e, mx: x, my: y } : { ...e, x, y }));
    return { ...design, elements };
  }
  const item = target === "box" ? design.boxes.find((b) => b.id === id) : design.buttons.find((b) => b.id === id);
  if (!item || item.locked) return design;
  const cx = device === "mobile" ? (item.mx ?? item.x) : item.x;
  const cy = device === "mobile" ? (item.my ?? item.y) : item.y;
  return applyMove(design, { target, id, x: cx + dx * step, y: cy + dy * step, device });
}

/** Validate a cross-frame move message (gw-design-move). */
export function parseMoveMessage(data: unknown): (DesignMove & { owner: string }) | null {
  if (!isObj(data) || data.type !== "gw-design-move") return null;
  const owner = typeof data.owner === "string" ? data.owner : "";
  if (!/^((section|shop-slide|home-slide):[0-9a-f-]{36}|specials:hero|specials:todays|loyalty:hero)$/i.test(owner)) return null;
  if (data.target !== "box" && data.target !== "button" && data.target !== "element") return null;
  const id = typeof data.id === "string" ? data.id : "";
  if (!/^[a-z0-9-]{1,24}$/.test(id)) return null;
  if (data.device !== "desktop" && data.device !== "mobile") return null;
  const x = typeof data.x === "number" ? data.x : Number.NaN;
  const y = typeof data.y === "number" ? data.y : Number.NaN;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { owner, target: data.target, id, x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)), device: data.device };
}

/** R55: every layer, back → front (default: shapes, text, buttons; or the owner's order). */
export function designLayers(design: BannerDesign): LayerRef[] {
  const defaults: LayerRef[] = [
    ...(design.elements ?? []).map((e) => ({ kind: "element" as const, id: e.id })),
    ...design.boxes.map((b) => ({ kind: "box" as const, id: b.id })),
    ...design.buttons.map((b) => ({ kind: "button" as const, id: b.id })),
  ];
  return resolveLayers(defaults, design.order);
}

/**
 * R55: z-index per id when the owner has reordered layers; null otherwise
 * (no z-index written, so pre-R55 banners render byte-identically).
 */
export function layerZ(design: BannerDesign): Map<string, number> | null {
  if (!design.order?.length) return null;
  return new Map(designLayers(design).map((r, i) => [r.id, i + 1]));
}

/** Next free id for a new box/button (editor "Add"). */
export function nextId(design: BannerDesign, base: string): string {
  const used = new Set([...design.boxes.map((b) => b.id), ...design.buttons.map((b) => b.id), ...(design.elements ?? []).map((e) => e.id)]);
  return uniqueId(cleanId(base, "item"), used);
}

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runBannerDesignCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL banner-design-core: ${msg}`);
    }
  };
  const J = (v: unknown) => JSON.stringify(v);

  // 1 idempotent default
  const def = defaultDesign("section");
  ok(J(normalizeDesign(def)) === J(def), "defaultDesign normalizes to itself");
  ok(J(normalizeDesign(defaultDesign("hero"))) === J(defaultDesign("hero")), "hero default idempotent");
  // 2 non-objects
  ok([null, 123, "x", [], undefined].every((v) => normalizeDesign(v) === null), "non-objects → null");
  // 3-6 clamps
  const c = normalizeDesign({ boxes: [{ id: "a", x: -5, y: 140, w: 2, size: 500, sizeMobile: 1, weight: 437 }] })!;
  ok(c.boxes[0].x === 0 && c.boxes[0].y === 100, "x/y clamped");
  ok(c.boxes[0].w === 5, "w min 5");
  ok(c.boxes[0].size === 160 && c.boxes[0].sizeMobile === 6, "size clamps");
  ok(c.boxes[0].weight === 400, "weight rounds to 100");
  ok(normalizeDesign({ boxes: [{ weight: 2000 }] })!.boxes[0].weight === 900, "weight max 900");
  // 7 enums
  const e = normalizeDesign({ boxes: [{ role: "banana", align: "middle" }] })!;
  ok(e.boxes[0].role === "body" && e.boxes[0].align === "left", "unknown role/align fall back");
  // 8 colors
  ok(normalizeDesign({ boxes: [{ role: "body", color: "#ABC" }] })!.boxes[0].color === "#aabbcc", "#rgb expanded");
  ok(normalizeDesign({ boxes: [{ role: "body", color: "red" }] })!.boxes[0].color === "#ffffff", "bad color → default");
  // 9 caps
  const many = normalizeDesign({ boxes: Array.from({ length: 9 }, (_, i) => ({ id: `b${i}` })), buttons: Array.from({ length: 5 }, (_, i) => ({ id: `k${i}`, href: "/menu" })) })!;
  ok(many.boxes.length === 8 && many.buttons.length === 4, "caps 8 / 4");
  // 10 dup ids
  const dup = normalizeDesign({ boxes: [{ id: "x" }, { id: "x" }] })!;
  ok(dup.boxes[0].id === "x" && dup.boxes[1].id === "x-2", "duplicate ids renamed");
  // 11 unsafe hrefs dropped
  const hb = normalizeDesign({ buttons: [{ id: "a", href: "javascript:alert(1)" }, { id: "b", href: "/menu?categories=flower" }] })!;
  ok(hb.buttons.length === 1 && hb.buttons[0].href === "/menu?categories=flower", "unsafe button dropped");
  // 12-13 writeDesign
  const settings = { lanes: ["a"], cardCount: 4, laneImages: { flower: "/x.png" } };
  const written = writeDesign(settings, def);
  ok(J(written.lanes) === J(["a"]) && written.cardCount === 4 && J(written.laneImages) === J({ flower: "/x.png" }), "siblings preserved");
  ok(!("design" in settings), "writeDesign does not mutate");
  ok(!("design" in writeDesign({ design: def, a: 1 }, null)), "null removes design");
  // 14 readDesign
  ok(readDesign({}) === null, "readDesign {} → null");
  ok(readDesign({ design: def })!.enabled === true, "readDesign valid");
  ok(readDesign({ design: { ...def, enabled: false } })!.enabled === false, "disabled design still returned");
  // 15 legacy positions
  const L = designFromLegacy({ title: "T", textAlign: "left" });
  const C = designFromLegacy({ title: "T", textAlign: "center" });
  const R = designFromLegacy({ title: "T", textAlign: "right" });
  ok(L.boxes[0].x === 4 && C.boxes[0].x === 20 && R.boxes[0].x === 36, "legacy x positions");
  ok(C.boxes[0].align === "center" && R.boxes[0].align === "right", "legacy box align");
  ok(L.enabled && L.boxes[0].bind === "title", "legacy bound + enabled");
  // 16 focus mapping
  ok(L.image.focusX === 100 && R.image.focusX === 0 && C.image.focusX === 50, "legacy opposite-side focus");
  const fm = (f: LegacyImageFocus) => {
    const d = designFromLegacy({ title: "T", imageFocus: f });
    return `${d.image.focusX},${d.image.focusY}`;
  };
  ok(fm("center") === "50,50" && fm("top") === "50,0" && fm("bottom") === "50,100" && fm("left") === "0,50" && fm("right") === "100,50", "imageFocus mapping");
  ok(L.overlay.kind === "gradient" && L.overlay.direction === "left" && R.overlay.direction === "right" && C.overlay.kind === "full", "legacy overlay");
  // 17 legacy buttons
  const LB = designFromLegacy({ title: "T", buttons: [{ label: "A", href: "/menu", variant: "solid" }, { label: "B", href: "/specials", variant: "outline" }, { label: "C", href: "/x", enabled: false }] });
  ok(LB.buttons.length === 2 && LB.buttons[0].bg === "#7ed957" && LB.buttons[0].fg === "#000000" && LB.buttons[1].style === "outline", "legacy buttons mapped");
  ok(LB.buttons[1].x > LB.buttons[0].x, "legacy buttons in a row");
  const LE = designFromLegacy({ eyebrow: "E", title: "T", subtitle: "S" });
  ok(LE.boxes.map((b) => b.role).join() === "eyebrow,headline,subhead", "legacy stack order");
  ok(LE.boxes[0].y < LE.boxes[1].y && LE.boxes[1].y < LE.boxes[2].y, "legacy stack top→bottom");
  // 18 resolveBoxText
  ok(resolveBoxText({ bind: "title", text: "x" }, { title: "Hello" }) === "Hello", "bound text");
  ok(resolveBoxText({ bind: null, text: "x" }, { title: "Hello" }) === "x", "own text");
  // 19-20 interp
  const ip = interpPx(10, 20);
  ok(ip.startsWith("clamp(10px") && ip.endsWith("20px)") && ip.includes("100cqw"), `interp ${ip}`);
  const ip2 = interpPx(20, 10);
  ok(ip2.startsWith("clamp(10px") && ip2.endsWith("20px)"), "interp min/max ordered when mobile larger");
  ok(interpPx(12, 12) === "12px", "equal sizes → plain px");
  // 21-23 luminance / contrast
  ok(relativeLuminance("#ffffff") === 1 && relativeLuminance("#000000") === 0, "luminance extremes");
  ok(Math.abs(contrastRatio("#ffffff", "#000000") - 21) < 0.01, "21:1");
  ok(Math.abs(contrastRatio("#777777", "#ffffff") - 4.48) < 0.02, "#777 on white ≈ 4.48");
  ok(compositeOver("#000000", 0.5, "#ffffff") === "#808080", "composite 50% black over white");
  // 24 thresholds
  ok(requiredRatio(24, 400) === 3 && requiredRatio(18.67, 700) === 3 && requiredRatio(18, 400) === 4.5 && requiredRatio(18.67, 400) === 4.5, "large-text thresholds");
  // 25-27 contrast scenarios
  const white = (over: Partial<BannerDesign["overlay"]>, box: Partial<DesignTextBox> = {}) => {
    const d = defaultDesign();
    d.overlay = { ...d.overlay, ...over };
    d.boxes = [defaultTextBox("body", { id: "t", text: "Hello there", color: "#ffffff", size: 16, sizeMobile: 14, ...box })];
    return d;
  };
  ok(checkDesign(white({ kind: "none", opacity: 0 })).some((x) => x.code === "LOW_CONTRAST"), "white text, no overlay → warn");
  const full70 = checkDesignContrast(white({ kind: "full", opacity: 70 }));
  ok(full70.every((r) => r.ok), `full 70% black passes 4.5 (${full70.map((r) => r.ratio).join()})`);
  const box50 = checkDesignContrast(white({ kind: "none", opacity: 0 }, { backdrop: "box", backdropColor: "#000000", backdropOpacity: 50, size: 24, sizeMobile: 24 }));
  ok(box50.every((r) => r.ok && r.needed === 3), `50% box passes 3:1 for large text (${box50.map((r) => r.ratio).join()})`);
  const box30 = checkDesignContrast(white({ kind: "none", opacity: 0 }, { backdrop: "box", backdropColor: "#000000", backdropOpacity: 30, size: 24, sizeMobile: 24 }));
  ok(box30.some((r) => !r.ok), "30% box fails 3:1 (REI example direction)");
  ok(overlayAlphaAt({ kind: "gradient", color: "#000000", opacity: 100, direction: "left" }, 0, 50) === 1, "gradient darkest at its side");
  ok(overlayAlphaAt({ kind: "gradient", color: "#000000", opacity: 100, direction: "left" }, 100, 50) === 0, "gradient clear far side");
  // 28-32 purpose warnings
  const two = defaultDesign();
  two.boxes = [defaultTextBox("headline", { id: "h1", text: "One" }), defaultTextBox("headline", { id: "h2", text: "Two", y: 60 })];
  ok(checkDesign(two).some((x) => x.code === "MULTI_HEADLINE"), "MULTI_HEADLINE");
  two.boxes[1].hidden = true;
  ok(!checkDesign(two).some((x) => x.code === "MULTI_HEADLINE"), "hidden headline ignored");
  const long = defaultDesign();
  long.boxes = [defaultTextBox("headline", { id: "h", text: "x".repeat(61) })];
  ok(checkDesign(long).some((x) => x.code === "LONG_HEADLINE"), "LONG_HEADLINE at 61");
  long.boxes[0].text = "x".repeat(60);
  ok(!checkDesign(long).some((x) => x.code === "LONG_HEADLINE"), "60 chars ok");
  const btns = defaultDesign();
  btns.buttons = [defaultButton({ id: "a" }), defaultButton({ id: "b" }), defaultButton({ id: "c" })];
  ok(checkDesign(btns).some((x) => x.code === "TOO_MANY_BUTTONS"), "TOO_MANY_BUTTONS at 3");
  btns.buttons[2].enabled = false;
  ok(!checkDesign(btns).some((x) => x.code === "TOO_MANY_BUTTONS"), "disabled button not counted");
  const legal = defaultDesign();
  legal.boxes = [defaultTextBox("headline", { id: "h", text: "Big", size: 150 }), defaultTextBox("legal", { id: "l", text: "21+", size: 12, y: 90 })];
  ok(checkDesign(legal).some((x) => x.code === "LEGAL_TOO_SMALL"), "LEGAL_TOO_SMALL");
  legal.boxes[1].size = 15;
  ok(!checkDesign(legal).some((x) => x.code === "LEGAL_TOO_SMALL"), "legal at 10% ok");
  ok(checkDesign({ ...defaultDesign(), boxes: [{ id: "o", role: "body", text: "x", x: 80, w: 40 }] }).some((x) => x.code === "OUT_OF_FRAME"), "OUT_OF_FRAME on raw");
  ok(checkDesign({ ...defaultDesign(), boxes: [{ id: "o", role: "body", text: "" }] }).some((x) => x.code === "EMPTY_BOX"), "EMPTY_BOX");
  const ov = defaultDesign();
  ov.boxes = [defaultTextBox("body", { id: "a", text: "Hello", x: 10, y: 10, w: 40 }), defaultTextBox("body", { id: "b", text: "Hello", x: 12, y: 11, w: 40 })];
  ok(checkDesign(ov).some((x) => x.code === "OVERLAP"), "OVERLAP");
  ok(checkDesign({ ...defaultDesign(), buttons: [{ id: "q", href: "/nope", label: "X" }] }).some((x) => x.code === "BUTTON_LINK"), "BUTTON_LINK warn");
  // 33-34 applyMove
  const mv = defaultDesign();
  const m1 = applyMove(mv, { target: "box", id: "headline", x: 30, y: 40, device: "desktop" });
  ok(m1.boxes[1].x === 30 && m1.boxes[1].y === 40 && m1.boxes[1].mx === null, "desktop move");
  const m2 = applyMove(mv, { target: "box", id: "headline", x: 10, y: 20, device: "mobile" });
  ok(m2.boxes[1].mx === 10 && m2.boxes[1].my === 20 && m2.boxes[1].x === mv.boxes[1].x, "mobile move");
  const m3 = applyMove(mv, { target: "box", id: "headline", x: 90, y: 40, device: "desktop" });
  ok(m3.boxes[1].x + m3.boxes[1].w <= 100, "move keeps box inside frame");
  ok(J(applyMove(mv, { target: "box", id: "nope", x: 1, y: 1, device: "desktop" })) === J(mv), "unknown id unchanged");
  ok(mv.boxes[1].x === 4, "applyMove does not mutate");
  const mb = applyMove({ ...mv, buttons: [defaultButton({ id: "go" })] }, { target: "button", id: "go", x: 50.26, y: 80, device: "desktop" });
  ok(mb.buttons[0].x === 50.5 && mb.buttons[0].y === 80, "button move rounds to 0.5");
  // 35 parseMoveMessage
  const good = { type: "gw-design-move", owner: "specials:hero", target: "box", id: "headline", x: 10, y: 20, device: "desktop" };
  ok(parseMoveMessage(good) !== null, "valid move parsed");
  ok(parseMoveMessage({ ...good, type: "x" }) === null, "wrong type");
  ok(parseMoveMessage({ ...good, x: Number.NaN }) === null, "NaN");
  ok(parseMoveMessage({ ...good, id: "" }) === null, "missing id");
  ok(parseMoveMessage({ ...good, device: "tablet" }) === null, "unknown device");
  ok(parseMoveMessage({ ...good, owner: "evil" }) === null, "unknown owner");
  ok(parseMoveMessage({ ...good, owner: "section:123e4567-e89b-12d3-a456-426614174000" }) !== null, "section owner");
  ok(parseMoveMessage({ ...good, owner: "loyalty:hero" }) !== null, "loyalty hero owner (R41 S6)");
  ok(parseMoveMessage({ ...good, owner: "shop-slide:123e4567-e89b-12d3-a456-426614174000" }) !== null, "shop slide owner (R41 S6)");
  ok(parseMoveMessage({ ...good, owner: "shop-slide:nope" }) === null, "shop slide owner needs a uuid");
  ok(parseMoveMessage({ ...good, owner: "home-slide:123e4567-e89b-12d3-a456-426614174000" }) !== null, "home slide owner (R48)");
  ok(parseMoveMessage({ ...good, owner: "home:hero" }) === null, "home:hero is not an owner");
  // 36-37 snap / nudge
  ok(snapPercent(49) === 50 && snapPercent(45) === 45 && snapPercent(1.5) === 0, "snap");
  const n1 = nudge(mv, "box", "headline", 1, 0, "desktop");
  const n2 = nudge(mv, "box", "headline", 1, 0, "desktop", true);
  ok(n1.boxes[1].x === 4.5 && n2.boxes[1].x === 9, "nudge step / shift step");
  // 38 boxStyle
  const bs = boxStyle(defaultTextBox("body", { underline: true, strike: true }));
  ok(bs.whiteSpace === "pre-line" && bs.textDecorationLine === "underline line-through", "box style wrap + decorations");
  ok(boxStyle(defaultTextBox("body", { wrap: "nowrap" })).whiteSpace === "pre", "nowrap → pre");
  ok(boxStyle(defaultTextBox("headline")).textWrap === "balance", "balance wrap");
  ok(boxStyle(defaultTextBox("body", { mx: 5 }))["--gmx"] === "5%", "mobile var");
  ok(boxStyle(defaultTextBox("body", { italic: true })).fontStyle === "italic", "italic");
  ok(!("fontFamily" in boxStyle(defaultTextBox("body"))), "site font inherits");
  ok((boxStyle(defaultTextBox("body", { font: "oswald" })).fontFamily ?? "").includes("--gw-font-oswald"), "picked font applied");
  ok(normalizeDesign({ boxes: [{ font: "comic-sans" }] })!.boxes[0].font === "site", "unknown font → site");
  ok(normalizeDesign({ boxes: [{ font: "custom:0123456789abcdef.woff2" }] })!.boxes[0].font === "custom:0123456789abcdef.woff2", "R56: uploaded font kept");
  ok((boxStyle(defaultTextBox("body", { font: "custom:0123456789abcdef.woff2" })).fontFamily ?? "").includes("gwf-0123456789abcdef"), "R56: uploaded font applied");
  {
    const rb = normalizeDesign({ boxes: [{ id: "r", rotate: -12 }, { id: "u" }], buttons: [{ id: "k", href: "/menu", rotate: 400 }] })!;
    ok(rb.boxes[0].rotate === -12 && !("rotate" in rb.boxes[1]) && rb.buttons[0].rotate === 180, "R56: rotate only when set, clamped");
    ok(boxStyle(rb.boxes[0]).rotate === "-12deg" && boxStyle(rb.boxes[1]).rotate === undefined && buttonStyle(rb.buttons[0]).rotate === "180deg", "R56: rotate style");
    const cv = normalizeDesign({ boxes: [{ id: "c", curve: 250, strokeWidth: 3 }, { id: "f", curve: 0 }] })!;
    ok(normalizeDesign({ boxes: [{ id: "l", live: { mode: "deal" } }] })!.boxes[0].live?.promo === "today" && !("live" in cv.boxes[0]), "R58: live only when set");
    ok(cv.boxes[0].curve === 100 && !("curve" in cv.boxes[1]), "R58: curve only when set, clamped");
    ok(curvedBoxStyle(cv.boxes[0]).WebkitTextStroke === undefined && curvedBoxStyle(cv.boxes[0]).left === boxStyle(cv.boxes[0]).left, "R58: curved holder keeps position, drops paint");
    const withEl = { ...rb, elements: [{ ...(normalizeDesign({ elements: [{ id: "s", shape: "star" }] })!.elements ?? [])[0]! }] };
    const mv = parseMoveMessage({ type: "gw-design-move", owner: "specials:hero", target: "element", id: "s", x: 33, y: 44, device: "mobile" });
    ok(!!mv && mv.target === "element", "R56: element move message accepted");
    const moved = applyMove(withEl, mv!);
    ok(moved.elements![0].mx === 33 && moved.elements![0].my === 44 && moved.elements![0].x === withEl.elements[0].x, "R56: element applyMove (phone)");
  }
  // 39 imageStyle
  const is = imageStyle({ ...defaultDesign(), image: { ...defaultDesign().image, focusX: 30, focusY: 70, zoom: 150, flip: true } });
  ok(is["--gip-d"] === "30% 70%" && is.objectPosition.includes("30% 70%") && is.transformOrigin.includes("30% 70%"), "image focus");
  ok(is.transform === "scale(1.5) scaleX(-1)", "zoom + flip");
  // 40 overlay
  const og = overlayStyle({ ...defaultDesign(), overlay: { kind: "gradient", color: "#000000", opacity: 80, direction: "left" } })!;
  ok(og.background.includes("to right") && og.background.includes("rgba(0,0,0,0.8)"), "gradient left → dark on left");
  ok(overlayStyle({ ...defaultDesign(), overlay: { kind: "none", color: "#000000", opacity: 80, direction: "left" } }) === null, "none → null");
  ok(overlayStyle({ ...defaultDesign(), overlay: { kind: "floor", color: "#000000", opacity: 80, direction: "left" } })!.background.includes("to top"), "floor fade");
  // 41 frame
  ok(containerStyle().containerType === "inline-size" && !("containerType" in frameStyle(defaultDesign())), "container wraps frame (cqw resolves to ancestor)");
  // buttons
  const bst = buttonStyle(defaultButton({ style: "outline", shape: "square" }));
  ok(bst.backgroundColor === "transparent" && bst.borderRadius === "0px", "outline square button");
  // 42 round trip full
  const full = defaultDesign("hero");
  full.boxes.push(defaultTextBox("badge", { id: "badge", text: "20% OFF", mx: 10, my: 5, mw: 30, italic: true, underline: true, shadow: "soft", outline: true }));
  full.buttons = [defaultButton({ id: "go", mx: 3, my: 80, newTab: true })];
  full.image.focusXMobile = 20;
  ok(J(normalizeDesign(JSON.parse(J(full)))) === J(full), "full round trip");
  // line breaks
  ok(normalizeDesign({ boxes: [{ text: "a\r\nb" }] })!.boxes[0].text === "a\nb", "CRLF → \\n");
  ok(nextId(defaultDesign(), "headline") === "headline-2", "nextId unique");
  ok(BRAND_SWATCHES.some((s) => s.hex === "#ff7f00") && BRAND_SWATCHES.some((s) => s.hex === "#1a1a1a"), "brand tokens from globals.css");

  // R42 Q4: optional phone picture
  const plain = defaultDesign("section");
  ok(!("srcMobile" in normalizeDesign(plain)!.image), "no srcMobile key unless set (byte-identical)");
  ok(J(normalizeDesign(JSON.parse(J(plain)))) === J(plain), "plain design round trip unchanged");
  const withPhone = normalizeDesign({ ...plain, image: { ...plain.image, srcMobile: "/brand/phone.webp" } })!;
  ok(!("srcMobile" in withPhone.image), "R53: old phone picture dropped (single picture)");
  const sb = "https://abc123.supabase.co/storage/v1/object/public/media/x.png";
  ok(safeImageSrc(sb) === sb, "supabase public storage ok");
  ok(
    [
      "//evil.co/x.png",
      "http://abc.supabase.co/storage/v1/object/public/x.png",
      "https://evil.co/x.png",
      "https://abc.supabase.co/storage/v1/object/sign/x.png",
      "https://u:p@abc.supabase.co/storage/v1/object/public/x.png",
      "javascript:alert(1)",
      "data:image/png;base64,AA",
      "",
      42,
    ].every((v) => safeImageSrc(v) === null),
    "unsafe phone pictures refused",
  );
  ok(mobileImageSrc(withPhone, "/main.webp") === "/main.webp", "mobileImageSrc → main picture");
  ok(J(normalizeDesign(JSON.parse(J(withPhone)))) === J(plain), "R53: design with old phone picture normalizes to the plain design");

  // R47: ensureBoundBoxes — eyebrow ticked on after the design was made.
  {
    const noEye = designFromLegacy({ title: "Big Sale", subtitle: "", preset: "hero" });
    ok(!noEye.boxes.some((b) => b.bind === "eyebrow"), "R47 seed without eyebrow has no eyebrow box");
    const same = ensureBoundBoxes(noEye, { title: "Big Sale" });
    ok(same === noEye, "R47 nothing to add returns same object");
    const fixed = ensureBoundBoxes(noEye, { eyebrow: "Greenway", title: "Big Sale" });
    const eye = fixed.boxes.find((b) => b.bind === "eyebrow");
    const head = fixed.boxes.find((b) => b.bind === "title")!;
    ok(!!eye && eye.role === "eyebrow" && eye.y < head.y && eye.x === head.x, "R47 eyebrow box added above headline");
    ok(fixed.boxes.length === noEye.boxes.length + 1, "R47 exactly one box added");
    const sub = ensureBoundBoxes(noEye, { title: "Big Sale", subtitle: "today" });
    ok(sub.boxes.some((b) => b.bind === "subtitle" && b.y > head.y), "R47 subtitle box added below headline");
    ok(ensureBoundBoxes(noEye, { eyebrow: "   ", title: "x" }) === noEye, "R47 blank words add nothing");
    const hid = { ...fixed, boxes: fixed.boxes.map((b) => (b.bind === "eyebrow" ? { ...b, hidden: true } : b)) };
    ok(ensureBoundBoxes(hid, { eyebrow: "G", title: "x" }) === hid, "R47 hidden box kept hidden without unhide");
    ok(ensureBoundBoxes(hid, { eyebrow: "G", title: "x" }, "eyebrow").boxes.find((b) => b.bind === "eyebrow")!.hidden === false, "R47 unhide shows the bound box");
    const full = { ...noEye, boxes: Array.from({ length: MAX_TEXT_BOXES }, (_, i) => defaultTextBox("body", { id: `b${i}` })) };
    ok(ensureBoundBoxes(full, { eyebrow: "G" }).boxes.length === MAX_TEXT_BOXES, "R47 never exceeds box cap");
    ok(normalizeDesign(fixed) !== null, "R47 result normalizes");
  }

  // R55-S2: shapes, layer order, lock.
  {
    const base = defaultDesign("section");
    ok(!("elements" in normalizeDesign(base)!) && !("order" in normalizeDesign(base)!), "R55 no shapes/order written when unused");
    const withEl = normalizeDesign({ ...base, elements: [{ shape: "circle", id: "headline" }, { shape: "star" }, "junk"], order: ["shape-2", "headline", "nope", "headline-2"] })!;
    ok(withEl.elements!.length === 2 && withEl.elements![0].id === "headline-2", "R55 shape ids unique vs text boxes");
    ok(J(withEl.order) === J(["shape-2", "headline", "headline-2"]), "R55 order cleaned to known ids");
    ok(J(normalizeDesign(JSON.parse(J(withEl)))) === J(withEl), "R55 shapes + order round trip");
    ok(designLayers(withEl)[0].id === "shape-2" && designLayers(withEl).length === withEl.boxes.length + 2, "R55 layers follow order, all items present");
    ok(layerZ(base) === null && layerZ(withEl)!.get("shape-2") === 1, "R55 z-index only when reordered");
    const locked = normalizeDesign({ ...base, boxes: [{ ...base.boxes[1], locked: true }] })!;
    ok(locked.boxes[0].locked === true && !("locked" in normalizeDesign(base)!.boxes[0]), "R55 lock kept, absent by default");
    ok(nudge(locked, "box", locked.boxes[0].id, 1, 0, "desktop") === locked, "R55 locked box can't nudge");
    ok(applyMove(locked, { target: "box", id: locked.boxes[0].id, x: 1, y: 1, device: "desktop" }) === locked, "R55 locked box can't move");
    const nEl = nudge(withEl, "element", "shape-2", 1, 0, "mobile", true);
    ok(nEl.elements![1].mx === nEl.elements![1].x + 5 && nEl.elements![1].x === withEl.elements![1].x, "R55 shape nudge writes phone override");
    ok(nextId(withEl, "shape") === "shape" && nextId(withEl, "shape-2") === "shape-2-2", "R55 nextId knows shape ids");
  }

  // R55-S4: text effects (stroke, gradient, new shadows).
  {
    const plain = defaultTextBox("headline");
    const pn = normalizeTextBox(plain, "x")!;
    ok(!("strokeWidth" in pn) && !("gradient" in pn), "R55 fx absent when unused");
    const fx = normalizeTextBox({ ...plain, strokeWidth: 3.3, strokeColor: "zz", gradient: { from: "#ff0000", to: "#0000ff", angle: 400 } }, "x")!;
    ok(fx.strokeWidth === 3.5 && fx.strokeColor === "#000000", "R55 stroke snapped, bad colour fallback");
    ok(fx.gradient!.angle === 360 && fx.gradient!.from === "#ff0000", "R55 gradient clamped");
    ok(J(normalizeTextBox(JSON.parse(J(fx)), "x")) === J(fx), "R55 fx round trip");
    ok(!("strokeColor" in normalizeTextBox({ ...plain, strokeWidth: 0, strokeColor: "#fff" }, "x")!), "R55 zero stroke drops colour");
    ok(!("gradient" in normalizeTextBox({ ...plain, gradient: { from: 1 } }, "x")!), "R55 bad gradient dropped");
    const st = boxStyle(fx);
    ok(st.WebkitTextStroke === "7px #000000" && st.paintOrder === "stroke fill", "R55 stroke behind fill");
    ok(st.backgroundImage === "linear-gradient(360deg, #ff0000, #0000ff)" && st.WebkitTextFillColor === "transparent" && st.color === fx.color, "R55 gradient keeps colour fallback");
    const gs = boxStyle({ ...fx, shadow: "soft" });
    ok(!("textShadow" in gs) && gs.filter === "drop-shadow(0 1px 3px rgba(0,0,0,0.6))", "R55 gradient shadow via drop-shadow");
    ok(!("backgroundImage" in boxStyle({ ...fx, backdrop: "box" })), "R55 gradient off when a backdrop box is used");
    ok(shadowAsFilter("0 0 4px rgba(1,2,3,0.9), 0 0 12px red") === "drop-shadow(0 0 4px rgba(1,2,3,0.9)) drop-shadow(0 0 12px red)", "R55 shadow list split respects parens");
    ok((boxStyle({ ...plain, shadow: "neon", color: "#00ff00" }).textShadow ?? "").includes("rgba(0,255,0,0.9)"), "R55 neon follows colour");
    ok(boxStyle({ ...plain, shadow: "lift" }).textShadow === "3px 3px 0 rgba(0,0,0,0.9)", "R55 lift shadow");
    ok(boxStyle({ ...plain, outline: true, backdropColor: "#ffffff" }).WebkitTextStroke === "1px #ffffff", "R55 legacy outline unchanged");
  }

  return { passed, failed };
}
