/**
 * R1-D — Crypto tax engine, reconciliation + review queues (pure).
 *
 * Locks down the three trust checks:
 *   • reconcileBalances sums in−out from history (ignoring self / null-asset),
 *     compares to the stored balance, surfaces signed deltas, honours a dust
 *     tolerance, and is exact on fractional amounts (0.1 + 0.2 = 0.3);
 *   • buildMissingBasisQueue only queues disposals that actually lack basis and
 *     reassures the owner we never assume a $0 cost;
 *   • suggestTransferMatches pairs cross-wallet OUT/IN of the same asset within
 *     amount + time tolerance, scores confidence, uses each IN once, and never
 *     matches same-wallet or different-asset legs.
 * The embedded self-test suite runs here too so the two stay in lockstep.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoReconciliationCoreTests,
  reconcileBalances,
  buildMissingBasisQueue,
  suggestTransferMatches,
  bpsToScaledTolerance,
} from "../../src/lib/crypto/crypto-reconciliation-core";
import { quantityToScaled, scaledToQuantity, type LedgerResult } from "../../src/lib/crypto/crypto-cost-basis-core";

const BASE = 1000000000000;

describe("crypto-reconciliation-core (R1-D)", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runCryptoReconciliationCoreTests()).not.toThrow();
  });

  it("reconciles in − out against the stored balance", () => {
    const r = reconcileBalances(
      [
        { walletId: "w", assetId: "a", direction: "in", amountDecimal: "10" },
        { walletId: "w", assetId: "a", direction: "out", amountDecimal: "4" },
      ],
      [{ walletId: "w", assetId: "a", amountDecimal: "6" }],
    );
    expect(r.allReconciled).toBe(true);
    expect(r.rows[0].computedDecimal).toBe("6");
    expect(r.rows[0].deltaDecimal).toBe("0");
  });

  it("surfaces a signed delta on mismatch", () => {
    const r = reconcileBalances(
      [{ walletId: "w", assetId: "a", direction: "in", amountDecimal: "10" }],
      [{ walletId: "w", assetId: "a", amountDecimal: "7" }],
    );
    expect(r.allReconciled).toBe(false);
    expect(r.mismatchCount).toBe(1);
    expect(r.rows[0].deltaDecimal).toBe("-3");
  });

  it("is exact on fractional sums (no float error)", () => {
    const r = reconcileBalances(
      [
        { walletId: "w", assetId: "a", direction: "in", amountDecimal: "0.1" },
        { walletId: "w", assetId: "a", direction: "in", amountDecimal: "0.2" },
      ],
      [{ walletId: "w", assetId: "a", amountDecimal: "0.3" }],
    );
    expect(r.allReconciled).toBe(true);
  });

  it("ignores self-transfers and null-asset rows", () => {
    const r = reconcileBalances(
      [
        { walletId: "w", assetId: "a", direction: "self", amountDecimal: "9" },
        { walletId: "w", assetId: null, direction: "in", amountDecimal: "9" },
        { walletId: "w", assetId: "a", direction: "in", amountDecimal: "2" },
      ],
      [{ walletId: "w", assetId: "a", amountDecimal: "2" }],
    );
    expect(r.allReconciled).toBe(true);
  });

  function ledgerWith(missingUnits: string, hasMissing: boolean): LedgerResult {
    return {
      disposals: [
        {
          disposalId: "d1",
          matchedQuantityScaled: quantityToScaled("1"),
          missingBasisQuantityScaled: hasMissing ? quantityToScaled(missingUnits) : BigInt(0),
          consumptions: [],
          matchedProceedsCents: 100,
          matchedBasisCents: 40,
          realizedGainCents: 60,
          shortTermGainCents: 60,
          longTermGainCents: 0,
          hasMissingBasis: hasMissing,
        },
      ],
      remainingLots: [],
      totalRealizedGainCents: 60,
      totalShortTermGainCents: 60,
      totalLongTermGainCents: 0,
      totalMissingBasisQuantityScaled: hasMissing ? quantityToScaled(missingUnits) : BigInt(0),
      hasAnyMissingBasis: hasMissing,
    };
  }

  it("queues only disposals that actually lack basis", () => {
    expect(buildMissingBasisQueue(ledgerWith("2", true))).toHaveLength(1);
    expect(buildMissingBasisQueue(ledgerWith("0", false))).toHaveLength(0);
    const q = buildMissingBasisQueue(ledgerWith("2", true));
    expect(q[0].missingQuantityDecimal).toBe("2");
    expect(q[0].note).toContain("NOT assume a $0");
  });

  it("suggests high-confidence cross-wallet transfers only", () => {
    const m = suggestTransferMatches([
      { id: "out", walletId: "wA", assetId: "a", direction: "out", amountDecimal: "5", timeMs: BASE },
      { id: "in", walletId: "wB", assetId: "a", direction: "in", amountDecimal: "5", timeMs: BASE + 60000 },
      { id: "self", walletId: "wA", assetId: "a", direction: "in", amountDecimal: "5", timeMs: BASE + 1000 },
      { id: "other", walletId: "wB", assetId: "z", direction: "in", amountDecimal: "5", timeMs: BASE + 1000 },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0].inTxId).toBe("in");
    expect(m[0].confidence).toBeGreaterThan(90);
  });

  it("rejects out-of-tolerance amounts and time gaps", () => {
    expect(
      suggestTransferMatches([
        { id: "o", walletId: "wA", assetId: "a", direction: "out", amountDecimal: "5", timeMs: BASE },
        { id: "i", walletId: "wB", assetId: "a", direction: "in", amountDecimal: "50", timeMs: BASE + 1000 },
      ]),
    ).toHaveLength(0);
    expect(
      suggestTransferMatches([
        { id: "o", walletId: "wA", assetId: "a", direction: "out", amountDecimal: "5", timeMs: BASE },
        { id: "i", walletId: "wB", assetId: "a", direction: "in", amountDecimal: "5", timeMs: BASE + 7200000 },
      ]),
    ).toHaveLength(0);
  });

  it("uses each incoming leg at most once", () => {
    const m = suggestTransferMatches([
      { id: "o1", walletId: "wA", assetId: "a", direction: "out", amountDecimal: "5", timeMs: BASE },
      { id: "o2", walletId: "wC", assetId: "a", direction: "out", amountDecimal: "5", timeMs: BASE + 2000 },
      { id: "i1", walletId: "wB", assetId: "a", direction: "in", amountDecimal: "5", timeMs: BASE + 1000 },
    ]);
    expect(m).toHaveLength(1);
  });

  it("computes a bps dust tolerance", () => {
    expect(scaledToQuantity(bpsToScaledTolerance("100", 100))).toBe("1");
    expect(scaledToQuantity(bpsToScaledTolerance("100", 0))).toBe("0");
  });
});
