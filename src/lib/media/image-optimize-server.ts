import "server-only";
import { keepOptimized, planImageOptimize, webpFilename } from "./image-optimize-core";

/**
 * R54 Slice A — the sharp half of upload-time optimisation.
 * Returns null when the original should be stored unchanged: the plan says
 * skip, the output isn't smaller, or sharp fails. A failure never blocks an
 * upload; the original simply stays.
 */
export type OptimizedImage = {
  buffer: Buffer;
  mime: "image/webp";
  filename: string;
  width: number;
  height: number;
  originalBytes: number;
};

export async function optimizeImageBuffer(input: {
  buffer: Uint8Array;
  mime: string;
  filename: string;
  width?: number | null;
  height?: number | null;
}): Promise<OptimizedImage | null> {
  const plan = planImageOptimize({ mime: input.mime, size: input.buffer.length, width: input.width, height: input.height });
  if (plan.action !== "convert") return null;
  try {
    const sharp = (await import("sharp")).default;
    // limitInputPixels guards against decompression bombs; 8192² is Vercel's source cap.
    const img = sharp(input.buffer, { failOn: "error", limitInputPixels: 8192 * 8192 });
    const meta = await img.metadata();
    const { data, info } = await img
      .rotate() // bake EXIF orientation in (metadata is stripped below)
      .resize(plan.maxDim, plan.maxDim, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: plan.quality, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    const srcLong = Math.max(Number(meta.width) || 0, Number(meta.height) || 0);
    const resized = srcLong > plan.maxDim;
    if (!keepOptimized({ originalBytes: input.buffer.length, optimizedBytes: data.length, resized })) return null;
    return {
      buffer: data,
      mime: "image/webp",
      filename: webpFilename(input.filename),
      width: info.width,
      height: info.height,
      originalBytes: input.buffer.length,
    };
  } catch {
    return null;
  }
}
