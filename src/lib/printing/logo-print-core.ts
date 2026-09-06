/**
 * src/lib/printing/logo-print-core.ts
 *
 * SLICE 23 — turn an uploaded logo into something a thermal printer can
 * actually print, without the black box.
 *
 * THE OWNER'S PROBLEM, IN HIS WORDS
 * ---------------------------------
 * "i will need your help making sure the logo printed on the receipt will look
 * good and only print the logo and not the background with it. i don't want to
 * see a black box… my logos are png files, so i am not sure if we need to add
 * a background remover"
 *
 * WHY THE BLACK BOX HAPPENS — MEASURED, NOT ASSUMED
 * ------------------------------------------------
 * A thermal head has exactly two states per dot: burn, or don't. There is no
 * grey. So every pixel must become one bit, and the ONLY question is where the
 * cut-off sits. Get it wrong and you burn the background.
 *
 * All four of the owner's logo files were inspected before any code was
 * written. Every one is mode=RGB with NO alpha channel. That matters: there is
 * no transparency to honour, so "just drop the transparent pixels" — the
 * obvious fix — does nothing at all. On the cloud logo the transparency
 * checkerboard is literally PAINTED INTO THE PIXELS as dark grey (sampled
 * around (11,10,12) and (16,16,16)); it looks transparent on screen and is
 * solid dark data to a printer.
 *
 * Naive "dark pixel = burn" on these exact files:
 *      cloud 78.1%   black&white 93.0%   green 100.0%   gold 94.1%
 * of the image burned. That is the black box, quantified.
 *
 * The same files, inverted and thresholded by Otsu's method:
 *      cloud 24.2%   black&white  7.2%   green   6.7%   gold  7.2%
 * — which is just the artwork.
 *
 * WHY A FIXED THRESHOLD IS NOT ENOUGH (the subtle trap)
 * -----------------------------------------------------
 * The green logo's glyphs are (35,143,66), luminance ≈ 102. A fixed threshold
 * of 128 classifies those glyphs as "background" and erases the logo entirely
 * — 0.0% burned, a blank slip of paper. So the threshold MUST be derived from
 * each image. Otsu's per-image thresholds on these files were 100, 115, 46 and
 * 79 respectively; no single constant works for all four.
 *
 * THE APPROACH
 * ------------
 *   1. Luminance (Rec. 601 — matches perceived brightness, not a flat mean).
 *   2. Otsu's method picks the threshold by maximising between-class variance,
 *      i.e. it finds the split the image itself already contains.
 *   3. Polarity is decided by sampling the BORDER, because on a logo the edge
 *      pixels are background essentially by definition. Whichever side of the
 *      threshold the border sits on becomes "don't burn". This is what makes
 *      one pipeline handle both dark-background and light-background art with
 *      no toggle for the owner to get wrong.
 *   4. Alpha, when present, wins outright — a transparent pixel never burns.
 *   5. A safety valve: if the result would still burn an implausible share of
 *      the paper, say so instead of printing it.
 *
 * PURE: no imports, no I/O, no canvas, no Date, no randomness. Callers hand in
 * raw RGBA and get back a decision they can inspect and test. Never imports
 * "server-only" (house rule for pure cores).
 */

/** A decoded image as flat RGBA bytes, exactly as canvas getImageData yields. */
export type RgbaImage = {
  width: number;
  height: number;
  /** length must be width*height*4 */
  data: Uint8ClampedArray | Uint8Array | number[];
};

/** The 1-bit result plus everything needed to explain and audit it. */
export type LogoBitmap = {
  ok: boolean;
  error?: string;
  width: number;
  height: number;
  /** Row-major, one entry per pixel. true = burn (black dot). */
  pixels: boolean[];
  /** The Otsu threshold actually used, 0..255. */
  threshold: number;
  /** True when DARK pixels were treated as ink (the usual case). */
  darkIsInk: boolean;
  /** Share of pixels that will burn, 0..1. The black-box detector. */
  coverage: number;
  /** True when the source carried a usable alpha channel. */
  hadAlpha: boolean;
  /** Non-fatal observations worth showing the owner. */
  warnings: string[];
};

/**
 * Above this share of burned pixels a "logo" is really a filled rectangle.
 * The owner's naive-threshold measurements ran 78-100%; clean renders of the
 * same art ran 6.7-24.2%. 60% sits far above every good case and far below
 * every bad one, so it separates them without being tuned to one file.
 */
export const LOGO_MAX_COVERAGE = 0.6;

/** Below this, effectively nothing prints — the green-logo failure mode. */
export const LOGO_MIN_COVERAGE = 0.005;

/** Rec. 601 luma. Weighted because the eye is far more sensitive to green. */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Otsu's method: the threshold that maximises between-class variance.
 *
 * Equivalently it minimises the variance WITHIN each class, i.e. it finds the
 * split the histogram already suggests. This is why it adapts to art the owner
 * has not uploaded yet — nothing about it is tuned to a specific logo.
 *
 * Returns 128 for a degenerate (single-value) histogram; with only one
 * intensity present there is no split to find, and any value behaves alike.
 *
 * CONVENTION — and it is load-bearing: the returned value t is INCLUSIVE of
 * the dark class. Class 0 is [0..t], class 1 is [t+1..255]. So a pixel is dark
 * when `lum <= t`, never `lum < t`. The distinction is not academic: for black
 * artwork on white paper the histogram has peaks at 0 and 255 and Otsu returns
 * t = 0, so a `<` comparison classifies NOTHING as dark and the logo prints as
 * a blank slip. Every comparison against this value below uses `<=`.
 */
export function otsuThreshold(histogram: readonly number[]): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    const count = histogram[i] ?? 0;
    total += count;
    sum += i * count;
  }
  if (total === 0) return 128;

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 128;
  let bestVariance = -1;

  for (let t = 0; t < 256; t++) {
    weightBackground += histogram[t] ?? 0;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += t * (histogram[t] ?? 0);
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const delta = meanBackground - meanForeground;
    const variance = weightBackground * weightForeground * delta * delta;

    if (variance > bestVariance) {
      bestVariance = variance;
      best = t;
    }
  }
  return best;
}

export type LogoOptions = {
  /**
   * Force polarity instead of detecting it. Omit for auto-detect, which is the
   * recommended path — it reads the border rather than trusting a human to
   * know which way round their own file is.
   */
  darkIsInk?: boolean;
  /** Treat alpha below this as fully transparent. Default 128. */
  alphaThreshold?: number;
  /** Reject above this burned share. Default LOGO_MAX_COVERAGE. */
  maxCoverage?: number;
};

/**
 * Convert an RGBA image into a 1-bit print bitmap.
 *
 * Returns `ok: false` with a plain-language reason rather than throwing, so a
 * bad upload becomes a message on screen and never a broken receipt.
 */
export function toPrintBitmap(image: RgbaImage, options?: LogoOptions): LogoBitmap {
  const fail = (error: string): LogoBitmap => ({
    ok: false,
    error,
    width: 0,
    height: 0,
    pixels: [],
    threshold: 0,
    darkIsInk: true,
    coverage: 0,
    hadAlpha: false,
    warnings: [],
  });

  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return fail("That image has no usable dimensions.");
  }
  if (data.length !== width * height * 4) {
    return fail("That image data is the wrong size for its dimensions.");
  }

  const alphaCut = options?.alphaThreshold ?? 128;
  const maxCoverage = options?.maxCoverage ?? LOGO_MAX_COVERAGE;
  const warnings: string[] = [];
  const pixelCount = width * height;

  // Pass 1 — luminance, opacity, and the histogram Otsu needs. Fully
  // transparent pixels are excluded from the histogram: including them would
  // drag the threshold toward whatever arbitrary colour sits under a
  // transparent region, which is often pure black and would poison the split.
  const lum = new Float32Array(pixelCount);
  const opaque = new Uint8Array(pixelCount);
  const histogram = new Array<number>(256).fill(0);
  let hadAlpha = false;
  let opaqueCount = 0;

  for (let i = 0; i < pixelCount; i++) {
    const o = i * 4;
    const a = data[o + 3];
    if (a < 255) hadAlpha = true;
    const isOpaque = a >= alphaCut;
    opaque[i] = isOpaque ? 1 : 0;
    const l = luminance(data[o], data[o + 1], data[o + 2]);
    lum[i] = l;
    if (isOpaque) {
      histogram[Math.max(0, Math.min(255, Math.round(l)))] += 1;
      opaqueCount += 1;
    }
  }

  if (opaqueCount === 0) {
    return fail("That image is fully transparent — there is nothing to print.");
  }

  const threshold = otsuThreshold(histogram);

  // Polarity. On a logo, the border is background almost by definition, so
  // whichever side of the threshold the border sits on is the side we must NOT
  // burn. This is the step that removes the black box on files whose
  // "transparent" checkerboard was baked into the pixels as dark grey.
  let darkIsInk: boolean;
  if (typeof options?.darkIsInk === "boolean") {
    darkIsInk = options.darkIsInk;
  } else {
    let borderSum = 0;
    let borderCount = 0;
    const sample = (x: number, y: number) => {
      const idx = y * width + x;
      if (!opaque[idx]) return; // transparent border tells us nothing
      borderSum += lum[idx];
      borderCount += 1;
    };
    for (let x = 0; x < width; x++) {
      sample(x, 0);
      sample(x, height - 1);
    }
    for (let y = 0; y < height; y++) {
      sample(0, y);
      sample(width - 1, y);
    }
    if (borderCount === 0) {
      // Entirely transparent border: nothing to read, so assume the common
      // case of dark artwork on light paper and warn rather than guess quietly.
      darkIsInk = true;
      warnings.push(
        "The edges of this image are transparent, so light/dark was assumed. Check the preview.",
      );
    } else {
      const borderMean = borderSum / borderCount;
      // Border BRIGHT  -> background is light -> ink is dark.
      // Border DARK    -> background is dark  -> ink is light (inverted art).
      // Same inclusive convention: the border is 'dark' when it is <= t.
      darkIsInk = borderMean > threshold;
    }
  }

  // Pass 2 — the actual 1-bit decision.
  const pixels = new Array<boolean>(pixelCount);
  let burned = 0;
  for (let i = 0; i < pixelCount; i++) {
    if (!opaque[i]) {
      pixels[i] = false; // transparency never burns, full stop
      continue;
    }
    // `<=` because Otsu's threshold is INCLUSIVE of the dark class (see
    // otsuThreshold). Using `<` here prints black-on-white logos as blank paper.
    const isDark = lum[i] <= threshold;
    const ink = darkIsInk ? isDark : !isDark;
    pixels[i] = ink;
    if (ink) burned += 1;
  }

  const coverage = burned / pixelCount;

  // The black-box guard. This is the check that turns the owner's complaint
  // into something the software can catch by itself, before he wastes paper.
  if (coverage > maxCoverage) {
    return {
      ok: false,
      error:
        `This would print as a mostly-solid block (${Math.round(coverage * 100)}% of it would be ` +
        `black). That usually means the image has a filled background baked into it. ` +
        `A logo saved as plain black artwork on a white background prints best.`,
      width,
      height,
      pixels: [],
      threshold,
      darkIsInk,
      coverage,
      hadAlpha,
      warnings,
    };
  }
  if (coverage < LOGO_MIN_COVERAGE) {
    return {
      ok: false,
      error:
        `Almost nothing would print from this image (${(coverage * 100).toFixed(1)}% of it). ` +
        `It may be very light-coloured, or blank.`,
      width,
      height,
      pixels: [],
      threshold,
      darkIsInk,
      coverage,
      hadAlpha,
      warnings,
    };
  }

  if (!hadAlpha) {
    warnings.push(
      "This file has no transparency, so the background was detected from the image itself.",
    );
  }

  return {
    ok: true,
    width,
    height,
    pixels,
    threshold,
    darkIsInk,
    coverage,
    hadAlpha,
    warnings,
  };
}

/**
 * Box-filter downscale to a target width, preserving aspect ratio.
 *
 * Averaging every source pixel that lands in a destination cell (rather than
 * nearest-neighbour sampling) matters here: nearest-neighbour on line art
 * drops whole strokes when a thin line falls between sample points, which on a
 * receipt shows up as a logo with pieces missing. This runs BEFORE
 * thresholding, so the averaging happens in continuous tone where it is
 * meaningful, and the 1-bit decision is made once, at final size.
 */
export function resizeRgba(image: RgbaImage, targetWidth: number): RgbaImage | null {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (data.length !== width * height * 4) return null;
  const tw = Math.max(1, Math.floor(targetWidth));
  if (tw >= width) return image; // never upscale: it invents detail that is not there

  const th = Math.max(1, Math.round((height * tw) / width));
  const out = new Uint8ClampedArray(tw * th * 4);

  for (let y = 0; y < th; y++) {
    const sy0 = Math.floor((y * height) / th);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * height) / th));
    for (let x = 0; x < tw; x++) {
      const sx0 = Math.floor((x * width) / tw);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * width) / tw));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < width; sx++) {
          const o = (sy * width + sx) * 4;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          a += data[o + 3];
          n += 1;
        }
      }
      const d = (y * tw + x) * 4;
      out[d] = r / n;
      out[d + 1] = g / n;
      out[d + 2] = b / n;
      out[d + 3] = a / n;
    }
  }
  return { width: tw, height: th, data: out };
}

/** Trim uniform blank margin so the logo is not padded with dead paper. */
export function cropToInk(bitmap: LogoBitmap): LogoBitmap {
  if (!bitmap.ok || bitmap.pixels.length === 0) return bitmap;
  const { width, height, pixels } = bitmap;

  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  const rowHasInk = (y: number) => {
    for (let x = 0; x < width; x++) if (pixels[y * width + x]) return true;
    return false;
  };
  const colHasInk = (x: number) => {
    for (let y = 0; y < height; y++) if (pixels[y * width + x]) return true;
    return false;
  };

  while (top < height && !rowHasInk(top)) top += 1;
  if (top === height) return bitmap; // no ink at all; leave it alone
  while (bottom > top && !rowHasInk(bottom)) bottom -= 1;
  while (left < width && !colHasInk(left)) left += 1;
  while (right > left && !colHasInk(right)) right -= 1;

  const w = right - left + 1;
  const h = bottom - top + 1;
  if (w === width && h === height) return bitmap;

  const cropped = new Array<boolean>(w * h);
  let burned = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = pixels[(y + top) * width + (x + left)];
      cropped[y * w + x] = v;
      if (v) burned += 1;
    }
  }
  return { ...bitmap, width: w, height: h, pixels: cropped, coverage: burned / (w * h) };
}

/**
 * Render a 1-bit bitmap as a monochrome BMP data URI.
 *
 * BMP rather than PNG because a 1-bit BMP needs no compression at all — just a
 * header and packed bits — so it can be produced by this pure core with no
 * encoder, no dependency and no zlib. Every browser and every print pipeline
 * reads it. The bit depth is the point: an 8-bit or 24-bit image invites the
 * renderer to anti-alias, and anti-aliasing on a thermal head is precisely
 * what turns crisp artwork into a grey smear.
 */
export function bitmapToDataUri(bitmap: LogoBitmap): string {
  if (!bitmap.ok || bitmap.pixels.length === 0) return "";
  const { width, height, pixels } = bitmap;

  // BMP rows are padded to 4-byte boundaries and stored bottom-up.
  const rowBytes = Math.ceil(width / 8);
  const paddedRow = Math.ceil(rowBytes / 4) * 4;
  const pixelBytes = paddedRow * height;
  const paletteOffset = 14 + 40;
  const dataOffset = paletteOffset + 8; // two palette entries, 4 bytes each
  const fileSize = dataOffset + pixelBytes;

  const buf = new Uint8Array(fileSize);
  const u16 = (off: number, v: number) => {
    buf[off] = v & 0xff;
    buf[off + 1] = (v >>> 8) & 0xff;
  };
  const u32 = (off: number, v: number) => {
    buf[off] = v & 0xff;
    buf[off + 1] = (v >>> 8) & 0xff;
    buf[off + 2] = (v >>> 16) & 0xff;
    buf[off + 3] = (v >>> 24) & 0xff;
  };

  // BITMAPFILEHEADER
  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  u32(2, fileSize);
  u32(10, dataOffset);
  // BITMAPINFOHEADER
  u32(14, 40);
  u32(18, width);
  u32(22, height);
  u16(26, 1); // planes
  u16(28, 1); // bits per pixel
  u32(30, 0); // BI_RGB, uncompressed
  u32(34, pixelBytes);
  u32(38, 2835); // ~72 DPI
  u32(42, 2835);
  u32(46, 2); // colours used
  u32(50, 2); // colours important
  // Palette: index 0 = white, index 1 = black.
  buf[paletteOffset] = 0xff;
  buf[paletteOffset + 1] = 0xff;
  buf[paletteOffset + 2] = 0xff;
  buf[paletteOffset + 3] = 0x00;
  buf[paletteOffset + 4] = 0x00;
  buf[paletteOffset + 5] = 0x00;
  buf[paletteOffset + 6] = 0x00;
  buf[paletteOffset + 7] = 0x00;

  for (let y = 0; y < height; y++) {
    const srcRow = height - 1 - y; // BMP stores bottom-up
    const rowStart = dataOffset + y * paddedRow;
    for (let x = 0; x < width; x++) {
      if (pixels[srcRow * width + x]) {
        buf[rowStart + (x >>> 3)] |= 0x80 >>> (x & 7);
      }
    }
  }

  return `data:image/bmp;base64,${base64FromBytes(buf)}`;
}

/** Base64 without Buffer or btoa, so this core stays environment-agnostic. */
function base64FromBytes(bytes: Uint8Array): string {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += CHARS[(n >>> 18) & 63] + CHARS[(n >>> 12) & 63] + CHARS[(n >>> 6) & 63] + CHARS[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += CHARS[(n >>> 18) & 63] + CHARS[(n >>> 12) & 63] + "==";
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += CHARS[(n >>> 18) & 63] + CHARS[(n >>> 12) & 63] + CHARS[(n >>> 6) & 63] + "=";
  }
  return out;
}

/** The whole pipeline: resize, threshold, crop, encode. One call for callers. */
export function prepareLogoForPrint(
  image: RgbaImage,
  targetWidth: number,
  options?: LogoOptions,
): { ok: boolean; error?: string; dataUri: string; bitmap: LogoBitmap } {
  const resized = resizeRgba(image, targetWidth) ?? image;
  const bitmap = toPrintBitmap(resized, options);
  if (!bitmap.ok) return { ok: false, error: bitmap.error, dataUri: "", bitmap };
  const cropped = cropToInk(bitmap);
  return { ok: true, dataUri: bitmapToDataUri(cropped), bitmap: cropped };
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

/** Build a test image from a per-pixel colour function. */
function makeImage(
  width: number,
  height: number,
  fn: (x: number, y: number) => [number, number, number, number],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = fn(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return { width, height, data };
}

export function __runLogoPrintCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const check = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`[logo-print-core] FAIL: ${label}`);
    }
  };

  // --- luminance ------------------------------------------------------------
  check("luminance: pure white is 255", Math.round(luminance(255, 255, 255)) === 255);
  check("luminance: pure black is 0", luminance(0, 0, 0) === 0);
  check("luminance: green outweighs red", luminance(0, 255, 0) > luminance(255, 0, 0));
  check("luminance: red outweighs blue", luminance(255, 0, 0) > luminance(0, 0, 255));

  // --- Otsu -----------------------------------------------------------------
  {
    const empty = new Array<number>(256).fill(0);
    check("otsu: empty histogram falls back to 128", otsuThreshold(empty) === 128);

    const single = new Array<number>(256).fill(0);
    single[200] = 500;
    check("otsu: single-value histogram does not crash", otsuThreshold(single) >= 0);

    // A clean bimodal split at 30 and 220 must land the threshold between them.
    const bimodal = new Array<number>(256).fill(0);
    bimodal[30] = 1000;
    bimodal[220] = 1000;
    const t = otsuThreshold(bimodal);
    check(`otsu: bimodal threshold lands between the peaks (got ${t})`, t >= 30 && t < 220);

    // THE GREEN-LOGO CASE. Glyphs at luminance ~102 on a near-white ground.
    // A fixed 128 threshold would call the glyphs background and erase them;
    // Otsu must place the cut BELOW 102 so the glyphs survive as ink.
    const greenish = new Array<number>(256).fill(0);
    greenish[102] = 300; // the artwork
    greenish[250] = 3000; // the paper
    const gt = otsuThreshold(greenish);
    // Inclusive convention: the glyphs (luminance 102) must satisfy 102 <= t,
    // i.e. t >= 102, so they land in the DARK class and print as ink. A fixed
    // threshold of 128 would also pass here, but Otsu is what makes the green
    // logo (glyph luminance ~102) work WITHOUT hard-coding 128.
    check(`otsu: dark-green glyphs fall in the ink class (t=${gt})`, gt >= 102 && gt < 250);
  }

  // --- polarity detection ---------------------------------------------------
  {
    // Black mark on a white ground: ordinary artwork.
    const normal = makeImage(20, 20, (x, y) => {
      const inMark = x >= 6 && x < 14 && y >= 6 && y < 14;
      return inMark ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const a = toPrintBitmap(normal);
    check("polarity: normal art succeeds", a.ok);
    check("polarity: dark is ink on a light ground", a.darkIsInk === true);
    check("polarity: only the mark burns", Math.abs(a.coverage - 64 / 400) < 0.01);

    // White mark on a black ground: the same art, inverted. THIS is the file
    // that produces the black box under a naive threshold — here it must burn
    // the MARK, not the background.
    const inverted = makeImage(20, 20, (x, y) => {
      const inMark = x >= 6 && x < 14 && y >= 6 && y < 14;
      return inMark ? [255, 255, 255, 255] : [0, 0, 0, 255];
    });
    const b = toPrintBitmap(inverted);
    check("polarity: inverted art succeeds", b.ok);
    check("polarity: light is ink on a dark ground", b.darkIsInk === false);
    check("polarity: the background does NOT burn", b.coverage < 0.25);
    check(
      "polarity: inverted art burns the same area as normal art",
      Math.abs(a.coverage - b.coverage) < 0.001,
    );

    // Explicit override must beat detection.
    const forced = toPrintBitmap(inverted, { darkIsInk: true, maxCoverage: 1 });
    check("polarity: an explicit override is honoured", forced.darkIsInk === true);
    check("polarity: overriding wrongly DOES produce the black box", forced.coverage > 0.6);
  }

  // --- the black-box guard --------------------------------------------------
  {
    // A near-solid dark rectangle: 90% ink even after correct polarity.
    const slab = makeImage(20, 20, (x, y) => {
      const speck = x === 0 && y === 0;
      return speck ? [255, 255, 255, 255] : [10, 10, 10, 255];
    });
    const res = toPrintBitmap(slab, { darkIsInk: true });
    check("guard: a solid block is rejected", !res.ok);
    check("guard: the rejection explains itself", (res.error ?? "").includes("%"));
    check("guard: the rejection still reports coverage", res.coverage > LOGO_MAX_COVERAGE);

    // Nearly blank art.
    const blank = makeImage(20, 20, (x, y) =>
      x === 0 && y === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255],
    );
    const res2 = toPrintBitmap(blank);
    check("guard: a near-blank image is rejected", !res2.ok);
    check("guard: the blank rejection is worded differently", (res2.error ?? "").includes("Almost nothing"));
  }

  // --- alpha handling -------------------------------------------------------
  {
    // Black ink on a TRANSPARENT ground — the well-behaved PNG case.
    const withAlpha = makeImage(20, 20, (x, y) => {
      const inMark = x >= 8 && x < 12 && y >= 8 && y < 12;
      return inMark ? [0, 0, 0, 255] : [0, 0, 0, 0];
    });
    const res = toPrintBitmap(withAlpha);
    check("alpha: transparent-background art succeeds", res.ok);
    check("alpha: alpha channel is detected", res.hadAlpha === true);
    check("alpha: only the opaque mark burns", Math.abs(res.coverage - 16 / 400) < 0.01);
    check(
      "alpha: transparent pixels never burn",
      res.pixels[0] === false && res.pixels[res.pixels.length - 1] === false,
    );

    // Fully transparent is a clear, specific error.
    const clear = makeImage(10, 10, () => [0, 0, 0, 0]);
    const res2 = toPrintBitmap(clear);
    check("alpha: a fully transparent image is rejected", !res2.ok);
    check("alpha: that rejection says so plainly", (res2.error ?? "").includes("transparent"));

    // A file with no alpha must be flagged, since that is the owner's exact
    // situation and the reason background detection has to do the work.
    const noAlpha = makeImage(20, 20, (x, y) => {
      const inMark = x >= 6 && x < 14 && y >= 6 && y < 14;
      return inMark ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const res3 = toPrintBitmap(noAlpha);
    check("alpha: an alpha-free file is flagged", res3.hadAlpha === false);
    check("alpha: and the owner is told why", res3.warnings.some((w) => w.includes("transparency")));
  }

  // --- THE OWNER'S ACTUAL FILE, reproduced ----------------------------------
  // The cloud logo's "transparent" checkerboard is baked in as dark grey
  // (measured ~(11,10,12) and (16,16,16)) with light artwork on top. Naive
  // dark-is-ink burns 78.1% of it. Correct handling must burn only the art.
  {
    const bakedCheckerboard = makeImage(40, 40, (x, y) => {
      const inArt = x >= 12 && x < 28 && y >= 12 && y < 28;
      if (inArt) return [240, 240, 240, 255]; // light artwork
      // The fake checkerboard: two nearly-identical dark greys.
      const dark = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0;
      return dark ? [11, 10, 12, 255] : [16, 16, 16, 255];
    });
    const naive = toPrintBitmap(bakedCheckerboard, { darkIsInk: true, maxCoverage: 1 });
    check(`repro: naive dark-is-ink burns most of it (${Math.round(naive.coverage * 100)}%)`,
      naive.coverage > 0.6);

    const auto = toPrintBitmap(bakedCheckerboard);
    check("repro: auto-polarity succeeds on the baked checkerboard", auto.ok);
    check("repro: auto-polarity spots the dark background", auto.darkIsInk === false);
    check(`repro: only the artwork burns (${Math.round(auto.coverage * 100)}%)`,
      auto.coverage > 0.05 && auto.coverage < 0.35);
    check("repro: the fix is a large improvement", naive.coverage - auto.coverage > 0.4);
  }

  // --- resize ---------------------------------------------------------------
  {
    const big = makeImage(100, 50, () => [128, 128, 128, 255]);
    const small = resizeRgba(big, 20);
    check("resize: produces the requested width", small?.width === 20);
    check("resize: preserves aspect ratio", small?.height === 10);
    check("resize: buffer length matches dimensions",
      small!.data.length === small!.width * small!.height * 4);
    check("resize: flat grey stays flat grey", Math.abs(small!.data[0] - 128) <= 1);
    check("resize: never upscales", resizeRgba(big, 500)!.width === 100);
    check("resize: rejects malformed input",
      resizeRgba({ width: 0, height: 0, data: [] }, 10) === null);

    // Box filtering must PRESERVE a thin line that nearest-neighbour would drop.
    const thinLine = makeImage(100, 10, (x) => (x === 50 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const shrunk = resizeRgba(thinLine, 25)!;
    let darkest = 255;
    for (let i = 0; i < shrunk.width * shrunk.height; i++) darkest = Math.min(darkest, shrunk.data[i * 4]);
    check(`resize: a thin line survives downscaling (darkest ${Math.round(darkest)})`, darkest < 255);
  }

  // --- crop -----------------------------------------------------------------
  {
    const padded = makeImage(30, 30, (x, y) => {
      const inMark = x >= 10 && x < 20 && y >= 12 && y < 18;
      return inMark ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const bm = toPrintBitmap(padded);
    const cropped = cropToInk(bm);
    check("crop: width tightens to the ink", cropped.width === 10);
    check("crop: height tightens to the ink", cropped.height === 6);
    check("crop: every pixel is ink after cropping", cropped.pixels.every((p) => p));
    check("crop: coverage recomputed to 100%", Math.abs(cropped.coverage - 1) < 1e-9);
    check("crop: pixel buffer matches new dimensions",
      cropped.pixels.length === cropped.width * cropped.height);

    // Cropping an already-tight bitmap must be a no-op, not a slow copy.
    const tight = cropToInk(cropped);
    check("crop: an already-tight bitmap is unchanged", tight.width === 10 && tight.height === 6);
  }

  // --- BMP output -----------------------------------------------------------
  {
    const img = makeImage(16, 16, (x, y) => {
      const inMark = x >= 4 && x < 12 && y >= 4 && y < 12;
      return inMark ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const bm = toPrintBitmap(img);
    const uri = bitmapToDataUri(bm);
    check("bmp: emits a bmp data URI", uri.startsWith("data:image/bmp;base64,"));

    const b64 = uri.slice("data:image/bmp;base64,".length);
    check("bmp: base64 payload is well-formed", /^[A-Za-z0-9+/]+={0,2}$/.test(b64));
    check("bmp: base64 length is a multiple of 4", b64.length % 4 === 0);
    // "Qk" is base64 for a leading 0x42 0x4D — the BMP magic "BM".
    check("bmp: starts with the BMP magic number", b64.startsWith("Qk"));

    // Decode the header back and confirm the geometry round-trips.
    const bytes = Uint8Array.from(atobShim(b64), (c) => c.charCodeAt(0));
    const rd32 = (o: number) => bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24);
    const rd16 = (o: number) => bytes[o] | (bytes[o + 1] << 8);
    check("bmp: header width matches", rd32(18) === bm.width);
    check("bmp: header height matches", rd32(22) === bm.height);
    check("bmp: is 1 bit per pixel", rd16(28) === 1);
    check("bmp: is uncompressed", rd32(30) === 0);
    check("bmp: declares a 2-colour palette", rd32(46) === 2);
    check("bmp: file size field matches the payload", rd32(2) === bytes.length);

    check("bmp: a failed bitmap yields no URI", bitmapToDataUri({ ...bm, ok: false }) === "");
  }

  // --- base64 correctness, all three padding cases --------------------------
  {
    check("base64: 3 bytes -> no padding", base64FromBytes(new Uint8Array([77, 97, 110])) === "TWFu");
    check("base64: 2 bytes -> one '='", base64FromBytes(new Uint8Array([77, 97])) === "TWE=");
    check("base64: 1 byte -> two '='", base64FromBytes(new Uint8Array([77])) === "TQ==");
    check("base64: empty -> empty", base64FromBytes(new Uint8Array([])) === "");
    check("base64: high bytes encode correctly",
      base64FromBytes(new Uint8Array([255, 255, 255])) === "////");
  }

  // --- the whole pipeline ---------------------------------------------------
  {
    const logo = makeImage(400, 200, (x, y) => {
      const inMark = x >= 100 && x < 300 && y >= 60 && y < 140;
      return inMark ? [0, 0, 0, 255] : [255, 255, 255, 255];
    });
    const out = prepareLogoForPrint(logo, 220);
    check("pipeline: succeeds end to end", out.ok);
    check("pipeline: produces a data URI", out.dataUri.startsWith("data:image/bmp;base64,"));
    check("pipeline: respects the target width", out.bitmap.width <= 220);
    check("pipeline: cropped to the artwork", out.bitmap.coverage > 0.9);

    // Deterministic: the same file must yield byte-identical output every time.
    const again = prepareLogoForPrint(logo, 220);
    check("pipeline: is deterministic", out.dataUri === again.dataUri);

    // A bad upload fails cleanly rather than producing a black box.
    const slab = makeImage(100, 100, () => [0, 0, 0, 255]);
    const bad = prepareLogoForPrint(slab, 220);
    check("pipeline: a solid block is refused", !bad.ok);
    check("pipeline: refusal yields no URI", bad.dataUri === "");

    // Malformed input must be handled, not thrown on.
    const malformed = toPrintBitmap({ width: 10, height: 10, data: new Uint8ClampedArray(4) });
    check("pipeline: mismatched buffer length is rejected", !malformed.ok);
    check("pipeline: zero dimensions are rejected",
      !toPrintBitmap({ width: 0, height: 5, data: [] }).ok);
  }

  return { passed, failed };
}

/** Minimal base64 decode, for the self-test's header round-trip only. */
function atobShim(b64: string): string {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  const clean = b64.replace(/=+$/, "");
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    const v = CHARS.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >>> bits) & 0xff);
    }
  }
  return out;
}
