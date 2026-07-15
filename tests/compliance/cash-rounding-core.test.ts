/**
 * tests/compliance/cash-rounding-core.test.ts
 *
 * Vitest mirror for the B33 cash-rounding core. WA DOR interim guidance:
 * the rounding mode is the retailer's choice, sales tax stays on the
 * PRE-ROUNDED price, and the adjustment is disclosed separately. The math
 * must be deterministic, bounded (|adjustment| ≤ 4¢), and always land the
 * cash due on a nickel.
 */
import { describe, expect, it } from "vitest";
import {
  CASH_ROUNDING_MODES,
  cashRoundingModeLabel,
  isCashRoundingMode,
  normalizePosCashRoundingConfig,
  roundCashDue,
  __runCashRoundingCoreTests,
} from "@/lib/pos/cash-rounding-core";

describe("normalizePosCashRoundingConfig", () => {
  it("degrades garbage to off — the register never invents a policy", () => {
    expect(normalizePosCashRoundingConfig(null).mode).toBe("off");
    expect(normalizePosCashRoundingConfig(undefined).mode).toBe("off");
    expect(normalizePosCashRoundingConfig("junk").mode).toBe("off");
    expect(normalizePosCashRoundingConfig([1, 2]).mode).toBe("off");
    expect(normalizePosCashRoundingConfig({ mode: "sideways" }).mode).toBe("off");
  });

  it("round-trips every legal mode", () => {
    for (const mode of CASH_ROUNDING_MODES) {
      expect(normalizePosCashRoundingConfig({ mode }).mode).toBe(mode);
    }
  });
});

describe("roundCashDue", () => {
  it("off is the identity", () => {
    expect(roundCashDue(2926, "off")).toEqual({ dueMinor: 2926, adjustmentMinor: 0 });
  });

  it("nearest matches the Square rounding table", () => {
    const table: Array<[number, number]> = [
      [2920, 2920], [2921, 2920], [2922, 2920], [2923, 2925], [2924, 2925],
      [2925, 2925], [2926, 2925], [2927, 2925], [2928, 2930], [2929, 2930],
    ];
    for (const [total, expected] of table) {
      const r = roundCashDue(total, "nearest");
      expect(r?.dueMinor).toBe(expected);
      expect(r?.adjustmentMinor).toBe(expected - total);
    }
  });

  it("up never charges less; down never charges more", () => {
    for (let cents = 0; cents < 100; cents += 1) {
      const total = 5000 + cents;
      const up = roundCashDue(total, "up");
      const down = roundCashDue(total, "down");
      expect(up!.dueMinor).toBeGreaterThanOrEqual(total);
      expect(down!.dueMinor).toBeLessThanOrEqual(total);
    }
  });

  it("bounds: |adjustment| ≤ 4 and due lands on the nickel in every mode", () => {
    for (let cents = 0; cents < 100; cents += 1) {
      for (const mode of ["nearest", "up", "down"] as const) {
        const r = roundCashDue(1000 + cents, mode);
        expect(r).not.toBeNull();
        expect(Math.abs(r!.adjustmentMinor)).toBeLessThanOrEqual(4);
        expect(r!.dueMinor % 5).toBe(0);
        expect(r!.dueMinor).toBe(1000 + cents + r!.adjustmentMinor);
      }
    }
  });

  it("refuses invalid input instead of guessing", () => {
    expect(roundCashDue(29.26, "nearest")).toBeNull();
    expect(roundCashDue(-1, "up")).toBeNull();
    expect(roundCashDue(0, "down")).toEqual({ dueMinor: 0, adjustmentMinor: 0 });
  });
});

describe("mode helpers", () => {
  it("isCashRoundingMode accepts only the enum", () => {
    expect(isCashRoundingMode("nearest")).toBe(true);
    expect(isCashRoundingMode("NEAREST")).toBe(false);
    expect(isCashRoundingMode(5)).toBe(false);
  });

  it("every mode has a label", () => {
    for (const mode of CASH_ROUNDING_MODES) {
      expect(cashRoundingModeLabel(mode).length).toBeGreaterThan(0);
    }
  });
});

describe("self-test harness", () => {
  it("runs clean", () => {
    expect(() => __runCashRoundingCoreTests()).not.toThrow();
  });
});
