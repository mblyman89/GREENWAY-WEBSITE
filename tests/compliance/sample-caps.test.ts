/**
 * tests/compliance/sample-caps.test.ts  (S-14 / GAP M-11)
 *
 * WAC 314-55-096 sample caps. Pins the pure capacity math in
 * sample-capacity-core: per-employee trade cap × active employees, lane tone,
 * incoming-batch verdicts, and the quarter clock.
 *
 * IQC is producer/processor-only [096(3)] and is not available to a retailer,
 * so it has been fully retired — only the TRADE lane remains.
 */
import { describe, it, expect } from "vitest";
import {
  computeSampleCapacity,
  evaluateIncomingBatch,
  daysLeftInQuarter,
  __runSampleCapacityCoreTests,
} from "@/lib/compliance/sample-capacity-core";

/** Default per-employee trade cap used across the app (30 trade). */
const CAPS = { tradePerEmployee: 30 };

function capacity(overrides: Partial<Parameters<typeof computeSampleCapacity>[0]> = {}) {
  return computeSampleCapacity({
    activeEmployees: 4,
    tradeUsed: 0,
    daysLeftInQuarter: 45,
    ...CAPS,
    ...overrides,
  });
}

describe("capacity = activeEmployees × per-employee trade cap", () => {
  it("4 employees ⇒ 120 trade", () => {
    const c = capacity();
    expect(c.trade.capacity).toBe(120);
    expect(c.tone).toBe("green");
  });
  it("zero employees ⇒ red, zero capacity, do-not-accept headline", () => {
    const c = capacity({ activeEmployees: 0 });
    expect(c.tone).toBe("red");
    expect(c.trade.capacity).toBe(0);
    expect(c.headline).toMatch(/no one to give samples to/i);
  });
  it("fractional/negative employee counts are truncated to a safe integer", () => {
    expect(capacity({ activeEmployees: -3 }).trade.capacity).toBe(0);
  });
});

describe("lane accounting and tones", () => {
  it("remaining = capacity − used, floored at 0", () => {
    const c = capacity({ tradeUsed: 100 });
    expect(c.trade.remaining).toBe(20);
    const over = capacity({ tradeUsed: 500 });
    expect(over.trade.remaining).toBe(0);
    expect(over.trade.tone).toBe("red");
  });
  it("≥80% used turns the lane amber", () => {
    const c = capacity({ tradeUsed: 96 }); // 96/120 = 80%
    expect(c.trade.tone).toBe("amber");
  });
  it("trade lane exhausted ⇒ red with a hard warning headline", () => {
    const c = capacity({ tradeUsed: 120 });
    expect(c.tone).toBe("red");
    expect(c.headline).toMatch(/No distribution capacity left/i);
  });
});

describe("incoming batch verdict (accept-time advisory)", () => {
  it("a batch that fits is green", () => {
    const v = evaluateIncomingBatch({ batchUnits: 20, capacity: capacity() });
    expect(v.tone).toBe("green");
    expect(v.unplaceable).toBe(0);
  });
  it("a batch that exceeds remaining trade capacity reports the unplaceable overflow", () => {
    const c = capacity({ tradeUsed: 110 }); // 10 remaining
    const v = evaluateIncomingBatch({ batchUnits: 25, capacity: c });
    expect(v.unplaceable).toBe(15);
    expect(v.tone).not.toBe("green");
  });
});

describe("quarter clock", () => {
  it("days left is inclusive of today and correct at quarter boundaries", () => {
    expect(daysLeftInQuarter("2025-03-31")).toBe(1); // last day of Q1
    expect(daysLeftInQuarter("2025-01-01")).toBe(90); // full Q1 2025 (non-leap)
    expect(daysLeftInQuarter("2025-12-31")).toBe(1);
  });
});

describe("embedded self-tests still pass under vitest", () => {
  it("__runSampleCapacityCoreTests", () => {
    expect(() => __runSampleCapacityCoreTests()).not.toThrow();
  });
});
