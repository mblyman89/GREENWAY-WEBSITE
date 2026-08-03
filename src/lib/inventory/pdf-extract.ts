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
import {
  parseGrowFlowManifest,
  looksLikeGrowFlowManifest,
} from "@/lib/inventory/pdf-growflow-manifest-core";
import {
  parseTransferLog,
  looksLikeTransferLog,
} from "@/lib/inventory/pdf-transferlog-core";
import { parseCoaSummary, looksLikeCoaSummary } from "@/lib/inventory/pdf-coa-core";

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

/**
 * LlamaParse PR-2 — OPTIONAL vision-OCR text recovery, supplied by the caller.
 *
 * unpdf (above) is TEXT-ONLY: a scanned-image PDF (a photo of a paper manifest)
 * has no text layer, so unpdf returns "" and every downstream layout parser,
 * the live Invoice # scanner and the transport/vendor readers are starved. The
 * owner's real, recurring failure.
 *
 * Rather than hard-wire the LlamaParse provider here (which would create an
 * import cycle — the provider imports THIS file for its own outage fallback),
 * we accept a recovery function by DEPENDENCY INJECTION. The caller that lives
 * next to the provider (inbound-store) passes it in. When unpdf yields no text
 * AND a recovery function is provided, we ask it to read the SAME bytes; if it
 * returns text, parsing continues through the exact same layout parsers below.
 *
 * Returns "" on any failure so recovery can NEVER make things worse than today.
 */
export type PdfTextRecovery = (bytes: Uint8Array) => Promise<string>;

/**
 * Get PDF text: try unpdf first (fast + free), and only when it comes back
 * blank fall back to the injected recovery function (LlamaParse in production).
 * This is "free-first, vision only when needed" — a PDF that already has a text
 * layer never spends a LlamaParse credit. Never throws.
 */
async function extractPdfTextWithRecovery(
  bytes: Uint8Array,
  recoverText?: PdfTextRecovery,
): Promise<string> {
  let text = "";
  try {
    text = await extractPdfText(bytes);
  } catch {
    text = "";
  }
  if (text.trim()) return text;
  if (!recoverText) return text; // no recovery available → today's behavior
  try {
    const recovered = await recoverText(bytes);
    return typeof recovered === "string" ? recovered : "";
  } catch {
    return "";
  }
}

export type PdfManifestResult =
  | { ok: true; manifest: ParsedManifest; text: string }
  | { ok: false; error: string; text: string | null };

/**
 * Extract text from a PDF and parse it as a WA LCB Internal Shipping Document.
 * Returns a structured result so callers can surface a precise reason on failure
 * (not a manifest / no line items / unreadable PDF).
 */
export async function parsePdfManifest(
  bytes: Uint8Array,
  recoverText?: PdfTextRecovery,
): Promise<PdfManifestResult> {
  // unpdf first (free); LlamaParse recovery only when unpdf yields nothing.
  const text = await extractPdfTextWithRecovery(bytes, recoverText);

  if (!text.trim()) {
    return {
      ok: false,
      error:
        "The PDF has no extractable text (likely a scanned image). Please paste the JSON/CSV manifest instead.",
      text: "",
    };
  }

  // Supported PDF layouts (tried most-specific first):
  //   1) old-method "Transfer Log (This document is NOT a manifest)"      (H16b-3)
  //   2) GrowFlow "Manifest" document                                     (H16b-1)
  //   3) WA LCB / Cultivera "Internal Shipping Document" (pdf-manifest-core)
  //   4) OpenTHC / "old method" combined invoice-manifest — invoice IS the manifest
  //
  // The Transfer Log and GrowFlow layouts are checked before the LCB check
  // because they carry their own unmistakable headers; the LCB classifier is
  // broad enough that ordering matters.
  if (looksLikeTransferLog(text)) {
    const manifest = parseTransferLog(text);
    if (manifest && manifest.lines.length > 0) {
      return { ok: true, manifest, text };
    }
    return { ok: false, error: "No line items could be read from the Transfer Log PDF.", text };
  }

  if (looksLikeGrowFlowManifest(text)) {
    const manifest = parseGrowFlowManifest(text);
    if (manifest && manifest.lines.length > 0) {
      return { ok: true, manifest, text };
    }
    return { ok: false, error: "No line items could be read from the GrowFlow manifest PDF.", text };
  }

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
export async function parsePdfManifestFromBase64(
  base64: string,
  recoverText?: PdfTextRecovery,
): Promise<PdfManifestResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    return { ok: false, error: "Attachment was not valid base64.", text: null };
  }
  return parsePdfManifest(bytes, recoverText);
}

/** COA parse result (H16b-4/-5). ParsedCoaSummary carries byLot/expiresByLot. */
export type PdfCoaResult =
  | { ok: true; coa: NonNullable<ReturnType<typeof parseCoaSummary>>; text: string }
  | { ok: false; error: string; text: string | null };

/**
 * Extract text from a COA PDF and parse it as a COA Summary (H16b-4). Returns
 * the Lot -> ParsedLab enrichment map so the wiring can merge potency/PASS/
 * expiry onto the manifest's lines by Lot ID. Never throws.
 */
export async function parseCoaFromBase64(
  base64: string,
  recoverText?: PdfTextRecovery,
): Promise<PdfCoaResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(base64, "base64"));
  } catch {
    return { ok: false, error: "Attachment was not valid base64.", text: null };
  }
  // unpdf first (free); LlamaParse recovery only when a scanned COA has no text.
  const text = await extractPdfTextWithRecovery(bytes, recoverText);
  if (!text.trim()) {
    return { ok: false, error: "The COA PDF has no extractable text.", text: "" };
  }
  if (!looksLikeCoaSummary(text)) {
    return { ok: false, error: "This PDF doesn't look like a COA Summary.", text };
  }
  const coa = parseCoaSummary(text);
  if (!coa || Object.keys(coa.byLot).length === 0) {
    return { ok: false, error: "No COA lots could be read from the PDF.", text };
  }
  return { ok: true, coa, text };
}
