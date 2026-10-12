/**
 * R45-S2: tiny blurred "preview" images shown while a banner photo loads.
 *
 * Source: the Next.js 16 next/image docs (node_modules/next/dist/docs/01-app/
 * 03-api-reference/02-components/image.md, props `placeholder` and
 * `blurDataURL`):
 *  - "If the image is dynamic or remote, you must provide blurDataURL yourself."
 *  - "The image is automatically enlarged and blurred, so a very small image
 *    (10px or less) is recommended."
 *  - "A large blurDataURL may hurt performance. Keep it small and simple."
 *
 * Our media lives in Supabase Storage (remote), so we make the preview once at
 * upload time, store it on media_assets.blur_data_url (migration 0266), and
 * look it up by URL when a banner renders. This file is the pure part:
 * validating a preview before it is stored or rendered, and sizing it.
 */

/** Longest side of the preview, in pixels (Next docs: "10px or less"). */
export const BLUR_MAX_DIM = 10;
/** Hard cap on the stored data URL. A 10px WebP/JPEG is a few hundred bytes. */
export const BLUR_MAX_CHARS = 1500;
/** Formats we accept for the preview itself. */
export const BLUR_MIMES = ["image/webp", "image/jpeg", "image/png"] as const;
/** Only these source types get a preview (Vercel optimizes jpeg/png/webp/avif; GIF/SVG are served as-is). */
export const BLUR_SOURCE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;

const DATA_URL_RE = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/;

/** Is this a safe, small preview we are willing to store and render? Returns it trimmed, or null. */
export function cleanBlurDataUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > BLUR_MAX_CHARS) return null;
  const m = DATA_URL_RE.exec(s);
  if (!m) return null;
  if (m[2]!.length % 4 !== 0) return null; // valid base64 is padded to 4
  if (m[2]!.length < 16) return null; // too small to be a real image
  return s;
}

/** Should a source of this type get a preview? */
export function wantsBlur(mime: unknown): boolean {
  return typeof mime === "string" && (BLUR_SOURCE_MIMES as readonly string[]).includes(mime.toLowerCase().split(";")[0]!.trim());
}

/** Preview size that keeps the aspect ratio, longest side = BLUR_MAX_DIM, at least 1px. */
export function blurSize(width: number, height: number): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = BLUR_MAX_DIM / Math.max(width, height);
  const s = Math.min(1, scale);
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** Pick the preview for a given banner src from a URL -> preview map (server-side lookup result). */
export function blurFor(src: unknown, map: ReadonlyMap<string, string> | null | undefined): string | undefined {
  if (typeof src !== "string" || !src || !map) return undefined;
  const hit = map.get(src) ?? map.get(src.split("?")[0]!);
  return hit ? cleanBlurDataUrl(hit) ?? undefined : undefined;
}

/** Unique, non-empty http(s) URLs to look up (caps the query size). */
export function blurLookupUrls(srcs: ReadonlyArray<unknown>, max = 40): string[] {
  const out = new Set<string>();
  for (const s of srcs) {
    if (typeof s !== "string") continue;
    const u = s.trim().split("?")[0]!;
    if (/^https:\/\//.test(u)) out.add(u);
    if (out.size >= max) break;
  }
  return [...out];
}

// ── Self-tests ──────────────────────────────────────────────────────────────

export function __runBlurPlaceholderCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("blur-placeholder-core FAIL:", m);
    }
  };
  const good = "data:image/webp;base64," + "UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=";
  ok(cleanBlurDataUrl(good) === good, "valid webp preview");
  ok(cleanBlurDataUrl(`  ${good}  `) === good, "trimmed");
  ok(cleanBlurDataUrl(good.replace("webp", "jpeg")) !== null, "jpeg ok");
  ok(cleanBlurDataUrl(good.replace("webp", "png")) !== null, "png ok");
  ok(cleanBlurDataUrl(good.replace("image/webp", "image/svg+xml")) === null, "svg refused (script risk)");
  ok(cleanBlurDataUrl(good.replace("image/webp", "text/html")) === null, "html refused");
  ok(cleanBlurDataUrl("data:image/webp;base64,AAA") === null, "bad padding / tiny refused");
  ok(cleanBlurDataUrl("data:image/webp;base64,AAAA") === null, "too small refused");
  ok(cleanBlurDataUrl("data:image/webp;base64," + "A".repeat(BLUR_MAX_CHARS)) === null, "oversized refused");
  ok(cleanBlurDataUrl('data:image/webp;base64,AAAA"onload=x') === null, "quote injection refused");
  ok(cleanBlurDataUrl("https://x/y.webp") === null, "url refused");
  ok(cleanBlurDataUrl(null) === null && cleanBlurDataUrl(5) === null && cleanBlurDataUrl("") === null, "non-string/empty");

  ok(wantsBlur("image/jpeg") && wantsBlur("image/png") && wantsBlur("IMAGE/WEBP"), "raster sources");
  ok(!wantsBlur("image/gif") && !wantsBlur("image/svg+xml") && !wantsBlur("video/mp4") && !wantsBlur(undefined), "non-raster skipped");

  const a = blurSize(1600, 400);
  ok(a?.width === 10 && a.height === 3, "wide banner 10x3");
  const b = blurSize(400, 1600);
  ok(b?.width === 3 && b.height === 10, "tall 3x10");
  const c = blurSize(5000, 10);
  ok(c?.width === 10 && c.height === 1, "extreme ratio keeps 1px min");
  const d = blurSize(6, 4);
  ok(d?.width === 6 && d.height === 4, "already tiny not upscaled");
  ok(blurSize(0, 10) === null && blurSize(NaN, 10) === null && blurSize(-1, 5) === null, "bad dims");

  const map = new Map([["https://p.supabase.co/storage/v1/object/public/media/a.jpg", good]]);
  ok(blurFor("https://p.supabase.co/storage/v1/object/public/media/a.jpg", map) === good, "lookup hit");
  ok(blurFor("https://p.supabase.co/storage/v1/object/public/media/a.jpg?v=2", map) === good, "lookup ignores query");
  ok(blurFor("https://other/b.jpg", map) === undefined, "miss");
  ok(blurFor("", map) === undefined && blurFor("x", null) === undefined, "empty/no map");
  ok(blurFor("k", new Map([["k", "data:text/html;base64,AAAA"]])) === undefined, "stored junk not rendered");

  const urls = blurLookupUrls(["https://a/1.jpg?x=1", "https://a/1.jpg", "/local.jpg", "", null, "http://insecure/x.jpg", "https://a/2.jpg"]);
  ok(urls.length === 2 && urls[0] === "https://a/1.jpg" && urls[1] === "https://a/2.jpg", "lookup urls dedupe + https only");
  ok(blurLookupUrls(Array.from({ length: 100 }, (_, i) => `https://a/${i}.jpg`), 5).length === 5, "capped");
  ok(BLUR_MAX_DIM <= 10, "Next docs: 10px or less");

  return { passed, failed };
}
