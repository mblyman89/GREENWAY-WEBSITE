/**
 * Vitest mirror of the revenue-basis pure self-tests (GW-015).
 * Locks the internal-reports revenue policy: COMPLETED orders only. This
 * store captures no online payment, so an order that never completed
 * (no_show, stuck-in-ready exception orders, cancelled) never collected a
 * cent and must not count toward gross, AOV, COGS revenue, customer
 * classification, or the forecast.
 */
import { describe, expect, it } from "vitest";

import {
  REVENUE_STATUS,
  REVENUE_BASIS_LABEL,
  isRevenueOrder,
  __runRevenueBasisTests,
} from "@/lib/reports/revenue-basis";

describe("revenue-basis", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runRevenueBasisTests()).not.toThrow();
  });

  it("only completed orders carry revenue", () => {
    expect(REVENUE_STATUS).toBe("completed");
    expect(isRevenueOrder("completed")).toBe(true);
    for (const s of ["new", "acknowledged", "preparing", "ready", "cancelled", "no_show"]) {
      expect(isRevenueOrder(s)).toBe(false);
    }
  });

  it("unknown or malformed statuses never count as money", () => {
    expect(isRevenueOrder("")).toBe(false);
    expect(isRevenueOrder("Completed")).toBe(false);
    expect(isRevenueOrder("refunded")).toBe(false);
  });

  it("pins the UI basis label", () => {
    expect(REVENUE_BASIS_LABEL).toBe("completed orders");
  });
});
