/**
 * tests/compliance/harvest-image-sniff.test.ts
 *
 * sniffImageMime() lives in a `server-only`-marked module; the vitest config
 * aliases "server-only" to a no-op stub, so we can unit-test the magic-byte
 * sniffer here directly. This locks the fix that lets GrowFlow's Azure blob
 * images (served as application/octet-stream) import correctly, WITHOUT ever
 * widening what content is accepted (non-image bytes must still fail closed).
 */
import { describe, expect, it } from "vitest";

import { sniffImageMime } from "@/lib/media/harvest";

/** Build a buffer from a byte array padded to at least 12 bytes. */
function bytes(...b: number[]): Buffer {
  const arr = [...b];
  while (arr.length < 12) arr.push(0x00);
  return Buffer.from(arr);
}

describe("sniffImageMime", () => {
  it("detects PNG", () => {
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
  });

  it("detects JPEG", () => {
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
  });

  it("detects GIF87a and GIF89a", () => {
    expect(sniffImageMime(bytes(0x47, 0x49, 0x46, 0x38, 0x37, 0x61))).toBe("image/gif");
    expect(sniffImageMime(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))).toBe("image/gif");
  });

  it("detects WEBP (RIFF....WEBP)", () => {
    // "RIFF" (52 49 46 46) + 4 size bytes + "WEBP" (57 45 42 50)
    expect(
      sniffImageMime(
        bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50),
      ),
    ).toBe("image/webp");
  });

  it("detects AVIF via the ISO-BMFF ftyp brand (R2)", () => {
    // 4 size bytes + "ftyp" + "avif"
    expect(
      sniffImageMime(
        bytes(0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66),
      ),
    ).toBe("image/avif");
    // "avis" (AVIF sequence) is AVIF too
    expect(
      sniffImageMime(
        bytes(0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73),
      ),
    ).toBe("image/avif");
  });

  it("detects HEIC brands so the refusal can be honest (R2)", () => {
    for (const brand of ["heic", "heix", "hevc", "mif1", "msf1"]) {
      const b = [0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, ...[...brand].map((c) => c.charCodeAt(0))];
      expect(sniffImageMime(bytes(...b))).toBe("image/heic");
    }
  });

  it("detects TIFF in both byte orders (R2)", () => {
    expect(sniffImageMime(bytes(0x49, 0x49, 0x2a, 0x00))).toBe("image/tiff"); // II*\0
    expect(sniffImageMime(bytes(0x4d, 0x4d, 0x00, 0x2a))).toBe("image/tiff"); // MM\0*
  });

  it("detects BMP (R2)", () => {
    expect(sniffImageMime(bytes(0x42, 0x4d, 0x36, 0x00))).toBe("image/bmp");
  });

  it("does not misread an ftyp box with an unknown brand (e.g. mp4 video)", () => {
    // "ftyp" + "isom" — an MP4, not an image.
    expect(
      sniffImageMime(
        bytes(0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d),
      ),
    ).toBeNull();
  });

  it("returns null for non-image bytes (fails closed)", () => {
    // "%PDF" — a PDF must NOT be sniffed as an image.
    expect(sniffImageMime(bytes(0x25, 0x50, 0x44, 0x46, 0x2d))).toBeNull();
    // HTML "<!DOCTYPE"
    expect(sniffImageMime(Buffer.from("<!DOCTYPE html>"))).toBeNull();
    // Plain text
    expect(sniffImageMime(Buffer.from("just some words here"))).toBeNull();
  });

  it("returns null for too-short buffers", () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50]))).toBeNull();
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull();
  });

  it("does not misread RIFF that isn't WEBP (e.g. WAV audio)", () => {
    // "RIFF"...."WAVE" — valid RIFF container but audio, not an image.
    expect(
      sniffImageMime(
        bytes(0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45),
      ),
    ).toBeNull();
  });
});
