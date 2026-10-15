/**
 * R54 Slice A — upload-time image optimisation plan (pure, no I/O).
 *
 * Owner ask: "use high resolution images, jpeg, png, and they convert to …
 * whatever the professional format should be."
 *
 * The professional answer, from the sources below:
 *  - Photos and banner art are raster images. SVG is a vector format for logos
 *    and icons; a photo saved "as SVG" just wraps the same pixels, so it is
 *    not a web optimisation. SVG uploads stay as they are.
 *  - Delivery is ALREADY per-device AVIF → WebP via next/image
 *    (next.config.ts `images.formats`, R45-S2).
 *  - What was missing is a web-ready MASTER. Uploads stored 50 MB originals.
 *    Vercel's optimiser only transforms jpeg/png/webp/avif sources up to
 *    8192 px per side, and huge sources make every first (cache-miss)
 *    transform slow.
 *  - So at upload we store one master: EXIF-rotated, longest side ≤ 3840 px,
 *    WebP, metadata stripped. 3840 is the largest default next/image
 *    deviceSize (Next 16 docs, image.md › deviceSizes), so next/image can
 *    still serve full-sharpness 4K and retina copies from it.
 *  - WebP, not AVIF, is the master. next/image already makes AVIF per request,
 *    and WebP encodes much faster inside an upload request. Sharp's docs list
 *    WebP quality 80 as the default.
 *  - GIF stays as-is (it may be animated; R43 already serves GIFs
 *    unoptimised). SVG stays as-is (vector). Video/PDF are out of scope.
 *
 * Sources: Vercel "Limits and Pricing for Image Optimization" (8192 px, formats);
 * node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md
 * (deviceSizes, formats); sharp output options https://sharp.pixelplumbing.com/api-output
 */

/** Longest side of the stored master (largest default next/image deviceSize). */
export const OPTIMIZE_MAX_DIM = 3840;
/** Vercel won't transform sources beyond this per side (docs). */
export const VERCEL_SOURCE_MAX_DIM = 8192;
/** WebP quality for photos (JPEG sources). */
export const OPTIMIZE_PHOTO_QUALITY = 82;
/** WebP quality for PNG sources (graphics, text, transparency stay crisp). */
export const OPTIMIZE_GRAPHIC_QUALITY = 90;
/** WebP sources already ≤ max dim are only re-encoded above this size. */
export const OPTIMIZE_WEBP_REENCODE_BYTES = 2 * 1024 * 1024;

export type OptimizePlan =
  | { action: "skip"; reason: string }
  | { action: "convert"; quality: number; maxDim: number; reason: string };

const CONVERTIBLE = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Decide what to do with an uploaded file. width/height may be unknown (null). */
export function planImageOptimize(input: {
  mime: unknown;
  size: unknown;
  width?: unknown;
  height?: unknown;
}): OptimizePlan {
  const mime = typeof input.mime === "string" ? input.mime.toLowerCase().split(";")[0]!.trim() : "";
  const size = Number(input.size);
  if (mime === "image/gif") return { action: "skip", reason: "GIF kept as-is (may be animated)." };
  if (mime === "image/svg+xml") return { action: "skip", reason: "SVG is already a vector — kept as-is." };
  if (!CONVERTIBLE.has(mime)) return { action: "skip", reason: "Not a photo format we convert." };
  if (!Number.isFinite(size) || size <= 0) return { action: "skip", reason: "Unknown size." };
  const w = Number(input.width);
  const h = Number(input.height);
  const known = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const oversized = known ? Math.max(w, h) > OPTIMIZE_MAX_DIM : true; // unknown → let sharp decide (withoutEnlargement)
  if (mime === "image/webp" && !oversized && size <= OPTIMIZE_WEBP_REENCODE_BYTES) {
    return { action: "skip", reason: "Already a web-sized WebP." };
  }
  return {
    action: "convert",
    quality: mime === "image/png" ? OPTIMIZE_GRAPHIC_QUALITY : OPTIMIZE_PHOTO_QUALITY,
    maxDim: OPTIMIZE_MAX_DIM,
    reason: mime === "image/webp" ? "Large WebP — resized/re-encoded." : `Converted ${mime === "image/png" ? "PNG" : "JPEG"} to WebP.`,
  };
}

/** Keep the optimised copy only when it really helps (smaller, or it had to shrink). */
export function keepOptimized(input: { originalBytes: number; optimizedBytes: number; resized: boolean }): boolean {
  if (!(input.optimizedBytes > 0)) return false;
  if (input.resized) return true;
  return input.optimizedBytes < input.originalBytes;
}

/** "photo.final.PNG" → "photo.final.webp" (only the last extension changes). */
export function webpFilename(filename: string): string {
  const f = String(filename ?? "").trim() || "image";
  return /\.[A-Za-z0-9]{1,5}$/.test(f) ? f.replace(/\.[A-Za-z0-9]{1,5}$/, ".webp") : `${f}.webp`;
}

/** Same storage key with a .webp extension (keeps the nonce/hash prefix and folder). */
export function webpStorageKey(key: string): string {
  return key.replace(/\.(png|jpe?g|webp)$/i, ".webp");
}

/** Owner-facing one-liner, e.g. "Optimised: 12.4 MB JPEG → 640 KB WebP (95% smaller)." */
export function savingsLabel(originalBytes: number, optimizedBytes: number): string {
  const fmt = (b: number) => (b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const pct = originalBytes > 0 ? Math.max(0, Math.round((1 - optimizedBytes / originalBytes) * 100)) : 0;
  return `Optimised for the web: ${fmt(originalBytes)} → ${fmt(optimizedBytes)} WebP (${pct}% smaller).`;
}

export function __runImageOptimizeCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("image-optimize-core FAIL:", m);
    }
  };
  const MB = 1024 * 1024;
  ok(planImageOptimize({ mime: "image/gif", size: MB }).action === "skip", "gif skipped");
  ok(planImageOptimize({ mime: "image/svg+xml", size: 1000 }).action === "skip", "svg skipped");
  ok(planImageOptimize({ mime: "application/pdf", size: MB }).action === "skip", "pdf skipped");
  ok(planImageOptimize({ mime: "image/jpeg", size: 0 }).action === "skip", "empty skipped");
  const j = planImageOptimize({ mime: "image/jpeg", size: 12 * MB, width: 6000, height: 4000 });
  ok(j.action === "convert" && j.quality === OPTIMIZE_PHOTO_QUALITY && j.maxDim === 3840, "big jpeg → webp q82 ≤3840");
  const p = planImageOptimize({ mime: "IMAGE/PNG; x", size: 3 * MB, width: 1200, height: 800 });
  ok(p.action === "convert" && p.quality === OPTIMIZE_GRAPHIC_QUALITY, "png → webp q90 (case/params ok)");
  ok(planImageOptimize({ mime: "image/webp", size: 300_000, width: 1600, height: 900 }).action === "skip", "small webp kept");
  ok(planImageOptimize({ mime: "image/webp", size: 300_000, width: 5000, height: 900 }).action === "convert", "oversized webp resized");
  ok(planImageOptimize({ mime: "image/webp", size: 3 * MB, width: 1600, height: 900 }).action === "convert", "heavy webp re-encoded");
  ok(planImageOptimize({ mime: "image/webp", size: 300_000 }).action === "convert", "unknown-dims webp → let sharp decide");
  ok(OPTIMIZE_MAX_DIM < VERCEL_SOURCE_MAX_DIM, "master is inside Vercel's 8192 px source limit");
  ok(keepOptimized({ originalBytes: 100, optimizedBytes: 50, resized: false }), "smaller kept");
  ok(!keepOptimized({ originalBytes: 100, optimizedBytes: 120, resized: false }), "bigger & not resized → original kept");
  ok(keepOptimized({ originalBytes: 100, optimizedBytes: 120, resized: true }), "resized always kept");
  ok(!keepOptimized({ originalBytes: 100, optimizedBytes: 0, resized: true }), "empty output refused");
  ok(webpFilename("Photo.Final.PNG") === "Photo.Final.webp" && webpFilename("noext") === "noext.webp", "webpFilename");
  ok(webpStorageKey("home-hero/0123456789abcdef-banner.JPG") === "home-hero/0123456789abcdef-banner.webp", "webpStorageKey");
  ok(webpStorageKey("a/b.gif") === "a/b.gif", "non-photo key unchanged");
  ok(savingsLabel(12 * MB, 640 * 1024).includes("12.0 MB → 640 KB") && savingsLabel(12 * MB, 640 * 1024).includes("95%"), "savingsLabel");
  return { passed, failed };
}
