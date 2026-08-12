import { describe, it, expect } from "vitest";
import type { DisposalResult, LotConsumption, HoldingPeriod } from "../../src/lib/crypto/crypto-cost-basis-core";
import {
  __runCryptoForm8949CoreTests,
  buildForm8949Report,
  buildRowsForDisposal,
  computeScheduleD,
  centsToWholeDollars,
  msToIsoDate,
  FORM8949_SHORT_TERM_BOX,
  FORM8949_LONG_TERM_BOX,
  DATE_ACQUIRED_VARIOUS,
  CAPITAL_LOSS_CAP_CENTS,
  CAPITAL_LOSS_CAP_MFS_CENTS,
} from "../../src/lib/crypto/crypto-form8949-core";

const DAY = 86400000;

function mkConsumption(over: Partial<LotConsumption> & { holdingPeriod: HoldingPeriod }): LotConsumption {
  return {
    lotId: over.lotId ?? "lot",
    quantityScaled: over.quantityScaled ?? BigInt(0),
    proceedsCents: over.proceedsCents ?? 0,
    basisCents: over.basisCents ?? 0,
    gainCents: over.gainCents ?? 0,
    acquiredAtMs: over.acquiredAtMs ?? 0,
    disposedAtMs: over.disposedAtMs ?? 0,
    holdingPeriod: over.holdingPeriod,
  };
}

function mkDisposal(over: Partial<DisposalResult> & { disposalId: string }): DisposalResult {
  return {
    disposalId: over.disposalId,
    matchedQuantityScaled: over.matchedQuantityScaled ?? BigInt(0),
    missingBasisQuantityScaled: over.missingBasisQuantityScaled ?? BigInt(0),
    consumptions: over.consumptions ?? [],
    matchedProceedsCents: over.matchedProceedsCents ?? 0,
    matchedBasisCents: over.matchedBasisCents ?? 0,
    realizedGainCents: over.realizedGainCents ?? 0,
    shortTermGainCents: over.shortTermGainCents ?? 0,
    longTermGainCents: over.longTermGainCents ?? 0,
    hasMissingBasis: over.hasMissingBasis ?? false,
  };
}

describe("crypto-form8949-core embedded self-tests", () => {
  it("passes all pure self-tests", () => {
    expect(() => __runCryptoForm8949CoreTests()).not.toThrow();
  });
});

describe("Form 8949 digital-asset boxes", () => {
  it("uses box I for self-custody short-term", () => {
    const d = mkDisposal({
      disposalId: "s",
      consumptions: [mkConsumption({ holdingPeriod: "short", proceedsCents: 100, basisCents: 40, gainCents: 60, acquiredAtMs: DAY, disposedAtMs: 10 * DAY })],
    });
    const rows = buildRowsForDisposal({ assetSymbol: "FLR", quantityDisplay: "1", disposal: d });
    expect(rows[0].box).toBe(FORM8949_SHORT_TERM_BOX);
    expect(rows[0].box).toBe("I");
  });

  it("uses box L for self-custody long-term", () => {
    const d = mkDisposal({
      disposalId: "l",
      consumptions: [mkConsumption({ holdingPeriod: "long", proceedsCents: 100, basisCents: 40, gainCents: 60, acquiredAtMs: 0, disposedAtMs: 500 * DAY })],
    });
    const rows = buildRowsForDisposal({ assetSymbol: "BTC", quantityDisplay: "1", disposal: d });
    expect(rows[0].box).toBe(FORM8949_LONG_TERM_BOX);
    expect(rows[0].box).toBe("L");
  });

  it("splits a mixed-period disposal into two rows (Part I + Part II)", () => {
    const d = mkDisposal({
      disposalId: "mix",
      consumptions: [
        mkConsumption({ holdingPeriod: "short", proceedsCents: 100, basisCents: 40, gainCents: 60, acquiredAtMs: 400 * DAY, disposedAtMs: 500 * DAY }),
        mkConsumption({ holdingPeriod: "long", proceedsCents: 100, basisCents: 20, gainCents: 80, acquiredAtMs: 0, disposedAtMs: 500 * DAY }),
      ],
    });
    const rows = buildRowsForDisposal({ assetSymbol: "XLM", quantityDisplay: "2", disposal: d });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.box).sort()).toEqual(["I", "L"]);
  });
});

describe("column (b) VARIOUS handling", () => {
  it("renders VARIOUS when lots in a period differ by acquire date", () => {
    const d = mkDisposal({
      disposalId: "v",
      consumptions: [
        mkConsumption({ holdingPeriod: "short", proceedsCents: 50, basisCents: 20, gainCents: 30, acquiredAtMs: 5 * DAY, disposedAtMs: 50 * DAY }),
        mkConsumption({ holdingPeriod: "short", proceedsCents: 50, basisCents: 25, gainCents: 25, acquiredAtMs: 6 * DAY, disposedAtMs: 50 * DAY }),
      ],
    });
    const rows = buildRowsForDisposal({ assetSymbol: "FLR", quantityDisplay: "2", disposal: d });
    expect(rows[0].dateAcquiredColB).toBe(DATE_ACQUIRED_VARIOUS);
  });

  it("renders a single ISO date when acquire dates match", () => {
    const d = mkDisposal({
      disposalId: "sd",
      consumptions: [
        mkConsumption({ holdingPeriod: "short", proceedsCents: 50, basisCents: 20, gainCents: 30, acquiredAtMs: 5 * DAY, disposedAtMs: 50 * DAY }),
        mkConsumption({ holdingPeriod: "short", proceedsCents: 50, basisCents: 25, gainCents: 25, acquiredAtMs: 5 * DAY, disposedAtMs: 50 * DAY }),
      ],
    });
    const rows = buildRowsForDisposal({ assetSymbol: "FLR", quantityDisplay: "2", disposal: d });
    expect(rows[0].dateAcquiredColB).toBe(msToIsoDate(5 * DAY));
    expect(rows[0].dateAcquiredColB).not.toBe(DATE_ACQUIRED_VARIOUS);
  });
});

describe("whole-dollar rounding (IRS half-up)", () => {
  it("rounds cents to whole dollars half-up, preserving sign", () => {
    expect(centsToWholeDollars(49)).toBe(0);
    expect(centsToWholeDollars(50)).toBe(1);
    expect(centsToWholeDollars(12345)).toBe(123);
    expect(centsToWholeDollars(12350)).toBe(124);
    expect(centsToWholeDollars(-12350)).toBe(-124);
  });
});

describe("Schedule D netting + $3,000 loss cap + carryforward", () => {
  it("passes net gains through unchanged", () => {
    const d = computeScheduleD(10000, 20000, "single", 0);
    expect(d.netCapitalGainCents).toBe(30000);
    expect(d.allowedLossOrGainCents).toBe(30000);
    expect(d.lossCarryforwardCents).toBe(0);
  });

  it("caps a large net loss at $3,000 and carries the remainder", () => {
    const d = computeScheduleD(-600000, -100000, "single", 0);
    expect(d.allowedLossOrGainCents).toBe(-CAPITAL_LOSS_CAP_CENTS);
    expect(d.lossCarryforwardCents).toBe(700000 - CAPITAL_LOSS_CAP_CENTS);
    expect(d.capUsedCents).toBe(CAPITAL_LOSS_CAP_CENTS);
  });

  it("uses the $1,500 MFS cap", () => {
    const d = computeScheduleD(-500000, 0, "mfs", 0);
    expect(d.allowedLossOrGainCents).toBe(-CAPITAL_LOSS_CAP_MFS_CENTS);
    expect(d.lossCarryforwardCents).toBe(500000 - CAPITAL_LOSS_CAP_MFS_CENTS);
  });

  it("folds a prior-year loss carryforward into this year's net", () => {
    const d = computeScheduleD(100000, 0, "single", 400000);
    expect(d.netCapitalGainCents).toBe(-300000);
    expect(d.allowedLossOrGainCents).toBe(-CAPITAL_LOSS_CAP_CENTS);
    expect(d.lossCarryforwardCents).toBe(0);
  });

  it("rejects a negative prior carryforward", () => {
    expect(() => computeScheduleD(0, 0, "single", -1)).toThrow();
  });
});

describe("full report builder", () => {
  it("aggregates rows, totals, Schedule D and missing-basis flag", () => {
    const shortD = mkDisposal({
      disposalId: "d1",
      consumptions: [mkConsumption({ holdingPeriod: "short", proceedsCents: 15000, basisCents: 10000, gainCents: 5000, acquiredAtMs: 10 * DAY, disposedAtMs: 100 * DAY })],
    });
    const longD = mkDisposal({
      disposalId: "d2",
      consumptions: [mkConsumption({ holdingPeriod: "long", proceedsCents: 20000, basisCents: 8000, gainCents: 12000, acquiredAtMs: 0, disposedAtMs: 500 * DAY })],
    });
    const report = buildForm8949Report({
      disposals: [
        { assetSymbol: "FLR", quantityDisplay: "1.5", disposal: shortD },
        { assetSymbol: "BTC", quantityDisplay: "0.01", disposal: longD },
      ],
      filingStatus: "single",
    });
    expect(report.rows).toHaveLength(2);
    expect(report.shortTermTotals.gainLossCents).toBe(5000);
    expect(report.longTermTotals.gainLossCents).toBe(12000);
    expect(report.scheduleD.netCapitalGainCents).toBe(17000);
    expect(report.hasAnyMissingBasis).toBe(false);
  });

  it("surfaces missing basis and never invents a $0-basis silent row", () => {
    const missing = mkDisposal({ disposalId: "m", hasMissingBasis: true, consumptions: [] });
    const report = buildForm8949Report({ disposals: [{ assetSymbol: "XLM", quantityDisplay: "5", disposal: missing }] });
    expect(report.hasAnyMissingBasis).toBe(true);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].hasMissingBasis).toBe(true);
  });
});
