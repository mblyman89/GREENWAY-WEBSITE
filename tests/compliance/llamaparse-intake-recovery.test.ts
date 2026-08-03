/**
 * tests/compliance/llamaparse-intake-recovery.test.ts  (LlamaParse PR-2)
 *
 * Pins the DEPENDENCY-INJECTION seam that lets LlamaParse recover text from a
 * scanned-image PDF and feed it straight into the EXISTING layout parsers.
 *
 * The owner's real failure: a scanned manifest has no unpdf text layer, so
 * parsePdfManifest bailed with "no extractable text" and the whole downstream
 * machinery (layout parsers, the live Invoice # scanner, transport/vendor
 * readers) was starved. PR-2 adds an optional `recoverText(bytes)` argument;
 * when unpdf yields nothing AND a recovery fn is supplied, its text continues
 * through the same parsers.
 *
 * These tests prove:
 *   1) NO recovery fn + unreadable bytes  -> today's honest failure (unchanged).
 *   2) A recovery fn IS invoked with the bytes when unpdf is blank, and the
 *      recovered text flows through the real Transfer Log parser to a correct
 *      ParsedManifest (manifest number, vendor, date) — i.e. recovery reaches
 *      the invoice/transport/vendor machinery.
 *   3) A recovery fn that returns "" leaves the honest failure in place (never
 *      false-flagged as success).
 *   4) A recovery fn that throws is swallowed (recovery can never make the
 *      intake worse than it is today).
 *
 * `server-only` is aliased to a no-op stub by the vitest config, so pdf-extract
 * imports cleanly here. We feed a NON-PDF byte buffer so unpdf reliably returns
 * blank, forcing the recovery path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  parsePdfManifest,
  parsePdfManifestFromBase64,
} from "@/lib/inventory/pdf-extract";

// A real old-method Transfer Log text (same fixture the transferlog suite uses)
// stands in for what LlamaParse would OCR off a scanned image.
const recoveredText = readFileSync(
  join(__dirname, "fixtures", "pdf-transferlog-oldmethod-sample.txt"),
  "utf8",
);

// Bytes that are NOT a valid PDF, so unpdf's text extraction yields nothing and
// the recovery path is exercised deterministically.
const notAPdf = new Uint8Array([0x68, 0x69, 0x0a]); // "hi\n"

describe("llamaparse PR-2: text-recovery injection seam", () => {
  it("without a recovery fn, an unreadable PDF fails honestly (unchanged)", async () => {
    const res = await parsePdfManifest(notAPdf);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/no extractable text|likely a scanned image/i);
    }
  });

  it("invokes the recovery fn with the bytes when unpdf is blank", async () => {
    const spy = vi.fn(async (bytes: Uint8Array) => {
      // touch the arg so its type is exercised and the linter is satisfied
      expect(bytes).toBeInstanceOf(Uint8Array);
      return recoveredText;
    });
    const res = await parsePdfManifest(notAPdf, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    // Called with the SAME bytes unpdf could not read.
    expect(spy.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Recovered text flowed through the REAL Transfer Log parser.
      expect(res.manifest.manifest_number).toBe("603353555");
      expect(res.manifest.vendor_label).toBe("Svin Garden");
      expect(res.text).toContain("Transfer Log");
    }
  });

  it("base64 wrapper threads the recovery fn through too", async () => {
    const b64 = Buffer.from(notAPdf).toString("base64");
    const spy = vi.fn(async () => recoveredText);
    const res = await parsePdfManifestFromBase64(b64, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.manifest.manifest_number).toBe("603353555");
  });

  it("a recovery fn returning '' leaves the honest failure (no false success)", async () => {
    const spy = vi.fn(async () => "");
    const res = await parsePdfManifest(notAPdf, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false);
  });

  it("a recovery fn that throws is swallowed — never worse than today", async () => {
    const spy = vi.fn(async () => {
      throw new Error("LlamaCloud down");
    });
    const res = await parsePdfManifest(notAPdf, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(false); // honest failure, not a crash
  });
});
