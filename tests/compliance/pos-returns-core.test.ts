/**
 * tests/compliance/pos-returns-core.test.ts  (POS B15)
 *
 * Customer-return policy core. Pins:
 *  - the receipt-number lookup contract (last 8 hex of the sale client UUID,
 *    uppercase — identical to receiptNumber() in receipt-core),
 *  - the owner's return window in Pacific calendar days (purchase day = 0) —
 *    default 7 since Fix 6F (owner message 9), any owner-set window honored,
 *  - the loyalty-member gate (orders.customer_id) — applied ONLY when the
 *    owner's Return policy setting turns it on (Fix 6F),
 *  - exact refund math on stored tax-inclusive minor-unit prices,
 *  - proportional, floored, clamped loyalty points clawback.
 *
 * WAC 314-55-079(12) packaging/legibility attestations remain enforced by
 * validateCustomerReturn in @/lib/inventory/disposition-core (Task Q).
 */
import { describe, expect, it } from "vitest";
import {
  __runPosReturnsCoreTests,
  clientUuidMatchesReceipt,
  evaluateReturnEligibility,
  normalizeReceiptNumber,
  pacificDaysBetween,
  pointsClawback,
  receiptLookupSuffix,
  refundForLine,
  refundForLines,
  RETURN_WINDOW_DAYS,
  returnWindowVerdict,
} from "@/lib/pos/returns-core";
import { receiptNumber } from "@/lib/pos/receipt-core";

describe("pos/returns-core (POS B15)", () => {
  it("passes its pure self-tests", () => {
    expect(() => __runPosReturnsCoreTests()).not.toThrow();
  });

  it("receipt-number contract stays glued to the printed receipt", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    const printed = receiptNumber(uuid); // what the paper actually shows
    expect(printed).toBe("14174000");
    expect(normalizeReceiptNumber(` ${printed.toLowerCase()} `)).toBe(printed);
    expect(clientUuidMatchesReceipt(uuid, printed)).toBe(true);
    expect(receiptLookupSuffix(printed)).toBe(printed.toLowerCase());
    expect(normalizeReceiptNumber("1234567")).toBeNull();
    expect(normalizeReceiptNumber("not-hex!")).toBeNull();
  });

  it("counts the default 7-day window in Pacific calendar days (purchase day = 0)", () => {
    expect(RETURN_WINDOW_DAYS).toBe(7);
    // 11:30 PM Pacific July 1 → 00:30 AM Pacific July 2 is one Pacific day
    // even though only an hour elapsed.
    expect(pacificDaysBetween("2026-07-02T06:30:00.000Z", "2026-07-02T08:00:00.000Z")).toBe(1);
    const lastDay = returnWindowVerdict("2026-07-01T19:00:00.000Z", "2026-07-08T19:00:00.000Z");
    expect(lastDay.ok).toBe(true);
    const tooLate = returnWindowVerdict("2026-07-01T19:00:00.000Z", "2026-07-09T19:00:00.000Z");
    expect(tooLate.ok).toBe(false);
    if (!tooLate.ok) expect(tooLate.error).toContain("7-day");
    // An owner-set 15-day window still works.
    expect(returnWindowVerdict("2026-07-01T19:00:00.000Z", "2026-07-16T19:00:00.000Z", 15).ok).toBe(true);
    expect(returnWindowVerdict("2026-07-01T19:00:00.000Z", "2026-07-17T19:00:00.000Z", 15).ok).toBe(false);
  });

  it("accepts anonymous sales by default (owner message 9)", () => {
    const verdict = evaluateReturnEligibility({
      orderStatus: "completed",
      orderCustomerId: null,
      purchasedAtIso: "2026-07-01T19:00:00.000Z",
      nowIso: "2026-07-03T19:00:00.000Z",
    });
    expect(verdict.ok).toBe(true);
  });

  it("refuses anonymous sales when the loyalty toggle is on and reports every failure at once", () => {
    const verdict = evaluateReturnEligibility({
      policy: { loyaltyRequired: true, windowDays: 7, excludedCategories: [] },
      orderStatus: "pending",
      orderCustomerId: null,
      purchasedAtIso: "2026-06-01T19:00:00.000Z",
      nowIso: "2026-07-05T19:00:00.000Z",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.errors).toHaveLength(3); // status + loyalty + window
      expect(verdict.errors.join(" ")).toContain("loyalty");
    }
  });

  it("refund math is exact minor units off the stored paid price", () => {
    const one = refundForLine({ unitPriceMinor: 1463, quantity: 2, remainingReturnable: 2 });
    expect(one).toEqual({ ok: true, refundMinor: 2926 });
    const sum = refundForLines([
      { unitPriceMinor: 1463, quantity: 1, remainingReturnable: 2 },
      { unitPriceMinor: 2800, quantity: 2, remainingReturnable: 2 },
    ]);
    expect(sum).toEqual({ ok: true, refundMinor: 7063 });
    expect(refundForLine({ unitPriceMinor: 1463, quantity: 3, remainingReturnable: 2 }).ok).toBe(false);
  });

  it("points clawback is proportional, floored, and clamped", () => {
    expect(pointsClawback({ earnedPoints: 20, refundMinor: 2926, orderTotalMinor: 2926 })).toBe(20);
    expect(pointsClawback({ earnedPoints: 20, refundMinor: 1463, orderTotalMinor: 2926 })).toBe(10);
    expect(pointsClawback({ earnedPoints: 3, refundMinor: 1000, orderTotalMinor: 2926 })).toBe(1);
    expect(pointsClawback({ earnedPoints: 20, refundMinor: 99999, orderTotalMinor: 2926 })).toBe(20);
    expect(pointsClawback({ earnedPoints: 0, refundMinor: 2926, orderTotalMinor: 2926 })).toBe(0);
  });
});
