/**
 * theme-contrast-core.ts — PURE color/contrast math for the register themes.
 *
 * WHY THIS EXISTS
 * The register runs on counter iPads in a bright room and on the same iPads at
 * night. Both themes ship from ONE token file (src/app/pos-tokens.css). When a
 * token gets re-tinted for looks, it is very easy to quietly push a text/背景
 * pair under the readable threshold — and the person who finds out is a
 * budtender squinting at a total during a rush.
 *
 * A live browser audit found exactly that, three times over, in the light
 * theme: the primary green button under white ink measured 4.35:1, the
 * "Online" chip measured 3.57:1, and the helper text under every button
 * measured 2.69:1 — all below the 4.5:1 floor. This module is the arithmetic
 * that proved it, extracted so a TEST can re-prove it on every commit instead
 * of relying on someone re-running a browser by hand.
 *
 * WHAT "READABLE" MEANS HERE
 * We use the WCAG 2.x relative-luminance contrast ratio. The thresholds are
 * the published AA ones: 4.5:1 for normal text, 3:1 for large text (>=24px, or
 * >=18.66px when bold). This module does NOT decide which threshold applies —
 * it reports the ratio and lets the caller state the requirement, because the
 * caller is the one that knows the font size.
 *
 * PURITY
 * No DOM, no imports, no I/O. Every function is a total function of its
 * arguments. Junk input yields null rather than throwing, so a token that gets
 * renamed surfaces as a clear "could not parse" failure instead of a crash.
 *
 * NOT A SUBSTITUTE FOR LOOKING
 * Contrast math says text is legible. It does not say a screen is beautiful,
 * balanced, or on-brand. Both were checked for this slice; only the first can
 * be checked automatically, which is why it is the part that lives in code.
 */

export type Rgb = { r: number; g: number; b: number; a: number };

/** Clamp to the 0..255 byte range (alpha handled separately). */
function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

function clampAlpha(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Parse a CSS color that the token file actually uses: #rgb, #rrggbb,
 * #rrggbbaa, rgb(...) and rgba(...). Anything else (named colors, hsl(),
 * var(), gradients) returns null — the caller must then say so out loud
 * rather than silently scoring an unparsed value as "fine".
 */
export function parseCssColor(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (s === "") return null;

  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }

  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return null;
  const parts = m[1]
    .split(/[,/]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length < 3 || parts.length > 4) return null;
  const nums = parts.map((p) => (p.endsWith("%") ? Number(p.slice(0, -1)) * 2.55 : Number(p)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  // A percentage alpha would have been scaled by 2.55 above; undo that.
  let a = 1;
  if (nums.length === 4) a = parts[3].endsWith("%") ? nums[3] / 255 : nums[3];
  return { r: clampByte(nums[0]), g: clampByte(nums[1]), b: clampByte(nums[2]), a: clampAlpha(a) };
}

/**
 * Composite a (possibly translucent) foreground over an OPAQUE background.
 * This is the step people skip: rgba(255,255,255,0.4) is not white, it is
 * whatever it becomes once the canvas shows through, and that is the color
 * the eye actually has to read.
 */
export function compositeOver(fg: Rgb, bg: Rgb): Rgb {
  const a = clampAlpha(fg.a);
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** WCAG relative luminance (sRGB). */
export function relativeLuminance(c: Rgb): number {
  const channel = (v: number) => {
    const s = clampByte(v) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/**
 * WCAG contrast ratio between a foreground and an OPAQUE background.
 * Translucent foregrounds are composited first, which is why this takes the
 * background rather than two free-floating colors.
 */
export function contrastRatio(fg: Rgb, bg: Rgb): number {
  const painted = fg.a < 1 ? compositeOver(fg, bg) : fg;
  const l1 = relativeLuminance(painted);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Convenience: parse both sides and score them. null when either side is unparseable. */
export function contrastOf(fg: unknown, bg: unknown): number | null {
  const f = parseCssColor(fg);
  const b = parseCssColor(bg);
  if (!f || !b) return null;
  // A translucent BACKGROUND has no defined result on its own — the caller
  // must give an opaque backdrop. Refuse rather than guess a white page.
  if (b.a < 1) return null;
  return contrastRatio(f, b);
}

/** WCAG AA thresholds. Large text is >=24px, or >=18.66px at weight >=700. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3;

export function meetsAA(ratio: number, large = false): boolean {
  if (!Number.isFinite(ratio)) return false;
  return ratio >= (large ? AA_LARGE : AA_NORMAL);
}

/**
 * Extract `--token: value;` declarations from ONE CSS block's body.
 * Deliberately dumb string work: the token file is hand-written and flat, and
 * a real CSS parser would be a dependency for no gain.
 */
export function parseTokenBlock(cssBlockBody: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof cssBlockBody !== "string") return out;
  // Strip comments so a commented-out token never counts as declared.
  const body = cssBlockBody.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Embedded self-tests
// ---------------------------------------------------------------------------

export function __runThemeContrastCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`theme-contrast-core self-test FAILED: ${label}`);
    }
  };
  const near = (a: number | null, b: number, tol = 0.02) => a !== null && Math.abs(a - b) <= tol;

  // --- parseCssColor ---
  check("parses #rrggbb", (() => {
    const c = parseCssColor("#116a45");
    return !!c && c.r === 17 && c.g === 106 && c.b === 69 && c.a === 1;
  })());
  check("parses #rgb shorthand", (() => {
    const c = parseCssColor("#fff");
    return !!c && c.r === 255 && c.g === 255 && c.b === 255 && c.a === 1;
  })());
  check("parses #rrggbbaa alpha", (() => {
    const c = parseCssColor("#00000080");
    return !!c && c.r === 0 && Math.abs(c.a - 128 / 255) < 1e-9;
  })());
  check("parses rgb()", (() => {
    const c = parseCssColor("rgb(23, 138, 92)");
    return !!c && c.r === 23 && c.g === 138 && c.b === 92 && c.a === 1;
  })());
  check("parses rgba() with alpha", (() => {
    const c = parseCssColor("rgba(255, 255, 255, 0.55)");
    return !!c && c.a === 0.55;
  })());
  check("is case-insensitive", (() => {
    const c = parseCssColor("#FFD700");
    return !!c && c.r === 255 && c.g === 215 && c.b === 0;
  })());
  check("tolerates surrounding whitespace", !!parseCssColor("   #ffffff  "));
  check("rejects named colors (we never guess)", parseCssColor("rebeccapurple") === null);
  check("rejects var() references", parseCssColor("var(--greenway)") === null);
  check("rejects hsl()", parseCssColor("hsl(102, 63%, 60%)") === null);
  check("rejects malformed hex length", parseCssColor("#12345") === null);
  check("rejects non-hex characters", parseCssColor("#gggggg") === null);
  check("rejects empty string", parseCssColor("") === null);
  check("rejects non-strings", parseCssColor(null) === null && parseCssColor(42) === null);
  check("rejects too few rgb parts", parseCssColor("rgb(1, 2)") === null);
  check("rejects too many rgb parts", parseCssColor("rgb(1,2,3,4,5)") === null);
  check("clamps out-of-range channels", (() => {
    const c = parseCssColor("rgb(999, -20, 12)");
    return !!c && c.r === 255 && c.g === 0 && c.b === 12;
  })());
  check("clamps out-of-range alpha", (() => {
    const c = parseCssColor("rgba(0,0,0,5)");
    return !!c && c.a === 1;
  })());

  // --- luminance + ratio ---
  check("white luminance is 1", Math.abs(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 }) - 1) < 1e-9);
  check("black luminance is 0", Math.abs(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })) < 1e-9);
  check("black on white is 21:1", near(contrastOf("#000000", "#ffffff"), 21));
  check("white on black is 21:1 (symmetric)", near(contrastOf("#ffffff", "#000000"), 21));
  check("a color against itself is 1:1", near(contrastOf("#7ed957", "#7ed957"), 1));

  // --- the regressions this slice actually fixed (measured values) ---
  check("OLD light accent under white ink failed AA (4.35)", near(contrastOf("#ffffff", "#178a5c"), 4.35, 0.05));
  check("NEW light accent under white ink passes AA", (() => {
    const r = contrastOf("#ffffff", "#116a45");
    return r !== null && meetsAA(r) && near(r, 6.62, 0.05);
  })());
  check("OLD light faint text failed AA on white (2.69)", (() => {
    const r = contrastOf("rgba(92, 107, 125, 0.65)", "#ffffff");
    return r !== null && !meetsAA(r) && near(r, 2.69, 0.05);
  })());
  check("NEW light faint text passes AA on white", (() => {
    const r = contrastOf("#647183", "#ffffff");
    return r !== null && meetsAA(r) && near(r, 4.96, 0.05);
  })());
  check("OLD dark faint text failed AA on surface (3.80)", (() => {
    const r = contrastOf("rgba(255,255,255,0.4)", "#0c0e0d");
    return r !== null && !meetsAA(r) && near(r, 3.8, 0.05);
  })());
  check("NEW dark faint text passes AA on surface", (() => {
    const r = contrastOf("rgba(255,255,255,0.55)", "#0c0e0d");
    return r !== null && meetsAA(r);
  })());
  check("white wordmark is invisible on the light canvas", (() => {
    const r = contrastOf("#ffffff", "#f4f6f9");
    return r !== null && r < 1.5;
  })());

  // --- compositing is what makes translucency honest ---
  check("translucent white over black lands mid-grey", (() => {
    const c = compositeOver({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0, a: 1 });
    return Math.abs(c.r - 127.5) < 1e-9 && c.a === 1;
  })());
  check("fully transparent fg becomes the background", (() => {
    const c = compositeOver({ r: 255, g: 0, b: 0, a: 0 }, { r: 10, g: 20, b: 30, a: 1 });
    return c.r === 10 && c.g === 20 && c.b === 30;
  })());
  check("opaque fg is unchanged by compositing", (() => {
    const c = compositeOver({ r: 1, g: 2, b: 3, a: 1 }, { r: 250, g: 250, b: 250, a: 1 });
    return c.r === 1 && c.g === 2 && c.b === 3;
  })());
  check("alpha changes the score (proves compositing runs)", (() => {
    const opaque = contrastOf("rgb(92,107,125)", "#ffffff");
    const faded = contrastOf("rgba(92,107,125,0.65)", "#ffffff");
    return opaque !== null && faded !== null && faded < opaque;
  })());
  check("refuses a translucent BACKGROUND rather than guessing", contrastOf("#000", "rgba(0,0,0,0.5)") === null);
  check("returns null when either side is unparseable", contrastOf("nope", "#fff") === null && contrastOf("#fff", "nope") === null);

  // --- thresholds ---
  check("AA normal floor is 4.5", AA_NORMAL === 4.5);
  check("AA large floor is 3", AA_LARGE === 3);
  check("4.5 exactly passes normal", meetsAA(4.5) === true);
  check("4.49 fails normal", meetsAA(4.49) === false);
  check("3 exactly passes large", meetsAA(3, true) === true);
  check("2.99 fails large", meetsAA(2.99, true) === false);
  check("4.35 passes as LARGE text but not normal", meetsAA(4.35, true) === true && meetsAA(4.35) === false);
  check("NaN never passes", meetsAA(Number.NaN) === false);

  // --- token block parsing ---
  check("parses simple declarations", (() => {
    const t = parseTokenBlock("--a: #fff;\n--b: rgba(0,0,0,.5);");
    return t["--a"] === "#fff" && t["--b"] === "rgba(0,0,0,.5)";
  })());
  check("ignores commented-out tokens", (() => {
    const t = parseTokenBlock("/* --ghost: #000; */\n--real: #111;");
    return t["--ghost"] === undefined && t["--real"] === "#111";
  })());
  check("handles multi-line comments between tokens", (() => {
    const t = parseTokenBlock("--a: #111;\n/* note\n   spanning lines */\n--b: #222;");
    return t["--a"] === "#111" && t["--b"] === "#222";
  })());
  check("last declaration wins (CSS cascade)", (() => {
    const t = parseTokenBlock("--a: #111;\n--a: #222;");
    return t["--a"] === "#222";
  })());
  check("returns empty for non-strings", Object.keys(parseTokenBlock(null)).length === 0);
  check("returns empty for a body with no tokens", Object.keys(parseTokenBlock("color: red;")).length === 0);

  return { passed, failed };
}
