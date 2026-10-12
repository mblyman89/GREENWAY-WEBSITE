/**
 * src/lib/cms/home-slide-advanced-core.ts — R47 (owner request): the HOME page
 * carousel gets the same advanced options the Shop / Loyalty banners have.
 *
 * Each home slide keeps its classic columns (image, eyebrow, title,
 * description, buttons…) as the WORDS and the basic look. The optional
 * "advanced" JSON (migration 0268: home_carousel_slides.advanced +
 * draft_advanced, both nullable) adds:
 *
 *   • per-line style for eyebrow / title / description: font, colour, show,
 *     cursive size (same font + colour menus as the Shop banner)
 *   • a separate phone picture + its own picture focus (5 positions)
 *   • 5-position desktop picture focus (classic only had left/center/right)
 *   • text Left / Center / Right and Top / Middle / Bottom
 *   • an optional Start / End show window
 *   • the Banner Studio custom design (drag text/buttons, extra boxes, tint…)
 *
 * Blank font / colour ("") means "classic look" so a slide with advanced
 * options but no style changes renders exactly like before. A slide whose
 * advanced value is NULL never goes through any of this (byte-identical).
 *
 * PURE — no React, no IO. Self-tests registered in run-pure-selftests.ts.
 */
import {
  IMAGE_FOCUSES,
  TEXT_ALIGNS,
  TEXT_VALIGNS,
  clampScriptScale,
  isHeroColor,
  isHeroFont,
  isImageFocus,
  isTextAlign,
  isTextVAlign,
  type ImageFocus,
  type TextAlign,
  type TextVAlign,
} from "@/lib/loyalty/loyalty-hero-core";
import { normalizeDesign, type BannerDesign } from "./banner-design-core";

export { IMAGE_FOCUSES, TEXT_ALIGNS, TEXT_VALIGNS };

/** Style for one of the three text lines. "" = classic look. */
export type HomeLineStyle = {
  /** Hero font id (HERO_FONTS) or "" for the classic site heading font. */
  font: string;
  /** Hero colour id (HERO_COLORS) or "" for the classic colour. */
  color: string;
  /** false hides the line without losing its words. */
  show: boolean;
  /** Cursive size bump (1.0–2.0); only used with a script font. */
  scriptScale: number;
};

export type HomeSlideAdvanced = {
  eyebrow: HomeLineStyle;
  title: HomeLineStyle;
  description: HomeLineStyle;
  /** Optional phone picture ("" = use the main picture). */
  imageMobile: string;
  /** null = follow the classic image_focus column. */
  imageFocus: ImageFocus | null;
  /** null = same as the desktop focus. */
  imageFocusMobile: ImageFocus | null;
  /** null = follow the classic text_align column (left/right). */
  textAlign: TextAlign | null;
  verticalAlign: TextVAlign;
  /** ISO strings; null = open. */
  scheduleStart: string | null;
  scheduleEnd: string | null;
  /** Banner Studio design; only used when design.enabled. */
  design?: BannerDesign | null;
};

export function defaultLineStyle(): HomeLineStyle {
  return { font: "", color: "", show: true, scriptScale: 1 };
}

export function defaultHomeSlideAdvanced(): HomeSlideAdvanced {
  return {
    eyebrow: defaultLineStyle(),
    title: defaultLineStyle(),
    description: defaultLineStyle(),
    imageMobile: "",
    imageFocus: null,
    imageFocusMobile: null,
    textAlign: null,
    verticalAlign: "center",
    scheduleStart: null,
    scheduleEnd: null,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function normalizeLine(raw: unknown): HomeLineStyle {
  const d = defaultLineStyle();
  if (!isObj(raw)) return d;
  return {
    font: isHeroFont(raw.font) ? (raw.font as string) : "",
    color: isHeroColor(raw.color) ? (raw.color as string) : "",
    show: typeof raw.show === "boolean" ? raw.show : true,
    scriptScale: raw.scriptScale === undefined ? 1 : clampScriptScale(raw.scriptScale),
  };
}

function cleanIso(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || !Number.isFinite(Date.parse(t))) return null;
  return t;
}

/** Same rule as the Shop banner picture fields: a site path or an https URL. */
function cleanImage(v: unknown): string {
  if (typeof v !== "string") return "";
  const t = v.trim().slice(0, 2000);
  if (!t) return "";
  if (t.startsWith("/") && !t.startsWith("//")) return t;
  if (/^https:\/\//i.test(t)) return t;
  return "";
}

/** Coerce anything into a valid advanced value; null/garbage → null (classic). */
export function normalizeHomeSlideAdvanced(raw: unknown): HomeSlideAdvanced | null {
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(raw)) return null;
  const design = normalizeDesign(raw.design);
  return {
    eyebrow: normalizeLine(raw.eyebrow),
    title: normalizeLine(raw.title),
    description: normalizeLine(raw.description),
    imageMobile: cleanImage(raw.imageMobile),
    imageFocus: isImageFocus(raw.imageFocus) ? raw.imageFocus : null,
    imageFocusMobile: isImageFocus(raw.imageFocusMobile) ? raw.imageFocusMobile : null,
    textAlign: isTextAlign(raw.textAlign) ? raw.textAlign : null,
    verticalAlign: isTextVAlign(raw.verticalAlign) ? raw.verticalAlign : "center",
    scheduleStart: cleanIso(raw.scheduleStart),
    scheduleEnd: cleanIso(raw.scheduleEnd),
    ...(design ? { design } : {}),
  };
}

/** Stable JSON (fixed key order) for storage + dirty checks. */
export function serializeHomeSlideAdvanced(a: HomeSlideAdvanced | null): string | null {
  const n = a ? normalizeHomeSlideAdvanced(a) : null;
  if (!n) return null;
  const line = (l: HomeLineStyle) => ({ font: l.font, color: l.color, show: l.show, scriptScale: l.scriptScale });
  return JSON.stringify({
    eyebrow: line(n.eyebrow),
    title: line(n.title),
    description: line(n.description),
    imageMobile: n.imageMobile,
    imageFocus: n.imageFocus,
    imageFocusMobile: n.imageFocusMobile,
    textAlign: n.textAlign,
    verticalAlign: n.verticalAlign,
    scheduleStart: n.scheduleStart,
    scheduleEnd: n.scheduleEnd,
    ...(n.design ? { design: n.design } : {}),
  });
}

/** True when the advanced value changes nothing vs. the classic slide. */
export function isClassicEquivalent(a: HomeSlideAdvanced | null): boolean {
  if (!a) return true;
  return serializeHomeSlideAdvanced(a) === serializeHomeSlideAdvanced(defaultHomeSlideAdvanced());
}

/** Is the slide inside its optional Start/End window? Bad dates = open. */
export function isHomeSlideLiveAt(a: HomeSlideAdvanced | null | undefined, whenMs: number): boolean {
  if (!a) return true;
  const s = a.scheduleStart ? Date.parse(a.scheduleStart) : NaN;
  const e = a.scheduleEnd ? Date.parse(a.scheduleEnd) : NaN;
  if (Number.isFinite(s) && whenMs < s) return false;
  if (Number.isFinite(e) && whenMs > e) return false;
  return true;
}

/** Resolve the effective layout knobs (advanced overrides the classic columns). */
export function effectiveLayout(
  classic: { imageFocus: "left" | "center" | "right"; textAlign: "left" | "right" },
  a: HomeSlideAdvanced | null | undefined,
): { imageFocus: ImageFocus; imageFocusMobile: ImageFocus; textAlign: TextAlign; verticalAlign: TextVAlign } {
  const imageFocus: ImageFocus = a?.imageFocus ?? classic.imageFocus;
  return {
    imageFocus,
    imageFocusMobile: a?.imageFocusMobile ?? imageFocus,
    textAlign: a?.textAlign ?? classic.textAlign,
    verticalAlign: a?.verticalAlign ?? "center",
  };
}

/** The words each Banner Studio bound box shows (hidden lines show nothing). */
export function homeLegacyWords(
  words: { eyebrow: string; title: string; description: string },
  a: HomeSlideAdvanced | null | undefined,
): { eyebrow: string; title: string; subtitle: string } {
  const show = (k: "eyebrow" | "title" | "description") => (a ? a[k].show : true);
  return {
    eyebrow: show("eyebrow") ? words.eyebrow : "",
    title: show("title") ? words.title : "",
    subtitle: show("description") ? words.description : "",
  };
}

// ── Self-tests ─────────────────────────────────────────────────────────────
export function __runHomeSlideAdvancedCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL home-slide-advanced-core: ${m}`);
    }
  };
  ok(normalizeHomeSlideAdvanced(null) === null, "null → classic");
  ok(normalizeHomeSlideAdvanced("not json") === null, "bad json → classic");
  ok(normalizeHomeSlideAdvanced([1]) === null, "array → classic");
  const d = normalizeHomeSlideAdvanced({})!;
  ok(!!d && d.eyebrow.show && d.title.font === "" && d.verticalAlign === "center", "empty object → defaults");
  ok(isClassicEquivalent(d) && isClassicEquivalent(null), "defaults are classic-equivalent");
  const n = normalizeHomeSlideAdvanced({
    eyebrow: { font: "pacifico", color: "gold", show: false, scriptScale: 9 },
    title: { font: "comic-sans", color: "#ff0000" },
    imageMobile: "javascript:alert(1)",
    imageFocus: "top",
    imageFocusMobile: "nope",
    textAlign: "center",
    verticalAlign: "bottom",
    scheduleStart: "2026-01-01T08:00:00.000Z",
    scheduleEnd: "garbage",
  })!;
  ok(n.eyebrow.font === "pacifico" && n.eyebrow.color === "gold" && !n.eyebrow.show, "valid line style kept");
  ok(n.eyebrow.scriptScale === 2, "script scale clamped");
  ok(n.title.font === "" && n.title.color === "", "unknown font/colour → classic");
  ok(n.imageMobile === "", "unsafe phone picture dropped");
  ok(normalizeHomeSlideAdvanced({ imageMobile: "/brand/a.webp" })!.imageMobile === "/brand/a.webp", "site path kept");
  ok(normalizeHomeSlideAdvanced({ imageMobile: "https://x.supabase.co/a.mp4" })!.imageMobile.startsWith("https://"), "https kept (video ok)");
  ok(n.imageFocus === "top" && n.imageFocusMobile === null, "focus validated");
  ok(n.textAlign === "center" && n.verticalAlign === "bottom", "align validated");
  ok(n.scheduleStart !== null && n.scheduleEnd === null, "schedule validated");
  ok(!isClassicEquivalent(n), "styled → not classic");
  const s1 = serializeHomeSlideAdvanced(n)!;
  ok(serializeHomeSlideAdvanced(normalizeHomeSlideAdvanced(s1)) === s1, "serialize round-trips");
  ok(!("design" in JSON.parse(s1)), "no design key unless set");
  ok(serializeHomeSlideAdvanced(null) === null, "null serializes to null");
  const t = Date.parse("2026-02-01T00:00:00Z");
  ok(isHomeSlideLiveAt(null, t) && isHomeSlideLiveAt(d, t), "no window → live");
  ok(!isHomeSlideLiveAt({ ...d, scheduleStart: "2026-03-01T00:00:00Z" }, t), "before start hidden");
  ok(!isHomeSlideLiveAt({ ...d, scheduleEnd: "2026-01-01T00:00:00Z" }, t), "after end hidden");
  ok(isHomeSlideLiveAt({ ...d, scheduleStart: "2026-01-01T00:00:00Z", scheduleEnd: "2026-03-01T00:00:00Z" }, t), "inside window live");
  const L = effectiveLayout({ imageFocus: "left", textAlign: "right" }, null);
  ok(L.imageFocus === "left" && L.imageFocusMobile === "left" && L.textAlign === "right" && L.verticalAlign === "center", "classic layout passthrough");
  const L2 = effectiveLayout({ imageFocus: "left", textAlign: "right" }, n);
  ok(L2.imageFocus === "top" && L2.imageFocusMobile === "top" && L2.textAlign === "center" && L2.verticalAlign === "bottom", "advanced overrides layout");
  const w = homeLegacyWords({ eyebrow: "E", title: "T", description: "D" }, n);
  ok(w.eyebrow === "" && w.title === "T" && w.subtitle === "D", "hidden line → no words for the design");
  ok(homeLegacyWords({ eyebrow: "E", title: "T", description: "D" }, null).eyebrow === "E", "classic shows all words");
  const withDesign = normalizeHomeSlideAdvanced({ design: { enabled: true } })!;
  ok(!!withDesign.design && withDesign.design.enabled, "design kept when valid");
  ok("design" in JSON.parse(serializeHomeSlideAdvanced(withDesign)!), "design serialized");
  return { passed, failed };
}
