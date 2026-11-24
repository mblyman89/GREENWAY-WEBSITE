/**
 * src/lib/printing/print-layers-core.ts
 *
 * D271 - Print Studio picture layers + print-grade AI tools. PURE.
 *   - PlacedImg: a picture placed ON the canvas (an element of kind "image"),
 *     in addition to the full-canvas background. It moves / resizes / rotates /
 *     layers like any shape (the element system already does that); this file
 *     only validates the picture settings and turns them into CSS.
 *   - layerInches / layerDpi: how big a layer prints and how sharp it is.
 *   - printEnlargePlan: "double the pixels" for print (no 1200 px email cap):
 *     2x by default, up to 4x in one press when the print needs it, capped
 *     at PRINT_ENLARGE_MAX_SIDE so a 6' x 12' banner still fits in memory.
 *   - fluxSizeFor: the FLUX.2 width/height (multiples of 16, <= 4 MP) for any
 *     print shape, so generated art comes back in the right shape.
 *   - Prompts for "make a cut-out" (magenta key, cut out on our server) and
 *     "recreate the canvas as one picture".
 */

export const PRINT_ENLARGE_MAX_SIDE = 12000;
export const PRINT_ENLARGE_MAX_PASS = 4;
export const FLUX_MAX_PX = 4_194_304;
export const IMG_FITS = ["contain", "cover", "fill"] as const;
export type ImgFit = (typeof IMG_FITS)[number];

export type PlacedImg = {
  src: string;
  alt?: string;
  /** natural width / height (keeps the picture's own shape while h is null) */
  ratio?: number;
  /** natural pixel size, for the print sharpness check */
  pxW?: number;
  pxH?: number;
  fit?: ImgFit;
  flipX?: true;
  flipY?: true;
  /** 0-200 (100 = as is) */
  bright?: number;
  contrast?: number;
  sat?: number;
  /** 0-100 */
  gray?: number;
  /** 0-20 px */
  blur?: number;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const clampN = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
};

/** Same rule as banner pictures: a site path or a Supabase public-storage https URL. */
export function safeLayerSrc(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 2048) return null;
  if (t.startsWith("/") && !t.startsWith("//") && !t.includes("\\")) return t;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (!/^[a-z0-9-]+\.supabase\.co$/i.test(u.hostname)) return null;
    if (!u.pathname.startsWith("/storage/v1/object/public/")) return null;
    return t;
  } catch {
    return null;
  }
}

/** null = no usable picture (the layer is dropped). Optional fields only written when used. */
export function normalizePlacedImg(raw: unknown): PlacedImg | null {
  if (!isObj(raw)) return null;
  const src = safeLayerSrc(raw.src);
  if (!src) return null;
  const out: PlacedImg = { src };
  if (typeof raw.alt === "string" && raw.alt.trim()) out.alt = raw.alt.trim().slice(0, 160);
  const r = clampN(raw.ratio, 0.05, 20);
  if (r) out.ratio = Math.round(r * 10000) / 10000;
  const w = clampN(raw.pxW, 1, 100000);
  const h = clampN(raw.pxH, 1, 100000);
  if (w && h) {
    out.pxW = Math.round(w);
    out.pxH = Math.round(h);
  }
  if ((IMG_FITS as readonly string[]).includes(raw.fit as string) && raw.fit !== "contain") out.fit = raw.fit as ImgFit;
  if (raw.flipX === true) out.flipX = true;
  if (raw.flipY === true) out.flipY = true;
  for (const k of ["bright", "contrast", "sat"] as const) {
    const n = clampN(raw[k], 0, 200);
    if (n !== null && Math.round(n) !== 100) out[k] = Math.round(n);
  }
  const g = clampN(raw.gray, 0, 100);
  if (g) out.gray = Math.round(g);
  const b = clampN(raw.blur, 0, 20);
  if (b) out.blur = Math.round(b * 10) / 10;
  return out;
}

/** CSS for the <img> inside the layer box (box = position/size/rotate/opacity/shadow). */
export function placedImgCss(img: PlacedImg, radius = 0, stroke?: { color: string; width: number }): Record<string, string> {
  const s: Record<string, string> = { width: "100%", height: "100%", display: "block", objectFit: img.fit ?? "contain", boxSizing: "border-box" };
  const f: string[] = [];
  if (img.bright !== undefined) f.push(`brightness(${img.bright / 100})`);
  if (img.contrast !== undefined) f.push(`contrast(${img.contrast / 100})`);
  if (img.sat !== undefined) f.push(`saturate(${img.sat / 100})`);
  if (img.gray) f.push(`grayscale(${img.gray / 100})`);
  if (img.blur) f.push(`blur(${img.blur}px)`);
  if (f.length) s.filter = f.join(" ");
  if (img.flipX || img.flipY) s.transform = `scale(${img.flipX ? -1 : 1}, ${img.flipY ? -1 : 1})`;
  if (radius > 0) s.borderRadius = `${radius}px`;
  if (stroke && stroke.width > 0) s.border = `${stroke.width}px solid ${stroke.color}`;
  return s;
}

/** Printed size (inches) of a layer w% wide on a canvas `canvasWIn` wide. */
export function layerInches(canvasWIn: number, canvasHIn: number, wPct: number, hPct: number | null, ratio: number | undefined): { w: number; h: number } {
  const w = (canvasWIn * wPct) / 100;
  const h = hPct === null ? (ratio ? w / ratio : w) : (canvasHIn * hPct) / 100;
  return { w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100 };
}

/** Effective DPI when the picture covers that printed box (cover-fit: the smaller side decides). */
export function layerDpi(pxW: number, pxH: number, wIn: number, hIn: number): number {
  if (!(pxW > 0 && pxH > 0 && wIn > 0 && hIn > 0)) return 0;
  return Math.round(Math.min(pxW / wIn, pxH / hIn));
}

export type EnlargePlan = { ok: true; width: number; height: number; factor: number } | { ok: false; error: string };
/**
 * Print enlarge: 2x ("double the pixels"); when a target size is known and
 * needs more, up to 4x in one press. Refuses when already sharp for the target.
 */
export function printEnlargePlan(pxW: number, pxH: number, target?: { w: number; h: number } | null): EnlargePlan {
  if (!(pxW > 0 && pxH > 0)) return { ok: false, error: "The picture size could not be read." };
  let factor = 2;
  if (target && target.w > 0 && target.h > 0) {
    const need = Math.max(target.w / pxW, target.h / pxH);
    if (need <= 1) return { ok: false, error: "Already sharp enough for its printed size - no enlarging needed." };
    factor = Math.min(PRINT_ENLARGE_MAX_PASS, Math.max(2, need));
  }
  factor = Math.min(factor, PRINT_ENLARGE_MAX_SIDE / Math.max(pxW, pxH));
  if (factor < 1.05) return { ok: false, error: `The picture is already as large as we can make it (${PRINT_ENLARGE_MAX_SIDE.toLocaleString()} px).` };
  return { ok: true, width: Math.round(pxW * factor), height: Math.round(pxH * factor), factor: Math.round(factor * 100) / 100 };
}

/** FLUX.2 size for a shape: <= 4 MP, multiples of 16, each side 256-4096 (ratio clamped to 4:1). */
export function fluxSizeFor(ratio: number, maxPx = FLUX_MAX_PX): { width: number; height: number } {
  const r = Math.min(4, Math.max(0.25, Number(ratio) || 1));
  let h = Math.sqrt(maxPx / r);
  let w = h * r;
  const fit = Math.min(1, 4096 / w, 4096 / h);
  w *= fit;
  h *= fit;
  const snap = (n: number) => Math.max(256, Math.floor(n / 16) * 16);
  return { width: snap(w), height: snap(h) };
}

export const CUTOUT_SUFFIX = "Show only the subject, centred, fully in frame with space around it, on one perfectly flat solid pure magenta (#FF00FF) background. No shadow on the background, no gradient, no texture, no border, no text.";

/** Prompt for "make a picture to place on the canvas". */
export function layerPrompt(ask: string, cutout: boolean, hasRefs: boolean): string {
  const a = String(ask ?? "").trim().slice(0, 1200);
  const ref = hasRefs ? " Use the attached picture(s) as the reference for the subject." : "";
  return cutout ? `${a}.${ref} ${CUTOUT_SUFFIX}` : `${a}.${ref} High detail, print quality, sharp focus.`;
}

/** Prompt for "recreate everything on the canvas as one picture". */
export function recreatePrompt(ask: string, keepText: boolean): string {
  const a = String(ask ?? "").trim().slice(0, 800);
  const text = keepText ? "Keep every word exactly as written, same spelling, same place and roughly the same size." : "Leave out all words and lettering.";
  return `Recreate this layout as one cohesive, polished, high-end printed design: blend the pictures, shapes and background into a single seamless image with consistent lighting, perspective and colour. Keep the same composition and the position of every element. ${text}${a ? ` Also: ${a}.` : ""} Print quality, sharp detail.`;
}

export function __runPrintLayersTests(): { passed: number; failed: number; failures: string[] } {
  let passed = 0;
  const failures: string[] = [];
  const t = (name: string, c: boolean) => (c ? passed++ : failures.push(name));
  const SB = "https://abc.supabase.co/storage/v1/object/public/media/x.png";
  t("safe supabase src", safeLayerSrc(SB) === SB);
  t("site path ok", safeLayerSrc("/brand/a.png") === "/brand/a.png");
  t("other host refused", safeLayerSrc("https://evil.com/a.png") === null);
  t("protocol-relative refused", safeLayerSrc("//evil.com/a.png") === null);
  t("data refused", safeLayerSrc("data:image/png;base64,AA") === null);
  t("no src -> null", normalizePlacedImg({ ratio: 2 }) === null && normalizePlacedImg(null) === null);
  const plain = normalizePlacedImg({ src: SB })!;
  t("plain has only src", JSON.stringify(plain) === JSON.stringify({ src: SB }));
  const n = normalizePlacedImg({ src: SB, alt: "  Logo ", ratio: 99, pxW: 1200.4, pxH: 600, fit: "cover", flipX: true, bright: 100, contrast: 250, sat: 80, gray: 0, blur: 3.33 })!;
  t("alt trimmed", n.alt === "Logo");
  t("ratio clamped", n.ratio === 20);
  t("px rounded", n.pxW === 1200 && n.pxH === 600);
  t("fit cover kept", n.fit === "cover" && normalizePlacedImg({ src: SB, fit: "contain" })!.fit === undefined);
  t("neutral filters dropped", n.bright === undefined && n.gray === undefined);
  t("filters clamped", n.contrast === 200 && n.sat === 80 && n.blur === 3.3);
  const css = placedImgCss(n, 8, { color: "#fff", width: 2 });
  t("css filter", css.filter === "contrast(2) saturate(0.8) blur(3.3px)");
  t("css flip", css.transform === "scale(-1, 1)");
  t("css fit/radius/border", css.objectFit === "cover" && css.borderRadius === "8px" && css.border === "2px solid #fff");
  t("css plain", placedImgCss(plain).filter === undefined && placedImgCss(plain).objectFit === "contain");
  const li = layerInches(144, 72, 25, null, 2);
  t("layer inches by ratio", li.w === 36 && li.h === 18);
  t("layer inches by h%", layerInches(144, 72, 50, 50, 2).h === 36);
  t("layer dpi", layerDpi(3600, 1800, 36, 18) === 100 && layerDpi(0, 1, 1, 1) === 0);
  const e2 = printEnlargePlan(2000, 1000);
  t("double the pixels", e2.ok && e2.width === 4000 && e2.height === 2000 && e2.factor === 2);
  t("no 1200px email cap", printEnlargePlan(5000, 2500).ok);
  const e4 = printEnlargePlan(1000, 500, { w: 14400, h: 7200 });
  t("up to 4x for print", e4.ok && e4.factor === 4 && e4.width === 4000);
  const e3 = printEnlargePlan(1000, 500, { w: 3000, h: 1500 });
  t("exact need between 2 and 4", e3.ok && e3.factor === 3);
  t("already sharp refused", !printEnlargePlan(4000, 2000, { w: 3000, h: 1500 }).ok);
  const cap = printEnlargePlan(8000, 4000);
  t("side cap", cap.ok && cap.width === PRINT_ENLARGE_MAX_SIDE);
  t("at cap refused", !printEnlargePlan(12000, 6000).ok && !printEnlargePlan(0, 0).ok);
  const f = fluxSizeFor(2);
  t("flux 2:1 size", f.width * f.height <= FLUX_MAX_PX && f.width % 16 === 0 && f.height % 16 === 0 && Math.abs(f.width / f.height - 2) < 0.02);
  const sq = fluxSizeFor(1);
  t("flux square", sq.width === sq.height && sq.width === 2048);
  const wide = fluxSizeFor(10);
  t("flux extreme clamped", wide.width <= 4096 && wide.height >= 256 && wide.width / wide.height <= 4.1);
  t("cutout prompt magenta", layerPrompt("a leaf", true, false).includes("#FF00FF") && !layerPrompt("a leaf", false, false).includes("#FF00FF"));
  t("ref note", layerPrompt("x", false, true).includes("reference"));
  t("recreate keeps text", recreatePrompt("", true).includes("exactly as written") && recreatePrompt("warmer", false).includes("Leave out all words") && recreatePrompt("warmer", false).includes("Also: warmer."));
  return { passed, failed: failures.length, failures };
}
