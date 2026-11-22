/**
 * D263 S9 - finishing helpers (pure):
 *  - die-cut lines for stickers: shape -> editor guide (CSS %) and a PDF path
 *    (points) that PrintExport strokes in a "CutContour" spot colour, the
 *    name cutters and print shops look for;
 *  - Vistaprint helpers: product page, upload size and a ready-to-upload
 *    checklist per preset. Everything is advice - nothing blocks.
 */
import type { DesignCut, DesignPrint } from "@/lib/cms/banner-design-core";
import type { PrintPreset } from "./print-sizes-core";

export const CUT_SPOT = "CutContour";
export const CUT_SHAPES: { id: DesignCut["shape"] | "none"; label: string }[] = [
  { id: "none", label: "No cut line (straight trim)" },
  { id: "rect", label: "Square corners" },
  { id: "rounded", label: "Rounded corners" },
  { id: "circle", label: "Circle / oval" },
];
export const DEFAULT_CUT: DesignCut = { shape: "rounded", radius: 0.125, offset: 0 };

export type Rect = { x: number; y: number; w: number; h: number };
export type PathOp = { op: "M" | "L"; x: number; y: number } | { op: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { op: "Z" };

const K = 0.5523; // bezier circle constant
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The cut rectangle (trim moved in by offset), same units as `trim`; `perIn` = units per inch. */
function cutRect(cut: DesignCut, trim: Rect, perIn: number): Rect {
  const o = cut.offset * perIn;
  return { x: trim.x + o, y: trim.y + o, w: Math.max(0, trim.w - 2 * o), h: Math.max(0, trim.h - 2 * o) };
}

/** PDF path for the cut line. trim in points (y up). */
export function cutPath(cut: DesignCut, trim: Rect, perIn = 72): PathOp[] {
  const c = cutRect(cut, trim, perIn);
  const { x, y, w, h } = c;
  if (cut.shape === "circle") {
    const rx = w / 2, ry = h / 2, cx = x + rx, cy = y + ry;
    return [
      { op: "M", x: r2(cx + rx), y: r2(cy) },
      { op: "C", x1: r2(cx + rx), y1: r2(cy + K * ry), x2: r2(cx + K * rx), y2: r2(cy + ry), x: r2(cx), y: r2(cy + ry) },
      { op: "C", x1: r2(cx - K * rx), y1: r2(cy + ry), x2: r2(cx - rx), y2: r2(cy + K * ry), x: r2(cx - rx), y: r2(cy) },
      { op: "C", x1: r2(cx - rx), y1: r2(cy - K * ry), x2: r2(cx - K * rx), y2: r2(cy - ry), x: r2(cx), y: r2(cy - ry) },
      { op: "C", x1: r2(cx + K * rx), y1: r2(cy - ry), x2: r2(cx + rx), y2: r2(cy - K * ry), x: r2(cx + rx), y: r2(cy) },
      { op: "Z" },
    ];
  }
  const r = cut.shape === "rounded" ? Math.min(cut.radius * perIn, w / 2, h / 2) : 0;
  if (r <= 0) return [{ op: "M", x: r2(x), y: r2(y) }, { op: "L", x: r2(x + w), y: r2(y) }, { op: "L", x: r2(x + w), y: r2(y + h) }, { op: "L", x: r2(x), y: r2(y + h) }, { op: "Z" }];
  const k = r * (1 - K);
  return [
    { op: "M", x: r2(x + r), y: r2(y) },
    { op: "L", x: r2(x + w - r), y: r2(y) },
    { op: "C", x1: r2(x + w - k), y1: r2(y), x2: r2(x + w), y2: r2(y + k), x: r2(x + w), y: r2(y + r) },
    { op: "L", x: r2(x + w), y: r2(y + h - r) },
    { op: "C", x1: r2(x + w), y1: r2(y + h - k), x2: r2(x + w - k), y2: r2(y + h), x: r2(x + w - r), y: r2(y + h) },
    { op: "L", x: r2(x + r), y: r2(y + h) },
    { op: "C", x1: r2(x + k), y1: r2(y + h), x2: r2(x), y2: r2(y + h - k), x: r2(x), y: r2(y + h - r) },
    { op: "L", x: r2(x), y: r2(y + r) },
    { op: "C", x1: r2(x), y1: r2(y + k), x2: r2(x + k), y2: r2(y), x: r2(x + r), y: r2(y) },
    { op: "Z" },
  ];
}

/** Editor guide for the cut: inset % of the canvas and CSS border-radius. */
export function cutGuide(print: DesignPrint): { left: number; top: number; right: number; bottom: number; radius: string } | null {
  const cut = print.cut;
  if (!cut) return null;
  const W = print.w + 2 * print.bleed, H = print.h + 2 * print.bleed;
  const ix = ((print.bleed + cut.offset) / W) * 100, iy = ((print.bleed + cut.offset) / H) * 100;
  const cw = print.w - 2 * cut.offset, ch = print.h - 2 * cut.offset;
  const radius = cut.shape === "circle" ? "50%" : cut.shape === "rounded" ? `${r2((Math.min(cut.radius, cw / 2, ch / 2) / cw) * 100)}% / ${r2((Math.min(cut.radius, cw / 2, ch / 2) / ch) * 100)}%` : "0";
  return { left: r2(ix), right: r2(ix), top: r2(iy), bottom: r2(iy), radius };
}

/** Warn-only tips for the cut line. */
export function cutTips(print: DesignPrint): string[] {
  const c = print.cut;
  if (!c) return [];
  const t: string[] = [];
  if (print.bleed <= 0) t.push("This size has no bleed - colour may stop short of the cut. Pick a sticker size (they add bleed).");
  if (c.shape === "circle" && Math.abs(print.w - print.h) > 0.01) t.push("The size isn't square, so the circle cut is an oval.");
  if (c.shape === "rounded" && c.radius < 0.0625) t.push("Very small corner radius - cutters round corners anyway; 1/8\" looks cleaner.");
  if (print.safe < 0.0625 + c.offset) t.push("Keep words at least 1/8\" inside the pink cut line - cutters can drift.");
  return t;
}

// Vistaprint helpers ---------------------------------------------------------

const VP = "https://www.vistaprint.com";
/** Vistaprint account page (sends you to their sign-in when logged out). */
export const VISTAPRINT_LOGIN_URL = `${VP}/my-account/`;
export type VistaprintHelp = { product: string; url: string; uploadIn: string; uploadPx: string; steps: string[] };

export function vistaprintHelp(p: PrintPreset, dpi: number): VistaprintHelp {
  const g = p.group;
  const [product, path] =
    g === "Business cards" ? ["Business cards", "/business-cards"]
    : g === "Stickers & decals" ? ["Stickers", "/stickers"]
    : g === "Yard & A-frame signs" ? ["Yard signs", "/signs-posters/yard-signs"]
    : g === "Posters & boards" ? ["Posters", "/signs-posters/posters"]
    : g === "Flyers & cards" ? ["Flyers", "/marketing-materials/flyers"]
    : g === "Banners" || g === "Upright banners" || g === "Flags" ? ["Banners", "/signs-posters/banners"]
    : ["Signs & posters", "/signs-posters/posters"];
  const W = p.w + 2 * p.bleed, H = p.h + 2 * p.bleed;
  const steps = [
    `On Vistaprint pick ${product} at exactly ${p.w}" x ${p.h}".`,
    'Choose "Upload your design" (not a Vistaprint template).',
    'Download "PDF for Vistaprint" here and upload that file.',
    `Check the file is ${r2(W)}" x ${r2(H)}" (trim + bleed) - Vistaprint shows a warning if not.`,
    "In the preview, the dashed lines are their cut and safe lines: words inside, background past the edge.",
    "Read every word on the proof (prices, phone, 21+ line) before you approve.",
  ];
  if (g === "Business cards") steps.push("For a back side, upload the Back page as the second side (download each page or the 2-page PDF).");
  if (g === "Stickers & decals") steps.push("Pick the same cut shape on Vistaprint (square, rounded, circle) as your pink cut line.");
  return { product, url: `${VP}${path}`, uploadIn: `${r2(W)}" x ${r2(H)}"`, uploadPx: `${Math.round(W * dpi).toLocaleString()} x ${Math.round(H * dpi).toLocaleString()} px`, steps };
}

export function __runPrintFinishTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const ok = (c: boolean, m: string) => (c ? passed++ : failures.push(m));
  const trim = { x: 9, y: 9, w: 216, h: 216 };
  const rect = cutPath({ shape: "rect", radius: 0, offset: 0 }, trim);
  ok(rect.length === 5 && rect[2].op === "L" && rect[2].x === 225 && rect[2].y === 225, "rect path");
  const circ = cutPath({ shape: "circle", radius: 0, offset: 0 }, trim);
  ok(circ.length === 6 && circ[0].op === "M" && circ[0].x === 225 && circ[0].y === 117, "circle path");
  const rnd = cutPath({ shape: "rounded", radius: 0.25, offset: 0.125 }, trim);
  ok(rnd.length === 10 && rnd[0].op === "M" && rnd[0].x === 9 + 9 + 18 && rnd[0].y === 18, "rounded + offset");
  const big = cutPath({ shape: "rounded", radius: 99, offset: 0 }, trim);
  ok(big[0].op === "M" && big[0].x === 117, "radius clamps to half");
  const p3: DesignPrint = { w: 3, h: 3, bleed: 0.125, safe: 0.125, cut: { shape: "circle", radius: 0, offset: 0 } };
  const g = cutGuide(p3)!;
  ok(g.radius === "50%" && g.left === r2((0.125 / 3.25) * 100), "guide");
  ok(cutGuide({ w: 3, h: 3, bleed: 0, safe: 0 }) === null, "no cut no guide");
  ok(cutTips({ ...p3, w: 3, h: 2 }).some((t) => t.includes("oval")) && cutTips({ ...p3, bleed: 0 }).length >= 1 && cutTips({ ...p3, safe: 0 }).length === 1, "tips");
  const bc = vistaprintHelp({ id: "bc-standard", group: "Business cards", label: "", w: 3.5, h: 2, vendor: "vistaprint", placement: "handout", viewFt: 1, bleed: 0.055, safe: 0.125, verified: true }, 300);
  ok(bc.url.endsWith("/business-cards") && bc.uploadIn === '3.61" x 2.11"' && bc.uploadPx === "1,083 x 633 px" && bc.steps.some((s) => s.includes("Back")), "vp business card");
  const st = vistaprintHelp({ id: "sticker-3", group: "Stickers & decals", label: "", w: 3, h: 3, vendor: "vistaprint", placement: "sticker", viewFt: 1, bleed: 0.125, safe: 0.125, verified: true }, 300);
  ok(st.url.endsWith("/stickers") && st.steps.some((s) => s.includes("cut shape")), "vp sticker");
  return { passed, failed: failures.length, failures };
}
