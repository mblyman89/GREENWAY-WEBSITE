/**
 * R60-S2 — Lottie + Rive animations inside banners (pure, import-free).
 *
 * An animation is a banner ELEMENT with `kind: "anim"`, so it gets everything a
 * shape already has for free: drag / resize / rotate on the canvas, phone
 * layout overrides, layer order, lock, group move, copy / paste, entrance
 * effects and "hide on phones". This file holds its settings (`AnimSpec`), the
 * defensive normalizer for stored JSON and the small pure helpers the player
 * and the Studio share.
 *
 * Runtimes (installed, versions pinned exactly in package.json, MIT licence):
 *  - Lottie: @lottiefiles/dotlottie-web — ThorVG (WASM) renderer that plays
 *    BOTH .lottie (dotLottie ZIP: manifest.json + a/ animations, t/ themes,
 *    s/ state machines, i/ images) and plain Lottie JSON. API read from its
 *    index.d.ts: Config { src, autoplay, loop, speed, mode, segment, marker,
 *    themeId, animationId, stateMachineId, layout { fit, align [x,y] },
 *    renderConfig { autoResize, freezeOnOffscreen, devicePixelRatio } };
 *    methods play / pause / stop / setFrame / setSegment / setMarker /
 *    setTheme / setColorSlot([r,g,b,a] 0–1) / setScalarSlot / setTextSlot /
 *    getSlotIds / getSlotType / markers() / manifest / totalFrames / destroy.
 *    ThorVG does not run Lottie "expressions" (JavaScript), so a Lottie file
 *    can't run code in a shopper's browser.
 *  - Rive: @rive-app/webgl2 — Rive's own renderer (WASM + WebGL2). API read
 *    from rive.d.ts: new Rive({ canvas, src, artboard, stateMachine, layout:
 *    new Layout({ fit, alignment }), autoplay, autoBind, useOffscreenRenderer,
 *    shouldDisableRiveListeners, onLoad, onLoadError }); contents (artboards →
 *    animations, stateMachines → inputs); stateMachineInputs(name) (.value /
 *    .fire()); data binding: viewModelInstance.number / string / boolean /
 *    color / enum / trigger(path); setTextRunValue(name, value);
 *    resizeDrawingSurfaceToCanvas(); play / pause / reset / cleanup.
 *    Fit values: contain | cover | fill | fitWidth | fitHeight | none |
 *    scaleDown; Alignment: center | topLeft | topCenter | … | bottomRight.
 *  - .riv files start with the bytes "RIVE" and the runtime only reads major
 *    format 7 (rive.app/docs/runtimes/advanced-topic/format).
 */

export type AnimEngine = "lottie" | "rive";
/** When it plays: as soon as it's shown, while the pointer is over it, on a click/tap, or scrubbed by scrolling (Lottie). */
export type AnimStart = "auto" | "hover" | "click" | "scroll";
export type AnimFit = "contain" | "cover" | "fill";
export type AnimAlign = "center" | "top" | "bottom" | "left" | "right" | "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
export type LottieMode = "forward" | "reverse" | "bounce" | "reverse-bounce";
export type AnimVal = string | number | boolean;

export type AnimSpec = {
  engine: AnimEngine;
  /** Our Media Library (Supabase public storage) or a site path. */
  src: string;
  /** File title shown in the Studio. */
  name?: string;
  /** The file's own width ÷ height (read when it is added) so the layer keeps its shape. */
  ratio?: number;
  start?: AnimStart;
  /** Play once instead of looping. */
  once?: true;
  /** 0.25–3 (1 = as designed). */
  speed?: number;
  /** Seconds to wait after the slide is shown. */
  delay?: number;
  fit?: AnimFit;
  align?: AnimAlign;
  /** Reduced motion: show this point of the animation (0–100 %) as a still… */
  still?: number;
  /** …or hide it completely. */
  stillHide?: true;
  /** Screen-reader description. Empty = decorative (hidden from screen readers). */
  alt?: string;
  // ── Lottie ──
  /** dotLottie: which animation inside the file. */
  anim?: string;
  mode?: LottieMode;
  /** Play only frames [from, to]. */
  seg?: [number, number];
  /** …or only a named marker. */
  marker?: string;
  /** dotLottie theme id. */
  theme?: string;
  /** dotLottie interactive state machine id (it then handles hover/click itself). */
  sm?: string;
  /** Lottie slots: colour (hex), text and number values by slot id. */
  colors?: Record<string, string>;
  texts?: Record<string, string>;
  nums?: Record<string, number>;
  // ── Rive ──
  artboard?: string;
  machine?: string;
  /** Start values for state-machine inputs (number / on-off). */
  inputs?: Record<string, number | boolean>;
  /** Data-binding values (view model properties) by path. Colours are "#rrggbb". */
  vm?: Record<string, AnimVal>;
  /** Text runs by name. */
  runs?: Record<string, string>;
  /** hover: this on/off input is switched on while the pointer is over it. */
  hoverInput?: string;
  /** click: this trigger (input or view-model trigger) fires on click/tap. */
  clickFire?: string;
  /** Let the file's own pointer listeners react (hover/click built in Rive). */
  interactive?: true;
};

export const MAX_ANIMS = 4;
export const ANIM_SPEED = { min: 0.25, max: 3 } as const;
export const ANIM_DELAY_MAX = 10;
const MAP_MAX = 24;
const NAME_MAX = 80;
const TEXT_MAX = 200;
const ALT_MAX = 160;

export const ANIM_STARTS: { id: AnimStart; label: string; hint: string }[] = [
  { id: "auto", label: "Plays by itself", hint: "Starts when the banner is shown (pauses when it is off screen)." },
  { id: "hover", label: "On hover", hint: "Plays while the pointer is over it; on phones a tap plays it." },
  { id: "click", label: "On click / tap", hint: "Plays from the start each time it is clicked or tapped." },
  { id: "scroll", label: "Scrubs with scrolling", hint: "Lottie only: the animation follows the page scroll." },
];
export const ANIM_FITS: { id: AnimFit; label: string }[] = [
  { id: "contain", label: "Fit inside (no cropping)" },
  { id: "cover", label: "Fill the box (may crop)" },
  { id: "fill", label: "Stretch to the box" },
];
export const ANIM_ALIGNS: { id: AnimAlign; label: string }[] = [
  { id: "topLeft", label: "↖" },
  { id: "top", label: "↑" },
  { id: "topRight", label: "↗" },
  { id: "left", label: "←" },
  { id: "center", label: "•" },
  { id: "right", label: "→" },
  { id: "bottomLeft", label: "↙" },
  { id: "bottom", label: "↓" },
  { id: "bottomRight", label: "↘" },
];
export const LOTTIE_MODES: { id: LottieMode; label: string }[] = [
  { id: "forward", label: "Forward" },
  { id: "reverse", label: "Backward" },
  { id: "bounce", label: "Bounce (forward then back)" },
  { id: "reverse-bounce", label: "Bounce (back then forward)" },
];

// ── Small helpers ───────────────────────────────────────────────────────────
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const r2 = (n: number) => Math.round(n * 100) / 100;
const HEX = /^#[0-9a-f]{6}$/i;

/** A name/id from a file (artboard, input, slot…): trimmed, no control characters, ≤ 80. */
export function cleanName(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return t.slice(0, NAME_MAX);
}
function cleanText(v: unknown, max = TEXT_MAX): string | null {
  if (typeof v !== "string") return null;
  return v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").slice(0, max);
}
function cleanMap<T>(raw: unknown, val: (v: unknown) => T | null): Record<string, T> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, T> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    const key = cleanName(k);
    if (!key || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const cv = val(v);
    if (cv === null) continue;
    out[key] = cv;
    if (++n >= MAP_MAX) break;
  }
  return n ? out : undefined;
}
const hexVal = (v: unknown) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null);
const numVal = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? clamp(r2(v), -1e6, 1e6) : null);

/** The path part of a URL or site path, lower-cased. */
function pathOf(src: string): string {
  try {
    return new URL(src, "https://x.invalid").pathname.toLowerCase();
  } catch {
    return "";
  }
}

/** Which engine plays this file (by extension), or null when it isn't an animation file. */
export function animEngineFor(src: unknown): AnimEngine | null {
  if (typeof src !== "string") return null;
  const p = pathOf(src);
  if (p.endsWith(".riv")) return "rive";
  if (p.endsWith(".lottie") || p.endsWith(".json")) return "lottie";
  return null;
}

/**
 * Same rule as banner pictures (safeImageSrc): a site path ("/x.lottie", never
 * "//host") or a Supabase public-storage URL over https. Anything else — other
 * hosts, data:, javascript: — is refused, so a banner can only ever load files
 * we host.
 */
export function safeAnimSrc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 2048 || !animEngineFor(t)) return null;
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

/** Defensive read of stored settings. Null when the file isn't usable. Optional values are written only when set. */
export function normalizeAnim(raw: unknown): AnimSpec | null {
  if (!isObj(raw)) return null;
  const src = safeAnimSrc(raw.src);
  if (!src) return null;
  const engine = animEngineFor(src)!;
  const a: AnimSpec = { engine, src };
  const name = cleanText(raw.name, NAME_MAX)?.trim();
  if (name) a.name = name;
  if (typeof raw.ratio === "number" && Number.isFinite(raw.ratio) && raw.ratio > 0) a.ratio = Math.round(clamp(raw.ratio, 0.1, 10) * 1000) / 1000;
  const starts = ANIM_STARTS.map((s) => s.id);
  if (starts.includes(raw.start as AnimStart) && raw.start !== "auto" && !(raw.start === "scroll" && engine === "rive")) a.start = raw.start as AnimStart;
  // Speed / play-once / still % are Lottie timeline controls (Rive files own their timing in the state machine).
  if (raw.once === true && engine === "lottie") a.once = true;
  if (engine === "lottie" && typeof raw.speed === "number" && Number.isFinite(raw.speed) && raw.speed !== 1) a.speed = r2(clamp(raw.speed, ANIM_SPEED.min, ANIM_SPEED.max));
  if (typeof raw.delay === "number" && Number.isFinite(raw.delay) && raw.delay > 0) a.delay = r2(clamp(raw.delay, 0, ANIM_DELAY_MAX));
  if (raw.fit === "cover" || raw.fit === "fill") a.fit = raw.fit;
  if (ANIM_ALIGNS.some((x) => x.id === raw.align) && raw.align !== "center") a.align = raw.align as AnimAlign;
  if (raw.stillHide === true) a.stillHide = true;
  else if (engine === "lottie" && typeof raw.still === "number" && Number.isFinite(raw.still) && raw.still > 0) a.still = Math.round(clamp(raw.still, 0, 100));
  const alt = cleanText(raw.alt, ALT_MAX)?.trim();
  if (alt) a.alt = alt;

  if (engine === "lottie") {
    const anim = cleanName(raw.anim);
    if (anim) a.anim = anim;
    if (LOTTIE_MODES.some((m) => m.id === raw.mode) && raw.mode !== "forward") a.mode = raw.mode as LottieMode;
    const marker = cleanName(raw.marker);
    if (marker) a.marker = marker;
    else if (Array.isArray(raw.seg) && raw.seg.length === 2) {
      const [s, e] = raw.seg.map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(clamp(n, 0, 100000)) : NaN));
      if (Number.isFinite(s) && Number.isFinite(e) && e > s!) a.seg = [s!, e!];
    }
    const theme = cleanName(raw.theme);
    if (theme) a.theme = theme;
    const sm = cleanName(raw.sm);
    if (sm) a.sm = sm;
    const colors = cleanMap(raw.colors, hexVal);
    if (colors) a.colors = colors;
    const texts = cleanMap(raw.texts, (v) => cleanText(v));
    if (texts) a.texts = texts;
    const nums = cleanMap(raw.nums, numVal);
    if (nums) a.nums = nums;
  } else {
    const artboard = cleanName(raw.artboard);
    if (artboard) a.artboard = artboard;
    const machine = cleanName(raw.machine);
    if (machine) a.machine = machine;
    const inputs = cleanMap(raw.inputs, (v) => (typeof v === "boolean" ? v : numVal(v)));
    if (inputs) a.inputs = inputs;
    const vm = cleanMap(raw.vm, (v) => (typeof v === "boolean" ? v : typeof v === "number" ? numVal(v) : cleanText(v)));
    if (vm) a.vm = vm;
    const runs = cleanMap(raw.runs, (v) => cleanText(v));
    if (runs) a.runs = runs;
    const hi = cleanName(raw.hoverInput);
    if (hi && a.start === "hover") a.hoverInput = hi;
    const cf = cleanName(raw.clickFire);
    if (cf && a.start === "click") a.clickFire = cf;
    if (raw.interactive === true) a.interactive = true;
  }
  return a;
}

// ── Shared runtime helpers (pure) ────────────────────────────────────────────

/** dotLottie layout.align [x, y] (0–1) for an alignment. */
export function lottieAlign(a: AnimAlign | undefined): [number, number] {
  const k = a ?? "center";
  const x = /Left$|^left$/.test(k) ? 0 : /Right$|^right$/.test(k) ? 1 : 0.5;
  const y = /^top/.test(k) ? 0 : /^bottom/.test(k) ? 1 : 0.5;
  return [x, y];
}

/** Rive Alignment enum value for an alignment (rive.d.ts: "topCenter", "centerLeft", …). */
export function riveAlign(a: AnimAlign | undefined): string {
  const map: Record<AnimAlign, string> = {
    center: "center",
    top: "topCenter",
    bottom: "bottomCenter",
    left: "centerLeft",
    right: "centerRight",
    topLeft: "topLeft",
    topRight: "topRight",
    bottomLeft: "bottomLeft",
    bottomRight: "bottomRight",
  };
  return map[a ?? "center"];
}

/** "#rrggbb" → [r, g, b, 1] in 0–1 (dotLottie colour slot). */
export function hexToUnit(hex: string): [number, number, number, number] {
  const h = HEX.test(hex) ? hex.slice(1) : "000000";
  const c = (i: number) => r2(parseInt(h.slice(i, i + 2), 16) / 255);
  return [c(0), c(2), c(4), 1];
}
/** "#rrggbb" → [r, g, b] in 0–255 (Rive view-model colour .rgb()). */
export function hexToRgb(hex: string): [number, number, number] {
  const h = HEX.test(hex) ? hex.slice(1) : "000000";
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
/** Lottie colour slot value ([r,g,b(,a)] 0–1) → "#rrggbb" for the colour picker. */
export function unitToHex(v: unknown): string | null {
  if (!Array.isArray(v) || v.length < 3 || !v.slice(0, 3).every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return `#${(v.slice(0, 3) as number[]).map((n) => Math.round(clamp(n, 0, 1) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Scroll scrub: 0 when the box's top enters at the bottom of the screen, 1 when
 * its bottom leaves at the top. Pure so it is tested.
 */
export function scrollProgress(top: number, height: number, viewH: number): number {
  const span = viewH + height;
  if (!(span > 0)) return 0;
  return clamp((viewH - top) / span, 0, 1);
}

/** Frame to show for reduced motion (0–100 % of the playable range). */
export function stillFrame(a: AnimSpec, totalFrames: number): number {
  const [s, e] = a.seg ?? [0, Math.max(0, totalFrames - 1)];
  return Math.round(s + ((e - s) * (a.still ?? 0)) / 100);
}

/** Does it need pointer events on the public site? */
export function animWantsPointer(a: AnimSpec): boolean {
  return a.start === "hover" || a.start === "click" || !!a.interactive || !!a.sm;
}

/** Short Studio label, e.g. "Lottie — Leaf spin". */
export function animLabel(a: AnimSpec | undefined): string {
  if (!a) return "Animation";
  const file = a.name || decodeURIComponent(pathOf(a.src).split("/").pop() ?? "").replace(/^[0-9a-f]{8,}[-_]/i, "") || "file";
  return `${a.engine === "rive" ? "Rive" : "Lottie"} — ${file}`;
}

/** Where to find good free / paid animations (shown in the Studio). Verified sites. */
export const ANIM_SOURCES = [
  { label: "LottieFiles — free animations", url: "https://lottiefiles.com/free-animations", hint: "Download as dotLottie (.lottie) or Lottie JSON, then upload here." },
  { label: "Rive Marketplace — interactive", url: "https://rive.app/marketplace/", hint: "Remix, then export (Download → .riv) and upload here." },
  { label: "Rive editor — make your own", url: "https://rive.app/", hint: "Build state machines (hover, click, data binding) and export .riv." },
  { label: "Lottie Creator — make your own", url: "https://lottiefiles.com/lottie-creator", hint: "Design in the browser and export .lottie with themes + slots." },
] as const;

// ── Self-tests ───────────────────────────────────────────────────────────────

export function __runBannerAnimTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("banner-anim-core FAIL:", m);
    }
  };
  const J = JSON.stringify;
  const SB = "https://abc.supabase.co/storage/v1/object/public/media/banner/x";

  // engine + src
  ok(animEngineFor(`${SB}.riv`) === "rive" && animEngineFor(`${SB}.lottie`) === "lottie" && animEngineFor(`${SB}.JSON?v=2`) === "lottie", "engine by extension (query ignored, case-insensitive)");
  ok(animEngineFor(`${SB}.png`) === null && animEngineFor(42) === null, "non-animation refused");
  ok(safeAnimSrc(`${SB}.lottie`) === `${SB}.lottie` && safeAnimSrc("/brand/leaf.riv") === "/brand/leaf.riv", "our storage + site path ok");
  ok(safeAnimSrc("https://lottie.host/a/b.lottie") === null && safeAnimSrc("//evil.com/a.riv") === null, "other hosts refused");
  ok(safeAnimSrc("http://abc.supabase.co/storage/v1/object/public/m/a.riv") === null, "http refused");
  ok(safeAnimSrc("javascript:alert(1)//.json") === null && safeAnimSrc("data:application/json,{}.json") === null, "script/data refused");
  ok(safeAnimSrc("https://abc.supabase.co/storage/v1/object/sign/m/a.riv") === null, "private bucket path refused");

  // normalizer
  ok(normalizeAnim({ src: "nope" }) === null && normalizeAnim(null) === null, "bad src → null");
  const min = normalizeAnim({ src: `${SB}.lottie`, engine: "rive", start: "auto", speed: 1, fit: "contain", align: "center", delay: 0 });
  ok(J(min) === J({ engine: "lottie", src: `${SB}.lottie` }), "defaults not written; engine comes from the file, not the stored value");
  const l = normalizeAnim({
    src: `${SB}.lottie`,
    start: "scroll",
    speed: 9,
    delay: 99,
    mode: "bounce",
    seg: [10, 5],
    theme: "dark\u0000",
    colors: { bg: "#FF0000", bad: "red", __proto__x: "#000000" },
    texts: { t1: "Hi\u0007 there" },
    nums: { n: Infinity, m: 2.345 },
    artboard: "ignored for lottie",
  })!;
  ok(l.start === "scroll" && l.speed === 3 && l.delay === 10 && l.mode === "bounce", "lottie clamps");
  ok(l.seg === undefined, "backwards segment dropped");
  ok(l.theme === "dark" && l.colors?.bg === "#ff0000" && !("bad" in (l.colors ?? {})), "theme cleaned; colours hex-only");
  ok(l.texts?.t1 === "Hi there" && J(l.nums) === J({ m: 2.35 }), "texts cleaned; numbers finite");
  ok(!("artboard" in l), "rive fields never stored on lottie");
  ok(normalizeAnim({ src: `${SB}.json`, marker: "intro", seg: [0, 10] })!.seg === undefined, "marker wins over segment");
  ok(J(normalizeAnim({ src: `${SB}.json`, seg: [0, 10.4] })!.seg) === J([0, 10]), "segment rounded");
  const r = normalizeAnim({
    src: `${SB}.riv`,
    start: "scroll",
    artboard: "Truck",
    machine: "bumpy",
    inputs: { bump: true, level: 3, bad: "x" },
    vm: { title: "Sale", on: false, size: 2, tint: "#00FF00" },
    runs: { price: "$5" },
    hoverInput: "hovered",
    clickFire: "go",
    interactive: true,
    mode: "bounce",
  })!;
  ok(r.start === undefined, "scroll scrub is lottie-only");
  ok(r.artboard === "Truck" && r.machine === "bumpy" && J(r.inputs) === J({ bump: true, level: 3 }), "rive inputs");
  ok(J(r.vm) === J({ title: "Sale", on: false, size: 2, tint: "#00FF00" }) && r.runs?.price === "$5", "rive data binding + text runs");
  ok(r.hoverInput === undefined && r.clickFire === undefined, "hover/click names kept only with that start");
  ok(r.interactive === true && !("mode" in r), "interactive kept; lottie fields dropped");
  ok(normalizeAnim({ src: `${SB}.riv`, start: "hover", hoverInput: "h" })!.hoverInput === "h", "hover input kept");
  ok(normalizeAnim({ src: `${SB}.riv`, start: "click", clickFire: "go" })!.clickFire === "go", "click trigger kept");
  const many: Record<string, number> = {};
  for (let i = 0; i < 40; i++) many[`k${i}`] = i;
  ok(Object.keys(normalizeAnim({ src: `${SB}.riv`, inputs: many })!.inputs!).length === MAP_MAX, "maps capped");
  ok(normalizeAnim({ src: `${SB}.json`, still: 40, stillHide: true })!.still === undefined && normalizeAnim({ src: `${SB}.json`, still: 40 })!.still === 40, "hide wins over still");
  const rv = normalizeAnim({ src: `${SB}.riv`, speed: 2, once: true, still: 30 })!;
  ok(rv.speed === undefined && rv.once === undefined && rv.still === undefined, "speed/once/still are lottie-only");
  ok(normalizeAnim({ src: `${SB}.riv`, alt: "  Spinning leaf  " })!.alt === "Spinning leaf", "alt trimmed");
  ok(normalizeAnim({ src: `${SB}.riv`, ratio: 99 })!.ratio === 10 && normalizeAnim({ src: `${SB}.riv`, ratio: 1.33333 })!.ratio === 1.333 && normalizeAnim({ src: `${SB}.riv`, ratio: -1 })!.ratio === undefined, "ratio clamped");

  // helpers
  ok(J(lottieAlign(undefined)) === J([0.5, 0.5]) && J(lottieAlign("topLeft")) === J([0, 0]) && J(lottieAlign("right")) === J([1, 0.5]) && J(lottieAlign("bottom")) === J([0.5, 1]), "lottie align");
  ok(riveAlign("top") === "topCenter" && riveAlign("left") === "centerLeft" && riveAlign(undefined) === "center", "rive align");
  ok(J(hexToUnit("#ff8000")) === J([1, 0.5, 0, 1]) && J(hexToRgb("#ff8000")) === J([255, 128, 0]), "colour conversions");
  ok(unitToHex([1, 0.5, 0, 1]) === "#ff8000" && unitToHex("x") === null, "unit → hex");
  ok(scrollProgress(800, 200, 800) === 0 && scrollProgress(-200, 200, 800) === 1 && scrollProgress(300, 200, 800) === 0.5, "scroll progress");
  ok(stillFrame({ engine: "lottie", src: "/a.json", still: 50 }, 101) === 50 && stillFrame({ engine: "lottie", src: "/a.json", seg: [10, 20], still: 100 }, 99) === 20, "still frame");
  ok(animWantsPointer({ engine: "rive", src: "/a.riv", interactive: true }) && !animWantsPointer({ engine: "lottie", src: "/a.json" }), "pointer only when interactive");
  ok(animLabel({ engine: "rive", src: "/x/1a2b3c4d5e6f7a8b-truck.riv" }) === "Rive — truck.riv" && animLabel({ engine: "lottie", src: "/a.json", name: "Leaf" }) === "Lottie — Leaf", "labels");
  ok(cleanName(" a\u0001b ") === "ab" && cleanName(5) === "", "names cleaned");
  return { passed, failed };
}
