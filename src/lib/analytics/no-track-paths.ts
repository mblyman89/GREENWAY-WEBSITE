/**
 * R39 S7 — pages that must never load third-party analytics.
 *
 * The vendor signing link carries a secret token in the URL path
 * (/vendor-ach/<token>). GA4's page_view sends page_location (the full URL)
 * to Google, so loading it there would hand the bearer token to a third
 * party. These pages render no analytics at all; they also send
 * Referrer-Policy: no-referrer (page metadata) and are disallowed in robots.
 *
 * Same matching rule as the age gate: the prefix itself or anything beneath
 * it, never a look-alike route such as /vendor-achievements.
 */
export const NO_TRACK_PREFIXES = ["/vendor-ach"] as const;

export function isNoTrackPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return NO_TRACK_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function __runNoTrackPathTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed += 1;
    else {
      failed += 1;
      console.error(`[no-track-paths] FAIL: ${label}`);
    }
  };
  ok(isNoTrackPath("/vendor-ach"), "the prefix itself");
  ok(isNoTrackPath("/vendor-ach/AbC_123-xyz"), "a signing link");
  ok(isNoTrackPath("/vendor-ach/AbC/copy"), "the signed copy download");
  ok(!isNoTrackPath("/vendor-achievements"), "look-alike route still tracked");
  ok(!isNoTrackPath("/vendor-delivery"), "vendor directory still tracked");
  ok(!isNoTrackPath("/"), "home still tracked");
  ok(!isNoTrackPath("/menu/flower"), "menu still tracked");
  ok(!isNoTrackPath(null) && !isNoTrackPath(undefined) && !isNoTrackPath(""), "missing path -> normal page");
  return { passed, failed };
}
