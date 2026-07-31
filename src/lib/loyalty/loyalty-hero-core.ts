/**
 * src/lib/loyalty/loyalty-hero-core.ts
 *
 * SLICE 123 (LOY-1) — the PURE single source of truth for how the /loyalty
 * HERO BANNER is PRESENTED. Historically the loyalty hero was an IMAGE with the
 * headline text BAKED INTO the artwork (two static PNGs, desktop + mobile), so
 * staff could not change the words, colors, fonts, or layout — they could only
 * swap the whole picture. This module replaces that with a fully editable
 * "special" banner: a textless background image plus THREE independently styled
 * overlay text blocks (eyebrow / title / subtitle), each with its own font and
 * on-brand color, honoring hard line breaks so staff can stack lines exactly
 * like the old static art.
 *
 * WHY THIS IS A "SPECIAL" BANNER (more powers than SectionBanner):
 *   - per-block FONT family (display / clean sans / cursive script) so the
 *     subtitle can be a flowing cursive like the original "Earn Points…" line,
 *   - per-block on-brand COLOR (white / gold / Greenway green / orange / muted),
 *   - hard line-break stacking (type Enter to stack "GREENWAY / LOYALTY / POINTS"),
 *   - a desktop image AND a mobile image, each with its own focus,
 *   - text horizontal align (left/center/right) + vertical align (top/center/bottom),
 *   - an optional bigger "script scale" so a cursive subtitle reads larger.
 *
 * DELIBERATE LIVE-LOOK CHANGE (owner-approved, plan C): unlike the byte-identical
 * defaults elsewhere, the loyalty hero's DEFAULT here intentionally renders the
 * NEW look — the new textless gold-leaf artwork with editable overlay text that
 * recreates the old baked headline ("A Smoking Deal!", "Greenway Loyalty Points",
 * "Earn Points With Every Purchase"). The signup form, program terms, live
 * numbers, and consent copy are unchanged; only the hero's picture-with-baked-
 * text becomes a picture-with-editable-text.
 *
 * Storage: ONE content_blocks JSON row `loyalty.hero.presentation`
 * (field_type "richjson"). field_type / draft_value / published_value are plain
 * unconstrained text columns (supabase/migrations/0005_slice5_cms.sql L100-102),
 * so this needs NO migration — same basis as the Specials presentation block.
 *
 * FONTS: the per-block font ids resolve through the site's real font system
 * (src/lib/cms/fonts.ts `fontStack`), which loads every font with next/font so
 * BOTH the public render AND the editor live-preview use the identical stacks.
 */

import { fontStack } from "@/lib/cms/fonts";

/**
 * The ONE content_blocks row that stores the loyalty-hero presentation. Lives
 * in this plain module so both the "use server" actions file and the editor
 * page can import it (a "use server" file may only export async functions).
 */
export const LOYALTY_HERO_PRESENTATION_BLOCK = "loyalty.hero.presentation";

/** The new textless artwork shipped with this slice (owner-approved). */
export const LOYALTY_HERO_DEFAULT_IMAGE =
  "/brand/greenway-loyalty-hero-2026-desktop.png";
export const LOYALTY_HERO_DEFAULT_IMAGE_MOBILE =
  "/brand/greenway-loyalty-hero-2026-mobile.png";

// ── Alignment + focus (same vocabulary as SectionBanner / specials) ──────────

/** Horizontal placement of the overlay text over the image. */
export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];
export function isTextAlign(v: unknown): v is TextAlign {
  return typeof v === "string" && (TEXT_ALIGNS as readonly string[]).includes(v);
}

/** Vertical placement of the overlay text over the image. */
export const TEXT_VALIGNS = ["top", "center", "bottom"] as const;
export type TextVAlign = (typeof TEXT_VALIGNS)[number];
export function isTextVAlign(v: unknown): v is TextVAlign {
  return typeof v === "string" && (TEXT_VALIGNS as readonly string[]).includes(v);
}

/** Where the background IMAGE sits, independent of the text. */
export const IMAGE_FOCUSES = ["center", "top", "bottom", "left", "right"] as const;
export type ImageFocus = (typeof IMAGE_FOCUSES)[number];
export function isImageFocus(v: unknown): v is ImageFocus {
  return typeof v === "string" && (IMAGE_FOCUSES as readonly string[]).includes(v);
}

// ── Per-block FONT choices (the "special" power) ─────────────────────────────

/**
 * Curated hero font choices. Each `fontId` is a real id in the site font
 * library (src/lib/cms/fonts.ts), so `heroFontStack()` resolves to the exact
 * same next/font stack used everywhere else — the editor preview and the public
 * render are guaranteed identical. We expose a friendly, small menu grouped by
 * feel rather than the whole library, because a hero headline wants impact
 * fonts, not (say) monospace.
 */
export type HeroFontChoice = {
  /** Stable id stored in the block. */
  id: string;
  /** Friendly label for the picker. */
  label: string;
  /** The underlying site-font-library id this maps to. */
  fontId: string;
  /** Grouping shown in the picker. */
  group: "display" | "sans" | "script";
};

export const HERO_FONTS: HeroFontChoice[] = [
  // Display — bold impact headlines (matches the old white block letters).
  { id: "anton", label: "Anton (ultra bold)", fontId: "anton", group: "display" },
  { id: "bebas", label: "Bebas Neue (tall caps)", fontId: "bebas", group: "display" },
  { id: "oswald", label: "Oswald (condensed)", fontId: "oswald", group: "display" },
  // Clean sans — modern, legible.
  { id: "montserrat", label: "Montserrat (strong sans)", fontId: "montserrat", group: "sans" },
  { id: "poppins", label: "Poppins (friendly sans)", fontId: "poppins", group: "sans" },
  { id: "inter", label: "Inter (neutral sans)", fontId: "inter", group: "sans" },
  // Script — cursive, for the "Earn Points…" flourish (added this slice).
  { id: "great-vibes", label: "Great Vibes (elegant script)", fontId: "great-vibes", group: "script" },
  { id: "dancing-script", label: "Dancing Script (casual script)", fontId: "dancing-script", group: "script" },
  { id: "pacifico", label: "Pacifico (bold script)", fontId: "pacifico", group: "script" },
];

const HERO_FONT_BY_ID = new Map(HERO_FONTS.map((f) => [f.id, f]));

export function isHeroFont(v: unknown): v is string {
  return typeof v === "string" && HERO_FONT_BY_ID.has(v);
}

/** Resolve a hero font id (possibly unknown) to a real CSS font stack. */
export function heroFontStack(id: string | null | undefined): string {
  const choice = (id && HERO_FONT_BY_ID.get(id)) || null;
  // Fall back to the strong display font so an unknown id still looks like a
  // headline (never a bare serif). fontStack() itself falls back safely too.
  const fontId = choice?.fontId ?? "anton";
  return fontStack(fontId, "system");
}

/** True when a hero font id is a cursive/script face (drives the size bump UI). */
export function isScriptHeroFont(id: string | null | undefined): boolean {
  return (id && HERO_FONT_BY_ID.get(id)?.group === "script") || false;
}

// ── Per-block COLOR choices (on-brand) ───────────────────────────────────────

/**
 * On-brand overlay text colors. Values match the site tokens in globals.css
 * (--greenway #7ed957, --gold #ffd700) plus white, an orange accent, and a
 * soft muted light for secondary lines. Stored by id so a rename never breaks
 * saved data.
 */
export type HeroColorChoice = { id: string; label: string; hex: string };

export const HERO_COLORS: HeroColorChoice[] = [
  { id: "white", label: "White", hex: "#ffffff" },
  { id: "gold", label: "Gold", hex: "#ffd700" },
  { id: "green", label: "Greenway green", hex: "#7ed957" },
  { id: "orange", label: "Orange", hex: "#ff7f00" },
  { id: "muted", label: "Soft light", hex: "#d6d3ca" },
];

const HERO_COLOR_BY_ID = new Map(HERO_COLORS.map((c) => [c.id, c]));

export function isHeroColor(v: unknown): v is string {
  return typeof v === "string" && HERO_COLOR_BY_ID.has(v);
}

/** Resolve a hero color id (possibly unknown) to a CSS hex (default white). */
export function heroColorHex(id: string | null | undefined): string {
  return (id && HERO_COLOR_BY_ID.get(id)?.hex) || "#ffffff";
}

// ── The three overlay text blocks ────────────────────────────────────────────

/**
 * One editable overlay text block (eyebrow / title / subtitle). `text` honors
 * hard line breaks (\n) so staff can stack lines. `show` lets a block be hidden
 * without losing its text. `scriptScale` (only meaningful for a script font)
 * bumps a cursive line larger so it reads as a flourish.
 */
export type HeroTextBlock = {
  text: string;
  /** Hero font id (see HERO_FONTS); resolved via heroFontStack(). */
  font: string;
  /** Hero color id (see HERO_COLORS); resolved via heroColorHex(). */
  color: string;
  /** When false the block is not rendered. */
  show: boolean;
  /** Optional bigger scale for a cursive line (clamped 1.0..2.0, default 1). */
  scriptScale: number;
};

export const SCRIPT_SCALE_MIN = 1;
export const SCRIPT_SCALE_MAX = 2;
export const SCRIPT_SCALE_DEFAULT = 1;

/** Clamp any input to a valid script scale (default 1). */
export function clampScriptScale(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return SCRIPT_SCALE_DEFAULT;
  const r = Math.round(n * 10) / 10; // one decimal step
  if (r < SCRIPT_SCALE_MIN) return SCRIPT_SCALE_MIN;
  if (r > SCRIPT_SCALE_MAX) return SCRIPT_SCALE_MAX;
  return r;
}

export type LoyaltyHeroPresentation = {
  /** Desktop background image (textless art). */
  image: string;
  /** Mobile background image (textless art). */
  imageMobile: string;
  /** Where the desktop image sits, independent of the text. */
  imageFocus: ImageFocus;
  /** Where the mobile image sits, independent of the text. */
  imageFocusMobile: ImageFocus;
  /** Horizontal placement of the overlay text. */
  textAlign: TextAlign;
  /** Vertical placement of the overlay text. */
  verticalAlign: TextVAlign;
  /** The small kicker above the title (old "A Smoking Deal!"). */
  eyebrow: HeroTextBlock;
  /** The headline (old "GREENWAY LOYALTY POINTS", stackable). */
  title: HeroTextBlock;
  /** The subtitle (old cursive "Earn Points With Every Purchase"). */
  subtitle: HeroTextBlock;
};

/**
 * The owner-approved DEFAULT: the NEW look. New textless art on the LEFT, the
 * three overlay text blocks on the RIGHT, recreating the old baked headline —
 * eyebrow gold, title white bold display, subtitle gold cursive. (This is a
 * deliberate live-look change per plan C; everything else on /loyalty is
 * unchanged.)
 */
export function defaultLoyaltyHeroPresentation(): LoyaltyHeroPresentation {
  return {
    image: LOYALTY_HERO_DEFAULT_IMAGE,
    imageMobile: LOYALTY_HERO_DEFAULT_IMAGE_MOBILE,
    // Leaf art lives on the LEFT, so focus the image left and put text right.
    imageFocus: "left",
    imageFocusMobile: "left",
    textAlign: "right",
    verticalAlign: "center",
    eyebrow: {
      text: "A Smoking Deal!",
      font: "montserrat",
      color: "gold",
      show: true,
      scriptScale: SCRIPT_SCALE_DEFAULT,
    },
    title: {
      // Stacked exactly like the static art via hard line breaks.
      text: "Greenway\nLoyalty\nPoints",
      font: "anton",
      color: "white",
      show: true,
      scriptScale: SCRIPT_SCALE_DEFAULT,
    },
    subtitle: {
      text: "Earn Points With Every Purchase",
      font: "great-vibes",
      color: "gold",
      show: true,
      scriptScale: 1.3,
    },
  };
}

// ── Normalize / serialize / parse / resolve ──────────────────────────────────

function cleanImage(v: unknown, fallback: string): string {
  if (typeof v !== "string") return fallback;
  return v.trim();
}

/**
 * Coerce a raw block into a valid HeroTextBlock. Uses the supplied default for
 * any missing/malformed field so a block never renders garbage. Font/color ids
 * fall back to the default block's ids when unknown.
 */
function normalizeBlock(raw: unknown, def: HeroTextBlock): HeroTextBlock {
  if (!raw || typeof raw !== "object") return { ...def };
  const o = raw as Record<string, unknown>;
  return {
    // Preserve the exact string (including \n) but coerce non-strings to "".
    text: typeof o.text === "string" ? o.text : def.text,
    font: isHeroFont(o.font) ? (o.font as string) : def.font,
    color: isHeroColor(o.color) ? (o.color as string) : def.color,
    show: typeof o.show === "boolean" ? o.show : def.show,
    scriptScale:
      o.scriptScale === undefined ? def.scriptScale : clampScriptScale(o.scriptScale),
  };
}

/**
 * Coerce an unknown object into a valid, complete LoyaltyHeroPresentation.
 * Missing/malformed fields fall back to the default so the hero NEVER blanks.
 */
export function normalizeLoyaltyHeroPresentation(
  input: unknown,
): LoyaltyHeroPresentation {
  const base = defaultLoyaltyHeroPresentation();
  if (!input || typeof input !== "object") return base;
  const obj = input as Record<string, unknown>;

  return {
    image: cleanImage(obj.image, base.image),
    imageMobile: cleanImage(obj.imageMobile, base.imageMobile),
    imageFocus: isImageFocus(obj.imageFocus) ? obj.imageFocus : base.imageFocus,
    imageFocusMobile: isImageFocus(obj.imageFocusMobile)
      ? obj.imageFocusMobile
      : base.imageFocusMobile,
    textAlign: isTextAlign(obj.textAlign) ? obj.textAlign : base.textAlign,
    verticalAlign: isTextVAlign(obj.verticalAlign)
      ? obj.verticalAlign
      : base.verticalAlign,
    eyebrow: normalizeBlock(obj.eyebrow, base.eyebrow),
    title: normalizeBlock(obj.title, base.title),
    subtitle: normalizeBlock(obj.subtitle, base.subtitle),
  };
}

function serializeBlock(b: HeroTextBlock): Record<string, unknown> {
  return {
    text: b.text,
    font: b.font,
    color: b.color,
    show: b.show,
    scriptScale: b.scriptScale,
  };
}

/** Serialize to the stored JSON string (stable key order for clean diffs). */
export function serializeLoyaltyHeroPresentation(
  p: LoyaltyHeroPresentation,
): string {
  const norm = normalizeLoyaltyHeroPresentation(p);
  return JSON.stringify({
    image: norm.image,
    imageMobile: norm.imageMobile,
    imageFocus: norm.imageFocus,
    imageFocusMobile: norm.imageFocusMobile,
    textAlign: norm.textAlign,
    verticalAlign: norm.verticalAlign,
    eyebrow: serializeBlock(norm.eyebrow),
    title: serializeBlock(norm.title),
    subtitle: serializeBlock(norm.subtitle),
  });
}

/**
 * Parse a stored JSON string. Returns null on missing/invalid JSON so callers
 * fall back to the default (never blank the page).
 */
export function parseLoyaltyHeroPresentation(
  json: string | null | undefined,
): LoyaltyHeroPresentation | null {
  if (!json || !json.trim()) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  return normalizeLoyaltyHeroPresentation(raw);
}

/**
 * Resolve the settings to use for rendering: the parsed stored value when
 * valid, otherwise the default (the new look). This is what /loyalty calls.
 */
export function resolveLoyaltyHeroPresentation(
  storedJson: string | null | undefined,
): LoyaltyHeroPresentation {
  return parseLoyaltyHeroPresentation(storedJson) ?? defaultLoyaltyHeroPresentation();
}

/**
 * Split a block's text on hard line breaks into display lines. Trims trailing
 * empties but keeps interior blank lines so intentional spacing survives. Pure
 * helper shared by the render + preview so they wrap identically.
 */
export function heroTextLines(text: string): string[] {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  // Drop leading/trailing all-whitespace lines (typical stray Enter presses).
  while (lines.length && lines[0].trim() === "") lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure self-tests (throw on failure). Registered in the pure-selftest runner.
// ─────────────────────────────────────────────────────────────────────────────
export function __runLoyaltyHeroCoreTests(): { passed: number } {
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`loyalty-hero-core: ${msg}`);
    passed += 1;
  };

  // Default = the new look (owner-approved).
  const def = defaultLoyaltyHeroPresentation();
  ok(def.image === LOYALTY_HERO_DEFAULT_IMAGE, "default desktop image is the new art");
  ok(def.imageMobile === LOYALTY_HERO_DEFAULT_IMAGE_MOBILE, "default mobile image is the new art");
  ok(def.imageFocus === "left" && def.imageFocusMobile === "left", "default image focus left (leaf on left)");
  ok(def.textAlign === "right", "default text on the right");
  ok(def.verticalAlign === "center", "default text vertically centered");
  ok(def.eyebrow.text === "A Smoking Deal!" && def.eyebrow.show, "default eyebrow recreates the old kicker");
  ok(def.eyebrow.color === "gold", "default eyebrow gold");
  ok(def.title.text === "Greenway\nLoyalty\nPoints", "default title stacked via line breaks");
  ok(def.title.font === "anton" && def.title.color === "white", "default title bold display, white");
  ok(def.subtitle.text === "Earn Points With Every Purchase", "default subtitle recreates the old line");
  ok(isScriptHeroFont(def.subtitle.font), "default subtitle uses a script font");
  ok(def.subtitle.color === "gold", "default subtitle gold");

  // heroTextLines splits + trims correctly.
  const lines = heroTextLines("Greenway\nLoyalty\nPoints");
  ok(lines.length === 3 && lines[0] === "Greenway" && lines[2] === "Points", "text splits into stacked lines");
  ok(heroTextLines("\n\nHello\n\n").length === 1, "leading/trailing blank lines trimmed");
  ok(heroTextLines("A\n\nB").length === 3, "interior blank line preserved");
  ok(heroTextLines("").length === 0, "empty text -> no lines");

  // Font resolution + guards.
  ok(isHeroFont("anton") && isHeroFont("great-vibes"), "known hero fonts accepted");
  ok(!isHeroFont("comic-sans") && !isHeroFont(3), "unknown hero fonts rejected");
  ok(heroFontStack("anton").includes("--gw-font-anton"), "anton resolves to its real CSS var");
  ok(heroFontStack("great-vibes").includes("--gw-font-great-vibes"), "script resolves to its real CSS var");
  ok(heroFontStack("nope").includes("--gw-font-anton"), "unknown font id falls back to a display stack");
  ok(isScriptHeroFont("pacifico") && !isScriptHeroFont("anton"), "script detection correct");
  ok(!isScriptHeroFont("nope") && !isScriptHeroFont(null), "script detection safe on junk");

  // Color resolution + guards.
  ok(isHeroColor("gold") && isHeroColor("green"), "known hero colors accepted");
  ok(!isHeroColor("chartreuse") && !isHeroColor(1), "unknown hero colors rejected");
  ok(heroColorHex("gold") === "#ffd700", "gold hex correct (brand token)");
  ok(heroColorHex("green") === "#7ed957", "green hex correct (brand token)");
  ok(heroColorHex("nope") === "#ffffff", "unknown color -> white");

  // Script scale clamp.
  ok(clampScriptScale(1.3) === 1.3, "valid script scale kept");
  ok(clampScriptScale(0.2) === 1, "script scale clamps up to min 1");
  ok(clampScriptScale(9) === 2, "script scale clamps down to max 2");
  ok(clampScriptScale("1.5") === 1.5, "script scale parses numeric strings");
  ok(clampScriptScale("abc") === 1, "non-numeric script scale -> default 1");
  ok(clampScriptScale(undefined) === 1, "undefined script scale -> default 1");

  // Normalize coerces bad data back to safe values.
  const norm = normalizeLoyaltyHeroPresentation({
    image: "  /brand/x.png  ",
    imageFocus: "nope",
    textAlign: "center",
    verticalAlign: "top",
    eyebrow: { text: "Hi", font: "bogus", color: "bogus", show: false, scriptScale: 99 },
    title: { text: 42 },
    subtitle: "not an object",
  });
  ok(norm.image === "/brand/x.png", "image trimmed");
  ok(norm.imageFocus === "left", "bad image focus -> default left");
  ok(norm.textAlign === "center" && norm.verticalAlign === "top", "valid align applied");
  ok(norm.eyebrow.text === "Hi" && norm.eyebrow.show === false, "eyebrow text + show applied");
  ok(norm.eyebrow.font === def.eyebrow.font, "bad eyebrow font -> default font");
  ok(norm.eyebrow.color === def.eyebrow.color, "bad eyebrow color -> default color");
  ok(norm.eyebrow.scriptScale === 2, "eyebrow script scale clamped to max 2");
  ok(norm.title.text === def.title.text, "non-string title text -> default");
  ok(norm.subtitle.text === def.subtitle.text, "non-object subtitle -> full default block");

  // Empty/whitespace image falls back to nothing? No — trimmed empty is allowed
  // (staff can clear an image); normalize keeps it as "" and render decides.
  const cleared = normalizeLoyaltyHeroPresentation({ image: "   " });
  ok(cleared.image === "", "cleared image normalizes to empty string");

  // Serialize -> parse round-trip (including \n in title).
  const custom = normalizeLoyaltyHeroPresentation({
    image: "/brand/a.png",
    imageMobile: "/brand/b.png",
    imageFocus: "right",
    imageFocusMobile: "top",
    textAlign: "left",
    verticalAlign: "bottom",
    eyebrow: { text: "Kicker", font: "oswald", color: "orange", show: true, scriptScale: 1 },
    title: { text: "Line 1\nLine 2", font: "bebas", color: "green", show: true, scriptScale: 1 },
    subtitle: { text: "Flowing", font: "dancing-script", color: "muted", show: false, scriptScale: 1.6 },
  });
  const json = serializeLoyaltyHeroPresentation(custom);
  const round = parseLoyaltyHeroPresentation(json)!;
  ok(round.image === "/brand/a.png" && round.imageMobile === "/brand/b.png", "round-trip keeps images");
  ok(round.imageFocus === "right" && round.imageFocusMobile === "top", "round-trip keeps focuses");
  ok(round.textAlign === "left" && round.verticalAlign === "bottom", "round-trip keeps align");
  ok(round.title.text === "Line 1\nLine 2", "round-trip keeps line breaks in title");
  ok(round.title.font === "bebas" && round.title.color === "green", "round-trip keeps title font/color");
  ok(round.subtitle.font === "dancing-script" && round.subtitle.scriptScale === 1.6, "round-trip keeps subtitle style");
  ok(round.subtitle.show === false, "round-trip keeps subtitle hidden");

  // Bad JSON / empty -> null (caller falls back).
  ok(parseLoyaltyHeroPresentation("not json") === null, "bad JSON -> null");
  ok(parseLoyaltyHeroPresentation("") === null, "empty -> null");
  ok(parseLoyaltyHeroPresentation(null) === null, "null -> null");

  // resolve() never returns null; serialized default resolves back byte-identical.
  const resolvedDefault = resolveLoyaltyHeroPresentation(null);
  ok(resolvedDefault.image === def.image, "resolve(null) -> full default");
  const resolvedRound = resolveLoyaltyHeroPresentation(serializeLoyaltyHeroPresentation(def));
  ok(
    JSON.stringify(resolvedRound) === JSON.stringify(def),
    "serialized default resolves back to the default",
  );

  return { passed };
}
