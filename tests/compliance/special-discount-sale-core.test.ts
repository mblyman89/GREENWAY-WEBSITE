/**
 * tests/compliance/special-discount-sale-core.test.ts
 *
 * SLICE 28 — vitest mirror for the register-side special discount math.
 * The exhaustive cases live in the module's embedded self-tests (run by
 * the compliance pure runner); this mirror keeps the module under vitest
 * too and pins the owner-facing contract: percent-off honors the legal
 * floors, and the employee-purchase safety rules hold at the register.
 */
import { describe, expect, it } from "vitest";
import {
  __runSpecialDiscountSaleTests,
  applySpecialDiscountToLines,
  availableSpecialDiscounts,
  checkSpecialDiscountAtRegister,
} from "@/lib/pos/special-discount-sale-core";

const line = (over: Record<string, unknown> = {}) => ({
  variantId: "v1",
  productId: "p1",
  category: "flower",
  quantity: 1,
  unitPriceMinor: 1000,
  regularPriceMinor: 1000,
  costMinorUnits: null,
  ...over,
});

describe("special-discount-sale-core", () => {
  it("runs the embedded self-test battery", () => {
    expect(() => __runSpecialDiscountSaleTests()).not.toThrow();
  });

  it("takes the program percent off each line in whole cents", () => {
    const r = applySpecialDiscountToLines([line()], 3500);
    expect(r.ok && r.lines[0].unitPriceMinor).toBe(650);
    expect(r.ok && r.appliedMinor).toBe(350);
  });

  it("never sells below the acquisition-cost or statutory floors", () => {
    const cost = applySpecialDiscountToLines([line({ costMinorUnits: 650 })], 3500);
    expect(cost.ok && cost.lines[0].unitPriceMinor).toBe(951);
    const floored = applySpecialDiscountToLines(
      [line({ unitPriceMinor: 1, regularPriceMinor: 1 })],
      9900,
    );
    expect(floored.ok).toBe(false);
  });

  it("only offers programs that are enabled with a real rate", () => {
    const avail = availableSpecialDiscounts([
      { kind: "employee", percentBps: 3500, enabled: true },
      { kind: "industry", percentBps: 0, enabled: true },
      { kind: "veteran", percentBps: 1500, enabled: false },
    ]);
    expect(avail.map((s) => s.kind)).toEqual(["employee"]);
  });

  it("blocks an employee buying on the register they are logged into", () => {
    expect(
      checkSpecialDiscountAtRegister({
        kind: "employee",
        cashierEmployeeId: "emp-1",
        registerId: "reg-1",
        beneficiaryEmployeeId: "emp-1",
        approvedByEmployeeId: "emp-2",
      }),
    ).toMatch(/another register/);
  });

  it("requires a second, different employee's approval", () => {
    expect(
      checkSpecialDiscountAtRegister({
        kind: "employee",
        cashierEmployeeId: "emp-1",
        registerId: "reg-1",
        beneficiaryEmployeeId: "emp-2",
        approvedByEmployeeId: "emp-2",
      }),
    ).toMatch(/OTHER than the buyer/);
    expect(
      checkSpecialDiscountAtRegister({
        kind: "employee",
        cashierEmployeeId: "emp-1",
        registerId: "reg-1",
        beneficiaryEmployeeId: "emp-2",
        approvedByEmployeeId: "emp-3",
      }),
    ).toBeNull();
  });
});
