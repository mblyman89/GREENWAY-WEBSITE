/**
 * tests/compliance/pdf-link-fetch.test.ts  (H16b-6)
 *
 * Locks in the LINK-ONLY PDF fallback fetcher. When the WCIA transfer JSON is
 * dead/absent AND the email carried no MIME PDF (Gmail forwarding stripped the
 * files but left the "download the invoice/manifest" links), the inbound path
 * fetches those PDF links server-side and treats the bytes as an attachment.
 *
 * fetchPdfBytes lives in a `server-only`-marked module; the vitest config aliases
 * "server-only" to a no-op stub, so we can unit-test it here by mocking global
 * fetch. The key guarantees: it VALIDATES the "%PDF" magic bytes (a dead link
 * often returns an HTML error page), honors HTTP errors, and returns base64 the
 * inbound path can hand straight to parsePdfManifestFromBase64 / parseCoaFromBase64.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchPdfBytes } from "@/lib/inventory/transfer-fetch";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function mockFetchOnce(opts: {
  ok?: boolean;
  status?: number;
  bytes?: Uint8Array;
  contentType?: string;
}) {
  const bytes = opts.bytes ?? new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
  globalThis.fetch = vi.fn(async () => {
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      headers: {
        get: (k: string) =>
          k.toLowerCase() === "content-type"
            ? (opts.contentType ?? "application/pdf")
            : k.toLowerCase() === "content-length"
              ? String(bytes.byteLength)
              : null,
      },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      text: async () => "",
    } as unknown as Response;
  }) as typeof fetch;
}

describe("fetchPdfBytes (H16b-6 link-only PDF fallback)", () => {
  it("rejects a non-URL", async () => {
    const r = await fetchPdfBytes("not a url");
    expect(r.ok).toBe(false);
  });

  it("returns base64 for a real PDF response with valid magic bytes", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // "%PDF-1.7"
    mockFetchOnce({ bytes: pdf, contentType: "application/pdf" });
    const r = await fetchPdfBytes("https://vendor.example.com/manifest.pdf");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.contentType).toBe("application/pdf");
      expect(r.bytes).toBe(8);
      // base64 round-trips back to the original "%PDF-1.7" bytes.
      expect(Buffer.from(r.base64, "base64").toString("latin1")).toBe("%PDF-1.7");
    }
  });

  it("rejects a dead link that returns an HTML error page (no %PDF magic bytes)", async () => {
    const html = new TextEncoder().encode("<html><body>404 Not Found</body></html>");
    mockFetchOnce({ bytes: html, contentType: "text/html" });
    const r = await fetchPdfBytes("https://vendor.example.com/dead.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/didn't return a PDF/i);
  });

  it("surfaces an HTTP error status", async () => {
    mockFetchOnce({ ok: false, status: 500 });
    const r = await fetchPdfBytes("https://vendor.example.com/err.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/HTTP 500/);
  });

  it("only accepts http(s) protocols", async () => {
    const r = await fetchPdfBytes("ftp://vendor.example.com/manifest.pdf");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/http\(s\)/i);
  });

  it("defaults content type to application/pdf when the header is absent", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => pdf.buffer.slice(0),
        text: async () => "",
      } as unknown as Response;
    }) as typeof fetch;
    const r = await fetchPdfBytes("https://vendor.example.com/x.pdf");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contentType).toBe("application/pdf");
  });
});
