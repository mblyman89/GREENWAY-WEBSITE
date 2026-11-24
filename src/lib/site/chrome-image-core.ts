/**
 * src/lib/site/chrome-image-core.ts — USAGE-8b (2026-11-25)
 *
 * WHY: every fixed-size footer image (5 social glyphs, 2 app-store glyphs, the
 * app wordmark, the black-gold logo) was rendered with a
 * `sizes="NNpx"` prop. With `sizes`, next/image emits a srcSet over ALL 15
 * configured widths (32w … 3840w): ~2 KB of HTML per <img>. The footer renders
 * a mobile AND a desktop tree, so a product page carried 22 such tags = 45 KB
 * of HTML, in every response and every ISR write, on every page.
 *
 * Next/image docs: with a fixed `width` and NO `sizes`, the srcSet is a 1x/2x
 * density pair (2 entries). So each chrome image declares its DISPLAYED pixel
 * size here and passes no `sizes`. Same pixels on screen (CSS classes set the
 * box), ~85% fewer srcSet bytes.
 */

/** Displayed CSS pixel boxes for fixed-size site-chrome images. */
export const CHROME_IMAGE_PX = {
  /** Footer social + app-store glyph circles (`h-11 w-11`). */
  glyph: { width: 44, height: 44 },
  /** "App / DOWNLOAD" wordmark (`h-14 w-auto`, square asset). */
  appWordmark: { width: 56, height: 56 },
  /** Black-gold logo, mobile footer (`w-44`, square asset). */
  logoMobile: { width: 176, height: 176 },
  /** Black-gold logo, desktop footer (`w-48`, square asset). */
  logoDesktop: { width: 192, height: 192 },
} as const;

/**
 * Count `sizes="<n>px"` props in a component source. A fixed pixel `sizes`
 * on a fixed-size image is the pattern that produced the 15-entry srcSet.
 */
export function fixedPxSizesCount(source: string): number {
  return (source.match(/\bsizes=["']\d+px["']/g) ?? []).length;
}

export function __runChromeImageTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`chrome-image-core FAIL: ${name}`);
    }
  };
  ok(fixedPxSizesCount('<Image sizes="44px" />') === 1, "detects a fixed px sizes");
  ok(fixedPxSizesCount("<Image sizes='140px' /><Image sizes=\"176px\" />") === 2, "counts each");
  ok(fixedPxSizesCount('<Image sizes="(min-width: 1024px) 20rem, 18rem" />') === 0, "responsive sizes is not flagged");
  ok(fixedPxSizesCount("<Image width={44} />") === 0, "no sizes");
  ok(CHROME_IMAGE_PX.glyph.width === 44 && CHROME_IMAGE_PX.glyph.height === 44, "glyph is h-11 w-11");
  ok(CHROME_IMAGE_PX.appWordmark.height === 56, "wordmark is h-14");
  ok(CHROME_IMAGE_PX.logoMobile.width === 176 && CHROME_IMAGE_PX.logoDesktop.width === 192, "logo w-44 / w-48");
  ok(Object.keys(CHROME_IMAGE_PX).length === 4, "four fixed-size chrome images (hours card stays responsive: lg:max-w-none)");
  if (failed > 0) throw new Error(`chrome-image-core: ${failed} failed`);
  return { passed, failed };
}
