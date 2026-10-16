/**
 * src/lib/cms/color-input-core.ts — R56-S1
 *
 * "Any colour I want": turn whatever the owner pastes into a colour field
 * (#abc, #aabbcc, #aabbccdd, rgb()/rgba(), hsl()/hsla(), with commas or the
 * modern space syntax) into the #rrggbb the design stores. Named colours
 * ("tomato") are resolved in the browser by the canvas fallback in
 * controls.tsx; this module stays pure and testable.
 *
 * Also the "Your colours" memory: the most recent custom colours, newest
 * first, de-duplicated, capped — kept in localStorage by the UI.
 */

export const RECENT_COLORS_MAX = 12;
export const RECENT_COLORS_KEY = "gw-studio-recent-colors";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const h2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");

function channel(tok: string): number | null {
  const t = tok.trim();
  if (/^-?\d+(\.\d+)?%$/.test(t)) return (parseFloat(t) / 100) * 255;
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  return null;
}

function pct(tok: string): number | null {
  const t = tok.trim().replace(/%$/, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? clamp(parseFloat(t), 0, 100) / 100 : null;
}

function hue(tok: string): number | null {
  const m = tok.trim().match(/^(-?\d+(?:\.\d+)?)(deg|turn|rad)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const deg = m[2] === "turn" ? v * 360 : m[2] === "rad" ? (v * 180) / Math.PI : v;
  return ((deg % 360) + 360) % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${h2(f(0) * 255)}${h2(f(8) * 255)}${h2(f(4) * 255)}`;
}

/** Parse a typed/pasted colour to #rrggbb, or null if not recognised (alpha is dropped). */
export function colorToHex(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const hex = s.startsWith("#") ? s.slice(1) : /^[0-9a-f]{3,8}$/.test(s) && /\d/.test(s) ? s : null;
  if (hex !== null) {
    if (/^[0-9a-f]{3,4}$/.test(hex)) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(hex)) return `#${hex.slice(0, 6)}`;
    return null;
  }
  const fn = s.match(/^(rgba?|hsla?)\(([^)]*)\)$/);
  if (!fn) return null;
  // Accept "1, 2, 3" / "1 2 3" / "1 2 3 / 50%".
  const parts = fn[2].split("/")[0].split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  if (fn[1].startsWith("rgb")) {
    const c = parts.slice(0, 3).map(channel);
    if (c.some((v) => v === null)) return null;
    return `#${(c as number[]).map(h2).join("")}`;
  }
  const H = hue(parts[0]);
  const S = pct(parts[1]);
  const L = pct(parts[2]);
  if (H === null || S === null || L === null) return null;
  return hslToHex(H, S, L);
}

/** Add a colour to the recent list (newest first, unique, capped). Invalid input → list unchanged. */
export function pushRecentColor(list: unknown, hex: string): string[] {
  const clean = Array.isArray(list) ? list.filter((v): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/.test(v)) : [];
  const c = colorToHex(hex);
  if (!c) return clean.slice(0, RECENT_COLORS_MAX);
  return [c, ...clean.filter((v) => v !== c)].slice(0, RECENT_COLORS_MAX);
}

/** Parse the stored recent list safely (bad JSON / junk → []). */
export function parseRecentColors(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return pushRecentColor(JSON.parse(raw), "").slice(0, RECENT_COLORS_MAX);
  } catch {
    return [];
  }
}

export function __runColorInputTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`color-input-core FAIL: ${m}`);
    }
  };
  ok(colorToHex("#ABC") === "#aabbcc", "hex3");
  ok(colorToHex("7ed957") === "#7ed957", "bare hex6");
  ok(colorToHex("#7ed957cc") === "#7ed957", "hex8 drops alpha");
  ok(colorToHex("#12") === null && colorToHex("#ggg") === null, "bad hex");
  ok(colorToHex("rgb(255, 0, 128)") === "#ff0080", "rgb commas");
  ok(colorToHex("rgb(255 0 128 / 50%)") === "#ff0080", "rgb space + alpha");
  ok(colorToHex("rgba(100%,0%,0%,0.3)") === "#ff0000", "rgba percent");
  ok(colorToHex("rgb(300, -4, 0)") === "#ff0000", "rgb clamped");
  ok(colorToHex("hsl(120, 100%, 50%)") === "#00ff00", "hsl green");
  ok(colorToHex("hsl(0.5turn 100% 50%)") === "#00ffff", "hsl turn");
  ok(colorToHex("hsla(240deg, 100%, 25%, .5)") === "#000080", "hsla navy");
  ok(colorToHex("tomato") === null && colorToHex("") === null && colorToHex(5) === null, "names left to the browser");
  ok(colorToHex("rgb(1,2)") === null && colorToHex("rgb(a,b,c)") === null, "bad rgb");
  const r = pushRecentColor(["#111111", "#222222", "junk"], "#222");
  ok(r.join() === "#222222,#111111", "recent: dedupe, newest first, junk dropped");
  ok(pushRecentColor(Array.from({ length: 20 }, (_, i) => `#0000${String(i).padStart(2, "0")}`), "#ffffff").length === RECENT_COLORS_MAX, "recent capped");
  ok(parseRecentColors("{bad") .length === 0 && parseRecentColors('["#ABCDEF","#abcdef"]').join() === "#abcdef", "parse stored list");
  return { passed, failed };
}
