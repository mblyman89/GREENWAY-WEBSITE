/**
 * gif-core — R43. Tiny, import-free helpers for animated GIF banners.
 *
 * Why: next/image routes every image through the /_next/image optimizer. For
 * an animated GIF the optimizer cannot resize without dropping the animation,
 * so Next passes it through untouched anyway — the round-trip only adds a
 * hop, an optimizer cache entry and (on Vercel) a billed transformation. The
 * banner renderers therefore set `unoptimized` when the source is a GIF so the
 * browser loads the original file directly from storage, animation intact.
 *
 * Also: the media library upload limit. Uploads go through a Server Action,
 * which on Vercel runs as a Function whose request body is capped at 4.5 MB
 * (platform limit; next.config's 50 MB bodySizeLimit cannot raise it). A file
 * above that never reaches our code — the platform returns 413. So the honest
 * per-file ceiling is just under 4.5 MB, minus room for the form's other
 * fields and multipart overhead.
 */

/** Per-file upload ceiling for the media library (bytes): 4 MB. */
export const MEDIA_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
/** Human text for the ceiling (keep in sync with MEDIA_UPLOAD_MAX_BYTES). */
export const MEDIA_UPLOAD_MAX_LABEL = "4 MB";

/** True when `src` points at a GIF (by extension or data: URL). Never throws. */
export function isGifSrc(src: unknown): boolean {
  if (typeof src !== "string") return false;
  const s = src.trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith("data:")) return s.startsWith("data:image/gif");
  const path = s.split(/[?#]/, 1)[0] ?? "";
  return path.endsWith(".gif");
}

/** Friendly size text, e.g. 4404019 -> "4.2 MB". */
export function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 MB";
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toString()} MB`;
}

/** Message shown when a file is over the ceiling. */
export function tooLargeMessage(name: string, bytes: number): string {
  const gifTip = /\.gif$/i.test(name)
    ? " For a GIF: make it shorter, or export it at a smaller size or lower quality in Canva."
    : " Export it smaller (WebP or JPG) and try again.";
  return `${name} is ${formatMegabytes(bytes)} — the upload limit is ${MEDIA_UPLOAD_MAX_LABEL} per file.${gifTip}`;
}

export function __runGifCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("gif-core FAIL:", m);
    }
  };
  ok(isGifSrc("https://x.supabase.co/storage/v1/object/public/media/rosin.gif"), "plain gif url");
  ok(isGifSrc("/media/ROSIN.GIF"), "uppercase");
  ok(isGifSrc("https://x/y.gif?v=2"), "query string");
  ok(isGifSrc("https://x/y.gif#t"), "hash");
  ok(isGifSrc(" /a.gif "), "trim");
  ok(isGifSrc("data:image/gif;base64,R0lG"), "data gif");
  ok(!isGifSrc("data:image/png;base64,AA"), "data png");
  ok(!isGifSrc("https://x/y.png"), "png");
  ok(!isGifSrc("https://x/y.webp?f=.gif"), "gif only in query");
  ok(!isGifSrc("https://x/gif/y.jpg"), "gif folder");
  ok(!isGifSrc("https://x/y.gifv"), "gifv");
  ok(!isGifSrc(""), "empty");
  ok(!isGifSrc(null), "null");
  ok(!isGifSrc(42), "number");
  ok(MEDIA_UPLOAD_MAX_BYTES < 4.5 * 1024 * 1024, "under the Vercel 4.5 MB body limit");
  ok(MEDIA_UPLOAD_MAX_LABEL === `${MEDIA_UPLOAD_MAX_BYTES / (1024 * 1024)} MB`, "label matches bytes");
  ok(formatMegabytes(4404019) === "4.2 MB", "format 4.2");
  ok(formatMegabytes(-1) === "0 MB", "format negative");
  ok(tooLargeMessage("rosin.gif", 6 * 1024 * 1024).includes("For a GIF"), "gif tip");
  ok(tooLargeMessage("a.png", 6 * 1024 * 1024).includes("6 MB"), "size in message");
  ok(!tooLargeMessage("a.png", 6 * 1024 * 1024).includes("For a GIF"), "no gif tip for png");
  return { passed, failed };
}
