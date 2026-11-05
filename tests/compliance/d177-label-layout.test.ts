/**
 * D177 S3 — Label Studio layout engine.
 *
 * Owner: "I need to be able to switch between 1D and 2D barcodes (qr codes)
 * and the info I want on the label." The layout must (a) only offer codes the
 * register can actually ring up, flagged honestly when it can't, (b) never drop
 * the barcode to make text fit, (c) never print potency/THC (a re-barcode
 * sticker must not stand in for the producer's WAC 314-55-105 label), and
 * (d) emit a self-contained SVG with escaped text.
 */
import { describe, it, expect } from "vitest";
import {
  FIELD_DEFS,
  __runLabelLayoutTests,
  defaultTemplate,
  layoutLabel,
  layoutToSvg,
  lotSubject,
  ncSubject,
  sanitizeTemplate,
  type LotLabelSource,
  type NcLabelSource,
} from "@/lib/printing/label-layout-core";
import { stockById } from "@/lib/printing/label-stock-core";

const ctx = { storeName: "Greenway Marijuana", printedOn: "2026-05-04" };
const lot: LotLabelSource = {
  id: "11111111-1111-4111-8111-111111111111",
  lot_code: "6034772160010001",
  pos_product_key: "K-BLUEDREAM",
  ccrs_inventory_external_id: null,
  product_name: "Blue Dream Premium Indoor 3.5g",
  strain_name: "Blue Dream",
  strain_type: "sativa",
  category: "Flower",
  brand_name: "Phat Panda",
  vendor_name: "Grow Op Farms",
  unit_weight: 3.5,
  unit_weight_uom: "grams",
  received_qty: 24,
  unit: "each",
  received_on: "2026-04-30",
  expires_on: "2027-04-30",
  expires_on_source: "rule",
  status: "active",
};
const nc: NcLabelSource = {
  id: "22222222-2222-4222-8222-222222222222",
  sku: "BONG-0001",
  name: "Glass Beaker <Bong> & 14in",
  brand: null,
  type: "bong",
  size: "14in",
  color: "Clear",
  price_minor_units: 4999,
  barcode: "036000291452",
  location: null,
  status: "active",
};

describe("label-layout-core (D177 S3)", () => {
  it("pure self-tests pass", () => {
    const r = __runLabelLayoutTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(70);
  });

  it("never offers potency or THC as a field", () => {
    for (const f of FIELD_DEFS) expect(f.id).not.toMatch(/thc|cbd|potency/i);
  });

  it("keeps the barcode on every catalogue stock the Rollo can feed, for both kinds", () => {
    const s = lotSubject(lot, ctx);
    const n = ncSubject(nc, ctx);
    for (const id of ["rollo-4x6", "rollo-2x1", "ol-rl2676", "rollo-circle-2"]) {
      const stock = stockById(id)!;
      expect(stock).toBeTruthy();
      for (const subj of [s, n]) {
        for (const symbology of ["code128", "qr"] as const) {
          const t = { ...defaultTemplate(subj, stock), symbology, fields: FIELD_DEFS.filter((f) => f.appliesTo.includes(subj.kind)).map((f) => f.id) };
          const L = layoutLabel({ subject: subj, stock, dpi: 203, template: t });
          if (L.severity === "block") continue; // honest refusal is allowed (e.g. long Code 128 on 2x1)
          expect(L.blocks.some((b) => b.kind === "barcode")).toBe(true);
          for (const b of L.blocks) {
            expect(b.xIn).toBeGreaterThanOrEqual(-1e-9);
            expect(b.yIn).toBeGreaterThanOrEqual(-1e-9);
            expect(b.xIn + b.wIn).toBeLessThanOrEqual(L.widthIn + 1e-6);
            expect(b.yIn + b.hIn).toBeLessThanOrEqual(L.heightIn + 1e-6);
          }
        }
      }
    }
  });

  it("SVG output is sized in inches and escapes text", () => {
    const n = ncSubject(nc, ctx);
    const stock = stockById("ol-rl2676")!;
    const svg = layoutToSvg(layoutLabel({ subject: n, stock, dpi: 203, template: defaultTemplate(n, stock) }));
    expect(svg).toMatch(/^<svg[^>]+width="2\.25in"[^>]+height="1\.25in"/);
    expect(svg).not.toContain("<Bong>");
    expect(svg).toContain("&lt;Bong&gt;");
    expect(svg).not.toMatch(/<script/i);
  });

  it("sanitizeTemplate drops unknown fields and clamps custom text", () => {
    const base = defaultTemplate(lotSubject(lot, ctx), stockById("rollo-4x6")!);
    const t = sanitizeTemplate({ fields: ["thc", "product"], customText: "y".repeat(500) }, base);
    expect(t.fields).toEqual(["product"]);
    expect(t.customText.length).toBeLessThanOrEqual(60);
  });
});
