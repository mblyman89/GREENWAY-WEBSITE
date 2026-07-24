/**
 * tests/compliance/special-discount-report-core.test.ts
 *
 * SLICE 29 — vitest mirror for the special-discount report summarizer.
 * The exhaustive cases live in the module's embedded self-tests (run by
 * the compliance pure runner); this mirror keeps the module under vitest
 * too and pins the owner-facing contract: WHO gives the discounts, TO WHOM
 * they go (companies grouped case-insensitively), and HOW OFTEN — bucketed
 * on Pacific days, never UTC.
 */
import { describe, expect, it } from "vitest";
import {
  __runSpecialDiscountReportTests,
  summarizeSpecialDiscountUses,
  type SpecialDiscountUseLike,
} from "@/lib/discounts/special-discount-report-core";

const use = (over: Partial<SpecialDiscountUseLike> = {}): SpecialDiscountUseLike => ({
  kind: "veteran",
  cashierEmployeeId: "cash-1",
  registerId: "reg-1",
  beneficiaryEmployeeId: null,
  approvedByEmployeeId: null,
  companyName: null,
  militaryIdChecked: true,
  subtotalMinor: 10_000,
  discountMinor: 1_500,
  occurredAt: "2026-02-10T20:00:00.000Z",
  ...over,
});

describe("special-discount-report-core", () => {
  it("runs the embedded self-test battery", () => {
    expect(() => __runSpecialDiscountReportTests()).not.toThrow();
  });

  it("answers WHO gives them — cashiers ranked by cents given", () => {
    const s = summarizeSpecialDiscountUses([
      use({ cashierEmployeeId: "alice", discountMinor: 500 }),
      use({ cashierEmployeeId: "bob", discountMinor: 900 }),
      use({ cashierEmployeeId: "alice", discountMinor: 300 }),
    ]);
    expect(s.byCashier.map((c) => c.id)).toEqual(["bob", "alice"]);
    expect(s.byCashier[1].uses).toBe(2);
    expect(s.byCashier[1].discountMinor).toBe(800);
  });

  it("answers TO WHOM — one vendor per company, case-insensitively", () => {
    const s = summarizeSpecialDiscountUses([
      use({ kind: "industry", companyName: "Acme Farms", discountMinor: 100 }),
      use({ kind: "industry", companyName: "ACME FARMS", discountMinor: 200 }),
    ]);
    expect(s.byCompany).toHaveLength(1);
    expect(s.byCompany[0].name).toBe("Acme Farms");
    expect(s.byCompany[0].uses).toBe(2);
    expect(s.byCompany[0].discountMinor).toBe(300);
  });

  it("answers HOW OFTEN — days bucket in Pacific time, not UTC", () => {
    // 2026-02-11T05:00Z is 9pm Feb 10 in Washington.
    const s = summarizeSpecialDiscountUses([use({ occurredAt: "2026-02-11T05:00:00.000Z" })]);
    expect(s.byDay).toEqual([{ date: "2026-02-10", uses: 1, discountMinor: 1_500 }]);
  });

  it("always reports the three programs in canonical order, even when empty", () => {
    const s = summarizeSpecialDiscountUses([]);
    expect(s.byKind.map((k) => k.kind)).toEqual(["employee", "industry", "veteran"]);
    expect(s.totalUses).toBe(0);
    expect(s.avgDiscountMinor).toBe(0);
  });
});
