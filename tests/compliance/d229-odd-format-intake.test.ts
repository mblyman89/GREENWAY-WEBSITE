/**
 * tests/compliance/d229-odd-format-intake.test.ts  (D229)
 *
 * The Evergreen Herbal email (Manifest #M07825652483) made no manifest:
 *  - its documents were Google Drive SHARE links (they answer with an HTML
 *    viewer page, not the file),
 *  - its "CCRS Manifest" link was a CSV (only PDFs were accepted from links),
 *  - its transfer JSON sat behind a bare "JSON link:" label with the URL a few
 *    lines below,
 *  - the 60-character label window handed the INVOICE url to the manifest label.
 * These tests use the REAL files saved in docs/intake-evidence/2026-11-10-evergreen/.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runOddFormatTests,
  directDocumentUrl,
  sniffDocument,
  looksLikeCcrsManifestCsv,
  collapseSameDelivery,
  filenameFromContentDisposition,
} from "@/lib/inbound-email/odd-format-core";
import {
  extractAllTransferLinksFromBody,
  extractTransferLinksFromBody,
  jsonLabeledLinks,
} from "@/lib/inbound-email/resend-receiving-core";
import { assessEmailDocs } from "@/lib/inbound-email/email-harvest-core";
import { parseAttachmentStrict } from "@/lib/inbound-email/inbound-store";
import { fetchDocument } from "@/lib/inventory/transfer-fetch";

const DIR = join(process.cwd(), "docs/intake-evidence/2026-11-10-evergreen");
const csvText = readFileSync(join(DIR, "M07825652483-ccrs-manifest.csv"), "utf8");
const jsonText = readFileSync(join(DIR, "M07825652483-wcia.json"), "utf8");
const pdfBytes = new Uint8Array(readFileSync(join(DIR, "M07825652483-invoice.pdf")));
const emailText = readFileSync(join(DIR, "forwarded-email.txt"), "utf8");

const INVOICE = "https://drive.google.com/file/d/1QmgyiQJ8te8i1Rb6xc18It1eUC2k9KkH/view?usp=drivesdk";
const MANIFEST = "https://drive.google.com/file/d/1XxfQGPD3ak_Qxx4_euyu2kifQTJfioZS/view?usp=drivesdk";
const LAB = "https://drive.google.com/file/d/1fux3cOJcz06we8Pm38ljSc6KVm73jGOb/view?usp=drivesdk";
const CONFLABS = "https://evergreen-links.conflabs.com/?id=14aTiN1KbIgxMQkgMBVlQU9Gca_j09ISO";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("D229 odd-format intake", () => {
  it("pure self-tests pass", () => {
    const r = __runOddFormatTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(0);
  });

  it("rewrites the real Drive share links to the direct-download address", () => {
    expect(directDocumentUrl(MANIFEST)).toBe(
      "https://drive.usercontent.google.com/download?id=1XxfQGPD3ak_Qxx4_euyu2kifQTJfioZS&export=download&confirm=t",
    );
    expect(directDocumentUrl(INVOICE)).toContain("id=1QmgyiQJ8te8i1Rb6xc18It1eUC2k9KkH");
    expect(directDocumentUrl(CONFLABS)).toBeNull();
    expect(directDocumentUrl("https://drive.google.com/drive/folders/abc123")).toBeNull();
  });

  it("sniffs the real files by their bytes", () => {
    const enc = new TextEncoder();
    expect(sniffDocument(enc.encode(csvText), "application/octet-stream")).toBe("ccrs-csv");
    expect(sniffDocument(enc.encode(jsonText), "text/plain")).toBe("json");
    expect(sniffDocument(pdfBytes, "application/octet-stream")).toBe("pdf");
    expect(sniffDocument(enc.encode("<!DOCTYPE html><html><body>Drive</body></html>"), "text/html")).toBe("html");
    expect(looksLikeCcrsManifestCsv(csvText)).toBe(true);
  });

  it("finds the transfer behind the bare 'JSON link:' label in the forwarded email", () => {
    expect(jsonLabeledLinks("", emailText)).toContain(CONFLABS);
    expect(extractAllTransferLinksFromBody("", emailText)).toContain(CONFLABS);
    expect(extractTransferLinksFromBody("", emailText).transferJsonUrl).toBe(CONFLABS);
  });

  it("does not hand the invoice link to the manifest label (HTML laid out like the email)", () => {
    const html =
      `<div>Proforma Invoice: <a href="${INVOICE}">${INVOICE}</a></div>` +
      `<div>CCRS Manifest: <a href="${MANIFEST}">${MANIFEST}</a></div>` +
      `<div>Lab Results: <a href="${LAB}">${LAB}</a></div>`;
    const links = extractTransferLinksFromBody(html, emailText);
    expect(links.manifestUrl).not.toBe(INVOICE);
    expect(links.manifestUrl).toBe(MANIFEST);
    expect(links.invoiceUrl).toBe(INVOICE);
  });

  it("the CSV and the JSON of one delivery collapse into ONE manifest of 19 lines with the CSV's transport", () => {
    const csv = parseAttachmentStrict({ filename: "manifest_078256_20261109222938.csv", contentType: "text/csv", text: csvText, base64: null });
    const json = parseAttachmentStrict({ filename: "transfer.json", contentType: "application/json", text: jsonText, base64: null });
    expect(csv.kind).toBe("manifest");
    expect(json.kind).toBe("manifest");
    if (csv.kind !== "manifest" || json.kind !== "manifest") return;
    expect(csv.manifest.lines.length).toBe(19);
    expect(json.manifest.lines.length).toBe(19);
    const out = collapseSameDelivery([csv.manifest, json.manifest]);
    expect(out.manifests.length).toBe(1);
    expect(out.keep).toEqual([1]);
    const m = out.manifests[0];
    expect(m.lines.length).toBe(19);
    expect(m.manifest_number?.toUpperCase()).toContain("M07825652483".slice(1));
    const t = (m.transport ?? {}) as Record<string, unknown>;
    expect(JSON.stringify(t)).toContain("D33571K");
    expect(m.warnings.some((w) => w.includes("same delivery also came as a ccrs-csv"))).toBe(true);
  });

  it("fetchDocument takes a Drive CSV (served with Content-Disposition) as a CSV, under its own name", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (u: string | URL) => {
      calls.push(String(u));
      return new Response(new TextEncoder().encode(csvText), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": 'attachment; filename="manifest_078256_20261109222938.csv"',
        },
      });
    }) as typeof fetch;
    const r = await fetchDocument(MANIFEST);
    expect(calls[0]).toContain("drive.usercontent.google.com/download?id=1XxfQGPD3ak_Qxx4_euyu2kifQTJfioZS");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe("ccrs-csv");
    expect(r.filename).toBe("manifest_078256_20261109222938.csv");
    expect(r.text && looksLikeCcrsManifestCsv(r.text)).toBe(true);
  });

  it("fetchDocument refuses an HTML viewer page with a plain reason", async () => {
    globalThis.fetch = (async () =>
      new Response("<!DOCTYPE html><html><body>Sign in</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    const r = await fetchDocument("https://example.com/some/page");
    expect(r.ok).toBe(false);
  });

  it("filenameFromContentDisposition reads plain and RFC 5987 names", () => {
    expect(filenameFromContentDisposition('attachment; filename="a b.csv"')).toBe("a b.csv");
    expect(filenameFromContentDisposition("attachment; filename*=UTF-8''LabInfo.PDF")).toBe("LabInfo.PDF");
    expect(filenameFromContentDisposition(null)).toBeNull();
  });

  it("the harvest checklist counts the CCRS CSV as the manifest", () => {
    const c = assessEmailDocs(
      [{ filename: "manifest_078256_20261109222938.csv", contentType: "text/csv", text: csvText, base64: null }],
      "body",
    );
    expect(c.manifestPdf).toBe(true);
    expect(c.missing).not.toContain("manifest PDF");
  });
});
