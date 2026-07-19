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
