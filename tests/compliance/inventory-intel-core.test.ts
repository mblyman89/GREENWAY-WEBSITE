/**
 * tests/compliance/inventory-intel-core.test.ts  (Task L)
 *
 * Runs the embedded self-test suite for the pure inventory-intelligence core
 * (ABC classification, FEFO ranking, aging buckets, months-of-supply vs the
 * WAC 314-55-079(10) 4-month ceiling, shrink telemetry per WAC 314-55-089(4)(c),
 * cycle-count cadence, and blind-count variance review) plus a few targeted
 * assertions on the public API.
 */
import { describe, it, expect } from "vitest";
import {
  __runInventoryIntelTests,
  classifyAbc,
  fefoRank,
  monthsOfSupply,
  reviewVariances,
  shrinkGroupOf,
  isOverdueForCount,
  MAX_MONTHS_ON_HAND,
  COUNT_CADENCE_DAYS,
  type IntelLot,
} from "@/lib/inventory/inventory-intel-core";

function lot(over: Partial<IntelLot> & { id: string }): IntelLot {
  return {
    productName: over.id,
    category: null,
    status: "active",
    isMedical: false,
    onHandQty: 10,
    receivedQty: 20,
    unitCostMinor: 1000,
    expiresOn: null,
    receivedAt: "2025-11-01T00:00:00Z",
    lastCountedAt: null,
    ...over,
  };
}

describe("inventory-intel-core (Task L)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runInventoryIntelTests()).not.toThrow();
  });

  it("constants match the documented policy", () => {
    expect(MAX_MONTHS_ON_HAND).toBe(4); // WAC 314-55-079(10)
    expect(COUNT_CADENCE_DAYS).toEqual({ A: 30, B: 90, C: 180 });
  });

  it("ABC puts the top-value lot in class A", () => {
    const abc = classifyAbc([
      lot({ id: "hi", onHandQty: 100, unitCostMinor: 500 }),
      lot({ id: "lo", onHandQty: 1, unitCostMinor: 100 }),
    ]);
    expect(abc.get("hi")).toBe("A");
    expect(abc.get("lo")).toBe("C");
  });

  it("FEFO ranks expired product first", () => {
    const order = fefoRank([
      lot({ id: "later", expiresOn: "2026-06-01" }),
      lot({ id: "expired", expiresOn: "2025-01-01" }),
    ]).map((l) => l.id);
    expect(order).toEqual(["expired", "later"]);
  });

  it("months-of-supply flags the 4-month ceiling", () => {
    const over = monthsOfSupply(
      [lot({ id: "slow", receivedQty: 200, onHandQty: 199, receivedAt: "2025-12-11T00:00:00Z" })],
      "2026-01-10",
    );
    expect(over.overCeiling).toBe(true);
  });

  it("shrink grouping keeps receive out of the shrink report", () => {
    expect(shrinkGroupOf("receive")).toBeNull();
    expect(shrinkGroupOf("theft")).toBe("shrink");
  });

  it("variance review flags large-dollar shorts", () => {
    const r = reviewVariances([
      { lineId: "big", productName: "Big", systemQty: 10, countedQty: 5, unitCostMinor: 5000 },
    ]);
    expect(r.flagged).toHaveLength(1);
    expect(r.netValueMinor).toBe(-25000);
  });

  it("never-counted active lots become overdue after the cadence window", () => {
    const l = lot({ id: "nc", lastCountedAt: null, receivedAt: "2025-09-01T00:00:00Z" });
    expect(isOverdueForCount(l, "A", "2026-01-10")).toBe(true);
    expect(isOverdueForCount({ ...l, status: "sold_out" }, "A", "2026-01-10")).toBe(false);
  });
});
