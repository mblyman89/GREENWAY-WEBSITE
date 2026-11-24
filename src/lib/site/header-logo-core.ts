/**
 * src/lib/site/header-logo-core.ts — USAGE-8f (2026-11-25)
 *
 * WHY: the header wordmark (on every page) declared its 5891×1170 asset size
 * plus a 5-breakpoint `sizes` ending in `44vw`, so next/image wrote a long
 * srcSet into the <img> AND into the priority <link rel="preload"> of every
 * page, about 6 KB per ISR write. Each width is also a separate
 * image-optimizer variant per format.
 *
 * FIX: declare the widest box the logo is ever displayed at
 * (`xl:w-[25rem]` = 400 CSS px) and drop `sizes`. next/image then emits
 * a 1x/2x srcSet (640w / 828w). CSS still sets the displayed width, so the
 * layout does not change. The aspect ratio matches the asset, so there is no CLS.
 */

/** Widest displayed header-logo box, at the wordmark asset's 5891:1170 ratio. */
export const HEADER_LOGO_PX = { width: 400, height: 79 } as const;

export const HEADER_LOGO_ASSET = { width: 5891, height: 1170 } as const;

/** Largest Tailwind `w-[Nrem]` in a className, in CSS px (16 px/rem), or 0. */
export function maxRemWidthPx(className: string): number {
  let max = 0;
  for (const m of className.matchAll(/w-\[(\d+(?:\.\d+)?)rem\]/g)) max = Math.max(max, Number(m[1]) * 16);
  return max;
}

export function __runHeaderLogoTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`header-logo-core FAIL: ${name}`);
    }
  };
  const ratio = HEADER_LOGO_ASSET.width / HEADER_LOGO_ASSET.height;
  ok(Math.abs(HEADER_LOGO_PX.width / HEADER_LOGO_PX.height - ratio) / ratio < 0.01, "keeps the asset ratio");
  ok(maxRemWidthPx("w-[clamp(8.4rem,44vw,10.25rem)] md:w-[19rem] xl:w-[25rem]") === 400, "max rem width");
  ok(maxRemWidthPx("w-full") === 0, "no rem width");
  ok(maxRemWidthPx("sm:w-[11.75rem]") === 188, "fractional rem");
  ok(HEADER_LOGO_PX.width === 400, "400 css px = xl:w-[25rem]");
  if (failed > 0) throw new Error(`header-logo-core: ${failed} failed`);
  return { passed, failed };
}
