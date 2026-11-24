/**
 * src/lib/site/content-page-ttl-core.ts — USAGE-8e (2026-11-25)
 *
 * WHY: /loyalty and /medical show CMS copy, banners and the loyalty program
 * numbers — no menu or inventory data — yet regenerated every 60 s (one ISR
 * write + 4–5 DB reads per minute per page while traffic lasts). Every writer
 * of what they show already clears them by path:
 *   - loyalty-page editor + hero  -> revalidatePath("/loyalty")
 *   - loyalty program editors     -> revalidatePath("/loyalty")
 *   - medical-page editor         -> revalidatePath("/medical")
 *   - header/footer/banners/rules -> revalidatePath("/(site)", "layout")
 * so the TTL is a safety net only. /about already runs fully static.
 *
 * SAFE: an edit still shows on the next load (on-demand revalidation). The
 * worst case for anything that bypasses those paths is one hour, not one
 * minute. Draft Mode still bypasses the route cache for staff preview.
 */

export const CONTENT_PAGE_TTL_SECONDS = 3600;

/** Route file -> the admin action file that clears it by path. */
export const CONTENT_PAGE_WRITERS: Readonly<Record<string, readonly string[]>> = {
  "src/app/(site)/loyalty/page.tsx": [
    "src/app/admin/loyalty-page/actions.ts",
    "src/app/admin/loyalty/actions.ts",
  ],
  "src/app/(site)/medical/page.tsx": ["src/app/admin/medical-page/actions.ts"],
};

/** The numeric `export const revalidate = N;` of a route source, or null. */
export function routeRevalidateSeconds(source: string): number | null {
  const m = /^export const revalidate = (\d+);/m.exec(source);
  return m ? Number(m[1]) : null;
}

export function __runContentPageTtlTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string) => {
    if (cond) passed++;
    else {
      failed++;
      console.error(`content-page-ttl-core FAIL: ${name}`);
    }
  };
  ok(routeRevalidateSeconds("export const revalidate = 3600;") === 3600, "parses 3600");
  ok(routeRevalidateSeconds("x\nexport const revalidate = 60;\n") === 60, "parses on a later line");
  ok(routeRevalidateSeconds("// export const revalidate = 5;") === null, "ignores a comment");
  ok(routeRevalidateSeconds('export const dynamic = "force-dynamic";') === null, "no revalidate");
  ok(CONTENT_PAGE_TTL_SECONDS === 3600, "one hour");
  ok(Object.keys(CONTENT_PAGE_WRITERS).length === 2, "two content pages");
  if (failed > 0) throw new Error(`content-page-ttl-core: ${failed} failed`);
  return { passed, failed };
}
