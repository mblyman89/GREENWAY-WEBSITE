/**
 * R64 — the Brand hub's data: ONE "richjson" content block (`brand.kit`, JSON
 * in the plain text column, so no migration) that holds everything about the
 * brand in one place:
 *
 *   • colours   — the six site palette tokens (globals.css :root). Only the
 *                 ones that DIFFER from the shipped values are written to the
 *                 page, so a blank / untouched kit is byte-identical.
 *   • logos     — the header wordmark (applied site-wide) + a library of
 *                 brand logos (main / transparent / icon / extra) to reuse.
 *   • messaging — tagline, slogans, mission, vision, about-us (short + long),
 *                 elevator pitch, brand voice, keywords.
 *   • banners   — saved Design Studio banners, reusable from every banner /
 *                 card editor ("Start from a saved brand banner").
 *   • social    — social / review profile links.
 *   • notes     — brand guidelines (do / don't).
 *
 * Pure (no IO). Fonts stay in their own two `site.font.*` blocks.
 */
import { normalizeDesign, type BannerDesign } from "@/lib/cms/banner-design-core";
import { colorToHex } from "@/lib/cms/color-input-core";

export const BRAND_KIT_BLOCK = "brand.kit";

// ── Colours ─────────────────────────────────────────────────────────────────

export type BrandColorKey = "greenway" | "greenwayDark" | "gold" | "orange" | "charcoal" | "frost";

/** The shipped palette — values read from src/app/globals.css :root. */
export const BRAND_COLOR_TOKENS: { key: BrandColorKey; cssVar: string; label: string; hint: string; def: string }[] = [
  { key: "greenway", cssVar: "--greenway", label: "Brand green", hint: "Links, highlights, accents", def: "#7ed957" },
  { key: "greenwayDark", cssVar: "--greenway-dark", label: "Deep green", hint: "Dark green panels", def: "#12351f" },
  { key: "gold", cssVar: "--gold", label: "Gold", hint: "Borders, badges, premium touches", def: "#ffd700" },
  { key: "orange", cssVar: "--orange", label: "Orange", hint: "Headings, buttons, call-outs", def: "#ff7f00" },
  { key: "charcoal", cssVar: "--charcoal", label: "Charcoal", hint: "Card and section backgrounds", def: "#1a1a1a" },
  { key: "frost", cssVar: "--frost", label: "Frost", hint: "Soft light-gray text", def: "#d1d5db" },
];

export type BrandColors = Record<BrandColorKey, string>;

export function defaultBrandColors(): BrandColors {
  return Object.fromEntries(BRAND_COLOR_TOKENS.map((t) => [t.key, t.def])) as BrandColors;
}

/** One-tap palettes. "Greenway classic" is the shipped look. */
export const BRAND_COLOR_PRESETS: { id: string; name: string; colors: BrandColors }[] = [
  { id: "classic", name: "Greenway classic", colors: defaultBrandColors() },
  { id: "forest", name: "Deep forest", colors: { greenway: "#4caf50", greenwayDark: "#0b2416", gold: "#e3b341", orange: "#e8742a", charcoal: "#141a16", frost: "#cfd8d3" } },
  { id: "neon", name: "Neon night", colors: { greenway: "#39ff14", greenwayDark: "#0a2a12", gold: "#fff200", orange: "#ff5f1f", charcoal: "#0f0f12", frost: "#e5e7eb" } },
  { id: "earth", name: "Earth & clay", colors: { greenway: "#8fbf5a", greenwayDark: "#2d3a1f", gold: "#d4a24c", orange: "#c8622d", charcoal: "#1f1a17", frost: "#d9d2c5" } },
  { id: "royal", name: "Royal gold", colors: { greenway: "#6fcf97", greenwayDark: "#102a1e", gold: "#f5c542", orange: "#f2994a", charcoal: "#16161d", frost: "#d6d6e0" } },
  { id: "pastel", name: "Soft pastel", colors: { greenway: "#9be3a8", greenwayDark: "#24453a", gold: "#f6e27f", orange: "#f7a072", charcoal: "#20232a", frost: "#e4e7ec" } },
  { id: "mono", name: "Monochrome", colors: { greenway: "#e5e5e5", greenwayDark: "#262626", gold: "#ffffff", orange: "#a3a3a3", charcoal: "#171717", frost: "#d4d4d4" } },
];

// ── Everything else ─────────────────────────────────────────────────────────

export type BrandLogo = { id: string; name: string; src: string; note: string };
export type BrandSaved = { id: string; name: string; image: string; design: BannerDesign };
export type BrandLink = { id: string; label: string; url: string };

export type BrandKit = {
  colors: BrandColors;
  /** Header wordmark override ("" = the shipped wordmark). */
  headerLogo: string;
  logos: BrandLogo[];
  tagline: string;
  slogans: string[];
  mission: string;
  vision: string;
  aboutShort: string;
  aboutLong: string;
  pitch: string;
  voice: string;
  keywords: string;
  banners: BrandSaved[];
  social: BrandLink[];
  doNotes: string;
  dontNotes: string;
};

export const BRAND_MAX_LOGOS = 12;
export const BRAND_MAX_SLOGANS = 20;
export const BRAND_MAX_BANNERS = 24;
export const BRAND_MAX_LINKS = 12;

export const SHIPPED_HEADER_LOGO = "/brand/greenway-marijuana-wordmark-transparent.png";

export function defaultBrandKit(): BrandKit {
  return {
    colors: defaultBrandColors(),
    headerLogo: "",
    logos: [
      { id: "wordmark", name: "Wordmark (header)", src: SHIPPED_HEADER_LOGO, note: "Transparent wordmark used in the site header." },
      { id: "black-gold", name: "Black & gold logo", src: "/brand/greenway-black-gold-logo.png", note: "Square logo on black." },
      { id: "black-gold-t", name: "Black & gold logo (transparent)", src: "/brand/greenway-black-gold-logo-transparent.png", note: "Square logo, no background." },
    ],
    tagline: "",
    slogans: [],
    mission: "",
    vision: "",
    aboutShort: "",
    aboutLong: "",
    pitch: "",
    voice: "",
    keywords: "",
    banners: [],
    social: [],
    doNotes: "",
    dontNotes: "",
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const id = (v: unknown, fb: string): string => (typeof v === "string" && /^[\w-]{1,60}$/.test(v) ? v : fb);
/** Only site paths or https links (never javascript:, data:, //host). */
export function safeBrandSrc(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return /^(\/(?!\/)|https:\/\/)/.test(s) ? s.slice(0, 500) : "";
}

export function normalizeBrandKit(raw: unknown): BrandKit {
  const d = defaultBrandKit();
  if (!isObj(raw)) return d;
  const colors = { ...d.colors };
  if (isObj(raw.colors)) {
    for (const t of BRAND_COLOR_TOKENS) {
      const hex = colorToHex(raw.colors[t.key]);
      if (hex) colors[t.key] = hex;
    }
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    colors,
    headerLogo: safeBrandSrc(raw.headerLogo),
    logos: Array.isArray(raw.logos)
      ? arr(raw.logos)
          .filter(isObj)
          .map((l, i) => ({ id: id(l.id, `l${i}`), name: str(l.name, 80), src: safeBrandSrc(l.src), note: str(l.note, 300) }))
          .filter((l) => l.src)
          .slice(0, BRAND_MAX_LOGOS)
      : d.logos,
    tagline: str(raw.tagline, 200),
    slogans: arr(raw.slogans)
      .map((s) => str(s, 200).trim())
      .filter(Boolean)
      .slice(0, BRAND_MAX_SLOGANS),
    mission: str(raw.mission, 2000),
    vision: str(raw.vision, 2000),
    aboutShort: str(raw.aboutShort, 600),
    aboutLong: str(raw.aboutLong, 6000),
    pitch: str(raw.pitch, 1000),
    voice: str(raw.voice, 2000),
    keywords: str(raw.keywords, 600),
    banners: arr(raw.banners)
      .filter(isObj)
      .map((b, i) => {
        const design = normalizeDesign(b.design);
        return design ? { id: id(b.id, `b${i}`), name: str(b.name, 80) || `Banner ${i + 1}`, image: safeBrandSrc(b.image), design } : null;
      })
      .filter((b): b is BrandSaved => !!b)
      .slice(0, BRAND_MAX_BANNERS),
    social: arr(raw.social)
      .filter(isObj)
      .map((l, i) => ({ id: id(l.id, `s${i}`), label: str(l.label, 60), url: /^https:\/\//.test(String(l.url ?? "").trim()) ? String(l.url).trim().slice(0, 500) : "" }))
      .filter((l) => l.url)
      .slice(0, BRAND_MAX_LINKS),
    doNotes: str(raw.doNotes, 3000),
    dontNotes: str(raw.dontNotes, 3000),
  };
}

export function parseBrandKit(raw: string | null | undefined): BrandKit {
  if (!raw || !raw.trim()) return defaultBrandKit();
  try {
    return normalizeBrandKit(JSON.parse(raw));
  } catch {
    return defaultBrandKit();
  }
}

export function serializeBrandKit(k: BrandKit): string {
  return JSON.stringify(k);
}

/**
 * The CSS custom properties to put on <html> — ONLY the colours that differ
 * from the shipped palette (empty object = nothing changes).
 */
export function brandColorVars(k: BrandKit): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of BRAND_COLOR_TOKENS) {
    const v = k.colors[t.key];
    if (v && v.toLowerCase() !== t.def) out[t.cssVar] = v;
  }
  return out;
}

/** The header wordmark to show (override, else the shipped file). */
export function brandHeaderLogo(k: BrandKit): string {
  return k.headerLogo || SHIPPED_HEADER_LOGO;
}

// ── Colour maths for the wheel (HSV ⇄ hex) ─────────────────────────────────

export function hsvToHex(h: number, s: number, v: number): string {
  const H = (((h % 360) + 360) % 360) / 60;
  const S = Math.min(1, Math.max(0, s));
  const V = Math.min(1, Math.max(0, v));
  const c = V * S;
  const x = c * (1 - Math.abs((H % 2) - 1));
  const m = V - c;
  const [r, g, b] = H < 1 ? [c, x, 0] : H < 2 ? [x, c, 0] : H < 3 ? [0, c, x] : H < 4 ? [0, x, c] : H < 5 ? [x, 0, c] : [c, 0, x];
  const h2 = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${h2(r)}${h2(g)}${h2(b)}`;
}

export function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = colorToHex(hex) ?? "#000000";
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
}

/** Readable text colour (black / white) for a swatch. */
export function contrastText(hex: string): "#000000" | "#ffffff" {
  const n = colorToHex(hex) ?? "#000000";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? "#000000" : "#ffffff";
}

export function __runBrandKitCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (c: boolean, m: string) => {
    if (!c) throw new Error("brand-kit-core: " + m);
    passed += 1;
  };
  const d = parseBrandKit("");
  ok(Object.keys(brandColorVars(d)).length === 0, "blank kit → no colour overrides");
  ok(brandHeaderLogo(d) === SHIPPED_HEADER_LOGO, "blank kit → shipped wordmark");
  ok(parseBrandKit("{bad").logos.length === 3, "bad json → defaults");
  const k = normalizeBrandKit({ colors: { gold: "#ABCDEF", orange: "nope" }, headerLogo: "javascript:x", social: [{ url: "http://x" }], slogans: [" A ", ""] });
  ok(brandColorVars(k)["--gold"] === "#abcdef" && !("--orange" in brandColorVars(k)), "only changed, valid colours");
  ok(k.headerLogo === "" && k.social.length === 0 && k.slogans.length === 1 && k.slogans[0] === "A", "unsafe dropped, slogans trimmed");
  ok(hsvToHex(0, 1, 1) === "#ff0000" && hsvToHex(120, 1, 1) === "#00ff00", "hsv → hex");
  const hsv = hexToHsv("#7ed957");
  ok(hsvToHex(hsv.h, hsv.s, hsv.v) === "#7ed957", "hex ⇄ hsv round trip");
  ok(contrastText("#ffd700") === "#000000" && contrastText("#12351f") === "#ffffff", "contrast text");
  ok(BRAND_COLOR_PRESETS[0].colors.gold === "#ffd700", "classic preset = shipped");
  return { passed };
}
