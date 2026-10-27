/**
 * PERF-S5: turn a Supabase Storage PUBLIC object URL into an Image
 * Transformation (render) URL at a small width, so admin grids download a
 * ~10-30 KB thumbnail instead of the full-size original (Supabase docs:
 * /storage/v1/render/image/public/<bucket>/<path>?width=&quality=; WebP is
 * served automatically to browsers that accept it). Non-Supabase URLs, GIFs
 * (would lose animation), SVGs and videos are returned unchanged.
 */
const OBJECT_SEG = "/storage/v1/object/public/";
const RENDER_SEG = "/storage/v1/render/image/public/";

export function adminThumbUrl(src: string | null | undefined, width = 320, quality = 70): string {
  if (!src) return "";
  if (!src.includes(OBJECT_SEG)) return src;
  const path = src.split(/[?#]/)[0].toLowerCase();
  if (/\.(gif|svg|mp4|webm|mov|m4v|pdf|json|lottie)$/.test(path)) return src;
  const w = Math.max(16, Math.min(2500, Math.round(width)));
  const q = Math.max(20, Math.min(100, Math.round(quality)));
  const base = src.replace(OBJECT_SEG, RENDER_SEG).split("#")[0];
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}width=${w}&quality=${q}&resize=contain`;
}
