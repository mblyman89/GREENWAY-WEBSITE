/**
 * src/lib/inventory/pdf-manifest-dispatch-core.ts  (R74 S9)
 *
 * PURE: given the TEXT of a PDF (LlamaParse markdown or the unpdf text layer), pick the one layout
 * parser that recognises it and run it. This is the exact dispatch pdf-extract.parsePdfManifest has
 * always used (moved here verbatim so the Cultivera email reader, R74 S9, runs the SAME parsers
 * without importing unpdf or the network). pdf-extract now calls this; behaviour is unchanged.
 *
 * Supported layouts, most specific first (the order matters; the LCB classifier is broad):
 *   1) old-method "Transfer Log (This document is NOT a manifest)"  (H16b-3)
 *   2) GrowFlow "Manifest"                                           (H16b-1)
 *   3) WA LCB / Cultivera "Internal Shipping Document"                (pdf-manifest-core)
 *   4) OpenTHC / old-method combined invoice-manifest                 (pdf-openthc-manifest-core)
 */
import type { ParsedManifest } from "@/lib/inventory/intake-parser";
import { looksLikeShippingManifest, parseShippingManifestText } from "@/lib/inventory/pdf-manifest-core";
import { looksLikeOpenThcInvoiceManifest, parseOpenThcInvoiceManifest } from "@/lib/inventory/pdf-openthc-manifest-core";
import { looksLikeGrowFlowManifest, parseGrowFlowManifest } from "@/lib/inventory/pdf-growflow-manifest-core";
import { looksLikeTransferLog, parseTransferLog } from "@/lib/inventory/pdf-transferlog-core";

export type PdfLayout = "transfer-log" | "growflow" | "lcb-shipping" | "openthc-invoice";

export type PdfTextManifestResult =
  | { ok: true; manifest: ParsedManifest; layout: PdfLayout }
  | { ok: false; error: string; layout: PdfLayout | null };

export const PDF_NOT_A_MANIFEST =
  "This PDF doesn't look like a WA LCB Internal Shipping Document or an OpenTHC invoice-manifest (no Manifest ID / Inventory Lot Details table found).";
export const PDF_NO_TEXT = "The PDF has no extractable text (likely a scanned image). Please paste the JSON/CSV manifest instead.";

export function parsePdfManifestText(text: string): PdfTextManifestResult {
  if (!text || !text.trim()) return { ok: false, error: PDF_NO_TEXT, layout: null };
  if (looksLikeTransferLog(text)) {
    const manifest = parseTransferLog(text);
    if (manifest && manifest.lines.length > 0) return { ok: true, manifest, layout: "transfer-log" };
    return { ok: false, error: "No line items could be read from the Transfer Log PDF.", layout: "transfer-log" };
  }
  if (looksLikeGrowFlowManifest(text)) {
    const manifest = parseGrowFlowManifest(text);
    if (manifest && manifest.lines.length > 0) return { ok: true, manifest, layout: "growflow" };
    return { ok: false, error: "No line items could be read from the GrowFlow manifest PDF.", layout: "growflow" };
  }
  if (looksLikeShippingManifest(text)) {
    const manifest = parseShippingManifestText(text);
    if (manifest && manifest.lines.length > 0) return { ok: true, manifest, layout: "lcb-shipping" };
    return { ok: false, error: "No line items could be read from the PDF manifest.", layout: "lcb-shipping" };
  }
  if (looksLikeOpenThcInvoiceManifest(text)) {
    const manifest = parseOpenThcInvoiceManifest(text);
    if (manifest && manifest.lines.length > 0) return { ok: true, manifest, layout: "openthc-invoice" };
    return { ok: false, error: "No line items could be read from the invoice-manifest PDF.", layout: "openthc-invoice" };
  }
  return { ok: false, error: PDF_NOT_A_MANIFEST, layout: null };
}
