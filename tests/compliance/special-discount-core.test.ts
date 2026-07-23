/**
 * tests/compliance/special-discount-core.test.ts
 *
 * SLICE 27 — vitest mirror for the pure special-discount rules engine.
 * The exhaustive cases live in the module's embedded self-tests (run by
 * the compliance pure runner); this mirror keeps the module under vitest
 * too and pins the owner-facing contract: the three programs, their
 * seeded defaults, and the employee-purchase safety rules.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPECIAL_DISCOUNTS,
  SPECIAL_DISCOUNT_KINDS,
  __runSpecialDiscountTests,
  applySpecialDiscount,
  parsePercentToBps,
  validateSpecialDiscountUse,
} from "@/lib/discounts/special-discount-core";

describe("special-discount-core", () => {
  it("runs the embedded self-test battery", () => {
    expect(() => __runSpecialDiscountTests()).not.toThrow();
  });

  it("keeps the three programs stable (DB contract — never rename)", () => {
    expect([...SPECIAL_DISCOUNT_KINDS]).toEqual(["employee", "industry", "veteran"]);
  });

  it("seeds the owner's defaults: employee 35% on, veteran 15% on, industry off", () => {
    expect(DEFAULT_SPECIAL_DISCOUNTS).toEqual([
      { kind: "employee", percentBps: 3500, enabled: true },
      { kind: "industry", percentBps: 0, enabled: false },
      { kind: "veteran", percentBps: 1500, enabled: true },
    ]);
  });

  it("requires a DIFFERENT employee's approval for staff purchases", () => {
    const base = {
      kind: "employee" as const,
      cashierEmployeeId: "cash-1",
      registerId: "reg-1",
      beneficiaryEmployeeId: "emp-1",
    };
    expect(validateSpecialDiscountUse({ ...base, approvedByEmployeeId: "emp-1" })).toMatch(
      /OTHER than the buyer/,
    );
    expect(validateSpecialDiscountUse({ ...base, approvedByEmployeeId: "emp-2" })).toBeNull();
  });

  it("blocks staff purchases on the register the buyer is logged into", () => {
    expect(
      validateSpecialDiscountUse({
        kind: "employee",
        cashierEmployeeId: "cash-1",
        registerId: "reg-1",
        beneficiaryEmployeeId: "emp-1",
        approvedByEmployeeId: "emp-2",
        beneficiaryActiveRegisterId: "reg-1",
      }),
    ).toMatch(/another register/);
  });

  it("requires a company name for industry and an ID check for veteran", () => {
    expect(
      validateSpecialDiscountUse({
        kind: "industry",
        cashierEmployeeId: "c",
        registerId: "r",
        companyName: "  ",
      }),
    ).toMatch(/company name/);
    expect(
      validateSpecialDiscountUse({
        kind: "veteran",
        cashierEmployeeId: "c",
        registerId: "r",
        militaryIdChecked: false,
      }),
    ).toMatch(/military ID/);
  });

  it("never makes cannabis free (RCW 69.50.357) and never rounds against the store", () => {
    expect(applySpecialDiscount(100, 10_000)).toEqual({ discountMinor: 99, discountedMinor: 1 });
    expect(applySpecialDiscount(999, 1500)).toEqual({ discountMinor: 149, discountedMinor: 850 });
  });

  it("parses admin percents into basis points and rejects garbage", () => {
    expect(parsePercentToBps("35")).toBe(3500);
    expect(parsePercentToBps("12.5")).toBe(1250);
    expect(parsePercentToBps("101")).toBeNull();
    expect(parsePercentToBps("-1")).toBeNull();
  });
});
