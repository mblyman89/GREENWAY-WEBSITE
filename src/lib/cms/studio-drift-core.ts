/**
 * studio-drift-core — D234 slice C-4 (SOP-11b, G-99; F-11-25). Pure.
 *
 * Two jobs:
 *
 * 1. CHECKS AT EVERY WIDTH. Before C-4 the Checks tab looked at one width
 *    (computer, 1408) and estimated overlaps there only
 *    (`banner-design-core.ts` checkDesign "Overlap (desktop, approximate)").
 *    `widthWarnings` lays the banner out at every real width the site uses
 *    (`WIDTH_STOPS`: 1408 … 770 computer layout, 398 … 328 phone layout) with
 *    the website's own sizing (fluid `interpPx`, Scale cqw + 12 px floor, card
 *    cqw) and reports text or buttons that run past the edge, or overlap, at
 *    any of them, naming the widths.
 *
 * 2. THE DRIFT GUARD'S RULER. `cssPxAt` evaluates the inline CSS the studio
 *    and the website render (px, %, cqw, em, calc, clamp, min, max, var) at a
 *    banner width, the way a browser does, and `stylesById` reads each item's
 *    inline style out of rendered HTML. The compliance test renders the REAL
 *    `DesignedBanner` and the REAL `StudioCanvas` for fixed designs at every
 *    stop and requires every item's box to agree within 1% of the width.
 */
import {
  BUTTON_SIZE_PX,
  CARD_REF_PX,
  DESKTOP_REF_PX,
  MOBILE_REF_PX,
  SCALE_BUTTON_FLOOR_PX,
  SCALE_TEXT_FLOOR_PX,
  boxPosition,
  checkDesign,
  resolveBoxText,
  roleInfo,
  sizingOf,
  type BannerDesign,
  type DesignDevice,
  type DesignWarning,
  type SizeMode,
} from "./banner-design-core";
import type { SiteFontIds } from "./studio-fonts-core";
import { WIDTH_STOPS, canvasRefPx, fluidPxAt, layoutForWidth } from "./studio-widths-core";

type Legacy = { eyebrow?: string; title?: string; subtitle?: string };

// ── 1. Layout at a width ──────────────────────────────────────────────────

/** Text size (or button height) in px at a banner width, by sizing mode — the website's math. */
export function sizeAt(desktopPx: number, mobilePx: number, mode: SizeMode, w: number, floor: number, layout: DesignDevice = layoutForWidth(w)): number {
  const px = layout === "mobile" ? mobilePx : desktopPx;
  if (mode === "fluid") return fluidPxAt(mobilePx, desktopPx, w);
  if (mode === "card") return (px * w) / CARD_REF_PX;
  const v = (px * w) / (layout === "mobile" ? MOBILE_REF_PX : DESKTOP_REF_PX);
  return Math.max(Math.min(floor, px), v);
}

export type ItemRect = { id: string; kind: "box" | "button"; label: string; left: number; top: number; width: number; height: number };

/** Every visible text box and button as px rectangles at a banner width (text height estimated from line count). */
export function layoutAt(design: BannerDesign, w: number, legacy: Legacy = {}, layout?: DesignDevice): { W: number; H: number; device: DesignDevice; items: ItemRect[] } {
  // Cards switch layout by SCREEN width, so the caller names the layout; banners follow their width.
  const device = layout ?? layoutForWidth(w);
  const mode = sizingOf(design);
  const { w: W, h: H } = mode === "card" ? { w, h: Math.round(w / (device === "mobile" ? design.frame.card!.ratioMobile : design.frame.card!.ratio)) } : canvasRefPx(design, device, w);
  const items: ItemRect[] = [];
  for (const b of design.boxes) {
    if (b.hidden || (device === "mobile" && b.hideOnMobile)) continue;
    const text = resolveBoxText(b, legacy).trim();
    if (!text) continue;
    const p = boxPosition(b, device);
    const fs = sizeAt(b.size, b.sizeMobile, mode, w, SCALE_TEXT_FLOOR_PX, device);
    const charW = fs * (0.55 + Math.max(0, b.letterSpacing));
    const boxW = (p.w / 100) * W;
    const longest = Math.max(...text.split("\n").map((l) => l.length));
    let lines: number;
    let width = boxW;
    if (b.wrap === "nowrap") {
      lines = text.split("\n").length;
      width = longest * charW;
    } else {
      const perLine = Math.max(1, Math.floor(boxW / charW));
      lines = text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
    }
    items.push({ id: b.id, kind: "box", label: `${roleInfo(b.role).label.toLowerCase()} box`, left: (p.x / 100) * W, top: (p.y / 100) * H, width, height: lines * fs * b.lineHeight });
  }
  for (const btn of design.buttons) {
    if (!btn.enabled || (device === "mobile" && btn.hideOnMobile)) continue;
    const sz = BUTTON_SIZE_PX[btn.size];
    const h = sizeAt(sz.h, sz.hm, mode, w, SCALE_BUTTON_FLOOR_PX, device);
    const fs = sizeAt(sz.font, sz.fontM, mode, w, SCALE_TEXT_FLOOR_PX, device);
    const x = device === "mobile" ? (btn.mx ?? btn.x) : btn.x;
    const y = device === "mobile" ? (btn.my ?? btn.y) : btn.y;
    const pad = mode === "fluid" ? sz.px : (sz.px / sz.font) * fs;
    const width = btn.label.length * fs * (btn.uppercase ? 0.72 : 0.6) + 2 * pad;
    items.push({ id: btn.id, kind: "button", label: `button “${btn.label}”`, left: (x / 100) * W, top: (y / 100) * H, width, height: h });
  }
  return { W, H, device, items };
}

/** Widths a banner is checked at: the real stops (cards: their reference width, both layouts). */
export function checkWidths(design: BannerDesign): number[] {
  if (design.frame.card) return [CARD_REF_PX];
  return WIDTH_STOPS.map((s) => s.w);
}

const join = (ws: number[]) => ws.map((w) => `${w}`).join(", ");

/**
 * D234 C-4: problems that appear at one of the site's real widths. Advice only
 * (never blocks). Overlaps already reported by `checkDesign` at the computer
 * reference are not repeated.
 */
export function widthWarnings(design: BannerDesign, legacy: Legacy = {}, already: DesignWarning[] = []): DesignWarning[] {
  const edge = new Map<string, { label: string; side: string; ws: number[]; kind: "box" | "button" }>();
  const pairs = new Map<string, { a: string; b: string; bId: string; ws: number[] }>();
  const known = new Set(already.filter((x) => x.code === "OVERLAP").map((x) => x.boxId));
  const widths = checkWidths(design);
  const runs: { w: number; device: DesignDevice }[] = design.frame.card ? [{ w: CARD_REF_PX, device: "desktop" }, { w: CARD_REF_PX, device: "mobile" }] : widths.map((w) => ({ w, device: layoutForWidth(w) }));
  for (const run of runs) {
    const { W, H, items } = layoutAt(design, run.w, legacy, run.device);
    for (const it of items) {
      const sides: string[] = [];
      if (it.top + it.height > H + 1) sides.push("bottom");
      if (it.left + it.width > W + 1) sides.push("right edge");
      for (const side of sides) {
        const k = `${it.id}|${side}`;
        const e = edge.get(k) ?? { label: it.label, side, ws: [], kind: it.kind };
        if (!e.ws.includes(run.w)) e.ws.push(run.w);
        edge.set(k, e);
      }
    }
    for (let i = 0; i < items.length; i += 1)
      for (let j = i + 1; j < items.length; j += 1) {
        const a = items[i];
        const b = items[j];
        if (a.kind === "box" && b.kind === "box" && known.has(b.id)) continue;
        const ix = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
        const iy = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        if (smaller > 0 && (ix * iy) / smaller > 0.3) {
          const k = `${a.id}|${b.id}`;
          const p = pairs.get(k) ?? { a: a.label, b: b.label, bId: b.id, ws: [] };
          if (!p.ws.includes(run.w)) p.ws.push(run.w);
          pairs.set(k, p);
        }
      }
  }
  const out: DesignWarning[] = [];
  const where = (ws: number[]) => (design.frame.card ? "on the card" : `at ${join(ws)} px wide`);
  for (const [k, e] of edge) {
    const id = k.split("|")[0];
    out.push({
      code: "AT_WIDTHS",
      ...(e.kind === "box" ? { boxId: id } : { buttonId: id }),
      message: `The ${e.label} runs past the ${e.side} of the banner ${where(e.ws)}, so visitors at that size see it cut off. Look at that width (Banner width bar), then move it ${e.side === "bottom" ? "up" : "left"}, narrow it or make it smaller.`,
    });
  }
  for (const p of pairs.values()) out.push({ code: "AT_WIDTHS", boxId: p.bId, message: `The ${p.a} and the ${p.b} might overlap ${where(p.ws)}. Look at that width (Banner width bar) and move one.` });
  return out;
}

/** Every Checks message: the one-width checks plus the every-width checks (what the Checks tab shows). */
export function checkAllWidths(design: BannerDesign, legacy: Legacy = {}, siteFonts?: SiteFontIds | null): DesignWarning[] {
  const base = checkDesign(design, legacy, siteFonts);
  return [...base, ...widthWarnings(design, legacy, base)];
}

// ── 2. CSS ruler (the drift guard) ────────────────────────────────────────

export type CssCtx = { w: number; pctBase: number; em?: number; vars: Record<string, string> };

/**
 * Evaluate a CSS length the way the browser does, at container width `w`
 * (cqw = w/100). Supports px, %, cqw, em, unitless, calc, clamp, min, max and
 * var(--x, fallback). Returns NaN for anything it cannot resolve.
 */
export function cssPxAt(expr: string, ctx: CssCtx, depth = 0): number {
  if (depth > 12) return NaN;
  const src = expr.trim();
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i += 1;
  };
  const args = (): string[] => {
    // raw comma-separated args up to the matching ")"
    const out: string[] = [];
    let level = 0;
    let start = i;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === "(") level += 1;
      else if (c === ")") {
        if (level === 0) break;
        level -= 1;
      } else if (c === "," && level === 0) {
        out.push(src.slice(start, i));
        start = i + 1;
      }
    }
    out.push(src.slice(start, i));
    i += 1; // ")"
    return out;
  };
  const factor = (): number => {
    ws();
    if (src[i] === "-") {
      i += 1;
      return -factor();
    }
    if (src[i] === "(") {
      i += 1;
      const v = sum();
      ws();
      i += 1;
      return v;
    }
    const fn = /^([a-z-]+)\(/.exec(src.slice(i));
    if (fn) {
      i += fn[0].length;
      const a = args();
      const ev = (s: string) => cssPxAt(s, ctx, depth + 1);
      if (fn[1] === "var") {
        const name = a[0].trim();
        if (name in ctx.vars) return cssPxAt(ctx.vars[name], ctx, depth + 1);
        return a.length > 1 ? ev(a.slice(1).join(",")) : NaN;
      }
      if (fn[1] === "calc") return ev(a[0]);
      if (fn[1] === "clamp") return Math.min(ev(a[2]), Math.max(ev(a[0]), ev(a[1])));
      if (fn[1] === "max") return Math.max(...a.map(ev));
      if (fn[1] === "min") return Math.min(...a.map(ev));
      return NaN;
    }
    const m = /^(\d*\.?\d+(?:e-?\d+)?)(px|cqw|%|em)?/.exec(src.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    const n = Number(m[1]);
    if (m[2] === "px" || !m[2]) return n;
    if (m[2] === "cqw") return (n * ctx.w) / 100;
    if (m[2] === "%") return (n * ctx.pctBase) / 100;
    return n * (ctx.em ?? 16);
  };
  const term = (): number => {
    let v = factor();
    for (;;) {
      ws();
      const c = src[i];
      if (c !== "*" && c !== "/") return v;
      i += 1;
      const r = factor();
      v = c === "*" ? v * r : v / r;
    }
  };
  const sum = (): number => {
    let v = term();
    for (;;) {
      ws();
      const c = src[i];
      if (c !== "+" && c !== "-") return v;
      i += 1;
      const r = term();
      v = c === "+" ? v + r : v - r;
    }
  };
  const v = sum();
  ws();
  return i >= src.length ? v : NaN;
}

/** The phone-layout variable swaps from globals.css (`@container gwb` and `.gw-dcard-m` / card @media). */
export const PHONE_SWAPS: Record<string, string> = {
  "--gbx": "var(--gmx, var(--gx))",
  "--gby": "var(--gmy, var(--gy))",
  "--gbw": "var(--gmw, var(--gw))",
  "--gbh": "var(--gmh, var(--gh))",
  "--gs-fontSize": "var(--gs-fontSize-m)",
  "--gs-height": "var(--gs-height-m)",
  "--gs-ar": "var(--gs-ar-m)",
  "--gc-fontSize": "var(--gc-fontSize-m)",
  "--gc-height": "var(--gc-height-m)",
  "--gc-ar": "var(--gc-ar-m)",
};

/** Split an inline style attribute into a map (semicolons inside parentheses are kept). */
export function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  let level = 0;
  let start = 0;
  const push = (part: string) => {
    const k = part.indexOf(":");
    if (k > 0) out[part.slice(0, k).trim()] = part.slice(k + 1).trim();
  };
  for (let i = 0; i < style.length; i += 1) {
    const c = style[i];
    if (c === "(") level += 1;
    else if (c === ")") level -= 1;
    else if (c === ";" && level === 0) {
      push(style.slice(start, i));
      start = i + 1;
    }
  }
  push(style.slice(start));
  return out;
}

const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Inline styles of every element carrying `attr="id"` in rendered HTML (first one per id). */
export function stylesById(html: string, attr: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  const tag = /<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g;
  const idRe = new RegExp(`\\s${attr}="([^"]*)"`);
  for (const m of html.match(tag) ?? []) {
    const id = idRe.exec(m);
    if (!id || out.has(id[1])) continue;
    const st = /\sstyle="([^"]*)"/.exec(m);
    out.set(unescape(id[1]), parseStyle(st ? unescape(st[1]) : ""));
  }
  return out;
}

/** The first element with `class` containing `cls` → its inline style. */
export function styleOfClass(html: string, cls: string): Record<string, string> {
  for (const m of html.match(/<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g) ?? []) {
    const c = /\sclass="([^"]*)"/.exec(m);
    if (c && c[1].split(/\s+/).includes(cls)) {
      const st = /\sstyle="([^"]*)"/.exec(m);
      return parseStyle(st ? unescape(st[1]) : "");
    }
  }
  return {};
}

export type MeasuredBox = { left: number; top: number; width: number; height: number; fontSize: number };

/** Frame height (px) from the frame's inline style at width `w` (height, or aspect-ratio when height is auto). */
export function frameHeightAt(frame: Record<string, string>, w: number, phone: boolean): number {
  const vars = { ...pickVars(frame), ...(phone ? PHONE_SWAPS : {}) };
  if (frame.height && frame.height !== "auto") return cssPxAt(frame.height, { w, pctBase: 0, vars });
  const ar = cssPxAt(frame["aspect-ratio"] ?? "NaN", { w, pctBase: 0, vars });
  return w / ar;
}

function pickVars(s: Record<string, string>): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(s)) if (k.startsWith("--")) v[k] = val;
  return v;
}

/** One item's box (px) from its inline style, inside a frame of W × H, phone layout or not. */
export function measureItem(style: Record<string, string>, frameVars: Record<string, string>, W: number, H: number, phone: boolean): MeasuredBox {
  const vars = { ...frameVars, ...pickVars(style), ...(phone ? PHONE_SWAPS : {}) };
  const fontSize = style["font-size"] ? cssPxAt(style["font-size"], { w: W, pctBase: 0, vars }) : NaN;
  const em = Number.isFinite(fontSize) ? fontSize : 16;
  const at = (k: string, base: number) => (style[k] ? cssPxAt(style[k], { w: W, pctBase: base, em, vars }) : NaN);
  return { left: at("left", W), top: at("top", H), width: at("width", W), height: at("height", H), fontSize };
}

// ── self-test ─────────────────────────────────────────────────────────────

export function __runStudioDriftCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL studio-drift-core: ${m}`);
    }
  };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const c = (e: string, w = 1000, pct = 200, vars: Record<string, string> = {}) => cssPxAt(e, { w, pctBase: pct, vars });
  ok(c("12px") === 12 && c("10cqw") === 100 && c("25%") === 50, "units");
  ok(near(c("clamp(10px, calc(10px + 0.002 * (100cqw - 390px)), 12px)", 1000), 11.22), "clamp/calc like interpPx");
  ok(c("clamp(10px, calc(10px + 0.002 * (100cqw - 390px)), 12px)", 300) === 10, "clamp low end");
  ok(c("max(12px, 1cqw)", 500) === 12 && c("max(12px, 3cqw)", 500) === 15, "max floor");
  ok(c("var(--a, var(--b))", 1, 1, { "--b": "7px" }) === 7 && c("var(--a, 3px)", 1, 1, { "--a": "var(--c, 9px)" }) === 9, "var fallbacks");
  ok(Number.isNaN(c("var(--none)")) && Number.isNaN(c("bogus")), "unknown → NaN");
  ok(c("-2px + 5px") === 3 && c("(2px + 2px) * 2") === 8, "arithmetic");
  const st = parseStyle("left:var(--gbx, var(--gx));background:url(a;b);--gx:4%");
  ok(st.left === "var(--gbx, var(--gx))" && st.background === "url(a;b)" && st["--gx"] === "4%", "style parser keeps ; inside ()");
  const html = `<div><p style="left:4%;font-size:12px" data-x="a">t</p><span data-x="b" style="font-family:&quot;X&quot;"></span></div>`;
  const by = stylesById(html, "data-x");
  ok(by.get("a")?.left === "4%" && by.get("b")?.["font-family"] === '"X"', "styles read from HTML");
  const m = measureItem({ left: "var(--gbx, var(--gx))", "--gx": "10%", "--gmx": "20%", "font-size": "var(--gs-fontSize, var(--gs-fontSize-d))", "--gs-fontSize-d": "max(12px, 2cqw)", "--gs-fontSize-m": "max(12px, 5cqw)" }, {}, 400, 100, true);
  ok(m.left === 80 && m.fontSize === 20, "phone swap: phone x and phone size");
  ok(frameHeightAt({ height: "auto", "aspect-ratio": "var(--gs-ar, var(--gs-ar-d))", "--gs-ar-d": "4", "--gs-ar-m": "2" }, 800, false) === 200 && frameHeightAt({ height: "auto", "aspect-ratio": "var(--gs-ar, var(--gs-ar-d))", "--gs-ar-d": "4", "--gs-ar-m": "2" }, 300, true) === 150, "frame height from shape");
  ok(sizeAt(48, 24, "fluid", 1408, 12) === 48 && sizeAt(48, 24, "scale", 704, 12, "desktop") === 24 && sizeAt(14, 14, "scale", 328, 12) === 12, "sizeAt by mode (floor)");
  ok(sizeAt(30, 30, "card", 160, 12) === 15 && sizeAt(30, 20, "card", 320, 12, "mobile") === 20, "card sizes follow the card (layout named)");
  // checks at widths
  const base: BannerDesign = {
    v: 1,
    enabled: true,
    frame: { height: 260, heightMobile: 200, radius: 16 },
    image: { focusX: 50, focusY: 50, focusXMobile: null, focusYMobile: null, zoom: 100, brightness: 100, saturation: 100, blur: 0, flip: false },
    overlay: { kind: "none", color: "#000000", opacity: 0, direction: "left" },
    boxes: [],
    buttons: [],
  };
  const box = (id: string, y: number, size: number, sizeMobile: number, text: string) => ({ id, role: "subhead" as const, bind: null, text, x: 4, y, w: 40, mx: null, my: null, mw: null, align: "left" as const, font: "inter", size, sizeMobile, weight: 700, italic: false, underline: false, strike: false, transform: "none" as const, color: "#fff", opacity: 100, letterSpacing: 0, lineHeight: 1.2, shadow: "none" as const, outline: false, backdrop: "none" as const, backdropColor: "#000", backdropOpacity: 0, wrap: "normal" as const, hidden: false, hideOnMobile: false });
  const fine = { ...base, boxes: [box("a", 10, 20, 16, "Short")] };
  ok(widthWarnings(fine).length === 0, "a short line fits at every width");
  const tall = { ...base, boxes: [box("a", 70, 24, 20, "This sentence is long enough to wrap onto several lines on a phone screen for sure")] };
  const tw = widthWarnings(tall);
  ok(tw.some((x) => x.code === "AT_WIDTHS" && x.boxId === "a" && x.message.includes("bottom") && x.message.includes("328")), "text past the bottom on phones is named with the widths");
  ok(!tw.some((x) => x.message.includes("1408 px")) || tw[0].message.includes("328"), "widths listed");
  const ovl = { ...base, boxes: [box("a", 40, 20, 18, "Hello"), { ...box("b", 60, 20, 18, "World"), my: 40 }] };
  ok(widthWarnings(ovl).some((x) => x.message.includes("overlap") && x.message.includes("398") && !x.message.includes("1408")), "phone-only overlap found (phone widths only)");
  ok(checkAllWidths(ovl).some((x) => x.code === "AT_WIDTHS") && checkAllWidths(fine).every((x) => x.code !== "AT_WIDTHS"), "checkAllWidths adds width warnings");
  const hidden = { ...tall, boxes: tall.boxes.map((b) => ({ ...b, hideOnMobile: true })) };
  ok(!widthWarnings(hidden).some((x) => x.message.includes("328")), "hidden on phones = not checked on phones");
  return { passed, failed };
}
