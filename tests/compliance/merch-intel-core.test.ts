/**
 * tests/compliance/merch-intel-core.test.ts
 *
 * Vitest wrapper around the pure non-cannabis merchandise intelligence core
 * (Task M): dual-identifier barcode strategy, reorder points, ABC by retail
 * value, adjustment validation and shrink telemetry.
 */
import { describe, expect, it } from "vitest";
import {
  __runMerchIntelTests,
  MERCH_ABC_BREAKPOINTS,
  MERCH_ADJUSTMENT_REASONS,
  NEAR_REORDER_FACTOR,
  buildReorderList,
  classifyMerchAbc,
  gs1CheckDigitOk,
  reorderStatusOf,
  scanIdentity,
  summarizeMerchShrink,
  validateMerchAdjustment,
  validateRetailBarcode,
  type MerchItem,
} from "@/lib/noncannabis/merch-intel-core";

const mk = (over: Partial<MerchItem>): MerchItem => ({
  id: over.id ?? "x",
  sku: over.sku ?? "SKU-0001",
  name: over.name ?? "Item",
  type: over.type ?? "pipe",
  status: over.status ?? "active",
  qtyOnHand: over.qtyOnHand ?? 0,
  priceMinorUnits: over.priceMinorUnits ?? 0,
  costMinorUnits: over.costMinorUnits ?? 0,
  barcode: over.barcode ?? null,
  reorderPoint: over.reorderPoint ?? 0,
  reorderQty: over.reorderQty ?? 0,
});

describe("merch-intel-core (non-cannabis inventory intelligence)", () => {
  it("embedded self-test suite passes", () => {
    expect(() => __runMerchIntelTests()).not.toThrow();
  });

  it("locks the professional constants", () => {
    expect(MERCH_ABC_BREAKPOINTS).toEqual({ a: 0.8, b: 0.95 });
    expect(NEAR_REORDER_FACTOR).toBe(1.25);
    expect(MERCH_ADJUSTMENT_REASONS.map((r) => r.value)).toEqual([
      "received",
      "return",
      "count",
      "damaged",
      "theft",
      "promo",
      "sold_correction",
      "other",
    ]);
  });

  it("validates GS1 check digits (UPC-A / EAN-13 / EAN-8)", () => {
    // Canonical GS1 examples.
    expect(validateRetailBarcode("036000291452")).toMatchObject({ ok: true, kind: "upc_a" });
    expect(validateRetailBarcode("4006381333931")).toMatchObject({ ok: true, kind: "ean_13" });
    expect(validateRetailBarcode("96385074")).toMatchObject({ ok: true, kind: "ean_8" });
    // One-digit corruption always fails the mod-10 test.
    expect(validateRetailBarcode("036000291451").ok).toBe(false);
    expect(gs1CheckDigitOk("4006381333932")).toBe(false);
    // Wrong lengths rejected with plain-language errors.
    const short = validateRetailBarcode("12345");
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toContain("12");
  });

  it("dual identifier: manufacturer barcode wins, in-house SKU label otherwise", () => {
    expect(scanIdentity({ barcode: "036000291452", sku: "LTR-0001" })).toEqual({
      mode: "manufacturer_barcode",
      code: "036000291452",
    });
    expect(scanIdentity({ barcode: "  ", sku: "BONG-0002" })).toEqual({
      mode: "inhouse_sku_label",
      code: "BONG-0002",
    });
  });

  it("reorder statuses and the reorder-now list ordering", () => {
    expect(reorderStatusOf({ qtyOnHand: 0, reorderPoint: 10 })).toBe("out");
    expect(reorderStatusOf({ qtyOnHand: 10, reorderPoint: 10 })).toBe("below");
    expect(reorderStatusOf({ qtyOnHand: 12, reorderPoint: 10 })).toBe("near");
    expect(reorderStatusOf({ qtyOnHand: 13, reorderPoint: 10 })).toBe("near"); // ceil(12.5)=13
    expect(reorderStatusOf({ qtyOnHand: 14, reorderPoint: 10 })).toBe("ok");

    const list = buildReorderList([
      mk({ id: "near", name: "Near Thing", qtyOnHand: 11, reorderPoint: 10 }),
      mk({ id: "out", name: "Out Thing", qtyOnHand: 0, reorderPoint: 10, reorderQty: 40 }),
      mk({ id: "below", name: "Below Thing", qtyOnHand: 4, reorderPoint: 10 }),
      mk({ id: "fine", name: "Fine Thing", qtyOnHand: 99, reorderPoint: 10 }),
      mk({ id: "draft", name: "Draft Thing", status: "draft", qtyOnHand: 0, reorderPoint: 10 }),
    ]);
    expect(list.map((l) => l.id)).toEqual(["out", "below", "near"]);
    expect(list[0].suggestedQty).toBe(40); // explicit reorder_qty
    expect(list[1].suggestedQty).toBe(16); // 2*10 - 4 default
  });

  it("ABC by retail value: dominant item is A, zero-value is C", () => {
    const abc = classifyMerchAbc([
      mk({ id: "hero", qtyOnHand: 50, priceMinorUnits: 8000 }),
      mk({ id: "b1", qtyOnHand: 20, priceMinorUnits: 1500 }),
      mk({ id: "c1", qtyOnHand: 3, priceMinorUnits: 200 }),
      mk({ id: "dead", qtyOnHand: 0, priceMinorUnits: 9999 }),
    ]);
    expect(abc.get("hero")).toBe("A");
    expect(abc.get("dead")).toBe("C");
  });

  it("adjustment validation blocks the dangerous cases", () => {
    expect(validateMerchAdjustment({ reason: "count", qtyDelta: 3, currentQty: 0 }).ok).toBe(true);
    expect(validateMerchAdjustment({ reason: "theft", qtyDelta: -1, currentQty: 2 }).ok).toBe(false);
    expect(
      validateMerchAdjustment({ reason: "other", qtyDelta: -1, note: "", currentQty: 2 }).ok,
    ).toBe(false);
    expect(
      validateMerchAdjustment({ reason: "damaged", qtyDelta: -5, currentQty: 4 }).ok,
    ).toBe(false); // below zero
    expect(
      validateMerchAdjustment({ reason: "damaged", qtyDelta: -1.5 as number, currentQty: 4 }).ok,
    ).toBe(false); // non-integer
  });

  it("shrink telemetry counts only negative deltas, valued at cost", () => {
    const s = summarizeMerchShrink(
      [
        { productId: "p1", qtyDelta: -2, reason: "damaged" },
        { productId: "p1", qtyDelta: -1, reason: "promo" },
        { productId: "p2", qtyDelta: 10, reason: "received" },
      ],
      new Map([
        ["p1", 300],
        ["p2", 50],
      ]),
    );
    expect(s.totalUnitsRemoved).toBe(3);
    expect(s.totalValueRemovedMinor).toBe(900);
    expect(s.valueByReasonMinor.get("damaged")).toBe(600);
    expect(s.unitsByReason.has("received")).toBe(false);
  });
});
