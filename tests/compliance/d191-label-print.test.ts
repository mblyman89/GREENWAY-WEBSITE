/**
 * D191 — Label printing fix + calibration.
 *
 * Owner: "I tested the 2x1" labels, it prints two labels, the first blank, the
 * second nearly prints off the bottom of the label. … I need to have better
 * use of the available space."
 *
 * Root cause: Chrome rotates pages that are wider than tall when printing
 * to thermal printers (Chromium issue 372435414), so a 2×1 page reached the
 * Rollo turned 90° and spread across two labels. Fix: send a tall page with
 * the artwork already turned; let each device calibrate per size.
 */
import { describe, it, expect } from "vitest";
import {
  CALIBRATION_STORAGE_KEY,
  DEFAULT_CALIBRATION,
  SYMPTOM_FIXES,
  __runLabelPrintTests,
  calibrationFor,
  detectOs,
  dialogSteps,
  mapPoint,
  pageGeometry,
  printCss,
  sanitizeCalibration,
  testLabelSvg,
  windowsRolloDriverSteps,
  withCalibration,
} from "@/lib/printing/label-print-core";
import { __runLabelLayoutTests, defaultTemplate, layoutLabel, lotSubject, sanitizeTemplate, type LotLabelSource } from "@/lib/printing/label-layout-core";
import { ROLLO_X1040, stockById } from "@/lib/printing/label-stock-core";

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

describe("label-print-core (D191)", () => {
  it("pure self-tests pass", () => {
    const r = __runLabelPrintTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });

  it("D196: a 2×1 Rollo label goes out straight, page = label size (owner photo: the turned page ran across two labels)", () => {
    const s = stockById("rollo-2x1")!;
    const g = pageGeometry(s, DEFAULT_CALIBRATION);
    expect(g.orientation).toBe("straight");
    expect([g.pageWIn, g.pageHIn]).toEqual([2, 1]);
    expect(g.transform).toBe("none");
    const css = printCss(s);
    expect(css).toContain("@page { size: 2in 1in; margin: 0 !important; }");
    expect(css).not.toContain("rotate(90deg)");
    expect(css).toContain(".gw-label-page:last-child{break-after:auto");
    for (const [x, y] of [[0, 0], [2, 0], [0, 1], [2, 1]]) {
      const p = mapPoint(g, DEFAULT_CALIBRATION, x, y);
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(2 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("Turned is still available as a manual choice", () => {
    const s = stockById("rollo-2x1")!;
    const c = { ...DEFAULT_CALIBRATION, orientation: "rotate_cw" as const };
    const g = pageGeometry(s, c);
    expect([g.pageWIn, g.pageHIn]).toEqual([1, 2]);
    expect(printCss(s, c)).toContain("@page { size: 1in 2in; margin: 0 !important; }");
    expect(printCss(s, c)).toContain("rotate(90deg)");
  });

  it("tall labels (4×6) are left straight", () => {
    const g = pageGeometry(stockById("rollo-4x6")!, DEFAULT_CALIBRATION);
    expect(g.orientation).toBe("straight");
    expect(g.transform).toBe("none");
  });

  it("calibration is clamped and remembered per label size", () => {
    const c = sanitizeCalibration({ orientation: "bogus", offsetXIn: 9, offsetYIn: -9, scalePct: 300 });
    expect(c.orientation).toBe("auto");
    expect(c.offsetXIn).toBe(0.25);
    expect(c.offsetYIn).toBe(-0.25);
    expect(c.scalePct).toBe(105);
    const m = withCalibration({}, "rollo-2x1", { ...DEFAULT_CALIBRATION, offsetYIn: -0.03 });
    expect(calibrationFor(m, "rollo-2x1").offsetYIn).toBe(-0.03);
    expect(calibrationFor(m, "rollo-4x6")).toEqual(DEFAULT_CALIBRATION);
    expect(CALIBRATION_STORAGE_KEY).toMatch(/^gw\.labelStudio\./);
  });

  it("test label and OS help", () => {
    const s = stockById("rollo-2x1")!;
    const svg = testLabelSvg(s, DEFAULT_CALIBRATION, ROLLO_X1040);
    expect(svg).toContain('width="2in" height="1in"');
    expect(svg).toContain("TOP");
    expect(detectOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    const steps = dialogSteps("mac", s, ROLLO_X1040, pageGeometry(s, DEFAULT_CALIBRATION)).join(" ");
    expect(steps).toMatch(/Manage Custom Sizes/);
    expect(steps).toMatch(/exact size/);
    expect(SYMPTOM_FIXES[0].symptom).toMatch(/across two labels/);
    expect(SYMPTOM_FIXES[0].fix).toMatch(/upright/);
    expect(SYMPTOM_FIXES.some((f) => /first blank/.test(f.symptom))).toBe(true);
    expect(windowsRolloDriverSteps(s).join(" ")).toMatch(/51 mm/);
  });
});

describe("label-layout-core fill (D191)", () => {
  it("pure self-tests still pass", () => {
    const r = __runLabelLayoutTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(88);
  });

  it("new designs default to Fill; old Regular designs upgrade once", () => {
    const s = lotSubject(lot, ctx);
    const st = stockById("rollo-2x1")!;
    expect(defaultTemplate(s, st).density).toBe("fill");
    expect(defaultTemplate(s, st).edge).toBe("standard");
    expect(sanitizeTemplate({ density: "regular" }, defaultTemplate(s, st)).density).toBe("fill");
    expect(sanitizeTemplate({ density: "regular", edge: "tight" }, defaultTemplate(s, st)).density).toBe("regular");
  });

  it("Fill makes the 2×1 title bigger than Regular and keeps the barcode", () => {
    const s = lotSubject(lot, ctx);
    const st = stockById("rollo-2x1")!;
    const base = defaultTemplate(s, st);
    const pt = (density: "fill" | "regular") => {
      const L = layoutLabel({ subject: s, stock: st, dpi: 203, template: { ...base, density } });
      expect(L.blocks.some((b) => b.kind === "barcode")).toBe(true);
      return Math.max(...L.blocks.map((b) => (b.kind === "text" ? b.fontPt : 0)));
    };
    expect(pt("fill")).toBeGreaterThan(pt("regular"));
  });

  it("D196: the whole product name fits next to a QR on a 2×1 (no …)", () => {
    const s = lotSubject({ ...lot, product_name: "Cantina - Sorbet - Watermelon - 100mg" }, ctx);
    const st = stockById("rollo-2x1")!;
    const L = layoutLabel({ subject: s, stock: st, dpi: 203, template: { ...defaultTemplate(s, st), symbology: "qr" } });
    const pb = L.blocks.find((b) => b.kind === "text" && b.field === "product");
    expect(pb && pb.kind === "text" ? pb.lines.join(" ") : "").toBe("Cantina - Sorbet - Watermelon - 100mg");
    expect(L.messages.some((m) => m.code === "cut_product")).toBe(false);
  });
});
