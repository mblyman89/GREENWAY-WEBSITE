/**
 * src/lib/enrichment/text-erase-core.ts  (D244 round 3, slice R-9)
 *
 * Owner (verbatim): "I need a way to remove text on a product picture. I want
 * to drag a box over the text, then click a button to remove it. Maybe on the
 * product image card in the main enrichment table, that has the attach and
 * attach as cover buttons, add a remove text button. If there is the perfect
 * image for a product, but it has a different name on it, I want the ai to
 * help recommend the name to be removed from the image. Can we use flux for
 * this or is one of the other ai models we use."
 *
 * Pure: boxes (fractions of the picture, 0..1), the black/white mask FLUX
 * Fill paints into (white = redraw), the AI "find the text" prompt and its
 * parser, and the keep/remove advice for each piece of text against THIS
 * product (a different strain name or size is advised for removal; this
 * product's own name, the brand and required warnings are kept).
 *
 * Nothing here writes. The editor shows the advice; a person draws/accepts
 * the boxes and presses "Remove text"; the result is a NEW library photo
 * (the original is never changed) that a person then attaches.
 */
import { tokenize } from "@/lib/media/product-link-core";

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

/** A rectangle as fractions of the picture (0..1), top-left origin. */
export type EraseBox = { x: number; y: number; w: number; h: number };

export const ERASE_BOXES_MAX = 12;
/** Smaller than 0.5% of a side is a stray click, not a box. */
export const ERASE_BOX_MIN = 0.005;
/** Grow each box by 1.5% of the side so letter edges are inside the mask. */
export const ERASE_BOX_PAD = 0.015;
/** More than 60% of the picture is not "remove some text". */
export const ERASE_AREA_MAX = 0.6;

const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** One box, clamped to the picture; null when it is not a usable box. */
export function cleanBox(raw: unknown): EraseBox | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  let x = num(r.x);
  let y = num(r.y);
  let w = num(r.w);
  let h = num(r.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  const x0 = clamp01(x);
  const y0 = clamp01(y);
  const x1 = clamp01(x + w);
  const y1 = clamp01(y + h);
  if (x1 - x0 < ERASE_BOX_MIN || y1 - y0 < ERASE_BOX_MIN) return null;
  return { x: round4(x0), y: round4(y0), w: round4(x1 - x0), h: round4(y1 - y0) };
}

/** The boxes a form posted (JSON array), cleaned and capped. */
export function parseEraseBoxes(raw: unknown): EraseBox[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw.slice(0, 8000));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: EraseBox[] = [];
  for (const b of arr) {
    const c = cleanBox(b);
    if (c) out.push(c);
    if (out.length >= ERASE_BOXES_MAX) break;
  }
  return out;
}

/** Grow a box a little (letters' edges must be inside the mask). */
export function padBox(b: EraseBox, pad: number = ERASE_BOX_PAD): EraseBox {
  return cleanBox({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad }) ?? b;
}

/** Share of the picture the boxes cover (overlaps counted on a 100×100 grid). */
export function boxesArea(boxes: readonly EraseBox[]): number {
  const N = 100;
  const grid = new Uint8Array(N * N);
  for (const b of boxes) {
    const x0 = Math.floor(b.x * N);
    const y0 = Math.floor(b.y * N);
    const x1 = Math.min(N, Math.ceil((b.x + b.w) * N));
    const y1 = Math.min(N, Math.ceil((b.y + b.h) * N));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * N + x] = 1;
  }
  let n = 0;
  for (const v of grid) n += v;
  return n / (N * N);
}

export type EraseCheck = { ok: true; boxes: EraseBox[] } | { ok: false; error: string };

/** Ready to send? Pads the boxes and refuses empty / whole-picture masks. */
export function checkEraseBoxes(boxes: readonly EraseBox[]): EraseCheck {
  if (boxes.length === 0) return { ok: false, error: "Drag a box over the text first (or press “Find the text”)." };
  const padded = boxes.slice(0, ERASE_BOXES_MAX).map((b) => padBox(b));
  if (boxesArea(padded) > ERASE_AREA_MAX) return { ok: false, error: "The boxes cover most of the picture. Draw them tighter around the text." };
  return { ok: true, boxes: padded };
}

/** Pixel rectangle of a box on a w×h picture (whole pixels, inside the picture). */
export function boxPixels(b: EraseBox, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.floor(b.x * width));
  const top = Math.max(0, Math.floor(b.y * height));
  const right = Math.min(width, Math.ceil((b.x + b.w) * width));
  const bottom = Math.min(height, Math.ceil((b.y + b.h) * height));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

/** The FLUX Fill mask as SVG: black picture, white boxes (white = redraw). */
export function eraseMaskSvg(width: number, height: number, boxes: readonly EraseBox[]): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const rects = boxes
    .map((b) => {
      const p = boxPixels(b, w, h);
      return `<rect x="${p.left}" y="${p.top}" width="${p.width}" height="${p.height}" fill="#fff"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#000"/>${rects}</svg>`;
}

// ---------------------------------------------------------------------------
// FLUX Fill prompt and the saved result
// ---------------------------------------------------------------------------

/**
 * D244 R-17 (owner round 6): "Flux adds weird things to the removed text.
 * Barcodes, more text, fuzzy looking text, etc." Fixed per BFL's own docs:
 *   - FLUX Erase (docs.bfl.ai/flux_tools/flux_erase) is BFL's purpose-built
 *     remover: "No prompt is needed - the model uses a built-in erase
 *     instruction", mask + dilate_pixels (0-25, default 10), trained on ~1 MP.
 *     A Fill prompt that says "no text" made FLUX paint text: "FLUX models
 *     don't support negative prompts... the model focuses on the word"
 *     (docs.bfl.ai/guides/prompting_guide_t2i_negative).
 *   - The answer is pasted back over the ORIGINAL through a feathered mask, so
 *     every pixel outside the boxes is the untouched original (the standard
 *     inpaint "paste back" / crop-and-stitch practice).
 *   - FLUX Fill stays only as the fallback when the BFL project has no Erase
 *     access, with a positive-only prompt ("clean, blank, unmarked").
 */
export const ERASE_MODEL = "flux-tools/erase-v1";
/** Fallback when the BFL project cannot use Erase (403/404/405). */
export const ERASE_FALLBACK_MODEL = "flux-pro-1.0-fill";
/** BFL: "Range 0-25, default 10". Text edges carry JPEG halos, so a bit more. */
export const ERASE_DILATE_PX = 12;
/**
 * D244 R-20: a letters-only mask already carries its own halo (strokeGrowPx),
 * so Erase grows it less - BFL: dilate "10" for typical SAM masks, more only
 * when the mask is loose. Keeps thin letters thin, not merged back into a box.
 */
export const ERASE_LETTERS_DILATE_PX = 6;
/** The Erase dilation for a mask mode. */
export function eraseDilateFor(mode: EraseMaskMode): number {
  return mode === "letters" ? ERASE_LETTERS_DILATE_PX : ERASE_DILATE_PX;
}
/** BFL: Erase "was trained on images at ~1 megapixel". */
export const ERASE_TARGET_PIXELS = 1_000_000;

/** The size to send: scaled DOWN (never up) to about 1 MP, multiples of 16. */
export function eraseSendSize(width: number, height: number, target = ERASE_TARGET_PIXELS): { width: number; height: number; scale: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, Math.sqrt(target / (w * h)));
  if (scale >= 1) return { width: w, height: h, scale: 1 };
  const r16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  const sw = r16(w * scale);
  const sh = r16(h * scale);
  return { width: sw, height: sh, scale: sw / w };
}

/** FLUX Erase request body (no prompt, by design). */
export function eraseBody(p: { imageB64: string; maskB64: string; dilatePixels?: number }): Record<string, unknown> {
  const d = Math.round(Math.min(25, Math.max(0, p.dilatePixels ?? ERASE_DILATE_PX)));
  return { image: p.imageB64, mask: p.maskB64, dilate_pixels: d, output_format: "png" };
}

/** Is this Erase failure "the project cannot use Erase" (so try Fill)? Busy / no credits are not. */
export function eraseUnavailable(error: string): boolean {
  if (/busy|out of credits/i.test(error)) return false;
  return /\((403|404|405)\)|rejected the API key|not found|forbidden/i.test(error);
}

/**
 * The paste-back mask on the ORIGINAL picture: the boxes grown by half the
 * Erase dilation (scaled to the original), then feathered by `featherPx`, so
 * the soft edge lands inside what Erase repainted and nothing outside moves.
 */
export function pasteBackPlan(sendScale: number, dilatePx = ERASE_DILATE_PX): { growPx: number; featherPx: number } {
  const s = sendScale > 0 ? sendScale : 1;
  const grow = Math.max(1, Math.round(dilatePx / 2 / s));
  const feather = Math.max(1.5, Math.min(12, dilatePx / 3 / s));
  return { growPx: grow, featherPx: Math.round(feather * 10) / 10 };
}

/** RGB pixels + one alpha channel -> RGBA (for the paste-back overlay). */
export function interleaveRgba(rgb: Uint8Array, alpha: Uint8Array): Uint8Array {
  const n = alpha.length;
  if (rgb.length !== n * 3) throw new Error("paste-back: picture and mask sizes differ");
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = alpha[i];
  }
  return out;
}

/** Boxes grown by `growPx` pixels on each side (still inside the picture). */
export function growBoxes(boxes: readonly EraseBox[], width: number, height: number, growPx: number): EraseBox[] {
  const gx = growPx / Math.max(1, width);
  const gy = growPx / Math.max(1, height);
  return boxes.map((b) => {
    const x = Math.max(0, b.x - gx);
    const y = Math.max(0, b.y - gy);
    return { x, y, w: Math.min(1, b.x + b.w + gx) - x, h: Math.min(1, b.y + b.h + gy) - y };
  });
}

// ---------------------------------------------------------------------------
// D244 R-20: crop-and-stitch at Erase's native size + a letters-only mask
// ---------------------------------------------------------------------------
//
// Owner (round 7, verbatim): "If this is an actual feature flux has, the
// results should be significantly better in my opinion. Rather than us just
// trying to use it in a way it's not meant to be used. We are not doing
// something right."
//
// He was right. What went wrong, and the fix, per the sources:
//   1. SIZE. BFL: Erase "was trained on images at ~1 megapixel ... significant
//      deviations may reduce quality". eraseSendSize only shrank, so a 550 x
//      550 product shot (0.3 MP) went in at 0.3 MP, and the label text was a
//      few pixels tall. Fix (the ComfyUI Inpaint-CropAndStitch practice): crop
//      a context window around the boxes and ENLARGE it to about 1 MP (aspect
//      kept inside BFL's 1:2..2:1, sides in 16s), then shrink the answer back
//      and stitch it in. A big phone photo also gains: the text area is sent
//      at full detail instead of the whole photo squeezed to 1 MP.
//   2. MASK SHAPE. BFL's tips are written for "typical SAM (Segment Anything)
//      masks" that follow the object. Roy & Stenger, "Text Removal in
//      E-Commerce Images" (BMVC 2024): the mask "is crucial" - masks that
//      follow the letter strokes beat bounding boxes, and diffusion models
//      hallucinate new text into big boxes. Fix: inside each box only the
//      pixels that stand out from the local background (the letters) are
//      masked (a median background, a robust MAD threshold, a small grow). A
//      thin mask leaves the model nothing to invent text into - it just
//      continues the label colour and pattern around each letter.
//   3. The answer is stitched back through the same letters mask (grown by
//      half Erase's dilation, feathered), so even inside a box the label
//      between the letters stays the original pixels.

/** What is masked inside each box: the letters only (R-20 default) or the whole box. */
export type EraseMaskMode = "letters" | "boxes";

/** A pixel rectangle (whole pixels). */
export type PxRect = { left: number; top: number; width: number; height: number };

/** Context margin around the boxes, as a share of their larger side. */
export const ERASE_CONTEXT = 0.75;
/** The crop is at least this share of the photo's shorter side. */
export const ERASE_CONTEXT_MIN = 0.4;
/** Never enlarge more than 4x (beyond that the photo has no detail left to add). */
export const ERASE_UPSCALE_MAX = 4;
/** BFL: trained on "9 aspect ratios from 1:2 to 2:1". */
export const ERASE_ASPECT_MAX = 2;

const r16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);

/** The union of the boxes in pixels. */
export function boxesUnion(boxes: readonly EraseBox[], width: number, height: number): PxRect {
  let l = width;
  let t = height;
  let r = 0;
  let b = 0;
  for (const bx of boxes) {
    const p = boxPixels(bx, width, height);
    l = Math.min(l, p.left);
    t = Math.min(t, p.top);
    r = Math.max(r, p.left + p.width);
    b = Math.max(b, p.top + p.height);
  }
  if (r <= l || b <= t) return { left: 0, top: 0, width: Math.max(1, width), height: Math.max(1, height) };
  return { left: l, top: t, width: r - l, height: b - t };
}

/** Place a span of `len` centred on `mid`, inside 0..max. */
function place(mid: number, len: number, max: number): [number, number] {
  const L = Math.min(max, Math.max(1, Math.round(len)));
  const start = Math.min(max - L, Math.max(0, Math.round(mid - L / 2)));
  return [start, L];
}

/**
 * Crop-and-stitch plan: the context window around the boxes (on the upright
 * original) and the size it is sent at - about 1 MP, enlarged when the photo
 * is small, aspect inside 1:2..2:1, sides in multiples of 16.
 */
export function eraseCropPlan(
  width: number,
  height: number,
  boxes: readonly EraseBox[],
  target = ERASE_TARGET_PIXELS,
): { crop: PxRect; send: { width: number; height: number }; scale: number } {
  const W = Math.max(1, Math.round(width));
  const H = Math.max(1, Math.round(height));
  const u = boxesUnion(boxes, W, H);
  const margin = Math.max(24, Math.round(Math.max(u.width, u.height) * ERASE_CONTEXT));
  const minSide = Math.round(Math.min(W, H) * ERASE_CONTEXT_MIN);
  let cw = Math.max(u.width + 2 * margin, minSide);
  let ch = Math.max(u.height + 2 * margin, minSide);
  if (cw > ERASE_ASPECT_MAX * ch) ch = Math.ceil(cw / ERASE_ASPECT_MAX);
  if (ch > ERASE_ASPECT_MAX * cw) cw = Math.ceil(ch / ERASE_ASPECT_MAX);
  cw = Math.min(cw, W);
  ch = Math.min(ch, H);
  // A very wide/tall photo: trim the long side back inside 2:1 (never below the boxes).
  if (cw > ERASE_ASPECT_MAX * ch) cw = Math.max(u.width, ERASE_ASPECT_MAX * ch);
  if (ch > ERASE_ASPECT_MAX * cw) ch = Math.max(u.height, ERASE_ASPECT_MAX * cw);
  const [left, cwi] = place(u.left + u.width / 2, cw, W);
  const [top, chi] = place(u.top + u.height / 2, ch, H);
  const s = Math.min(ERASE_UPSCALE_MAX, Math.sqrt(target / (cwi * chi)));
  const sw = r16(cwi * s);
  const sh = r16(chi * s);
  return { crop: { left, top, width: cwi, height: chi }, send: { width: sw, height: sh }, scale: Math.round((sw / cwi) * 1000) / 1000 };
}

/** A box (fractions of the photo) as a pixel rect inside `crop`. */
export function boxInCrop(b: EraseBox, width: number, height: number, crop: PxRect): PxRect | null {
  const p = boxPixels(b, width, height);
  const l = Math.max(p.left, crop.left);
  const t = Math.max(p.top, crop.top);
  const r = Math.min(p.left + p.width, crop.left + crop.width);
  const bt = Math.min(p.top + p.height, crop.top + crop.height);
  if (r <= l || bt <= t) return null;
  return { left: l - crop.left, top: t - crop.top, width: r - l, height: bt - t };
}

export type CropPlan = ReturnType<typeof eraseCropPlan>;

/** The boxes as pixel rects on the SENT (cropped + resized) picture. */
export function sendRects(boxes: readonly EraseBox[], width: number, height: number, plan: CropPlan): PxRect[] {
  const sx = plan.send.width / plan.crop.width;
  const sy = plan.send.height / plan.crop.height;
  const out: PxRect[] = [];
  for (const b of boxes) {
    const r = boxInCrop(b, width, height, plan.crop);
    if (!r) continue;
    const left = Math.max(0, Math.floor(r.left * sx));
    const top = Math.max(0, Math.floor(r.top * sy));
    const right = Math.min(plan.send.width, Math.ceil((r.left + r.width) * sx));
    const bottom = Math.min(plan.send.height, Math.ceil((r.top + r.height) * sy));
    if (right > left && bottom > top) out.push({ left, top, width: right - left, height: bottom - top });
  }
  return out;
}

/** Pixels above the background by at least this much are letters (0-255). */
export const STROKE_MIN_DEV = 22;
/** ...and above 3 robust standard deviations of the box's own noise... */
export const STROKE_MAD_K = 3;
/** ...but never asking more than 60 (a box across two colours inflates the noise; letters stand out by more). */
export const STROKE_MAX_DEV = 60;
/** Letters found in less than 1% / more than 60% of a box: mask the whole box. */
export const STROKE_COVER_MIN = 0.01;
export const STROKE_COVER_MAX = 0.6;
/** Grow the letters by 2 px of the ORIGINAL photo so the soft/JPEG halo round each letter goes too. */
export const STROKE_GROW_PX = 2;

/** The grow in sent pixels for a crop enlarged `scale` times (2..12). */
export function strokeGrowPx(scale: number): number {
  return Math.max(STROKE_GROW_PX, Math.min(12, Math.round(STROKE_GROW_PX * (scale > 0 ? scale : 1))));
}

/** Median (0-255) of a histogram holding `n` values. */
function histMedian(hist: Uint32Array, n: number): number {
  const half = (n + 1) >> 1;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= half) return v;
  }
  return 255;
}

/**
 * The local background of one colour plane over `rect`: a sliding median
 * with a window of `win` px (on a k-times smaller copy when the window is
 * big, so it stays fast), read back by bilinear sampling.
 */
function backgroundPlane(plane: Uint8Array, w: number, h: number, rect: PxRect, win: number): Float32Array {
  const rad = win >> 1;
  const x0 = Math.max(0, rect.left - rad);
  const y0 = Math.max(0, rect.top - rad);
  const x1 = Math.min(w, rect.left + rect.width + rad);
  const y1 = Math.min(h, rect.top + rect.height + rad);
  const k = Math.max(1, Math.ceil(win / 24));
  const dw = Math.max(1, Math.ceil((x1 - x0) / k));
  const dh = Math.max(1, Math.ceil((y1 - y0) / k));
  const ds = new Uint8Array(dw * dh);
  for (let dy = 0; dy < dh; dy++)
    for (let dx = 0; dx < dw; dx++) {
      let s = 0;
      let c = 0;
      for (let y = y0 + dy * k; y < Math.min(y1, y0 + dy * k + k); y++)
        for (let x = x0 + dx * k; x < Math.min(x1, x0 + dx * k + k); x++) {
          s += plane[y * w + x];
          c++;
        }
      ds[dy * dw + dx] = c ? Math.round(s / c) : 0;
    }
  const r = Math.max(1, Math.round(rad / k));
  const med = new Uint8Array(dw * dh);
  const hist = new Uint32Array(256);
  const at = (x: number, y: number) => ds[Math.min(dh - 1, Math.max(0, y)) * dw + Math.min(dw - 1, Math.max(0, x))];
  const n = (2 * r + 1) * (2 * r + 1);
  for (let y = 0; y < dh; y++) {
    hist.fill(0);
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = -r; xx <= r; xx++) hist[at(xx, yy)]++;
    med[y * dw] = histMedian(hist, n);
    for (let x = 1; x < dw; x++) {
      for (let yy = y - r; yy <= y + r; yy++) {
        hist[at(x - r - 1, yy)]--;
        hist[at(x + r, yy)]++;
      }
      med[y * dw + x] = histMedian(hist, n);
    }
  }
  const out = new Float32Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    const fy = Math.min(dh - 1, Math.max(0, (rect.top + y - y0 + 0.5) / k - 0.5));
    const iy = Math.floor(fy);
    const iy2 = Math.min(dh - 1, iy + 1);
    const ty = fy - iy;
    for (let x = 0; x < rect.width; x++) {
      const fx = Math.min(dw - 1, Math.max(0, (rect.left + x - x0 + 0.5) / k - 0.5));
      const ix = Math.floor(fx);
      const ix2 = Math.min(dw - 1, ix + 1);
      const tx = fx - ix;
      const a = med[iy * dw + ix] * (1 - tx) + med[iy * dw + ix2] * tx;
      const b = med[iy2 * dw + ix] * (1 - tx) + med[iy2 * dw + ix2] * tx;
      out[y * rect.width + x] = a * (1 - ty) + b * ty;
    }
  }
  return out;
}

/** Grow a 0/255 mask by `r` px (square), separable. */
export function dilateMask(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let xx = Math.max(0, x - r); xx <= Math.min(w - 1, x + r) && !v; xx++) v = mask[y * w + xx];
      tmp[y * w + x] = v ? 255 : 0;
    }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(h - 1, y + r) && !v; yy++) v = tmp[yy * w + x];
      out[y * w + x] = v ? 255 : 0;
    }
  return out;
}

/** Drop specks smaller than `min` pixels (8-connected) inside `rect`. */
function dropSpecks(mask: Uint8Array, w: number, rect: PxRect, min: number): void {
  const seen = new Uint8Array(rect.width * rect.height);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let y = 0; y < rect.height; y++)
    for (let x = 0; x < rect.width; x++) {
      const li = y * rect.width + x;
      if (seen[li] || !mask[(rect.top + y) * w + rect.left + x]) continue;
      seen[li] = 1;
      stack.push(li);
      comp.length = 0;
      while (stack.length) {
        const c = stack.pop()!;
        comp.push(c);
        const cx = c % rect.width;
        const cy = (c / rect.width) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= rect.width || ny >= rect.height) continue;
            const ni = ny * rect.width + nx;
            if (seen[ni] || !mask[(rect.top + ny) * w + rect.left + nx]) continue;
            seen[ni] = 1;
            stack.push(ni);
          }
      }
      if (comp.length < min) for (const c of comp) mask[(rect.top + ((c / rect.width) | 0)) * w + rect.left + (c % rect.width)] = 0;
    }
}

export type StrokeBox = { cover: number; whole: boolean };

/**
 * The letters-only mask (0/255, w x h) for RGB pixels `rgb` (w x h x 3) and
 * the box rects: in each box, the pixels whose colour stands out from the
 * local median background by more than max(22, 3 x MAD) in any channel,
 * specks under 3 px dropped, grown by `growPx` (strokeGrowPx). A box where that finds almost
 * nothing (or most of the box) is masked whole, the safe old behaviour.
 */
export function strokeMask(rgb: Uint8Array, w: number, h: number, rects: readonly PxRect[], growPx = STROKE_GROW_PX): { mask: Uint8Array; boxes: StrokeBox[] } {
  if (rgb.length !== w * h * 3) throw new Error("stroke mask: picture size mismatch");
  const planes = [0, 1, 2].map((c) => {
    const p = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) p[i] = rgb[i * 3 + c];
    return p;
  });
  const letters = new Uint8Array(w * h);
  const whole = new Uint8Array(w * h);
  const info: StrokeBox[] = [];
  for (const rect of rects) {
    const n = rect.width * rect.height;
    const win = Math.max(7, Math.round(Math.min(rect.height, rect.width) * 0.9)) | 1;
    const bgs = planes.map((p) => backgroundPlane(p, w, h, rect, win));
    const dev = new Float32Array(n);
    for (let y = 0; y < rect.height; y++)
      for (let x = 0; x < rect.width; x++) {
        const i = (rect.top + y) * w + rect.left + x;
        const li = y * rect.width + x;
        let m = 0;
        for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(planes[c][i] - bgs[c][li]));
        dev[li] = m;
      }
    const sorted = Float32Array.from(dev).sort();
    const mad = sorted[sorted.length >> 1] * 1.4826;
    const th = Math.min(STROKE_MAX_DEV, Math.max(STROKE_MIN_DEV, STROKE_MAD_K * mad));
    const local = new Uint8Array(w * h);
    for (let y = 0; y < rect.height; y++)
      for (let x = 0; x < rect.width; x++) if (dev[y * rect.width + x] > th) local[(rect.top + y) * w + rect.left + x] = 255;
    dropSpecks(local, w, rect, 3);
    let hit = 0;
    for (let y = 0; y < rect.height; y++) for (let x = 0; x < rect.width; x++) if (local[(rect.top + y) * w + rect.left + x]) hit++;
    const cover = n ? hit / n : 0;
    const useWhole = cover < STROKE_COVER_MIN || cover > STROKE_COVER_MAX;
    info.push({ cover: Math.round(cover * 1000) / 1000, whole: useWhole });
    if (useWhole) {
      for (let y = 0; y < rect.height; y++) whole.fill(255, (rect.top + y) * w + rect.left, (rect.top + y) * w + rect.left + rect.width);
    } else for (let i = 0; i < w * h; i++) if (local[i]) letters[i] = 255;
  }
  const grown = dilateMask(letters, w, h, Math.max(0, Math.min(12, Math.round(growPx))));
  for (let i = 0; i < w * h; i++) if (whole[i]) grown[i] = 255;
  return { mask: grown, boxes: info };
}

/** Share of a 0/255 mask that is on. */
export function maskCover(mask: Uint8Array): number {
  let n = 0;
  for (const v of mask) if (v) n++;
  return mask.length ? n / mask.length : 0;
}

/**
 * Stitch-back plan: the letters mask is grown by half Erase's dilation (in
 * sent pixels, so the soft edge lands inside what Erase repainted), then
 * feathered by `featherPx` on the original.
 */
export function stitchPlan(scale: number, dilatePx = ERASE_DILATE_PX): { growSendPx: number; featherPx: number } {
  const s = scale > 0 ? scale : 1;
  return { growSendPx: Math.max(1, Math.round(dilatePx / 2)), featherPx: Math.round(Math.max(0.8, Math.min(6, dilatePx / 4 / s)) * 10) / 10 };
}

/** One line for the person: how the picture was sent. */
export function eraseDetail(plan: CropPlan, boxes: readonly StrokeBox[]): string {
  const sent = `${plan.send.width}\u00d7${plan.send.height}`;
  const size = plan.scale > 1.05 ? `the text area enlarged ${plan.scale.toFixed(1)}\u00d7 to ${sent}` : `the text area at ${sent}`;
  const letters = boxes.filter((b) => !b.whole).length;
  const mask = letters === boxes.length ? "a letters-only mask" : letters === 0 ? "whole-box masks" : `a letters-only mask (${boxes.length - letters} of ${boxes.length} boxes masked whole)`;
  return `Sent ${size} (FLUX Erase works best at about 1 MP) with ${mask}.`;
}

/**
 * Fill fallback prompt, POSITIVE ONLY (BFL: "no text" -> "clean surfaces,
 * unmarked, blank"). Never names letters, words, numbers, logos or barcodes,
 * because naming them is what made FLUX paint them.
 */
export function erasePrompt(opts: { surface?: string | null } = {}): string {
  const surface = (opts.surface ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  return [
    `A clean, blank, unmarked ${surface || "packaging"} surface.`,
    "It continues the exact colour, texture, gradient, lighting and edges of the area right around it, seamless and smooth, like the untouched part of the same surface.",
  ].join(" ");
}

export const ERASE_TAGS = ["text-removed", "flux-fill"] as const;

/** Title of the new library photo ("… (text removed)"), never doubled. */
export function erasedTitle(original: string | null | undefined): string {
  const base = (original ?? "").replace(/\s*\(text removed\)\s*$/i, "").replace(/\s+/g, " ").trim().slice(0, 140) || "Product photo";
  return `${base} (text removed)`;
}

/** The new photo's `source` points back at the original. */
export function erasedSource(originalId: string): string {
  return `text-removed:${originalId}`;
}

/** The new photo's status: published only when the original is published with clear rights. */
export function erasedStatus(original: { status: string | null; license_status: string | null }): "draft" | "published" {
  return original.status === "published" && original.license_status !== "pending-review" ? "published" : "draft";
}

// ---------------------------------------------------------------------------
// AI "find the text" + keep/remove advice
// ---------------------------------------------------------------------------

export type TextKind = "product-name" | "brand" | "size" | "warning" | "other";
export type TextAdvice = "remove" | "keep" | "unsure";

export type FoundText = {
  box: EraseBox;
  text: string;
  kind: TextKind;
  advice: TextAdvice;
  why: string;
};

export type EraseProduct = {
  name: string;
  brand: string | null;
  strainName: string | null;
  vendor: string | null;
  category: string | null;
};

export const TEXT_FIND_MAX = 10;

export const TEXT_FIND_SYSTEM = [
  "You read the printed text on a cannabis product photo for a store's menu.",
  "Find every separate piece of readable text (a product or strain name, a brand or logo word, a size or weight, a warning or compliance line, anything else).",
  "For each, give its bounding box as fractions of the picture: x and y of the top-left corner, w and h, all between 0 and 1. Make the box cover the whole word or line, a little generously.",
  'Answer JSON only: {"texts":[{"text":"exact words","kind":"product-name|brand|size|warning|other","x":0.1,"y":0.2,"w":0.3,"h":0.05}]}',
  `At most ${TEXT_FIND_MAX} items, largest first. If there is no text, answer {"texts":[]}.`,
].join("\n");

export function textFindUserPrompt(p: EraseProduct): string {
  const lines = [
    `This photo may be used for: ${p.name}`,
    p.brand ? `Brand: ${p.brand}` : "",
    p.strainName ? `Strain: ${p.strainName}` : "",
    p.vendor ? `Vendor: ${p.vendor}` : "",
    p.category ? `Type: ${p.category}` : "",
    "List the text you can read on the photo.",
  ];
  return lines.filter(Boolean).join("\n");
}

const KINDS: readonly TextKind[] = ["product-name", "brand", "size", "warning", "other"];

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(mg|g|gram|grams|ml|oz|pk|pack|ct)\b/gi;
function sizesIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.toLowerCase().matchAll(SIZE_RE)) {
    const u = m[2].replace(/^grams?$/, "g").replace(/^pack$/, "pk").replace(/^ct$/, "pk");
    out.push(`${Number(m[1])}${u}`);
  }
  return out;
}

const NOISE = new Set([
  "flower", "cart", "carts", "cartridge", "vape", "disposable", "pre", "roll", "rolls", "preroll", "prerolls", "infused", "live", "resin", "rosin",
  "distillate", "gummies", "gummy", "edible", "edibles", "pack", "indica", "sativa", "hybrid", "cbd", "thc", "the", "and", "with", "strain", "premium",
]);
const words = (s: string | null | undefined) => tokenize(s).filter((t) => t.length >= 3 && !NOISE.has(t) && !/^\d/.test(t));

/**
 * Keep or remove one piece of text, judged against THIS product. Removing is
 * only ADVISED; the person decides. Required warnings are always kept.
 */
export function adviseText(text: string, kind: TextKind, p: EraseProduct): { advice: TextAdvice; why: string } {
  const t = text.replace(/\s+/g, " ").trim();
  if (kind === "warning") return { advice: "keep", why: "Warning or compliance text — keep it." };
  const brandWords = new Set([...words(p.brand), ...words(p.vendor)]);
  const mine = new Set([...words(p.name), ...words(p.strainName)].filter((w) => !brandWords.has(w)));
  const tw = words(t);
  if (kind === "size") {
    const have = sizesIn(`${p.name}`);
    const says = sizesIn(t);
    if (says.length === 0 || have.length === 0) return { advice: "unsure", why: "A size; check it matches this product." };
    return says.some((s) => have.includes(s)) ? { advice: "keep", why: "Same size as this product." } : { advice: "remove", why: `Says ${says[0]}; this product is ${have[0]}.` };
  }
  if (tw.length === 0) return { advice: "unsure", why: "Could not tell what this text is." };
  const onlyBrand = tw.every((w) => brandWords.has(w));
  if (onlyBrand) return { advice: "keep", why: "The brand — keep it (it is on brand)." };
  const hitsMine = tw.some((w) => mine.has(w));
  if (hitsMine) return { advice: "keep", why: "This product’s own name — keep it." };
  if (kind === "brand") {
    return brandWords.size > 0 ? { advice: "remove", why: `“${t.slice(0, 40)}” is not this product’s brand.` } : { advice: "unsure", why: "A brand word; this card has no brand to compare." };
  }
  if (kind === "product-name") return { advice: "remove", why: `Names “${t.slice(0, 40)}”, not this product (${p.name.slice(0, 60)}).` };
  return { advice: "unsure", why: "Other text — remove it only if it does not fit this product." };
}

/** Normalise a box the model gave (0..1, 0..100 or 0..1000 scales). */
function modelBox(r: Record<string, unknown>): EraseBox | null {
  const xs = [num(r.x), num(r.y), num(r.w), num(r.h)];
  if (!xs.every(Number.isFinite)) return null;
  const max = Math.max(...xs);
  const scale = max > 100 ? 1000 : max > 1.5 ? 100 : 1;
  return cleanBox({ x: xs[0] / scale, y: xs[1] / scale, w: xs[2] / scale, h: xs[3] / scale });
}

/** The model's answer → found texts with advice (bad rows dropped). */
export function parseTextFind(content: string, p: EraseProduct): FoundText[] | null {
  let j: unknown;
  try {
    j = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      j = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const list = (j as { texts?: unknown })?.texts;
  if (!Array.isArray(list)) return null;
  const out: FoundText[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const box = modelBox(r);
    if (!text || !box) continue;
    const kind = KINDS.includes(r.kind as TextKind) ? (r.kind as TextKind) : "other";
    const a = adviseText(text, kind, p);
    out.push({ box, text, kind, advice: a.advice, why: a.why });
    if (out.length >= TEXT_FIND_MAX) break;
  }
  return out;
}

/** One line over the editor after "Find the text". */
export function foundSummary(found: readonly FoundText[]): string {
  if (found.length === 0) return "No readable text found. Drag a box over anything you want gone.";
  const rm = found.filter((f) => f.advice === "remove");
  const head = `Found ${found.length} piece${found.length === 1 ? "" : "s"} of text.`;
  if (rm.length === 0) return `${head} Nothing looks wrong for this product; tick any you still want removed.`;
  return `${head} ${rm.length} ${rm.length === 1 ? "looks" : "look"} wrong for this product and ${rm.length === 1 ? "is" : "are"} ticked to remove: ${rm.map((f) => `“${f.text.slice(0, 30)}”`).join(", ")}.`;
}

// ---------------------------------------------------------------------------
// Library hint: "this perfect photo names another product"
// ---------------------------------------------------------------------------

/**
 * From the text already read off a library photo (visible_text), the words
 * that name a DIFFERENT product than this one, or null. Used for the tile chip
 * "Names Gelato — remove text?" so the AI points at the fix.
 */
export function otherNameOnPhoto(visibleText: string | null | undefined, p: EraseProduct): string | null {
  const vt = (visibleText ?? "").replace(/\s+/g, " ").trim();
  if (!vt) return null;
  const brandWords = new Set([...words(p.brand), ...words(p.vendor)]);
  const mine = new Set([...words(p.name), ...words(p.strainName)]);
  const extra = words(vt).filter((w) => !brandWords.has(w) && !mine.has(w));
  if (extra.length === 0) return null;
  const uniq = [...new Set(extra)].slice(0, 3);
  return uniq.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The editor's address. */
export function removeTextUrl(key: string, mediaId: string, back?: string | null): string {
  const q = [`media=${encodeURIComponent(mediaId)}`];
  if (back) q.push(`back=${encodeURIComponent(back)}`);
  return `/admin/products/${encodeURIComponent(key)}/remove-text?${q.join("&")}`;
}

// ---------------------------------------------------------------------------
// D244 R-11: the multi-photo queue (Copilot + Vendor kits)
// Owner (round 4): "I want to draw a box on all product images, then click the
// remove text button. that way I can quickly queue up several images to feed
// to flux to fix one after the next."
// ---------------------------------------------------------------------------

/** Most photos one queue holds (FLUX runs them one after the next). */
export const ERASE_QUEUE_MAX = 12;

export type QueueState = "idle" | "waiting" | "working" | "ready" | "failed";
export type QueueEntry = { mediaId: string; boxesOn: number; state: QueueState };

/** The photos one press of "Remove text" sends, in order: boxes drawn and not already done. */
export function eraseQueuePlan(entries: readonly QueueEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    if (!e.mediaId || seen.has(e.mediaId)) continue;
    seen.add(e.mediaId);
    if (e.boxesOn > 0 && e.state !== "ready" && e.state !== "working") out.push(e.mediaId);
    if (out.length >= ERASE_QUEUE_MAX) break;
  }
  return out;
}

/**
 * D244 R-21 (owner round 8: "I want to be able to remove text from any and
 * all images available on the vendor kit page"): tick / untick a photo for
 * the Remove-text queue from ANY tile. Up to ERASE_QUEUE_MAX at a time; a
 * finished photo can be unticked to make room for the next ones.
 */
export function toggleQueuePick(picked: readonly string[], mediaId: string, max = ERASE_QUEUE_MAX): { picked: string[]; full: boolean } {
  if (!mediaId) return { picked: [...picked], full: false };
  if (picked.includes(mediaId)) return { picked: picked.filter((x) => x !== mediaId), full: false };
  if (picked.length >= max) return { picked: [...picked], full: true };
  return { picked: [...picked, mediaId], full: false };
}

/** "2 done · 1 working · 3 waiting · 1 failed" (empty parts left out). */
export function queueSummary(states: readonly QueueState[]): string {
  const n = (s: QueueState) => states.filter((x) => x === s).length;
  const parts = [
    n("ready") ? `${n("ready")} done` : "",
    n("working") ? `${n("working")} working` : "",
    n("waiting") ? `${n("waiting")} waiting` : "",
    n("failed") ? `${n("failed")} failed` : "",
  ].filter(Boolean);
  return parts.join(" \u00b7 ");
}

/** The queue button's words. */
export function queueButtonLabel(photos: number, boxes: number): string {
  if (photos === 0) return "Draw a box on a photo first";
  return `\u2702 Remove text from ${photos} photo${photos === 1 ? "" : "s"} (${boxes} box${boxes === 1 ? "" : "es"})`;
}

/** Who a queue works for: one product card, or one vendor's kit. */
export type QueueScope = { kind: "product" | "vendor"; id: string };
export function cleanQueueScope(raw: unknown): QueueScope | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = r.kind === "vendor" ? "vendor" : r.kind === "product" ? "product" : null;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!kind || !id || id.length > 300 || /[\u0000-\u001f]/.test(id)) return null;
  return { kind, id };
}

/**
 * Owner (round 4): "please also add helper text on the page that lets me know
 * that if there are facts to attach, do that first, because the product goes
 * away after the photo is attached, by design".
 */
export const FACTS_FIRST_HINT =
  "Facts and AI first, photo last. Attaching a photo publishes the product, and it leaves this list \u2014 by design. So if there are facts to attach, attach them first, or run the AI (Draft now / Accept) first, then attach the photo.";

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runTextEraseCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, name: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`text-erase-core FAIL: ${name}`);
    }
  };
  const P: EraseProduct = { name: "Phat Panda Blue Dream 3.5g", brand: "Phat Panda", strainName: "Blue Dream", vendor: "Hollingsworth", category: "Flower" };

  // boxes
  ok(cleanBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 })?.w === 0.2, "clean box keeps a good box");
  ok(cleanBox({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 })?.x === 0.3, "negative drag flips");
  ok(cleanBox({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 })?.w === 0.1, "clamped to the picture");
  ok(cleanBox({ x: 0.1, y: 0.1, w: 0.001, h: 0.2 }) === null, "a stray click is no box");
  ok(cleanBox({ x: "a" }) === null && cleanBox(null) === null, "junk is no box");
  ok(parseEraseBoxes('[{"x":0.1,"y":0.1,"w":0.2,"h":0.1},{"x":1}]').length === 1, "form JSON parsed, junk dropped");
  ok(parseEraseBoxes("not json").length === 0 && parseEraseBoxes({}).length === 0, "bad form value is empty");
  ok(parseEraseBoxes(Array.from({ length: 30 }, () => ({ x: 0, y: 0, w: 0.1, h: 0.1 }))).length === ERASE_BOXES_MAX, "boxes capped");
  const pb = padBox({ x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  ok(pb.x === 0.085 && pb.w === 0.23, "padding grows the box");
  ok(padBox({ x: 0, y: 0, w: 0.1, h: 0.1 }).x === 0, "padding stays inside the picture");
  ok(Math.abs(boxesArea([{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0, w: 0.5, h: 0.5 }]) - 0.25) < 0.001, "overlaps counted once");
  ok(!checkEraseBoxes([]).ok, "no boxes refused");
  ok(!checkEraseBoxes([{ x: 0, y: 0, w: 0.9, h: 0.9 }]).ok, "whole-picture mask refused");
  const ck = checkEraseBoxes([{ x: 0.1, y: 0.1, w: 0.2, h: 0.1 }]);
  ok(ck.ok && ck.boxes[0].w > 0.2, "checked boxes are padded");
  const px = boxPixels({ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }, 1000, 800);
  ok(px.left === 100 && px.top === 160 && px.width === 500 && px.height === 200, "box to pixels");
  const svg = eraseMaskSvg(1000, 800, [{ x: 0.1, y: 0.2, w: 0.5, h: 0.25 }]);
  ok(svg.includes('fill="#000"') && svg.includes('<rect x="100" y="160" width="500" height="200" fill="#fff"/>'), "mask is black with white boxes");
  ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"'), "mask is the picture's size");

  // prompt + saved result
  ok(erasePrompt().includes("clean, blank, unmarked packaging") && !/\b(no|letters?|words?|text|numbers?|logos?|barcodes?)\b/i.test(erasePrompt()), "fallback prompt is positive only (never names text)");
  ok(erasePrompt({ surface: "jar label" }).includes("jar label"), "prompt names the surface");
  ok(erasedTitle("Gelato cart") === "Gelato cart (text removed)", "title marked");
  ok(erasedTitle("Gelato cart (text removed)") === "Gelato cart (text removed)", "title never doubled");
  ok(erasedTitle(null) === "Product photo (text removed)", "blank title");
  ok(erasedSource("abc") === "text-removed:abc", "source points at the original");
  ok(ERASE_MODEL === "flux-tools/erase-v1" && ERASE_FALLBACK_MODEL === "flux-pro-1.0-fill", "FLUX Erase is the remover; Fill only the fallback");
  // R-17: Erase body, size, paste-back
  const eb = eraseBody({ imageB64: "I", maskB64: "M" });
  ok(eb.dilate_pixels === 12 && eb.output_format === "png" && !("prompt" in eb), "Erase body: no prompt, dilate 12, png");
  ok(eraseBody({ imageB64: "I", maskB64: "M", dilatePixels: 99 }).dilate_pixels === 25 && eraseBody({ imageB64: "I", maskB64: "M", dilatePixels: -3 }).dilate_pixels === 0, "dilate clamped to BFL's 0-25");
  const big = eraseSendSize(4000, 3000);
  ok(big.width % 16 === 0 && big.height % 16 === 0 && Math.abs(big.width * big.height - 1_000_000) < 60_000 && big.scale < 0.3, "a 12 MP photo is sent at about 1 MP");
  const small = eraseSendSize(800, 600);
  ok(small.width === 800 && small.height === 600 && small.scale === 1, "a small photo is never enlarged");
  ok(eraseUnavailable("FLUX rejected the request (404): Not Found") && eraseUnavailable("BFL rejected the API key. Check it in Settings → Integrations."), "no Erase access falls back to Fill");
  ok(!eraseUnavailable("FLUX is busy (too many active tasks — the limit is 24). Wait a moment and try again.") && !eraseUnavailable("The BFL account is out of credits."), "busy / no credits do not fall back");
  const pl = pasteBackPlan(0.25);
  ok(pl.growPx === 24 && pl.featherPx === 12, "paste-back grows and feathers in original pixels");
  ok(pasteBackPlan(1).growPx === 6 && pasteBackPlan(1).featherPx === 4, "paste-back at full size");
  const il = interleaveRgba(new Uint8Array([1, 2, 3, 4, 5, 6]), new Uint8Array([0, 255]));
  ok(il.join(",") === "1,2,3,0,4,5,6,255", "RGB + mask -> RGBA overlay");
  const gb = growBoxes([{ x: 0, y: 0.5, w: 0.1, h: 0.1 }], 100, 100, 5);
  ok(gb[0].x === 0 && Math.abs(gb[0].y - 0.45) < 1e-9 && Math.abs(gb[0].w - 0.15) < 1e-9 && Math.abs(gb[0].h - 0.2) < 1e-9, "grown boxes stay inside the picture");
  ok(erasedStatus({ status: "published", license_status: null }) === "published", "published original: published copy");
  ok(erasedStatus({ status: "published", license_status: "pending-review" }) === "draft" && erasedStatus({ status: "draft", license_status: null }) === "draft", "rights pending or draft: draft copy");

  // advice
  ok(adviseText("GELATO", "product-name", P).advice === "remove", "another strain name: remove");
  ok(adviseText("GELATO", "product-name", P).why.includes("not this product"), "says why");
  ok(adviseText("Blue Dream", "product-name", P).advice === "keep", "this product's name: keep");
  ok(adviseText("PHAT PANDA", "brand", P).advice === "keep", "the brand: keep");
  ok(adviseText("Seattle Bubble Works", "brand", P).advice === "remove", "another brand: remove");
  ok(adviseText("1g", "size", P).advice === "remove" && adviseText("3.5 g", "size", P).advice === "keep", "size compared");
  ok(adviseText("Warning: This product has intoxicating effects", "warning", P).advice === "keep", "warnings always kept");
  ok(adviseText("$$$", "other", P).advice === "unsure", "unreadable is unsure");

  // parse
  const found = parseTextFind(
    '{"texts":[{"text":"GELATO","kind":"product-name","x":0.2,"y":0.3,"w":0.4,"h":0.1},{"text":"Phat Panda","kind":"brand","x":100,"y":50,"w":300,"h":60},{"text":"x","kind":"weird","x":"bad"}]}',
    P,
  );
  ok(found !== null && found.length === 2, "model answer parsed, bad rows dropped");
  ok(found?.[0].advice === "remove" && found?.[1].advice === "keep", "advice attached");
  ok(found?.[1].box.x === 0.1 && found?.[1].box.w === 0.3, "0..1000 boxes normalised");
  ok(parseTextFind("no", P) === null && parseTextFind('{"x":1}', P) === null, "unusable answer is null");
  ok(parseTextFind('Sure! {"texts":[]}', P)?.length === 0, "JSON inside chatter");
  ok(foundSummary([]).startsWith("No readable text"), "summary: none");
  ok(found !== null && foundSummary(found).includes("“GELATO”"), "summary names the text to remove");

  // library hint
  ok(otherNameOnPhoto("PHAT PANDA GELATO 3.5g", P) === "Gelato", "names another product");
  ok(otherNameOnPhoto("PHAT PANDA BLUE DREAM", P) === null, "names this product: no hint");
  ok(otherNameOnPhoto(null, P) === null, "no text: no hint");
  ok(removeTextUrl("k 1", "m1", "/admin/products?x=1") === "/admin/products/k%201/remove-text?media=m1&back=%2Fadmin%2Fproducts%3Fx%3D1", "editor URL");

  // R-11 queue
  const Q: QueueEntry[] = [
    { mediaId: "a", boxesOn: 2, state: "idle" },
    { mediaId: "b", boxesOn: 0, state: "idle" },
    { mediaId: "c", boxesOn: 1, state: "ready" },
    { mediaId: "d", boxesOn: 1, state: "failed" },
    { mediaId: "a", boxesOn: 1, state: "idle" },
  ];
  ok(eraseQueuePlan(Q).join(",") === "a,d", "queue: boxed, not done, failed retried, no repeats, in order");
  ok(eraseQueuePlan([]).length === 0, "queue: empty");
  ok(eraseQueuePlan(Array.from({ length: 20 }, (_, i) => ({ mediaId: `m${i}`, boxesOn: 1, state: "idle" as const }))).length === ERASE_QUEUE_MAX, "queue: capped");
  ok(queueSummary(["ready", "ready", "working", "failed", "idle"]) === "2 done \u00b7 1 working \u00b7 1 failed", "queue summary");
  ok(queueSummary([]) === "", "queue summary empty");
  ok(queueButtonLabel(3, 5) === "\u2702 Remove text from 3 photos (5 boxes)" && queueButtonLabel(1, 1).includes("1 photo (1 box)"), "queue button words");
  ok(queueButtonLabel(0, 0).startsWith("Draw a box"), "queue button idle");
  ok(cleanQueueScope({ kind: "vendor", id: " v1 " })?.id === "v1" && cleanQueueScope({ kind: "x", id: "a" }) === null && cleanQueueScope({ kind: "product", id: "" }) === null, "queue scope");
  ok(FACTS_FIRST_HINT.includes("by design") && FACTS_FIRST_HINT.includes("first"), "facts-first hint");
  // R-21: tick any photo on the page
  ok(toggleQueuePick(["a"], "b").picked.join() === "a,b" && toggleQueuePick(["a", "b"], "a").picked.join() === "b", "R-21: tick and untick any photo");
  const fullPick = toggleQueuePick(Array.from({ length: ERASE_QUEUE_MAX }, (_, i) => `m${i}`), "x");
  ok(fullPick.full && fullPick.picked.length === ERASE_QUEUE_MAX, "R-21: a full queue says so and keeps the picks");
  ok(toggleQueuePick(Array.from({ length: ERASE_QUEUE_MAX }, (_, i) => `m${i}`), "m3").picked.length === ERASE_QUEUE_MAX - 1 && !toggleQueuePick([], "").full, "R-21: untick makes room; blank id ignored");

  // R-20: crop-and-stitch at ~1 MP + letters-only mask
  const sb = [{ x: 305 / 550, y: 318 / 550, w: 45 / 550, h: 20 / 550 }, { x: 320 / 550, y: 340 / 550, w: 120 / 550, h: 52 / 550 }];
  const cp = eraseCropPlan(550, 550, sb);
  const cpx = cp.send.width * cp.send.height;
  ok(cp.scale > 2 && cpx > 850_000 && cpx < 1_150_000, "R-20: a 550 px shot's text area is ENLARGED to about 1 MP");
  ok(cp.send.width % 16 === 0 && cp.send.height % 16 === 0, "R-20: sent sides in 16s");
  ok(cp.send.width <= 2 * cp.send.height + 16 && cp.send.height <= 2 * cp.send.width + 16, "R-20: aspect inside BFL's 1:2..2:1");
  const un = boxesUnion(sb, 550, 550);
  ok(cp.crop.left <= un.left && cp.crop.top <= un.top && cp.crop.left + cp.crop.width >= un.left + un.width && cp.crop.top + cp.crop.height >= un.top + un.height, "R-20: the crop holds every box");
  ok(cp.crop.left >= 0 && cp.crop.top >= 0 && cp.crop.left + cp.crop.width <= 550 && cp.crop.top + cp.crop.height <= 550, "R-20: the crop stays inside the photo");
  ok(cp.crop.width > un.width + 40 && cp.crop.height > un.height + 40, "R-20: the crop carries label context round the text");
  const bigCp = eraseCropPlan(4032, 3024, [{ x: 0.4, y: 0.45, w: 0.1, h: 0.04 }]);
  ok(bigCp.crop.width < 4032 && bigCp.send.width * bigCp.send.height < 1_150_000, "R-20: a phone photo sends the text area, not the whole photo squeezed");
  const tiny = eraseCropPlan(120, 90, [{ x: 0.2, y: 0.2, w: 0.3, h: 0.2 }]);
  ok(tiny.scale <= ERASE_UPSCALE_MAX + 0.2, "R-20: enlargement capped at 4x");
  const wide = eraseCropPlan(3000, 400, [{ x: 0.05, y: 0.3, w: 0.9, h: 0.3 }]);
  ok(wide.crop.width <= 3000 && wide.crop.height <= 400 && wide.send.width % 16 === 0, "R-20: a very wide photo stays a valid crop");
  ok(boxInCrop({ x: 0.9, y: 0.9, w: 0.05, h: 0.05 }, 100, 100, { left: 0, top: 0, width: 50, height: 50 }) === null, "R-20: a box outside the crop is skipped");
  const sr = sendRects([{ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }], 100, 100, { crop: { left: 40, top: 40, width: 40, height: 40 }, send: { width: 400, height: 400 }, scale: 10 });
  ok(sr.length === 1 && sr[0].left === 100 && sr[0].top === 100 && sr[0].width === 100, "R-20: box to sent pixels");
  const dm = new Uint8Array(100);
  dm[55] = 255;
  ok(maskCover(dilateMask(dm, 10, 10, 1)) === 0.09 && maskCover(dilateMask(dm, 10, 10, 0)) === 0.01, "R-20: grow is a square of 2r+1");
  // a grey label with two dark "letters" bars, and a flat box
  const LW = 80;
  const LH = 40;
  const lab = new Uint8Array(LW * LH * 3).fill(180);
  for (let y = 12; y < 28; y++) for (const x0 of [20, 40]) for (let x = x0; x < x0 + 4; x++) lab.fill(30, (y * LW + x) * 3, (y * LW + x) * 3 + 3);
  const st = strokeMask(lab, LW, LH, [{ left: 10, top: 5, width: 50, height: 30 }, { left: 65, top: 5, width: 12, height: 30 }], 1);
  const at = (x: number, y: number) => st.mask[y * LW + x];
  ok(at(21, 20) === 255 && at(41, 20) === 255, "R-20: the letters are masked");
  ok(at(31, 20) === 0 && at(12, 7) === 0, "R-20: the label between the letters is NOT masked");
  ok(at(5, 20) === 0, "R-20: nothing outside the boxes is masked");
  ok(!st.boxes[0].whole && st.boxes[0].cover > 0.05 && st.boxes[0].cover < 0.2, "R-20: the letters box reports its cover");
  ok(st.boxes[1].whole && at(70, 20) === 255, "R-20: a box with no letters found is masked whole (the safe old way)");
  ok(strokeGrowPx(1) === 2 && strokeGrowPx(2.7) === 5 && strokeGrowPx(20) === 12, "R-20: letter halo grows with the enlargement");
  ok(eraseDilateFor("letters") === 6 && eraseDilateFor("boxes") === ERASE_DILATE_PX, "R-20: tight Erase dilation for a letters mask");
  const spn = stitchPlan(2.75, 6);
  ok(spn.growSendPx === 3 && spn.featherPx >= 0.8 && spn.featherPx <= 6, "R-20: stitch grows half the dilation, small feather");
  ok(eraseDetail(cp, st.boxes).includes("enlarged") && eraseDetail(cp, st.boxes).includes("1 of 2 boxes masked whole"), "R-20: the detail line says what was sent");

  return { passed, failed };
}
