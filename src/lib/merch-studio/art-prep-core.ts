/**
 * src/lib/merch-studio/art-prep-core.ts
 *
 * D267 - Merch Studio "Artwork from library + Prep for Printful". PURE.
 *   - libraryArt(): logos first (Brand kit + Media usage logo/brand-logo/
 *     vendor-logo), then the rest of the library, de-duplicated by URL.
 *   - printVerdict(): effective DPI of a picture at the placement size vs
 *     Printful's 150 minimum / 300 ideal.
 *   - printUpscalePlan(): the pixel size to enlarge to so the art prints at
 *     300 DPI across the placement (capped per pass and overall, never shrinks).
 */
import { DPI_IDEAL, DPI_MIN } from "./print-rules-core";

export type ArtChoice = { id: string; url: string; title: string; logo: boolean; source: "brand" | "media" };
export type MediaLike = { id: string; url: string; title: string; usageType?: string | null; mimeType?: string | null };
export type BrandLogoLike = { id: string; name: string; src: string };

export const PREP_MAX_SIDE = 8000; // keeps the result well under Printful's file limits
export const PREP_MAX_PASS = 4; // never enlarge more than 4x in one go (quality)

const LOGO_USAGE = new Set(["logo", "vendor-logo", "brand-logo"]);
const PRINTABLE = /^image\/(png|jpeg|webp|svg\+xml)$/i;

export function libraryArt(media: MediaLike[], brandLogos: BrandLogoLike[]): ArtChoice[] {
  const seen = new Set<string>();
  const out: ArtChoice[] = [];
  const push = (c: ArtChoice) => {
    if (!c.url || seen.has(c.url)) return;
    seen.add(c.url);
    out.push(c);
  };
  for (const b of brandLogos) push({ id: `brand:${b.id}`, url: b.src, title: b.name || "Brand logo", logo: true, source: "brand" });
  const ok = media.filter((m) => !m.mimeType || PRINTABLE.test(m.mimeType));
  for (const m of ok) if (LOGO_USAGE.has((m.usageType ?? "").toLowerCase())) push({ id: m.id, url: m.url, title: m.title, logo: true, source: "media" });
  for (const m of ok) push({ id: m.id, url: m.url, title: m.title, logo: false, source: "media" });
  return out;
}

export type PrintVerdict = { dpi: number; level: "ideal" | "ok" | "low"; text: string };
export function printVerdict(pxW: number, pxH: number, wIn: number, hIn: number, vector = false): PrintVerdict {
  if (vector) return { dpi: Infinity, level: "ideal", text: "Vector (SVG) - prints sharp at any size." };
  if (!(pxW > 0 && pxH > 0 && wIn > 0 && hIn > 0)) return { dpi: 0, level: "low", text: "The picture size could not be read." };
  // Fit inside the placement keeping the aspect ratio, like the canvas does.
  const scale = Math.min(wIn / pxW, hIn / pxH);
  const dpi = Math.round(1 / scale);
  if (dpi >= DPI_IDEAL) return { dpi, level: "ideal", text: `${dpi} DPI at full size - ideal for Printful.` };
  if (dpi >= DPI_MIN) return { dpi, level: "ok", text: `${dpi} DPI at full size - prints, but enlarge to 300 DPI for crisp edges.` };
  return { dpi, level: "low", text: `${dpi} DPI at full size - too low (Printful needs 150+). Enlarge it, or print it smaller.` };
}

export type UpscalePlan = { ok: true; width: number; height: number; factor: number } | { ok: false; error: string };
export function printUpscalePlan(pxW: number, pxH: number, wIn: number, hIn: number): UpscalePlan {
  if (!(pxW > 0 && pxH > 0 && wIn > 0 && hIn > 0)) return { ok: false, error: "The picture size could not be read." };
  const scale = Math.min(wIn / pxW, hIn / pxH); // inches per px at full fit
  const want = 1 / scale / DPI_IDEAL; // <1 means it needs enlarging
  if (want >= 1) return { ok: false, error: "Already 300 DPI or better at this size - no enlarging needed." };
  let factor = Math.min(1 / want, PREP_MAX_PASS);
  factor = Math.min(factor, PREP_MAX_SIDE / Math.max(pxW, pxH));
  if (factor <= 1.01) return { ok: false, error: "The picture is already as large as we can make it." };
  return { ok: true, width: Math.round(pxW * factor), height: Math.round(pxH * factor), factor: Math.round(factor * 100) / 100 };
}


// ── Remove background (D268) ────────────────────────────────────────────────
// GPT Image 2 refuses transparent output and FLUX never returns alpha, so we
// key the background out ourselves: sample the border colour, then flood-fill
// from the edges (only pixels connected to the border go, so a white logo
// detail inside the art is kept). Soft edge between KEY_LO and KEY_HI.
export const KEY_LO = 38;
export const KEY_HI = 90;
export const KEY_MAX_PX = 36_000_000;
/** FLUX Kontext ask: put the logo on a flat key colour we can cut out. */
export const KEY_HEX = "#FF00FF";
export const FLUX_ISOLATE_PROMPT = "Keep this exact logo or artwork identical - same shapes, colours, text and proportions. Replace everything behind it with one perfectly flat, solid pure magenta (#FF00FF) background. No shadows, no gradients, no texture, no border.";

const dist = (d: Uint8Array | Uint8ClampedArray, i: number, c: number[]) => Math.sqrt((d[i] - c[0]) ** 2 + (d[i + 1] - c[1]) ** 2 + (d[i + 2] - c[2]) ** 2);

/** Border colour (median per channel of opaque border pixels) and how uniform the border is (0..1). */
export function borderColor(d: Uint8Array | Uint8ClampedArray, w: number, h: number): { color: number[]; uniform: number; transparent: number } {
  const idx: number[] = [];
  for (let x = 0; x < w; x++) idx.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) idx.push(y * w, y * w + w - 1);
  const opaque = idx.filter((p) => d[p * 4 + 3] > 16);
  const transparent = idx.length ? 1 - opaque.length / idx.length : 0;
  if (!opaque.length) return { color: [0, 0, 0], uniform: 0, transparent };
  const med = (k: number) => { const v = opaque.map((p) => d[p * 4 + k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const color = [med(0), med(1), med(2)];
  const uniform = opaque.filter((p) => dist(d, p * 4, color) < KEY_LO).length / opaque.length;
  return { color, uniform, transparent };
}

/** In-place key-out from the edges. Returns the fraction of pixels made (fully or partly) transparent. */
export function keyOutBackground(d: Uint8Array | Uint8ClampedArray, w: number, h: number, color: number[], lo = KEY_LO, hi = KEY_HI): number {
  const seen = new Uint8Array(w * h);
  const q = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  let cleared = 0;
  const visit = (p: number) => {
    if (seen[p]) return;
    seen[p] = 1;
    const i = p * 4;
    if (d[i + 3] <= 16) { d[i + 3] = 0; q[tail++] = p; return; }
    const e = dist(d, i, color);
    if (e < lo) { d[i + 3] = 0; cleared++; q[tail++] = p; }
    else if (e < hi) { d[i + 3] = Math.min(d[i + 3], Math.round((255 * (e - lo)) / (hi - lo))); cleared++; }
  };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (head < tail) {
    const p = q[head++];
    const x = p % w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (p >= w) visit(p - w);
    if (p < w * (h - 1)) visit(p + w);
  }
  return cleared / (w * h);
}

export function __runArtPrepTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const t = (name: string, cond: boolean) => (cond ? passed++ : failures.push(name));
  const media: MediaLike[] = [
    { id: "a", url: "https://x/a.jpg", title: "Photo", usageType: "product", mimeType: "image/jpeg" },
    { id: "b", url: "https://x/b.png", title: "Logo", usageType: "logo", mimeType: "image/png" },
    { id: "c", url: "https://x/c.gif", title: "Gif", usageType: "logo", mimeType: "image/gif" },
    { id: "d", url: "https://x/d.png", title: "Vendor", usageType: "Vendor-Logo", mimeType: "image/png" },
  ];
  const art = libraryArt(media, [{ id: "k", name: "Kit", src: "/brand/x.png" }, { id: "dup", name: "Dup", src: "https://x/b.png" }]);
  t("brand first", art[0]?.source === "brand" && art[0].logo);
  t("dedupe by url", art.filter((a) => a.url === "https://x/b.png").length === 1);
  t("gif excluded", !art.some((a) => a.id === "c"));
  t("vendor logo flagged (case-insensitive)", art.find((a) => a.id === "d")?.logo === true);
  t("photo not logo", art.find((a) => a.id === "a")?.logo === false);
  t("logos before photos", art.findIndex((a) => a.id === "d") < art.findIndex((a) => a.id === "a"));
  t("count", art.length === 4);
  t("empty", libraryArt([], []).length === 0);
  t("verdict ideal", printVerdict(3600, 3600, 12, 12).level === "ideal");
  t("verdict ok", printVerdict(2400, 2400, 12, 12).level === "ok");
  t("verdict low", printVerdict(1000, 1000, 12, 12).level === "low");
  t("verdict dpi", printVerdict(1200, 600, 12, 16).dpi === 100);
  t("verdict vector", printVerdict(0, 0, 12, 12, true).level === "ideal");
  t("verdict bad size", printVerdict(0, 10, 12, 12).level === "low");
  const p = printUpscalePlan(1200, 1200, 12, 12);
  t("plan 3x", p.ok && p.width === 3600 && p.height === 3600);
  const q = printUpscalePlan(500, 250, 12, 16);
  t("plan capped 4x", q.ok && q.factor === 4 && q.width === 2000);
  t("plan none when ideal", !printUpscalePlan(3600, 3600, 12, 12).ok);
  const big = printUpscalePlan(7000, 100, 30, 1);
  t("plan side cap", !big.ok || big.width <= PREP_MAX_SIDE);
  t("plan bad size", !printUpscalePlan(0, 0, 12, 12).ok);
  const small = printUpscalePlan(600, 600, 3, 3);
  t("plan small placement", small.ok && small.width === 900);
  // D268 key-out: 6x6 white with a 2x2 black logo in the middle and a white dot inside an enclosed ring.
  const W = 6;
  const px = new Uint8Array(W * W * 4).fill(255);
  const setPx = (x: number, y: number, v: number) => { const i = (y * W + x) * 4; px[i] = px[i + 1] = px[i + 2] = v; };
  for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) setPx(x, y, 0);
  setPx(2, 2, 255); // white detail fully enclosed by the logo - must stay
  const bc = borderColor(px, W, W);
  t("border colour white", bc.color.join() === "255,255,255" && bc.uniform === 1 && bc.transparent === 0);
  const frac = keyOutBackground(px, W, W, bc.color);
  t("corner cleared", px[3] === 0);
  t("logo kept", px[(1 * W + 1) * 4 + 3] === 255);
  t("enclosed white kept", px[(2 * W + 2) * 4 + 3] === 255);
  t("fraction", Math.abs(frac - 20 / 36) < 1e-9);
  const soft = new Uint8Array([200, 255, 255, 255]);
  keyOutBackground(soft, 1, 1, [255, 255, 255]);
  t("soft edge partial alpha", soft[3] > 0 && soft[3] < 255);
  const noisy = new Uint8Array(4 * 4 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 37) % 256));
  t("busy border not uniform", borderColor(noisy, 4, 4).uniform < 0.9);
  const clear = new Uint8Array(2 * 2 * 4);
  t("already transparent", borderColor(clear, 2, 2).transparent === 1);
  t("flux prompt mentions key colour", FLUX_ISOLATE_PROMPT.includes(KEY_HEX));
  return { passed, failed: failures.length, failures };
}
