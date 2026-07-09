/**
 * src/lib/inventory/pdf-extract.ts  (H14a)
 *
 * Server-only I/O companion to pdf-manifest-core. Extracts plain text from PDF
 * bytes using `unpdf` (pure-JS pdf.js, serverless-safe — no poppler/native deps,
 * so it runs identically on Vercel), then hands the text to the PURE parser.
 *
 * DRAFTS-ONLY (standing rule): this only produces a ParsedManifest for human
 * review; it never activates stock or files anything.
 */
import "server-only";
import { extractText, getDocumentProxy } from "unpdf";
import type { ParsedManifest } from "@/lib/inventory/intake-parser";
import {
  parseShippingManifestText,
  looksLikeShippingManifest,
} from "@/lib/inventory/pdf-manifest-core";
import {
  parseOpenThcInvoiceManifest,
  looksLikeOpenThcInvoiceManifest,
} from "@/lib/inventory/pdf-openthc-manifest-core";

/** Extract the merged plain text from a PDF given its raw bytes. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  // mergePages:true → `text` is a single string. Guard anyway for safety.
  const { text } = await extractText(pdf, { mergePages: true });
  const t: unknown = text;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) return (t as unknown[]).join("\n");
  return "";
}

export type PdfManifestResult =
  | { ok: true; manifest: ParsedManifest; text: string }
  | { ok: false; error: string; text: string | null };

/**
 * Extract text from a PDF and parse it as a WA LCB Internal Shipping Document.
 * Returns a structured result so callers can surface a precise reason on failure
 * (not a manifest / no line items / unreadable PDF).
 */
export async function parsePdfManifest(bytes: Uint8Array): Promise<PdfManifestResult> {
  let text: string;
  try {
    text = await extractPdfText(bytes);
  } catch {
    return {
      ok: false,
      error:
        "Could not read the PDF. If it is a scanned image (a photo of a paper manifest) rather than a text PDF, it can't be parsed automatically.",
      text: null,
    };
  }

  if (!text.trim()) {
    return {
      ok: false,
      error:
        "The PDF has no extractable text (likely a scanned image). Please paste the JSON/CSV manifest instead.",
      text: "",
    };
  }

  // Two supported PDF layouts (tried in order):
  //   1) WA LCB "Internal Shipping Document" (pdf-manifest-core)
  //   2) OpenTHC / "old method" combined invoice-manifest (pdf-openthc-manifest-core)
  //      — the format where the invoice IS the manifest (e.g. High End Farms).
  if (looksLikeShippingManifest(text)) {
    const manifest = parseShippingManifestText(text);
    if (manifest && manifest.lines.length > 0) {
      return { ok: true, manifest, text };
    }
    return { ok: false, error: "No line items could be read from the PDF manifest.", text };
  }

  if (looksLikeOpenThcInvoiceManifest(text)) {
    const manifest = parseOpenThcInvoiceManifest(text);
    if (manifest && manifest.lines.length > 0) {
      return { ok: true, manifest, text };
    }
    return {
      ok: false,
      error: "No line items could be read from the invoice-manifest PDF.",
      text,
    };
  }

  return {
    ok: false,
    error:
      "This PDF doesn't look like a WA LCB Internal Shipping Document or an OpenTHC invoice-manifest (no Manifest ID / Inventory Lot Details table found).",
    text,
  };
}

/** Convenience: parse from a base64 string (as inbound-email attachments store). */
export async function parsePdfManifestFromBase64(base64: string): Promise<PdfManifestResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    return { ok: false, error: "Attachment was not valid base64.", text: null };
  }
  return parsePdfManifest(bytes);
}
