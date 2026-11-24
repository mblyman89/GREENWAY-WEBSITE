/**
 * D271 - shared "see-through background" + print enlarge (server only).
 * GPT Image 2 refuses transparent output and FLUX / Gemini never return
 * alpha, so every Remove background in the app ends here: the AI paints the
 * subject on flat magenta (or the picture already sits on a flat colour) and
 * we key that colour out on our server (edge flood-fill, soft edge).
 */
import "server-only";
import { KEY_MAX_PX, borderColor, keyOutBackground } from "@/lib/merch-studio/art-prep-core";
import { printEnlargePlan } from "@/lib/printing/print-layers-core";

export type KeyOut = { png: Buffer; cleared: number } | { already: true } | null;

/** Key the flat border colour out. null = the border is not one flat colour (needs AI first). */
export async function keyOutBuffer(buf: Buffer, minUniform: number): Promise<KeyOut> {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(buf, { limitInputPixels: KEY_MAX_PX }).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = borderColor(data, info.width, info.height);
  if (b.transparent > 0.6) return { already: true };
  if (b.uniform < minUniform) return null;
  const cleared = keyOutBackground(data, info.width, info.height, b.color);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
  return { png, cleared };
}

/** Print enlarge (Lanczos + light sharpen). PNG when see-through, else high-quality JPEG (huge banners stay uploadable). */
export async function enlargeBuffer(buf: Buffer, target?: { w: number; h: number } | null): Promise<{ ok: true; out: Buffer; mime: string; width: number; height: number; factor: number } | { ok: false; error: string }> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buf).metadata();
  const plan = printEnlargePlan(meta.width ?? 0, meta.height ?? 0, target);
  if (!plan.ok) return plan;
  const img = sharp(buf, { limitInputPixels: 16384 * 16384 }).rotate().resize({ width: plan.width, height: plan.height, kernel: "lanczos3" }).sharpen({ sigma: 0.6 });
  const png = Boolean(meta.hasAlpha);
  const out = png ? await img.png({ compressionLevel: 9 }).toBuffer() : await img.jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
  return { ok: true, out, mime: png ? "image/png" : "image/jpeg", width: plan.width, height: plan.height, factor: plan.factor };
}
