/**
 * src/lib/cms/newsletter-style-core.ts
 *
 * D243 E-3 (SOP-22 G-123, Phase E "Email Studio"): per-section styles for
 * the newsletter canvas: background colour, padding, text and accent colour,
 * round corners and a thin border. Pure (no I/O).
 *
 * Owner (D243): "I want the website editors plus all the above plus more."
 *
 * A section with no style renders byte for byte as before (old canvases keep
 * working). Styles are email-safe: a wrapping table cell with inline styles.
 * `styleContrastIssue` warns when the words would be hard to read on the
 * chosen background (WCAG AA 4.5:1 for body text).
 */

export type SectionPad = "none" | "s" | "m" | "l";
export const SECTION_PADS: { id: SectionPad; label: string; px: number }[] = [
  { id: "none", label: "None", px: 0 },
  { id: "s", label: "Small", px: 8 },
  { id: "m", label: "Medium", px: 20 },
  { id: "l", label: "Large", px: 36 },
];

export type SectionStyle = {
  /** Background colour (#rrggbb) or "" for the look's card colour. */
  bg: string;
  /** Words colour or "" for the look's colours. */
  text: string;
  /** Links and buttons colour or "" for the look's green. */
  accent: string;
  pad: SectionPad;
  round: boolean;
  border: boolean;
};

export type StyleColors = { bg: string; card: string; border: string; text: string; muted: string; accent: string; gold: string; onAccent: string };

/** Brand swatches offered in the style panel (Greenway black/green/gold plus neutrals). */
export const STYLE_SWATCHES: { hex: string; label: string }[] = [
  { hex: "#000000", label: "Greenway black" },
  { hex: "#0f0f0f", label: "Charcoal" },
  { hex: "#14301f", label: "Deep green" },
  { hex: "#7ed957", label: "Greenway green" },
  { hex: "#2f7d16", label: "Forest" },
  { hex: "#ffd700", label: "Gold" },
  { hex: "#f6f1e3", label: "Cream" },
  { hex: "#ffffff", label: "White" },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

function hex(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (/^#[0-9a-f]{3}$/i.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return HEX_RE.test(s) ? s.toLowerCase() : "";
}

export function defaultStyle(): SectionStyle {
  return { bg: "", text: "", accent: "", pad: "none", round: false, border: false };
}

/** True when the style changes nothing (stored as no style at all). */
export function isPlainStyle(s: SectionStyle): boolean {
  return !s.bg && !s.text && !s.accent && s.pad === "none" && !s.round && !s.border;
}

/** Clean a style from untrusted JSON; null when there is nothing to apply. */
export function cleanSectionStyle(raw: unknown): SectionStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pad = SECTION_PADS.some((p) => p.id === r.pad) ? (r.pad as SectionPad) : "none";
  const s: SectionStyle = { bg: hex(r.bg), text: hex(r.text), accent: hex(r.accent), pad, round: r.round === true, border: r.border === true };
  return isPlainStyle(s) ? null : s;
}

export function padPx(p: SectionPad): number {
  return SECTION_PADS.find((x) => x.id === p)?.px ?? 0;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminanceOf(h: string): number {
  const x = hex(h) || "#000000";
  return 0.2126 * channel(parseInt(x.slice(1, 3), 16)) + 0.7152 * channel(parseInt(x.slice(3, 5), 16)) + 0.0722 * channel(parseInt(x.slice(5, 7), 16));
}

export function contrastOf(a: string, b: string): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on `bg`. */
export function inkFor(bg: string): "#000000" | "#ffffff" {
  return contrastOf(bg, "#000000") >= contrastOf(bg, "#ffffff") ? "#000000" : "#ffffff";
}

/**
 * The look's colours with this section's overrides. When only a background
 * is chosen, the words switch to black or white so they stay readable.
 */
export function styledColors<T extends StyleColors>(t: T, s: SectionStyle | null | undefined): T {
  if (!s) return t;
  const bg = s.bg || t.card;
  const autoInk = s.bg && !s.text ? inkFor(s.bg) : "";
  const text = s.text || autoInk || t.text;
  const muted = s.text || autoInk || t.muted;
  const accent = s.accent || (s.bg && contrastOf(t.accent, bg) < 3 ? (autoInk || text) : t.accent);
  const gold = s.bg && contrastOf(t.gold, bg) < 3 ? text : t.gold;
  return { ...t, card: bg, text, muted, accent, gold, onAccent: inkFor(accent) };
}

/** Wrap a section's rows in its style (no style = the rows unchanged). */
export function wrapStyled(rows: string, s: SectionStyle | null | undefined, t: StyleColors): string {
  if (!s || !rows) return rows;
  const pad = padPx(s.pad);
  const bg = s.bg ? `background:${s.bg};` : "";
  const bgAttr = s.bg ? ` bgcolor="${s.bg}"` : "";
  const radius = s.round ? "border-radius:14px;" : "";
  const border = s.border ? `border:1px solid ${t.border};` : "";
  const outer = s.round || s.border ? "padding:6px 16px" : "padding:0";
  return `<tr><td data-gw-style="1" style="${outer}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"${bgAttr} style="${bg}${radius}${border}border-collapse:separate"><tr><td style="padding:${pad}px 0">\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>\n</td></tr></table></td></tr>`;
}

export type StyleIssue = { level: "heads-up"; code: string; text: string };

/** Heads-up when the words are hard to read on the chosen colours (WCAG AA 4.5:1). */
export function styleContrastIssue(s: SectionStyle | null | undefined, t: StyleColors): StyleIssue | null {
  if (!s || (!s.bg && !s.text)) return null;
  const c = styledColors(t, s);
  const ratio = contrastOf(c.text, c.card);
  if (ratio >= 4.5) return null;
  return { level: "heads-up", code: "style-contrast", text: `Words on a styled section are hard to read (contrast ${ratio.toFixed(1)}:1; aim for 4.5:1 or more). Pick a darker or lighter colour.` };
}

export function __runNewsletterStyleCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.log(`FAIL newsletter-style-core: ${name}`);
    }
  };
  const dark: StyleColors = { bg: "#000000", card: "#0f0f0f", border: "#1f1f1f", text: "#ffffff", muted: "#b8b8b8", accent: "#7ed957", gold: "#ffd700", onAccent: "#000000" };
  const light: StyleColors = { bg: "#f2f2f2", card: "#ffffff", border: "#e3e3e3", text: "#111111", muted: "#4a4a4a", accent: "#2f7d16", gold: "#8a6d00", onAccent: "#ffffff" };

  ok(cleanSectionStyle(null) === null, "null -> no style");
  ok(cleanSectionStyle({}) === null, "empty -> no style");
  ok(cleanSectionStyle({ bg: "red", pad: "huge" }) === null, "bad values dropped");
  ok(cleanSectionStyle({ bg: "#FFF" })?.bg === "#ffffff", "short hex expanded");
  ok(cleanSectionStyle({ bg: "#123456", pad: "m" })?.pad === "m", "pad kept");
  ok(cleanSectionStyle({ round: "yes" }) === null, "round must be true");
  ok(cleanSectionStyle({ bg: "javascript:alert(1)" }) === null, "no script in colours");
  ok(cleanSectionStyle({ text: "#ff0000;background:url(x)" }) === null, "no css injection");
  ok(isPlainStyle(defaultStyle()), "default is plain");
  ok(padPx("l") === 36 && padPx("none") === 0, "pad px");
  ok(Math.abs(contrastOf("#ffffff", "#000000") - 21) < 0.01, "contrast 21");
  ok(Math.abs(contrastOf("#777777", "#777777") - 1) < 0.01, "contrast 1");
  ok(inkFor("#ffd700") === "#000000" && inkFor("#14301f") === "#ffffff", "ink picks readable");
  const cream = styledColors(dark, { ...defaultStyle(), bg: "#f6f1e3" });
  ok(cream.text === "#000000" && cream.card === "#f6f1e3", "bg only -> auto ink");
  ok(contrastOf(cream.accent, cream.card) >= 3, "accent readable on cream");
  ok(contrastOf(cream.gold, cream.card) >= 3, "gold readable on cream");
  const deep = styledColors(light, { ...defaultStyle(), bg: "#14301f" });
  ok(deep.text === "#ffffff", "dark bg on light look -> white words");
  ok(styledColors(dark, null) === dark, "no style -> same colours");
  ok(styledColors(dark, { ...defaultStyle(), accent: "#ffd700" }).onAccent === "#000000", "button ink on gold");
  ok(wrapStyled("<tr><td>x</td></tr>", null, dark) === "<tr><td>x</td></tr>", "no style -> unchanged");
  ok(wrapStyled("", { ...defaultStyle(), bg: "#000000" }, dark) === "", "empty rows -> nothing");
  const w = wrapStyled("<tr><td>x</td></tr>", { ...defaultStyle(), bg: "#14301f", pad: "m", round: true }, dark);
  ok(w.includes('data-gw-style="1"') && w.includes("background:#14301f") && w.includes('bgcolor="#14301f"'), "wrap bg + bgcolor");
  ok(w.includes("border-radius:14px") && w.includes("padding:20px 0") && w.includes("padding:6px 16px"), "wrap radius + pad");
  ok(w.includes("<tr><td>x</td></tr>"), "wrap keeps rows");
  ok(!/<script|javascript:/i.test(w), "wrap safe");
  ok(styleContrastIssue(null, dark) === null, "no style no issue");
  ok(styleContrastIssue({ ...defaultStyle(), bg: "#ffd700" }, dark) === null, "auto ink passes");
  ok(styleContrastIssue({ ...defaultStyle(), bg: "#777777", text: "#888888" }, dark)?.code === "style-contrast", "low contrast flagged");
  ok(styleContrastIssue({ ...defaultStyle(), pad: "l" }, dark) === null, "pad only no issue");
  ok(STYLE_SWATCHES.every((s) => HEX_RE.test(s.hex)), "swatches are hex");
  return { passed, failed };
}
