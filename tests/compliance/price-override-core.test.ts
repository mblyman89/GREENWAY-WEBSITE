/**
 * tests/compliance/price-override-core.test.ts  (POS Slice B24)
 *
 * Pins the register's manager price override: markdown-only, the SAME floors
 * priceCart enforces (statutory RCW 69.50.357 minimum + CCRS acquisition-cost
 * floor), stale-safe application (an override approved against a price the
 * engine no longer charges is dropped and reported, never silently applied),
 * and the payload block that rides the sale line into the sync audit.
 */
import { describe, it, expect } from "vitest";
import {
  overrideFloorMinor,
  validateOverrideRequest,
  applyPriceOverrides,
  __runPriceOverrideCoreTests,
  type PosLineOverride,
} from "@/lib/pos/price-override-core";
import { validateSalePayload, type PosSalePayload } from "@/lib/pos/sale-event-core";
import type { PosMenuProduct, PricedSaleLine } from "@/lib/pos/sale-flow-core";

const U1 = "11111111-1111-4111-8111-111111111111";
const U5 = "55555555-5555-4555-8555-555555555555";

const FLOWER: PosMenuProduct = {
  productId: "prod-flower",
  variantId: "var-flower-35",
  name: "Blue Dream",
  brand: "Greenway Farms",
  category: "flower",
  categories: ["flower"],
  variantLabel: "3.5g",
  regularPriceMinor: 3500,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
};

const LINE: PricedSaleLine = {
  productId: "prod-flower",
  productName: "Blue Dream (3.5g)",
  category: "flower",
  quantity: 2,
  unitPriceMinor: 3500,
  regularPriceMinor: 3500,
  variantId: "var-flower-35",
  brand: "Greenway Farms",
  variantLabel: "3.5g",
};

const OVERRIDE: PosLineOverride = {
  unitPriceMinor: 3000,
  originalUnitPriceMinor: 3500,
  reason: "damaged packaging",
  approvedByEmployeeId: U1,
  approvedByName: "Mgr M.",
};

describe("override floor (mirrors priceCart)", () => {
  it("cannabis with unknown cost floors at the statutory minimum", () => {
    expect(overrideFloorMinor(FLOWER)).toBe(1);
  });
  it("a known acquisition cost lifts the floor above the raw pre-tax cost", () => {
    const conc = { ...FLOWER, category: "concentrates", categories: ["concentrates"], costMinorUnits: 800, regularPriceMinor: 3000 };
    const floor = overrideFloorMinor(conc);
    expect(floor).toBeGreaterThan(800);
    expect(floor).toBeLessThan(3000);
  });
  it("merch has no statutory floor", () => {
    expect(overrideFloorMinor({ ...FLOWER, category: "merch", categories: ["merch"], costMinorUnits: null })).toBe(0);
  });
});

describe("override request validation (before the PIN is spent)", () => {
  const base = { engineUnitMinor: 3500, floorMinor: 1, reason: "damaged packaging" };
  it("accepts a valid markdown", () => {
    expect(validateOverrideRequest({ ...base, newUnitMinor: 3000 }).ok).toBe(true);
  });
  it("refuses raises and equal prices — markdown only", () => {
    expect(validateOverrideRequest({ ...base, newUnitMinor: 3500 }).ok).toBe(false);
    expect(validateOverrideRequest({ ...base, newUnitMinor: 3600 }).ok).toBe(false);
  });
  it("refuses prices below the floor, citing the statute", () => {
    const r = validateOverrideRequest({ engineUnitMinor: 3000, floorMinor: 1100, newUnitMinor: 500, reason: "friend discount" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("69.50.357");
  });
  it("enforces the reason discipline (3–500 chars)", () => {
    expect(validateOverrideRequest({ ...base, newUnitMinor: 3000, reason: "x" }).ok).toBe(false);
    expect(validateOverrideRequest({ ...base, newUnitMinor: 3000, reason: "y".repeat(501) }).ok).toBe(false);
  });
});

describe("override application (stale-safe)", () => {
  it("applies a coherent override, recomputes totals, stamps the payload block", () => {
    const r = applyPriceOverrides([LINE], { "var-flower-35": OVERRIDE });
    expect(r.lines[0].unitPriceMinor).toBe(3000);
    expect(r.lines[0].override).toEqual({
      originalUnitPriceMinor: 3500,
      reason: "damaged packaging",
      approvedByEmployeeId: U1,
    });
    expect(r.totals.totalMinorUnits).toBe(6000);
    expect(r.staleVariantIds).toEqual([]);
  });
  it("drops a stale override when the engine repriced the line", () => {
    const r = applyPriceOverrides([{ ...LINE, unitPriceMinor: 2800 }], { "var-flower-35": OVERRIDE });
    expect(r.lines[0].unitPriceMinor).toBe(2800);
    expect(r.lines[0].override).toBeUndefined();
    expect(r.staleVariantIds).toEqual(["var-flower-35"]);
  });
  it("leaves lines without overrides untouched", () => {
    const r = applyPriceOverrides([LINE], {});
    expect(r.lines[0].unitPriceMinor).toBe(3500);
    expect(r.staleVariantIds).toEqual([]);
  });
});

describe("sale payload override block (validateSalePayload)", () => {
  const good: PosSalePayload = {
    lines: [
      {
        productId: "prod-1",
        productName: "Blue Dream 3.5g",
        category: "flower",
        quantity: 2,
        unitPriceMinor: 1463,
        regularPriceMinor: 1663,
        override: { originalUnitPriceMinor: 1663, reason: "damaged packaging", approvedByEmployeeId: U1 },
      },
    ],
    totalMinor: 2926,
    subtotalMinor: 2000,
    taxMinor: 926,
    paymentMethod: "cash",
    tenderedMinor: 3000,
    changeMinor: 74,
    drawerSessionId: U5,
    idVerification: { method: "scan" },
  };
  it("accepts a complete override block", () => {
    expect(validateSalePayload(good).ok).toBe(true);
  });
  it("refuses an override that does not lower the price", () => {
    const bad = { ...good, lines: [{ ...good.lines[0], override: { ...good.lines[0].override!, originalUnitPriceMinor: 1463 } }] };
    expect(validateSalePayload(bad).ok).toBe(false);
  });
  it("requires the reason and the approver employee id", () => {
    expect(
      validateSalePayload({ ...good, lines: [{ ...good.lines[0], override: { ...good.lines[0].override!, reason: "x" } }] }).ok,
    ).toBe(false);
    expect(
      validateSalePayload({ ...good, lines: [{ ...good.lines[0], override: { ...good.lines[0].override!, approvedByEmployeeId: "mgr-1" } }] }).ok,
    ).toBe(false);
  });
  it("stays optional — a sale without overrides is untouched", () => {
    const plain = { ...good, lines: [{ ...good.lines[0], override: undefined }] };
    expect(validateSalePayload(plain).ok).toBe(true);
  });
});

describe("embedded self-tests", () => {
  it("__runPriceOverrideCoreTests passes", () => {
    expect(() => __runPriceOverrideCoreTests()).not.toThrow();
  });
});
