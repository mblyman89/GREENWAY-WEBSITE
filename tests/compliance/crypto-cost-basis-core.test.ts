/**
 * R1-C — Crypto tax engine, per-wallet cost-basis lot ledger (THE HEART).
 *
 * Locks down the never-guess, float-free, IRS-correct behaviour:
 *   • FIFO/LIFO/HIFO/Spec-ID pick the right lots and produce the right gains;
 *   • holding period is short at exactly 365 days, long at 366;
 *   • partial + multi-lot disposals apportion proceeds and basis with no drift
 *     (apportioned basis sums exactly to the lot basis);
 *   • MISSING BASIS is surfaced as a shortfall and the matched portion stays
 *     honest — a disposal is NEVER silently given $0 basis / 100% gain;
 *   • a disposal cannot consume a lot acquired after it;
 *   • quantity scaling round-trips down to 1 wei.
 * The embedded self-test suite runs here too so the two stay in lockstep.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoCostBasisCoreTests,
  computeCostBasisLedger,
  quantityToScaled,
  scaledToQuantity,
  COST_BASIS_METHODS,
  LONG_TERM_DAYS,
} from "../../src/lib/crypto/crypto-cost-basis-core";

const DAY = 86400000;

describe("crypto-cost-basis-core (R1-C)", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runCryptoCostBasisCoreTests()).not.toThrow();
  });

  it("exposes four methods and a 365-day long-term threshold", () => {
    expect(COST_BASIS_METHODS).toEqual(["fifo", "lifo", "hifo", "specid"]);
    expect(LONG_TERM_DAYS).toBe(365);
  });

  it("round-trips fractional quantities without floats", () => {
    for (const q of ["0", "1", "1.5", "0.1", "123.456789", "0.000000000000000001"]) {
      expect(scaledToQuantity(quantityToScaled(q))).toBe(q);
    }
  });

  it("computes a simple FIFO gain and closes the position", () => {
    const r = computeCostBasisLedger({
      method: "fifo",
      acquisitions: [{ id: "a1", quantityScaled: quantityToScaled("2"), basisCents: 20000, acquiredAtMs: 0 }],
      disposals: [{ id: "d1", quantityScaled: quantityToScaled("2"), proceedsCents: 30000, disposedAtMs: 30 * DAY }],
    });
    expect(r.totalRealizedGainCents).toBe(10000);
    expect(r.disposals[0].hasMissingBasis).toBe(false);
    expect(r.remainingLots).toHaveLength(0);
    expect(r.disposals[0].consumptions[0].holdingPeriod).toBe("short");
  });

  it("differs across FIFO/LIFO/HIFO on which lot is used", () => {
    const acquisitions = [
      { id: "A", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 },
      { id: "B", quantityScaled: quantityToScaled("1"), basisCents: 30000, acquiredAtMs: 5 * DAY },
    ];
    const disposals = [
      { id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 25000, disposedAtMs: 10 * DAY },
    ];
    expect(computeCostBasisLedger({ method: "fifo", acquisitions, disposals }).totalRealizedGainCents).toBe(15000);
    expect(computeCostBasisLedger({ method: "lifo", acquisitions, disposals }).totalRealizedGainCents).toBe(-5000);
    expect(computeCostBasisLedger({ method: "hifo", acquisitions, disposals }).totalRealizedGainCents).toBe(-5000);
  });

  it("honours Spec-ID lot order", () => {
    const acquisitions = [
      { id: "A", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 },
      { id: "B", quantityScaled: quantityToScaled("1"), basisCents: 30000, acquiredAtMs: 5 * DAY },
    ];
    const disposals = [
      { id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 25000, disposedAtMs: 10 * DAY },
    ];
    const bFirst = computeCostBasisLedger({ method: "specid", acquisitions, disposals, specIdOrder: ["B", "A"] });
    expect(bFirst.disposals[0].consumptions[0].lotId).toBe("B");
    expect(bFirst.totalRealizedGainCents).toBe(-5000);
  });

  it("splits short- vs long-term across the 365/366-day line", () => {
    const acquisitions = [{ id: "A", quantityScaled: quantityToScaled("2"), basisCents: 20000, acquiredAtMs: 0 }];
    const short = computeCostBasisLedger({
      method: "fifo",
      acquisitions,
      disposals: [{ id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 20000, disposedAtMs: 365 * DAY }],
    });
    expect(short.disposals[0].consumptions[0].holdingPeriod).toBe("short");
    const long = computeCostBasisLedger({
      method: "fifo",
      acquisitions,
      disposals: [{ id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 20000, disposedAtMs: 366 * DAY }],
    });
    expect(long.disposals[0].consumptions[0].holdingPeriod).toBe("long");
  });

  it("NEVER silently zero-bases a disposal — surfaces the shortfall", () => {
    const r = computeCostBasisLedger({
      method: "fifo",
      acquisitions: [{ id: "A", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 0 }],
      disposals: [{ id: "d", quantityScaled: quantityToScaled("2"), proceedsCents: 40000, disposedAtMs: DAY }],
    });
    expect(r.hasAnyMissingBasis).toBe(true);
    expect(r.disposals[0].missingBasisQuantityScaled).toBe(quantityToScaled("1"));
    // matched portion honest: proceeds apportioned to the 1 matched unit only.
    expect(r.disposals[0].matchedProceedsCents).toBe(20000);
    expect(r.disposals[0].realizedGainCents).toBe(10000);
  });

  it("apportions basis with zero drift across many partial sells", () => {
    const r = computeCostBasisLedger({
      method: "fifo",
      acquisitions: [{ id: "A", quantityScaled: quantityToScaled("3"), basisCents: 100, acquiredAtMs: 0 }],
      disposals: [
        { id: "d1", quantityScaled: quantityToScaled("1"), proceedsCents: 40, disposedAtMs: DAY },
        { id: "d2", quantityScaled: quantityToScaled("1"), proceedsCents: 40, disposedAtMs: 2 * DAY },
        { id: "d3", quantityScaled: quantityToScaled("1"), proceedsCents: 40, disposedAtMs: 3 * DAY },
      ],
    });
    const basisUsed =
      r.disposals[0].matchedBasisCents + r.disposals[1].matchedBasisCents + r.disposals[2].matchedBasisCents;
    expect(basisUsed).toBe(100);
    expect(r.remainingLots).toHaveLength(0);
  });

  it("does not let a disposal consume a lot acquired after it", () => {
    const r = computeCostBasisLedger({
      method: "fifo",
      acquisitions: [{ id: "late", quantityScaled: quantityToScaled("1"), basisCents: 10000, acquiredAtMs: 100 * DAY }],
      disposals: [{ id: "d", quantityScaled: quantityToScaled("1"), proceedsCents: 15000, disposedAtMs: 10 * DAY }],
    });
    expect(r.disposals[0].hasMissingBasis).toBe(true);
    expect(r.remainingLots).toHaveLength(1);
  });

  it("rejects invalid inputs rather than guessing", () => {
    expect(() =>
      computeCostBasisLedger({
        // @ts-expect-error deliberately bad method
        method: "bogus",
        acquisitions: [],
        disposals: [],
      }),
    ).toThrow();
    expect(() =>
      computeCostBasisLedger({
        method: "fifo",
        acquisitions: [{ id: "A", quantityScaled: BigInt(0), basisCents: 1, acquiredAtMs: 0 }],
        disposals: [],
      }),
    ).toThrow();
  });
});
