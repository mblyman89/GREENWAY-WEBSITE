/**
 * R59-S1 — professional picture tools for the Banner Studio (pure + testable).
 *
 * Everything is real-time, non-destructive CSS: the original upload is never
 * changed, so any look can be undone, and the same rules render identically in
 * the Studio and on the site (and on video banners too).
 *
 *   Adjust      contrast, hue shift, sepia, warmth (soft-light colour grade),
 *               picture see-through over a chosen backdrop colour, flip ↕
 *   Colour      tint/grade layer with a Photoshop-style blend mode
 *               duotone (grayscale × light via multiply, then lighten dark —
 *               the standard two-layer CSS duotone)
 *   Finish      vignette (colour + strength), film grain (SVG feTurbulence),
 *               fade an edge into the backdrop (CSS mask)
 *   Motion      Ken Burns slow zoom / pan (pure CSS, pauses on hidden carousel
 *               slides, off for reduced motion)
 *   Looks       one-click presets (Vivid, Noir, Vintage, Neon duotone …)
 *
 * Stored on `design.image.fx`, and only the keys that are used — banners that
 * don't use the tools stay byte-identical.
 */

export type ImageBlend =
  | "multiply" | "screen" | "overlay" | "soft-light" | "hard-light" | "color"
  | "color-dodge" | "color-burn" | "hue" | "luminosity" | "darken" | "lighten";
export const IMAGE_BLENDS: { id: ImageBlend; label: string; hint: string }[] = [
  { id: "soft-light", label: "Soft light", hint: "Gentle colour grade" },
  { id: "overlay", label: "Overlay", hint: "Punchy colour grade" },
  { id: "color", label: "Colour", hint: "Recolour, keep the light and shadow" },
  { id: "multiply", label: "Multiply", hint: "Darkens with the colour" },
  { id: "screen", label: "Screen", hint: "Lightens with the colour" },
  { id: "lighten", label: "Lift blacks", hint: "Matte / faded film" },
  { id: "darken", label: "Darken", hint: "Only darkens bright parts" },
  { id: "hard-light", label: "Hard light", hint: "Strong, contrasty grade" },
  { id: "color-dodge", label: "Glow (dodge)", hint: "Bright glowing highlights" },
  { id: "color-burn", label: "Burn", hint: "Deep, rich shadows" },
  { id: "hue", label: "Hue", hint: "Shift colours to the tint" },
  { id: "luminosity", label: "Luminosity", hint: "Brightness from the tint" },
];
const BLEND_IDS = IMAGE_BLENDS.map((b) => b.id);

export type FadeEdge = "left" | "right" | "top" | "bottom" | "sides" | "all";
export const FADE_EDGES: { id: FadeEdge; label: string }[] = [
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "sides", label: "Both sides" },
  { id: "all", label: "All round" },
];
const FADE_IDS = FADE_EDGES.map((f) => f.id);

export type KenBurns = "in" | "out" | "left" | "right" | "up";
export const KEN_BURNS: { id: KenBurns; label: string }[] = [
  { id: "in", label: "Slow zoom in" },
  { id: "out", label: "Slow zoom out" },
  { id: "left", label: "Pan left" },
  { id: "right", label: "Pan right" },
  { id: "up", label: "Drift up" },
];
const KB_IDS = KEN_BURNS.map((k) => k.id);

export type ImageFx = {
  contrast?: number; // 50–200 (100 = as shot)
  hue?: number; // −180…180°
  sepia?: number; // 0–100
  warmth?: number; // −100 (cool) … 100 (warm)
  opacity?: number; // 10–100 picture see-through
  bg?: string; // backdrop colour behind the picture (#rrggbb)
  flipY?: true;
  tint?: { color: string; blend: ImageBlend; amount: number };
  duo?: { dark: string; light: string };
  vignette?: number; // 0–100
  vignetteColor?: string;
  grain?: number; // 0–100
  fade?: { edge: FadeEdge; amount: number }; // amount 5–70 (% of the banner)
  kb?: KenBurns;
  kbSpeed?: "slow" | "fast";
};

type StyleMap = Record<string, string>;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const clamp = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : null;
};
const hex = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
};
const rgba = (h: string, a: number) => {
  const n = parseInt(h.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 1000) / 1000})`;
};

/** Keep only valid, non-neutral settings; undefined when nothing is used. */
export function normalizeImageFx(raw: unknown): ImageFx | undefined {
  if (!isObj(raw)) return undefined;
  const fx: ImageFx = {};
  const c = clamp(raw.contrast, 50, 200);
  if (c !== null && c !== 100) fx.contrast = c;
  const h = clamp(raw.hue, -180, 180);
  if (h) fx.hue = h;
  const s = clamp(raw.sepia, 0, 100);
  if (s) fx.sepia = s;
  const w = clamp(raw.warmth, -100, 100);
  if (w) fx.warmth = w;
  const o = clamp(raw.opacity, 10, 100);
  if (o !== null && o !== 100) fx.opacity = o;
  const bg = hex(raw.bg);
  if (bg) fx.bg = bg;
  if (raw.flipY === true) fx.flipY = true;
  if (isObj(raw.tint)) {
    const color = hex(raw.tint.color);
    const amount = clamp(raw.tint.amount, 0, 100);
    const blend = typeof raw.tint.blend === "string" && (BLEND_IDS as string[]).includes(raw.tint.blend) ? (raw.tint.blend as ImageBlend) : "soft-light";
    if (color && amount) fx.tint = { color, blend, amount };
  }
  if (isObj(raw.duo)) {
    const dark = hex(raw.duo.dark);
    const light = hex(raw.duo.light);
    if (dark && light) fx.duo = { dark, light };
  }
  const v = clamp(raw.vignette, 0, 100);
  if (v) {
    fx.vignette = v;
    const vc = hex(raw.vignetteColor);
    if (vc && vc !== "#000000") fx.vignetteColor = vc;
  }
  const g = clamp(raw.grain, 0, 100);
  if (g) fx.grain = g;
  if (isObj(raw.fade) && typeof raw.fade.edge === "string" && (FADE_IDS as string[]).includes(raw.fade.edge)) {
    const amount = clamp(raw.fade.amount, 5, 70);
    if (amount) fx.fade = { edge: raw.fade.edge as FadeEdge, amount };
  }
  if (typeof raw.kb === "string" && (KB_IDS as string[]).includes(raw.kb)) {
    fx.kb = raw.kb as KenBurns;
    if (raw.kbSpeed === "slow" || raw.kbSpeed === "fast") fx.kbSpeed = raw.kbSpeed;
  }
  return Object.keys(fx).length ? fx : undefined;
}

/** Extra CSS filter functions for the picture (appended to brightness/saturate/blur). */
export function imageFxFilters(fx: ImageFx | undefined): string[] {
  if (!fx) return [];
  const f: string[] = [];
  if (fx.duo) f.push("grayscale(1)");
  if (fx.contrast) f.push(`contrast(${fx.contrast / 100})`);
  if (fx.hue) f.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.sepia) f.push(`sepia(${fx.sepia / 100})`);
  if (fx.opacity) f.push(`opacity(${fx.opacity / 100})`);
  return f;
}

/** Film grain: a tiny tiling SVG noise (feTurbulence) — no image download. */
const GRAIN_URL =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1.4 -.2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

/** Colour-grade + finishing layers painted over the picture (back → front). */
export function imageFxLayers(fx: ImageFx | undefined): { key: string; style: StyleMap }[] {
  if (!fx) return [];
  const base = { position: "absolute", inset: "0", pointerEvents: "none" };
  const out: { key: string; style: StyleMap }[] = [];
  if (fx.warmth) {
    out.push({
      key: "warmth",
      style: { ...base, background: fx.warmth > 0 ? "#ff8a2a" : "#2a7bff", mixBlendMode: "soft-light", opacity: String(Math.round((Math.abs(fx.warmth) / 100) * 0.7 * 1000) / 1000) },
    });
  }
  if (fx.duo) {
    out.push({ key: "duo-light", style: { ...base, background: fx.duo.light, mixBlendMode: "multiply" } });
    out.push({ key: "duo-dark", style: { ...base, background: fx.duo.dark, mixBlendMode: "lighten" } });
  }
  if (fx.tint) out.push({ key: "tint", style: { ...base, background: fx.tint.color, mixBlendMode: fx.tint.blend, opacity: String(fx.tint.amount / 100) } });
  if (fx.grain) {
    out.push({ key: "grain", style: { ...base, backgroundImage: GRAIN_URL, backgroundSize: "180px 180px", mixBlendMode: "overlay", opacity: String(Math.round((fx.grain / 100) * 0.55 * 1000) / 1000) } });
  }
  if (fx.vignette) {
    const inner = Math.round(72 - fx.vignette * 0.42);
    out.push({
      key: "vignette",
      style: { ...base, background: `radial-gradient(ellipse at center, transparent ${inner}%, ${rgba(fx.vignetteColor ?? "#000000", Math.min(1, 0.25 + fx.vignette / 110))} 100%)` },
    });
  }
  return out;
}

/** Mask for the picture wrapper so an edge fades into the backdrop colour. */
export function imageFadeMask(fx: ImageFx | undefined): StyleMap {
  const f = fx?.fade;
  if (!f) return {};
  const a = f.amount;
  const lin = (dir: string) => `linear-gradient(${dir}, transparent 0%, #000 ${a}%)`;
  const m =
    f.edge === "left"
      ? lin("to right")
      : f.edge === "right"
        ? lin("to left")
        : f.edge === "top"
          ? lin("to bottom")
          : f.edge === "bottom"
            ? lin("to top")
            : f.edge === "sides"
              ? `linear-gradient(to right, transparent 0%, #000 ${a / 2}%, #000 ${100 - a / 2}%, transparent 100%)`
              : `radial-gradient(ellipse at center, #000 ${100 - a - 10}%, transparent 100%)`;
  return { maskImage: m, WebkitMaskImage: m };
}

/** Classes + vars for the Ken Burns wrapper ("" when off). */
export function kenBurns(fx: ImageFx | undefined): { className: string; style: StyleMap } {
  if (!fx?.kb) return { className: "", style: {} };
  return { className: `gw-m gw-kb gw-kb-${fx.kb}`, style: fx.kbSpeed ? { "--gms": fx.kbSpeed === "slow" ? "1.8" : "0.5" } : {} };
}

// ── Looks (one-click presets) ──────────────────────────────────────────────

/** Keys a Look owns (layout keys — see-through, backdrop, flip, fade, motion — are kept). */
const LOOK_KEYS: (keyof ImageFx)[] = ["contrast", "hue", "sepia", "warmth", "tint", "duo", "vignette", "vignetteColor", "grain"];
export type ImageLook = { id: string; label: string; brightness?: number; saturation?: number; fx: ImageFx };
export const IMAGE_LOOKS: ImageLook[] = [
  { id: "original", label: "Original", fx: {} },
  { id: "vivid", label: "Vivid", brightness: 105, saturation: 140, fx: { contrast: 115 } },
  { id: "warm", label: "Golden hour", saturation: 110, fx: { warmth: 50, contrast: 105 } },
  { id: "cool", label: "Cool", brightness: 96, fx: { warmth: -45 } },
  { id: "dramatic", label: "Dramatic", brightness: 90, saturation: 110, fx: { contrast: 140, vignette: 60 } },
  { id: "noir", label: "Noir", saturation: 0, fx: { contrast: 135, vignette: 45, grain: 20 } },
  { id: "vintage", label: "Vintage", saturation: 85, fx: { sepia: 35, contrast: 90, warmth: 20, vignette: 30, grain: 25 } },
  { id: "matte", label: "Faded film", brightness: 108, saturation: 80, fx: { contrast: 82, tint: { color: "#3a2f55", blend: "lighten", amount: 45 }, grain: 15 } },
  { id: "dreamy", label: "Dreamy", brightness: 110, saturation: 115, fx: { warmth: 10, tint: { color: "#ff9ad5", blend: "soft-light", amount: 40 } } },
  { id: "night", label: "Midnight", brightness: 82, fx: { warmth: -30, tint: { color: "#0b1d51", blend: "multiply", amount: 40 }, vignette: 40 } },
  { id: "psy", label: "Psychedelic", saturation: 180, fx: { hue: 90, contrast: 110 } },
  { id: "neon", label: "Neon duotone", fx: { duo: { dark: "#2b0a3d", light: "#ff3ea5" }, contrast: 110 } },
  { id: "green", label: "Greenway duotone", fx: { duo: { dark: "#0b2015", light: "#7ed957" }, contrast: 110 } },
  { id: "sunset", label: "Sunset duotone", fx: { duo: { dark: "#3a0ca3", light: "#ffb703" } } },
];

/** Apply a Look: sets brightness/saturation + the look keys, keeps layout keys. */
export function applyLook<T extends { brightness: number; saturation: number; fx?: ImageFx }>(image: T, look: ImageLook): T {
  const kept: ImageFx = { ...(image.fx ?? {}) };
  for (const k of LOOK_KEYS) delete kept[k];
  const fx = normalizeImageFx({ ...kept, ...look.fx });
  const next = { ...image, brightness: look.brightness ?? 100, saturation: look.saturation ?? 100 };
  if (fx) next.fx = fx;
  else delete next.fx;
  return next;
}

/** Which Look the image currently matches (null = custom). */
export function currentLook(image: { brightness: number; saturation: number; fx?: ImageFx }): string | null {
  const pick = (fx: ImageFx | undefined) => JSON.stringify(Object.fromEntries(LOOK_KEYS.filter((k) => fx?.[k] !== undefined).map((k) => [k, fx![k]])));
  const mine = pick(image.fx);
  const hit = IMAGE_LOOKS.find((l) => (l.brightness ?? 100) === image.brightness && (l.saturation ?? 100) === image.saturation && pick(normalizeImageFx(l.fx)) === mine);
  return hit?.id ?? null;
}

// ── Self-tests ─────────────────────────────────────────────────────────────

export function __runBannerImageTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`  ✗ banner-image: ${m}`);
    }
  };
  ok(normalizeImageFx(undefined) === undefined && normalizeImageFx({}) === undefined, "nothing set → undefined");
  ok(normalizeImageFx({ contrast: 100, opacity: 100, hue: 0 }) === undefined, "neutral values dropped");
  const n = normalizeImageFx({ contrast: 999, hue: -999, sepia: "x", tint: { color: "#F0A", amount: 40, blend: "bogus" }, duo: { dark: "#000" }, kb: "spin" })!;
  ok(n.contrast === 200 && n.hue === -180 && n.sepia === undefined, "clamped + junk dropped");
  ok(n.tint?.color === "#ff00aa" && n.tint.blend === "soft-light", "tint hex expanded, blend defaulted");
  ok(n.duo === undefined && n.kb === undefined, "half duotone + bad motion dropped");
  ok(imageFxFilters({ duo: { dark: "#000000", light: "#ffffff" }, contrast: 120 }).join(" ") === "grayscale(1) contrast(1.2)", "duotone forces grayscale first");
  const L = imageFxLayers({ warmth: -50, duo: { dark: "#111111", light: "#eeeeee" }, vignette: 50 });
  ok(L.map((l) => l.key).join() === "warmth,duo-light,duo-dark,vignette", "layer order");
  ok(imageFxLayers({ grain: 50 })[0].style.backgroundImage.startsWith("url(\"data:image/svg+xml"), "grain is inline svg");
  ok(L[0].style.background === "#2a7bff" && L[1].style.mixBlendMode === "multiply" && L[2].style.mixBlendMode === "lighten", "duotone blend pair");
  ok(imageFadeMask({ fade: { edge: "left", amount: 30 } }).maskImage === "linear-gradient(to right, transparent 0%, #000 30%)", "fade mask");
  ok(Object.keys(imageFadeMask(undefined)).length === 0, "no mask when off");
  ok(kenBurns({ kb: "in", kbSpeed: "slow" }).className === "gw-m gw-kb gw-kb-in" && kenBurns({ kb: "in", kbSpeed: "slow" }).style["--gms"] === "1.8", "ken burns");
  const img: { brightness: number; saturation: number; fx?: ImageFx } = { brightness: 100, saturation: 100, fx: { opacity: 60, kb: "in", contrast: 150 } };
  const noir = applyLook(img, IMAGE_LOOKS.find((l) => l.id === "noir")!);
  ok(noir.saturation === 0 && noir.fx?.opacity === 60 && noir.fx?.kb === "in" && noir.fx?.contrast === 135, "look keeps layout keys, replaces look keys");
  ok(currentLook(noir) === "noir", "current look detected");
  const orig = applyLook(noir, IMAGE_LOOKS[0]);
  ok(orig.brightness === 100 && orig.fx?.grain === undefined && orig.fx?.opacity === 60 && currentLook(orig) === "original", "original resets look only");
  const sorted = (o: unknown): string => JSON.stringify(o, (_k, v) => (isObj(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
  ok(IMAGE_LOOKS.every((l) => sorted(normalizeImageFx(l.fx) ?? {}) === sorted(l.fx)), "every look is already normalized");
  return { passed, failed };
}
