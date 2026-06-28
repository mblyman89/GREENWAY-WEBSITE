/**
 * src/lib/media/image-dimensions.ts
 *
 * Dependency-free image dimension probing from a file buffer. We parse just the
 * header bytes for the common web raster formats so the Media Library can store
 * width/height on upload (used for thumbnails, "is this big enough for a hero?"
 * guardrails, and layout). Returns null for SVG/PDF/unknown — those don't have
 * pixel dimensions we can trust from a header.
 *
 * Supported: PNG, JPEG, GIF, WEBP (VP8 / VP8L / VP8X).
 */

export type ImageDimensions = { width: number; height: number };

export function probeImageDimensions(buf: Buffer, mime: string): ImageDimensions | null {
  try {
    const m = (mime || "").toLowerCase();
    if (m === "image/png") return png(buf);
    if (m === "image/jpeg") return jpeg(buf);
    if (m === "image/gif") return gif(buf);
    if (m === "image/webp") return webp(buf);
    // Fall back to sniffing by magic bytes if MIME is unreliable.
    return png(buf) ?? jpeg(buf) ?? gif(buf) ?? webp(buf);
  } catch {
    return null;
  }
}

function png(buf: Buffer): ImageDimensions | null {
  // 89 50 4E 47 0D 0A 1A 0A, then IHDR at offset 16 (width) / 20 (height).
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gif(buf: Buffer): ImageDimensions | null {
  // "GIF87a" / "GIF89a", then little-endian width/height at bytes 6/8.
  if (buf.length < 10) return null;
  if (buf.toString("ascii", 0, 3) !== "GIF") return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function jpeg(buf: Buffer): ImageDimensions | null {
  // FF D8 ... walk markers to an SOF (start of frame) for dimensions.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off += 1;
      continue;
    }
    const marker = buf[off + 1];
    // SOF0..SOF15 except DHT(C4)/JPG(C8)/DAC(CC) carry frame dimensions.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      return { width, height };
    }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

function webp(buf: Buffer): ImageDimensions | null {
  // RIFF....WEBP then a chunk: VP8 (lossy), VP8L (lossless), VP8X (extended).
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const fourcc = buf.toString("ascii", 12, 16);
  if (fourcc === "VP8 ") {
    // Lossy: dimensions are 14 bits each at offset 26/28 (after frame tag).
    const width = buf.readUInt16LE(26) & 0x3fff;
    const height = buf.readUInt16LE(28) & 0x3fff;
    return { width, height };
  }
  if (fourcc === "VP8L") {
    // Lossless: 1-byte signature (0x2f) then 14-bit width/height packed.
    const b0 = buf[21];
    const b1 = buf[22];
    const b2 = buf[23];
    const b3 = buf[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (fourcc === "VP8X") {
    // Extended: 24-bit width-1 / height-1 little-endian at offset 24/27.
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  return null;
}
