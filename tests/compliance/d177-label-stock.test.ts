/**
 * D177 S1 — Label Studio stock catalogue + printer fit.
 *
 * Owner: "I need to be able to select from the various size labels, not just
 * rollo but any vendors sizes." The catalogue must never offer a size the
 * store's Rollo X1040 cannot feed without saying so (rollo.com/rollo-vs-others:
 * 1.57″–4.1″ wide), and every entry must cite where it was verified.
 */
import { describe, it, expect } from "vitest";
import {
  LABEL_STOCK,
  ROLLO_X1040,
  __runLabelStockTests,
  checkStockFit,
  customStock,
  inToDots,
  stockById,
  stockForPicker,
} from "@/lib/printing/label-stock-core";

describe("label-stock-core (D177 S1)", () => {
  it("pure self-tests pass", () => {
    const r = __runLabelStockTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(150);
  });

  it("every catalogue entry cites an https source", () => {
    for (const s of LABEL_STOCK) expect(s.sourceUrl).toMatch(/^https:\/\//);
  });

  it("the four sizes Rollo support recommends all fit with no warning", () => {
    for (const id of ["rollo-4x6", "rollo-2x1", "rollo-circle-2", "ol-rl938"]) {
      expect(checkStockFit(stockById(id)!, ROLLO_X1040).severity).toBe("ok");
    }
  });

  it("anything narrower than 1.57in is blocked on the Rollo", () => {
    for (const s of LABEL_STOCK) {
      const total = s.acrossIn * (s.across ?? 1);
      const fit = checkStockFit(s, ROLLO_X1040);
      if (total < 1.57) expect(fit.severity).toBe("block");
      if (total > 4.1) expect(fit.severity).toBe("block");
    }
  });

  it("blocked stock is listed after printable stock in the picker", () => {
    const sev = stockForPicker(ROLLO_X1040).map((p) => p.fit.severity);
    const firstBlock = sev.indexOf("block");
    expect(sev.slice(firstBlock).every((s) => s === "block")).toBe(true);
  });

  it("custom sizes are bounded and round-trip by id", () => {
    expect(customStock(0.1, 1).ok).toBe(false);
    const c = customStock(3.5, 1.75);
    expect(c.ok).toBe(true);
    if (c.ok) expect(stockById(c.stock.id)?.acrossIn).toBe(3.5);
  });

  it("a 4x6 is 812 x 1218 dots at 203 dpi", () => {
    expect(inToDots(4, 203)).toBe(812);
    expect(inToDots(6, 203)).toBe(1218);
  });
});
