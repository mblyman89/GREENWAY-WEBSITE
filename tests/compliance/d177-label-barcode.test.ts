/**
 * D177 S2 — Label Studio barcodes (owner: "switch between 1D and 2D barcodes (qr codes)").
 *
 *  1. The pure self-tests of ean-upc-core and label-barcode-core pass.
 *  2. INDEPENDENT DECODE PROOF: every case in label-barcode-cases.ts was rasterised at the printer's
 *     own dpi (one pixel per thermal dot) and decoded by zxing-cpp
 *     (tests/fixtures/label-studio/roundtrip.json). The fixture's svgSha256 must equal what the live
 *     encoder draws today, so no change to a drawing can slip past the decode proof.
 *  3. Every bar and module is a whole number of printer dots (the rule that makes thermal codes scan).
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { __runEanUpcTests } from "@/lib/printing/ean-upc-core";
import { __runLabelBarcodeTests, renderLabelBarcode } from "@/lib/printing/label-barcode-core";
import { LABEL_BARCODE_CASES, renderCase } from "@/lib/printing/label-barcode-cases";

type RtItem = { id: string; payload: string; symbology: string; dpi: number; svgSha256: string; decoded: string; format: string; ok: boolean };
const rt = JSON.parse(readFileSync("tests/fixtures/label-studio/roundtrip.json", "utf8")) as { items: RtItem[] };

describe("D177 S2 label barcodes", () => {
  it("pure self-tests pass", () => {
    expect(__runEanUpcTests().failed).toBe(0);
    expect(__runLabelBarcodeTests().failed).toBe(0);
  });

  it("the fixture covers every case, and every case decoded to its exact payload", () => {
    expect(rt.items.map((i) => i.id).sort()).toEqual(LABEL_BARCODE_CASES.map((c) => c.id).sort());
    for (const it of rt.items) {
      expect(it.ok, it.id).toBe(true);
      expect(it.decoded, it.id).toBe(it.payload);
    }
    const formats = new Set(rt.items.map((i) => i.format));
    for (const f of ["Code128", "QRCode", "UPCA", "EAN13", "EAN8"]) expect(formats.has(f), f).toBe(true);
  });

  it("the live encoder still draws exactly what was decoded", () => {
    for (const c of LABEL_BARCODE_CASES) {
      const r = renderCase(c);
      expect(r.ok, c.id).toBe(true);
      if (!r.ok) continue;
      const fx = rt.items.find((i) => i.id === c.id)!;
      expect(createHash("sha256").update(r.svg).digest("hex"), `${c.id} drawing changed — re-run label-barcode-roundtrip.py`).toBe(fx.svgSha256);
    }
  });

  it("every bar/module edge lands on a whole printer dot", () => {
    for (const c of LABEL_BARCODE_CASES) {
      const r = renderCase(c);
      if (!r.ok) continue;
      const nums = [...r.svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)].flatMap((m) => [m[1], m[2], m[3]].map(Number));
      expect(nums.length, c.id).toBeGreaterThan(0);
      for (const n of nums) expect(Math.abs(n - Math.round(n)), `${c.id} ${n}`).toBeLessThan(1e-9);
    }
  });

  it("never prints a Code 128 thinner than 7.5 mil or a QR module under 10 mil", () => {
    for (const w of [1, 1.4, 1.875, 2.875, 3.875]) {
      const c = renderLabelBarcode({ symbology: "code128", value: "WA-LOT-2026-0412", dpi: 203, maxWidthIn: w, maxHeightIn: 0.5 });
      if (c.ok) expect(c.xMil).toBeGreaterThanOrEqual(7.5);
      const q = renderLabelBarcode({ symbology: "qr", value: "WA-LOT-2026-0412", dpi: 203, maxWidthIn: w / 3, maxHeightIn: w / 3 });
      if (q.ok) expect(q.xMil).toBeGreaterThanOrEqual(10);
    }
  });
});
