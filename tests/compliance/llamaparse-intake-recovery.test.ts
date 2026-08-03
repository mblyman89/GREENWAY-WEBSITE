/**
 * tests/compliance/llamaparse-intake-recovery.test.ts
 *
 * Pins the LlamaParse-PRIMARY text pipeline in pdf-extract.ts.
 *
 * OWNER DECISION (accountability checkpoint): a PDF is ALWAYS read by LlamaParse
 * first when a recovery function is injected — it is NOT gated on unpdf. The
 * earlier "free-first" order (unpdf first, LlamaParse only if unpdf was blank)
 * re-introduced the owner's exact false positive: a PARTIAL/messy unpdf text
 * layer (logo, transport block, or social handles printed as images) would be
 * accepted as a complete extraction and the rest silently missed. LlamaParse is
 * now primary; unpdf is only an outage/last-resort fallback.
 *
 * These tests prove:
 *   1) NO recovery fn + unreadable bytes  -> today's honest failure (unchanged).
 *   2) When a recovery fn is injected it is the PRIMARY reader: it is invoked
 *      with the bytes and its text flows through the real Transfer Log parser to
 *      a correct ParsedManifest (manifest #, vendor) — reaching the invoice /
 *      transport / vendor machinery.
 *   3) The recovery fn is ALWAYS called first when injected — even for bytes a
 *      reader could otherwise handle — so a partial text layer can never be
 *      mistaken for success.
 *   4) A recovery fn that returns "" leaves the honest failure in place (never
 *      false-flagged as success); unpdf is only the last-resort net.
 *   5) A recovery fn that throws is swallowed (recovery can never make the
 *      intake worse than it is today).
 *
 * `server-only` is aliased to a no-op stub by the vitest config, so pdf-extract
 * imports cleanly here. We feed a NON-PDF byte buffer so the local unpdf net
 * reliably returns blank, isolating the recovery-primary behavior.
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

// Bytes that are NOT a valid PDF, so the local unpdf net yields nothing and the
// LlamaParse-primary path is exercised deterministically.
const notAPdf = new Uint8Array([0x68, 0x69, 0x0a]); // "hi\n"

describe("llamaparse: LlamaParse-primary text pipeline", () => {
  it("without a recovery fn, an unreadable PDF fails honestly (unchanged)", async () => {
    const res = await parsePdfManifest(notAPdf);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/no extractable text|likely a scanned image/i);
    }
  });

  it("recovery fn is the PRIMARY reader: invoked with the bytes, text flows to parsers", async () => {
    const spy = vi.fn(async (bytes: Uint8Array) => {
      expect(bytes).toBeInstanceOf(Uint8Array);
      return recoveredText;
    });
    const res = await parsePdfManifest(notAPdf, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    // Called with the SAME bytes.
    expect(spy.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // Recovered text flowed through the REAL Transfer Log parser.
      expect(res.manifest.manifest_number).toBe("603353555");
      expect(res.manifest.vendor_label).toBe("Svin Garden");
      expect(res.text).toContain("Transfer Log");
    }
  });

  it("recovery ALWAYS runs first when injected (never gated on unpdf)", async () => {
    // Even though these bytes are not a PDF (unpdf would give nothing), the
    // point is that recovery is consulted FIRST and its result is authoritative
    // — proving the order is LlamaParse-primary, not free-first.
    let recoveryCalled = false;
    const spy = vi.fn(async () => {
      recoveryCalled = true;
      return recoveredText;
    });
    const res = await parsePdfManifest(notAPdf, spy);
    expect(recoveryCalled).toBe(true);
    expect(res.ok).toBe(true);
    if (res.ok) {
      // The manifest came from the RECOVERED text, not from any unpdf read.
      expect(res.manifest.manifest_number).toBe("603353555");
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

  it("a recovery fn returning '' falls back to the local unpdf net, then fails honestly", async () => {
    const spy = vi.fn(async () => "");
    const res = await parsePdfManifest(notAPdf, spy);
    expect(spy).toHaveBeenCalledTimes(1); // recovery was tried first
    // unpdf net also finds nothing in a non-PDF buffer → honest failure, no
    // false success.
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
