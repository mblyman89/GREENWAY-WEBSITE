/**
 * label-barcode-cases.ts — the fixed set of Label Studio barcodes that are
 * proven to decode with an independent decoder (zxing-cpp) at the printer's
 * real resolution. Shared by scripts/compliance/label-barcode-dump.ts and
 * tests/compliance/d177-label-barcode.test.ts so the proof and the test can
 * never drift apart. Covers each symbology at the smallest module size the
 * Label Studio will choose on common stock (D177 S2).
 */
import { renderLabelBarcode, type BarcodeRequest, type BarcodeRender } from "./label-barcode-core";

export type LabelBarcodeCase = BarcodeRequest & { id: string };

export const LABEL_BARCODE_CASES: LabelBarcodeCase[] = [
  // Cannabis lot codes (16-digit lot barcode → Code 128 C) on a 2×1.
  { id: "c128-lot16-2x1", symbology: "code128", value: "6034772160010001", dpi: 203, maxWidthIn: 1.875, maxHeightIn: 0.45 },
  // Alphanumeric lot code on a 4×6 (Code 128 B, 4-dot X).
  { id: "c128-alnum-4x6", symbology: "code128", value: "WA-LOT-2026-0412", dpi: 203, maxWidthIn: 3.875, maxHeightIn: 0.9 },
  // Alphanumeric at the thinnest legal X (2 dots, 9.85 mil) on a 3×1.
  { id: "c128-alnum-3x1", symbology: "code128", value: "WA1.ABCDEFG", dpi: 203, maxWidthIn: 2.875, maxHeightIn: 0.45 },
  // Non-cannabis SKU on a 2.25×1.25.
  { id: "c128-sku-225", symbology: "code128", value: "GLS-BONG-14IN", dpi: 203, maxWidthIn: 2.125, maxHeightIn: 0.5 },
  // Lowercase survives (register lowercases on lookup anyway).
  { id: "c128-lower", symbology: "code128", value: "nc-sku-77", dpi: 203, maxWidthIn: 1.875, maxHeightIn: 0.45 },
  // Retail UPC-A / EAN-13 / EAN-8 re-prints.
  { id: "upca-225", symbology: "upc_ean", value: "036000291452", dpi: 203, maxWidthIn: 2.125, maxHeightIn: 0.6 },
  { id: "upca-75pct", symbology: "upc_ean", value: "036000291452", dpi: 203, maxWidthIn: 1.2, maxHeightIn: 0.5 },
  { id: "ean13-2x1", symbology: "upc_ean", value: "4006381333931", dpi: 203, maxWidthIn: 1.875, maxHeightIn: 0.5 },
  { id: "ean8-2x1", symbology: "upc_ean", value: "96385074", dpi: 203, maxWidthIn: 1.875, maxHeightIn: 0.5 },
  // QR: smallest legal (10 mil = 2 dots) and a comfortable one.
  { id: "qr-lot-small", symbology: "qr", value: "WA-LOT-2026-0412", dpi: 203, maxWidthIn: 0.6, maxHeightIn: 0.6 },
  { id: "qr-lot-2x2", symbology: "qr", value: "6034772160010001", dpi: 203, maxWidthIn: 1.3, maxHeightIn: 1.3 },
  { id: "qr-sku-H", symbology: "qr", value: "GLS-BONG-14IN", dpi: 203, maxWidthIn: 1, maxHeightIn: 1, qrLevel: "H" },
  // A 300-dpi printer profile.
  { id: "c128-300dpi", symbology: "code128", value: "WA-LOT-2026-0412", dpi: 300, maxWidthIn: 2.875, maxHeightIn: 0.45 },
];

export function renderCase(c: LabelBarcodeCase): BarcodeRender {
  const { id: _id, ...req } = c;
  void _id;
  return renderLabelBarcode(req);
}
