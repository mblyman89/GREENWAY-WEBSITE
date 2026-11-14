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

  return { passed, failed };
}
