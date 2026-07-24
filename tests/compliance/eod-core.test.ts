/**
 * tests/compliance/eod-core.test.ts  (Feature slice 32)
 *
 * Vitest mirror of the eod-core self-tests: the pure model builder behind
 * the printable back-office end-of-day summary report.
 */
import { describe, expect, it } from "vitest";
import { buildEodModel, __runEodCoreTests } from "@/lib/registers/eod-core";
import { type DaySummary } from "@/lib/pos/day-report-core";

const SALES: DaySummary = {
  saleCount: 12,
  grossMinor: 123_456,
  subtotalMinor: 100_000,
  taxMinor: 23_456,
  medicalSaleCount: 1,
  medicalSavingsMinor: 900,
  roundedSaleCount: 2,
  roundingMinor: -3,
  noSaleCount: 1,
  exceptionCount: 0,
  pendingCount: 0,
};

const BASE = {
  registers: [
    { id: "r1", name: "Register 1" },
    { id: "r2", name: "Register 2" },
    { id: "r3", name: "Register 3 (idle)" },
  ],
  drops: [
    { registerId: "r1", amountMinor: 20_000 },
    { registerId: "r1", amountMinor: 10_000 },
    { registerId: "r2", amountMinor: 5_000 },
  ],
  sales: SALES,
  safeReady: true,
  safeCounts: [
    { window: "pm", totalMinor: 100_300, varianceMinor: 300 },
    { window: "am", totalMinor: 100_000, varianceMinor: 0 },
    { window: "other", totalMinor: 99_000, varianceMinor: -1_000 },
  ],
  swaps: [{ amountMinor: 10_000 }, { amountMinor: 2_500 }],
};

describe("eod-core (slice 32)", () => {
  it("self-tests pass", () => {
    expect(() => __runEodCoreTests()).not.toThrow();
  });

  it("a fully closed day is FINAL, idle registers are omitted, rows carry the till story", () => {
    const model = buildEodModel({
      ...BASE,
      sessions: [
        { registerId: "r1", status: "reconciled", openingCountMinor: 16_750, closingCountMinor: 52_000, overShortMinor: -150, tipsMinor: 4_250 },
        { registerId: "r2", status: "closed", openingCountMinor: 16_750, closingCountMinor: 40_000, overShortMinor: null, tipsMinor: null },
      ],
    });
    expect(model.final).toBe(true);
    expect(model.registers).toHaveLength(2);

    const r1 = model.registers[0];
    expect(r1.registerName).toBe("Register 1");
    expect(r1.openingMinor).toBe(16_750);
    expect(r1.dropCount).toBe(2);
    expect(r1.dropsMinor).toBe(30_000);
    expect(r1.closedMinor).toBe(52_000);
    expect(r1.overShortMinor).toBe(-150);
    expect(r1.tipsMinor).toBe(4_250);

    // Blind stays blind: a closed-but-unreconciled row hides over/short.
    const r2 = model.registers[1];
    expect(r2.overShortMinor).toBeNull();
    expect(r2.tipsMinor).toBeNull();

    expect(model.totals.openingMinor).toBe(33_500);
    expect(model.totals.dropsMinor).toBe(35_000);
    expect(model.totals.closedMinor).toBe(92_000);
    expect(model.totals.overShortMinor).toBe(-150);
    expect(model.totals.tipsMinor).toBe(4_250);
    expect(model.sales.grossMinor).toBe(123_456);
  });

  it("rolls up the safe: latest AM/PM counts, extra counts, swap totals", () => {
    const model = buildEodModel({
      ...BASE,
      sessions: [
        { registerId: "r1", status: "closed", openingCountMinor: 16_750, closingCountMinor: 40_000, overShortMinor: null, tipsMinor: null },
      ],
    });
    expect(model.safe.ready).toBe(true);
    expect(model.safe.amCount?.varianceMinor).toBe(0);
    expect(model.safe.pmCount?.varianceMinor).toBe(300);
    expect(model.safe.otherCount).toBe(1);
    expect(model.safe.swapCount).toBe(2);
    expect(model.safe.swapsMinor).toBe(12_500);
  });

  it("an open drawer makes the report PRELIMINARY; empty days never go FINAL", () => {
    const mid = buildEodModel({
      ...BASE,
      sessions: [
        { registerId: "r1", status: "open", openingCountMinor: 16_750, closingCountMinor: null, overShortMinor: null, tipsMinor: null },
      ],
    });
    expect(mid.final).toBe(false);
    expect(mid.totals.openRegisterCount).toBe(1);
    expect(mid.totals.closedMinor).toBeNull();

    const empty = buildEodModel({ ...BASE, sessions: [], safeReady: false, safeCounts: [], swaps: [] });
    expect(empty.final).toBe(false);
    expect(empty.registers).toHaveLength(0);
    expect(empty.safe.ready).toBe(false);
    expect(empty.safe.amCount).toBeNull();
  });
});
