/**
 * src/lib/pos/pos-menu-transport-core.ts  (R74 S43)
 *
 * PURE helpers for shipping the register menu bundle (/api/pos/menu).
 *
 * WHY THIS EXISTS: after the Cultivera import the published menu holds
 * ~5,300 cards (~5,600 sellable sizes). Flattened for the register at
 * ~800 bytes a size, the JSON bundle crossed Vercel's hard 4.5 MB
 * Function RESPONSE cap. The download failed, the register kept its old
 * cached bundle (no Cultivera products), and every loaded website order
 * line was dropped as "no longer on the menu" - the sale opened empty.
 * The website menu was fine because it renders server-side.
 *
 * The fix gzips the bundle (JSON of repeated keys compresses ~8-12x) when
 * the caller accepts gzip, and the register now SAYS when the download
 * failed instead of silently selling from a stale cache.
 */

/** Vercel's Function response body cap (bytes). */
export const VERCEL_RESPONSE_CAP_BYTES = 4.5 * 1024 * 1024;

/** Stay well under the cap so headers/overhead never tip it over. */
export const SAFE_RESPONSE_BYTES = Math.floor(VERCEL_RESPONSE_CAP_BYTES * 0.9);

/** True when the request's Accept-Encoding allows gzip (q=0 refuses it). */
export function acceptsGzip(acceptEncoding: string | null | undefined): boolean {
  const raw = (acceptEncoding ?? "").toLowerCase();
  if (!raw.trim()) return false;
  for (const part of raw.split(",")) {
    const [name, ...params] = part.trim().split(";");
    const enc = name.trim();
    if (enc !== "gzip" && enc !== "*") continue;
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (q && Number(q.slice(2)) === 0) continue;
    return true;
  }
  return false;
}

/**
 * Plain-English verdict on a bundle body size, logged server-side so an
 * oversize menu is never silent again.
 */
export function bundleSizeVerdict(bytes: number, gzipped: boolean): { ok: boolean; message: string } {
  const mb = (bytes / (1024 * 1024)).toFixed(2);
  if (bytes <= SAFE_RESPONSE_BYTES) {
    return { ok: true, message: `register menu bundle ${mb} MB${gzipped ? " (gzipped)" : ""}` };
  }
  return {
    ok: false,
    message:
      `register menu bundle is ${mb} MB${gzipped ? " even gzipped" : " uncompressed"} - over the safe ` +
      `${(SAFE_RESPONSE_BYTES / (1024 * 1024)).toFixed(2)} MB limit; the register download may fail.`,
  };
}

/**
 * What the register tells staff when the menu download fails, so a stale
 * cache is never mistaken for "these products are not sellable".
 */
export function menuRefreshFailureMessage(status: number | null, cachedCount: number | null): string {
  const why = status == null ? "the server could not be reached" : `the server answered ${status}`;
  const cache =
    cachedCount == null
      ? "There is no saved menu on this register yet."
      : `The register is still using its last saved menu (${cachedCount} item size(s)), which may be missing newer products.`;
  return `Menu download failed (${why}). ${cache} Tap Refresh menu to try again.`;
}

// ---------------------------------------------------------------------------
// Embedded self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runPosMenuTransportTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.log("FAIL:", m);
    }
  };
  ok(acceptsGzip("gzip, deflate, br"), "browser default accepts gzip");
  ok(acceptsGzip("br;q=1.0, gzip;q=0.8"), "weighted gzip accepted");
  ok(acceptsGzip("*"), "wildcard accepts gzip");
  ok(!acceptsGzip("gzip;q=0"), "q=0 refuses gzip");
  ok(!acceptsGzip("identity"), "identity only -> no gzip");
  ok(!acceptsGzip(null) && !acceptsGzip(""), "missing header -> no gzip");
  ok(bundleSizeVerdict(1_000_000, true).ok, "1 MB is fine");
  ok(!bundleSizeVerdict(4_700_000, false).ok, "4.7 MB plain is over the cap");
  ok(bundleSizeVerdict(4_700_000, false).message.includes("may fail"), "oversize message names the risk");
  ok(menuRefreshFailureMessage(500, 120).includes("120 item size(s)"), "failure names the stale cache size");
  ok(menuRefreshFailureMessage(null, null).includes("could not be reached"), "offline failure is named");
  return { passed, failed };
}
