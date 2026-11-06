/**
 * D177 S4 — Label Studio pages + session logic.
 *
 * Owner: "This should be connected to receiving as it already is, and should
 * be available in the product detail pages for both cannabis and non cannabis
 * inventory." The two existing label routes must keep working (now the
 * studio), the manifest gets a batch route, and the print path is the same
 * SVG the preview shows.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_LABELS_PER_JOB,
  __runLabelStudioTests,
  planPrintJob,
  printCss,
  sanitizePrefs,
} from "@/lib/printing/label-studio-core";
import { lotSubject, ncSubject } from "@/lib/printing/label-layout-core";
import { ROLLO_X1040, stockById } from "@/lib/printing/label-stock-core";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
const ctx = { storeName: "Greenway", printedOn: "2026-05-04" };

describe("label-studio-core (D177 S4)", () => {
  it("pure self-tests pass", () => {
    const r = __runLabelStudioTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(44);
  });

  it("a whole manifest prints as one job, one page per label, at the stock size", () => {
    const lots = Array.from({ length: 12 }, (_, i) =>
      lotSubject(
        {
          id: `lot-${i}`, lot_code: `60347721600100${String(i).padStart(2, "0")}`, pos_product_key: "K", product_name: `Product ${i}`,
          strain_name: null, strain_type: null, category: null, unit_weight: 1, unit_weight_uom: "grams", received_qty: 10, unit: "each",
          received_on: "2026-04-30", expires_on: null, status: "active",
        },
        ctx,
      ),
    );
    const stock = stockById("rollo-2x1")!;
    const prefs = sanitizePrefs(null, lots[0]);
    const plan = planPrintJob(lots.map((s) => ({ subject: s, copies: 2 })), stock, ROLLO_X1040, { ...prefs.template, fields: ["product"] });
    expect(plan.totalLabels).toBe(24);
    expect(plan.items.every((p) => p.svg.includes('width="2in" height="1in"'))).toBe(true);
    // D191: a 2×1 goes out as a tall 1×2 page with the artwork turned (Chromium 372435414).
    expect(printCss(stock)).toContain("@page { size: 1in 2in; margin: 0 !important; }");
    expect(MAX_LABELS_PER_JOB).toBeLessThanOrEqual(1000);
  });

  it("non-cannabis items default to the 2.25×1.25 they always printed", () => {
    const s = ncSubject({ id: "n", sku: "SKU-1", name: "Lighter", brand: null, type: "lighter", size: null, color: null, price_minor_units: 299, barcode: null, location: null, status: "active" }, ctx);
    expect(sanitizePrefs(null, s).stockId).toBe("ol-rl2676");
  });
});

describe("Label Studio routes (D177 S4)", () => {
  it("lot label route is the studio and keeps its back links", () => {
    const src = read("src/app/admin/inventory/lots/[id]/label/page.tsx");
    expect(src).toContain("<LabelStudio");
    expect(src).toContain('requirePermission("inventory.manage")');
    expect(src).toContain("/admin/inventory/intake/${lot.manifest_id}");
    expect(src).not.toContain("code128Svg"); // old fixed renderer is gone
  });

  it("non-cannabis label route is the studio and keeps the back param", () => {
    const src = read("src/app/admin/inventory/noncannabis/[id]/label/page.tsx");
    expect(src).toContain("<LabelStudio");
    expect(src).toContain("back={back}");
    expect(src).toContain('requirePermission("inventory.manage")');
  });

  it("manifest batch route exists, is gated, and explains a failed read", () => {
    const src = read("src/app/admin/inventory/intake/[id]/labels/page.tsx");
    expect(src).toContain('requirePermission("inventory.manage")');
    expect(src).toContain("labelLoadErrorText(");
    expect(src).toContain("rejected_at_dock");
  });

  it("studio prints the same SVG it previews and warns about the producer label", () => {
    const src = read("src/components/admin/labels/LabelStudio.tsx");
    expect(src).toContain("planPrintJob(");
    expect(src).toContain("layoutToSvg(");
    expect(src).toContain("WAC 314-55-105");
    expect(src).toContain("createPortal(");
  });
});
